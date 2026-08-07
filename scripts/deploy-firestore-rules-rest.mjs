import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const API_ORIGIN = 'https://firebaserules.googleapis.com/v1'
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function assertNonEmpty(value, message) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(message)
  return normalized
}

function createServiceAccountAssertion(credentials, tokenUri) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: OAUTH_SCOPE,
    aud: tokenUri,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }))
  const unsignedToken = `${header}.${payload}`
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(unsignedToken),
    credentials.private_key,
  )
  return `${unsignedToken}.${base64Url(signature)}`
}

async function getAccessToken(credentials) {
  const tokenUri = credentials.token_uri || 'https://oauth2.googleapis.com/token'
  const assertion = createServiceAccountAssertion(credentials, tokenUri)
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = {}
  }
  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Không lấy được access token cho Firestore Rules REST (${response.status}): ${payload.error_description || payload.error || 'unknown error'}`,
    )
  }
  return payload.access_token
}

function errorMessage(payload, fallback) {
  return String(payload?.error?.message || payload?.message || fallback || 'unknown error')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 1000)
}

async function apiRequest(accessToken, pathname, { method = 'GET', body, retries = 4 } = {}) {
  let lastError
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    let response
    let payload = {}
    try {
      response = await fetch(`${API_ORIGIN}${pathname}`, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const text = await response.text()
      if (text) {
        try {
          payload = JSON.parse(text)
        } catch {
          payload = { message: text }
        }
      }
    } catch (error) {
      lastError = error
      if (attempt === retries) throw error
      const delay = attempt * 5000
      console.warn(`Lỗi mạng khi gọi Firebase Rules REST. Thử lại sau ${delay / 1000}s.`)
      await new Promise(resolve => setTimeout(resolve, delay))
      continue
    }

    if (response.ok) return payload

    const message = errorMessage(payload, response.statusText)
    const error = new Error(`Firebase Rules REST ${method} ${pathname} lỗi ${response.status}: ${message}`)
    error.status = response.status
    error.payload = payload
    lastError = error

    if (!TRANSIENT_STATUSES.has(response.status) || attempt === retries) throw error

    const delay = attempt * 5000
    console.warn(`Firebase Rules REST trả ${response.status}. Thử lại sau ${delay / 1000}s.`)
    await new Promise(resolve => setTimeout(resolve, delay))
  }
  throw lastError || new Error('Firebase Rules REST thất bại không xác định.')
}

async function updateOrCreateRelease(accessToken, projectId, rulesetName) {
  const releaseId = 'cloud.firestore'
  const releaseName = `projects/${projectId}/releases/${releaseId}`
  const releasePath = `/projects/${encodeURIComponent(projectId)}/releases/${releaseId}`
  const release = { name: releaseName, rulesetName }

  try {
    await apiRequest(accessToken, releasePath, {
      method: 'PATCH',
      body: { release },
    })
  } catch (error) {
    if (error.status !== 404) throw error
    try {
      await apiRequest(accessToken, `/projects/${encodeURIComponent(projectId)}/releases`, {
        method: 'POST',
        body: release,
      })
    } catch (createError) {
      if (createError.status !== 409) throw createError
      await apiRequest(accessToken, releasePath, {
        method: 'PATCH',
        body: { release },
      })
    }
  }

  const persisted = await apiRequest(accessToken, releasePath)
  if (persisted.rulesetName !== rulesetName) {
    throw new Error('Release cloud.firestore không trỏ tới Ruleset vừa tạo.')
  }
}

async function main() {
  const projectId = assertNonEmpty(
    process.env.NUXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    'Thiếu project ID cho Firestore Rules REST.',
  )
  const credentialsPath = assertNonEmpty(
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    'Thiếu GOOGLE_APPLICATION_CREDENTIALS.',
  )
  const rulesPath = path.resolve(
    process.cwd(),
    process.env.FIRESTORE_RULES_FILE || 'firestore.rules',
  )
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
  const rulesContent = fs.readFileSync(rulesPath, 'utf8')

  assertNonEmpty(credentials.client_email, 'Service Account thiếu client_email.')
  assertNonEmpty(credentials.private_key, 'Service Account thiếu private_key.')
  if (credentials.project_id && credentials.project_id !== projectId) {
    throw new Error(`Service Account thuộc project ${credentials.project_id}, không phải ${projectId}.`)
  }
  assertNonEmpty(rulesContent, 'File Firestore Rules đang rỗng.')

  const accessToken = await getAccessToken(credentials)
  const ruleset = await apiRequest(
    accessToken,
    `/projects/${encodeURIComponent(projectId)}/rulesets`,
    {
      method: 'POST',
      body: {
        source: {
          files: [{ name: path.basename(rulesPath), content: rulesContent }],
        },
      },
    },
  )
  const rulesetName = assertNonEmpty(ruleset.name, 'Rules API không trả về tên Ruleset.')

  await updateOrCreateRelease(accessToken, projectId, rulesetName)
  console.log(`Đã phát hành Firestore Rules qua REST: ${rulesetName}`)
}

main().catch(error => {
  console.error(error?.message || error)
  process.exit(1)
})
