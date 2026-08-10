#!/usr/bin/env node
/**
 * Cosign a ShareContract claim and write a JSON file another node can use to broadcast.
 *
 * IMPORTANT: ShareContract.claim uses CashScript checkSig over the *claim transaction*.
 * bch-js BitcoinCash.signMessageWithPrivKey() signs "Bitcoin Signed Message:\\n…" and
 * CANNOT unlock the share. This script produces real tx ECDSA signatures via CashScript
 * SignatureTemplate (SIGHASH_ALL | SIGHASH_UTXOS), loaded from a WIF/mnemonic through
 * minimal-slp-wallet (bch-js inside).
 *
 * Fee is taken from the share UTXO (single payout output; no companion fee input).
 *
 * Usage:
 *   node scripts/claim-cosign.mjs --wif <WIF> --share-index 0 [--out claim-sig.json]
 *   node scripts/claim-cosign.mjs --mnemonic "..." --share-index 1 --utxo <txid>:<vout>
 *
 * Docs: https://www.npmjs.com/package/minimal-slp-wallet
 *       https://bch-js.fullstackcash.net
 *       https://cashscript.org/docs/sdk/signature-templates
 */
import BchWallet from 'minimal-slp-wallet'
import {
  TransactionBuilder,
  SignatureTemplate,
  HashType,
  SignatureAlgorithm
} from 'cashscript'
import { binToHex, encodeCashAddress, hexToBin } from '@bitauth/libauth'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  loadDeployConfig,
  createProvider,
  instantiateContracts,
  root
} from './lib.mjs'

const DEFAULT_REST = 'https://free-bch.fullstack.cash'
const DEFAULT_FEE_RATE = 1.2
const SIGHASH = HashType.SIGHASH_ALL | HashType.SIGHASH_UTXOS
const EMPTY_SIG = Uint8Array.of()

function parseArgs (argv) {
  const args = {
    configPath: join(root, 'config', 'deploy.mainnet.json'),
    shareIndex: null,
    utxo: null,
    out: null,
    dryRun: false,
    feeRate: DEFAULT_FEE_RATE,
    restURL: DEFAULT_REST,
    wif: null,
    mnemonic: null,
    payoutSatoshis: null
  }

  const positionals = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--fee-rate') args.feeRate = Number(argv[++i])
    else if (a === '--rest-url') args.restURL = argv[++i]
    else if (a === '--wif') args.wif = argv[++i]
    else if (a === '--mnemonic') args.mnemonic = argv[++i]
    else if (a === '--share-index') args.shareIndex = Number(argv[++i])
    else if (a === '--utxo') args.utxo = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--payout-satoshis') args.payoutSatoshis = BigInt(argv[++i])
    else if (a.startsWith('-')) throw new Error(`Unknown flag: ${a}`)
    else positionals.push(a)
  }

  if (positionals[0]) args.configPath = positionals[0]
  if (!Number.isFinite(args.feeRate) || args.feeRate <= 0) {
    throw new Error('--fee-rate must be a positive number')
  }
  if (!args.wif && !args.mnemonic) {
    throw new Error('Provide cosigner key via --wif <WIF> or --mnemonic "..."')
  }
  if (args.wif && args.mnemonic) {
    throw new Error('Pass only one of --wif or --mnemonic')
  }
  if (!Number.isInteger(args.shareIndex) || args.shareIndex < 0 || args.shareIndex > 2) {
    throw new Error('--share-index must be 0, 1, or 2 (which node share is being claimed)')
  }
  return args
}

function pkhToCashAddr (pkhHex, network) {
  const prefix = network === 'mainnet' || !network ? 'bitcoincash' : 'bchtest'
  return encodeCashAddress({
    prefix,
    type: 'p2pkh',
    payload: hexToBin(pkhHex),
    throwErrors: true
  }).address
}

function parseUtxoRef (ref) {
  const [txid, voutStr] = ref.split(':')
  const vout = Number(voutStr)
  if (!txid || !Number.isInteger(vout) || vout < 0) {
    throw new Error(`--utxo must be <txid>:<vout>, got ${ref}`)
  }
  return { txid, vout }
}

function feeFromHex (hex, feeRate) {
  const bytes = hex.length / 2
  const atRate = BigInt(Math.ceil(bytes * feeRate))
  const minOne = BigInt(Math.ceil(bytes))
  return atRate > minOne ? atRate : minOne
}

async function createWallet ({ wif, mnemonic, restURL }) {
  const wallet = new BchWallet(wif || mnemonic, {
    interface: 'consumer-api',
    restURL
  })
  await wallet.walletInfoPromise
  return wallet
}

/**
 * Build claim args: SignatureTemplate in signerSlot, empty elsewhere.
 * Capture the tx ECDSA signature bytes when CashScript generates them.
 */
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

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const cfg = loadDeployConfig(args.configPath)
  const network = cfg.network || 'mainnet'
  const provider = createProvider(network)
  const { shares } = instantiateContracts(cfg, provider)

  const share = shares[args.shareIndex]
  const payoutPkh = cfg.nodes[args.shareIndex].pkh
  const payoutAddress = pkhToCashAddr(payoutPkh, network)

  let utxos = (await share.getUtxos()).filter((u) => !u.token)
  if (args.utxo) {
    const ref = parseUtxoRef(args.utxo)
    utxos = utxos.filter((u) => u.txid === ref.txid && u.vout === ref.vout)
    if (utxos.length === 0) {
      throw new Error(`Share UTXO not found: ${args.utxo}`)
    }
  }
  if (utxos.length === 0) {
    console.error(JSON.stringify({
      ok: false,
      error: 'No share UTXOs found',
      shareIndex: args.shareIndex,
      shareAddress: share.address
    }, null, 2))
    process.exit(1)
  }
  if (utxos.length > 1 && !args.utxo) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Multiple share UTXOs — pass --utxo <txid>:<vout>',
      shareAddress: share.address,
      utxos: utxos.map((u) => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis.toString()
      }))
    }, null, 2))
    process.exit(1)
  }

  const shareUtxo = utxos[0]
  const wallet = await createWallet(args)
  const wif = wallet.walletInfo.privateKey
  const template = new SignatureTemplate(wif, SIGHASH, SignatureAlgorithm.ECDSA)
  const signerPubHex = binToHex(template.getPublicKey())

  const signerSlot = cfg.nodes.findIndex(
    (n) => n.pubkey.toLowerCase() === signerPubHex.toLowerCase()
  )
  if (signerSlot < 0) {
    throw new Error(
      `Cosigner pubkey ${signerPubHex} is not one of config.nodes[].pubkey — wrong key?`
    )
  }

  // Fee from share: settle payout so miner fee meets feeRate / ≥1 sat-byte.
  let payout
  let fee
  let signatureHex

  if (args.payoutSatoshis != null) {
    payout = args.payoutSatoshis
    if (payout <= 0n || payout >= shareUtxo.satoshis) {
      throw new Error(`Invalid --payout-satoshis ${payout} for share ${shareUtxo.satoshis}`)
    }
    const { args: claimArgs, captured, restore } = claimArgsCapturing(signerSlot, template)
    try {
      const hex = new TransactionBuilder({ provider })
        .addInput(shareUtxo, share.unlock.claim(...claimArgs))
        .addOutput({ to: payoutAddress, amount: payout })
        .build()
      fee = shareUtxo.satoshis - payout
      const needed = feeFromHex(hex, args.feeRate)
      if (fee < needed) {
        throw new Error(
          `Payout leaves fee ${fee} but tx needs ~${needed} at feeRate ${args.feeRate}`
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
        const needed = feeFromHex(hex, args.feeRate)
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
    // Final capture at settled payout
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

  const doc = {
    type: 'psffpp-share-claim-sig',
    version: 1,
    network,
    claim: {
      shareIndex: args.shareIndex,
      shareName: cfg.nodes[args.shareIndex].name || `node${args.shareIndex}`,
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

  const outPath = resolve(
    args.out ||
      join(root, 'deployments', `claim-sig-share${args.shareIndex}-by-node${signerSlot}.json`)
  )

  if (!args.dryRun) {
    writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n')
  }

  console.log(JSON.stringify({
    wrote: args.dryRun ? null : outPath,
    dryRun: args.dryRun,
    shareIndex: args.shareIndex,
    signerNodeIndex: signerSlot,
    payoutAddress,
    payoutSatoshis: payout.toString(),
    feeSatoshis: fee.toString(),
    signature: signatureHex
  }, null, 2))

  if (args.dryRun) {
    console.log(JSON.stringify(doc, null, 2))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
