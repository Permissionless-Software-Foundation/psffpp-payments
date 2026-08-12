/**
 * Address / PKH helpers for PSFFPP UI.
 */
import { encodeCashAddress, hexToBin, binToHex } from '@bitauth/libauth'

export function pkhToCashAddr (pkhHex, network) {
  const prefix = network === 'mainnet' || !network ? 'bitcoincash' : 'bchtest'
  return encodeCashAddress({
    prefix,
    type: 'p2pkh',
    payload: hexToBin(pkhHex),
    throwErrors: true
  }).address
}

export function toCashScriptUtxos (walletUtxoPayload) {
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

export { binToHex, hexToBin }
