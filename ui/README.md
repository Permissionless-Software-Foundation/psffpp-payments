# PSFFPP Payments UI

React web app for PSFFPP CashScript payout contracts. Forked from [bch-wallet-web3-spa](https://github.com/Permissionless-Software-Foundation/bch-wallet-web3-spa).

Operators use the built-in BCH wallet to:

- Load federation deploy config (paste/upload JSON)
- Consolidate pool UTXOs
- Split the pool after the height gate
- Cosign share claims and broadcast collected signatures

## Setup

From this directory:

```bash
npm install
npm start
```

Production build:

```bash
npm run build
```

Contract docs live in the parent package: [`../docs/why-cashscript.md`](../docs/why-cashscript.md), [`../docs/infra-changes.md`](../docs/infra-changes.md), [`../docs/ui-deferred.md`](../docs/ui-deferred.md).

## Artifacts

Compiled CashScript artifacts are copied under `src/contracts/artifacts/`. After changing contracts in the parent package, run `npm run compile` there and re-copy the JSON artifacts into this app.

## Config

Paste or upload a deploy JSON matching `../config/deploy.mainnet.example.json` (also mirrored at `src/contracts/deploy.example.json`). Never put private keys in config.
