from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    if old not in source:
        raise SystemExit(f'Missing regression target in {path}: {old[:180]!r}')
    file.write_text(source.replace(old, new, 1), encoding='utf-8')


replace_once(
    'firestore.rules',
    """        || (
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
""",
    """        || (
          request.resource.data.get('source', '') != 'kingcup_firestore'
          && hasAnyPerm(['export.create', 'export.edit'])
          && request.resource.data.export_order_id is string
          && quantityIsNumber(request.resource.data)
          && request.resource.data.get('quantity', 0) > 0
          && ownEmailField(request.resource.data, 'created_by')
          && manualExportOrderAfterById(request.resource.data.export_order_id)
        );
""",
)

old_release_test = """test('Quyền cho xuất được tạo phiếu xuất thật, ghi tồn và cập nhật request/order', async () => {
  const db = env.authenticatedContext(WAREHOUSE_RELEASE, { email: WAREHOUSE_RELEASE }).firestore()

  await assertSucceeds(setDoc(doc(db, 'export_orders', 'export-real-from-request'), {
    id: 'export-real-from-request',
    code: 'PX-YC-001',
    source_request_id: 'export-a',
    created_by: WAREHOUSE_RELEASE,
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))
  await assertSucceeds(setDoc(doc(db, 'export_order_items', 'export-real-from-request-item'), {
    export_order_id: 'export-real-from-request',
    product_id: 'product-existing',
    from_warehouse_id: 'wh-a',
    quantity: 2,
    created_by: WAREHOUSE_RELEASE,
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))
  await assertSucceeds(setDoc(doc(db, 'stock_movements', 'move-release'), {
    id: 'move-release',
    movement_type: 'export_customer',
    direction: 'out',
    product_id: 'product-existing',
    warehouse_id: 'wh-a',
    quantity: -2,
    created_by: WAREHOUSE_RELEASE,
    operation_id: 'op-release-test',
    created_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))
  await assertSucceeds(updateDoc(doc(db, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: 3,
    last_operation_id: 'op-release-test',
    updated_by: WAREHOUSE_RELEASE,
    updated_at: 'now'
  }))
  await assertSucceeds(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    status: 'da_xuat',
    warehouse_handled_by: WAREHOUSE_RELEASE,
    export_order_id: 'export-real-from-request',
    warehouse_export_order_id: 'export-real-from-request',
    exported_at: 'now',
    updated_at: 'now'
  }))
  await assertSucceeds(updateDoc(doc(db, 'orders', 'order-a'), {
    warehouse_fulfillment_status: 'da_xuat_1_phan',
    warehouse_request_status: 'da_xuat',
    updated_at: 'now'
  }))
  await assertSucceeds(setDoc(doc(db, 'notifications', 'notification-release-to-sale'), {
    type: 'warehouse_export_request_released',
    title: 'Kho đã cho xuất hàng',
    message: 'Đã tạo phiếu PX-YC-001',
    created_by: WAREHOUSE_RELEASE,
    to_email: A,
    audience: '',
    audience_permissions: [],
    status: 'unread',
    active: true,
    deleted: false
  }))
})
"""
new_release_test = """test('Quyền cho xuất được tạo phiếu xuất thật và cập nhật request/order nguyên tử', async () => {
  const db = env.authenticatedContext(WAREHOUSE_RELEASE, { email: WAREHOUSE_RELEASE }).firestore()
  const exportId = 'request_export__export-a-accepted'
  const operationId = 'op-release-test'
  const batch = writeBatch(db)
  batch.set(doc(db, 'export_orders', exportId), {
    id: exportId,
    code: 'PX-YC-001',
    export_code: 'PX-YC-001',
    source_request_id: 'export-a-accepted',
    sync_source: 'kingcup_firestore:export-a-accepted',
    source: 'kingcup_firestore',
    lifecycle_status: 'released',
    release_sequence: 1,
    source_request_revision: 0,
    request_operation_id: operationId,
    created_by: WAREHOUSE_RELEASE,
    created_at: 'now',
    updated_at: 'now',
    operation_id: operationId,
    last_operation_id: operationId,
    revision: 1,
    status: 'completed',
    active: true,
    deleted: false
  })
  batch.set(doc(db, 'export_order_items', `${exportId}__1`), {
    id: `${exportId}__1`,
    export_order_id: exportId,
    product_id: 'product-existing',
    from_warehouse_id: 'wh-a',
    quantity: 2,
    created_by: WAREHOUSE_RELEASE,
    created_at: 'now',
    updated_at: 'now',
    operation_id: operationId,
    last_operation_id: operationId,
    revision: 1,
    active: true,
    deleted: false,
    status: 'completed',
    source: 'kingcup_firestore'
  })
  batch.update(doc(db, 'order_export_requests', 'export-a-accepted'), {
    status: 'da_xuat',
    lifecycle_status: 'released',
    release_sequence: 1,
    active_export_order_id: exportId,
    warehouse_export_code: 'PX-YC-001',
    warehouse_export_id: exportId,
    warehouse_export_order_id: exportId,
    export_order_id: exportId,
    warehouse_handled_by: WAREHOUSE_RELEASE,
    warehouse_handled_at: 'now',
    warehouse_note: '',
    exported_at: 'now',
    actual_exported_at: 'now',
    actual_export_summary_json: '[{"product_id":"product-existing","warehouse_id":"wh-a","quantity":2}]',
    stock_movement_ids: ['move-release'],
    request_timeline_json: '[]',
    operation_id: operationId,
    last_operation_id: operationId,
    last_released_export_order_id: exportId,
    last_released_export_code: 'PX-YC-001',
    last_released_by: WAREHOUSE_RELEASE,
    revision: 1,
    updated_at: 'now'
  })
  batch.update(doc(db, 'orders', 'order-a'), {
    warehouse_fulfillment_status: 'da_xuat_1_phan',
    warehouse_request_status: 'da_xuat',
    updated_at: 'now'
  })
  await assertSucceeds(batch.commit())

  await assertSucceeds(setDoc(doc(db, 'stock_movements', 'move-release'), {
    id: 'move-release', movement_type: 'export_customer', direction: 'out',
    product_id: 'product-existing', warehouse_id: 'wh-a', quantity: -2,
    created_by: WAREHOUSE_RELEASE, operation_id: operationId,
    created_at: 'now', active: true, deleted: false, source: 'nuxt'
  }))
  await assertSucceeds(updateDoc(doc(db, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: 3, last_operation_id: operationId,
    updated_by: WAREHOUSE_RELEASE, updated_at: 'now'
  }))
})
"""
replace_once('tests/firestore.rules.test.mjs', old_release_test, new_release_test)

old_v75 = """test('V7.5 quyền release được ghi revision và operation id khi cho xuất', async () => {
  const db = env.authenticatedContext(WAREHOUSE_RELEASE, { email: WAREHOUSE_RELEASE }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'order_export_requests', 'export-a-accepted'), {
    status: 'da_xuat',
    warehouse_export_code: 'PXK-V75',
    warehouse_export_id: 'export-v75',
    warehouse_export_order_id: 'export-v75',
    export_order_id: 'export-v75',
    warehouse_handled_by: WAREHOUSE_RELEASE,
    warehouse_handled_at: 'now',
    exported_at: 'now',
    actual_exported_at: 'now',
    actual_export_summary_json: '[]',
    stock_movement_ids: ['move-v75'],
    request_timeline_json: '[]',
    operation_id: 'op-v75-release',
    last_operation_id: 'op-v75-release',
    revision: 1,
    updated_at: 'now'
  }))
})
"""
new_v75 = """test('V7.5 quyền release ghi revision và operation id qua liên kết nguyên tử', async () => {
  const db = env.authenticatedContext(WAREHOUSE_RELEASE, { email: WAREHOUSE_RELEASE }).firestore()
  const exportId = 'export-v75'
  const operationId = 'op-v75-release'
  const batch = writeBatch(db)
  batch.set(doc(db, 'export_orders', exportId), {
    id: exportId, code: 'PXK-V75', export_code: 'PXK-V75',
    source_request_id: 'export-a-accepted',
    sync_source: 'kingcup_firestore:export-a-accepted', source: 'kingcup_firestore',
    lifecycle_status: 'released', release_sequence: 1, source_request_revision: 0,
    request_operation_id: operationId, created_by: WAREHOUSE_RELEASE,
    created_at: 'now', updated_at: 'now', operation_id: operationId,
    last_operation_id: operationId, revision: 1,
    status: 'completed', active: true, deleted: false
  })
  batch.update(doc(db, 'order_export_requests', 'export-a-accepted'), {
    status: 'da_xuat', lifecycle_status: 'released', release_sequence: 1,
    active_export_order_id: exportId, warehouse_export_code: 'PXK-V75',
    warehouse_export_id: exportId, warehouse_export_order_id: exportId,
    export_order_id: exportId, warehouse_handled_by: WAREHOUSE_RELEASE,
    warehouse_handled_at: 'now', warehouse_note: '', exported_at: 'now',
    actual_exported_at: 'now', actual_export_summary_json: '[]',
    stock_movement_ids: ['move-v75'], request_timeline_json: '[]',
    operation_id: operationId, last_operation_id: operationId,
    last_released_export_order_id: exportId, last_released_export_code: 'PXK-V75',
    last_released_by: WAREHOUSE_RELEASE, revision: 1, updated_at: 'now'
  })
  await assertSucceeds(batch.commit())
})
"""
replace_once('tests/firestore.rules.test.mjs', old_v75, new_v75)

replace_once(
    'tests/order-printing-delete-lock.client.test.mjs',
    """  assert.match(rules, /allow update: if exportSoftDeleteAllowed\(\)\s*\|\| exportOwnerEditAllowed\(\)/)
""",
    """  assert.match(rules, /lifecycle_status'[\s\S]*?exportRequestReleaseAllowed\(docId\)[\s\S]*?\|\| exportSoftDeleteAllowed\(\)/)
""",
)

print('Step 8 regression migrations applied')
