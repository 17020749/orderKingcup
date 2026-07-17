import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import type {
  PrintOrderDoc,
  PrintOrderItemDoc,
  ProductDoc,
  SupplierDoc,
} from '~/types/models'
import { invalidateScopedCache } from '~/composables/useScopedQueries'
import { makeId, normalizeEmail, toNumber } from '~/utils/format'

export type PrintItemInput = {
  id?: string
  product: ProductDoc
  logo?: string
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
    if (!text(item.product?.id)) throw new Error(`Dòng ${line}: vui lòng chọn sản phẩm.`)
    if (toNumber(item.print_quantity) <= 0) throw new Error(`Dòng ${line}: số lượng in phải lớn hơn 0.`)
    if (toNumber(item.actual_print_quantity) < 0) throw new Error(`Dòng ${line}: số lượng in thực tế không được âm.`)
    if (item.print_started_at && item.expected_done_at) {
      const started = new Date(item.print_started_at).getTime()
      const expected = new Date(item.expected_done_at).getTime()
      if (!Number.isNaN(started) && !Number.isNaN(expected) && expected < started) {
        throw new Error(`Dòng ${line}: thời gian dự kiến xong phải sau thời gian bắt đầu in.`)
      }
    }
  })
}

function invalidatePrintingCaches() {
  ;['print_orders', 'print_order_items', 'activity_logs'].forEach(invalidateScopedCache)
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

    const batch = writeBatch(db)
    const orderRef = doc(db, 'print_orders', orderId)
    if (input.order) {
      const { id: _id, ...updatePayload } = orderPayload
      batch.update(orderRef, updatePayload)
    } else batch.set(orderRef, orderPayload)

    nextItems.forEach(item => {
      const itemRef = doc(db, 'print_order_items', item.id)
      if (existingById.has(item.id)) {
        const { id: _id, ...updatePayload } = item
        batch.update(itemRef, updatePayload)
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

    batch.set(
      doc(collection(db, 'activity_logs')),
      activity(input.order ? 'update' : 'create', orderCode, {
        id: orderId,
        order_id: sourceOrderId,
        order_code: orderCode,
        am_code: text(input.am_code),
        supplier_id: text(supplier?.id),
        supplier_name: text(supplier?.name || (supplier as any)?.supplier_name),
        item_count: nextItems.length,
      }),
    )
    await batch.commit()
    invalidatePrintingCaches()
    return { id: orderId, order_code: orderCode }
  }

  async function deletePrintOrder(order: PrintOrderDoc, items: PrintOrderItemDoc[]) {
    const actor = email()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')
    if (items.length > 450) throw new Error('Đơn in có quá nhiều dòng để xóa trong một lần.')

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
    const batch = writeBatch(db)
    batch.update(doc(db, 'print_orders', order.id), deletedPatch)
    items.forEach(item => {
      batch.update(doc(db, 'print_order_items', item.id), deletedPatch)
    })
    batch.set(
      doc(collection(db, 'activity_logs')),
      activity('delete', order.order_code, { id: order.id, order_code: order.order_code }),
    )
    await batch.commit()
    invalidatePrintingCaches()
  }

  return { savePrintOrder, deletePrintOrder }
}
