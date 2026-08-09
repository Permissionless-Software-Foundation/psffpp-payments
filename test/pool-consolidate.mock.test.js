import assert from 'node:assert/strict'
import {
  TransactionBuilder,
  randomUtxo
} from 'cashscript'
import {
  createPool,
  createShares,
  makeOperator,
  makeProvider,
  makeTreasury
} from './helpers.js'

describe('PoolContract.consolidate', function () {
  let provider, nodes, treasury, shares, pool

  beforeEach(function () {
    provider = makeProvider()
    nodes = [makeOperator('n0'), makeOperator('n1'), makeOperator('n2')]
    treasury = makeTreasury()
    shares = createShares(provider, nodes)
    pool = createPool(provider, {
      nodes,
      treasuryPkh: treasury.pkh,
      shareContracts: shares,
      minConsolidation: 100_000n,
      splitBlockheight: 1000n
    })
  })

  it('merges multiple pool UTXOs into one self-replicating output', async function () {
    const u0 = provider.addUtxo(pool.address, randomUtxo({ satoshis: 120_000n }))
    const u1 = provider.addUtxo(pool.address, randomUtxo({ satoshis: 130_000n }))
    const fee = 5_000n
    const out = 120_000n + 130_000n - fee

    const tx = await new TransactionBuilder({ provider })
      .addInput(u0, pool.unlock.consolidate())
      .addInput(u1, pool.unlock.consolidate())
      .addOutput({ to: pool.address, amount: out })
      .send()

    assert.ok(tx.txid)
  })

  it('rejects escape to a foreign locking bytecode', async function () {
    const u0 = provider.addUtxo(pool.address, randomUtxo({ satoshis: 200_000n }))
    const builder = new TransactionBuilder({ provider })
      .addInput(u0, pool.unlock.consolidate())
      .addOutput({ to: nodes[0].addr, amount: 199_000n })

    await assert.rejects(() => builder.send(), /must self-replicate|Failed to evaluate|require/i)
  })

  it('rejects outputs below minConsolidation', async function () {
    const u0 = provider.addUtxo(pool.address, randomUtxo({ satoshis: 150_000n }))
    const builder = new TransactionBuilder({ provider })
      .addInput(u0, pool.unlock.consolidate())
      .addOutput({ to: pool.address, amount: 50_000n })

    await assert.rejects(() => builder.send(), /below minConsolidation|Failed to evaluate|require/i)
  })

  it('rejects more than two outputs', async function () {
    const u0 = provider.addUtxo(pool.address, randomUtxo({ satoshis: 400_000n }))
    const builder = new TransactionBuilder({ provider })
      .addInput(u0, pool.unlock.consolidate())
      .addOutput({ to: pool.address, amount: 130_000n })
      .addOutput({ to: pool.address, amount: 130_000n })
      .addOutput({ to: pool.address, amount: 139_000n })

    await assert.rejects(() => builder.send(), /too many outputs|Failed to evaluate|require/i)
  })
})
