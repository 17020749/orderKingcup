import { collection, doc, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore'
import type {
  OrderDoc,
  PrintOrderDoc,
  PrintOrderItemDoc,
  ProductDoc,
  SupplierDoc,
} from '~/types/models'
import { invalidateScopedCache } from '~/composables/useScopedQueries'
import { makeId, normalizeEmail, toNumber } from '~/utils/format'
// @ts-ignore Shared ESM helpers are executed directly by Node client tests.
import {
  buildPrintingLockFields,
  ORDER_PRINTING_LOCK_VERSION,
  printingCountsByOrder,
} from '~/utils/orderPrintingDeleteLock.mjs'

export type PrintItemInput = {
  id?: string
  product: ProductDoc
  logo?: string
  logo_color?: string
  print_quantity: number
  actual_print_quantity?: number
  print_started_at?: string
  expected_done_at?: string
  is_completed?: boolean
  completed_at?: any
  note?: string
}

type SavePrintOrderInput = {
  order?: PrintOrderDoc | null
  order_id: string
  order_code: string
  am_code?: string
  supplier?: SupplierDoc | null
  note?: string
  items: PrintItemInput[]
  existingItems?: PrintOrderItemDoc[]
}

function text(value: any) {
  return String(value || '').trim()
}

function completed(value: any) {
  return value === true || String(value || '').toUpperCase() === 'TRUE'
}

function productCode(product: ProductDoc | any) {
  return text(product?.product_code || product?.code)
}

function productName(product: ProductDoc | any) {
  return text(product?.product_name || product?.name)
}

function validateItems(items: PrintItemInput[]) {
  if (!items.length) throw new Error('Vui lòng thêm ít nhất một sản phẩm in.')
  if (items.length > 450) throw new Error('Một đơn in chỉ hỗ trợ tối đa 450 dòng chi tiết.')

  items.forEach((item, index) => {
    const line = index + 1
    if (!text(item.product?.id)) throw new Error('Dòng ' + line + ': vui lòng chọn sản phẩm.')
    if (toNumber(item.print_quantity) <= 0) throw new Error('Dòng ' + line + ': số lượng in phải lớn hơn 0.')
    if (toNumber(item.actual_print_quantity) < 0) throw new Error('Dòng ' + line + ': số lượng in thực tế không được âm.')
    if (item.print_started_at && item.expected_done_at) {
      const started = new Date(item.print_started_at).getTime()
      const expected = new Date(item.expected_done_at).getTime()
      if (!Number.isNaN(started) && !Number.isNaN(expected) && expected < started) {
        throw new Error('Dòng ' + line + ': thời gian dự kiến xong phải sau thời gian bắt đầu in.')
      }
    }
  })
}

function printingCount(order: Record<string, any>) {
  const count = Number(order?.printing_progress_count)
  if (Number(order?.printing_lock_version) !== ORDER_PRINTING_LOCK_VERSION
    || !Number.isInteger(count)
    || count < 0) {
    throw new Error('Đơn hàng cũ chưa được đồng bộ khóa tiến độ in. Quản trị viên cần chạy “Đồng bộ khóa xóa đơn”.')
  }
  return count
}

function invalidatePrintingCaches() {
  ;['orders', 'print_orders', 'print_order_items', 'activity_logs'].forEach(invalidateScopedCache)
}

export function usePrintingProgress() {
  const { db } = useFirebaseServices()
  const { appUser } = useAuth()

  function email() {
    return normalizeEmail(appUser.value?.email || '')
  }

  function activity(action: string, orderCode: string, after: any) {
    return {
      module: 'print_orders',
      action,
      item_code: orderCode,
      item_name: orderCode,
      changed_by: email(),
      after_json: JSON.stringify(after || {}),
      created_at: serverTimestamp(),
      active: true,
      deleted: false,
    }
  }

  function itemPayload(
    orderId: string,
    input: PrintItemInput,
    existing?: PrintOrderItemDoc,
  ) {
    const isCompleted = completed(input.is_completed)
    const now = serverTimestamp()
    return {
      id: input.id || makeId('pri'),
      print_order_id: orderId,
      product_id: text(input.product.id),
      product_code: productCode(input.product),
      product_name: productName(input.product),
      logo: text(input.logo),
      logo_color: text(input.logo_color),
      print_quantity: toNumber(input.print_quantity),
      actual_print_quantity: toNumber(input.actual_print_quantity),
      print_started_at: text(input.print_started_at),
      expected_done_at: text(input.expected_done_at),
      is_completed: isCompleted,
      completed_at: isCompleted
        ? (existing?.completed_at || input.completed_at || now)
        : '',
      note: text(input.note),
      status: existing?.status || 'active',
      active: existing?.active ?? true,
      deleted: existing?.deleted ?? false,
      ...(existing ? {} : {
        created_by: email(),
        created_at: now,
        source: 'nuxt',
      }),
      updated_by: email(),
      updated_at: now,
    }
  }

  async function savePrintOrder(input: SavePrintOrderInput) {
    const actor = email()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')

    const orderCode = text(input.order_code)
    const sourceOrderId = text(input.order_id)
    if (!sourceOrderId || !orderCode) throw new Error('Vui lòng chọn mã đơn hàng.')
    validateItems(input.items)

    if (input.order) {
      if (text(input.order.order_id) !== sourceOrderId || text(input.order.order_code) !== orderCode) {
        throw new Error('Không thể chuyển một tiến độ in sang đơn hàng khác. Hãy xóa tiến độ cũ và tạo lại.')
      }
    }

    const orderId = input.order?.id || makeId('prt')
    const now = serverTimestamp()
    const supplier = input.supplier || null
    const existingItems = input.existingItems || []
    const existingById = new Map(existingItems.map(item => [item.id, item]))
    const nextItems = input.items.map(item => itemPayload(
      orderId,
      { ...item, id: item.id || makeId('pri') },
      item.id ? existingById.get(item.id) : undefined,
    ))
    const keptIds = new Set(nextItems.map(item => item.id))
    const removedItems = existingItems.filter(item => !keptIds.has(item.id))

    if (nextItems.length + removedItems.length > 450) {
      throw new Error('Đơn in có quá nhiều thay đổi để lưu trong một lần. Vui lòng chia nhỏ dữ liệu.')
    }

    const orderPayload = {
      id: orderId,
      order_id: sourceOrderId,
      order_code: orderCode,
      am_code: text(input.am_code),
      supplier_id: text(supplier?.id),
      supplier_name: text(supplier?.name || (supplier as any)?.supplier_name),
      note: text(input.note),
      ...(input.order ? {} : {
        status: 'active',
        active: true,
        deleted: false,
        created_by: actor,
        created_at: now,
        source: 'nuxt',
      }),
      updated_by: actor,
      updated_at: now,
    }

    const orderRef = doc(db, 'print_orders', orderId)
    const activityRef = doc(collection(db, 'activity_logs'))

    if (!input.order) {
      const sourceOrderRef = doc(db, 'orders', sourceOrderId)
      await runTransaction(db, async transaction => {
        const sourceSnapshot = await transaction.get(sourceOrderRef)
        if (!sourceSnapshot.exists() || sourceSnapshot.data().deleted === true) {
          throw new Error('Đơn hàng nguồn không còn tồn tại hoặc đã bị xóa.')
        }
        const currentCount = printingCount(sourceSnapshot.data())
        transaction.update(sourceOrderRef, buildPrintingLockFields({
          count: currentCount + 1,
          action: 'create',
          printOrderId: orderId,
          actor,
          updatedAt: now,
        }))
        transaction.set(orderRef, orderPayload)
        nextItems.forEach(item => transaction.set(doc(db, 'print_order_items', item.id), item))
        transaction.set(activityRef, activity('create', orderCode, {
          id: orderId,
          order_id: sourceOrderId,
          order_code: orderCode,
          item_count: nextItems.length,
        }))
      })
    } else {
      const batch = writeBatch(db)
      const { id: _id, ...updatePayload } = orderPayload
      batch.update(orderRef, updatePayload)
      nextItems.forEach(item => {
        const itemRef = doc(db, 'print_order_items', item.id)
        if (existingById.has(item.id)) {
          const { id: _itemId, ...itemUpdate } = item
          batch.update(itemRef, itemUpdate)
        } else batch.set(itemRef, item)
      })
      removedItems.forEach(item => {
        batch.update(doc(db, 'print_order_items', item.id), {
          deleted: true,
          active: false,
          status: 'deleted',
          deleted_at: now,
          deleted_by: actor,
          updated_by: actor,
          updated_at: now,
        })
      })
      batch.set(activityRef, activity('update', orderCode, {
        id: orderId,
        order_id: sourceOrderId,
        order_code: orderCode,
        item_count: nextItems.length,
      }))
      await batch.commit()
    }

    invalidatePrintingCaches()
    return { id: orderId, order_code: orderCode }
  }

  async function deletePrintOrder(order: PrintOrderDoc, items: PrintOrderItemDoc[]) {
    const actor = email()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')
    if (items.length > 450) throw new Error('Đơn in có quá nhiều dòng để xóa trong một lần.')

    const sourceOrderId = text(order.order_id)
    if (!sourceOrderId) throw new Error('Tiến độ in thiếu ID đơn hàng nguồn.')
    const now = serverTimestamp()
    const deletedPatch = {
      deleted: true,
      active: false,
      status: 'deleted',
      deleted_at: now,
      deleted_by: actor,
      updated_by: actor,
      updated_at: now,
    }
    const sourceOrderRef = doc(db, 'orders', sourceOrderId)
    const printOrderRef = doc(db, 'print_orders', order.id)
    const activityRef = doc(collection(db, 'activity_logs'))

    await runTransaction(db, async transaction => {
      const sourceSnapshot = await transaction.get(sourceOrderRef)
      const printSnapshot = await transaction.get(printOrderRef)
      if (!sourceSnapshot.exists()) throw new Error('Đơn hàng nguồn không còn tồn tại.')
      if (!printSnapshot.exists() || printSnapshot.data().deleted === true) {
        throw new Error('Tiến độ in đã bị xóa hoặc không còn tồn tại.')
      }
      if (text(printSnapshot.data().order_id) !== sourceOrderId) {
        throw new Error('Tiến độ in không còn khớp với đơn hàng nguồn.')
      }
      const currentCount = printingCount(sourceSnapshot.data())
      if (currentCount <= 0) {
        throw new Error('Khóa tiến độ in đang sai lệch. Hãy chạy đồng bộ trước khi xóa tiến độ.')
      }
      transaction.update(sourceOrderRef, buildPrintingLockFields({
        count: currentCount - 1,
        action: 'delete',
        printOrderId: order.id,
        actor,
        updatedAt: now,
      }))
      transaction.update(printOrderRef, deletedPatch)
      items.forEach(item => transaction.update(doc(db, 'print_order_items', item.id), deletedPatch))
      transaction.set(activityRef, activity('delete', order.order_code, {
        id: order.id,
        order_id: sourceOrderId,
        order_code: order.order_code,
      }))
    })
    invalidatePrintingCaches()
  }

  async function reconcilePrintingLocks(sourceOrders: OrderDoc[], printOrders: PrintOrderDoc[]) {
    const actor = email()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')
    const counts = printingCountsByOrder(sourceOrders, printOrders)
    const changed = sourceOrders.filter(order => {
      const expected = counts.get(order.id) || 0
      return Number(order.printing_lock_version) !== ORDER_PRINTING_LOCK_VERSION
        || Number(order.printing_progress_count) !== expected
    })

    for (let index = 0; index < changed.length; index += 400) {
      const group = changed.slice(index, index + 400)
      const batch = writeBatch(db)
      const now = serverTimestamp()
      group.forEach(order => {
        batch.update(doc(db, 'orders', order.id), buildPrintingLockFields({
          count: counts.get(order.id) || 0,
          action: 'reconcile',
          actor,
          updatedAt: now,
        }))
      })
      batch.set(doc(collection(db, 'activity_logs')), activity('reconcile', 'PRINTING_LOCKS', {
        order_count: group.length,
        order_ids: group.map(order => order.id),
      }))
      await batch.commit()
    }

    invalidatePrintingCaches()
    return { checked: sourceOrders.length, changed: changed.length }
  }

  return { savePrintOrder, deletePrintOrder, reconcilePrintingLocks }
}
