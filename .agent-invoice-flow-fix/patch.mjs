import { readFile, writeFile } from 'node:fs/promises'

function block(...lines) {
  return lines.join('\n')
}

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8')
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`${path}: expected one guarded match, found ${count}`)
  await writeFile(path, source.replace(before, after))
}

await replaceOnce(
  'pages/orders.vue',
  block(
    '    } else {',
    '      const persistedInvoiceCount = toNumber(editing.value.invoice_record_count)',
    "      const statusChanged = persistedInvoiceStatus !== 'Đã xuất'",
    '        && invoiceStatusChangeRequested(persistedInvoiceStatus, requestedInvoiceStatus)',
    '      if (persistedInvoiceCount !== 1 || statusChanged) {',
    '        const activeInvoices = (await loadScopedInvoicesForOrders([editing.value], true))',
    '          .filter(isActiveOrderRelation) as InvoiceDoc[]',
    '        if (activeInvoices.length > 1) {',
    "          throw new Error('Đơn hàng có nhiều hóa đơn đang hoạt động. Hãy xử lý trùng trước khi lưu.')",
    '        }',
    '        const currentInvoice = selectCanonicalInvoice(activeInvoices) as InvoiceDoc | null',
    '        if (!currentInvoice) {',
    '          invoiceMutation = {',
    "            mode: 'legacy_create',",
    '            invoiceId: buildOrderInvoiceId(form.id),',
    '            requestedStatus: requestedInvoiceStatus,',
    '            payload: {',
    "              tax_code: selectedCustomer?.tax_code || '',",
    "              company_name: selectedCustomer?.company_name || '',",
    "              billing_address: selectedCustomer?.billing_address || '',",
    "              note: '',",
    '            },',
    '          }',
    '        } else if (statusChanged) {',
    '          invoiceMutation = {',
    "            mode: 'status_update',",
    '            invoiceId: currentInvoice.id,',
    '            requestedStatus: requestedInvoiceStatus,',
    '            expectedStatus: currentInvoice.invoice_status,',
    '            expectedRelationRevision: toNumber(currentInvoice.relation_revision),',
    '          }',
    '        } else if (persistedInvoiceCount !== 1) {',
    "          throw new Error('Đơn hàng đã có hóa đơn nhưng dữ liệu liên kết chưa đồng bộ. Hãy chạy đồng bộ hóa đơn legacy trước.')",
    '        }',
    '      }',
    '    }',
  ),
  block(
    '    } else {',
    "      const statusChanged = persistedInvoiceStatus !== 'Đã xuất'",
    '        && invoiceStatusChangeRequested(persistedInvoiceStatus, requestedInvoiceStatus)',
    '      const activeInvoices = (await loadScopedInvoicesForOrders([editing.value], true))',
    '        .filter(isActiveOrderRelation) as InvoiceDoc[]',
    '      if (activeInvoices.length > 1) {',
    "        throw new Error('Đơn hàng có nhiều hóa đơn đang hoạt động. Hãy xử lý trùng trước khi lưu.')",
    '      }',
    '      const currentInvoice = selectCanonicalInvoice(activeInvoices) as InvoiceDoc | null',
    '      if (!currentInvoice) {',
    '        invoiceMutation = {',
    "          mode: 'legacy_create',",
    '          invoiceId: buildOrderInvoiceId(form.id),',
    '          requestedStatus: requestedInvoiceStatus,',
    '          payload: {',
    "            tax_code: selectedCustomer?.tax_code || '',",
    "            company_name: selectedCustomer?.company_name || '',",
    "            billing_address: selectedCustomer?.billing_address || '',",
    "            note: '',",
    '          },',
    '        }',
    '      } else if (statusChanged) {',
    '        invoiceMutation = {',
    "          mode: 'status_update',",
    '          invoiceId: currentInvoice.id,',
    '          requestedStatus: requestedInvoiceStatus,',
    '          expectedStatus: currentInvoice.invoice_status,',
    '          expectedRelationRevision: toNumber(currentInvoice.relation_revision),',
    '        }',
    '      }',
    '    }',
  ),
)

await replaceOnce(
  'composables/useAtomicOrderSave.ts',
  "import { moduleActionDecision, permissionDecisionMessage } from '~/utils/permissionDecisions.mjs'",
  block(
    "import { moduleActionDecision, permissionDecisionMessage } from '~/utils/permissionDecisions.mjs'",
    '// @ts-ignore Shared ESM helper is executed directly by Node client tests.',
    "import { isActiveOrderRelation } from '~/utils/orderRelationState.mjs'",
  ),
)

await replaceOnce(
  'composables/useAtomicOrderSave.ts',
  block(
    "        if (invoiceMutation.mode === 'legacy_create') {",
    '          if (invoiceSnapshot?.exists()) {',
    "            throw new Error('Đơn hàng đã có document hóa đơn theo ID tự động. Hãy tải lại dữ liệu.')",
    '          }',
    '          if (toNumber(existingOrder.invoice_record_count) > 0) {',
    "            throw new Error('Đơn hàng đang ghi nhận đã có hóa đơn. Hãy chạy đồng bộ quan hệ trước khi lưu.')",
    '          }',
    "        } else if (invoiceMutation.mode === 'status_update') {",
  ),
  block(
    "        if (invoiceMutation.mode === 'legacy_create') {",
    '          if (invoiceSnapshot?.exists()) {',
    '            const persistedInvoice = invoiceSnapshot.data()',
    '            if (isActiveOrderRelation(persistedInvoice)) {',
    "              throw new Error('Đơn hàng đã có document hóa đơn đang hoạt động. Hãy tải lại dữ liệu.')",
    '            }',
    "            if (String(persistedInvoice.order_id || '') !== input.orderId) {",
    "              throw new Error('Document hóa đơn tự động đang thuộc đơn hàng khác. Hãy xử lý xung đột trước khi lưu.')",
    '            }',
    '            existingInvoice = persistedInvoice',
    '          }',
    "        } else if (invoiceMutation.mode === 'status_update') {",
  ),
)

await replaceOnce(
  'composables/useAtomicOrderSave.ts',
  '          created_at: serverTimestamp(),',
  '          created_at: existingInvoice?.created_at || serverTimestamp(),',
)

await replaceOnce(
  'composables/useAtomicOrderRelations.ts',
  block(
    "    const action = mode === 'update' ? 'edit' : mode",
    '    const decision = moduleActionDecision({',
    '      actionPermission: `${module}.${action}`,',
    '      viewAllPermission: `${module}.view_all`,',
    '      permissions: permissions.value,',
    '      // Create scope is determined by the selected parent order. Treating a',
    '      // draft child (whose created_by is the actor) as owned would widen scope.',
    "      record: mode === 'create' ? null : record,",
    '      parent: order,',
    '      currentUserEmail: actor,',
    '    })',
  ),
  block(
    "    const action = mode === 'update' ? 'edit' : mode",
    "    const requiresGlobalScope = module === 'invoices'",
    '    const decision = moduleActionDecision({',
    '      actionPermission: `${module}.${action}`,',
    '      viewAllPermission: `${module}.view_all`,',
    '      permissions: permissions.value,',
    '      // Hóa đơn kế toán luôn cần view_all + action. Sale đổi trạng thái hóa đơn',
    '      // qua transaction sửa đơn hàng, không đi qua composable relation này.',
    "      record: requiresGlobalScope ? null : (mode === 'create' ? null : record),",
    '      parent: requiresGlobalScope ? null : order,',
    '      currentUserEmail: actor,',
    '    })',
  ),
)

await replaceOnce(
  'pages/invoices.vue',
  block(
    "function invoiceActionDecision(action: 'edit' | 'delete', row: InvoiceDoc, order?: OrderDoc | null) {",
    '  return moduleActionDecision({',
    '    actionPermission: `invoices.${action}`,',
    "    viewAllPermission: 'invoices.view_all',",
    '    permissions: permissions.value,',
    '    record: row,',
    '    parent: order || orders.value.find(item => item.id === row.order_id) || null,',
    "    currentUserEmail: appUser.value?.email || '',",
    '  })',
    '}',
  ),
  block(
    "function invoiceActionDecision(action: 'edit' | 'delete', _row: InvoiceDoc, _order?: OrderDoc | null) {",
    '  return moduleActionDecision({',
    '    actionPermission: `invoices.${action}`,',
    "    viewAllPermission: 'invoices.view_all',",
    '    permissions: permissions.value,',
    '    record: null,',
    '    parent: null,',
    "    currentUserEmail: appUser.value?.email || '',",
    '  })',
    '}',
  ),
)

await replaceOnce(
  'pages/invoices.vue',
  block(
    '  if (!order) {',
    "    return hasPermission('orders.view_all') || hasPermission('*')",
    "      ? 'Không tải được đơn hàng cha của hóa đơn. Hãy làm mới trang.'",
    "      : 'Tài khoản cần quyền orders.view_all để sửa hoặc xóa hóa đơn của Sale khác.'",
    '  }',
  ),
  block(
    '  if (!order) {',
    "    return 'Không tải được đơn hàng cha của hóa đơn. Hãy làm mới trang.'",
    '  }',
  ),
)

await replaceOnce(
  'pages/invoices.vue',
  "      showToast('Một số hóa đơn không thể sửa vì tài khoản chưa đọc được đơn hàng cha. Kế toán xử lý toàn bộ hóa đơn cần quyền orders.view_all.', 'warning')",
  "      showToast('Một số hóa đơn không thể sửa vì chưa tải được đơn hàng cha. Hãy làm mới trang.', 'warning')",
)

await replaceOnce(
  'composables/useScopedQueries.ts',
  block(
    "    if (canAll('orders.view_all')) {",
    "      return (await fetchByFieldValues<OrderDoc>('orders', 'id', orderIds))",
    '        .filter(isActive) as OrderDoc[]',
    '    }',
    '',
    "    if (!hasPermission('orders.view')) return [] as OrderDoc[]",
  ),
  block(
    "    if (canAll('orders.view_all')) {",
    "      return (await fetchByFieldValues<OrderDoc>('orders', 'id', orderIds))",
    '        .filter(isActive) as OrderDoc[]',
    '    }',
    '',
    "    if (canAll('invoices.view_all')) {",
    '      const snapshots = await Promise.all(orderIds.map(orderId => (',
    "        getDocFromServer(doc(db, 'orders', orderId))",
    '      )))',
    '      return snapshots',
    '        .filter(snapshot => snapshot.exists())',
    '        .map(snapshot => ({ ...snapshot.data(), id: snapshot.id, firestore_id: snapshot.id } as OrderDoc))',
    '        .filter(isActive) as OrderDoc[]',
    '    }',
    '',
    "    if (!hasPermission('orders.view')) return [] as OrderDoc[]",
  ),
)

await replaceOnce(
  'firestore.rules',
  block(
    '      allow read: if hasPerm(\'orders.view_all\')',
    "        || hasPerm('printing.view_all')",
    '        || (',
    "          hasPerm('printing.orders_view')",
    '          && ownsOrderData(resource.data)',
    '        )',
    '        || (',
    "          hasPerm('customers.orders_view')",
    "          && resource.data.get('customer_id', '') is string",
    "          && ownsCustomerById(resource.data.get('customer_id', ''))",
    '        )',
    '        || (',
    "          hasPerm('orders.view')",
    '          && ownsOrderData(resource.data)',
    '        );',
  ),
  block(
    "      allow get: if hasPerm('invoices.view_all')",
    "        || hasPerm('orders.view_all')",
    "        || hasPerm('printing.view_all')",
    '        || (',
    "          hasPerm('printing.orders_view')",
    '          && ownsOrderData(resource.data)',
    '        )',
    '        || (',
    "          hasPerm('customers.orders_view')",
    "          && resource.data.get('customer_id', '') is string",
    "          && ownsCustomerById(resource.data.get('customer_id', ''))",
    '        )',
    '        || (',
    "          hasPerm('orders.view')",
    '          && ownsOrderData(resource.data)',
    '        );',
    '',
    "      allow list: if hasPerm('orders.view_all')",
    "        || hasPerm('printing.view_all')",
    '        || (',
    "          hasPerm('printing.orders_view')",
    '          && ownsOrderData(resource.data)',
    '        )',
    '        || (',
    "          hasPerm('customers.orders_view')",
    "          && resource.data.get('customer_id', '') is string",
    "          && ownsCustomerById(resource.data.get('customer_id', ''))",
    '        )',
    '        || (',
    "          hasPerm('orders.view')",
    '          && ownsOrderData(resource.data)',
    '        );',
  ),
)

await replaceOnce(
  'firestore.rules',
  "      return (ownsOrderData(resource.data) || hasPerm('invoices.view_all'))",
  "      return hasPerm('invoices.view_all')",
)

await replaceOnce(
  'firestore.rules',
  block(
    '    function legacyInvoiceCreateFromExistingOrderAllowed(invoiceId) {',
    "      let orderId = request.resource.data.get('order_id', '');",
    '      let path = orderPath(orderId);',
    '      let before = get(path).data;',
    '      let after = getAfter(path).data;',
    "      return hasPerm('orders.edit')",
    '        && orderId is string',
    "        && orderId != ''",
    '        && exists(path)',
    '        && existsAfter(path)',
    '        && orderDataIsActive(before)',
    '        && orderDataIsActive(after)',
    "        && (ownsOrderData(before) || hasPerm('orders.view_all') || isAdmin())",
    "        && invoiceId == 'inv_' + orderId",
    "        && request.resource.data.get('id', '') == invoiceId",
    "        && request.resource.data.get('order_code', '') == before.get('order_code', '')",
    '        && requestMatchesOrderData(before)',
    "        && request.resource.data.get('created_by', '').lower() == email()",
    "        && request.resource.data.get('invoice_number', '') == ''",
    "        && request.resource.data.get('invoice_date', '') == ''",
    "        && request.resource.data.get('invoice_status', '') == after.get('invoice_status', '')",
    '        && (',
    "          before.get('invoice_status', '') == 'Đã xuất'",
    "            ? request.resource.data.get('invoice_status', '') == 'Đã xuất'",
    "            : saleInvoiceStatusValue(request.resource.data.get('invoice_status', ''))",
    '        )',
    '        && invoiceAmountValid(request.resource.data)',
    "        && request.resource.data.get('invoice_amount', -1) == after.get('payable_amount', -2)",
    "        && request.resource.data.get('relation_revision', -1) == after.get('invoice_relation_revision', -2)",
    "        && request.resource.data.get('last_operation_id', '') == after.get('last_operation_id', '')",
    "        && request.resource.data.get('status', '') == 'active'",
    "        && request.resource.data.get('active', false) == true",
    "        && request.resource.data.get('deleted', true) == false",
    "        && request.resource.data.get('created_at', null) == request.time",
    "        && request.resource.data.get('updated_at', null) == request.time",
    "        && after.get('invoice_record_count', -1) == 1",
    "        && after.get('relation_lock_version', 0) == 1",
    "        && relationMetadataMatches(after, 'invoices', 'create', invoiceId)",
    "        && after.get('relation_updated_at', null) == request.time;",
    '    }',
  ),
  block(
    '    function legacyInvoicePayloadMatchesExistingOrder(invoiceId) {',
    "      let orderId = request.resource.data.get('order_id', '');",
    '      let path = orderPath(orderId);',
    '      let before = get(path).data;',
    '      let after = getAfter(path).data;',
    "      return hasPerm('orders.edit')",
    '        && orderId is string',
    "        && orderId != ''",
    '        && exists(path)',
    '        && existsAfter(path)',
    '        && orderDataIsActive(before)',
    '        && orderDataIsActive(after)',
    "        && (ownsOrderData(before) || hasPerm('orders.view_all') || isAdmin())",
    "        && invoiceId == 'inv_' + orderId",
    "        && request.resource.data.get('id', '') == invoiceId",
    "        && request.resource.data.get('order_code', '') == before.get('order_code', '')",
    '        && requestMatchesOrderData(before)',
    "        && request.resource.data.get('created_by', '').lower() == email()",
    "        && request.resource.data.get('invoice_number', '') == ''",
    "        && request.resource.data.get('invoice_date', '') == ''",
    "        && request.resource.data.get('invoice_status', '') == after.get('invoice_status', '')",
    '        && (',
    "          before.get('invoice_status', '') == 'Đã xuất'",
    "            ? request.resource.data.get('invoice_status', '') == 'Đã xuất'",
    "            : saleInvoiceStatusValue(request.resource.data.get('invoice_status', ''))",
    '        )',
    '        && invoiceAmountValid(request.resource.data)',
    "        && request.resource.data.get('invoice_amount', -1) == after.get('payable_amount', -2)",
    "        && request.resource.data.get('relation_revision', -1) == after.get('invoice_relation_revision', -2)",
    "        && request.resource.data.get('last_operation_id', '') == after.get('last_operation_id', '')",
    "        && request.resource.data.get('status', '') == 'active'",
    "        && request.resource.data.get('active', false) == true",
    "        && request.resource.data.get('deleted', true) == false",
    "        && request.resource.data.get('updated_at', null) == request.time",
    "        && after.get('invoice_record_count', -1) == 1",
    "        && after.get('relation_lock_version', 0) == 1",
    "        && relationMetadataMatches(after, 'invoices', 'create', invoiceId)",
    "        && after.get('relation_updated_at', null) == request.time;",
    '    }',
    '',
    '    function legacyInvoiceCreateFromExistingOrderAllowed(invoiceId) {',
    '      return legacyInvoicePayloadMatchesExistingOrder(invoiceId)',
    "        && request.resource.data.get('created_at', null) == request.time;",
    '    }',
    '',
    '    function legacyInvoiceRestoreFromExistingOrderAllowed(invoiceId) {',
    '      return !activeRelationData(resource.data)',
    "        && resource.data.get('order_id', '') == request.resource.data.get('order_id', '')",
    '        && legacyInvoicePayloadMatchesExistingOrder(invoiceId)',
    '        && (',
    "          unchanged(['created_at'])",
    '          || (',
    "            resource.data.get('created_at', null) == null",
    "            && request.resource.data.get('created_at', null) == request.time",
    '          )',
    '        );',
    '    }',
  ),
)

await replaceOnce(
  'firestore.rules',
  block(
    "        && resource.data.get('invoice_record_count', 0) == 0",
    "        && request.resource.data.get('invoice_record_count', -1) == 1",
  ),
  block(
    "        && resource.data.get('invoice_record_count', 0) is int",
    "        && resource.data.get('invoice_record_count', 0) >= 0",
    "        && request.resource.data.get('invoice_record_count', -1) == 1",
  ),
)

await replaceOnce(
  'firestore.rules',
  block(
    '        && !exists(childPath)',
    '        && existsAfter(childPath)',
    '        && activeRelationData(getAfter(childPath).data)',
  ),
  block(
    '        && (',
    '          (',
    '            !exists(childPath)',
    '            && existsAfter(childPath)',
    '          )',
    '          || (',
    '            exists(childPath)',
    '            && !activeRelationData(get(childPath).data)',
    "            && get(childPath).data.get('order_id', '') == orderId",
    '            && existsAfter(childPath)',
    '          )',
    '        )',
    '        && activeRelationData(getAfter(childPath).data)',
  ),
)

await replaceOnce(
  'firestore.rules',
  block(
    '        || (',
    "          hasPerm('invoices.create')",
    "          && relationCreateBase(request.resource.data.order_id, 'invoices.view_all')",
  ),
  block(
    '        || (',
    "          hasPerm('invoices.view_all')",
    "          && hasPerm('invoices.create')",
    "          && relationCreateBase(request.resource.data.order_id, 'invoices.view_all')",
  ),
)

await replaceOnce(
  'firestore.rules',
  block(
    '            ? (',
    '              (',
    "                relationExistingChildBase(resource.data.order_id, 'invoices.view_all')",
    "                && hasPerm('invoices.delete')",
  ),
  block(
    '            ? (',
    '              legacyInvoiceRestoreFromExistingOrderAllowed(docId)',
    '              || (',
    "                hasPerm('invoices.view_all')",
    "                && relationExistingChildBase(resource.data.order_id, 'invoices.view_all')",
    "                && hasPerm('invoices.delete')",
  ),
)

await replaceOnce(
  'firestore.rules',
  block(
    '              (',
    "                relationExistingChildBase(resource.data.order_id, 'invoices.view_all')",
    "                && hasPerm('invoices.edit')",
  ),
  block(
    '              (',
    "                hasPerm('invoices.view_all')",
    "                && relationExistingChildBase(resource.data.order_id, 'invoices.view_all')",
    "                && hasPerm('invoices.edit')",
  ),
)

const packagePath = 'package.json'
const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
for (const testFile of [
  'tests/invoice-order-repair-permissions.client.test.mjs',
  'tests/invoice-order-repair-permissions.rules.test.mjs',
]) {
  if (!pkg.scripts['test:rules'].includes(testFile)) {
    pkg.scripts['test:rules'] = pkg.scripts['test:rules'].replace(
      'tests/order-invoice-legacy-backfill.rules.test.mjs',
      `tests/order-invoice-legacy-backfill.rules.test.mjs ${testFile}`,
    )
  }
}
await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)

console.log('Guarded invoice flow patch applied.')
