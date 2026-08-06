import fs from 'node:fs'
import path from 'node:path'

const workflowPath = path.resolve(process.cwd(), '.github/workflows/warehouse-ci.yml')
let source = fs.readFileSync(workflowPath, 'utf8')

const previewAnchor = `    runs-on: ubuntu-latest
    timeout-minutes: 30
    environment:
      name: dev
`
const previewReplacement = `    runs-on: ubuntu-latest
    timeout-minutes: 30
    concurrency:
      group: firebase-rules-staging
      cancel-in-progress: false
    environment:
      name: dev
`

if (!source.includes('group: firebase-rules-staging')) {
  if (!source.includes(previewAnchor)) {
    throw new Error('Không tìm thấy vị trí concurrency của preview_dev.')
  }
  source = source.replace(previewAnchor, previewReplacement)
}

const liveAnchor = `    runs-on: ubuntu-latest
    timeout-minutes: 30
    environment:
      name: \${{ ((github.event_name == 'workflow_dispatch' && inputs.target == 'production') || (github.event_name == 'push' && github.ref == 'refs/heads/main')) && 'production' || 'dev' }}
`
const liveReplacement = `    runs-on: ubuntu-latest
    timeout-minutes: 30
    concurrency:
      group: firebase-rules-\${{ ((github.event_name == 'workflow_dispatch' && inputs.target == 'production') || (github.event_name == 'push' && github.ref == 'refs/heads/main')) && 'production' || 'staging' }}
      cancel-in-progress: false
    environment:
      name: \${{ ((github.event_name == 'workflow_dispatch' && inputs.target == 'production') || (github.event_name == 'push' && github.ref == 'refs/heads/main')) && 'production' || 'dev' }}
`

if (!source.includes("group: firebase-rules-${{ ((github.event_name")) {
  if (!source.includes(liveAnchor)) {
    throw new Error('Không tìm thấy vị trí concurrency của deploy_live.')
  }
  source = source.replace(liveAnchor, liveReplacement)
}

const oldPattern = `'HTTP Error: (429|500|502|503|504)|service is currently unavailable|temporarily unavailable'`
const newPattern = `'HTTP Error: (429|500|502|503|504)|HTTP Error: 409, Requested entity already exists|service is currently unavailable|temporarily unavailable'`

const patternCount = source.split(oldPattern).length - 1
if (patternCount > 0) {
  source = source.split(oldPattern).join(newPattern)
} else if (!source.includes(newPattern)) {
  throw new Error('Không tìm thấy regex lỗi Firebase tạm thời cần mở rộng.')
}

fs.writeFileSync(workflowPath, source)
console.log('Đã serialize deploy Rules và retry chính xác lỗi release 409.')
