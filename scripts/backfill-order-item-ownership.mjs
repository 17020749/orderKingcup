import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoDir = path.resolve(scriptDir, '..')
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
const projectId = process.env.FIREBASE_PROJECT_ID || 'orderfirestore-501909'
const applyChanges = process.argv.includes('--apply')
const limitArg = process.argv.find(value => value.startsWith('--limit='))
const itemLimit = limitArg ? Math.max(0, Number(limitArg.slice('--limit='.length)) || 0) : 0

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function encodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => ({
    [key]: { stringValue: String(value) },
  })))
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') return undefined
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('booleanValue' in value) return value.booleanValue
  if ('timestampValue' in value) return value.timestampValue
  if ('nullValue' in value) return null
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue)
  return undefined
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]))
}

function documentId(name) {
  return String(name || '').split('/').at(-1) || ''
}

async function loadServiceAccount() {
  if (!serviceAccountPath) {
    throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path before running the migration.')
  }
  return JSON.parse(await fs.readFile(path.resolve(repoDir, serviceAccountPath), 'utf8'))
}

async function getAccessToken(account) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const unsigned = `${header}.${claim}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  const assertion = `${unsigned}.${signer.sign(account.private_key, 'base64url')}`
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!response.ok) throw new Error(`OAuth token request failed: ${response.status} ${await response.text()}`)
  return (await response.json()).access_token
}

async function firestoreRequest(token, endpoint, options = {}) {
  const documentEndpoint = endpoint.startsWith(':') ? `documents${endpoint}` : `documents/${endpoint}`
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/${documentEndpoint}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (!response.ok) throw new Error(`Firestore request failed: ${response.status} ${await response.text()}`)
  return response.status === 204 ? null : response.json()
}

async function listDocuments(token, collectionName) {
  const documents = []
  let pageToken = ''
  do {
    const query = new URLSearchParams({ pageSize: '1000' })
    if (pageToken) query.set('pageToken', pageToken)
    const page = await firestoreRequest(token, `${collectionName}?${query}`)
    documents.push(...(page.documents || []))
    pageToken = page.nextPageToken || ''
  } while (pageToken)
  return documents
}

function missingOwnershipPatch(item, order) {
  const patch = {}
  for (const field of ['owner_email', 'created_by', 'sale_email']) {
    const itemValue = String(item[field] || '').trim()
    const orderValue = String(order?.[field] || '').trim()
    if (!itemValue && orderValue) patch[field] = orderValue
  }
  return patch
}

async function commitPatches(token, patches) {
  for (let index = 0; index < patches.length; index += 500) {
    const batch = patches.slice(index, index + 500)
    await firestoreRequest(token, ':commit', {
      method: 'POST',
      body: JSON.stringify({
        writes: batch.map(({ name, fields }) => ({
          update: { name, fields: encodeFields(fields) },
          updateMask: { fieldPaths: Object.keys(fields) },
        })),
      }),
    })
  }
}

async function main() {
  const account = await loadServiceAccount()
  if (account.project_id && account.project_id !== projectId) {
    throw new Error(`Service account project ${account.project_id} does not match FIREBASE_PROJECT_ID ${projectId}.`)
  }
  const token = await getAccessToken(account)
  const [orderDocuments, itemDocuments] = await Promise.all([
    listDocuments(token, 'orders'),
    listDocuments(token, 'order_items'),
  ])
  const orders = new Map(orderDocuments.map(document => [documentId(document.name), decodeFields(document.fields)]))
  const candidates = []
  let inspected = 0
  let skippedWithoutParent = 0

  for (const document of itemDocuments) {
    if (itemLimit && inspected >= itemLimit) break
    inspected += 1
    const item = decodeFields(document.fields)
    const order = orders.get(String(item.order_id || '').trim())
    if (!order) {
      skippedWithoutParent += 1
      continue
    }
    const fields = missingOwnershipPatch(item, order)
    if (Object.keys(fields).length) candidates.push({ name: document.name, fields })
  }

  console.log(JSON.stringify({
    projectId,
    mode: applyChanges ? 'apply' : 'dry-run',
    inspected,
    candidates: candidates.length,
    skippedWithoutParent,
    sample: candidates.slice(0, 10),
  }, null, 2))

  if (applyChanges && candidates.length) {
    await commitPatches(token, candidates)
    console.log(`Applied ${candidates.length} order_items ownership patches.`)
  } else if (!applyChanges) {
    console.log('Dry-run only. Re-run with --apply after reviewing the candidate list.')
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
