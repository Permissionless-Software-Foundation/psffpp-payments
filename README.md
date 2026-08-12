# psffpp-payments

CashScript payout contracts for PSFFPP (Permissionless Software Foundation File Pinning Protocol) deposits on Bitcoin Cash.

Users send BCH to a single **PoolContract** address. Once per payout epoch (blockheight-gated), the pool splits 20% to treasury and 80% into three **ShareContract** UTXOs (one per node). A K-of-M (2-of-3) operator quorum must sign before any share pays out.

Project docs live in [`docs/`](docs/). Start with [Why CashScript](docs/why-cashscript.md) for the high-level motivation (replacing PSF-token proof-of-burn with pure BCH payouts). For indexer/pin-service/client integration (pool-address registry, dual-mode validation), see [Infra changes](docs/infra-changes.md). The operator React UI lives in [`ui/`](ui/) ([UI README](ui/README.md)); deferred UI features (migrate, registry announce, automation, etc.) are documented in [UI deferred](docs/ui-deferred.md). External references: [CashScript](https://cashscript.org/) · Design: circular-economy trust-minimized federation (M=3, K=2).

## Scope (v1)

| In scope | Out of scope |
|----------|--------------|
| `ShareContract.cash`, `PoolContract.cash` | Cron (consolidate/split/broadcast) |
| Compile + mock tests | Migrate / registry announce UI ([deferred](docs/ui-deferred.md)) |
| Address + deploy record scripts | Treasury multisig, withdrawal caps |
| Operator React UI (`ui/`) for consolidate / split / claim | |

## Epoch model

Each Pool deploy bakes a single `splitBlockheight`. After that height, `split()` may run once the pool is consolidated. Later months are **not** gated by the same contract: deploy a new Pool+Shares with the next height, then K-of-M `migrate()` any remaining pool value into the new Pool.

## Contracts

### ShareContract

Constructor: `node0`, `node1`, `node2` pubkeys + this node's `nodePkh`.

- `claim(s0, s1, s2)` — requires ≥2 valid ECDSA sigs against registered pubs; pays exactly to `nodePkh`; terminating (no self-replication). Unused sigs must be empty (`0x`).

### PoolContract

Constructor: three pubs, `treasuryPkh`, three share **locking bytecodes**, `minConsolidation` (100_000), `splitBlockheight`.

- `consolidate()` — permissionless; outputs must self-replicate (same P2SH locking bytecode), pure BCH, ≥ `minConsolidation`.
- `split()` — permissionless after `tx.time >= splitBlockheight`; 4 outputs: treasury (20% + rounding remainder) + three equal shares locked in the baked ShareContracts. Prefer a companion fee-paying input so the full pool value is apportioned.
- `migrate(s0, s1, s2)` — 2-of-3; destinations are authorized by the signatures (no baked next-pool bytecode).

## Setup

```bash
npm install
npm run compile
npm test
```

Requires Node.js ≥ 22. Matches `cashc` / `cashscript` `^0.13`.

## Config

```bash
cp config/deploy.mainnet.example.json config/deploy.mainnet.json
```

Fill in:

- Three compressed operator **pubkeys** (66 hex chars)
- Three node payout **pkh** values (40 hex chars) — usually `hash160(pubkey)` for each operator’s payout key
- Treasury **pkh**
- `splitBlockheight` (absolute BCH block height for this epoch)
- `minConsolidation` (default 100000)

`config/deploy.mainnet.json` is gitignored. Never put private keys in config.

## Deploy order (mainnet)

Contracts are immutable. Order matters:

1. Freeze operator pubs / PKHs / treasury PKH / `splitBlockheight`.
2. `npm run compile`
3. `npm run addresses -- config/deploy.mainnet.json` — prints three Share addresses + Pool address.
4. `npm run deploy -- config/deploy.mainnet.json` — writes `deployments/<timestamp>.json` (addresses, locking bytecodes, artifact fingerprints). Does **not** move funds.
5. Publish **Pool** P2SH32 address as the deposit address.
6. **Smoke checklist** (small intentional funding only):
   - Deposit a small amount to the Pool
   - Run `npm run consolidate -- --dry-run` then `npm run consolidate` if multiple UTXOs (fee taken from pool; needs ≥2 UTXOs and output ≥ `minConsolidation`)
   - Confirm `split` fails before the gate
   - After height: `split` with a fee-paying companion input
   - `claim` a share with 2-of-3 ECDSA signatures
   - Optionally test `migrate` to a next-epoch Pool
7. Only then accept production deposits

### Consolidate

Permissionless merge of PoolContract UTXOs (via [minimal-slp-wallet](https://www.npmjs.com/package/minimal-slp-wallet) for broadcast + CashScript unlock). Fee is taken from the pool:

```bash
npm run consolidate -- --dry-run
npm run consolidate
# optional: --fee-rate 1.2 --max-utxos 50 --rest-url https://free-bch.fullstack.cash
```

### Split

Permissionless after `splitBlockheight`. Apportions **100%** of one pool UTXO (20% treasury + 80%/3 shares). Miner fee must come from a **companion P2PKH** input (`--wif` / `--mnemonic`) — the covenant forbids taking the fee from the pool or adding a 5th change output.

The script never spends a large fee-wallet UTXO as the companion input. It reuses an existing UTXO only if it is within ~500 sats of the estimated fee; otherwise it first `wallet.send`s a small self-payment to carve a dedicated fee UTXO (two txs: carve + split).

```bash
npm run consolidate          # if more than one pool UTXO
npm run split -- --wif <WIF> --dry-run
npm run split -- --wif <WIF>
# or: --mnemonic "twelve words ..."
```

### Claim cosign

`ShareContract.claim` needs **2-of-3 transaction ECDSA** signatures (not `signMessageWithPrivKey` message sigs). A cosigner runs:

```bash
npm run claim-cosign -- --wif <COSIGNER_WIF> --share-index 0 --out claim-sig.json
# --share-index = which node's share is being claimed (0|1|2)
# optional: --utxo <txid>:<vout> if that share has multiple UTXOs
```

This writes a JSON file (`type: psffpp-share-claim-sig`) the claimant can collect until they have ≥2 signatures for the same claim parameters, then assemble/broadcast.

### Signing (ECDSA)

```js
import { SignatureTemplate, HashType, SignatureAlgorithm } from 'cashscript'

const tmpl = new SignatureTemplate(
  privateKey,
  HashType.SIGHASH_ALL | HashType.SIGHASH_UTXOS,
  SignatureAlgorithm.ECDSA
)
```

Pass `Uint8Array.of()` for unused signature slots.

### Next epoch

1. Deploy new Shares + Pool with the next `splitBlockheight`.
2. K-of-M `migrate` remaining old-pool value to the new Pool address.
3. Claim any unclaimed old Share UTXOs separately (still valid under the old Share contracts).

## Security notes

- Limit outputs first in every function.
- Consolidate compares against `tx.inputs[this.activeInputIndex].lockingBytecode` (P2SH wrapper), not redeem script.
- Empty `tokenCategory` on covenant outputs (pure BCH).
- Use `tx.time >=` (never `>`).
- Fee stalls on claim/migrate require rebuilding the tx and re-collecting all K signatures.
- If ≥K operators collude they can approve any signed migrate destination — trust-minimized federation, not permissionless.

## License

MIT
