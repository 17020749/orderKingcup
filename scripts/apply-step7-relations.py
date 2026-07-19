from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    if old not in source:
        raise SystemExit(f'Missing patch target in {path}: {old[:120]!r}')
    file.write_text(source.replace(old, new, 1), encoding='utf-8')


# ---------------------------------------------------------------------------
# Type declarations
# ---------------------------------------------------------------------------
replace_once(
    'types/models.ts',
    """  printing_lock_updated_at?: any
  status?: string
""",
    """  printing_lock_updated_at?: any
  relation_lock_version?: number
  payment_record_count?: number
  invoice_record_count?: number
  shipment_record_count?: number
  payment_relation_revision?: number
  invoice_relation_revision?: number
  shipment_relation_revision?: number
  relation_last_module?: string
  relation_last_action?: string
  relation_last_document_id?: string
  relation_updated_by?: string
  relation_updated_at?: any
  shipment_status?: string
  shipping_fee_total?: number
  cod_amount_total?: number
  status?: string
""",
)
replace_once(
    'types/models.ts',
    """  order_sale_email?: string
  status?: string
}

export interface ExportRequestDoc""",
    """  order_sale_email?: string
  relation_revision?: number
  last_operation_id?: string
  status?: string
  active?: boolean
  deleted?: boolean
}

export interface ExportRequestDoc""",
)
replace_once(
    'types/models.ts',
    """  order_sale_email?: string
  status?: string
}

export interface PrintOrderDoc""",
    """  order_sale_email?: string
  relation_revision?: number
  last_operation_id?: string
  status?: string
  active?: boolean
  deleted?: boolean
}

export interface PrintOrderDoc""",
)
replace_once(
    'types/models.ts',
    """  order_owner_email?: string
  order_created_by?: string
}
""",
    """  order_owner_email?: string
  order_created_by?: string
  order_sale_email?: string
  relation_revision?: number
  last_operation_id?: string
  status?: string
  active?: boolean
  deleted?: boolean
}
""",
)

# ---------------------------------------------------------------------------
# Orders page: initialize, reconcile and enforce relation locks.
# ---------------------------------------------------------------------------
replace_once(
    'pages/orders.vue',
    "import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'",
    "import { collection, doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore'",
)
replace_once(
    'pages/orders.vue',
    "import { printingDeleteBlocker } from '~/utils/orderPrintingDeleteLock.mjs'",
    "import { printingDeleteBlocker } from '~/utils/orderPrintingDeleteLock.mjs'\n// @ts-ignore Shared ESM helper is executed directly by Node client tests.\nimport { orderRelationDeleteBlocker } from '~/utils/orderRelationState.mjs'",
)
replace_once(
    'pages/orders.vue',
    "const { appUser, hasPermission } = useAuth()",
    "const { appUser, hasPermission, isAdmin } = useAuth()",
)
replace_once(
    'pages/orders.vue',
    "const { saveOrderAtomic } = useAtomicOrderSave()",
    "const { saveOrderAtomic } = useAtomicOrderSave()\nconst { reconcileOrderRelationLocks } = useAtomicOrderRelations()",
)
replace_once(
    'pages/orders.vue',
    """  return printingDeleteBlocker(row, printingProgress.value)
}
""",
    """  const printingBlocker = printingDeleteBlocker(row, printingProgress.value)
  if (printingBlocker) return printingBlocker
  return orderRelationDeleteBlocker(row)
}
""",
)
replace_once(
    'pages/orders.vue',
    """        printing_lock_updated_at: serverTimestamp(),
        created_at: serverTimestamp(),
""",
    """        printing_lock_updated_at: serverTimestamp(),
        relation_lock_version: 1,
        payment_record_count: 0,
        invoice_record_count: 0,
        shipment_record_count: 0,
        payment_relation_revision: 0,
        invoice_relation_revision: 0,
        shipment_relation_revision: 0,
        relation_last_module: 'all',
        relation_last_action: 'reconcile',
        relation_last_document_id: '',
        relation_updated_by: createdBy,
        relation_updated_at: serverTimestamp(),
        shipment_status: '',
        shipping_fee_total: 0,
        cod_amount_total: 0,
        created_at: serverTimestamp(),
""",
)
replace_once(
    'pages/orders.vue',
    """    const latestPrintingBlocker = printingDeleteBlocker(row, latestPrintingProgress)
    if (latestPrintingBlocker) throw new Error(latestPrintingBlocker)

    if (orderItems.length + orderRequests.length + 2 > 500) {
""",
    """    const latestPrintingBlocker = printingDeleteBlocker(row, latestPrintingProgress)
    if (latestPrintingBlocker) throw new Error(latestPrintingBlocker)
    const latestOrderSnap = await getDoc(doc(db, 'orders', row.id))
    if (!latestOrderSnap.exists()) throw new Error('Không tìm thấy đơn hàng cần xóa.')
    const latestRelationBlocker = orderRelationDeleteBlocker({ ...latestOrderSnap.data(), id: latestOrderSnap.id })
    if (latestRelationBlocker) throw new Error(latestRelationBlocker)

    if (orderItems.length + orderRequests.length + 2 > 500) {
""",
)
replace_once(
    'pages/orders.vue',
    """async function softDeleteOrder(row: OrderDoc) {
""",
    """async function reconcileRelationLocks() {
  if (!isAdmin.value) return showToast('Chỉ quản trị viên được đồng bộ khóa liên kết đơn.', 'error')
  const confirmed = await askConfirm({
    title: 'Đồng bộ khóa liên kết đơn',
    message: 'Hệ thống sẽ đếm lại thanh toán, hóa đơn và vận chuyển đang hoạt động của tất cả đơn hàng. Dữ liệu mồ côi sẽ được báo riêng và không tự động xóa.',
    confirmLabel: 'Đồng bộ'
  })
  if (!confirmed) return
  await withLoading(async () => {
    const result = await reconcileOrderRelationLocks()
    await loadRows(true)
    const orphanNote = result.orphanCount
      ? ` Phát hiện ${result.orphanCount} chứng từ mồ côi cần quản trị viên xử lý riêng.`
      : ''
    showToast(`Đã đồng bộ ${result.updatedOrders} đơn hàng.${orphanNote}`, result.orphanCount ? 'info' : 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không đồng bộ được khóa liên kết đơn.'), 'error'))
}

async function softDeleteOrder(row: OrderDoc) {
""",
)
replace_once(
    'pages/orders.vue',
    """    <PageHeader title="Đơn hàng" subtitle="Đơn hàng và chi tiết sản phẩm">
      <button v-if="hasPermission('orders.create')" class="btn primary" @click="openModal()">+ Tạo đơn hàng</button>
    </PageHeader>
""",
    """    <PageHeader title="Đơn hàng" subtitle="Đơn hàng và chi tiết sản phẩm">
      <button v-if="isAdmin" class="btn" @click="reconcileRelationLocks">Đồng bộ khóa liên kết đơn</button>
      <button v-if="hasPermission('orders.create')" class="btn primary" @click="openModal()">+ Tạo đơn hàng</button>
    </PageHeader>
""",
)

# ---------------------------------------------------------------------------
# Firestore Rules: bidirectional atomic parent-child relation integrity.
# ---------------------------------------------------------------------------
rules_helpers = r"""
    function relationLockReadyData(data) {
      return data.get('relation_lock_version', 0) == 1
        && data.get('payment_record_count', -1) is int
        && data.get('payment_record_count', -1) >= 0
        && data.get('invoice_record_count', -1) is int
        && data.get('invoice_record_count', -1) >= 0
        && data.get('shipment_record_count', -1) is int
        && data.get('shipment_record_count', -1) >= 0
        && data.get('payment_relation_revision', -1) is int
        && data.get('payment_relation_revision', -1) >= 0
        && data.get('invoice_relation_revision', -1) is int
        && data.get('invoice_relation_revision', -1) >= 0
        && data.get('shipment_relation_revision', -1) is int
        && data.get('shipment_relation_revision', -1) >= 0;
    }

    function relationMetadataMatches(data, module, action, documentId) {
      return data.get('relation_last_module', '') == module
        && data.get('relation_last_action', '') == action
        && data.get('relation_last_document_id', '') == documentId
        && ownEmailField(data, 'relation_updated_by');
    }

    function paymentPath(paymentId) {
      return /databases/$(database)/documents/payments/$(paymentId);
    }

    function invoicePath(invoiceId) {
      return /databases/$(database)/documents/invoices/$(invoiceId);
    }

    function shipmentPath(shipmentId) {
      return /databases/$(database)/documents/shipments/$(shipmentId);
    }

    function activeRelationData(data) {
      return data.get('deleted', false) != true
        && data.get('active', true) != false;
    }

    function paymentParentMutationMatches(orderId, paymentId, action) {
      let path = orderPath(orderId);
      let childPath = paymentPath(paymentId);
      let before = get(path).data;
      let after = getAfter(path).data;
      return exists(path)
        && existsAfter(path)
        && relationLockReadyData(before)
        && relationLockReadyData(after)
        && relationMetadataMatches(after, 'payments', action, paymentId)
        && after.get('payment_relation_revision', -1) == before.get('payment_relation_revision', -1) + 1
        && after.get('invoice_relation_revision', -1) == before.get('invoice_relation_revision', -1)
        && after.get('shipment_relation_revision', -1) == before.get('shipment_relation_revision', -1)
        && after.get('invoice_record_count', -1) == before.get('invoice_record_count', -1)
        && after.get('shipment_record_count', -1) == before.get('shipment_record_count', -1)
        && (
          (
            action == 'create'
            && after.get('payment_record_count', -1) == before.get('payment_record_count', -1) + 1
            && !exists(childPath)
            && existsAfter(childPath)
            && activeRelationData(getAfter(childPath).data)
          )
          || (
            action == 'update'
            && after.get('payment_record_count', -1) == before.get('payment_record_count', -1)
            && exists(childPath)
            && existsAfter(childPath)
            && activeRelationData(get(childPath).data)
            && activeRelationData(getAfter(childPath).data)
            && getAfter(childPath).data != get(childPath).data
          )
          || (
            action == 'delete'
            && before.get('payment_record_count', 0) > 0
            && after.get('payment_record_count', -1) == before.get('payment_record_count', -1) - 1
            && exists(childPath)
            && existsAfter(childPath)
            && activeRelationData(get(childPath).data)
            && getAfter(childPath).data.get('deleted', false) == true
            && getAfter(childPath).data.get('active', true) == false
          )
        );
    }

    function invoiceParentMutationMatches(orderId, invoiceId, action) {
      let path = orderPath(orderId);
      let childPath = invoicePath(invoiceId);
      let before = get(path).data;
      let after = getAfter(path).data;
      return exists(path)
        && existsAfter(path)
        && relationLockReadyData(before)
        && relationLockReadyData(after)
        && relationMetadataMatches(after, 'invoices', action, invoiceId)
        && after.get('invoice_relation_revision', -1) == before.get('invoice_relation_revision', -1) + 1
        && after.get('payment_relation_revision', -1) == before.get('payment_relation_revision', -1)
        && after.get('shipment_relation_revision', -1) == before.get('shipment_relation_revision', -1)
        && after.get('payment_record_count', -1) == before.get('payment_record_count', -1)
        && after.get('shipment_record_count', -1) == before.get('shipment_record_count', -1)
        && (
          (
            action == 'create'
            && after.get('invoice_record_count', -1) == before.get('invoice_record_count', -1) + 1
            && !exists(childPath)
            && existsAfter(childPath)
            && activeRelationData(getAfter(childPath).data)
          )
          || (
            action == 'update'
            && after.get('invoice_record_count', -1) == before.get('invoice_record_count', -1)
            && exists(childPath)
            && existsAfter(childPath)
            && activeRelationData(get(childPath).data)
            && activeRelationData(getAfter(childPath).data)
            && getAfter(childPath).data != get(childPath).data
          )
          || (
            action == 'delete'
            && before.get('invoice_record_count', 0) > 0
            && after.get('invoice_record_count', -1) == before.get('invoice_record_count', -1) - 1
            && exists(childPath)
            && existsAfter(childPath)
            && activeRelationData(get(childPath).data)
            && getAfter(childPath).data.get('deleted', false) == true
            && getAfter(childPath).data.get('active', true) == false
          )
        );
    }

    function shipmentParentMutationMatches(orderId, shipmentId, action) {
      let path = orderPath(orderId);
      let childPath = shipmentPath(shipmentId);
      let before = get(path).data;
      let after = getAfter(path).data;
      return exists(path)
        && existsAfter(path)
        && relationLockReadyData(before)
        && relationLockReadyData(after)
        && relationMetadataMatches(after, 'shipments', action, shipmentId)
        && after.get('shipment_relation_revision', -1) == before.get('shipment_relation_revision', -1) + 1
        && after.get('payment_relation_revision', -1) == before.get('payment_relation_revision', -1)
        && after.get('invoice_relation_revision', -1) == before.get('invoice_relation_revision', -1)
        && after.get('payment_record_count', -1) == before.get('payment_record_count', -1)
        && after.get('invoice_record_count', -1) == before.get('invoice_record_count', -1)
        && (
          (
            action == 'create'
            && after.get('shipment_record_count', -1) == before.get('shipment_record_count', -1) + 1
            && !exists(childPath)
            && existsAfter(childPath)
            && activeRelationData(getAfter(childPath).data)
          )
          || (
            action == 'update'
            && after.get('shipment_record_count', -1) == before.get('shipment_record_count', -1)
            && exists(childPath)
            && existsAfter(childPath)
            && activeRelationData(get(childPath).data)
            && activeRelationData(getAfter(childPath).data)
            && getAfter(childPath).data != get(childPath).data
          )
          || (
            action == 'delete'
            && before.get('shipment_record_count', 0) > 0
            && after.get('shipment_record_count', -1) == before.get('shipment_record_count', -1) - 1
            && exists(childPath)
            && existsAfter(childPath)
            && activeRelationData(get(childPath).data)
            && getAfter(childPath).data.get('deleted', false) == true
            && getAfter(childPath).data.get('active', true) == false
          )
        );
    }

    function orderPaymentSummaryUpdateAllowed(orderId) {
      let action = request.resource.data.get('relation_last_action', '');
      let documentId = request.resource.data.get('relation_last_document_id', '');
      return hasAnyPerm(['payments.create', 'payments.edit', 'payments.delete'])
        && ownsOrderData(resource.data)
        && orderIdentityUnchanged()
        && onlyChanged([
          'paid_amount', 'debt_amount', 'computed_payment_status', 'payment_status',
          'payment_count', 'deposit_count', 'collect_count', 'payment_record_count',
          'payment_relation_revision', 'relation_lock_version', 'relation_last_module',
          'relation_last_action', 'relation_last_document_id', 'relation_updated_by',
          'relation_updated_at', 'updated_at'
        ])
        && paymentParentMutationMatches(orderId, documentId, action);
    }

    function orderInvoiceSummaryUpdateAllowed(orderId) {
      let action = request.resource.data.get('relation_last_action', '');
      let documentId = request.resource.data.get('relation_last_document_id', '');
      return hasAnyPerm(['invoices.create', 'invoices.edit', 'invoices.delete'])
        && ownsOrderData(resource.data)
        && orderIdentityUnchanged()
        && onlyChanged([
          'invoice_status', 'invoice_record_count', 'invoice_relation_revision',
          'relation_lock_version', 'relation_last_module', 'relation_last_action',
          'relation_last_document_id', 'relation_updated_by', 'relation_updated_at', 'updated_at'
        ])
        && invoiceParentMutationMatches(orderId, documentId, action);
    }

    function orderShipmentSummaryUpdateAllowed(orderId) {
      let action = request.resource.data.get('relation_last_action', '');
      let documentId = request.resource.data.get('relation_last_document_id', '');
      return hasAnyPerm(['shipments.create', 'shipments.edit', 'shipments.delete'])
        && ownsOrderData(resource.data)
        && orderIdentityUnchanged()
        && onlyChanged([
          'shipment_status', 'shipping_fee_total', 'cod_amount_total',
          'shipment_record_count', 'shipment_relation_revision', 'relation_lock_version',
          'relation_last_module', 'relation_last_action', 'relation_last_document_id',
          'relation_updated_by', 'relation_updated_at', 'updated_at'
        ])
        && shipmentParentMutationMatches(orderId, documentId, action);
    }
"""
replace_once(
    'firestore.rules',
    """    function onlyPaymentSummaryChanged() {
      return onlyChanged([
        'paid_amount',
        'debt_amount',
        'computed_payment_status',
        'payment_status',
        'payment_count',
        'deposit_count',
        'collect_count',
        'updated_at'
      ]);
    }
""",
    rules_helpers,
)
replace_once(
    'firestore.rules',
    """      return fulfillmentStatus() != 'da_xuat_1_phan'
        && fulfillmentStatus() != 'da_xuat_du'
        && printingLockReadyData(resource.data)
        && resource.data.get('printing_progress_count', -1) == 0;
""",
    """      return fulfillmentStatus() != 'da_xuat_1_phan'
        && fulfillmentStatus() != 'da_xuat_du'
        && printingLockReadyData(resource.data)
        && resource.data.get('printing_progress_count', -1) == 0
        && relationLockReadyData(resource.data)
        && resource.data.get('payment_record_count', -1) == 0
        && resource.data.get('invoice_record_count', -1) == 0
        && resource.data.get('shipment_record_count', -1) == 0;
""",
)
replace_once(
    'firestore.rules',
    """          'printing_lock_updated_at',
          'deleted',
""",
    """          'printing_lock_updated_at',
          'relation_lock_version',
          'payment_record_count',
          'invoice_record_count',
          'shipment_record_count',
          'payment_relation_revision',
          'invoice_relation_revision',
          'shipment_relation_revision',
          'relation_last_module',
          'relation_last_action',
          'relation_last_document_id',
          'relation_updated_by',
          'relation_updated_at',
          'invoice_status',
          'shipment_status',
          'shipping_fee_total',
          'cod_amount_total',
          'deleted',
""",
)
replace_once(
    'firestore.rules',
    """        ])
        && (
          unchanged(['invoice_status'])
          || hasAnyPerm(['invoices.create', 'invoices.edit', 'invoices.delete'])
        );
""",
    """        ]);
""",
)
replace_once(
    'firestore.rules',
    """        || orderPrintingSummaryUpdateAllowed(docId)
        || orderWarehouseSummaryUpdateAllowed()
""",
    """        || orderPrintingSummaryUpdateAllowed(docId)
        || orderPaymentSummaryUpdateAllowed(docId)
        || orderInvoiceSummaryUpdateAllowed(docId)
        || orderShipmentSummaryUpdateAllowed(docId)
        || orderWarehouseSummaryUpdateAllowed()
""",
)
replace_once(
    'firestore.rules',
    """        || (
          // Payment module updates only computed payment fields.
          hasAnyPerm(['payments.create', 'payments.edit', 'payments.delete'])
          && ownsOrderData(resource.data)
          && orderIdentityUnchanged()
          && onlyPaymentSummaryChanged()
        )
        || (
          // Invoice module updates only invoice status.
          hasAnyPerm(['invoices.create', 'invoices.edit', 'invoices.delete'])
          && ownsOrderData(resource.data)
          && orderIdentityUnchanged()
          && onlyInvoiceStatusChanged()
        );
""",
    """        ;
""",
)
replace_once(
    'firestore.rules',
    """      allow create: if hasPerm('payments.create')
        && request.resource.data.order_id is string
        && canMutateOrderById(request.resource.data.order_id)
        && requestMatchesOrder(request.resource.data.order_id)
        && ownEmailField(request.resource.data, 'created_by');
""",
    """      allow create: if hasPerm('payments.create')
        && request.resource.data.order_id is string
        && canMutateOrderById(request.resource.data.order_id)
        && requestMatchesOrder(request.resource.data.order_id)
        && ownEmailField(request.resource.data, 'created_by')
        && paymentParentMutationMatches(request.resource.data.order_id, docId, 'create');
""",
)
replace_once(
    'firestore.rules',
    """              hasPerm('payments.edit')
              && unchanged(['deleted', 'active', 'status', 'deleted_at'])
""",
    """              hasPerm('payments.edit')
              && unchanged(['deleted', 'active', 'status', 'deleted_at'])
              && paymentParentMutationMatches(resource.data.order_id, docId, 'update')
""",
)
replace_once(
    'firestore.rules',
    """              hasPerm('payments.delete')
              && softDeleteOnly()
""",
    """              hasPerm('payments.delete')
              && softDeleteOnly()
              && paymentParentMutationMatches(resource.data.order_id, docId, 'delete')
""",
)
replace_once(
    'firestore.rules',
    """      allow delete: if isAdmin()
        || (
          hasPerm('payments.delete')
          && resource.data.order_id is string
          && (
            ownEmailField(resource.data, 'created_by')
            || ownsOrderById(resource.data.order_id)
          )
        );
""",
    """      allow delete: if isAdmin();
""",
)
replace_once(
    'firestore.rules',
    """      allow create: if hasPerm('shipments.create')
        && request.resource.data.order_id is string
        && canMutateOrderById(request.resource.data.order_id)
        && requestMatchesOrder(request.resource.data.order_id)
        && ownEmailField(request.resource.data, 'created_by');
""",
    """      allow create: if hasPerm('shipments.create')
        && request.resource.data.order_id is string
        && canMutateOrderById(request.resource.data.order_id)
        && requestMatchesOrder(request.resource.data.order_id)
        && ownEmailField(request.resource.data, 'created_by')
        && shipmentParentMutationMatches(request.resource.data.order_id, docId, 'create');
""",
)
replace_once(
    'firestore.rules',
    """          && childOwnershipSafe(resource.data.order_id)
          && unchanged(['deleted', 'active', 'status', 'deleted_at'])
        )
        || (
          hasPerm('shipments.delete')
""",
    """          && childOwnershipSafe(resource.data.order_id)
          && unchanged(['deleted', 'active', 'status', 'deleted_at'])
          && shipmentParentMutationMatches(resource.data.order_id, docId, 'update')
        )
        || (
          hasPerm('shipments.delete')
""",
)
replace_once(
    'firestore.rules',
    """          && childOwnershipSafe(resource.data.order_id)
          && softDeleteOnly()
        );

      allow delete: if isAdmin()
        || (
          hasPerm('shipments.delete')
          && resource.data.order_id is string
          && canMutateOrderById(resource.data.order_id)
        );
""",
    """          && childOwnershipSafe(resource.data.order_id)
          && softDeleteOnly()
          && shipmentParentMutationMatches(resource.data.order_id, docId, 'delete')
        );

      allow delete: if isAdmin();
""",
)
replace_once(
    'firestore.rules',
    """      allow create: if hasPerm('invoices.create')
        && request.resource.data.order_id is string
        && canMutateOrderById(request.resource.data.order_id)
        && requestMatchesOrder(request.resource.data.order_id)
        && ownEmailField(request.resource.data, 'created_by');
""",
    """      allow create: if hasPerm('invoices.create')
        && request.resource.data.order_id is string
        && canMutateOrderById(request.resource.data.order_id)
        && requestMatchesOrder(request.resource.data.order_id)
        && ownEmailField(request.resource.data, 'created_by')
        && invoiceParentMutationMatches(request.resource.data.order_id, docId, 'create');
""",
)
replace_once(
    'firestore.rules',
    """          && childOwnershipSafe(resource.data.order_id)
          && unchanged(['deleted', 'active', 'status', 'deleted_at'])
        )
        || (
          hasPerm('invoices.delete')
""",
    """          && childOwnershipSafe(resource.data.order_id)
          && unchanged(['deleted', 'active', 'status', 'deleted_at'])
          && invoiceParentMutationMatches(resource.data.order_id, docId, 'update')
        )
        || (
          hasPerm('invoices.delete')
""",
)
replace_once(
    'firestore.rules',
    """          && childOwnershipSafe(resource.data.order_id)
          && softDeleteOnly()
        );

      allow delete: if isAdmin()
        || (
          hasPerm('invoices.delete')
          && resource.data.order_id is string
          && canMutateOrderById(resource.data.order_id)
        );
""",
    """          && childOwnershipSafe(resource.data.order_id)
          && softDeleteOnly()
          && invoiceParentMutationMatches(resource.data.order_id, docId, 'delete')
        );

      allow delete: if isAdmin();
""",
)

print('Step 7 source patches applied')
