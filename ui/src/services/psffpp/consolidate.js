/**
 * Permissionless pool consolidate. Fee deducted from pool.
 * Broadcast via minimal-slp-wallet when wallet is provided.
 */
import { TransactionBuilder } from 'cashscript'
import {
  createProvider,
  instantiateContracts,
  summarizeUtxo,
  DEFAULT_FEE_RATE,
  DEFAULT_MAX_UTXOS
} from './lib'

export async function consolidatePool ({
  cfg,
  wallet,
  feeRate = DEFAULT_FEE_RATE,
  maxUtxos = DEFAULT_MAX_UTXOS,
  dryRun = false
} = {}) {
  if (!cfg) throw new Error('Deploy config required')
  const provider = createProvider(cfg.network || 'mainnet')
  const { pool } = instantiateContracts(cfg, provider)

  let utxos = (await pool.getUtxos()).filter((u) => !u.token)
  if (utxos.length < 2) {
    throw new Error(`Need at least 2 pool UTXOs to consolidate (found ${utxos.length})`)
  }
  if (utxos.length > maxUtxos) {
    utxos = utxos.slice(0, maxUtxos)
  }

  const inSum = utxos.reduce((s, u) => s + u.satoshis, 0n)
  const minConsolidation = BigInt(cfg.minConsolidation)

  const builder = new TransactionBuilder({ provider })
  for (const u of utxos) {
    builder.addInput(u, pool.unlock.consolidate())
  }
  builder.addBchChangeOutputIfNeeded({ to: pool.address, feeRate })

  if (builder.outputs.length !== 1) {
    throw new Error(
      `Expected exactly 1 pool output, got ${builder.outputs.length}. Surplus may be below dust after fee.`
    )
  }

  const outAmount = builder.outputs[0].amount
  if (outAmount < minConsolidation) {
    throw new Error(
      `Consolidated output ${outAmount} would be below minConsolidation ${minConsolidation}`
    )
  }

  const fee = inSum - outAmount
  const hex = builder.build()

  const summary = {
    poolAddress: pool.address,
    inputCount: utxos.length,
    inSum: inSum.toString(),
    fee: fee.toString(),
    feeRate,
    outAmount: outAmount.toString(),
    minConsolidation: minConsolidation.toString(),
    dryRun,
    inputs: utxos.map(summarizeUtxo),
    hex
  }

  if (dryRun) return summary

  if (!wallet) throw new Error('Wallet required to broadcast')
  const txid = await wallet.broadcast({ hex })
  return { ...summary, txid }
}
