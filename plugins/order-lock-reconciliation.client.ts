import {
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore'

const LOCK_SCHEMA_VERSION = 1
const LEASE_DURATION_MS = 10 * 60 * 1000
const MARKER_ID = `order_lock_reconciliation_v${LOCK_SCHEMA_VERSION}`

export default defineNuxtPlugin(() => {
  const { db } = useFirebaseServices()
  const { authReady, isAdmin, appUser } = useAuth()
  const { reconcileOrderRelationLocks } = useAtomicOrderRelations()
  const { reconcilePrintingLocks } = usePrintingProgress()
  const { loadPrintOrders, loadPrintingSourceOrders } = usePrintingScopedQueries()

  const markerRef = doc(db, 'app_meta', MARKER_ID)
  let running = false
  let attempted = false

  async function claimReconciliation() {
    const actor = String(appUser.value?.email || '').trim().toLowerCase()
    if (!actor) return false

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(markerRef)
      const data = snapshot.exists() ? snapshot.data() : {}
      if (data.status === 'completed' && Number(data.lock_schema_version) === LOCK_SCHEMA_VERSION) {
        return false
      }

      const leaseExpiresAt = data.lease_expires_at?.toMillis?.() || 0
      if (data.status === 'running' && leaseExpiresAt > Date.now()) return false

      transaction.set(markerRef, {
        lock_schema_version: LOCK_SCHEMA_VERSION,
        status: 'running',
        started_by: actor,
        started_at: serverTimestamp(),
        lease_expires_at: Timestamp.fromMillis(Date.now() + LEASE_DURATION_MS),
        updated_at: serverTimestamp(),
        active: true,
        deleted: false,
      }, { merge: true })
      return true
    })
  }

  async function reconcileInBackground() {
    if (!authReady.value || !isAdmin.value || running || attempted) return
    attempted = true
    running = true
    const actor = String(appUser.value?.email || '').trim().toLowerCase()

    try {
      const claimed = await claimReconciliation()
      if (!claimed) return

      const relationResult = await reconcileOrderRelationLocks()
      const [sourceOrders, printOrders] = await Promise.all([
        loadPrintingSourceOrders(true),
        loadPrintOrders(true),
      ])
      // Đơn đã xuất đủ vốn không được xóa; bỏ qua chúng để đường reconcile
      // legacy không bị nhánh khóa sửa nội dung của Rules chặn cả batch.
      const relevantSourceOrders = sourceOrders.filter(order => (
        String(order.warehouse_fulfillment_status || '') !== 'da_xuat_du'
      ))
      const printingResult = await reconcilePrintingLocks(relevantSourceOrders, printOrders)

      await setDoc(markerRef, {
        lock_schema_version: LOCK_SCHEMA_VERSION,
        status: 'completed',
        completed_by: actor,
        completed_at: serverTimestamp(),
        relation_updated_orders: relationResult.updatedOrders,
        relation_orphan_count: relationResult.orphanCount,
        printing_checked_orders: printingResult.checked,
        printing_updated_orders: printingResult.changed,
        lease_expires_at: null,
        updated_at: serverTimestamp(),
        active: true,
        deleted: false,
      }, { merge: true })
      console.info('[order-lock-reconciliation] Đã đối soát khóa đơn hàng trong nền.', {
        relationResult,
        printingResult,
      })
    } catch (error) {
      console.error('[order-lock-reconciliation] Đối soát khóa nền thất bại.', error)
      try {
        await setDoc(markerRef, {
          lock_schema_version: LOCK_SCHEMA_VERSION,
          status: 'failed',
          failed_by: actor,
          failed_at: serverTimestamp(),
          failure_message: String((error as any)?.message || error).slice(0, 1000),
          lease_expires_at: null,
          updated_at: serverTimestamp(),
          active: true,
          deleted: false,
        }, { merge: true })
      } catch (markerError) {
        console.error('[order-lock-reconciliation] Không ghi được trạng thái lỗi.', markerError)
      }
    } finally {
      running = false
    }
  }

  watch([authReady, isAdmin], ([ready, admin]) => {
    if (!ready || !admin) return
    void reconcileInBackground()
  }, { immediate: true })
})
