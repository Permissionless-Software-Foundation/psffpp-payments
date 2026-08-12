/**
 * Cosign ShareContract.claim — tx-bound ECDSA (NOT message signatures).
 */
import {
  TransactionBuilder,
  SignatureTemplate,
  HashType,
  SignatureAlgorithm
} from 'cashscript'
import { binToHex } from '@bitauth/libauth'
import { pkhToCashAddr } from './address'
import {
  createProvider,
  instantiateContracts,
  feeFromHex,
  DEFAULT_FEE_RATE
} from './lib'

const SIGHASH = HashType.SIGHASH_ALL | HashType.SIGHASH_UTXOS
const EMPTY_SIG = Uint8Array.of()

function claimArgsCapturing (signerSlot, template) {
  const captured = { signature: null }
  const orig = template.generateSignature.bind(template)
  template.generateSignature = (payload, bchForkId) => {
    const sig = orig(payload, bchForkId)
    captured.signature = sig
    return sig
  }
  const args = [EMPTY_SIG, EMPTY_SIG, EMPTY_SIG]
  args[signerSlot] = template
  const restore = () => {
    template.generateSignature = orig
  }
  return { args, captured, restore }
}

function parseUtxoRef (ref) {
  const [txid, voutStr] = ref.split(':')
  const vout = Number(voutStr)
  if (!txid || !Number.isInteger(vout) || vout < 0) {
    throw new Error(`UTXO must be <txid>:<vout>, got ${ref}`)
  }
  return { txid, vout }
}

export async function cosignClaim ({
  cfg,
  wallet,
  shareIndex,
  utxoRef = null,
  payoutSatoshis = null,
  feeRate = DEFAULT_FEE_RATE
} = {}) {
  if (!cfg) throw new Error('Deploy config required')
  if (!wallet) throw new Error('Wallet required to cosign')
  if (!Number.isInteger(shareIndex) || shareIndex < 0 || shareIndex > 2) {
    throw new Error('shareIndex must be 0, 1, or 2')
  }

  const network = cfg.network || 'mainnet'
  const provider = createProvider(network)
  const { shares } = instantiateContracts(cfg, provider)

  const share = shares[shareIndex]
  const payoutPkh = cfg.nodes[shareIndex].pkh
  const payoutAddress = pkhToCashAddr(payoutPkh, network)

  let utxos = (await share.getUtxos()).filter((u) => !u.token)
  if (utxoRef) {
    const ref = parseUtxoRef(utxoRef)
    utxos = utxos.filter((u) => u.txid === ref.txid && u.vout === ref.vout)
    if (utxos.length === 0) {
      throw new Error(`Share UTXO not found: ${utxoRef}`)
    }
  }
  if (utxos.length === 0) {
    throw new Error(`No share UTXOs found for share index ${shareIndex}`)
  }
  if (utxos.length > 1 && !utxoRef) {
    const list = utxos.map((u) => `${u.txid}:${u.vout} (${u.satoshis})`).join(', ')
    throw new Error(`Multiple share UTXOs — select one: ${list}`)
  }

  const shareUtxo = utxos[0]
  const wif = wallet.walletInfo.privateKey
  const template = new SignatureTemplate(wif, SIGHASH, SignatureAlgorithm.ECDSA)
  const signerPubHex = binToHex(template.getPublicKey())

  const signerSlot = cfg.nodes.findIndex(
    (n) => n.pubkey.toLowerCase() === signerPubHex.toLowerCase()
  )
  if (signerSlot < 0) {
    throw new Error(
      `Wallet pubkey ${signerPubHex} is not one of config.nodes[].pubkey — wrong key?`
    )
  }

  let payout
  let fee
  let signatureHex

  if (payoutSatoshis != null) {
    payout = BigInt(payoutSatoshis)
    if (payout <= 0n || payout >= shareUtxo.satoshis) {
      throw new Error(`Invalid payoutSatoshis ${payout} for share ${shareUtxo.satoshis}`)
    }
    const { args: claimArgs, captured, restore } = claimArgsCapturing(signerSlot, template)
    try {
      const hex = new TransactionBuilder({ provider })
        .addInput(shareUtxo, share.unlock.claim(...claimArgs))
        .addOutput({ to: payoutAddress, amount: payout })
        .build()
      fee = shareUtxo.satoshis - payout
      const needed = feeFromHex(hex, feeRate)
      if (fee < needed) {
        throw new Error(
          `Payout leaves fee ${fee} but tx needs ~${needed} at feeRate ${feeRate}`
        )
      }
      signatureHex = binToHex(captured.signature)
    } finally {
      restore()
    }
  } else {
    fee = 800n
    payout = shareUtxo.satoshis - fee
    for (let i = 0; i < 5; i++) {
      const { args: claimArgs, captured, restore } = claimArgsCapturing(signerSlot, template)
      try {
        const hex = new TransactionBuilder({ provider })
          .addInput(shareUtxo, share.unlock.claim(...claimArgs))
          .addOutput({ to: payoutAddress, amount: payout })
          .build()
        const needed = feeFromHex(hex, feeRate)
        const nextPayout = shareUtxo.satoshis - needed
        if (nextPayout <= 0n) {
          throw new Error(`Share ${shareUtxo.satoshis} too small to cover fee ${needed}`)
        }
        signatureHex = binToHex(captured.signature)
        fee = needed
        if (nextPayout === payout) break
        payout = nextPayout
      } finally {
        restore()
      }
    }
    {
      const { args: claimArgs, captured, restore } = claimArgsCapturing(signerSlot, template)
      try {
        new TransactionBuilder({ provider })
          .addInput(shareUtxo, share.unlock.claim(...claimArgs))
          .addOutput({ to: payoutAddress, amount: payout })
          .build()
        signatureHex = binToHex(captured.signature)
        fee = shareUtxo.satoshis - payout
      } finally {
        restore()
      }
    }
  }

  if (!signatureHex) {
    throw new Error('Failed to capture ECDSA transaction signature')
  }

  return {
    type: 'psffpp-share-claim-sig',
    version: 1,
    network,
    claim: {
      shareIndex,
      shareName: cfg.nodes[shareIndex].name || `node${shareIndex}`,
      shareAddress: share.address,
      shareUtxo: {
        txid: shareUtxo.txid,
        vout: shareUtxo.vout,
        satoshis: shareUtxo.satoshis.toString()
      },
      payoutAddress,
      payoutSatoshis: payout.toString(),
      feeSatoshis: fee.toString(),
      feeMode: 'from_share',
      sighash: 'ALL|UTXOS',
      signatureAlgorithm: 'ECDSA',
      constructorPubkeys: cfg.nodes.map((n) => n.pubkey.toLowerCase())
    },
    signer: {
      nodeIndex: signerSlot,
      name: cfg.nodes[signerSlot].name || `node${signerSlot}`,
      pubkey: signerPubHex.toLowerCase(),
      cashAddress: wallet.walletInfo.cashAddress
    },
    signature: signatureHex,
    notes: [
      'This signature unlocks ShareContract.claim for the exact claim tx described above.',
      'Do not change payoutSatoshis, fee, or UTXO without re-collecting signatures.',
      'Unused claim slots must be empty bytes (0x), never invalid non-empty sigs.',
      'BitcoinCash.signMessageWithPrivKey message signatures are NOT valid here.'
    ]
  }
}

export function listShareUtxos (cfg, shareIndex) {
  // Convenience for UI preview — async wrapper
  return (async () => {
    const provider = createProvider(cfg.network || 'mainnet')
    const { shares } = instantiateContracts(cfg, provider)
    const utxos = (await shares[shareIndex].getUtxos()).filter((u) => !u.token)
    return {
      address: shares[shareIndex].address,
      utxos: utxos.map((u) => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis.toString(),
        ref: `${u.txid}:${u.vout}`
      }))
    }
  })()
}
