from pathlib import Path
import re

path = Path('firestore.rules')
source = path.read_text(encoding='utf-8')

helpers = r'''    function relationLockReadyData(data) {
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

    // Reads the parent only once for child validation. Ownership fields must
    // match the active parent, and the relation summary must advance atomically.
    function relationCreateBase(orderId) {
      let path = orderPath(orderId);
      let order = get(path).data;
      return orderId is string
        && exists(path)
        && orderDataIsActive(order)
        && (ownsOrderData(order) || isAdmin())
        && requestMatchesOrderData(order)
        && ownEmailField(request.resource.data, 'created_by');
    }

    function relationExistingChildBase(orderId) {
      let path = orderPath(orderId);
      let order = get(path).data;
      return orderId is string
        && exists(path)
        && orderDataIsActive(order)
        && (ownsOrderData(order) || isAdmin())
        && request.resource.data.order_id == resource.data.order_id
        && childIdentityUnchanged()
        && childOwnershipSafe(orderId);
    }

    function relationParentMarkerMatches(orderId, module, action, documentId, revisionField) {
      let path = orderPath(orderId);
      let before = get(path).data;
      let after = getAfter(path).data;
      return exists(path)
        && existsAfter(path)
        && orderDataIsActive(before)
        && orderDataIsActive(after)
        && before.get('relation_lock_version', 0) == 1
        && after.get('relation_lock_version', 0) == 1
        && relationMetadataMatches(after, module, action, documentId)
        && after.get(revisionField, -1) == before.get(revisionField, -1) + 1;
    }

    // Evaluated only by the matching module branch on the parent order.
    function relationParentTransitionMatches(orderId, childPath, module, action, documentId, countField, revisionField) {
      let currentCount = resource.data.get(countField, -1);
      let nextCount = request.resource.data.get(countField, -1);
      let currentRevision = resource.data.get(revisionField, -1);
      let nextRevision = request.resource.data.get(revisionField, -1);
      return resource.data.get('relation_lock_version', 0) == 1
        && request.resource.data.get('relation_lock_version', 0) == 1
        && relationMetadataMatches(request.resource.data, module, action, documentId)
        && nextRevision == currentRevision + 1
        && (
          (
            action == 'create'
            && nextCount == currentCount + 1
            && !exists(childPath)
            && existsAfter(childPath)
            && activeRelationData(getAfter(childPath).data)
            && getAfter(childPath).data.get('order_id', '') == orderId
          )
          || (
            action == 'update'
            && nextCount == currentCount
            && exists(childPath)
            && existsAfter(childPath)
            && activeRelationData(get(childPath).data)
            && activeRelationData(getAfter(childPath).data)
            && get(childPath).data.get('order_id', '') == orderId
            && getAfter(childPath).data.get('order_id', '') == orderId
            && getAfter(childPath).data != get(childPath).data
          )
          || (
            action == 'delete'
            && currentCount > 0
            && nextCount == currentCount - 1
            && exists(childPath)
            && existsAfter(childPath)
            && activeRelationData(get(childPath).data)
            && get(childPath).data.get('order_id', '') == orderId
            && getAfter(childPath).data.get('order_id', '') == orderId
            && getAfter(childPath).data.get('deleted', false) == true
            && getAfter(childPath).data.get('active', true) == false
          )
        );
    }

    function orderPaymentSummaryUpdateAllowed(orderId) {
      let action = request.resource.data.get('relation_last_action', '');
      let documentId = request.resource.data.get('relation_last_document_id', '');
      return ownsOrderData(resource.data)
        && orderIdentityUnchanged()
        && onlyChanged([
          'paid_amount', 'debt_amount', 'computed_payment_status', 'payment_status',
          'payment_count', 'deposit_count', 'collect_count', 'payment_record_count',
          'payment_relation_revision', 'relation_lock_version', 'relation_last_module',
          'relation_last_action', 'relation_last_document_id', 'relation_updated_by',
          'relation_updated_at', 'updated_at'
        ])
        && (
          (action == 'create' && hasPerm('payments.create'))
          || (action == 'update' && hasPerm('payments.edit'))
          || (action == 'delete' && hasPerm('payments.delete'))
        )
        && relationParentTransitionMatches(
          orderId, paymentPath(documentId), 'payments', action, documentId,
          'payment_record_count', 'payment_relation_revision'
        );
    }

    function orderInvoiceSummaryUpdateAllowed(orderId) {
      let action = request.resource.data.get('relation_last_action', '');
      let documentId = request.resource.data.get('relation_last_document_id', '');
      return ownsOrderData(resource.data)
        && orderIdentityUnchanged()
        && onlyChanged([
          'invoice_status', 'invoice_record_count', 'invoice_relation_revision',
          'relation_lock_version', 'relation_last_module', 'relation_last_action',
          'relation_last_document_id', 'relation_updated_by', 'relation_updated_at', 'updated_at'
        ])
        && (
          (action == 'create' && hasPerm('invoices.create'))
          || (action == 'update' && hasPerm('invoices.edit'))
          || (action == 'delete' && hasPerm('invoices.delete'))
        )
        && relationParentTransitionMatches(
          orderId, invoicePath(documentId), 'invoices', action, documentId,
          'invoice_record_count', 'invoice_relation_revision'
        );
    }

    function orderShipmentSummaryUpdateAllowed(orderId) {
      let action = request.resource.data.get('relation_last_action', '');
      let documentId = request.resource.data.get('relation_last_document_id', '');
      return ownsOrderData(resource.data)
        && orderIdentityUnchanged()
        && onlyChanged([
          'shipment_status', 'shipping_fee_total', 'cod_amount_total',
          'shipment_record_count', 'shipment_relation_revision', 'relation_lock_version',
          'relation_last_module', 'relation_last_action', 'relation_last_document_id',
          'relation_updated_by', 'relation_updated_at', 'updated_at'
        ])
        && (
          (action == 'create' && hasPerm('shipments.create'))
          || (action == 'update' && hasPerm('shipments.edit'))
          || (action == 'delete' && hasPerm('shipments.delete'))
        )
        && relationParentTransitionMatches(
          orderId, shipmentPath(documentId), 'shipments', action, documentId,
          'shipment_record_count', 'shipment_relation_revision'
        );
    }

    function onlyWarehouseSummaryChanged() {'''

pattern = re.compile(r"    function relationLockReadyData\(data\) \{.*?    function onlyWarehouseSummaryChanged\(\) \{", re.S)
source, count = pattern.subn(helpers, source, count=1)
if count != 1:
    raise SystemExit(f'Expected one helper block, got {count}')

payment = r'''    match /payments/{docId} {
      allow read: if hasPerm('payments.view_all')
        || (
          hasPerm('payments.view')
          && (
            ownsOrderChildData(resource.data)
            || (
              resource.data.order_id is string
              && ownsOrderById(resource.data.order_id)
            )
          )
        );

      allow create: if hasPerm('payments.create')
        && relationCreateBase(request.resource.data.order_id)
        && relationParentMarkerMatches(
          request.resource.data.order_id, 'payments', 'create', docId,
          'payment_relation_revision'
        );

      allow update: if isAdmin()
        || (
          relationExistingChildBase(resource.data.order_id)
          && (
            (
              hasPerm('payments.edit')
              && unchanged(['deleted', 'active', 'status', 'deleted_at'])
              && relationParentMarkerMatches(
                resource.data.order_id, 'payments', 'update', docId,
                'payment_relation_revision'
              )
            )
            || (
              hasPerm('payments.delete')
              && softDeleteOnly()
              && relationParentMarkerMatches(
                resource.data.order_id, 'payments', 'delete', docId,
                'payment_relation_revision'
              )
            )
          )
        );

      allow delete: if isAdmin();
    }

    // ---------------------------------------------------------------------
    // Warehouse export requests'''
pattern = re.compile(r"    match /payments/\{docId\} \{.*?    // ---------------------------------------------------------------------\n    // Warehouse export requests", re.S)
source, count = pattern.subn(payment, source, count=1)
if count != 1:
    raise SystemExit(f'Expected one payment block, got {count}')

shipment = r'''    match /shipments/{docId} {
      allow read: if isAdmin()
        || (
          hasPerm('shipments.view')
          && (
            ownsOrderChildData(resource.data)
            || (
              resource.data.order_id is string
              && ownsOrderById(resource.data.order_id)
            )
          )
        );

      allow create: if hasPerm('shipments.create')
        && relationCreateBase(request.resource.data.order_id)
        && relationParentMarkerMatches(
          request.resource.data.order_id, 'shipments', 'create', docId,
          'shipment_relation_revision'
        );

      allow update: if isAdmin()
        || (
          relationExistingChildBase(resource.data.order_id)
          && (
            (
              hasPerm('shipments.edit')
              && unchanged(['deleted', 'active', 'status', 'deleted_at'])
              && relationParentMarkerMatches(
                resource.data.order_id, 'shipments', 'update', docId,
                'shipment_relation_revision'
              )
            )
            || (
              hasPerm('shipments.delete')
              && softDeleteOnly()
              && relationParentMarkerMatches(
                resource.data.order_id, 'shipments', 'delete', docId,
                'shipment_relation_revision'
              )
            )
          )
        );

      allow delete: if isAdmin();
    }

    match /invoices/{docId} {'''
pattern = re.compile(r"    match /shipments/\{docId\} \{.*?    match /invoices/\{docId\} \{", re.S)
source, count = pattern.subn(shipment, source, count=1)
if count != 1:
    raise SystemExit(f'Expected one shipment block, got {count}')

invoice = r'''    match /invoices/{docId} {
      allow read: if isAdmin()
        || (
          hasPerm('invoices.view')
          && (
            ownsOrderChildData(resource.data)
            || (
              resource.data.order_id is string
              && ownsOrderById(resource.data.order_id)
            )
          )
        );

      allow create: if hasPerm('invoices.create')
        && relationCreateBase(request.resource.data.order_id)
        && relationParentMarkerMatches(
          request.resource.data.order_id, 'invoices', 'create', docId,
          'invoice_relation_revision'
        );

      allow update: if isAdmin()
        || (
          relationExistingChildBase(resource.data.order_id)
          && (
            (
              hasPerm('invoices.edit')
              && unchanged(['deleted', 'active', 'status', 'deleted_at'])
              && relationParentMarkerMatches(
                resource.data.order_id, 'invoices', 'update', docId,
                'invoice_relation_revision'
              )
            )
            || (
              hasPerm('invoices.delete')
              && softDeleteOnly()
              && relationParentMarkerMatches(
                resource.data.order_id, 'invoices', 'delete', docId,
                'invoice_relation_revision'
              )
            )
          )
        );

      allow delete: if isAdmin();
    }

    // ---------------------------------------------------------------------
    // Warehouse Core: catalogs, real stock documents and balances'''
pattern = re.compile(r"    match /invoices/\{docId\} \{.*?    // ---------------------------------------------------------------------\n    // Warehouse Core: catalogs, real stock documents and balances", re.S)
source, count = pattern.subn(invoice, source, count=1)
if count != 1:
    raise SystemExit(f'Expected one invoice block, got {count}')

path.write_text(source, encoding='utf-8')
print('Step 7 relation rules compacted')
