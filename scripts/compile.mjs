#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileFile } from 'cashc'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const contractsDir = join(root, 'contracts')
const artifactsDir = join(root, 'artifacts')

mkdirSync(artifactsDir, { recursive: true })

const files = ['ShareContract.cash', 'PoolContract.cash']

for (const file of files) {
  const src = join(contractsDir, file)
  const artifact = compileFile(src)
  const outName = file.replace(/\.cash$/, '.json')
  const outPath = join(artifactsDir, outName)
  writeFileSync(outPath, JSON.stringify(artifact, null, 2) + '\n')
  console.log(`compiled ${file} -> artifacts/${outName}`)
}
