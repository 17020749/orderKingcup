import fs from 'node:fs'
import path from 'node:path'

const workflowPath = path.resolve(process.cwd(), '.github/workflows/warehouse-ci.yml')
let source = fs.readFileSync(workflowPath, 'utf8')

const prepareAnchor = `      - name: Prepare Nuxt
        run: npx --no-install nuxi prepare

      - name: Build
`
const prepareReplacement = `      - name: Prepare Nuxt
        run: npx --no-install nuxi prepare

      - name: Validate Firestore Rules REST fallback
        run: node --check scripts/deploy-firestore-rules-rest.mjs

      - name: Build
`

if (!source.includes('Validate Firestore Rules REST fallback')) {
  if (!source.includes(prepareAnchor)) {
    throw new Error('Không tìm thấy vị trí chèn kiểm tra fallback REST.')
  }
  source = source.replace(prepareAnchor, prepareReplacement)
}

const oldFinalAttempt = `            if [ "$attempt" -eq 4 ]; then
              echo "::error::Firestore Rules deployment failed after 4 transient attempts."
              exit "$status"
            fi
`
const newFinalAttempt = `            if [ "$attempt" -eq 4 ]; then
              echo "::warning::Firebase CLI vẫn lỗi tạm thời sau 4 lần. Chuyển sang Firestore Rules REST fallback."
              node scripts/deploy-firestore-rules-rest.mjs
              exit $?
            fi
`

const occurrences = source.split(oldFinalAttempt).length - 1
if (occurrences > 0) {
  source = source.split(oldFinalAttempt).join(newFinalAttempt)
} else if (!source.includes('Chuyển sang Firestore Rules REST fallback')) {
  throw new Error('Không tìm thấy block retry cuối cần thay bằng REST fallback.')
}

fs.writeFileSync(workflowPath, source)
console.log(`Đã gắn REST fallback vào ${occurrences || 2} bước deploy Rules.`)
