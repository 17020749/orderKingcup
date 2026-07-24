import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const workflowPath = '.github/workflows/warehouse-ci.yml'
let source = readFileSync(workflowPath, 'utf8')
const anchor = `          projectId: \${{ steps.firebase_config.outputs.project_id }}
          expires: 7d`
const replacement = `          projectId: \${{ steps.firebase_config.outputs.project_id }}
          channelId: pr-\${{ github.event.pull_request.number }}
          expires: 7d`
const count = source.split(anchor).length - 1
if (count !== 1) throw new Error(`Expected one preview deploy block, found ${count}`)
source = source.replace(anchor, replacement)
writeFileSync(workflowPath, source)

for (const path of [
  'scripts/patch-preview-channel.mjs',
  '.github/workflows/patch-preview-channel.yml',
]) {
  try { unlinkSync(path) } catch {}
}
