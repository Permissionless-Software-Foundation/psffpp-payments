#!/usr/bin/env node
/**
 * Split one PoolContract UTXO into treasury (20%) + three ShareContracts (80%/3).
 * Permissionless after splitBlockheight.
 *
 * Miner fee comes from a companion P2PKH input. The covenant requires exactly four
 * outputs (no change), so a large wallet UTXO must never be spent as the fee input.
 * This script estimates the split fee, then — if no suitably small UTXO exists —
 * carves one with wallet.send() (self-send) before building the split.
 *
 * - CashScript ElectrumNetworkProvider: pool UTXOs (P2SH32-safe) + unlock + locktime
 * - minimal-slp-wallet: carve fee UTXO + broadcast (embedded bch-js at wallet.bchjs)
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

/** Extra sats carved above fee estimate so size refine / min 1 sat/byte still fits. */
const FEE_CARVE_BUFFER = 300n
/** Reuse an existing UTXO only if tip (utxo - estimatedFee) stays within this. */
const MAX_REUSE_TIP = 500n
/** Wait after carve broadcast before re-fetching UTXOs. */
const CARVE_CONFIRM_MS = 4000

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

function feeFromHex (hex, feeRate) {
  const bytes = hex.length / 2
  const atRate = BigInt(Math.ceil(bytes * feeRate))
  const minOne = BigInt(Math.ceil(bytes)) // CashScript enforces >= 1 sat/byte
  return atRate > minOne ? atRate : minOne
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Prefer the smallest existing UTXO that covers the fee without a large tip.
 * Otherwise carve a dedicated self-send UTXO of size estimatedFee + buffer.
 */
async function ensureSmallFeeUtxo ({
  wallet,
  estimatedFee,
  dryRun
}) {
  const targetCarve = estimatedFee + FEE_CARVE_BUFFER
  const maxReuse = estimatedFee + MAX_REUSE_TIP

  const load = async () => toCashScriptUtxos(await wallet.getUtxos())
  let utxos = await load()
  if (utxos.length === 0) {
    throw new Error(`Fee wallet has no BCH UTXOs (${wallet.walletInfo.cashAddress})`)
  }

  const reusable = utxos
    .filter((u) => u.satoshis >= estimatedFee && u.satoshis <= maxReuse)
    .sort((a, b) => Number(a.satoshis - b.satoshis))

  if (reusable.length > 0) {
    return {
      feeUtxo: reusable[0],
      carved: false,
      carveTxid: null,
      carveAmount: null
    }
  }

  if (dryRun) {
    return {
      feeUtxo: {
        txid: '0'.repeat(64),
        vout: 0,
        satoshis: targetCarve,
        placeholder: true
      },
      carved: 'would_carve',
      carveTxid: null,
      carveAmount: targetCarve
    }
  }

  const amountSat = Number(targetCarve)
  if (!Number.isSafeInteger(amountSat) || amountSat < 546) {
    throw new Error(`Invalid carve amount: ${targetCarve}`)
  }

  console.error(JSON.stringify({
    action: 'carve_fee_utxo',
    to: wallet.walletInfo.cashAddress,
    amountSat,
    reason: `No fee UTXO in [${estimatedFee}, ${maxReuse}] sats; carving dedicated UTXO`
  }))

  const carveTxid = await wallet.send([{
    address: wallet.walletInfo.cashAddress,
    amountSat
  }])

  // Refresh UTXO set until the carved output appears (indexer lag).
  let carved = null
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(CARVE_CONFIRM_MS)
    await wallet.initialize()
    utxos = await load()
    carved = utxos.find(
      (u) => u.txid === carveTxid && u.satoshis === BigInt(amountSat)
    )
    if (carved) break
  }

  if (!carved) {
    utxos = await load()
    carved = utxos.find((u) => u.satoshis === BigInt(amountSat))
  }

  if (!carved) {
    throw new Error(
      `Carved fee UTXO not found after send (txid ${carveTxid}, amount ${amountSat}). Retry shortly.`
    )
  }

  return {
    feeUtxo: carved,
    carved: true,
    carveTxid,
    carveAmount: targetCarve
  }
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

  const poolUtxos = (await pool.getUtxos()).filter((u) => !u.token)
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
  const probeUtxos = toCashScriptUtxos(await wallet.getUtxos())
  if (probeUtxos.length === 0) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Fee wallet has no BCH UTXOs',
      feeAddress: wallet.walletInfo.cashAddress
    }, null, 2))
    process.exit(1)
  }

  const wif = wallet.walletInfo.privateKey
  const feeTmpl = new SignatureTemplate(wif, SIGHASH, SignatureAlgorithm.ECDSA)

  const build = (feeIn) => new TransactionBuilder({ provider })
    .addInput(poolUtxo, pool.unlock.split())
    .addInput(feeIn, feeTmpl.unlockP2PKH())
    .addOutput({ to: treasuryAddr, amount: treasuryValue })
    .addOutput({ to: shares[0].address, amount: share })
    .addOutput({ to: shares[1].address, amount: share })
    .addOutput({ to: shares[2].address, amount: share })
    .setLocktime(cfg.splitBlockheight)

  // Size estimate: P2PKH unlock size is independent of UTXO value — use any UTXO as probe.
  const probeHex = build(probeUtxos[0]).build()
  let estimatedFee = feeFromHex(probeHex, args.feeRate)

  const ensured = await ensureSmallFeeUtxo({
    wallet,
    estimatedFee,
    dryRun: args.dryRun
  })
  let feeUtxo = ensured.feeUtxo

  let hex
  if (feeUtxo.placeholder) {
    // Dry-run with planned carve size — build still needs a real unlockable input for a valid hex;
    // report plan without a spendable split hex when we would carve.
    hex = null
  } else {
    hex = build(feeUtxo).build()
    estimatedFee = feeFromHex(hex, args.feeRate)
    if (feeUtxo.satoshis < estimatedFee) {
      // Rare: carved buffer was insufficient — carve once more at the refined size.
      const retry = await ensureSmallFeeUtxo({
        wallet,
        estimatedFee,
        dryRun: args.dryRun
      })
      feeUtxo = retry.feeUtxo
      if (feeUtxo.placeholder) {
        hex = null
      } else {
        hex = build(feeUtxo).build()
        estimatedFee = feeFromHex(hex, args.feeRate)
        Object.assign(ensured, retry)
      }
    }
  }

  if (feeUtxo.satoshis < estimatedFee && !feeUtxo.placeholder) {
    console.error(JSON.stringify({
      ok: false,
      error: `Fee UTXO ${feeUtxo.satoshis} < required ~${estimatedFee} after carve`,
      feeAddress: wallet.walletInfo.cashAddress
    }, null, 2))
    process.exit(1)
  }

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
      satoshis: feeUtxo.satoshis.toString(),
      placeholder: Boolean(feeUtxo.placeholder)
    },
    minerFee: feeUtxo.satoshis.toString(),
    estimatedFeeAtRate: estimatedFee.toString(),
    feeRate: args.feeRate,
    carved: ensured.carved,
    carveTxid: ensured.carveTxid,
    carveAmount: ensured.carveAmount != null ? ensured.carveAmount.toString() : null,
    note: 'Companion fee input has no change under the 4-output covenant. Large wallet UTXOs are never spent as the fee input; a small self-send UTXO is carved when needed.',
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
