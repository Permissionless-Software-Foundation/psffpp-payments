# UI deferred features

Features intentionally **not** built in the first PSFFPP Payments React UI (`ui/`). This document describes what should be built later and how, so a follow-up implementation can reuse the existing browser service layer under `ui/src/services/psffpp/`.

Shipped in v1 UI: deploy-config paste/upload, pool status, consolidate, split (with fee carve), claim cosign JSON, claim assemble/broadcast. Wallet / BCH / Configuration / Sign views are retained from the wallet SPA fork.

---

## 1. Migrate (K-of-M)

### Why deferred

First UI release covers a single payout epoch end-to-end (deposit → consolidate → split → claim). Epoch rollover (`migrate`) is rarer, needs a destination address (usually a newly deployed next-epoch pool), and mirrors the claim cosign/assemble pattern that should be proven first.

### User story

As two federation operators, we want to move remaining value from an old PoolContract to a next-epoch Pool address after a new deploy, without a privileged admin key.

### Contract behavior (reference)

`PoolContract.migrate(s0, s1, s2)`:

- Requires ≥2-of-3 valid ECDSA signatures over the migrate transaction (`SIGHASH_ALL | SIGHASH_UTXOS`).
- 1–2 pure-BCH outputs; destinations are **not** baked — authorized only by signatures.
- Unused signature slots must be empty (`0x`), same NULLFAIL rule as claim.
- See [`test/pool-migrate.mock.test.js`](../test/pool-migrate.mock.test.js) and [`contracts/PoolContract.cash`](../contracts/PoolContract.cash).

### Suggested UI

| Route | Role |
|-------|------|
| `/migrate/cosign` | Build migrate tx (pool UTXO(s) → destination address(es)), capture one operator’s ECDSA sig into a JSON envelope |
| `/migrate` | Assemble ≥2 migrate-sig JSON files and broadcast |

Envelope sketch (parallel to `psffpp-share-claim-sig`):

```json
{
  "type": "psffpp-pool-migrate-sig",
  "version": 1,
  "network": "mainnet",
  "migrate": {
    "poolAddress": "bitcoincash:p…",
    "poolUtxo": { "txid": "…", "vout": 0, "satoshis": "…" },
    "outputs": [{ "address": "bitcoincash:p…", "satoshis": "…" }],
    "feeMode": "from_pool_or_companion",
    "sighash": "ALL|UTXOS",
    "signatureAlgorithm": "ECDSA",
    "constructorPubkeys": ["…", "…", "…"]
  },
  "signer": { "nodeIndex": 0, "name": "node0", "pubkey": "…" },
  "signature": "<hex>"
}
```

### Implementation notes

- Reuse `SignatureTemplate` capture pattern from `ui/src/services/psffpp/claim-cosign.js`.
- Reuse assemble/empty-slot logic from `claim-broadcast.js`.
- Decide fee policy up front: deduct from pool vs companion fee input (companion is safer when leftover is near `minConsolidation`).
- Require loaded deploy config for the **source** pool; destination may be pasted as a cashaddr (next-epoch pool) after a separate config derive step.
- Acceptance: 2-of-3 migrate dry-run builds; broadcast moves value; 1-of-3 fails; mismatched envelope params rejected.

---

## 2. Next-epoch deploy helper

### Why deferred

Deploy today is CLI (`npm run addresses` / `npm run deploy`). The UI only loads an existing deploy JSON.

### User story

As an operator, I want to enter the next `splitBlockheight` (and optional membership tweaks), see new Share + Pool addresses, download a deploy record, then hand that address into Migrate.

### Suggested UI

- Route `/deploy` or extend `/contracts` with a “New epoch” wizard.
- Client-side: validate config → `instantiateContracts` → show addresses (same as Contracts view).
- Optional: download a deployment record JSON matching `scripts/deploy.mjs` shape (timestamps, locking bytecodes, artifact fingerprints). Fingerprints need a browser SHA-256 (Web Crypto), not Node `crypto`.
- Do **not** broadcast funding from this wizard unless explicitly requested; publish address only.

### Acceptance

Derived addresses match `npm run addresses` for the same JSON; downloadable record is usable as `/contracts` paste input for the next epoch.

---

## 3. Registry announce (OP_RETURN PSP1)

### Why deferred

Pin-service / indexer registry protocol is specified in [`infra-changes.md`](infra-changes.md) but not yet implemented in CLIs or UI. Only the trusted controller key should post updates.

### User story

As the registry controller, I post an append-only OP_RETURN announcing the current pool address so pin-service sync can validate historical payments.

### Suggested UI

- Route `/registry` (controller wallet only).
- Build OP_RETURN payload per infra-changes protocol (`PSP1` + pool cashaddr / metadata).
- Use in-app wallet to fund and broadcast; show confirmation + explorer link.
- Read-only mode: sync controller address history and list known pool addresses (Electrum or consumer-api tx history).

### Acceptance

Posted tx is parseable by the future pin-service registry sync; UI lists prior announcements for the configured controller.

---

## 4. Automation (cron / agent)

### Why deferred

Browser UI is interactive. Monthly consolidate→split should eventually run unattended after the height gate without an operator clicking Broadcast.

### User story

As federation ops, a scheduled job consolidates if needed, waits for `splitBlockheight`, carves a fee UTXO, and splits — logging txids to a channel.

### Suggested build

- Prefer **Node CLIs** already in `scripts/` (`consolidate.mjs`, `split.mjs`) wrapped by systemd/cron or a small agent, not the CRA app.
- Optionally extract `ui/src/services/psffpp/*` into a shared package used by both UI and agent to avoid drift.
- Secrets: fee-payer WIF in env / file permissions; never in localStorage of a public web host.
- Acceptance: dry-run then live run on mainnet smoke pool; idempotent if already split.

---

## 5. Federation admin UX

### Why deferred

v1 assumes a single pasted config. Production may juggle multiple epochs, remote config, and membership changes.

### User stories / features

| Feature | Approach |
|---------|----------|
| Multi-config profiles | Store named configs in localStorage; switch active profile for all contract views |
| Remote config fetch | Load JSON from HTTPS URL / gist / IPFS CID with checksum; allow local override (was plan option C) |
| Membership change | Wizard: new 3 pubkeys/PKHs → new deploy → migrate remaining → claim old shares under old contracts |
| Read-only explorer links | Deep-link pool/share addresses to block explorers from Pool status |

### Acceptance

Operators can keep “epoch N” and “epoch N+1” configs without re-pasting; switching profile refreshes Pool status addresses.

---

## Reuse map

| Deferred feature | Existing building blocks |
|------------------|--------------------------|
| Migrate cosign/broadcast | `claim-cosign.js`, `claim-broadcast.js`, mock migrate tests |
| Next-epoch deploy | `lib.js` `instantiateContracts`, Contracts view UI |
| Registry announce | Wallet `send` / OP_RETURN helpers in bch-js; infra-changes.md |
| Automation | Parent `scripts/*.mjs` |
| Federation admin | `psffppDeployConfig` localStorage pattern in `hooks/state.js` |

## Out of scope reminders

Still out of scope for the payments UI unless product requirements change: treasury multisig / withdrawal caps, pin-service dual-mode screens, rewriting the UI to Vite, shipping a hardcoded production federation config with real keys.
