import fs from 'node:fs'
import path from 'node:path'

const workflowPath = path.resolve(process.cwd(), '.github/workflows/warehouse-ci.yml')
let source = fs.readFileSync(workflowPath, 'utf8')

const retryBody = (stepName) => `      - name: ${stepName}
        shell: bash
        run: |
          set -o pipefail
          for attempt in 1 2 3 4; do
            log_file="$(mktemp)"
            set +e
            npx --no-install firebase deploy \\
              --only firestore:rules \\
              --project "$NUXT_PUBLIC_FIREBASE_PROJECT_ID" \\
              --non-interactive 2>&1 | tee "$log_file"
            status=\${PIPESTATUS[0]}
            set -e

            if [ "$status" -eq 0 ]; then
              rm -f "$log_file"
              exit 0
            fi

            if ! grep -Eq \\
              'HTTP Error: (429|500|502|503|504)|service is currently unavailable|temporarily unavailable' \\
              "$log_file"; then
              rm -f "$log_file"
              exit "$status"
            fi

            rm -f "$log_file"
            if [ "$attempt" -eq 4 ]; then
              echo "::error::Firestore Rules deployment failed after 4 transient attempts."
              exit "$status"
            fi

            delay=$((attempt * 20))
            echo "::warning::Transient Firebase Rules API failure. Retrying in \${delay}s (attempt $((attempt + 1))/4)."
            sleep "$delay"
          done
`

const replacements = [
  {
    old: `      - name: Deploy Firestore Rules to staging
        run: >-
          npx --no-install firebase deploy
          --only firestore:rules
          --project \"$NUXT_PUBLIC_FIREBASE_PROJECT_ID\"
          --non-interactive
`,
    next: retryBody('Deploy Firestore Rules to staging'),
  },
  {
    old: `      - name: Deploy Firestore Rules
        run: >-
          npx --no-install firebase deploy
          --only firestore:rules
          --project \"$NUXT_PUBLIC_FIREBASE_PROJECT_ID\"
          --non-interactive
`,
    next: retryBody('Deploy Firestore Rules'),
  },
]

for (const replacement of replacements) {
  if (!source.includes(replacement.old)) {
    throw new Error(`Không tìm thấy block cần vá: ${replacement.old.split('\n')[0].trim()}`)
  }
  source = source.replace(replacement.old, replacement.next)
}

fs.writeFileSync(workflowPath, source)
console.log('Đã thêm retry có backoff cho hai bước deploy Firestore Rules.')
