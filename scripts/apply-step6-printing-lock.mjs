import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

function write(path, content) {
  writeFileSync(path, content)
}

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Không tìm thấy đoạn cần sửa: ${label}`)
  return source.replace(before, after)
}

const progressSource = `import { collection, doc, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore'
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
`
write('composables/usePrintingProgress.ts', progressSource)

let orders = read('pages/orders.vue')
orders = replaceOnce(
  orders,
  "import type { CustomerDoc, OrderDoc, OrderItemDoc, PaymentDoc, ProductDoc } from '~/types/models'",
  "import type { CustomerDoc, OrderDoc, OrderItemDoc, PaymentDoc, PrintOrderDoc, ProductDoc } from '~/types/models'",
  'orders type import',
)
orders = replaceOnce(
  orders,
  "import { reportFirebaseError } from '~/utils/firebaseErrors'",
  "import { reportFirebaseError } from '~/utils/firebaseErrors'\n// @ts-ignore Shared ESM helpers are executed directly by Node client tests.\nimport { printingDeleteBlocker } from '~/utils/orderPrintingDeleteLock.mjs'",
  'orders lock import',
)
orders = replaceOnce(
  orders,
  'const { saveOrderAtomic } = useAtomicOrderSave()',
  "const { saveOrderAtomic } = useAtomicOrderSave()\nconst { loadPrintingProgressForOrders, loadPrintingProgressForOrder } = useOrderPrintingDeleteGuard()",
  'orders delete guard composable',
)
orders = replaceOnce(
  orders,
  'const exportRequests = ref<any[]>([])',
  'const exportRequests = ref<any[]>([])\nconst printingProgress = ref<PrintOrderDoc[]>([])',
  'orders printing state',
)
orders = replaceOnce(
  orders,
  `    const [loadedItems, loadedPayments, loadedRequests] = await Promise.all([
      loadScopedOrderItems(allOrders, force),
      loadScopedPayments(allOrders, force),
      loadScopedExportRequests(allOrders, force)
    ])`,
  `    const [loadedItems, loadedPayments, loadedRequests, loadedPrintingProgress] = await Promise.all([
      loadScopedOrderItems(allOrders, force),
      loadScopedPayments(allOrders, force),
      loadScopedExportRequests(allOrders, force),
      loadPrintingProgressForOrders(allOrders)
    ])`,
  'orders load printing progress',
)
orders = replaceOnce(
  orders,
  '    exportRequests.value = loadedRequests',
  '    exportRequests.value = loadedRequests\n    printingProgress.value = loadedPrintingProgress',
  'orders assign printing progress',
)
orders = replaceOnce(
  orders,
  `function canDeleteRow(row: OrderDoc) {
  return hasPermission('orders.delete') && !orderHasWarehouseExport(row)
}`,
  `function orderDeleteBlocker(row: OrderDoc) {
  if (orderHasWarehouseExport(row)) {
    return 'Đơn hàng đã có số lượng xuất kho hoặc mã phiếu Warehouse nên không thể xóa.'
  }
  return printingDeleteBlocker(row, printingProgress.value)
}

function canDeleteRow(row: OrderDoc) {
  return hasPermission('orders.delete') && !orderDeleteBlocker(row)
}`,
  'orders delete blocker',
)
orders = replaceOnce(
  orders,
  `        warehouse_request_status: form.warehouse_request_status || '',
        created_at: serverTimestamp(),`,
  `        warehouse_request_status: form.warehouse_request_status || '',
        printing_progress_count: 0,
        printing_lock_version: 1,
        printing_last_action: 'reconcile',
        printing_last_print_order_id: '',
        printing_lock_updated_by: createdBy,
        printing_lock_updated_at: serverTimestamp(),
        created_at: serverTimestamp(),`,
  'orders initialize printing lock',
)
orders = replaceOnce(
  orders,
  `async function softDeleteOrder(row: OrderDoc) {
  if (!canDeleteRow(row)) return showToast('Đơn đã có lịch sử xuất kho, không thể xóa', 'error')`,
  `async function softDeleteOrder(row: OrderDoc) {
  if (!hasPermission('orders.delete')) return showToast('Bạn không có quyền xóa đơn hàng.', 'error')
  const initialBlocker = orderDeleteBlocker(row)
  if (initialBlocker) return showToast(initialBlocker, 'error')`,
  'orders delete entry guard',
)
orders = replaceOnce(
  orders,
  `    const orderItems = itemsByOrder.value[row.id] || []
    const orderRequests = exportRequests.value.filter(request => request.order_id === row.id && isActive(request))
    if (orderHasWarehouseExport(row)) {
      throw new Error('Đơn hàng đã có số lượng xuất kho hoặc mã phiếu Warehouse nên không thể xóa.')
    }`,
  `    const orderItems = itemsByOrder.value[row.id] || []
    const orderRequests = exportRequests.value.filter(request => request.order_id === row.id && isActive(request))
    if (orderHasWarehouseExport(row)) {
      throw new Error('Đơn hàng đã có số lượng xuất kho hoặc mã phiếu Warehouse nên không thể xóa.')
    }
    const latestPrintingProgress = await loadPrintingProgressForOrder(row.id)
    const latestPrintingBlocker = printingDeleteBlocker(row, latestPrintingProgress)
    if (latestPrintingBlocker) throw new Error(latestPrintingBlocker)`,
  'orders fresh printing guard',
)
orders = replaceOnce(
  orders,
  '    exportRequests.value = exportRequests.value.filter(request => request.order_id !== row.id)\n    delete itemsByOrder.value[row.id]',
  '    exportRequests.value = exportRequests.value.filter(request => request.order_id !== row.id)\n    printingProgress.value = printingProgress.value.filter(progress => progress.order_id !== row.id)\n    delete itemsByOrder.value[row.id]',
  'orders cleanup printing state',
)
orders = replaceOnce(
  orders,
  `<button v-else-if="hasPermission('orders.delete')" class="btn-sm" disabled>Khóa</button>`,
  `<button v-else-if="hasPermission('orders.delete')" class="btn-sm" disabled :title="orderDeleteBlocker(row)">Khóa</button>`,
  'orders locked button reason',
)
write('pages/orders.vue', orders)

let printingPage = read('pages/printing.vue')
printingPage = replaceOnce(
  printingPage,
  'const { savePrintOrder, deletePrintOrder } = usePrintingProgress()',
  'const { savePrintOrder, deletePrintOrder, reconcilePrintingLocks } = usePrintingProgress()',
  'printing reconcile composable',
)
printingPage = replaceOnce(
  printingPage,
  'const saving = ref(false)',
  'const saving = ref(false)\nconst reconciling = ref(false)',
  'printing reconcile state',
)
printingPage = replaceOnce(
  printingPage,
  `async function loadRows(force = false) {`,
  `async function syncOrderPrintingLocks() {
  if (!isAdmin.value) return showToast('Chỉ quản trị viên được đồng bộ khóa xóa đơn.', 'error')
  const confirmed = await askConfirm({
    title: 'Đồng bộ khóa xóa đơn',
    message: 'Hệ thống sẽ đếm lại toàn bộ tiến độ in còn hiệu lực và cập nhật khóa xóa trên từng đơn hàng. Tiếp tục?',
    confirmLabel: 'Đồng bộ khóa',
  })
  if (!confirmed) return

  reconciling.value = true
  try {
    const result = await reconcilePrintingLocks(sourceOrders.value, rows.value)
    showToast('Đã kiểm tra ' + result.checked + ' đơn và cập nhật ' + result.changed + ' khóa in.', 'success')
    await loadRows(true)
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không đồng bộ được khóa tiến độ in.'), 'error')
  } finally {
    reconciling.value = false
  }
}

async function loadRows(force = false) {`,
  'printing reconcile function',
)
printingPage = replaceOnce(
  printingPage,
  `<PageHeader title="Tiến độ in ấn" :subtitle="pageSubtitle">
      <button v-if="canCreate" class="btn primary" @click="openCreateModal">+ Thêm đơn in</button>
      <button class="btn" @click="loadRows(true)">Làm mới</button>`,
  `<PageHeader title="Tiến độ in ấn" :subtitle="pageSubtitle">
      <button v-if="canCreate" class="btn primary" @click="openCreateModal">+ Thêm đơn in</button>
      <button v-if="isAdmin" class="btn" :disabled="reconciling" @click="syncOrderPrintingLocks">{{ reconciling ? 'Đang đồng bộ...' : 'Đồng bộ khóa xóa đơn' }}</button>
      <button class="btn" @click="loadRows(true)">Làm mới</button>`,
  'printing reconcile button',
)
printingPage = replaceOnce(
  printingPage,
  `            :options="orderOptions"
            placeholder="Tìm đơn có sản phẩm logo theo mã, khách hàng hoặc SĐT..."
            @change="chooseSourceOrder"`,
  `            :options="orderOptions"
            :disabled="!!editing"
            placeholder="Tìm đơn có sản phẩm logo theo mã, khách hàng hoặc SĐT..."
            @change="chooseSourceOrder"`,
  'printing disable source change',
)
printingPage = replaceOnce(
  printingPage,
  '<div class="small subtle">Chỉ hiển thị đơn và sản phẩm đã tick Có logo.</div>',
  '<div class="small subtle">Chỉ hiển thị đơn và sản phẩm đã tick Có logo. Khi sửa, không thể chuyển tiến độ sang đơn khác.</div>',
  'printing source hint',
)
write('pages/printing.vue', printingPage)

let models = read('types/models.ts')
models = replaceOnce(
  models,
  `  warehouse_request_status?: string
  status?: string`,
  `  warehouse_request_status?: string
  printing_progress_count?: number
  printing_lock_version?: number
  printing_last_action?: 'create' | 'delete' | 'reconcile'
  printing_last_print_order_id?: string
  printing_lock_updated_by?: string
  printing_lock_updated_at?: any
  status?: string`,
  'order model printing lock fields',
)
write('types/models.ts', models)

let rules = read('firestore.rules')
rules = replaceOnce(
  rules,
  `    function orderCanBeDeleted() {
      return fulfillmentStatus() != 'da_xuat_1_phan'
        && fulfillmentStatus() != 'da_xuat_du';
    }`,
  `    function orderCanBeDeleted() {
      return fulfillmentStatus() != 'da_xuat_1_phan'
        && fulfillmentStatus() != 'da_xuat_du'
        && printingLockReadyData(resource.data)
        && resource.data.get('printing_progress_count', -1) == 0;
    }`,
  'rules order delete printing lock',
)
rules = replaceOnce(
  rules,
  `    function printOrderPath(printOrderId) {
      return /databases/$(database)/documents/print_orders/$(printOrderId);
    }

    function ownsPrintOrderData(data) {`,
  `    function printOrderPath(printOrderId) {
      return /databases/$(database)/documents/print_orders/$(printOrderId);
    }

    function printingLockReadyData(data) {
      return data.get('printing_lock_version', 0) == 1
        && data.get('printing_progress_count', -1) is int
        && data.get('printing_progress_count', -1) >= 0;
    }

    function onlyPrintingLockChanged() {
      return onlyChanged([
        'printing_progress_count',
        'printing_lock_version',
        'printing_last_action',
        'printing_last_print_order_id',
        'printing_lock_updated_by',
        'printing_lock_updated_at'
      ]);
    }

    function orderPrintingCreateSummaryAllowed(orderId) {
      let printOrderId = request.resource.data.get('printing_last_print_order_id', '');
      let path = printOrderPath(printOrderId);
      return hasPerm('printing.create')
        && printingLockReadyData(resource.data)
        && onlyPrintingLockChanged()
        && request.resource.data.get('printing_lock_version', 0) == 1
        && request.resource.data.get('printing_progress_count', -1) == resource.data.get('printing_progress_count', -1) + 1
        && request.resource.data.get('printing_last_action', '') == 'create'
        && printOrderId is string
        && printOrderId != ''
        && ownEmailField(request.resource.data, 'printing_lock_updated_by')
        && !exists(path)
        && existsAfter(path)
        && getAfter(path).data.get('order_id', '') == orderId
        && getAfter(path).data.get('deleted', false) != true
        && getAfter(path).data.get('active', true) != false;
    }

    function orderPrintingDeleteSummaryAllowed(orderId) {
      let printOrderId = request.resource.data.get('printing_last_print_order_id', '');
      let path = printOrderPath(printOrderId);
      return hasPerm('printing.delete')
        && printingLockReadyData(resource.data)
        && resource.data.get('printing_progress_count', 0) > 0
        && onlyPrintingLockChanged()
        && request.resource.data.get('printing_lock_version', 0) == 1
        && request.resource.data.get('printing_progress_count', -1) == resource.data.get('printing_progress_count', -1) - 1
        && request.resource.data.get('printing_last_action', '') == 'delete'
        && printOrderId is string
        && printOrderId != ''
        && ownEmailField(request.resource.data, 'printing_lock_updated_by')
        && exists(path)
        && get(path).data.get('order_id', '') == orderId
        && get(path).data.get('deleted', false) != true
        && existsAfter(path)
        && getAfter(path).data.get('order_id', '') == orderId
        && getAfter(path).data.get('deleted', false) == true
        && getAfter(path).data.get('active', true) == false;
    }

    function orderPrintingSummaryUpdateAllowed(orderId) {
      return orderPrintingCreateSummaryAllowed(orderId)
        || orderPrintingDeleteSummaryAllowed(orderId);
    }

    function printCreateHasParentLock(printOrderId, data) {
      let orderId = data.get('order_id', '');
      let path = orderPath(orderId);
      return orderId is string
        && orderId != ''
        && exists(path)
        && existsAfter(path)
        && printingLockReadyData(get(path).data)
        && printingLockReadyData(getAfter(path).data)
        && getAfter(path).data.get('printing_progress_count', -1) == get(path).data.get('printing_progress_count', -1) + 1
        && getAfter(path).data.get('printing_last_action', '') == 'create'
        && getAfter(path).data.get('printing_last_print_order_id', '') == printOrderId
        && emailFieldEquals(getAfter(path).data, 'printing_lock_updated_by', email());
    }

    function printDeleteHasParentLock(printOrderId, orderId) {
      let path = orderPath(orderId);
      return orderId is string
        && orderId != ''
        && exists(path)
        && existsAfter(path)
        && printingLockReadyData(get(path).data)
        && printingLockReadyData(getAfter(path).data)
        && get(path).data.get('printing_progress_count', 0) > 0
        && getAfter(path).data.get('printing_progress_count', -1) == get(path).data.get('printing_progress_count', -1) - 1
        && getAfter(path).data.get('printing_last_action', '') == 'delete'
        && getAfter(path).data.get('printing_last_print_order_id', '') == printOrderId
        && emailFieldEquals(getAfter(path).data, 'printing_lock_updated_by', email());
    }

    function ownsPrintOrderData(data) {`,
  'rules printing lock helpers',
)
rules = replaceOnce(
  rules,
  `        || (
          hasPerm('printing.view')
          && ownsPrintOrderData(data)
        );`,
  `        || (
          hasPerm('printing.view')
          && ownsPrintOrderData(data)
        )
        || (
          hasPerm('orders.delete')
          && data.get('order_id', '') is string
          && ownsOrderById(data.get('order_id', ''))
        );`,
  'rules owner delete reads printing progress',
)
rules = replaceOnce(
  rules,
  `          'warehouse_request_status',
          'deleted',`,
  `          'warehouse_request_status',
          'printing_progress_count',
          'printing_lock_version',
          'printing_last_action',
          'printing_last_print_order_id',
          'printing_lock_updated_by',
          'printing_lock_updated_at',
          'deleted',`,
  'rules protect printing lock from normal edit',
)
rules = replaceOnce(
  rules,
  `      allow create: if hasPerm('orders.create')
        && ownEmailField(request.resource.data, 'created_by')
        && ownsOrderData(request.resource.data)
        && validOrderNumberCreate();`,
  `      allow create: if hasPerm('orders.create')
        && ownEmailField(request.resource.data, 'created_by')
        && ownsOrderData(request.resource.data)
        && validOrderNumberCreate()
        && printingLockReadyData(request.resource.data)
        && request.resource.data.get('printing_progress_count', -1) == 0;`,
  'rules require lock on new order',
)
rules = replaceOnce(
  rules,
  `      allow update: if orderWarehouseSummaryUpdateAllowed()
        || isAdmin()`,
  `      allow update: if orderWarehouseSummaryUpdateAllowed()
        || orderPrintingSummaryUpdateAllowed(docId)
        || isAdmin()`,
  'rules allow atomic printing summary update',
)
rules = replaceOnce(
  rules,
  `      allow create: if hasPerm('printing.create')
        && request.resource.data.get('order_code', '') is string
        && request.resource.data.get('order_code', '') != ''
        && printOrderSourceMatches(request.resource.data)
        && ownEmailField(request.resource.data, 'created_by');`,
  `      allow create: if hasPerm('printing.create')
        && request.resource.data.get('order_code', '') is string
        && request.resource.data.get('order_code', '') != ''
        && printOrderSourceMatches(request.resource.data)
        && printCreateHasParentLock(docId, request.resource.data)
        && ownEmailField(request.resource.data, 'created_by');`,
  'rules print create parent lock',
)
rules = replaceOnce(
  rules,
  `          warehouseSoftDeleteOnly()
          && hasPerm('printing.delete')`,
  `          warehouseSoftDeleteOnly()
          && hasPerm('printing.delete')
          && unchanged(['order_id', 'order_code'])
          && printDeleteHasParentLock(docId, resource.data.get('order_id', ''))`,
  'rules print delete parent lock',
)
rules = replaceOnce(
  rules,
  `          unchanged(['deleted', 'active', 'status', 'deleted_at', 'deleted_by'])
          && hasPerm('printing.edit')`,
  `          unchanged(['deleted', 'active', 'status', 'deleted_at', 'deleted_by'])
          && unchanged(['order_id', 'order_code'])
          && hasPerm('printing.edit')`,
  'rules print edit immutable source',
)
write('firestore.rules', rules)

const pkg = JSON.parse(read('package.json'))
const command = pkg.scripts['test:rules']
for (const file of [
  'tests/order-printing-delete-lock.client.test.mjs',
  'tests/order-printing-delete-lock.rules.test.mjs',
]) {
  if (!command.includes(file)) {
    pkg.scripts['test:rules'] = pkg.scripts['test:rules'].replace(
      'tests/order-atomic-save.rules.test.mjs',
      'tests/order-atomic-save.rules.test.mjs ' + file,
    )
  }
}
write('package.json', JSON.stringify(pkg, null, 2) + '\n')

for (const path of [
  'scripts/apply-step6-printing-lock.mjs',
  '.github/workflows/apply-step6-printing-lock.yml',
]) {
  try { unlinkSync(path) } catch {}
}

console.log('Đã áp dụng Bước 6: khóa xóa đơn theo tiến độ in.')
