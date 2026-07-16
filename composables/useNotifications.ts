import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type DocumentData,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { normalizeEmail } from '~/utils/format'

export const WAREHOUSE_NOTIFICATION_PERMISSIONS = [
  'export_requests.accept',
  'export_requests.reject',
  'export_requests.release',
  'export_requests.process',
]

export interface NotificationPayloadInput {
  type: string
  title: string
  message: string
  route?: string
  entity_collection?: string
  entity_id?: string
  entity_code?: string
  created_by: string
  to_email?: string
  audience?: string
  audience_permissions?: string[]
  metadata?: Record<string, any>
}

export interface SaleNotificationRecipientInput {
  request?: Record<string, any> | null
  order?: Record<string, any> | null
  actorEmail?: string
}

export function resolveSaleNotificationRecipients(input: SaleNotificationRecipientInput) {
  const request = input.request || {}
  const order = input.order || {}
  const actor = normalizeEmail(input.actorEmail || '')
  const creator = normalizeEmail(request.requested_by || request.created_by || '')
  const assignedSale = normalizeEmail(request.order_sale_email || order.sale_email || '')

  return Array.from(new Set([creator, assignedSale].filter(Boolean)))
    .filter(recipient => recipient !== actor)
}

export function buildNotificationPayload(input: NotificationPayloadInput) {
  return {
    type: input.type,
    title: input.title,
    message: input.message,
    route: input.route || '',
    entity_collection: input.entity_collection || '',
    entity_id: input.entity_id || '',
    entity_code: input.entity_code || '',
    created_by: normalizeEmail(input.created_by),
    to_email: normalizeEmail(input.to_email || ''),
    audience: String(input.audience || '').trim(),
    audience_permissions: Array.from(new Set((input.audience_permissions || []).filter(Boolean))),
    metadata_json: JSON.stringify(input.metadata || {}),
    status: 'unread',
    read: false,
    active: true,
    deleted: false,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }
}

function timestampValue(value: any) {
  if (!value) return 0
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.seconds === 'number') return value.seconds * 1000
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function mapSnapshot(snapshot: QuerySnapshot<DocumentData>) {
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
}

type NotificationStream = 'direct' | 'audience' | 'reads'

function emptyStreamErrors(): Record<NotificationStream, string> {
  return { direct: '', audience: '', reads: '' }
}

function emptyStreamLoading(): Record<NotificationStream, boolean> {
  return { direct: false, audience: false, reads: false }
}

function retryableSnapshotError(reason: any) {
  const code = String(reason?.code || '').replace(/^firestore\//, '')
  return [
    'aborted',
    'cancelled',
    'deadline-exceeded',
    'internal',
    'resource-exhausted',
    'unavailable',
    'unknown',
  ].includes(code)
}

export function useNotifications() {
  const { db } = useFirebaseServices()
  const { appUser, permissions } = useAuth()
  const directRows = ref<any[]>([])
  const audienceRows = ref<any[]>([])
  const readIds = ref<string[]>([])
  const streamLoading = ref<Record<NotificationStream, boolean>>(emptyStreamLoading())
  const streamErrors = ref<Record<NotificationStream, string>>(emptyStreamErrors())
  // Listener ownership is instance-scoped. During a route transition Nuxt can
  // mount the next AppShell before unmounting the previous one; module-level
  // handles would let the old NotificationCenter stop the new subscription.
  let directUnsubscribe: Unsubscribe | null = null
  let audienceUnsubscribe: Unsubscribe | null = null
  let readsUnsubscribe: Unsubscribe | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let currentSubscriptionKey = ''
  let subscribedEmail = ''
  let subscriptionGeneration = 0
  let retryAttempt = 0

  const email = computed(() => normalizeEmail(appUser.value?.email || ''))
  const rulePermissions = computed(() => {
    const stored = Array.isArray(appUser.value?.permissions_flat)
      ? appUser.value!.permissions_flat!
      : []
    if (stored.includes('*')) return [...WAREHOUSE_NOTIFICATION_PERMISSIONS]
    if (!stored.includes('page.warehouse_export_requests')) return []
    return WAREHOUSE_NOTIFICATION_PERMISSIONS.filter(permission => stored.includes(permission))
  })

  const items = computed(() => {
    const activeEmail = email.value
    const merged = new Map<string, any>()
    ;[...directRows.value, ...audienceRows.value].forEach(row => {
      if (!row?.id || row.deleted === true || row.active === false) return
      if (normalizeEmail(row.created_by || '') === activeEmail && !normalizeEmail(row.to_email || '')) return
      merged.set(row.id, row)
    })
    return Array.from(merged.values())
      .map(row => ({
        ...row,
        is_read:
          readIds.value.includes(row.id)
          || row.read === true
          || row.is_read === true
          || ['read', 'seen'].includes(String(row.status || '').toLowerCase()),
      }))
      .sort((a, b) => timestampValue(b.created_at) - timestampValue(a.created_at))
      .slice(0, 100)
  })

  const unreadCount = computed(() => items.value.filter(item => !item.is_read).length)
  const loading = computed(() => Object.values(streamLoading.value).some(Boolean))
  const error = computed(() => Object.values(streamErrors.value).filter(Boolean).join(' · '))

  function clearRetryTimer() {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
  }

  function disposeListeners() {
    directUnsubscribe?.()
    audienceUnsubscribe?.()
    readsUnsubscribe?.()
    directUnsubscribe = null
    audienceUnsubscribe = null
    readsUnsubscribe = null
  }

  function resetRows() {
    directRows.value = []
    audienceRows.value = []
    readIds.value = []
  }

  function stop() {
    subscriptionGeneration += 1
    disposeListeners()
    clearRetryTimer()
    currentSubscriptionKey = ''
    subscribedEmail = ''
    retryAttempt = 0
    streamLoading.value = emptyStreamLoading()
    streamErrors.value = emptyStreamErrors()
    resetRows()
  }

  function scheduleRetry(key: string, generation: number) {
    if (retryTimer || generation !== subscriptionGeneration || key !== currentSubscriptionKey) return
    const delays = [1000, 2000, 5000, 10000, 30000]
    const delay = delays[Math.min(retryAttempt, delays.length - 1)]
    retryAttempt += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (generation !== subscriptionGeneration || key !== currentSubscriptionKey) return
      currentSubscriptionKey = ''
      start()
    }, delay)
  }

  function streamReady(stream: NotificationStream) {
    streamLoading.value = { ...streamLoading.value, [stream]: false }
    streamErrors.value = { ...streamErrors.value, [stream]: '' }
    if (!Object.values(streamLoading.value).some(Boolean) && !Object.values(streamErrors.value).some(Boolean)) {
      retryAttempt = 0
    }
  }

  function streamFailed(
    stream: NotificationStream,
    reason: any,
    fallback: string,
    key: string,
    generation: number,
  ) {
    if (generation !== subscriptionGeneration || key !== currentSubscriptionKey) return
    streamLoading.value = { ...streamLoading.value, [stream]: false }
    streamErrors.value = {
      ...streamErrors.value,
      [stream]: reason?.message || fallback,
    }
    if (retryableSnapshotError(reason)) scheduleRetry(key, generation)
  }

  function start() {
    const nextEmail = email.value
    if (!nextEmail || !db) {
      stop()
      return
    }
    const audiencePermissions = rulePermissions.value
    const key = `${nextEmail}|${audiencePermissions.slice().sort().join(',')}`
    const allRequiredListenersActive = Boolean(
      directUnsubscribe
      && readsUnsubscribe
      && (audiencePermissions.length === 0 || audienceUnsubscribe),
    )
    if (key === currentSubscriptionKey && allRequiredListenersActive) return

    const accountChanged = subscribedEmail !== nextEmail
    subscriptionGeneration += 1
    const generation = subscriptionGeneration
    disposeListeners()
    clearRetryTimer()
    if (accountChanged) resetRows()
    subscribedEmail = nextEmail
    currentSubscriptionKey = key
    streamErrors.value = emptyStreamErrors()
    streamLoading.value = {
      direct: true,
      audience: audiencePermissions.length > 0,
      reads: true,
    }

    directUnsubscribe = onSnapshot(
      query(collection(db, 'notifications'), where('to_email', '==', nextEmail)),
      snapshot => {
        if (generation !== subscriptionGeneration) return
        directRows.value = mapSnapshot(snapshot)
        streamReady('direct')
      },
      reason => {
        if (generation !== subscriptionGeneration) return
        directUnsubscribe = null
        streamFailed('direct', reason, 'Không tải được thông báo cá nhân.', key, generation)
      },
    )

    if (audiencePermissions.length) {
      audienceUnsubscribe = onSnapshot(
        query(
          collection(db, 'notifications'),
          where('audience', '==', 'warehouse_export'),
        ),
        snapshot => {
          if (generation !== subscriptionGeneration) return
          audienceRows.value = mapSnapshot(snapshot)
          streamReady('audience')
        },
        reason => {
          if (generation !== subscriptionGeneration) return
          audienceUnsubscribe = null
          streamFailed('audience', reason, 'Không tải được thông báo kho.', key, generation)
        },
      )
    } else {
      audienceRows.value = []
      streamReady('audience')
    }

    readsUnsubscribe = onSnapshot(
      query(collection(db, 'notification_reads'), where('user_email', '==', nextEmail)),
      snapshot => {
        if (generation !== subscriptionGeneration) return
        readIds.value = snapshot.docs
          .map(item => String(item.data()?.notification_id || ''))
          .filter(Boolean)
        streamReady('reads')
      },
      reason => {
        if (generation !== subscriptionGeneration) return
        readsUnsubscribe = null
        streamFailed('reads', reason, 'Không tải được trạng thái đã đọc.', key, generation)
      },
    )
  }

  async function markRead(notificationId: string) {
    const activeEmail = email.value
    if (!notificationId || !activeEmail) return
    const readId = `${notificationId}__${activeEmail}`
    await setDoc(
      doc(db, 'notification_reads', readId),
      {
        id: readId,
        notification_id: notificationId,
        user_email: activeEmail,
        read_at: serverTimestamp(),
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        active: true,
        deleted: false,
      },
      { merge: true },
    )
  }

  async function markAllRead() {
    const unread = items.value.filter(item => !item.is_read)
    if (!unread.length || !email.value) return
    const batch = writeBatch(db)
    unread.slice(0, 450).forEach(item => {
      const readId = `${item.id}__${email.value}`
      batch.set(
        doc(db, 'notification_reads', readId),
        {
          id: readId,
          notification_id: item.id,
          user_email: email.value,
          read_at: serverTimestamp(),
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
          active: true,
          deleted: false,
        },
        { merge: true },
      )
    })
    await batch.commit()
  }

  return {
    items,
    unreadCount,
    loading,
    error,
    start,
    stop,
    markRead,
    markAllRead,
    rulePermissions,
    streamErrors,
    effectiveClientPermissions: permissions,
  }
}
