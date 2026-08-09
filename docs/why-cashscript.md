# Why CashScript for PSFFPP payments

## The problem

The PSF File Pinning Protocol ([PSFFPP](https://psffpp.com)) pays independent IPFS nodes to keep files online. Until now, that payment layer relied on the **PSF token** and a **proof-of-burn** flow:

1. A user burns PSF tokens on Bitcoin Cash.
2. Pinning services detect the burn and treat it as payment.
3. Nodes pin the corresponding file.

That model works, but it is heavier than it needs to be:

- Users must acquire and handle a custom token (historically an SLP token).
- Minting, liquidity, and token tooling sit between the user and the act of paying for storage.
- Value leaves the system when tokens are burned, instead of flowing directly to the people running infrastructure.
- The circular economy around the token is hard to explain, hard to operate, and hard to keep aligned with simple BCH wallets.

What we want instead is straightforward:

- Users pay for pinning with **ordinary BCH**.
- Funds end up with **node operators** who actually host files, plus a small **treasury** cut that sustains the project.
- Rules for who can move money, when, and how much should be **transparent on-chain** and resistant to any single operator misbehaving.

In short: replace PSF-token proof-of-burn with a **pure-BCH distribution mechanism** that is as trustless, transparent, and resilient as a small federation of node operators can reasonably get.

## High-level goals

| Goal | What it means here |
|------|--------------------|
| **Trust-minimized** | No single operator (and no minority) can steal or redirect the pool. Moving value out of shared custody requires a quorum. |
| **Transparent** | Deposit address, payout math, timing, and destinations are visible in public contracts and public transactions. |
| **Resilient** | Pure BCH, immutable covenants, equal shares that can sit unclaimed, and a path to migrate to a new epoch if the operator set or schedule changes. |
| **Simple for users** | Paying for pinning is “send BCH to this address.” No token buy, burn, or special wallet features. |

This is not maximalist “anyone in the world can join the quorum.” It is a **trust-minimized federation**: a small set of known node operators (starting with three), where honesty of a majority is assumed, and the contract makes minority theft or unilateral rule changes impossible.

## What we built

Two CashScript contracts on Bitcoin Cash implement the payment layer:

1. **PoolContract** — the public deposit address. User payments accumulate here.
2. **ShareContract** — one instance per node. After a monthly (epoch) split, each node’s share sits here until a quorum approves payout.

CashScript is used because it lets us write those rules as **immutable covenants**: scripts that only allow specific UTXO transformations. The network validates every spend. There is no upgrade key that silently changes the rules after funds are deposited.

## How the steps achieve the goals

### 1. Users pay with pure BCH

A user (or client app) sends BCH to the PoolContract address. That UTXO is the payment — the functional replacement for proof-of-burn.

- **Transparency:** Anyone can watch the pool address and see deposits.
- **Simplicity:** Standard BCH send. No PSF token, no SLP, no burn ceremony.
- **Resilience:** Payment is native money on BCH; it does not depend on a separate token economy staying liquid or correctly indexed.

### 2. Pool funds can only reshuffle until rules say otherwise

Permissionless **consolidate** merges many small deposits into fewer pool UTXOs, but every output must stay locked in the same pool contract (with a minimum size to discourage dust griefing).

- **Trust-minimized:** Anyone can tidy the pool; nobody can divert funds during consolidation.
- **Resilient:** Dust and fragmentation do not permanently bricks the contract.

### 3. Payout timing and amounts are baked into the contract

When the epoch’s **blockheight** is reached, **split** (also permissionless) divides the pool:

- **20%** to a treasury address
- **80%** into three equal **ShareContract** UTXOs (one per node)

Rounding leftover sats go to treasury so value does not get stuck.

- **Transparency:** Split math and destinations are public and fixed for that deploy.
- **Trust-minimized:** Split cannot run early. It cannot invent new recipients beyond the baked share contracts and treasury. It does not require any operator’s signature.
- **Fairness for nodes:** Equal share of the node allocation; if a node is not approved that month, their share stays in their ShareContract until a quorum later claims it (or remains dormant). There is no redistribution race that rewards political maneuvering over clear rules.

Each Pool deploy is one **payout epoch**. The next month uses a new deploy with a new height, then a quorum can **migrate** leftover pool value forward. That keeps the monthly gate meaningful without pretending an immutable script can change its own clock.

### 4. Paying a node requires a majority of operators

**Claim** on a ShareContract only succeeds with **K-of-M** signatures — for three operators, **2-of-3**. Signatures are ordinary ECDSA. Unused slots are empty; a non-signing operator is simply not counted.

- **Trust-minimized:** One rogue (or compromised) operator cannot pay themselves or rewrite payouts. Two must agree.
- **Transparent:** Approvals are real transaction signatures over a specific claim. The destination is fixed to that node’s payout address in the contract.
- **Resilient:** Unclaimed shares do not vanish from the pool math; they wait. Operators can collect signatures in parallel and broadcast once a quorum is ready.

The same K-of-M pattern unlocks **migrate** when the federation changes membership or starts a new epoch — so continuity does not require a backdoor admin key.

### 5. Rules are immutable; change means redeploy + quorum sweep

CashScript contracts cannot be patched in place. If operators join or leave, or the schedule/treasury policy changes, the federation deploys a new contract set and migrates with K-of-M.

- **Trust-minimized:** No silent upgrade. Changing custody requires the same quorum that guards payouts.
- **Transparent:** Each epoch’s deposit address and constructor parameters are recorded and publishable.
- **Resilient:** Old share UTXOs remain claimable under their own contracts; value is not stranded by a soft fork of social consensus alone.

## What “trustless” means in this design

On a spectrum:

- **Not** a fully open, permissionless validator set.
- **Is** hard enforcement of: deposit → pool-only reshuffles → height-gated split → equal shares → quorum-gated claims/migration.
- **Depends on** a majority of the named operators remaining honest for *approval* decisions (who gets paid this month), not for rewriting economics or draining the pool alone.

That is the practical maximum for a small pinning federation that still needs human judgment about which nodes earned a share.

## Bottom line

PSFFPP’s payment problem is social and economic: get BCH from people who want files pinned to people who pin them, without a custom token and without trusting one custodian.

CashScript covenants give us an on-chain answer that is:

- **pure BCH** for users,
- **rule-bound and public** for auditors,
- **majority-gated** for operator payouts,
- **redeployable by quorum** when the federation evolves.

That is the path from PSF-token proof-of-burn to a clearer, harder-to-corrupt circular economy for decentralized file pinning.
