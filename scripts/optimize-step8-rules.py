from pathlib import Path
import re

path = Path('firestore.rules')
source = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global source
    if old not in source:
        raise SystemExit(f'Missing rules target: {old[:160]!r}')
    source = source.replace(old, new, 1)


def regex_once(pattern: str, replacement: str) -> None:
    global source
    source, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'Expected one rules regex target, got {count}: {pattern[:120]}')


# Evaluate the cheap warehouse-only shape before printing/relation helpers.
replace_once(
    """        // Dispatch relation summaries by the cheap module marker first. This
""",
    """        || orderWarehouseSummaryUpdateAllowed()
        // Dispatch relation summaries by the cheap module marker first. This
""",
)
replace_once(
    """        || orderPrintingSummaryUpdateAllowed(docId)
        || orderWarehouseSummaryUpdateAllowed()
        || isAdmin()
""",
    """        || orderPrintingSummaryUpdateAllowed(docId)
        || isAdmin()
""",
)

lifecycle_functions = r'''    function exportRequestLifecycleFieldsOnly() {
      return onlyChanged([
        'status', 'lifecycle_status', 'release_sequence', 'active_export_order_id',
        'warehouse_export_code', 'warehouse_handled_by', 'warehouse_handled_at',
        'warehouse_note', 'warehouse_export_id', 'warehouse_export_order_id',
        'export_order_id', 'exported_at', 'actual_exported_at',
        'actual_export_summary_json', 'stock_movement_ids', 'request_timeline_json',
        'operation_id', 'last_operation_id', 'revision', 'last_released_export_order_id',
        'last_released_export_code', 'last_released_by', 'last_cancelled_export_order_id',
        'last_cancelled_export_code', 'last_cancelled_by', 'last_cancel_reason',
        'last_cancelled_at', 'cancel_count', 'updated_at'
      ]);
    }

    function exportRequestReleaseAllowed(requestId) {
      return request.resource.data.get('lifecycle_status', '') == 'released'
        && request.resource.data.get('status', '') == 'da_xuat'
        && resource.data.get('status', '') in ['da_tiep_nhan', 'cho_xuat_kho', 'loi']
        && exportRequestLifecycleFieldsOnly()
        && hasAnyPerm(['export_requests.release', 'export_requests.process'])
        && ownEmailField(request.resource.data, 'warehouse_handled_by')
        && exportRequestReleaseLinkValid(requestId);
    }

    function exportRequestCancelAllowed(requestId) {
      return request.resource.data.get('lifecycle_status', '') == 'release_cancelled'
        && request.resource.data.get('status', '') in ['da_tiep_nhan', 'cho_xuat_kho']
        && resource.data.get('status', '') == 'da_xuat'
        && exportRequestLifecycleFieldsOnly()
        && hasAnyPerm(['export_requests.release', 'export_requests.process'])
        && ownEmailField(request.resource.data, 'warehouse_handled_by')
        && exportRequestCancelLinkValid(requestId);
    }

    function exportWarehouseProcessAllowed() {
      let path = userPath();
      let user = get(path).data;
      let permissions = user.get('permissions_flat', []);
      let admin = adminUserData(user);
      let legacyProcess = admin
        || (
          permissions is list
          && 'export_requests.process' in permissions
        );
      let beforeStatus = resource.data.get('status', '');
      let afterStatus = request.resource.data.get('status', '');
      return signedIn()
        && exists(path)
        && activeUserData(user)
        && onlyChanged([
          'status', 'warehouse_handled_by', 'warehouse_handled_at',
          'warehouse_note', 'request_timeline_json', 'updated_at'
        ])
        && ownEmailField(request.resource.data, 'warehouse_handled_by')
        && (
          (
            afterStatus in ['da_tiep_nhan', 'cho_xuat_kho']
            && beforeStatus in ['cho_xu_ly', 'pending']
            && (
              legacyProcess
              || (permissions is list && 'export_requests.accept' in permissions)
            )
          )
          || (
            afterStatus == 'tu_choi'
            && !(beforeStatus in ['tu_choi', 'da_xuat'])
            && (
              legacyProcess
              || (permissions is list && 'export_requests.reject' in permissions)
            )
          )
        );
    }
'''
regex_once(
    r"    function exportWarehouseProcessAllowed\(\) \{.*?\n    \}\n\n    // ---------------------------------------------------------------------\n    // Users, roles and settings",
    lifecycle_functions + "\n    // ---------------------------------------------------------------------\n    // Users, roles and settings",
)

replace_once(
    """      // Evaluate cheap operation-shape checks first. This avoids exhausting
      // Firestore's 1000-expression limit on the page's three-write batch.
      allow update: if exportSoftDeleteAllowed()
        || exportOwnerEditAllowed()
        || exportWarehouseProcessAllowed()
        || isAdmin();
""",
    """      // Dispatch release/cancel by the lifecycle marker before evaluating
      // legacy owner/warehouse branches. This keeps multi-write batches below
      // Firestore's 1000-expression evaluation limit.
      allow update: if (
          request.resource.data.get('lifecycle_status', '') == 'released'
          && exportRequestReleaseAllowed(docId)
        )
        || (
          request.resource.data.get('lifecycle_status', '') == 'release_cancelled'
          && exportRequestCancelAllowed(docId)
        )
        || exportSoftDeleteAllowed()
        || exportOwnerEditAllowed()
        || exportWarehouseProcessAllowed()
        || isAdmin();
""",
)

new_export_rules = r'''    match /export_orders/{docId} {
      allow read: if hasAnyPerm(['export.view', 'export_requests.release', 'export_requests.process']);
      allow create: if (
          request.resource.data.get('source_request_id', '') != ''
          && hasAnyPerm(['export_requests.release', 'export_requests.process'])
          && ownEmailField(request.resource.data, 'created_by')
          && generatedExportCreateMatchesRequest(docId)
        )
        || (
          request.resource.data.get('source_request_id', '') == ''
          && hasPerm('export.create')
          && ownEmailField(request.resource.data, 'created_by')
          && manualExportOrderData(request.resource.data)
        );
      allow update: if (
          resource.data.get('source_request_id', '') != ''
          && hasAnyPerm(['export_requests.release', 'export_requests.process'])
          && generatedExportCancelMatchesRequest(docId)
          && unchanged([
            'source_request_id', 'sync_source', 'source', 'release_sequence',
            'source_request_revision', 'request_operation_id', 'created_at', 'created_by'
          ])
        )
        || (
          resource.data.get('source_request_id', '') == ''
          && hasPerm('export.edit')
          && manualExportOrderData(resource.data)
          && manualExportOrderData(request.resource.data)
          && warehouseDocIdentitySafe()
          && unchanged([
            'source_request_id', 'sync_source', 'deleted', 'active', 'status',
            'deleted_at', 'deleted_by', 'deleted_reason', 'cancelled_at',
            'cancelled_by', 'cancel_reason'
          ])
        )
        || (
          resource.data.get('source_request_id', '') == ''
          && hasPerm('export.delete')
          && manualExportOrderData(resource.data)
          && manualExportOrderData(request.resource.data)
          && warehouseDocIdentitySafe()
          && unchanged(['source_request_id', 'sync_source'])
          && warehouseSoftDeleteOnly()
        )
        || isAdmin();
      allow delete: if isAdmin();
    }

    match /export_order_items/{docId} {
      allow read: if hasAnyPerm(['export.view', 'export_requests.release', 'export_requests.process']);
      allow create: if request.resource.data.get('source', '') == 'kingcup_firestore'
        && hasAnyPerm(['export_requests.release', 'export_requests.process'])
        && request.resource.data.export_order_id is string
        && quantityIsNumber(request.resource.data)
        && request.resource.data.get('quantity', 0) > 0
        && ownEmailField(request.resource.data, 'created_by')
        && generatedExportItemCreateAllowed()
        || (
          request.resource.data.get('source', '') != 'kingcup_firestore'
          && request.resource.data.export_order_id is string
          && quantityIsNumber(request.resource.data)
          && request.resource.data.get('quantity', 0) > 0
          && ownEmailField(request.resource.data, 'created_by')
          && (
            (
              hasPerm('export.create')
              && manualExportOrderAfterById(request.resource.data.export_order_id)
            )
            || (
              hasPerm('export.edit')
              && manualExportOrderById(request.resource.data.export_order_id)
            )
          )
        );
      allow update: if (
          resource.data.get('source', '') == 'kingcup_firestore'
          && hasAnyPerm(['export_requests.release', 'export_requests.process'])
          && unchanged(['export_order_id', 'created_at', 'created_by', 'source'])
          && generatedExportItemCancelAllowed()
        )
        || (
          resource.data.get('source', '') != 'kingcup_firestore'
          && hasPerm('export.edit')
          && resource.data.export_order_id is string
          && manualExportOrderById(resource.data.export_order_id)
          && unchanged(['export_order_id', 'created_at', 'created_by', 'source'])
          && quantityIsNumber(request.resource.data)
          && request.resource.data.get('quantity', 0) > 0
        )
        || (
          resource.data.get('source', '') != 'kingcup_firestore'
          && hasPerm('export.delete')
          && resource.data.export_order_id is string
          && manualExportOrderById(resource.data.export_order_id)
          && unchanged(['export_order_id', 'created_at', 'created_by', 'source'])
          && warehouseSoftDeleteOnly()
        )
        || isAdmin();
      allow delete: if isAdmin();
    }
'''
regex_once(
    r"    match /export_orders/\{docId\} \{.*?\n    match /inventory_adjustments/\{docId\} \{",
    new_export_rules + "\n    match /inventory_adjustments/{docId} {",
)

path.write_text(source, encoding='utf-8')
print('Step 8 lifecycle rules dispatch optimized')
