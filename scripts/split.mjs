#!/usr/bin/env node
/**
 * Split one PoolContract UTXO into treasury (20%) + three ShareContracts (80%/3).
 * Permissionless after splitBlockheight. Miner fee comes from a companion P2PKH input
 * (this covenant requires the four outputs to sum to 100% of the pool UTXO, so the
 * fee cannot be taken from the pool without a contract change).
 *
 * - CashScript ElectrumNetworkProvider: pool UTXOs (P2SH32-safe) + unlock + locktime
 * - minimal-slp-wallet: fee-payer UTXOs + broadcast (embedded bch-js at wallet.bchjs)
 *
 * Usage:
 *   node scripts/split.mjs --wif <WIF> [config/deploy.mainnet.json] [--dry-run] [--fee-rate 1.2]
 *   node scripts/split.mjs --mnemonic "twelve words ..." [config/deploy.mainnet.json] [--dry-run]
 *
 * Docs: https://www.npmjs.com/package/minimal-slp-wallet
 *       https://bch-js.fullstackcash.net
 */
import BchWallet from 'minimal-slp-wallet'
import {
  TransactionBuilder,
  SignatureTemplate,
  HashType,
  SignatureAlgorithm
} from 'cashscript'
import { encodeCashAddress, hexToBin } from '@bitauth/libauth'
import { join } from 'node:path'
import {
  loadDeployConfig,
  createProvider,
  instantiateContracts,
  root
} from './lib.mjs'

const DEFAULT_REST = 'https://free-bch.fullstack.cash'
const DEFAULT_FEE_RATE = 1.2
const SIGHASH = HashType.SIGHASH_ALL | HashType.SIGHASH_UTXOS

function parseArgs (argv) {
  const args = {
    configPath: join(root, 'config', 'deploy.mainnet.json'),
    dryRun: false,
    feeRate: DEFAULT_FEE_RATE,
    restURL: DEFAULT_REST,
    wif: null,
    mnemonic: null
  }

  const positionals = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') {
      args.dryRun = true
    } else if (a === '--fee-rate') {
      args.feeRate = Number(argv[++i])
    } else if (a === '--rest-url') {
      args.restURL = argv[++i]
    } else if (a === '--wif') {
      args.wif = argv[++i]
    } else if (a === '--mnemonic') {
      args.mnemonic = argv[++i]
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown flag: ${a}`)
    } else {
      positionals.push(a)
    }
  }

  if (positionals[0]) args.configPath = positionals[0]
  if (!Number.isFinite(args.feeRate) || args.feeRate <= 0) {
    throw new Error('--fee-rate must be a positive number')
  }
  if (!args.wif && !args.mnemonic) {
    throw new Error('Provide fee-payer key via --wif <WIF> or --mnemonic "..."')
  }
  if (args.wif && args.mnemonic) {
    throw new Error('Pass only one of --wif or --mnemonic')
  }
  return args
}

function apportion (poolValue) {
  const treasuryBase = (poolValue * 20n) / 100n
  const remaining = poolValue - treasuryBase
  const share = remaining / 3n
  const remainder = remaining - share * 3n
  return {
    treasuryValue: treasuryBase + remainder,
    share
  }
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

/** Map wallet bchUtxos into CashScript { txid, vout, satoshis }. */
function toCashScriptUtxos (walletUtxoPayload) {
  const list = walletUtxoPayload?.bchUtxos || []
  return list.map((u, i) => {
    const txid = u.txid || u.tx_hash
    const vout = u.vout ?? u.tx_pos
    const satoshis = BigInt(u.satoshis ?? u.value ?? 0)
    if (!txid || vout === undefined || satoshis <= 0n) {
      throw new Error(`Malformed fee UTXO at index ${i}: ${JSON.stringify(u)}`)
    }
    return { txid, vout, satoshis }
  })
}

function pickFeeUtxo (utxos, minFee) {
  const sorted = [...utxos].sort((a, b) => Number(a.satoshis - b.satoshis))
  const fit = sorted.find((u) => u.satoshis >= minFee)
  if (!fit) {
    const have = utxos.reduce((s, u) => s + u.satoshis, 0n)
    throw new Error(
      `Fee wallet has no UTXO >= estimated fee ${minFee} sats (total BCH UTXOs: ${have})`
    )
  }
  return fit
}

async function createFeeWallet ({ wif, mnemonic, restURL }) {
  const seed = wif || mnemonic
  const wallet = new BchWallet(seed, {
    interface: 'consumer-api',
    restURL
  })
  await wallet.initialize()
  return wallet
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const cfg = loadDeployConfig(args.configPath)
  const network = cfg.network || 'mainnet'
  const provider = createProvider(network)
  const { pool, shares } = instantiateContracts(cfg, provider)

  const height = await provider.getBlockHeight()
  if (height < cfg.splitBlockheight) {
    console.error(JSON.stringify({
      ok: false,
      error: 'splitBlockheight gate not met yet',
      height,
      splitBlockheight: cfg.splitBlockheight
    }, null, 2))
    process.exit(1)
  }

  let poolUtxos = (await pool.getUtxos()).filter((u) => !u.token)
  if (poolUtxos.length === 0) {
    console.error(JSON.stringify({
      ok: false,
      error: 'No pool UTXOs found',
      poolAddress: pool.address
    }, null, 2))
    process.exit(1)
  }
  if (poolUtxos.length > 1) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Pool has multiple UTXOs — run consolidate first (split uses exactly one pool input)',
      poolAddress: pool.address,
      utxoCount: poolUtxos.length,
      hint: 'npm run consolidate'
    }, null, 2))
    process.exit(1)
  }

  const poolUtxo = poolUtxos[0]
  const poolValue = poolUtxo.satoshis
  const { treasuryValue, share } = apportion(poolValue)
  const treasuryAddr = pkhToCashAddr(cfg.treasuryPkh, network)

  const wallet = await createFeeWallet(args)
  const feePayload = await wallet.getUtxos()
  const feeUtxos = toCashScriptUtxos(feePayload)
  if (feeUtxos.length === 0) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Fee wallet has no BCH UTXOs',
      feeAddress: wallet.walletInfo.cashAddress
    }, null, 2))
    process.exit(1)
  }

  const wif = wallet.walletInfo.privateKey
  const feeTmpl = new SignatureTemplate(wif, SIGHASH, SignatureAlgorithm.ECDSA)

  // Rough fee estimate, then refine after picking a concrete fee UTXO.
  // Covenant forbids a 5th change output: entire fee UTXO is consumed as miner fee.
  let estimatedFee = 2000n
  let feeUtxo = pickFeeUtxo(feeUtxos, estimatedFee)

  const build = (feeIn) => {
    return new TransactionBuilder({ provider })
      .addInput(poolUtxo, pool.unlock.split())
      .addInput(feeIn, feeTmpl.unlockP2PKH())
      .addOutput({ to: treasuryAddr, amount: treasuryValue })
      .addOutput({ to: shares[0].address, amount: share })
      .addOutput({ to: shares[1].address, amount: share })
      .addOutput({ to: shares[2].address, amount: share })
      .setLocktime(cfg.splitBlockheight)
  }

  let builder = build(feeUtxo)
  let hex = builder.build()
  estimatedFee = BigInt(Math.ceil((hex.length / 2) * args.feeRate))
  // CashScript also enforces >= 1 sat/byte
  if (estimatedFee < BigInt(Math.ceil(hex.length / 2))) {
    estimatedFee = BigInt(Math.ceil(hex.length / 2))
  }

  if (feeUtxo.satoshis < estimatedFee) {
    feeUtxo = pickFeeUtxo(feeUtxos, estimatedFee)
    builder = build(feeUtxo)
    hex = builder.build()
    estimatedFee = BigInt(Math.ceil((hex.length / 2) * args.feeRate))
  }

  if (feeUtxo.satoshis < estimatedFee) {
    console.error(JSON.stringify({
      ok: false,
      error: `Selected fee UTXO ${feeUtxo.satoshis} < required ~${estimatedFee}`,
      feeAddress: wallet.walletInfo.cashAddress
    }, null, 2))
    process.exit(1)
  }

  // Actual miner fee = feeUtxo (no change allowed under 4-output covenant).
  const minerFee = feeUtxo.satoshis

  const summary = {
    poolAddress: pool.address,
    splitBlockheight: cfg.splitBlockheight,
    chainHeight: height,
    poolValue: poolValue.toString(),
    treasuryAddr,
    treasuryValue: treasuryValue.toString(),
    share: share.toString(),
    shareAddresses: shares.map((s) => s.address),
    feeAddress: wallet.walletInfo.cashAddress,
    feeUtxo: {
      txid: feeUtxo.txid,
      vout: feeUtxo.vout,
      satoshis: feeUtxo.satoshis.toString()
    },
    minerFee: minerFee.toString(),
    estimatedFeeAtRate: estimatedFee.toString(),
    feeRate: args.feeRate,
    note: 'Fee UTXO is fully consumed (no change output — covenant requires exactly 4 outputs). Excess over estimatedFee is an extra tip.',
    dryRun: args.dryRun
  }

  if (args.dryRun) {
    console.log(JSON.stringify({ ...summary, hex }, null, 2))
    return
  }

  const txid = await wallet.broadcast({ hex })
  console.log(JSON.stringify({ ...summary, txid }, null, 2))
  console.log(`https://bch.loping.net/tx/${txid}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
