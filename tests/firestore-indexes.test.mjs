import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  inventorySourceQueries,
  validateIndexDocument,
  validateRepository,
} from '../scripts/firestore-index-validation.mjs'

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kingcup-indexes-'))
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return root
}

const firebaseJson = JSON.stringify({ firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' } })

function indexFile(indexes = []) {
  return JSON.stringify({ indexes, fieldOverrides: [] }, null, 2)
}

test('accepts a declared composite index used by source query', () => {
  const root = fixture({
    'firebase.json': firebaseJson,
    'firestore.indexes.json': indexFile([{ collectionGroup: 'orders', queryScope: 'COLLECTION', fields: [
      { fieldPath: 'owner_email', order: 'ASCENDING' },
      { fieldPath: 'created_at', order: 'DESCENDING' },
    ] }]),
    'pages/orders.vue': "getDocs(query(collection(db, 'orders'), where('owner_email', '==', email), orderBy('created_at', 'desc')))\n",
  })
  const result = validateRepository(root)
  assert.equal(result.requiredCompositeCount, 1)
  assert.equal(result.missingCompositeCount, 0)
})

test('fails when a source query needs a missing composite index', () => {
  const root = fixture({
    'firebase.json': firebaseJson,
    'firestore.indexes.json': indexFile(),
    'pages/orders.vue': "getDocs(query(collection(db, 'orders'), where('owner_email', '==', email), orderBy('created_at', 'desc')))\n",
  })
  assert.throws(() => validateRepository(root), /Thiếu composite index/)
})

test('does not require a composite index for equality-only or single-field ordering', () => {
  const root = fixture({
    'firebase.json': firebaseJson,
    'firestore.indexes.json': indexFile(),
    'pages/example.vue': [
      "getDocs(query(collection(db, 'orders'), where('owner_email', '==', email)))",
      "getDocs(query(collection(db, 'activity_logs'), orderBy('created_at', 'desc'), limit(300)))",
    ].join('\n'),
  })
  const result = validateRepository(root)
  assert.equal(result.requiredCompositeCount, 0)
})

test('rejects duplicate index definitions', () => {
  const duplicate = { collectionGroup: 'orders', queryScope: 'COLLECTION', fields: [
    { fieldPath: 'owner_email', order: 'ASCENDING' },
    { fieldPath: 'created_at', order: 'DESCENDING' },
  ] }
  const errors = validateIndexDocument({ indexes: [duplicate, duplicate], fieldOverrides: [] })
  assert.ok(errors.some(error => error.includes('trùng')))
})

test('records dynamic query calls for explicit review without inventing an index', () => {
  const root = fixture({
    'composables/useRepo.ts': 'getDocs(query(collectionRef(name), ...constraints))\n',
  })
  const inventory = inventorySourceQueries(root)
  assert.equal(inventory.queries.length, 0)
  assert.equal(inventory.unresolved.length, 1)
})

test('repository deploy workflow is manual, guarded and never uses force', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/firestore-indexes.yml'), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /environment:/)
  assert.match(workflow, /confirm_project_id/)
  assert.match(workflow, /--only firestore:indexes/)
  assert.doesNotMatch(workflow, /--force/)
})
