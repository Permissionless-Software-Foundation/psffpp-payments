import assert from 'node:assert/strict'
import {
  TransactionBuilder,
  randomUtxo
} from 'cashscript'
import {
  claimArgs,
  createPool,
  createShares,
  makeOperator,
  makeProvider,
  makeTreasury
} from './helpers.js'

describe('PoolContract.migrate', function () {
  let provider, nodes, treasury, shares, pool, nextPool

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
    nextPool = createPool(provider, {
      nodes,
      treasuryPkh: treasury.pkh,
      shareContracts: shares,
      minConsolidation: 100_000n,
      splitBlockheight: 2000n
    })
  })

  it('allows 2-of-3 to migrate value to the next-epoch pool', async function () {
    const utxo = provider.addUtxo(pool.address, randomUtxo({ satoshis: 500_000n }))
    const fee = 1000n
    const amount = 500_000n - fee

    const tx = await new TransactionBuilder({ provider })
      .addInput(utxo, pool.unlock.migrate(...claimArgs(nodes, [nodes[0], nodes[1]])))
      .addOutput({ to: nextPool.address, amount })
      .send()

    assert.ok(tx.txid)
  })

  it('rejects migration with only 1-of-3 signatures', async function () {
    const utxo = provider.addUtxo(pool.address, randomUtxo({ satoshis: 500_000n }))
    const fee = 1000n
    const amount = 500_000n - fee

    const builder = new TransactionBuilder({ provider })
      .addInput(utxo, pool.unlock.migrate(...claimArgs(nodes, [nodes[0]])))
      .addOutput({ to: nextPool.address, amount })

    await assert.rejects(() => builder.send(), /need at least 2-of-3|Failed to evaluate|require/i)
  })

  it('allows 2-of-3 to send to an arbitrary signed destination', async function () {
    const utxo = provider.addUtxo(pool.address, randomUtxo({ satoshis: 250_000n }))
    const fee = 1000n
    const amount = 250_000n - fee

    const tx = await new TransactionBuilder({ provider })
      .addInput(utxo, pool.unlock.migrate(...claimArgs(nodes, [nodes[1], nodes[2]])))
      .addOutput({ to: nodes[0].addr, amount })
      .send()

    assert.ok(tx.txid)
  })
})
