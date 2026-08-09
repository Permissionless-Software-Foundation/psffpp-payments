import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hexToBin, binToHex } from '@bitauth/libauth'
import { Contract, ElectrumNetworkProvider, MockNetworkProvider } from 'cashscript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export function loadArtifact (name) {
  return JSON.parse(readFileSync(join(root, 'artifacts', `${name}.json`), 'utf8'))
}

export function artifactFingerprint (artifact) {
  return createHash('sha256')
    .update(JSON.stringify({ bytecode: artifact.bytecode, abi: artifact.abi, constructorInputs: artifact.constructorInputs }))
    .digest('hex')
}

export function loadDeployConfig (configPath) {
  const path = resolve(configPath)
  if (!existsSync(path)) {
    throw new Error(`Config not found: ${path}. Copy config/deploy.mainnet.example.json to config/deploy.mainnet.json and fill real values.`)
  }
  const cfg = JSON.parse(readFileSync(path, 'utf8'))
  validateConfig(cfg)
  return cfg
}

function validateConfig (cfg) {
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
}

export function createProvider (network) {
  if (network === 'mocknet') return new MockNetworkProvider()
  return new ElectrumNetworkProvider(network || 'mainnet')
}

export function instantiateContracts (cfg, provider) {
  const shareArtifact = loadArtifact('ShareContract')
  const poolArtifact = loadArtifact('PoolContract')

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

  return {
    shares,
    pool,
    fingerprints: {
      ShareContract: artifactFingerprint(shareArtifact),
      PoolContract: artifactFingerprint(poolArtifact)
    }
  }
}

export function buildDeploymentRecord (cfg, { shares, pool, fingerprints }) {
  return {
    network: cfg.network || 'mainnet',
    createdAt: new Date().toISOString(),
    minConsolidation: cfg.minConsolidation,
    splitBlockheight: cfg.splitBlockheight,
    treasuryPkh: cfg.treasuryPkh.toLowerCase(),
    nodes: cfg.nodes.map((n, i) => ({
      name: n.name || `node${i}`,
      pubkey: n.pubkey.toLowerCase(),
      pkh: n.pkh.toLowerCase(),
      shareAddress: shares[i].address,
      shareLockingBytecode: shares[i].lockingBytecode
    })),
    poolAddress: pool.address,
    poolLockingBytecode: pool.lockingBytecode,
    artifacts: fingerprints,
    constructorNotes: {
      M: 3,
      K: 2,
      deployOrder: 'ShareContracts first, then PoolContract baking share locking bytecodes',
      epochModel: 'One splitBlockheight per deploy; next month redeploy + K-of-M migrate'
    }
  }
}

export { root, binToHex, hexToBin }
