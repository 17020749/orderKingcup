import { readFile, writeFile } from 'node:fs/promises'

const block = (...lines) => lines.join('\n')

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8')
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`${path}: expected exactly one guarded match, found ${count}`)
  await writeFile(path, source.replace(before, after))
}

await replaceOnce(
  'utils/orderAtomicSave.mjs',
  block(
    '// Pure helpers used by both the Nuxt client flow and Node business-flow tests.',
    'export const FIRESTORE_WRITE_LIMIT = 500',
    '',
    'function text(value) {',
  ),
  block(
    '// Pure helpers used by both the Nuxt client flow and Node business-flow tests.',
    'export const FIRESTORE_WRITE_LIMIT = 500',
    '',
    'export const ORDER_EDIT_SYSTEM_FIELDS = Object.freeze([',
    "  'paid_amount', 'debt_amount', 'computed_payment_status', 'payment_status',",
    "  'payment_count', 'deposit_count', 'collect_count',",
    "  'warehouse_fulfillment_status', 'warehouse_request_status',",
    "  'printing_progress_count', 'printing_lock_version', 'printing_last_action',",
    "  'printing_last_print_order_id', 'printing_lock_updated_by', 'printing_lock_updated_at',",
    "  'relation_lock_version', 'payment_record_count', 'invoice_record_count',",
    "  'shipment_record_count', 'payment_relation_revision', 'invoice_relation_revision',",
    "  'shipment_relation_revision', 'relation_last_module', 'relation_last_action',",
    "  'relation_last_document_id', 'relation_updated_by', 'relation_updated_at',",
    "  'invoice_status', 'shipment_status', 'shipping_fee_total', 'cod_amount_total',",
    "  'deleted', 'active', 'status', 'deleted_at', 'created_at',",
    '])',
    '',
    'export function stripOrderEditSystemFields(payload = {}) {',
    '  const clean = { ...(payload || {}) }',
    '  ORDER_EDIT_SYSTEM_FIELDS.forEach(field => delete clean[field])',
    '  return clean',
    '}',
    '',
    'function text(value) {',
  ),
)

await replaceOnce(
  'pages/orders.vue',
  block(
    "} from '~/utils/orderInvoiceFlow.mjs'",
    '// @ts-ignore Shared ESM helper is executed directly by Node client tests.',
    'import {',
  ),
  block(
    "} from '~/utils/orderInvoiceFlow.mjs'",
    '// @ts-ignore Shared ESM helper is executed directly by Node client tests.',
    "import { stripOrderEditSystemFields } from '~/utils/orderAtomicSave.mjs'",
    '// @ts-ignore Shared ESM helper is executed directly by Node client tests.',
    'import {',
  ),
)

await replaceOnce(
  'pages/orders.vue',
  block(
    '    const baseOrder: any = { ...form, ...totals }',
    '    if (editing.value) {',
    '      const protectedFields = [',
    "        'paid_amount', 'debt_amount', 'computed_payment_status', 'payment_status',",
    "        'payment_count', 'deposit_count', 'collect_count',",
    "        'warehouse_fulfillment_status', 'warehouse_request_status',",
    "        'invoice_status',",
    "        'deleted', 'active', 'status', 'deleted_at', 'created_at'",
    '      ]',
    '      protectedFields.forEach(key => delete baseOrder[key])',
    '    }',
  ),
  block(
    '    const baseOrder: any = editing.value',
    '      ? stripOrderEditSystemFields({ ...form, ...totals })',
    '      : { ...form, ...totals }',
  ),
)

await replaceOnce(
  'composables/useScopedQueries.ts',
  block(
    '  async function loadScopedPaymentsForOrders(orders: OrderDoc[], force = false) {',
  ),
  block(
    '  async function loadScopedOrdersForInvoices(invoices: InvoiceDoc[], force = false) {',
    '    const orderIds = Array.from(new Set(',
    "      invoices.map(invoice => String(invoice?.order_id || '').trim()).filter(Boolean),",
    '    ))',
    '    if (!orderIds.length) return [] as OrderDoc[]',
    '',
    "    if (canAll('orders.view_all')) {",
    "      return (await fetchByFieldValues<OrderDoc>('orders', 'id', orderIds))",
    '        .filter(isActive) as OrderDoc[]',
    '    }',
    '',
    "    if (!hasPermission('orders.view')) return [] as OrderDoc[]",
    '    const allowedOrderIds = new Set(orderIds)',
    '    return (await loadScopedOrders(force))',
    '      .filter(order => allowedOrderIds.has(order.id))',
    '  }',
    '',
    '  async function loadScopedPaymentsForOrders(orders: OrderDoc[], force = false) {',
  ),
)

await replaceOnce(
  'composables/useScopedQueries.ts',
  block(
    '    loadScopedOrders,',
    '    loadScopedOrdersPage,',
  ),
  block(
    '    loadScopedOrders,',
    '    loadScopedOrdersPage,',
    '    loadScopedOrdersForInvoices,',
  ),
)

await replaceOnce(
  'pages/invoices.vue',
  "const { loadScopedOrders, loadScopedInvoicesPage, loadScopedInvoicesForOrders } = useScopedQueries()",
  "const { loadScopedOrdersForInvoices, loadScopedInvoicesPage, loadScopedInvoicesForOrders } = useScopedQueries()",
)

await replaceOnce(
  'pages/invoices.vue',
  'const { appUser, permissions } = useAuth()',
  'const { appUser, permissions, hasPermission } = useAuth()',
)

await replaceOnce(
  'pages/invoices.vue',
  block(
    'const selectedOrder = computed(() => orders.value.find(order => order.id === form.order_id))',
    '',
    "function invoiceActionDecision(action: 'edit' | 'delete', row: InvoiceDoc, order?: OrderDoc | null) {",
  ),
  block(
    'function parentOrderForInvoice(row: InvoiceDoc) {',
    '  return orders.value.find(order => order.id === row.order_id) || null',
    '}',
    '',
    'const selectedOrder = computed(() => orders.value.find(order => order.id === form.order_id))',
    '',
    "function invoiceActionDecision(action: 'edit' | 'delete', row: InvoiceDoc, order?: OrderDoc | null) {",
  ),
)

await replaceOnce(
  'pages/invoices.vue',
  block(
    "function invoiceActionError(action: 'edit' | 'delete', row: InvoiceDoc) {",
    '  return permissionDecisionMessage(invoiceActionDecision(action, row), {',
    "    operation: `${action === 'edit' ? 'sửa' : 'xóa'} hóa đơn`,",
    '    record: row.invoice_number || row.id,',
    "    status: row.status || '',",
    '  })',
    '}',
    '',
    "function canEditInvoice(row: InvoiceDoc) { return invoiceActionDecision('edit', row).allowed }",
    "function canDeleteInvoice(row: InvoiceDoc) { return invoiceActionDecision('delete', row).allowed }",
  ),
  block(
    "function invoiceActionError(action: 'edit' | 'delete', row: InvoiceDoc) {",
    '  const order = parentOrderForInvoice(row)',
    '  if (!order) {',
    "    return hasPermission('orders.view_all') || hasPermission('*')",
    "      ? 'Không tải được đơn hàng cha của hóa đơn. Hãy làm mới trang.'",
    "      : 'Tài khoản cần quyền orders.view_all để sửa hoặc xóa hóa đơn của Sale khác.'",
    '  }',
    '  return permissionDecisionMessage(invoiceActionDecision(action, row, order), {',
    "    operation: `${action === 'edit' ? 'sửa' : 'xóa'} hóa đơn`,",
    '    record: row.invoice_number || row.id,',
    "    status: row.status || '',",
    '  })',
    '}',
    '',
    'function canEditInvoice(row: InvoiceDoc) {',
    '  const order = parentOrderForInvoice(row)',
    '  if (!order) return false',
    "  return invoiceActionDecision('edit', row, order).allowed",
    '}',
    'function canDeleteInvoice(row: InvoiceDoc) {',
    '  const order = parentOrderForInvoice(row)',
    '  if (!order) return false',
    "  return invoiceActionDecision('delete', row, order).allowed",
    '}',
  ),
)

await replaceOnce(
  'pages/invoices.vue',
  block(
    '  try {',
    '    if (!append) orders.value = await loadScopedOrders(force)',
    '    const page = await loadScopedInvoicesPage(append ? pageCursor.value : null, PAGE_SIZE, force)',
    '    const loadedRows = page.rows.filter(isActive)',
    '    rows.value = append ? appendUniqueRows(rows.value, loadedRows) : loadedRows',
    '    pageCursor.value = page.cursor',
  ),
  block(
    '  try {',
    '    const page = await loadScopedInvoicesPage(append ? pageCursor.value : null, PAGE_SIZE, force)',
    '    const loadedRows = page.rows.filter(isActive)',
    '    const loadedOrders = await loadScopedOrdersForInvoices(loadedRows, force)',
    '    rows.value = append ? appendUniqueRows(rows.value, loadedRows) : loadedRows',
    '    orders.value = append ? appendUniqueRows(orders.value, loadedOrders) : loadedOrders',
    '    if (!append && loadedRows.some(row => !parentOrderForInvoice(row))',
    "      && (hasPermission('invoices.edit') || hasPermission('invoices.delete'))) {",
    "      showToast('Một số hóa đơn không thể sửa vì tài khoản chưa đọc được đơn hàng cha. Kế toán xử lý toàn bộ hóa đơn cần quyền orders.view_all.', 'warning')",
    '    }',
    '    pageCursor.value = page.cursor',
  ),
)

await replaceOnce(
  'package.json',
  'tests/order-invoice-flow.rules.test.mjs tests/order-invoice-access-limits.rules.test.mjs tests/order-item-dependencies.client.test.mjs',
  'tests/order-invoice-flow.rules.test.mjs tests/order-invoice-access-limits.rules.test.mjs tests/order-invoice-post-merge.client.test.mjs tests/order-item-dependencies.client.test.mjs',
)

console.log('Guarded post-merge patch applied.')
