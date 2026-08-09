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

describe('PoolContract.split', function () {
  const splitHeight = 1000n
  let provider, nodes, treasury, shares, pool

  beforeEach(function () {
    provider = makeProvider()
    provider.setBlockHeight(Number(splitHeight))
    nodes = [makeOperator('n0'), makeOperator('n1'), makeOperator('n2')]
    treasury = makeTreasury()
    shares = createShares(provider, nodes)
    pool = createPool(provider, {
      nodes,
      treasuryPkh: treasury.pkh,
      shareContracts: shares,
      minConsolidation: 100_000n,
      splitBlockheight: splitHeight
    })
  })

  it('rejects split before the gated blockheight', async function () {
    provider.setBlockHeight(Number(splitHeight) - 1)
    const poolValue = 1_000_000n
    const feePriv = makeOperator('fee')
    const poolUtxo = provider.addUtxo(pool.address, randomUtxo({ satoshis: poolValue }))
    const feeUtxo = provider.addUtxo(feePriv.addr, randomUtxo({ satoshis: 5_000n }))
    const { treasuryValue, share } = apportion(poolValue)

    const builder = new TransactionBuilder({ provider })
      .addInput(poolUtxo, pool.unlock.split())
      .addInput(feeUtxo, feePriv.tmpl.unlockP2PKH())
      .addOutput({ to: treasury.addr, amount: treasuryValue })
      .addOutput({ to: shares[0].address, amount: share })
      .addOutput({ to: shares[1].address, amount: share })
      .addOutput({ to: shares[2].address, amount: share })
      .setLocktime(Number(splitHeight) - 1)

    await assert.rejects(() => builder.send(), /blockheight gate|Failed to evaluate|require|non-final|locktime/i)
  })

  it('splits 20% treasury + equal 80%/3 shares after the gate', async function () {
    const poolValue = 1_000_000n
    const feePriv = makeOperator('fee')
    const poolUtxo = provider.addUtxo(pool.address, randomUtxo({ satoshis: poolValue }))
    const feeUtxo = provider.addUtxo(feePriv.addr, randomUtxo({ satoshis: 5_000n }))
    const { treasuryValue, share } = apportion(poolValue)

    assert.equal(treasuryValue + share * 3n, poolValue)

    const tx = await new TransactionBuilder({ provider })
      .addInput(poolUtxo, pool.unlock.split())
      .addInput(feeUtxo, feePriv.tmpl.unlockP2PKH())
      .addOutput({ to: treasury.addr, amount: treasuryValue })
      .addOutput({ to: shares[0].address, amount: share })
      .addOutput({ to: shares[1].address, amount: share })
      .addOutput({ to: shares[2].address, amount: share })
      .setLocktime(Number(splitHeight))
      .send()

    assert.ok(tx.txid)
    // remaining = 800000; share = 266666; remainder = 2 → treasury = 200002
    assert.equal(share, 266_666n)
    assert.equal(treasuryValue, 200_002n)
  })

  it('rejects wrong share locking bytecode destinations', async function () {
    const poolValue = 1_000_000n
    const feePriv = makeOperator('fee')
    const poolUtxo = provider.addUtxo(pool.address, randomUtxo({ satoshis: poolValue }))
    const feeUtxo = provider.addUtxo(feePriv.addr, randomUtxo({ satoshis: 5_000n }))
    const { treasuryValue, share } = apportion(poolValue)

    const builder = new TransactionBuilder({ provider })
      .addInput(poolUtxo, pool.unlock.split())
      .addInput(feeUtxo, feePriv.tmpl.unlockP2PKH())
      .addOutput({ to: treasury.addr, amount: treasuryValue })
      .addOutput({ to: nodes[0].addr, amount: share })
      .addOutput({ to: shares[1].address, amount: share })
      .addOutput({ to: shares[2].address, amount: share })
      .setLocktime(Number(splitHeight))

    await assert.rejects(() => builder.send(), /output 1 must be share0|Failed to evaluate|require/i)
  })

  it('folds integer-division remainder into the treasury', async function () {
    // 100001 * 20/100 = 20000; remaining 80001; share 26667; rem 80001-80001=0? 
    // 80001 / 3 = 26667, rem = 80001 - 80001 = 0
    // Use 100003: remaining = 80003 - wait 100003*20/100=20000, rem=80003, share=26667, r=80003-80001=2
    const poolValue = 100_003n
    const feePriv = makeOperator('fee')
    const poolUtxo = provider.addUtxo(pool.address, randomUtxo({ satoshis: poolValue }))
    const feeUtxo = provider.addUtxo(feePriv.addr, randomUtxo({ satoshis: 5_000n }))
    const { treasuryValue, share } = apportion(poolValue)

    assert.equal(share, 26_667n)
    assert.equal(treasuryValue, 20_002n)

    const tx = await new TransactionBuilder({ provider })
      .addInput(poolUtxo, pool.unlock.split())
      .addInput(feeUtxo, feePriv.tmpl.unlockP2PKH())
      .addOutput({ to: treasury.addr, amount: treasuryValue })
      .addOutput({ to: shares[0].address, amount: share })
      .addOutput({ to: shares[1].address, amount: share })
      .addOutput({ to: shares[2].address, amount: share })
      .setLocktime(Number(splitHeight))
      .send()

    assert.ok(tx.txid)
  })
})
