/**
 * Browser-safe helpers for PSFFPP Pool/Share contracts.
 * Ported from scripts/lib.mjs (no Node fs/crypto).
 */
import { hexToBin } from '@bitauth/libauth'
import { Contract, ElectrumNetworkProvider } from 'cashscript'
import shareArtifact from '../../contracts/artifacts/ShareContract.json'
import poolArtifact from '../../contracts/artifacts/PoolContract.json'

export const DEFAULT_FEE_RATE = 1.2
export const DEFAULT_MAX_UTXOS = 50

export function validateConfig (cfg) {
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('Config must be a JSON object')
  }
  if (!cfg.nodes || cfg.nodes.length !== 3) {
    throw new Error('config.nodes must contain exactly 3 entries (M=3)')
  }
  for (const [i, node] of cfg.nodes.entries()) {
    if (!/^[0-9a-fA-F]{66}$/.test(node.pubkey)) {
      throw new Error(`nodes[${i}].pubkey must be 33-byte compressed hex (66 chars)`)
    }
    if (!/^[0-9a-fA-F]{40}$/.test(node.pkh)) {
      throw new Error(`nodes[${i}].pkh must be 20-byte hex (40 chars)`)
    }
  }
  if (!/^[0-9a-fA-F]{40}$/.test(cfg.treasuryPkh)) {
    throw new Error('treasuryPkh must be 20-byte hex (40 chars)')
  }
  if (!Number.isInteger(cfg.minConsolidation) || cfg.minConsolidation < 1) {
    throw new Error('minConsolidation must be a positive integer')
  }
  if (!Number.isInteger(cfg.splitBlockheight) || cfg.splitBlockheight < 1) {
    throw new Error('splitBlockheight must be a positive integer (block height)')
  }
  return cfg
}

export function parseDeployConfigJson (text) {
  let cfg
  try {
    cfg = JSON.parse(text)
  } catch (err) {
    throw new Error(`Invalid JSON: ${err.message}`)
  }
  return validateConfig(cfg)
}

export function createProvider (network) {
  return new ElectrumNetworkProvider(network || 'mainnet')
}

export function instantiateContracts (cfg, provider) {
  const pubs = cfg.nodes.map((n) => hexToBin(n.pubkey))
  const shares = cfg.nodes.map((node) =>
    new Contract(
      shareArtifact,
      [...pubs, hexToBin(node.pkh)],
      { provider }
    )
  )

  const pool = new Contract(
    poolArtifact,
    [
      ...pubs,
      hexToBin(cfg.treasuryPkh),
      hexToBin(shares[0].lockingBytecode),
      hexToBin(shares[1].lockingBytecode),
      hexToBin(shares[2].lockingBytecode),
      BigInt(cfg.minConsolidation),
      BigInt(cfg.splitBlockheight)
    ],
    { provider }
  )

  return { shares, pool }
}

export function feeFromHex (hex, feeRate) {
  const bytes = hex.length / 2
  const atRate = BigInt(Math.ceil(bytes * feeRate))
  const minOne = BigInt(Math.ceil(bytes))
  return atRate > minOne ? atRate : minOne
}

export function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function summarizeUtxo (u) {
  return {
    txid: u.txid,
    vout: u.vout,
    satoshis: u.satoshis.toString()
  }
}
