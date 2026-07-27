import { readFile, writeFile } from 'node:fs/promises'

const block = (...lines) => lines.join('\n')

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8')
  const count = source.split(before).length - 1
  if (count !== 1) {
    throw new Error(`${path}: expected exactly one guarded match, found ${count}`)
  }
  await writeFile(path, source.replace(before, after))
}

await replaceOnce(
  'constants/permissions.ts',
  "export const INVOICE_STATUS_OPTIONS = ['Không xuất', 'Khách lẻ', 'Yêu cầu xuất', 'HĐ nháp', 'Đã xuất']",
  "export const INVOICE_STATUS_OPTIONS = ['Không xuất', 'Yêu cầu xuất', 'Đã xuất']",
)

await replaceOnce(
  'composables/useScopedQueries.ts',
  block(
    "    const canReadForRelation = canAll('invoices.view_all')",
    "      || ['invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete'].some(key => hasPermission(key))",
  ),
  block(
    "    const canReadForRelation = canAll('invoices.view_all')",
    "      || ['invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete', 'orders.edit', 'orders.delete'].some(key => hasPermission(key))",
  ),
)

await replaceOnce(
  'utils/orderRelationState.mjs',
  block(
    '  const payments = number(order.payment_record_count)',
    '  const invoices = number(order.invoice_record_count)',
    '  const shipments = number(order.shipment_record_count)',
    '  const reasons = []',
    '  if (payments > 0) reasons.push(`${payments} phiếu thanh toán`)',
    '  if (invoices > 0) reasons.push(`${invoices} hóa đơn`)',
    '  if (shipments > 0) reasons.push(`${shipments} bản ghi vận chuyển`)',
  ),
  block(
    '  const payments = number(order.payment_record_count)',
    '  const shipments = number(order.shipment_record_count)',
    '  const reasons = []',
    '  if (payments > 0) reasons.push(`${payments} phiếu thanh toán`)',
    '  if (shipments > 0) reasons.push(`${shipments} bản ghi vận chuyển`)',
  ),
)

await replaceOnce(
  'pages/orders.vue',
  "import type { CustomerDoc, OrderDoc, OrderItemDoc, PaymentDoc, PrintOrderDoc, PrintOrderItemDoc, ProductDoc } from '~/types/models'",
  "import type { CustomerDoc, InvoiceDoc, OrderDoc, OrderItemDoc, PaymentDoc, PrintOrderDoc, PrintOrderItemDoc, ProductDoc } from '~/types/models'",
)

await replaceOnce(
  'pages/orders.vue',
  block(
    '// @ts-ignore Shared ESM helper is executed directly by Node client tests.',
    "import { orderRelationDeleteBlocker } from '~/utils/orderRelationState.mjs'",
  ),
  block(
    '// @ts-ignore Shared ESM helpers are executed directly by Node client tests.',
    "import { isActiveOrderRelation, orderRelationDeleteBlocker, selectCanonicalInvoice } from '~/utils/orderRelationState.mjs'",
    '// @ts-ignore Shared ESM helpers are executed directly by Node client tests.',
    "import {",
    "  assertSaleInvoiceStatus,",
    "  buildOrderInvoiceId,",
    "  invoiceStatusChangeRequested,",
    "  normalizeInvoiceStatus,",
    "  SALE_INVOICE_STATUSES,",
    "} from '~/utils/orderInvoiceFlow.mjs'",
  ),
)

await replaceOnce(
  'pages/orders.vue',
  block(
    '  loadScopedPaymentsForOrders,',
    '  loadScopedExportRequestsForOrders,',
  ),
  block(
    '  loadScopedPaymentsForOrders,',
    '  loadScopedInvoicesForOrders,',
    '  loadScopedExportRequestsForOrders,',
  ),
)

await replaceOnce(
  'pages/orders.vue',
  "const itemCount = computed(() => `${formItems.value.length} dòng`)",
  block(
    "const itemCount = computed(() => `${formItems.value.length} dòng`)",
    'const saleInvoiceStatusOptions = SALE_INVOICE_STATUSES',
    "const invoiceStatusLocked = computed(() => normalizeInvoiceStatus(editing.value?.invoice_status || form.invoice_status) === 'Đã xuất')",
  ),
)

await replaceOnce(
  'pages/orders.vue',
  block(
    '  editing.value = row || null',
    '  Object.keys(form).forEach(key => delete form[key])',
    '  Object.assign(form, row ? { ...row, order_date: dateTimeLocal(row.order_date) || row.order_date } : {',
  ),
  block(
    '  editing.value = row || null',
    '  Object.keys(form).forEach(key => delete form[key])',
    '  const normalizedRow = row ? {',
    '    ...row,',
    '    order_date: dateTimeLocal(row.order_date) || row.order_date,',
    '    invoice_status: normalizeInvoiceStatus(row.invoice_status),',
    '  } : null',
    '  Object.assign(form, normalizedRow || {',
  ),
)

await replaceOnce(
  'pages/orders.vue',
  block(
    "    order_status: 'Mới tạo',",
    "    order_classification: 'Chăm sóc',",
    '    vat_rate: 0,',
  ),
  block(
    "    order_status: 'Mới tạo',",
    "    order_classification: 'Chăm sóc',",
    "    invoice_status: 'Không xuất',",
    '    vat_rate: 0,',
  ),
)

await replaceOnce(
  'pages/orders.vue',
  block(
    '    const saveItems = buildSaveItems()',
    '    if (editing.value) {',
  ),
  block(
    "    const persistedInvoiceStatus = normalizeInvoiceStatus(editing.value?.invoice_status || 'Không xuất')",
    '    const formInvoiceStatus = normalizeInvoiceStatus(form.invoice_status)',
    "    const requestedInvoiceStatus = persistedInvoiceStatus === 'Đã xuất'",
    "      ? 'Đã xuất'",
    '      : assertSaleInvoiceStatus(formInvoiceStatus)',
    "    if (persistedInvoiceStatus === 'Đã xuất' && formInvoiceStatus !== 'Đã xuất') {",
    "      throw new Error('Hóa đơn đã xuất. Sale không được thay đổi trạng thái từ đơn hàng.')",
    '    }',
    '',
    '    const saveItems = buildSaveItems()',
    '    if (editing.value) {',
  ),
)

await replaceOnce(
  'pages/orders.vue',
  block(
    "    if (requestedDiscount > totals.actual_revenue) throw new Error('Số tiền giảm giá không được lớn hơn tổng tiền đơn.')",
    '',
    '    const baseOrder: any = { ...form, ...totals }',
  ),
  block(
    "    if (requestedDiscount > totals.actual_revenue) throw new Error('Số tiền giảm giá không được lớn hơn tổng tiền đơn.')",
    '',
    '    let invoiceMutation: any',
    '    if (!editing.value) {',
    '      invoiceMutation = {',
    "        mode: 'create',",
    '        invoiceId: buildOrderInvoiceId(form.id),',
    '        requestedStatus: requestedInvoiceStatus,',
    '        payload: {',
    "          tax_code: selectedCustomer?.tax_code || '',",
    "          company_name: selectedCustomer?.company_name || '',",
    "          billing_address: selectedCustomer?.billing_address || '',",
    "          note: '',",
    '        },',
    '      }',
    "    } else if (persistedInvoiceStatus !== 'Đã xuất' && invoiceStatusChangeRequested(persistedInvoiceStatus, requestedInvoiceStatus)) {",
    '      const activeInvoices = (await loadScopedInvoicesForOrders([editing.value], true)).filter(isActiveOrderRelation) as InvoiceDoc[]',
    '      const currentInvoice = selectCanonicalInvoice(activeInvoices) as InvoiceDoc | null',
    "      if (!currentInvoice) throw new Error('Không tìm thấy hóa đơn đang hoạt động của đơn. Hãy tải lại dữ liệu.')",
    '      invoiceMutation = {',
    "        mode: 'status_update',",
    '        invoiceId: currentInvoice.id,',
    '        requestedStatus: requestedInvoiceStatus,',
    '        expectedStatus: currentInvoice.invoice_status,',
    '        expectedRelationRevision: toNumber(currentInvoice.relation_revision),',
    '      }',
    '    }',
    '',
    '    const baseOrder: any = { ...form, ...totals }',
  ),
)

await replaceOnce(
  'pages/orders.vue',
  block(
    "        invoice_status: 'Không xuất',",
    "        warehouse_fulfillment_status: form.warehouse_fulfillment_status || 'chua_xuat',",
  ),
  block(
    '        invoice_status: requestedInvoiceStatus,',
    "        warehouse_fulfillment_status: form.warehouse_fulfillment_status || 'chua_xuat',",
  ),
)

await replaceOnce(
  'pages/orders.vue',
  block(
    '        payment_record_count: 0,',
    '        invoice_record_count: 0,',
    '        shipment_record_count: 0,',
    '        payment_relation_revision: 0,',
    '        invoice_relation_revision: 0,',
    '        shipment_relation_revision: 0,',
    "        relation_last_module: 'all',",
    "        relation_last_action: 'reconcile',",
    "        relation_last_document_id: '',",
  ),
  block(
    '        payment_record_count: 0,',
    '        invoice_record_count: 1,',
    '        shipment_record_count: 0,',
    '        payment_relation_revision: 0,',
    '        invoice_relation_revision: 1,',
    '        shipment_relation_revision: 0,',
    "        relation_last_module: 'invoices',",
    "        relation_last_action: 'create',",
    '        relation_last_document_id: buildOrderInvoiceId(form.id),',
  ),
)

await replaceOnce(
  'pages/orders.vue',
  block(
    '      nextItems: totals.items,',
    '      existingItems,',
    "      activityAction: editing.value ? 'update' : 'create',",
  ),
  block(
    '      nextItems: totals.items,',
    '      existingItems,',
    '      invoiceMutation,',
    "      activityAction: editing.value ? 'update' : 'create',",
  ),
)

await replaceOnce(
  'pages/orders.vue',
  block(
    "    invalidateScopedCache('orders')",
    "    invalidateScopedCache('order_items')",
    "    invalidateScopedCache('activity_logs')",
  ),
  block(
    "    invalidateScopedCache('orders')",
    "    invalidateScopedCache('order_items')",
    "    invalidateScopedCache('invoices')",
    "    invalidateScopedCache('activity_logs')",
  ),
)

await replaceOnce(
  'pages/orders.vue',
  block(
    '        <div class="form-group"><label>Trạng thái đơn</label><select v-model="form.order_status" class="select"><option v-for="s in ORDER_STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option></select></div>',
    '        <div class="form-group"><label>VAT %</label><select v-model.number="form.vat_rate" class="select"><option v-for="s in VAT_RATE_OPTIONS" :key="s" :value="s">{{ s }}</option></select></div>',
  ),
  block(
    '        <div class="form-group"><label>Trạng thái đơn</label><select v-model="form.order_status" class="select"><option v-for="s in ORDER_STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option></select></div>',
    '        <div class="form-group">',
    '          <label>Hóa đơn</label>',
    '          <select v-model="form.invoice_status" class="select" :disabled="invoiceStatusLocked">',
    '            <option v-for="status in saleInvoiceStatusOptions" :key="status" :value="status">{{ status }}</option>',
    '            <option v-if="invoiceStatusLocked" value="Đã xuất">Đã xuất</option>',
    '          </select>',
    '          <div v-if="invoiceStatusLocked" class="small subtle">Hóa đơn đã xuất; chỉ người có quyền tại trang Hóa đơn được cập nhật.</div>',
    '        </div>',
    '        <div class="form-group"><label>VAT %</label><select v-model.number="form.vat_rate" class="select"><option v-for="s in VAT_RATE_OPTIONS" :key="s" :value="s">{{ s }}</option></select></div>',
  ),
)

await replaceOnce(
  'pages/orders.vue',
  block(
    '  let latestOrder = row',
    '  let latestRequests: any[] = []',
    '  try {',
    '    const [latestOrderSnap, loadedRequests] = await Promise.all([',
    "      getDoc(doc(db, 'orders', row.id)),",
    '      loadScopedExportRequests([row], true),',
    '    ])',
    "    if (!latestOrderSnap.exists()) throw new Error('Không tìm thấy đơn hàng cần xóa.')",
    '    latestOrder = { ...latestOrderSnap.data(), id: latestOrderSnap.id } as OrderDoc',
    '    latestRequests = loadedRequests.filter(request => request.order_id === row.id && isActive(request))',
  ),
  block(
    '  let latestOrder = row',
    '  let latestRequests: any[] = []',
    '  let latestInvoices: InvoiceDoc[] = []',
    '  try {',
    '    const [latestOrderSnap, loadedRequests, loadedInvoices] = await Promise.all([',
    "      getDoc(doc(db, 'orders', row.id)),",
    '      loadScopedExportRequests([row], true),',
    '      loadScopedInvoicesForOrders([row], true),',
    '    ])',
    "    if (!latestOrderSnap.exists()) throw new Error('Không tìm thấy đơn hàng cần xóa.')",
    '    latestOrder = { ...latestOrderSnap.data(), id: latestOrderSnap.id } as OrderDoc',
    '    latestRequests = loadedRequests.filter(request => request.order_id === row.id && isActive(request))',
    '    latestInvoices = loadedInvoices.filter(invoice => invoice.order_id === row.id && isActive(invoice))',
  ),
)

await replaceOnce(
  'pages/orders.vue',
  '    if (orderItems.length + orderRequests.length + 2 > 500) {',
  '    if (orderItems.length + orderRequests.length + latestInvoices.length + 2 > 500) {',
)

await replaceOnce(
  'pages/orders.vue',
  block(
    '    orderRequests.forEach(request => {',
    "      batch.update(doc(db, 'order_export_requests', request.id), {",
    '        deleted: true,',
    '        active: false,',
    "        status: 'deleted',",
    '        deleted_at: deletedAt,',
    '        updated_at: deletedAt',
    '      })',
    '    })',
    '',
    "    batch.set(doc(collection(db, 'activity_logs')), {",
  ),
  block(
    '    orderRequests.forEach(request => {',
    "      batch.update(doc(db, 'order_export_requests', request.id), {",
    '        deleted: true,',
    '        active: false,',
    "        status: 'deleted',",
    '        deleted_at: deletedAt,',
    '        updated_at: deletedAt',
    '      })',
    '    })',
    '',
    '    latestInvoices.forEach(invoice => {',
    "      batch.update(doc(db, 'invoices', invoice.id), {",
    '        deleted: true,',
    '        active: false,',
    "        status: 'deleted',",
    '        deleted_at: deletedAt,',
    '        updated_at: deletedAt',
    '      })',
    '    })',
    '',
    "    batch.set(doc(collection(db, 'activity_logs')), {",
  ),
)

await replaceOnce(
  'pages/orders.vue',
  "      after_json: JSON.stringify({ order_id: row.id, deleted: true, deleted_requests: orderRequests.length }),",
  "      after_json: JSON.stringify({ order_id: row.id, deleted: true, deleted_requests: orderRequests.length, deleted_invoices: latestInvoices.length }),",
)

await replaceOnce(
  'pages/orders.vue',
  block(
    "    invalidateScopedCache('order_export_requests')",
    "    invalidateScopedCache('activity_logs')",
  ),
  block(
    "    invalidateScopedCache('order_export_requests')",
    "    invalidateScopedCache('invoices')",
    "    invalidateScopedCache('activity_logs')",
  ),
)

console.log('Guarded source patch applied.')
