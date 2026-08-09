#!/usr/bin/env node
/**
 * Print deterministic P2SH32 addresses from a deploy config (read-only).
 *
 * Usage:
 *   node scripts/addresses.mjs [config/deploy.mainnet.json]
 */
import {
  loadDeployConfig,
  createProvider,
  instantiateContracts,
  buildDeploymentRecord,
  root
} from './lib.mjs'
import { join } from 'node:path'

const configPath = process.argv[2] || join(root, 'config', 'deploy.mainnet.json')
const cfg = loadDeployConfig(configPath)
const provider = createProvider(cfg.network || 'mainnet')
const inst = instantiateContracts(cfg, provider)
const record = buildDeploymentRecord(cfg, inst)

console.log(JSON.stringify({
  network: record.network,
  poolAddress: record.poolAddress,
  shares: record.nodes.map((n) => ({
    name: n.name,
    shareAddress: n.shareAddress,
    pkh: n.pkh
  })),
  splitBlockheight: record.splitBlockheight,
  minConsolidation: record.minConsolidation,
  artifacts: record.artifacts
}, null, 2))
