import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * sync-firestore-collection.mjs
 *
 * Đồng bộ 1 collection Firestore từ project SOURCE -> TARGET.
 *
 * Đặc điểm:
 * - Không cần cài firebase-admin.
 * - Dùng Firestore REST + Service Account.
 * - Giữ nguyên document ID.
 * - Giữ nguyên kiểu dữ liệu Firestore.
 * - Hỗ trợ collection top-level hoặc nested collection path.
 * - Mặc định DRY-RUN, không ghi gì.
 * - --apply mới ghi thật.
 * - --delete-missing để xóa document ở TARGET không còn trong SOURCE.
 * - Khi copy khác project, DocumentReference trỏ SOURCE sẽ tự đổi sang TARGET
 *   (dùng --keep-references nếu muốn giữ nguyên).
 *
 * LƯU Ý:
 * - Script này đồng bộ DOCUMENT trực tiếp trong collection được chọn.
 * - KHÔNG tự động copy subcollection nằm bên dưới từng document.
 *
 * ============================================================
 * BIẾN MÔI TRƯỜNG
 * ============================================================
 *
 * PowerShell:
 *
 * $env:SOURCE_FIREBASE_PROJECT_ID="orderfirestore-501909"
 * $env:TARGET_FIREBASE_PROJECT_ID="winpeak-cms"
 *
 * $env:SOURCE_GOOGLE_APPLICATION_CREDENTIALS="C:\keys\source.json"
 * $env:TARGET_GOOGLE_APPLICATION_CREDENTIALS="C:\keys\target.json"
 *
 * Ví dụ đồng bộ products:
 *
 * node scripts/sync-firestore-collection.mjs `
 *   --collection=products
 *
 * Chạy thật:
 *
 * node scripts/sync-firestore-collection.mjs `
 *   --collection=products `
 *   --apply `
 *   --confirm-target=winpeak-cms
 *
 * Đổi tên collection ở đích:
 *
 * node scripts/sync-firestore-collection.mjs `
 *   --source-collection=products `
 *   --target-collection=products_backup `
 *   --apply `
 *   --confirm-target=winpeak-cms
 *
 * Mirror chính xác, xóa TARGET doc không còn trong SOURCE:
 *
 * node scripts/sync-firestore-collection.mjs `
 *   --collection=products `
 *   --apply `
 *   --delete-missing `
 *   --confirm-target=winpeak-cms
 *
 * ============================================================
 */

const TOKEN_URI = 'https://oauth2.googleapis.com/token'
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/datastore'
const FIRESTORE_API = 'https://firestore.googleapis.com/v1'
const BATCH_SIZE = 400

function argValue(name) {
  const prefix = `--${name}=`
  const found = process.argv.find(v => v.startsWith(prefix))
  return found ? found.slice(prefix.length).trim() : ''
}

function hasArg(name) {
  return process.argv.includes(`--${name}`)
}

function required(value, message) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(message)
  return normalized
}

function normalizeCollectionPath(value, label) {
  const normalized = required(value, `Thiếu ${label}.`)
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')

  const segments = normalized.split('/').filter(Boolean)

  // Collection path phải có số segment lẻ:
  // products
  // users/a@gmail.com/preferences
  if (segments.length % 2 !== 1) {
    throw new Error(
      `${label} không hợp lệ: "${normalized}". `
      + 'Collection path phải kết thúc bằng tên collection.',
    )
  }

  return normalized
}

function parseCollectionPath(collectionPath) {
  const segments = collectionPath.split('/')
  return {
    collectionId: segments.at(-1),
    parentDocPath: segments.slice(0, -1).join('/'),
  }
}

function encodePathSegments(value) {
  return String(value || '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

async function loadServiceAccount(filePath, expectedProjectId, label) {
  const resolved = path.resolve(required(
    filePath,
    `Thiếu đường dẫn Service Account ${label}.`,
  ))

  const raw = await fs.readFile(resolved, 'utf8')
  const account = JSON.parse(raw)

  required(account.client_email, `${label} Service Account thiếu client_email.`)
  required(account.private_key, `${label} Service Account thiếu private_key.`)

  if (account.project_id && account.project_id !== expectedProjectId) {
    throw new Error(
      `${label} Service Account thuộc project "${account.project_id}", `
      + `không phải "${expectedProjectId}".`,
    )
  }

  return account
}

async function getAccessToken(account, label) {
  const now = Math.floor(Date.now() / 1000)
  const tokenUri = account.token_uri || TOKEN_URI

  const header = base64Url(JSON.stringify({
    alg: 'RS256',
    typ: 'JWT',
  }))

  const claim = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: OAUTH_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }))

  const unsigned = `${header}.${claim}`

  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()

  const assertion = `${unsigned}.${signer.sign(
    account.private_key,
    'base64url',
  )}`

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  const text = await response.text()
  let payload = {}

  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = {}
  }

  if (!response.ok || !payload.access_token) {
    throw new Error(
      `${label}: không lấy được OAuth token (${response.status}): `
      + `${payload.error_description || payload.error || text || 'unknown error'}`,
    )
  }

  return payload.access_token
}

function apiBase(projectId) {
  return `${FIRESTORE_API}/projects/${encodeURIComponent(projectId)}/databases/(default)`
}

async function firestoreRequest(projectId, token, endpoint, options = {}) {
  const response = await fetch(`${apiBase(projectId)}/${endpoint}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })

  const text = await response.text()
  let payload = null

  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    const message =
      payload?.error?.message
      || payload?.message
      || text
      || response.statusText

    throw new Error(
      `Firestore ${projectId} lỗi ${response.status}: ${message}`,
    )
  }

  return payload
}

async function listDocuments(projectId, token, collectionPath) {
  const { collectionId, parentDocPath } = parseCollectionPath(collectionPath)

  const prefix = parentDocPath
    ? `documents/${encodePathSegments(parentDocPath)}/${encodeURIComponent(collectionId)}`
    : `documents/${encodeURIComponent(collectionId)}`

  const documents = []
  let pageToken = ''

  do {
    const params = new URLSearchParams({
      pageSize: '1000',
      showMissing: 'false',
    })

    if (pageToken) params.set('pageToken', pageToken)

    const payload = await firestoreRequest(
      projectId,
      token,
      `${prefix}?${params.toString()}`,
    )

    documents.push(...(payload?.documents || []))
    pageToken = payload?.nextPageToken || ''
  } while (pageToken)

  return documents
}

function documentIdFromName(documentName) {
  return decodeURIComponent(
    String(documentName || '').split('/').at(-1) || '',
  )
}

function targetDocumentName(projectId, collectionPath, docId) {
  return `projects/${projectId}/databases/(default)/documents/`
    + `${collectionPath}/${docId}`
}

function deepRewriteReferences(value, sourceProjectId, targetProjectId) {
  if (Array.isArray(value)) {
    return value.map(v =>
      deepRewriteReferences(v, sourceProjectId, targetProjectId)
    )
  }

  if (!value || typeof value !== 'object') return value

  const result = {}

  for (const [key, child] of Object.entries(value)) {
    if (
      key === 'referenceValue'
      && typeof child === 'string'
    ) {
      const sourcePrefix =
        `projects/${sourceProjectId}/databases/(default)/documents/`
      const targetPrefix =
        `projects/${targetProjectId}/databases/(default)/documents/`

      result[key] = child.startsWith(sourcePrefix)
        ? `${targetPrefix}${child.slice(sourcePrefix.length)}`
        : child
      continue
    }

    result[key] = deepRewriteReferences(
      child,
      sourceProjectId,
      targetProjectId,
    )
  }

  return result
}

function normalizeObject(value) {
  if (Array.isArray(value)) return value.map(normalizeObject)

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, normalizeObject(value[key])]),
    )
  }

  return value
}

function fieldsEqual(left, right) {
  return JSON.stringify(normalizeObject(left || {}))
    === JSON.stringify(normalizeObject(right || {}))
}

function buildTargetFields(
  sourceFields,
  sourceProjectId,
  targetProjectId,
  keepReferences,
) {
  if (keepReferences || sourceProjectId === targetProjectId) {
    return sourceFields || {}
  }

  return deepRewriteReferences(
    sourceFields || {},
    sourceProjectId,
    targetProjectId,
  )
}

function buildUpdateWrite(projectId, collectionPath, docId, fields) {
  return {
    update: {
      name: targetDocumentName(
        projectId,
        collectionPath,
        docId,
      ),
      fields,
    },
  }
}

function buildDeleteWrite(projectId, collectionPath, docId) {
  return {
    delete: targetDocumentName(
      projectId,
      collectionPath,
      docId,
    ),
  }
}

async function commitWrites(projectId, token, writes) {
  if (!writes.length) return

  for (let start = 0; start < writes.length; start += BATCH_SIZE) {
    const batch = writes.slice(start, start + BATCH_SIZE)

    await firestoreRequest(
      projectId,
      token,
      'documents:commit',
      {
        method: 'POST',
        body: JSON.stringify({ writes: batch }),
      },
    )

    console.log(
      `  ✓ Đã ghi ${Math.min(start + batch.length, writes.length)}`
      + `/${writes.length} thao tác`,
    )
  }
}

async function main() {
  const sourceProjectId = required(
    process.env.SOURCE_FIREBASE_PROJECT_ID,
    'Thiếu SOURCE_FIREBASE_PROJECT_ID.',
  )

  const targetProjectId = required(
    process.env.TARGET_FIREBASE_PROJECT_ID,
    'Thiếu TARGET_FIREBASE_PROJECT_ID.',
  )

  const commonCollection = argValue('collection')

  const sourceCollection = normalizeCollectionPath(
    argValue('source-collection') || commonCollection,
    '--source-collection hoặc --collection',
  )

  const targetCollection = normalizeCollectionPath(
    argValue('target-collection') || commonCollection || sourceCollection,
    '--target-collection hoặc --collection',
  )

  const sourceCredentialsPath = required(
    process.env.SOURCE_GOOGLE_APPLICATION_CREDENTIALS,
    'Thiếu SOURCE_GOOGLE_APPLICATION_CREDENTIALS.',
  )

  const targetCredentialsPath = required(
    process.env.TARGET_GOOGLE_APPLICATION_CREDENTIALS,
    'Thiếu TARGET_GOOGLE_APPLICATION_CREDENTIALS.',
  )

  const apply = hasArg('apply')
  const deleteMissing = hasArg('delete-missing')
  const keepReferences = hasArg('keep-references')
  const confirmedTarget = argValue('confirm-target')

  if (apply && confirmedTarget !== targetProjectId) {
    throw new Error(
      `Để ghi dữ liệu phải thêm --confirm-target=${targetProjectId}`,
    )
  }

  console.log('')
  console.log('=== FIRESTORE COLLECTION SYNC ===')
  console.log(`SOURCE project     : ${sourceProjectId}`)
  console.log(`SOURCE collection  : ${sourceCollection}`)
  console.log(`TARGET project     : ${targetProjectId}`)
  console.log(`TARGET collection  : ${targetCollection}`)
  console.log(`Mode               : ${apply ? 'APPLY' : 'DRY-RUN'}`)
  console.log(
    `Delete missing     : ${deleteMissing ? 'YES' : 'NO'}`,
  )
  console.log(
    `Rewrite references : ${
      keepReferences || sourceProjectId === targetProjectId
        ? 'NO'
        : 'YES'
    }`,
  )
  console.log('')

  if (
    sourceProjectId === targetProjectId
    && sourceCollection === targetCollection
  ) {
    throw new Error(
      'SOURCE và TARGET đang trùng hoàn toàn. Không có gì để đồng bộ.',
    )
  }

  const [sourceAccount, targetAccount] = await Promise.all([
    loadServiceAccount(
      sourceCredentialsPath,
      sourceProjectId,
      'SOURCE',
    ),
    loadServiceAccount(
      targetCredentialsPath,
      targetProjectId,
      'TARGET',
    ),
  ])

  const [sourceToken, targetToken] = await Promise.all([
    getAccessToken(sourceAccount, 'SOURCE'),
    getAccessToken(targetAccount, 'TARGET'),
  ])

  console.log('Đang đọc SOURCE và TARGET...')

  const [sourceDocuments, targetDocuments] = await Promise.all([
    listDocuments(
      sourceProjectId,
      sourceToken,
      sourceCollection,
    ),
    listDocuments(
      targetProjectId,
      targetToken,
      targetCollection,
    ),
  ])

  const sourceMap = new Map(
    sourceDocuments.map(doc => [
      documentIdFromName(doc.name),
      doc,
    ]),
  )

  const targetMap = new Map(
    targetDocuments.map(doc => [
      documentIdFromName(doc.name),
      doc,
    ]),
  )

  const creates = []
  const updates = []
  const unchanged = []
  const deletes = []

  for (const [docId, sourceDoc] of sourceMap) {
    const targetDoc = targetMap.get(docId)

    const targetFields = buildTargetFields(
      sourceDoc.fields || {},
      sourceProjectId,
      targetProjectId,
      keepReferences,
    )

    if (!targetDoc) {
      creates.push({
        docId,
        fields: targetFields,
      })
      continue
    }

    if (fieldsEqual(targetFields, targetDoc.fields || {})) {
      unchanged.push(docId)
    } else {
      updates.push({
        docId,
        fields: targetFields,
      })
    }
  }

  if (deleteMissing) {
    for (const docId of targetMap.keys()) {
      if (!sourceMap.has(docId)) {
        deletes.push(docId)
      }
    }
  }

  console.log('')
  console.log('Kết quả so sánh:')
  console.log(`  SOURCE documents : ${sourceDocuments.length}`)
  console.log(`  TARGET documents : ${targetDocuments.length}`)
  console.log(`  Tạo mới          : ${creates.length}`)
  console.log(`  Cập nhật         : ${updates.length}`)
  console.log(`  Không đổi        : ${unchanged.length}`)
  console.log(`  Xóa              : ${deletes.length}`)
  console.log('')

  const sampleLimit = 20

  if (creates.length) {
    console.log(
      `Tạo mới: ${creates
        .slice(0, sampleLimit)
        .map(v => v.docId)
        .join(', ')}${creates.length > sampleLimit ? ', ...' : ''}`,
    )
  }

  if (updates.length) {
    console.log(
      `Cập nhật: ${updates
        .slice(0, sampleLimit)
        .map(v => v.docId)
        .join(', ')}${updates.length > sampleLimit ? ', ...' : ''}`,
    )
  }

  if (deletes.length) {
    console.log(
      `Xóa: ${deletes
        .slice(0, sampleLimit)
        .join(', ')}${deletes.length > sampleLimit ? ', ...' : ''}`,
    )
  }

  const writes = [
    ...creates.map(item =>
      buildUpdateWrite(
        targetProjectId,
        targetCollection,
        item.docId,
        item.fields,
      )
    ),
    ...updates.map(item =>
      buildUpdateWrite(
        targetProjectId,
        targetCollection,
        item.docId,
        item.fields,
      )
    ),
    ...deletes.map(docId =>
      buildDeleteWrite(
        targetProjectId,
        targetCollection,
        docId,
      )
    ),
  ]

  if (!writes.length) {
    console.log('')
    console.log('✅ TARGET đã đồng bộ, không có thay đổi cần ghi.')
    return
  }

  if (!apply) {
    console.log('')
    console.log('DRY-RUN: chưa ghi dữ liệu.')
    console.log('')
    console.log('Muốn chạy thật:')
    console.log(
      `node scripts/sync-firestore-collection.mjs `
      + `--source-collection="${sourceCollection}" `
      + `--target-collection="${targetCollection}" `
      + `--apply --confirm-target=${targetProjectId}`
      + `${deleteMissing ? ' --delete-missing' : ''}`,
    )
    return
  }

  console.log('')
  console.log(`Bắt đầu ghi ${writes.length} thao tác vào TARGET...`)

  await commitWrites(
    targetProjectId,
    targetToken,
    writes,
  )

  console.log('')
  console.log('✅ Đồng bộ collection thành công.')
  console.log(`✅ SOURCE: ${sourceProjectId}/${sourceCollection}`)
  console.log(`✅ TARGET: ${targetProjectId}/${targetCollection}`)
}

main().catch(error => {
  console.error('')
  console.error('❌ Đồng bộ thất bại:')
  console.error(error?.message || error)
  process.exit(1)
})
