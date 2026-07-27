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
    '  assertSaleInvoiceStatus,',
    '  buildOrderInvoiceId,',
    '  invoiceStatusChangeRequested,',
    '  normalizeInvoiceStatus,',
    '  SALE_INVOICE_STATUSES,',
  ),
  block(
    '  assertSaleInvoiceStatus,',
    '  buildOrderInvoiceId,',
    '  normalizeInvoiceStatus,',
    '  planOrderEditInvoiceMutation,',
    '  SALE_INVOICE_STATUSES,',
  ),
)

await replaceOnce(
  'pages/orders.vue',
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
  block(
    '    } else {',
    '      const activeInvoices = (await loadScopedInvoicesForOrders([editing.value], true))',
    '        .filter(isActiveOrderRelation) as InvoiceDoc[]',
    '      const currentInvoice = selectCanonicalInvoice(activeInvoices) as InvoiceDoc | null',
    '      invoiceMutation = planOrderEditInvoiceMutation({',
    '        orderId: form.id,',
    '        persistedStatus: persistedInvoiceStatus,',
    '        requestedStatus: requestedInvoiceStatus,',
    '        currentInvoice,',
    '        activeInvoiceCount: activeInvoices.length,',
    '        payload: {',
    "          tax_code: selectedCustomer?.tax_code || '',",
    "          company_name: selectedCustomer?.company_name || '',",
    "          billing_address: selectedCustomer?.billing_address || '',",
    "          note: '',",
    '        },',
    '      })',
    '    }',
  ),
)

await replaceOnce(
  'composables/useAtomicOrderSave.ts',
  block(
    '  nextOrderRevision,',
    '  planAtomicOrderItems,',
    '  resolveOrderOwnershipForSave,',
  ),
  block(
    '  nextOrderRevision,',
    '  planAtomicOrderItems,',
    '  preservePersistedOrderIdentityForEdit,',
    '  resolveOrderOwnershipForSave,',
  ),
)

await replaceOnce(
  'composables/useAtomicOrderSave.ts',
  block(
    '      const finalOrderPayload = {',
    '        ...input.orderPayload,',
    '        ...invoiceRelationPatch,',
    '        order_code: orderCode,',
    '        order_sequence: orderSequence,',
    '        user_code: input.userCode,',
    '        customer_code: input.customerCode,',
    '        owner_email: effectiveOwnership.ownerEmail,',
    '        created_by: effectiveOwnership.createdBy,',
    '        sale_email: effectiveOwnership.saleEmail,',
    '        revision,',
    '        last_operation_id: operationId,',
    '        updated_at: serverTimestamp(),',
    '      }',
  ),
  block(
    '      const candidateFinalOrderPayload = {',
    '        ...input.orderPayload,',
    '        ...invoiceRelationPatch,',
    '        order_code: orderCode,',
    '        order_sequence: orderSequence,',
    '        user_code: input.userCode,',
    '        customer_code: input.customerCode,',
    '        owner_email: effectiveOwnership.ownerEmail,',
    '        created_by: effectiveOwnership.createdBy,',
    '        sale_email: effectiveOwnership.saleEmail,',
    '        revision,',
    '        last_operation_id: operationId,',
    '        updated_at: serverTimestamp(),',
    '      }',
    "      const finalOrderPayload = input.mode === 'edit'",
    '        ? preservePersistedOrderIdentityForEdit(candidateFinalOrderPayload, existingOrder)',
    '        : candidateFinalOrderPayload',
  ),
)

const packagePath = 'package.json'
const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
const newRulesTest = 'tests/order-legacy-missing-identity.rules.test.mjs'
if (!pkg.scripts['test:rules'].includes(newRulesTest)) {
  pkg.scripts['test:rules'] = pkg.scripts['test:rules'].replace(
    'tests/invoice-order-repair-permissions.client.test.mjs',
    `tests/invoice-order-repair-permissions.client.test.mjs ${newRulesTest}`,
  )
}
await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)

console.log('Legacy Sale invoice runtime patch applied.')
