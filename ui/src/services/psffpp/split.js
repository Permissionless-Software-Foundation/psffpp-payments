/**
 * Height-gated pool split. Fee from companion P2PKH (wallet); auto-carve when needed.
 */
import {
  TransactionBuilder,
  SignatureTemplate,
  HashType,
  SignatureAlgorithm
} from 'cashscript'
import { pkhToCashAddr, toCashScriptUtxos } from './address'
import {
  createProvider,
  instantiateContracts,
  feeFromHex,
  sleep,
  DEFAULT_FEE_RATE
} from './lib'

const SIGHASH = HashType.SIGHASH_ALL | HashType.SIGHASH_UTXOS
const FEE_CARVE_BUFFER = 300n
const MAX_REUSE_TIP = 500n
const CARVE_CONFIRM_MS = 4000

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

async function ensureSmallFeeUtxo ({ wallet, estimatedFee, dryRun, onStatus }) {
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

  if (onStatus) {
    onStatus(`Carving fee UTXO of ${amountSat} sats…`)
  }

  const carveTxid = await wallet.send([{
    address: wallet.walletInfo.cashAddress,
    amountSat
  }])

  let carved = null
  for (let attempt = 0; attempt < 8; attempt++) {
    if (onStatus) onStatus(`Waiting for carved fee UTXO (attempt ${attempt + 1}/8)…`)
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

export async function splitPool ({
  cfg,
  wallet,
  feeRate = DEFAULT_FEE_RATE,
  dryRun = false,
  onStatus
} = {}) {
  if (!cfg) throw new Error('Deploy config required')
  if (!wallet) throw new Error('Wallet required for fee payment and broadcast')

  const network = cfg.network || 'mainnet'
  const provider = createProvider(network)
  const { pool, shares } = instantiateContracts(cfg, provider)

  const height = await provider.getBlockHeight()
  if (height < cfg.splitBlockheight) {
    throw new Error(
      `splitBlockheight gate not met yet (height ${height} < ${cfg.splitBlockheight})`
    )
  }

  const poolUtxos = (await pool.getUtxos()).filter((u) => !u.token)
  if (poolUtxos.length === 0) {
    throw new Error('No pool UTXOs found')
  }
  if (poolUtxos.length > 1) {
    throw new Error(
      `Pool has ${poolUtxos.length} UTXOs — consolidate first (split uses exactly one pool input)`
    )
  }

  const poolUtxo = poolUtxos[0]
  const poolValue = poolUtxo.satoshis
  const { treasuryValue, share } = apportion(poolValue)
  const treasuryAddr = pkhToCashAddr(cfg.treasuryPkh, network)

  const probeUtxos = toCashScriptUtxos(await wallet.getUtxos())
  if (probeUtxos.length === 0) {
    throw new Error(`Fee wallet has no BCH UTXOs (${wallet.walletInfo.cashAddress})`)
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

  const probeHex = build(probeUtxos[0]).build()
  let estimatedFee = feeFromHex(probeHex, feeRate)

  const ensured = await ensureSmallFeeUtxo({
    wallet,
    estimatedFee,
    dryRun,
    onStatus
  })
  let feeUtxo = ensured.feeUtxo

  let hex
  if (feeUtxo.placeholder) {
    hex = null
  } else {
    hex = build(feeUtxo).build()
    estimatedFee = feeFromHex(hex, feeRate)
    if (feeUtxo.satoshis < estimatedFee) {
      const retry = await ensureSmallFeeUtxo({
        wallet,
        estimatedFee,
        dryRun,
        onStatus
      })
      feeUtxo = retry.feeUtxo
      Object.assign(ensured, retry)
      if (feeUtxo.placeholder) {
        hex = null
      } else {
        hex = build(feeUtxo).build()
        estimatedFee = feeFromHex(hex, feeRate)
      }
    }
  }

  if (feeUtxo.satoshis < estimatedFee && !feeUtxo.placeholder) {
    throw new Error(
      `Fee UTXO ${feeUtxo.satoshis} < required ~${estimatedFee} after carve`
    )
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
    feeRate,
    carved: ensured.carved,
    carveTxid: ensured.carveTxid,
    carveAmount: ensured.carveAmount != null ? ensured.carveAmount.toString() : null,
    dryRun,
    hex
  }

  if (dryRun) return summary

  const txid = await wallet.broadcast({ hex })
  return { ...summary, txid }
}
