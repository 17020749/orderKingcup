import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isActiveOrderRelation,
  selectCanonicalInvoice,
} from '../utils/orderRelationState.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoDir = path.resolve(scriptDir, '..')
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
const projectId = process.env.FIREBASE_PROJECT_ID || 'orderfirestore-501909'
const applyChanges = process.argv.includes('--apply')
const limitArg = process.argv.find(value => value.startsWith('--limit='))
const orderLimit = limitArg ? Math.max(0, Number(limitArg.slice('--limit='.length)) || 0) : 0

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
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
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
  )
}

function encodeValue(value) {
  if (value === null) return { nullValue: null }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } }
  }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value }
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: encodeFields(value) } }
  }
  return { stringValue: String(value ?? '') }
}

function encodeFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]),
  )
}

function documentId(name) {
  return String(name || '').split('/').at(-1) || ''
}

function decodeDocument(document) {
  return {
    ...decodeFields(document.fields),
    id: documentId(document.name),
    name: document.name,
    updateTime: document.updateTime,
  }
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
      grant_type: 'urn:ietf:params:oauth2:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!response.ok) throw new Error(`OAuth token request failed: ${response.status} ${await response.text()}`)
  return (await response.json()).access_token
}

async function firestoreRequest(token, endpoint, options = {}) {
  const documentEndpoint = endpoint.startsWith(':') ? `documents${endpoint}` : `documents/${endpoint}`
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/${documentEndpoint}`,
    {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    },
  )
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
  return documents.map(decodeDocument)
}

function groupActiveInvoices(invoices) {
  const groups = new Map()
  for (const invoice of invoices.filter(isActiveOrderRelation)) {
    const orderId = String(invoice.order_id || '').trim()
    if (!orderId) continue
    if (!groups.has(orderId)) groups.set(orderId, [])
    groups.get(orderId).push(invoice)
  }
  return groups
}

function updateWrite(document, fields) {
  return {
    update: {
      name: document.name,
      fields: encodeFields(fields),
    },
    updateMask: {
      fieldPaths: Object.keys(fields),
    },
    ...(document.updateTime
      ? { currentDocument: { updateTime: document.updateTime } }
      : {}),
  }
}

async function commitCandidate(token, candidate, actor) {
  const now = new Date()
  const duplicateWrites = candidate.duplicates.map(invoice => updateWrite(invoice, {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: now,
    updated_at: now,
  }))
  const parentWrite = updateWrite(candidate.order, {
    invoice_record_count: 1,
    invoice_status: candidate.canonical.invoice_status || 'Không xuất',
    relation_last_module: 'all',
    relation_last_action: 'reconcile',
    relation_last_document_id: '',
    relation_updated_by: actor,
    relation_updated_at: now,
    updated_at: now,
  })
  const writes = [...duplicateWrites, parentWrite]
  if (writes.length > 500) {
    throw new Error(`Order ${candidate.orderId} has ${writes.length} writes; manual cleanup is required.`)
  }
  await firestoreRequest(token, ':commit', {
    method: 'POST',
    body: JSON.stringify({ writes }),
  })
}

async function main() {
  const account = await loadServiceAccount()
  if (account.project_id && account.project_id !== projectId) {
    throw new Error(`Service account project ${account.project_id} does not match FIREBASE_PROJECT_ID ${projectId}.`)
  }
  const token = await getAccessToken(account)
  const [orders, invoices] = await Promise.all([
    listDocuments(token, 'orders'),
    listDocuments(token, 'invoices'),
  ])
  const orderMap = new Map(orders.map(order => [order.id, order]))
  const candidates = []
  const missingParents = []

  for (const [orderId, activeInvoices] of groupActiveInvoices(invoices)) {
    if (activeInvoices.length <= 1) continue
    const canonical = selectCanonicalInvoice(activeInvoices)
    const order = orderMap.get(orderId)
    if (!order) {
      missingParents.push({
        orderId,
        invoiceIds: activeInvoices.map(invoice => invoice.id),
      })
      continue
    }
    candidates.push({
      orderId,
      order,
      canonical,
      duplicates: activeInvoices.filter(invoice => invoice.id !== canonical.id),
    })
  }

  const selected = orderLimit ? candidates.slice(0, orderLimit) : candidates
  console.log(JSON.stringify({
    projectId,
    mode: applyChanges ? 'apply' : 'dry-run',
    inspectedOrders: orders.length,
    inspectedInvoices: invoices.length,
    duplicateOrders: candidates.length,
    selectedOrders: selected.length,
    invoicesToSoftDelete: selected.reduce((sum, item) => sum + item.duplicates.length, 0),
    missingParents,
    sample: selected.slice(0, 10).map(item => ({
      orderId: item.orderId,
      keepInvoiceId: item.canonical.id,
      softDeleteInvoiceIds: item.duplicates.map(invoice => invoice.id),
    })),
  }, null, 2))

  if (!applyChanges) {
    console.log('Dry-run only. Re-run with --apply after reviewing the candidate list.')
    return
  }

  const actor = String(account.client_email || '').trim().toLowerCase()
  for (const candidate of selected) {
    await commitCandidate(token, candidate, actor)
  }
  console.log(`Applied invoice deduplication for ${selected.length} orders.`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
