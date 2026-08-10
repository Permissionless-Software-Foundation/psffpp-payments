#!/usr/bin/env node
/**
 * Merge PoolContract UTXOs into one self-replicating pool output.
 * Permissionless — no operator signatures. Miner fee is deducted from the pool.
 *
 * - CashScript ElectrumNetworkProvider: pool UTXO lookup (P2SH32-safe) + unlock scripts
 * - minimal-slp-wallet: broadcast via consumer-api (embedded bch-js at wallet.bchjs)
 *
 * Note: wallet.getUtxos() rejects P2SH32 cashaddrs on consumer-api, so pool UTXOs
 * are fetched via CashScript, not the wallet REST adapter.
 *
 * Usage:
 *   node scripts/consolidate.mjs [config/deploy.mainnet.json] [--dry-run] [--fee-rate 1.2] [--max-utxos 50]
 *
 * Docs: https://www.npmjs.com/package/minimal-slp-wallet
 *       https://bch-js.fullstackcash.net
 */
import BchWallet from 'minimal-slp-wallet'
import { TransactionBuilder } from 'cashscript'
import { join } from 'node:path'
import {
  loadDeployConfig,
  createProvider,
  instantiateContracts,
  root
} from './lib.mjs'

const DEFAULT_REST = 'https://free-bch.fullstack.cash'
const DEFAULT_FEE_RATE = 1.2
const DEFAULT_MAX_UTXOS = 50

function parseArgs (argv) {
  const args = {
    configPath: join(root, 'config', 'deploy.mainnet.json'),
    dryRun: false,
    feeRate: DEFAULT_FEE_RATE,
    maxUtxos: DEFAULT_MAX_UTXOS,
    restURL: DEFAULT_REST
  }

  const positionals = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') {
      args.dryRun = true
    } else if (a === '--fee-rate') {
      args.feeRate = Number(argv[++i])
    } else if (a === '--max-utxos') {
      args.maxUtxos = Number(argv[++i])
    } else if (a === '--rest-url') {
      args.restURL = argv[++i]
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
  if (!Number.isInteger(args.maxUtxos) || args.maxUtxos < 2) {
    throw new Error('--max-utxos must be an integer >= 2')
  }
  return args
}

async function createInfraWallet (restURL) {
  // Ephemeral wallet — consolidate is permissionless; keys are unused.
  // Used for broadcast (and wallet.bchjs when lower-level helpers are needed).
  const wallet = new BchWallet(undefined, {
    interface: 'consumer-api',
    restURL
  })
  await wallet.walletInfoPromise
  return wallet
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const cfg = loadDeployConfig(args.configPath)
  const provider = createProvider(cfg.network || 'mainnet')
  const { pool } = instantiateContracts(cfg, provider)

  const wallet = await createInfraWallet(args.restURL)

  // P2SH32: use CashScript Electrum (consumer-api getUtxos rejects p-prefix cashaddrs).
  let utxos = await pool.getUtxos()
  // Pure BCH only (drop any unexpected token UTXOs).
  utxos = utxos.filter((u) => !u.token)

  if (utxos.length < 2) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Need at least 2 pool UTXOs to consolidate',
      poolAddress: pool.address,
      utxoCount: utxos.length,
      utxos: utxos.map((u) => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis.toString()
      }))
    }, null, 2))
    process.exit(1)
  }

  if (utxos.length > args.maxUtxos) {
    console.warn(`Truncating from ${utxos.length} to ${args.maxUtxos} UTXOs (--max-utxos)`)
    utxos = utxos.slice(0, args.maxUtxos)
  }

  const inSum = utxos.reduce((s, u) => s + u.satoshis, 0n)
  const minConsolidation = BigInt(cfg.minConsolidation)

  const builder = new TransactionBuilder({ provider })
  for (const u of utxos) {
    builder.addInput(u, pool.unlock.consolidate())
  }
  // Single self-replicating pool output; fee = inSum - out (deducted from pool).
  builder.addBchChangeOutputIfNeeded({ to: pool.address, feeRate: args.feeRate })

  if (builder.outputs.length !== 1) {
    console.error(JSON.stringify({
      ok: false,
      error: `Expected exactly 1 pool output, got ${builder.outputs.length}`,
      hint: 'Surplus may be below dust after fee — add more BCH to the pool'
    }, null, 2))
    process.exit(1)
  }

  const outAmount = builder.outputs[0].amount
  if (outAmount < minConsolidation) {
    console.error(JSON.stringify({
      ok: false,
      error: `Consolidated output ${outAmount} would be below minConsolidation ${minConsolidation}`,
      inSum: inSum.toString(),
      hint: 'Add more BCH to the pool, or lower --fee-rate'
    }, null, 2))
    process.exit(1)
  }

  const fee = inSum - outAmount
  const hex = builder.build()

  const summary = {
    poolAddress: pool.address,
    inputCount: utxos.length,
    inSum: inSum.toString(),
    fee: fee.toString(),
    feeRate: args.feeRate,
    outAmount: outAmount.toString(),
    minConsolidation: minConsolidation.toString(),
    dryRun: args.dryRun,
    inputs: utxos.map((u) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis.toString() }))
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
