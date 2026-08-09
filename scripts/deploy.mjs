#!/usr/bin/env node
/**
 * Instantiate contracts against the configured network and write a deployment record.
 * Does not broadcast or move funds — funding is a normal send to poolAddress.
 *
 * Usage:
 *   node scripts/deploy.mjs [config/deploy.mainnet.json]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadDeployConfig,
  createProvider,
  instantiateContracts,
  buildDeploymentRecord,
  root
} from './lib.mjs'

const configPath = process.argv[2] || join(root, 'config', 'deploy.mainnet.json')
const cfg = loadDeployConfig(configPath)

if ((cfg.network || 'mainnet') === 'mainnet') {
  const placeholder = /^0{40}$|^1{40}$|^2{40}$|^3{40}$/i
  if (placeholder.test(cfg.treasuryPkh) || cfg.nodes.some((n) => placeholder.test(n.pkh) || /^(02a+|02b+|02c+)/i.test(n.pubkey))) {
    console.warn('WARNING: config still looks like example placeholders. Replace with real keys before funding.')
  }
}

const provider = createProvider(cfg.network || 'mainnet')
const inst = instantiateContracts(cfg, provider)
const record = buildDeploymentRecord(cfg, inst)

const outDir = join(root, 'deployments')
mkdirSync(outDir, { recursive: true })
const stamp = record.createdAt.replace(/[:.]/g, '-')
const outPath = join(outDir, `${stamp}.json`)
writeFileSync(outPath, JSON.stringify(record, null, 2) + '\n')

console.log(JSON.stringify({
  wrote: outPath,
  poolAddress: record.poolAddress,
  shareAddresses: record.nodes.map((n) => n.shareAddress),
  splitBlockheight: record.splitBlockheight,
  artifacts: record.artifacts
}, null, 2))

console.log(`
Next steps:
  1. Verify addresses match: npm run addresses -- ${configPath}
  2. Smoke-fund poolAddress with a small intentional amount
  3. Exercise consolidate / split / claim before accepting production deposits
`)
