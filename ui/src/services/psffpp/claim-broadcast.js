/**
 * Assemble ≥2 claim-sig JSON envelopes and broadcast ShareContract.claim.
 */
import { TransactionBuilder } from 'cashscript'
import { hexToBin } from '@bitauth/libauth'
import {
  createProvider,
  instantiateContracts
} from './lib'

const EMPTY_SIG = Uint8Array.of()

function claimIdentityKey (claim) {
  return JSON.stringify({
    shareIndex: claim.shareIndex,
    shareAddress: claim.shareAddress,
    shareUtxo: claim.shareUtxo,
    payoutAddress: claim.payoutAddress,
    payoutSatoshis: claim.payoutSatoshis,
    feeSatoshis: claim.feeSatoshis,
    feeMode: claim.feeMode,
    sighash: claim.sighash,
    signatureAlgorithm: claim.signatureAlgorithm,
    constructorPubkeys: claim.constructorPubkeys
  })
}

export function parseClaimSigDoc (textOrObj) {
  const doc = typeof textOrObj === 'string' ? JSON.parse(textOrObj) : textOrObj
  if (doc.type !== 'psffpp-share-claim-sig') {
    throw new Error(`Expected type psffpp-share-claim-sig, got ${doc.type}`)
  }
  if (doc.version !== 1) {
    throw new Error(`Unsupported claim-sig version: ${doc.version}`)
  }
  if (!doc.claim || !doc.signer || !doc.signature) {
    throw new Error('Claim sig missing claim, signer, or signature')
  }
  if (!/^[0-9a-fA-F]+$/.test(doc.signature)) {
    throw new Error('signature must be hex')
  }
  if (!Number.isInteger(doc.signer.nodeIndex) || doc.signer.nodeIndex < 0 || doc.signer.nodeIndex > 2) {
    throw new Error('signer.nodeIndex must be 0, 1, or 2')
  }
  return doc
}

export function validateClaimSigSet (docs) {
  if (!Array.isArray(docs) || docs.length < 2) {
    throw new Error('Need at least 2 claim signatures (K=2)')
  }

  const parsed = docs.map((d) => parseClaimSigDoc(d))
  const key0 = claimIdentityKey(parsed[0].claim)
  for (let i = 1; i < parsed.length; i++) {
    if (claimIdentityKey(parsed[i].claim) !== key0) {
      throw new Error(
        `Claim parameters mismatch between signature files (index 0 vs ${i}). All cosigners must sign the same claim.`
      )
    }
  }

  const slots = new Set()
  for (const doc of parsed) {
    if (slots.has(doc.signer.nodeIndex)) {
      throw new Error(`Duplicate signer.nodeIndex ${doc.signer.nodeIndex}`)
    }
    slots.add(doc.signer.nodeIndex)
  }

  if (slots.size < 2) {
    throw new Error('Need signatures from at least 2 distinct nodes')
  }

  return parsed
}

export async function broadcastClaim ({
  cfg,
  wallet,
  sigDocs,
  dryRun = false
} = {}) {
  if (!cfg) throw new Error('Deploy config required')
  const parsed = validateClaimSigSet(sigDocs)
  const claim = parsed[0].claim

  if (claim.shareIndex < 0 || claim.shareIndex > 2) {
    throw new Error('Invalid claim.shareIndex')
  }

  // Ensure wallet pubkey set matches claim constructor pubs when config is loaded.
  for (let i = 0; i < 3; i++) {
    if (cfg.nodes[i].pubkey.toLowerCase() !== claim.constructorPubkeys[i].toLowerCase()) {
      throw new Error(
        `Config nodes[${i}].pubkey does not match claim.constructorPubkeys[${i}]`
      )
    }
  }

  const network = cfg.network || 'mainnet'
  const provider = createProvider(network)
  const { shares } = instantiateContracts(cfg, provider)
  const share = shares[claim.shareIndex]

  if (share.address !== claim.shareAddress) {
    throw new Error(
      `Derived share address ${share.address} !== claim.shareAddress ${claim.shareAddress}`
    )
  }

  const shareUtxo = {
    txid: claim.shareUtxo.txid,
    vout: claim.shareUtxo.vout,
    satoshis: BigInt(claim.shareUtxo.satoshis)
  }
  const payout = BigInt(claim.payoutSatoshis)

  const sigArgs = [EMPTY_SIG, EMPTY_SIG, EMPTY_SIG]
  for (const doc of parsed) {
    sigArgs[doc.signer.nodeIndex] = hexToBin(doc.signature)
  }

  const builder = new TransactionBuilder({ provider })
    .addInput(shareUtxo, share.unlock.claim(...sigArgs))
    .addOutput({ to: claim.payoutAddress, amount: payout })

  const hex = builder.build()
  const summary = {
    shareIndex: claim.shareIndex,
    shareAddress: claim.shareAddress,
    payoutAddress: claim.payoutAddress,
    payoutSatoshis: claim.payoutSatoshis,
    feeSatoshis: claim.feeSatoshis,
    signerSlots: parsed.map((d) => d.signer.nodeIndex),
    dryRun,
    hex
  }

  if (dryRun) return summary

  if (!wallet) throw new Error('Wallet required to broadcast')
  const txid = await wallet.broadcast({ hex })
  return { ...summary, txid }
}
