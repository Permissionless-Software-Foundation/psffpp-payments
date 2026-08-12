/**
 * Pool status: height gate + pool/share UTXO balances via CashScript Electrum.
 */
import {
  createProvider,
  instantiateContracts,
  summarizeUtxo
} from './lib'

export async function fetchPoolStatus (cfg) {
  const network = cfg.network || 'mainnet'
  const provider = createProvider(network)
  const { pool, shares } = instantiateContracts(cfg, provider)

  const height = await provider.getBlockHeight()
  const poolUtxos = (await pool.getUtxos()).filter((u) => !u.token)
  const poolTotal = poolUtxos.reduce((s, u) => s + u.satoshis, 0n)

  const shareStatuses = []
  for (let i = 0; i < shares.length; i++) {
    const utxos = (await shares[i].getUtxos()).filter((u) => !u.token)
    const total = utxos.reduce((s, u) => s + u.satoshis, 0n)
    shareStatuses.push({
      index: i,
      name: cfg.nodes[i].name || `node${i}`,
      address: shares[i].address,
      utxoCount: utxos.length,
      totalSatoshis: total.toString(),
      utxos: utxos.map(summarizeUtxo)
    })
  }

  const gateMet = height >= cfg.splitBlockheight
  const needsConsolidate = poolUtxos.length >= 2
  const canSplit = gateMet && poolUtxos.length === 1

  return {
    network,
    height,
    splitBlockheight: cfg.splitBlockheight,
    gateMet,
    minConsolidation: cfg.minConsolidation,
    poolAddress: pool.address,
    poolUtxoCount: poolUtxos.length,
    poolTotalSatoshis: poolTotal.toString(),
    poolUtxos: poolUtxos.map(summarizeUtxo),
    shares: shareStatuses,
    needsConsolidate,
    canSplit,
    hint: !gateMet
      ? `Wait until block ${cfg.splitBlockheight} (current ${height}) before split`
      : needsConsolidate
        ? 'Consolidate pool UTXOs before split'
        : poolUtxos.length === 0
          ? 'Pool has no UTXOs'
          : canSplit
            ? 'Ready to split'
            : null
  }
}
