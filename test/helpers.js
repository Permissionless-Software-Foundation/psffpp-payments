import {
  Contract,
  HashType,
  MockNetworkProvider,
  SignatureAlgorithm,
  SignatureTemplate
} from 'cashscript'
import {
  generatePrivateKey,
  hash160,
  hexToBin,
  privateKeyToP2pkhCashAddress
} from '@bitauth/libauth'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const EMPTY_SIG = Uint8Array.of()
export const SIGHASH = HashType.SIGHASH_ALL | HashType.SIGHASH_UTXOS

export function loadArtifact (name) {
  return JSON.parse(readFileSync(join(root, 'artifacts', `${name}.json`), 'utf8'))
}

export function ecdsaTemplate (privateKey) {
  return new SignatureTemplate(privateKey, SIGHASH, SignatureAlgorithm.ECDSA)
}

export function makeOperator (label = 'node') {
  const priv = generatePrivateKey(() => crypto.getRandomValues(new Uint8Array(32)))
  const tmpl = ecdsaTemplate(priv)
  const pub = tmpl.getPublicKey()
  const pkh = hash160(pub)
  const addr = privateKeyToP2pkhCashAddress({
    privateKey: priv,
    prefix: 'bchtest',
    throwErrors: true
  }).address
  return { label, priv, tmpl, pub, pkh, addr }
}

export function makeTreasury () {
  return makeOperator('treasury')
}

export function makeProvider () {
  return new MockNetworkProvider()
}

export function createShares (provider, nodes) {
  const artifact = loadArtifact('ShareContract')
  return nodes.map((node) =>
    new Contract(
      artifact,
      [nodes[0].pub, nodes[1].pub, nodes[2].pub, node.pkh],
      { provider }
    )
  )
}

export function createPool (provider, {
  nodes,
  treasuryPkh,
  shareContracts,
  minConsolidation = 100_000n,
  splitBlockheight = 1000n
}) {
  const artifact = loadArtifact('PoolContract')
  return new Contract(
    artifact,
    [
      nodes[0].pub,
      nodes[1].pub,
      nodes[2].pub,
      treasuryPkh,
      hexToBin(shareContracts[0].lockingBytecode),
      hexToBin(shareContracts[1].lockingBytecode),
      hexToBin(shareContracts[2].lockingBytecode),
      minConsolidation,
      splitBlockheight
    ],
    { provider }
  )
}

export function claimArgs (nodes, signers) {
  return nodes.map((node) => (signers.includes(node) ? node.tmpl : EMPTY_SIG))
}

export { hexToBin }
