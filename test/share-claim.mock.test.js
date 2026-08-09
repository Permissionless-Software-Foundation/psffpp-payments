import assert from 'node:assert/strict'
import {
  TransactionBuilder,
  randomUtxo
} from 'cashscript'
import {
  claimArgs,
  createShares,
  makeOperator,
  makeProvider
} from './helpers.js'

describe('ShareContract.claim', function () {
  let provider, nodes, shares, share0, utxo

  beforeEach(function () {
    provider = makeProvider()
    nodes = [makeOperator('n0'), makeOperator('n1'), makeOperator('n2')]
    shares = createShares(provider, nodes)
    share0 = shares[0]
    utxo = provider.addUtxo(share0.address, randomUtxo({ satoshis: 100_000n }))
  })

  it('accepts 2-of-3 signatures paying the correct nodePkh', async function () {
    const fee = 1000n
    const amount = 100_000n - fee
    const tx = await new TransactionBuilder({ provider })
      .addInput(utxo, share0.unlock.claim(...claimArgs(nodes, [nodes[0], nodes[1]])))
      .addOutput({ to: nodes[0].addr, amount })
      .send()

    assert.ok(tx.txid)
  })

  it('rejects 1-of-3 signatures', async function () {
    const fee = 1000n
    const amount = 100_000n - fee
    const builder = new TransactionBuilder({ provider })
      .addInput(utxo, share0.unlock.claim(...claimArgs(nodes, [nodes[0]])))
      .addOutput({ to: nodes[0].addr, amount })

    await assert.rejects(() => builder.send(), /need at least 2-of-3|Failed to evaluate|require/i)
  })

  it('rejects payout to the wrong address', async function () {
    const fee = 1000n
    const amount = 100_000n - fee
    const builder = new TransactionBuilder({ provider })
      .addInput(utxo, share0.unlock.claim(...claimArgs(nodes, [nodes[0], nodes[1]])))
      .addOutput({ to: nodes[1].addr, amount })

    await assert.rejects(() => builder.send(), /output must pay nodePkh|Failed to evaluate|require/i)
  })

  it('rejects extra outputs', async function () {
    const builder = new TransactionBuilder({ provider })
      .addInput(utxo, share0.unlock.claim(...claimArgs(nodes, [nodes[0], nodes[1]])))
      .addOutput({ to: nodes[0].addr, amount: 50_000n })
      .addOutput({ to: nodes[0].addr, amount: 49_000n })

    await assert.rejects(() => builder.send(), /expected exactly 1 output|Failed to evaluate|require/i)
  })

  it('accepts signatures from nodes 1 and 2 (skipping node 0)', async function () {
    const fee = 1000n
    const amount = 100_000n - fee
    const tx = await new TransactionBuilder({ provider })
      .addInput(utxo, share0.unlock.claim(...claimArgs(nodes, [nodes[1], nodes[2]])))
      .addOutput({ to: nodes[0].addr, amount })
      .send()

    assert.ok(tx.txid)
  })
})
