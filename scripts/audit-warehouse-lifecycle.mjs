import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { auditWarehouseLifecycle } from '../utils/warehouseLifecycleAudit.mjs'

const projectId = process.env.FIREBASE_PROJECT_ID || 'orderfirestore-501909'
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!credentialsPath) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON file. This command is read-only.')

const account = JSON.parse(await fs.readFile(path.resolve(credentialsPath), 'utf8'))
if (account.project_id && account.project_id !== projectId) throw new Error(`Credential project ${account.project_id} does not match ${projectId}.`)

const base64url = value => Buffer.from(value).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({
  iss: account.client_email,
  scope: 'https://www.googleapis.com/auth/datastore',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
}))}`
const signer = crypto.createSign('RSA-SHA256')
signer.update(unsigned)
signer.end()
const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signer.sign(account.private_key, 'base64url')}` }),
})
if (!tokenResponse.ok) throw new Error(`OAuth failed: ${tokenResponse.status} ${await tokenResponse.text()}`)
const token = (await tokenResponse.json()).access_token

function decode(value) {
  if (!value) return undefined
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('booleanValue' in value) return value.booleanValue
  if ('timestampValue' in value) return value.timestampValue
  if ('nullValue' in value) return null
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
}
const decodeFields = fields => Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decode(value)]))

async function list(collectionName) {
  const output = []
  let pageToken = ''
  do {
    const query = new URLSearchParams({ pageSize: '1000' })
    if (pageToken) query.set('pageToken', pageToken)
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}?${query}`, { headers: { authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error(`Reading ${collectionName} failed: ${response.status} ${await response.text()}`)
    const page = await response.json()
    output.push(...(page.documents || []).map(document => ({ id: document.name.split('/').at(-1), ...decodeFields(document.fields) })))
    pageToken = page.nextPageToken || ''
  } while (pageToken)
  return output
}

const [requests, exportOrders, exportItems, operations, orders] = await Promise.all([
  list('order_export_requests'), list('export_orders'), list('export_order_items'), list('warehouse_operations'), list('orders'),
])
const report = auditWarehouseLifecycle({ requests, exportOrders, exportItems, operations, orders })
console.log(JSON.stringify({ projectId, mode: 'dry-run', ...report }, null, 2))
if (report.findings.length) process.exitCode = 2
