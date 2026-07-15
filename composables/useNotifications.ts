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

let directUnsubscribe: Unsubscribe | null = null
let audienceUnsubscribe: Unsubscribe | null = null
let readsUnsubscribe: Unsubscribe | null = null
let currentSubscriptionKey = ''

export function useNotifications() {
  const { db } = useFirebaseServices()
  const { appUser, permissions } = useAuth()
  const directRows = useState<any[]>('notifications.direct', () => [])
  const audienceRows = useState<any[]>('notifications.audience', () => [])
  const readIds = useState<string[]>('notifications.readIds', () => [])
  const loading = useState<boolean>('notifications.loading', () => false)
  const error = useState<string>('notifications.error', () => '')

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
    const currentEmail = email.value
    const merged = new Map<string, any>()
    ;[...directRows.value, ...audienceRows.value].forEach(row => {
      if (!row?.id || row.deleted === true || row.active === false) return
      if (normalizeEmail(row.created_by || '') === currentEmail && !normalizeEmail(row.to_email || '')) return
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

  function stop() {
    directUnsubscribe?.()
    audienceUnsubscribe?.()
    readsUnsubscribe?.()
    directUnsubscribe = null
    audienceUnsubscribe = null
    readsUnsubscribe = null
    currentSubscriptionKey = ''
  }

  function start() {
    const currentEmail = email.value
    if (!currentEmail || !db) return
    const audiencePermissions = rulePermissions.value
    const key = `${currentEmail}|${audiencePermissions.slice().sort().join(',')}`
    if (key === currentSubscriptionKey) return

    stop()
    currentSubscriptionKey = key
    loading.value = true
    error.value = ''

    directUnsubscribe = onSnapshot(
      query(collection(db, 'notifications'), where('to_email', '==', currentEmail)),
      snapshot => {
        directRows.value = mapSnapshot(snapshot)
        loading.value = false
      },
      reason => {
        error.value = reason?.message || 'Không tải được thông báo cá nhân.'
        loading.value = false
      },
    )

    if (audiencePermissions.length) {
      audienceUnsubscribe = onSnapshot(
        query(
          collection(db, 'notifications'),
          where('audience', '==', 'warehouse_export'),
        ),
        snapshot => {
          audienceRows.value = mapSnapshot(snapshot)
          loading.value = false
        },
        reason => {
          error.value = reason?.message || 'Không tải được thông báo kho.'
          loading.value = false
        },
      )
    } else {
      audienceRows.value = []
    }

    readsUnsubscribe = onSnapshot(
      query(collection(db, 'notification_reads'), where('user_email', '==', currentEmail)),
      snapshot => {
        readIds.value = snapshot.docs
          .map(item => String(item.data()?.notification_id || ''))
          .filter(Boolean)
      },
      reason => {
        error.value = reason?.message || 'Không tải được trạng thái đã đọc.'
      },
    )
  }

  async function markRead(notificationId: string) {
    const currentEmail = email.value
    if (!notificationId || !currentEmail) return
    const readId = `${notificationId}__${currentEmail}`
    await setDoc(
      doc(db, 'notification_reads', readId),
      {
        id: readId,
        notification_id: notificationId,
        user_email: currentEmail,
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
    effectiveClientPermissions: permissions,
  }
}
