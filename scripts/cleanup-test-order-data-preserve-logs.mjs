#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

// Safety adapter for the one-time cleanup task.
// Operational documents and inventory rebuild stay in one atomic Firestore
// commit. Historical activity_logs are deliberately preserved because they
// are not part of stock consistency and can make the atomic write exceed the
// safe limit.

const sourcePath = fileURLToPath(new URL('./cleanup-test-order-data.mjs', import.meta.url))
const temporaryPath = join(tmpdir(), `cleanup-test-order-data-${process.pid}-${Date.now()}.mjs`)

const activityLogCollectionPattern = /^\s{4}activity_logs:\s*plan\.selectedActivityLogs,\s*$/m
const summaryPattern = /^(\s{4}inventory_balances_rebuild:\s*plan\.balanceRebuilds\.length,\s*)$/m
const backupPattern = /^(\s{4}selected_documents:\s*selected,\s*)$/m

let source = readFileSync(sourcePath, 'utf8')

if (!activityLogCollectionPattern.test(source)) {
  throw new Error('Không tìm thấy điểm vá activity_logs trong cleanup-test-order-data.mjs. Dừng để tránh chạy sai phiên bản.')
}
if (!summaryPattern.test(source)) {
  throw new Error('Không tìm thấy điểm vá summary trong cleanup-test-order-data.mjs. Dừng để tránh chạy sai phiên bản.')
}
if (!backupPattern.test(source)) {
  throw new Error('Không tìm thấy điểm vá backup trong cleanup-test-order-data.mjs. Dừng để tránh chạy sai phiên bản.')
}

source = source.replace(activityLogCollectionPattern, '')
source = source.replace(
  summaryPattern,
  '    activity_logs_preserved: plan.selectedActivityLogs.length,\n$1',
)
source = source.replace(
  backupPattern,
  '$1\n    preserved_activity_logs: plan.selectedActivityLogs.map(row => row.raw),',
)

writeFileSync(temporaryPath, source, 'utf8')

try {
  const result = spawnSync(process.execPath, [temporaryPath, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })

  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  try {
    rmSync(temporaryPath, { force: true })
  } catch {
    // The operating system will eventually clear its temporary directory.
  }
}
