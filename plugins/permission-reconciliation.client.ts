import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore'
import { PERMISSION_CATALOG } from '~/constants/permissions'
// @ts-ignore Shared ESM helpers are executed directly by Node client tests.
import {
  auditPermissionAssignments,
  buildPermissionSyncPatch,
} from '~/utils/permissionAudit.mjs'

const MAX_BATCH_WRITES = 400

export default defineNuxtPlugin(() => {
  const { db } = useFirebaseServices()
  const { authReady, isAdmin, firebaseUser, loadProfile } = useAuth()

  let rolesUnsubscribe: Unsubscribe | null = null
  let reconciling = false
  let rerunRequested = false

  async function reconcilePermissions() {
    if (!authReady.value || !isAdmin.value) return
    if (reconciling) {
      rerunRequested = true
      return
    }

    reconciling = true
    try {
      const [userSnapshot, roleSnapshot] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'roles')),
      ])
      const users = userSnapshot.docs.map(snapshot => ({
        ...snapshot.data(),
        id: snapshot.id,
        email: snapshot.id,
      }))
      const roles = roleSnapshot.docs.map(snapshot => ({
        ...snapshot.data(),
        id: snapshot.id,
      }))
      const auditRows = auditPermissionAssignments({
        users,
        roles,
        catalogKeys: PERMISSION_CATALOG.map(permission => permission.key),
      })
      const safeDriftRows = auditRows.filter(row => !row.isInSync && row.safeToAutoSync)

      for (let index = 0; index < safeDriftRows.length; index += MAX_BATCH_WRITES) {
        const group = safeDriftRows.slice(index, index + MAX_BATCH_WRITES)
        const batch = writeBatch(db)
        group.forEach(row => {
          batch.set(doc(db, 'users', row.email), {
            ...buildPermissionSyncPatch(row),
            permissions_synced_at: serverTimestamp(),
            updated_at: serverTimestamp(),
          }, { merge: true })
        })
        await batch.commit()
      }

      const currentEmail = String(firebaseUser.value?.email || '').trim().toLowerCase()
      if (currentEmail && safeDriftRows.some(row => row.email === currentEmail) && firebaseUser.value) {
        await loadProfile(firebaseUser.value)
      }
    } catch (error) {
      console.error('[permission-reconciliation] Không tự đồng bộ được quyền người dùng.', error)
    } finally {
      reconciling = false
      if (rerunRequested) {
        rerunRequested = false
        void reconcilePermissions()
      }
    }
  }

  function stopRoleListener() {
    rolesUnsubscribe?.()
    rolesUnsubscribe = null
  }

  function startRoleListener() {
    if (!authReady.value || !isAdmin.value || rolesUnsubscribe) return
    rolesUnsubscribe = onSnapshot(
      collection(db, 'roles'),
      () => void reconcilePermissions(),
      error => console.error('[permission-reconciliation] Không theo dõi được thay đổi role.', error),
    )
  }

  watch([authReady, isAdmin], ([ready, admin]) => {
    if (!ready || !admin) {
      stopRoleListener()
      return
    }
    startRoleListener()
  }, { immediate: true })
})
