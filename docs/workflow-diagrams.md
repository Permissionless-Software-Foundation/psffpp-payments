# Workflow diagrams — file pinning from three stakeholder perspectives

> **Status: DRAFT** — companion to [performance-weighted-payouts.md](
> performance-weighted-payouts.md). These Mermaid diagrams describe the same
> process from three different points of view: the end user who wants a file
> hosted, the node runner who wants a payout, and the operator who deploys and
> runs the infrastructure. Rendered natively by GitHub / GitLab / VS Code on any
> Markdown view; export to PNG/SVG with `mmdc` (mermaid-cli) if an image is
> needed elsewhere.

## System map (shared vocabulary)

Every network node is an operator's own full Cash Stack:

```
┌─────────────────────────── operator's box ───────────────────────────┐
│  BCH full node (BCHN) + ZMQ ──▶ psf-slp-indexer-g2                    │
│                                        │ webhook (local, 172.17.0.1)  │
│                                        ▼                              │
│  MongoDB ◀──── ipfs-file-pin-service ──▶ Helia/libp2p (helia-coord)    │
│                                        │                              │
│  payoutAddress / satsPerMb             │  libp2p content mesh         │
└────────────────────────────────────────┼──────────────────────────────┘
                                          │ peers: fetch content from each other
                                BCH blockchain (public, shared truth)
```

- One operator's outage never affects another node's ability to index, validate,
  or pin: each node reads the chain from **its own** full node and serves claims
  to **its own** local pin-service.
- The only node-to-node interaction is the **libp2p content mesh** (fetching
  file bytes from peers) and the **public BCH chain** (shared source of truth
  for payments and claims). Both are already decentralized.

---

## Diagram 1 — End-User perspective: "I want this file hosted"

```mermaid
sequenceDiagram
    autonumber
    participant U as End-User / client
    participant S as ipfs-file-stager
    participant B as BCH chain (shared truth)
    participant I as psf-slp-indexer-g2 (every node)
    participant P as ipfs-file-pin-service (every node)
    participant F as IPFS swarm / helia-coord mesh

    U->>S: 1. POST /ipfs/upload (file)
    S->>F: 2. add file to IPFS → compute CID
    S-->>U: 3. CID
    U->>S: 4. POST /ipfs/getBchCost {sizeInMb}
    S->>P: 5. GET /ipfs/payment-address
    P-->>S: 6. { payoutAddress, satsPerMb }
    S-->>U: 7. quote { payoutAddress, satsRequired }
    U->>B: 8. send BCH → payoutAddress
    B-->>U: 9. paymentTxid
    U->>S: 10. POST /ipfs/createPinClaim { cid, filename, paymentTxid }
    S->>B: 11. verify payment really pays payoutAddress
    S->>B: 12. broadcast OP_RETURN claim (psffpp.createPinClaimBCH)
    B-->>S: 13. claimTxid
    B->>I: 14. block/ZMQ: claim 00510000 detected
    I->>P: 15. webhook POST /ipfs/pin-claim (fire-and-forget)
    P->>B: 16. re-fetch + verify payment TX (fails closed: F1–F8)
    P->>F: 17. download CID from any peer (direct dial)
    P->>P: 18. validate real size vs satsPaid (98% tolerance)
    P->>F: 19. pin + DHT provide
    U->>P: 20. GET /ipfs/pin-status/:cid ⇒ dataPinned: true
    F-->>U: 21. content served at /ipfs/view/:cid
```

Read: the user **pays once**, the claim is **broadcast once**, and every node's
indexer+pin-service pair independently repeats steps 14–19. That repetition — N
times over — is what produces N redundant copies and "collectively pin content".

---

## Diagram 2 — Node-runner perspective: "I want a payout for running a node"

```mermaid
flowchart TD
    A["Run own full Cash Stack (full node + indexer + pin-service)"] --> B
    subgraph DAILY ["Daily / continuous — doing the work"]
        B["Index claims from own chain feed"]
        B --> C["Validate BCH payments (payout address, size, 98% rule)"]
        C --> D["Fetch content via mesh and pin it"]
        D --> E["Serve content + announce on DHT"]
    end
    E --> F["Monthly: own SLP NFT identity = homing beacon"]
    F --> G["Sign score attestations { month, score for each other node }"]
    G --> H["Post attestations on-chain (public, non-repudiable)"]
    H --> I["Aggregator: mean score per node (self excluded)"]
    I --> J["Payout vector ∝ mean scores (largest-remainder, sats → treasury)"]
    J --> K["Settlement tx: pool UTXOs → member P2PKH + treasury"]
    K --> L["≥K member signatures over the exact tx"]
    L --> M["Broadcast settlement (CLTV monthly window, outputs guarded)"]
    M --> N["Receive BCH payout ∝ performance"]

    style A fill:#eef6ff
    style N fill:#e8ffe8
```

Read: the node runner's payout is **proportional to attested performance**, where
the attestations cite objective, publicly verifiable facts (files pinned, bytes
served, uptime) — not vibes. Collusion is capped: the pool is fixed by real user
payments, so "everyone scores everyone high" converges to an equal split and mints
nothing.

---

## Diagram 3 — Operator perspective: "I'm setting up one node of the network"

```mermaid
flowchart TD
    A["Provision a box: OS, Docker, storage"] --> B["Run BCH full node (BCHN) + enable ZMQ"]
    B --> C["Deploy psf-slp-indexer-g2 (own chain feed)"]
    C --> D["Deploy ipfs-file-pin-service (own Mongo, own wallet)"]
    D --> E["Configure: PAYOUT_ADDRESS, SATS_PER_MB, payout wallet"]
    E --> F["Connect to pin network (helia-coord)"]
    F --> F1["BOOTSTRAP_SERVERS: find initial peers"]
    F --> F2["ANNOUNCE_MULTIADDRS: advertise direct dial addr"]
    F --> F3["wireguard/proxy: expose REST + libp2p addrs"]
    F1 & F2 & F3 --> G["Indexer webhook → local pin-service (172.17.0.1:5031)"]
    G --> H["Register in federation: SLP NFT identity + roster pubkey"]
    H --> I["Operation loop: monitor pins, retries, peer health, DHT announce"]
    I --> J["Monthly: sign attestations, receive score-weighted payout"]

    style A fill:#f6eee2
    style J fill:#e8ffe8
```

Read: everything this node needs is **on the operator's own box** — full node,
ZMQ, indexer, pin-service, Mongo, wallet. No other operator's uptime, indexer, or
API key is required. Independence is the failure-resilience property; the mesh
and the chain are the only cross-operator surfaces.

---

## Rendering notes

- **Mermaid** (text-in-repo) is the primary format: versionable, diffable, and
  rendered natively by GitHub/GitLab/VS Code with zero tooling.
- To export PNG/SVG/images for external docs or chat, render locally:

  ```
  npx -y @mermaid-js/mermaid-cli -i docs/workflow-diagrams.md -o out.png
  ```

- Pair each diagram with a one-line "read:" note (above) so reviewers understand
  which property each workflow exists to guarantee.
