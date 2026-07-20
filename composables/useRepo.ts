import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
  type Unsubscribe
} from 'firebase/firestore'
import type { AnyDoc } from '~/types/models'
import { isActive, makeId, normalizeText } from '~/utils/format'
import { invalidateScopedCache } from '~/composables/useScopedQueries'

type SaveOptions = {
  isCreate?: boolean
  log?: boolean
}

const MAX_ACTIVITY_JSON_LENGTH = 100_000

function serializeActivityJson(value: any) {
  let serialized: string
  try {
    serialized = JSON.stringify(value || {})
  } catch {
    throw new Error('Dữ liệu Activity Log không thể chuyển thành JSON.')
  }
  if (serialized.length > MAX_ACTIVITY_JSON_LENGTH) {
    throw new Error('Dữ liệu Activity Log vượt giới hạn 100.000 ký tự.')
  }
  return serialized
}

export function useRepo() {
  const { db } = useFirebaseServices()
  const { appUser } = useAuth()

  function collectionRef(name: string) {
    return collection(db, name)
  }

  function docRef(name: string, id: string) {
    return doc(db, name, id)
  }

  function currentEmail() {
    return String(appUser.value?.email || '').trim().toLowerCase()
  }

  function enrichForWrite(data: AnyDoc, isCreate = false) {
    const email = currentEmail()
    const payload: AnyDoc = {
      ...data,
      updated_at: serverTimestamp(),
      ...(isCreate ? {
        created_at: serverTimestamp(),
        created_by: data.created_by || email,
        active: data.active ?? true,
        deleted: data.deleted ?? false
      } : {})
    }

    // Khi sửa, không ghi lại created_at từ state client. Firestore đang lưu
    // Timestamp server; nếu client gửi lại ISO string thì Rules coi là đổi
    // field bất biến và chặn update.
    if (!isCreate) delete payload.created_at

    if (data.search_text) payload.search_text = data.search_text
    else if (isCreate || Object.keys(data).length > 3) {
      payload.search_text = normalizeText(
        Object.values(data).filter(value => typeof value !== 'object').join(' ')
      )
    }
    return payload
  }

  function activityPayload(module: string, action: string, itemCode: string, after: any) {
    const email = currentEmail()
    return {
      module,
      action,
      item_code: itemCode,
      item_name: after.customer_name || after.product_name || after.order_code || after.name || itemCode,
      changed_by: email,
      after_json: serializeActivityJson(after),
      created_at: serverTimestamp(),
      active: true,
      deleted: false
    }
  }

  async function listDocs(name: string, constraints: QueryConstraint[] = []) {
    const snap = await getDocs(query(collectionRef(name), ...constraints))
    return snap.docs.map(d => ({ ...d.data(), id: d.id, firestore_id: d.id })) as AnyDoc[]
  }

  function listenDocs(name: string, constraints: QueryConstraint[], callback: (rows: AnyDoc[]) => void): Unsubscribe {
    return onSnapshot(query(collectionRef(name), ...constraints), snap => {
      callback(snap.docs.map(d => ({ ...d.data(), id: d.id, firestore_id: d.id })) as AnyDoc[])
    })
  }

  async function getOne(name: string, id: string) {
    const snap = await getDoc(docRef(name, id))
    return snap.exists() ? ({ ...snap.data(), id: snap.id, firestore_id: snap.id } as AnyDoc) : null
  }

  async function saveDoc(name: string, data: AnyDoc, id?: string, options: SaveOptions = {}) {
    const docId = id || data.id || makeId(name.slice(0, 3))
    const isCreate = options.isCreate ?? (!data.created_at && !data.firestore_id)
    const payload = enrichForWrite({ ...data, id: docId }, isCreate)
    const batch = writeBatch(db)
    batch.set(docRef(name, docId), payload, { merge: true })

    if (options.log !== false) {
      const activityRef = doc(collectionRef('activity_logs'))
      batch.set(activityRef, activityPayload(name, isCreate ? 'create' : 'update', docId, data))
    }

    await batch.commit()
    invalidateScopedCache(name)
    invalidateScopedCache('activity_logs')

    const now = new Date().toISOString()
    return {
      ...data,
      id: docId,
      firestore_id: docId,
      created_by: data.created_by || (isCreate ? currentEmail() : data.created_by),
      active: data.active ?? true,
      deleted: data.deleted ?? false,
      updated_at: now,
      ...(isCreate && !data.created_at ? { created_at: now } : {})
    }
  }

  async function patchDoc(name: string, id: string, patch: AnyDoc, log = true) {
    const batch = writeBatch(db)
    batch.update(docRef(name, id), enrichForWrite(patch, false))
    if (log) {
      batch.set(doc(collectionRef('activity_logs')), activityPayload(name, 'update', id, patch))
    }
    await batch.commit()
    invalidateScopedCache(name)
    if (log) invalidateScopedCache('activity_logs')
  }

  async function softDeleteDoc(name: string, id: string, itemName = id) {
    const deletedAt = serverTimestamp()
    const batch = writeBatch(db)
    batch.update(docRef(name, id), {
      deleted: true,
      active: false,
      status: 'deleted',
      deleted_at: deletedAt,
      updated_at: deletedAt
    })
    batch.set(doc(collectionRef('activity_logs')), activityPayload(name, 'delete', id, { name: itemName }))
    await batch.commit()
    invalidateScopedCache(name)
    invalidateScopedCache('activity_logs')
  }

  async function hardDeleteDoc(name: string, id: string) {
    await deleteDoc(docRef(name, id))
    invalidateScopedCache(name)
  }

  async function logActivity(module: string, action: string, itemCode: string, after: any) {
    await addDoc(collectionRef('activity_logs'), activityPayload(module, action, itemCode, after))
    invalidateScopedCache('activity_logs')
  }

  function activeRows(rows: AnyDoc[]) {
    return rows.filter(isActive)
  }

  return {
    db,
    collectionRef,
    docRef,
    listDocs,
    listenDocs,
    getOne,
    saveDoc,
    patchDoc,
    softDeleteDoc,
    hardDeleteDoc,
    logActivity,
    activeRows,
    invalidateScopedCache,
    q: { where, orderBy, limit },
    writeBatch,
    serverTimestamp
  }
}
