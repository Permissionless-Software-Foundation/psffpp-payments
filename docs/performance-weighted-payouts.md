# Performance-weighted federation payouts (design capture)

> **Status: DRAFT** — captures the brainstorm of 2026-11-27 between the PSF node
> operators. Nothing here is implemented. It is a decision record and a map of
> the architecture we outlined, for the next step beyond the current
> equal-share payout contracts.
>
> Companion reading: [Why CashScript](why-cashscript.md) (the v1 equal-share
> contract set this design evolves from), and [Infra changes](infra-changes.md).

## 1. The problem this design solves

The current payout layer ([why-cashscript.md](why-cashscript.md)) is an
**equal-share federation**: a monthly pool splits into equal shares for three
node operators, and a K-of-M quorum approves each payout. It establishes that
users pay with **pure BCH**, but:

- All nodes are paid **equal shares**, regardless of how much they actually
  contributed to pinning and serving content.
- The roster is **fixed at deploy time** (three nodes).
- There is **no reputation ledger** connecting a node's measurable performance
  to its compensation.

The goal of this design:

- A network of **3–10 nodes** redundantly pinning and serving content, making
  the service **censorship-resistant** (a copy survives if a node disappears).
- A **score-weighted payment**: once a month the members report on each other's
  performance; payment to each node is proportional to the **average of the
  scores** it received.
- All decisions recorded **on-chain or on-chain-auditable**, so anyone can
  recompute a month's payouts from public data.

## 2. Verified research that shapes the architecture

These facts were verified against the BCH upgrade specs, CashScript docs, the
CashTokens spec, and SolidCash's own repository:

| Finding | Consequence |
|---|---|
| **Native Introspection went live on BCH 2022-05-15** — `OP_UTXOVALUE`, `OP_OUTPUTVALUE`, `OP_OUTPUTBYTECODE`, `OP_TXLOCKTIME`, etc. A contract can now read its own balance and every output's exact sat value. | The old "a BCH contract can't know how much BCH it holds" limitation is **gone**. A payout contract can enforce exact satoshi distribution. CashScript exposes this as `tx.inputs[i].value`, `tx.outputs[i].value`, `tx.outputs[i].lockingBytecode`, `tx.locktime`. |
| **CashTokens introspection went live 2023-05** (`tx.outputs[i].tokenAmount`, `tokenCategory`, NFT commitment…). | Useful for VM-enforced token rules — but the **NFT commitment field is capped at 40 bytes**, too small to store even a 3-node roster. On-chain mutable membership via NFT state is therefore **out**. |
| **`OP_DIV` / `OP_MOD` are live** (May 2018 re-enable) and CashScript supports `/` and `%`. | In-script averaging is *possible* in principle — but computing a score matrix, exclusions holstered and rounding inside a redeem script is an audit nightmare for zero added security. Averaging stays **off-chain**. |
| **SLP is enforced off-chain.** Token state lives in OP_RETURN and is derived by indexers (SLPDB, psf-slp-indexer); the Script VM has **no hooks** into SLP state. A redeem script cannot gate spending on SLP conditions without an oracle attestation. | SLP cannot be the enforcement layer for payment contracts — but it is **ideal as the identity/reputation layer**: NFTs as node homing beacons, mutable data as the score/roster ledger, all already indexed by infra we run. |
| **SolidCash** (Solidity-syntax for BCH Script; SolidSwap “ERC-20 DEX” and SolidPool “ZK private payments” live on mainnet) does **not** run EVM bytecode; “ERC20 on BCH” is fungible CashTokens under a wrapper; its own docs flag unauthenticated `msg.sender` under the default convention (finding F1) and a 10,000-byte per-input script limit at marketplace scale (“mocknet beta”). | ERC20/SolidCash does **not** escape Bitcoin Script's semantics and is **shelved** for a fund-holding contract. CashScript + Bitauth (years of deployed tooling) remains the default. |

**Decisions that follow:**

1. **No tokens in the money path.** Users pay BCH, the pool holds BCH, settlement
   distributes BCH.
2. **SLP NFTs for tracking, auditing, and reputation** — off-chain but
   on-chain-auditable.
3. **CashScript for the vault/settlement contract** — the only layer that
   *enforces* anything about money movement.
4. **Averaging lives off-chain** as deterministic, public, recomputable math.

## 3. Architecture

```
┌───────────────────────────  OFF-CHAIN  ───────────────────────────┐
│  SLP identity NFTs (homing beacons)  roster · score attestations   │
│  psf-slp-indexer / block-indexer → auditable trail                 │
│  Aggregator: averages → payout vector (anyone can recompute)       │
└───────────────────────────────────────────────────────────────────┘
                                  │ signed by quorum of members
                                  ▼
┌───────────────────────────  ON-CHAIN  ─────────────────────────────┐
│  Pool (P2SH32): users' per-pin BCH payments accumulate all month    │
│  Settlement tx (monthly):                                           │
│    • ≥K member signatures over exact tx  (anti-theft)              │
│    • outputs only to registered member P2PKH + treasury              │
│    • sum(outputs) == sum(pool inputs) − bounded fee                 │
│    • CLTV monthly window (no early settlement)                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Division of labor, in one line:**
> *SLP records who earned what (tracking, auditing).*  
> *Script enforces who can move the money (payment contracts).*

### 3.1 Money flow

- The per-pin pricing stays exactly as today (sats/MB quote from pin-service).
  The only change: the payout target becomes the **pool address (P2SH32)** instead
  of a single node wallet.
- Payments accumulate as ordinary BCH UTXOs locked by the pool contract.
- Once a month, a single **settlement transaction** spends **all** pool UTXOs
  into one output per node + a small treasury/fee output. Late payments simply
  roll into the next month's pool.
- No per-payment bookkeeping, no token conversion, no burn.

### 3.2 The reputation/roster layer (SLP)

- Each member node owns an **SLP NFT identity** — its *homing beacon*. NFT
  mutable data carries pointers (endpoints, payout addresses, pubkeys) that
  off-chain scripts can follow.
- Each month, each member posts a **signed score attestation** — its key signs
  `{month, score for each other active node}`. Attestations go on-chain
  (OP_RETURN / NFT data), so they are public, indexer-queryable, and
  non-repudiable.
- The **active set** for a month = the nodes with valid signed submissions that
  month. Roster churn (3→10 nodes) requires no contract change.

### 3.3 The settlement contract (CashScript)

The contract does **not** know the roster or compute averages. Its rules are
deliberately minimal:

1. **Authorization** — ≥K member signatures over the exact settlement
   transaction (`checkSig` per member, counted). Signing the tx binds every
   output and amount; a single node cannot overpay itself.
2. **Destination control** — every output must lock to a registered member's
   P2PKH (or the treasury). `LockingBytecodeP2PKH` comparison, no siphoning.
3. **Amount integrity** — sum of outputs == sum of pool inputs − bounded fee.
   Script reads inputs/outputs via introspection. (Script can't read the miner
   fee directly; use a hardcoded/bounded fee like CashScript's Escrow/Mecenas
   examples.)
4. **Monthly window** — a CLTV/timelock gate prevents early settlement.

### 3.4 Variable node count (3–10)

- The contract is **roster-agnostic**: "10" is a network *policy* cap (biz-plan
  M12), never a contract constant.
- **Tier 1 (recommended to start):** committee-gated vault — deploy with a
  *small* threshold (e.g. ≥3-of-5 founding keys) as the anti-theft floor, not a
  node count. As N varies (3, 6, 8, 10), the payout vector changes shape
  monthly; **zero redeploys**.
- **Tier 2 (only if we later want the chain itself to refuse paying a
  non-member):** per-generation pools. Membership change = deploy a new pool
  generation, and the old generation's governance function sweeps its remainder
  to the new address. Uses the same payout-address hot-swap plumbing the
  pin-service/stager already has.

### 3.5 Why the average is off-chain

- Score attestations must be public anyway for anyone to recompute trust.
- Aggregation rules (exclude self, submission quorum, rounding fixed as
  largest-remainder, sats remainder → treasury) are deterministic and trivial in
  normal code.
- The contract cannot be the source of truth for "the average is correct" — that
  truth lives in the public attestations. What the contract *adds* is binding
  the settlement to member signatures and restricting destinations.

## 4. End-to-end monthly flow (sketch)

1. **Node identity.** Each member mints/owns an SLP NFT identity (homing beacon)
   and registers its pubkey + payout pkh in the signed roster.
2. **Deposits.** Users pin files at the existing sats/MB quote and pay the pool
   address. (The pin-service/stager validate BCH payments exactly as today.)
3. **Attestations (month-end).** Each member signs `{month, scores[others]}` and
   posts it on-chain. Anyone can verify each signature against the roster.
4. **Aggregation (off-chain).** The aggregator:
   - determines the active set (nodes with valid submissions);
   - computes each node's average score (self excluded; non-submitters
     excluded; optional outlier rules);
   - computes payout shares ∝ averages against the on-chain pool balance
     (largest-remainder rounding; remainder → treasury).
5. **Settlement.** A builder constructs the settlement tx (consolidate pool UTXOs
   → member outputs + treasury), members verify it against the published
   attestations and sign, and once ≥K signatures are collected it broadcasts.
   The contract enforces authorization, destinations, amounts, and the monthly
   window; the miner takes only the bounded fee.
6. **Audit.** Any observer can recompute steps 3–4 from public chain data and
   confirm the settlement tx matches.

## 5. Incentives, collusion, and censorship resistance

- **Fixed pool, inflation-proof collusion:** because the pool size is fixed by
  real user payments, "everyone scores everyone high" converges to an *equal
  split* — it does not mint money. The exploit to guard against is a **cartel
  inflating its own clique's share**.
- **Ground scores in objective signals.** Performance reports should attest to
  verifiable facts the system already exposes: `dataPinned` status, availability
  probes, uptime, bytes served, pin counts. "Report on each other" becomes
  "attest to the public record," not vibes.
- **Redundancy floor.** Censorship resistance is the product: scoring should
  include an SLA term rewarding that each CID is pinned/served by ≥3 nodes, so a
  10-node network is actually redundant.
- **Bonds (optional, later).** Each node could lock a bond in the pool
  (timelocked ≥1 month), slashable for proven gaming (self-scoring, claiming
  pins it didn't hold). Operator onboarding is curated, so identity is known —
  no anonymity machinery needed.

## 6. Open questions / risks

- **Settlement liveness.** If <K members are online at month-end the pool waits.
  Mitigations: a multi-day settlement window; a fallback that pro-rates to the
  nodes who did sign and sends the remainder to treasury.
- **Many-UTXO pools.** A popular pool could accumulate hundreds of UTXOs; one
  settlement tx is legal but must be checked against relay/standardness — a
  mid-month consolidation pass may be needed.
- **`checkMultiSig` SDK gap.** CashScript's TS SDK doesn't support it (docs
  recommend simulating with repeated `checkSig`) — budget for custom
  signing/verification glue.
- **P2SH32, not P2SH20**, for the pool hash (CashScript recommends it).
- **Fee bounding.** The exact miner fee can't be read in Script; the contract
  uses a fixed/bounded fee, so signers must sanity-check it off-chain like they
  verify amounts.
- **Roster exit/entry.** Tier 1 handles churn via the off-chain roster, but a
  *hostile* former member retains a key. K≥3 of 5 defends against this; true
  key removal is a Tier-2 / new-generation event.

## 7. Suggested rollout (no-build order)

1. **A — Attestation + aggregation tool.** Signed score attestations on-chain,
   a public aggregation library, while payouts still go to the single wallet.
   Gets the reputation ledger live with zero contract risk.
2. **B — Vault contract + quorum settlement.** Tier-1 committee-gated pool;
   monthly settlement as §4.
3. **C — Bonds + objective score kernels** (probes, redundancy-floor SLA).
4. **Tier-2 (later, optional):** per-generation pools if on-chain membership
   enforcement becomes a requirement.

## 8. References

- BCH upgrades / Native Introspection: https://docs.bitcoincashnode.org/doc/bch-upgrades/
- CashScript introspection & covenants: https://cashscript.org/docs/language/globals/ · /docs/design/covenants
- CashTokens NFT commitment (40-byte cap): https://cashtokens.org/docs/spec/rationale/
- SolidCash status/limitations: https://github.com/solidcash/solidcash
- Prev design: [why-cashscript.md](why-cashscript.md)
