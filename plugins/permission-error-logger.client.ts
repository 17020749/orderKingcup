import {
  addDoc,
  collection,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
// @ts-ignore Shared ESM helper is also executed directly by Node client tests.
import {
  normalizePermissionErrorEvent,
  subscribePermissionErrors,
} from '~/utils/permissionErrorBus.mjs'
import { normalizeEmail } from '~/utils/format'

const RETENTION_DAYS = 30
const DEDUPE_WINDOW_MS = 60_000
const MAX_CONTEXT_LENGTH = 12_000
const MAX_STACK_LENGTH = 4_000
const SENSITIVE_KEY = /(token|password|secret|authorization|cookie|credential)/i

const recentFingerprints = new Map<string, number>()

const ROUTE_VIEW_PERMISSIONS: Array<[RegExp, string[]]> = [
  [/^\/orders(?:\/|$)/, ['page.orders', 'orders.view']],
  [/^\/customers(?:\/|$)/, ['page.customers', 'customers.view']],
  [/^\/payments(?:\/|$)/, ['page.payments', 'payments.view']],
  [/^\/invoices(?:\/|$)/, ['page.invoices', 'invoices.view']],
  [/^\/shipments(?:\/|$)/, ['page.shipments', 'shipments.view']],
  [/^\/printing(?:\/|$)/, ['page.printing', 'printing.view']],
  [/^\/export-requests(?:\/|$)/, ['page.export_requests', 'export_requests.view']],
  [/^\/products(?:\/|$)/, ['page.products', 'products.view']],
]

function boundedText(value: unknown, maxLength: number) {
  return String(value ?? '').slice(0, maxLength)
}

function safeContext(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 50).map(item => safeContext(item, depth + 1))
  if (!value || typeof value !== 'object') return typeof value === 'string' ? boundedText(value, 1000) : value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 60)
      .map(([key, child]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[redacted]' : safeContext(child, depth + 1),
      ]),
  )
}

function jsonText(value: unknown) {
  try {
    return boundedText(JSON.stringify(safeContext(value)), MAX_CONTEXT_LENGTH)
  } catch {
    return '{"serialization_error":true}'
  }
}

function routePermissions(route: string) {
  return ROUTE_VIEW_PERMISSIONS.find(([pattern]) => pattern.test(route))?.[1] || []
}

function stringList(values: unknown) {
  const source = Array.isArray(values) ? values : []
  return Array.from(new Set(source.map(value => String(value || '').trim()).filter(Boolean))).sort()
}

function fingerprintOf(event: any, email: string, route: string, missing: string[]) {
  return [
    email,
    route,
    event.module,
    event.operation,
    event.stage,
    event.recordId,
    event.firebaseCode,
    missing.join(','),
  ].join('|')
}

function shouldSkipDuplicate(fingerprint: string) {
  const now = Date.now()
  const previous = recentFingerprints.get(fingerprint) || 0
  recentFingerprints.set(fingerprint, now)
  for (const [key, timestamp] of recentFingerprints) {
    if (now - timestamp > DEDUPE_WINDOW_MS * 2) recentFingerprints.delete(key)
  }
  return now - previous < DEDUPE_WINDOW_MS
}

export default defineNuxtPlugin((nuxtApp) => {
  const { db } = useFirebaseServices()
  const { appUser, permissions } = useAuth()

  const unsubscribe = subscribePermissionErrors(async (rawEvent: any) => {
    const event = normalizePermissionErrorEvent(rawEvent)
    const email = normalizeEmail(appUser.value?.email || '')
    if (!email) return

    const route = event.route || String(nuxtApp.$router.currentRoute.value.fullPath || '')
    const granted = stringList(permissions.value)
    const inferredRequired = event.requiredPermissions.length
      ? event.requiredPermissions
      : routePermissions(route)
    const required = stringList(inferredRequired)
    const explicitlyMissing = stringList(event.missingPermissions)
    const missing = explicitlyMissing.length
      ? explicitlyMissing
      : required.filter(permission => !granted.includes('*') && !granted.includes(permission))
    const errorType = event.errorType || (
      missing.length
        ? 'missing_permission'
        : event.firebaseCode === 'permission-denied'
          ? 'rules_or_query_mismatch'
          : 'client_preflight'
    )
    const fingerprint = fingerprintOf(event, email, route, missing)
    if (shouldSkipDuplicate(fingerprint)) return

    try {
      await addDoc(collection(db, 'permission_error_logs'), {
        user_email: email,
        route: boundedText(route, 500),
        module: boundedText(event.module, 100),
        operation: boundedText(event.operation, 150),
        stage: boundedText(event.stage, 80),
        source: boundedText(event.source, 80),
        error_type: boundedText(errorType, 80),
        record_id: boundedText(event.recordId, 500),
        record_status: boundedText(event.recordStatus, 200),
        firebase_code: boundedText(event.firebaseCode, 100),
        firebase_message: boundedText(event.firebaseMessage, 1000),
        required_permissions_json: jsonText(required),
        missing_permissions_json: jsonText(missing),
        granted_permissions_json: jsonText(granted),
        diagnostic_summary: boundedText(
          missing.length
            ? `Thiếu quyền: ${missing.join(', ')}`
            : 'Client đã có quyền đã biết; cần kiểm tra Firestore Rules, query hoặc trạng thái bản ghi.',
          1500,
        ),
        context_json: jsonText(event.context),
        stack: boundedText(event.stack, MAX_STACK_LENGTH),
        created_at: serverTimestamp(),
        expires_at: Timestamp.fromMillis(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
        active: true,
        deleted: false,
      })
    } catch (loggerError) {
      if (import.meta.dev) console.warn('[permission-error-logger]', loggerError)
    }
  })

  nuxtApp.hook('app:beforeUnmount', unsubscribe)
})
