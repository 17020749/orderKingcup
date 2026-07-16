from pathlib import Path
import re

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def rep(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}\n--- expected ---\n{old}')
    return text.replace(old, new, 1)

def rep_last(text, old, new, label):
    count = text.count(old)
    if count < 1:
        raise SystemExit(f'{label}: expected at least one match')
    pos = text.rfind(old)
    return text[:pos] + new + text[pos + len(old):]

def patch_between(text, start_token, end_token, patcher, label):
    start = text.find(start_token)
    if start < 0:
        raise SystemExit(f'{label}: start token not found: {start_token}')
    end = text.find(end_token, start + len(start_token))
    if end < 0:
        raise SystemExit(f'{label}: end token not found: {end_token}')
    segment = text[start:end]
    patched = patcher(segment)
    return text[:start] + patched + text[end:]

def add_operation_to_movements(segment, label):
    pattern = re.compile(
        r"(movementPayload\(\{[\s\S]*?\n(?P<indent>\s*)createdBy(?:\s*:\s*[A-Za-z_][A-Za-z0-9_]*)?)(\n(?P=indent)\}\)\))"
    )
    def repl(m):
        head = m.group(1)
        indent = m.group('indent')
        tail = m.group(3)
        if 'operationId' in head.split('movementPayload({', 1)[-1]:
            return m.group(0)
        return f"{head},\n{indent}operationId{tail}"
    patched, count = pattern.subn(repl, segment)
    if count < 1:
        raise SystemExit(f'{label}: no movementPayload calls patched')
    return patched

tx_path = 'composables/useWarehouseTransactions.ts'
tx = read(tx_path)

helper_anchor = """function signedNumber(value: any) {
  const quantity = toNumber(value)
  if (quantity === 0) throw new Error('Số lượng điều chỉnh phải khác 0.')
  return quantity
}
"""
helper_block = helper_anchor + """
function revisionOf(data: any) {
  const value = Number(data?.revision || 0)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function operationIdOf(value: any, fallback: string) {
  return safeDocId(String(value || fallback || makeId('warehouse_operation')).trim(), 'warehouse_operation')
}

function assertExpectedRevision(current: any, expected: any, label: string) {
  const actual = revisionOf(current)
  const normalizedExpected = expected === undefined || expected === null || expected === ''
    ? actual
    : revisionOf({ revision: expected })
  if (actual !== normalizedExpected) {
    throw new Error(`${label} đã được người khác thay đổi. Phiên bản đang mở là ${normalizedExpected}, phiên bản hiện tại là ${actual}. Hãy tải lại dữ liệu trước khi thao tác.`)
  }
  return actual
}

function warehouseOperationPayload(input: {
  operationId: string
  action: string
  targetCollection: string
  targetId: string
  resultCode?: string
  targetRevision?: number
  createdBy: string
}) {
  return {
    id: input.operationId,
    operation_id: input.operationId,
    action: input.action,
    target_collection: input.targetCollection,
    target_id: input.targetId,
    result_code: input.resultCode || '',
    target_revision: input.targetRevision || 0,
    created_by: input.createdBy,
    status: 'completed',
    completed_at: serverTimestamp(),
    created_at: serverTimestamp(),
    active: true,
    deleted: false,
    source: 'nuxt_v7_5'
  }
}

function readOperationResult(data: any, action: string) {
  if (String(data?.action || '') !== action) {
    throw new Error('operation_id đã được dùng cho một nghiệp vụ khác. Hãy tải lại trang và thử lại.')
  }
  return {
    id: String(data?.target_id || ''),
    code: String(data?.result_code || ''),
    revision: revisionOf({ revision: data?.target_revision })
  }
}
"""
tx = rep(tx, helper_anchor, helper_block, 'insert operation helpers')

tx = rep(
    tx,
    "function balancePayload(delta: BalanceDelta, nextQuantity: number) {",
    "function balancePayload(delta: BalanceDelta, nextQuantity: number, operationId = '') {",
    'balancePayload signature'
)
tx = rep(
    tx,
    "    source: 'nuxt'\n  }\n}\n\nfunction movementPayload",
    "    source: 'nuxt',\n    last_operation_id: operationId\n  }\n}\n\nfunction movementPayload",
    'balancePayload operation field'
)
tx = rep(
    tx,
    "  createdBy: string\n}) {",
    "  createdBy: string\n  operationId: string\n}) {",
    'movementPayload input'
)
tx = rep(
    tx,
    "    created_by: input.createdBy,\n    created_at: serverTimestamp(),",
    "    created_by: input.createdBy,\n    operation_id: input.operationId,\n    created_at: serverTimestamp(),",
    'movementPayload operation field'
)
tx = rep(
    tx,
    "  function activity(module: string, action: string, itemCode: string, after: any) {",
    "  function activity(module: string, action: string, itemCode: string, after: any, operationId = '') {",
    'activity signature'
)
tx = rep(
    tx,
    "      changed_by: email(),\n      after_json:",
    "      changed_by: email(),\n      operation_id: operationId,\n      after_json:",
    'activity operation field'
)
tx = rep(
    tx,
    "    'order_export_requests', 'orders', 'activity_logs'\n",
    "    'order_export_requests', 'orders', 'activity_logs', 'warehouse_operations'\n",
    'invalidate operations cache'
)

def common_segment_patches(seg, label):
    seg = add_operation_to_movements(seg, label)
    seg = seg.replace("balancePayload(delta, next)", "balancePayload(delta, next, operationId)")
    seg = seg.replace("balancePayload(delta, current + delta.delta)", "balancePayload(delta, current + delta.delta, operationId)")
    return seg

def patch_create_import(seg):
    seg = rep(seg, "    note?: string\n    lines:", "    note?: string\n    operation_id?: string\n    lines:", 'create import signature')
    seg = rep(
        seg,
        "    const code = makeCode('PNK')\n",
        "    const code = makeCode('PNK')\n    const operationId = operationIdOf(input.operation_id, `import_create:${orderId}`)\n    let resultId = orderId\n    let resultCode = code\n    let alreadyProcessed = false\n",
        'create import operation vars'
    )
    seg = rep(
        seg,
        "      updated_at: serverTimestamp(),\n      source: 'nuxt'\n",
        "      updated_at: serverTimestamp(),\n      operation_id: operationId,\n      last_operation_id: operationId,\n      revision: 1,\n      source: 'nuxt'\n",
        'create import order operation fields'
    )
    seg = rep(
        seg,
        "    await runTransaction(db, async tx => {\n      const balanceSnaps = new Map<string, any>()\n",
        "    await runTransaction(db, async tx => {\n      const operationRef = doc(db, 'warehouse_operations', operationId)\n      const operationSnap = await tx.get(operationRef)\n      if (operationSnap.exists()) {\n        const previous = readOperationResult(operationSnap.data(), 'import_create')\n        resultId = previous.id || resultId\n        resultCode = previous.code || resultCode\n        alreadyProcessed = true\n        return\n      }\n\n      const balanceSnaps = new Map<string, any>()\n",
        'create import transaction guard'
    )
    seg = rep(
        seg,
        "          updated_at: serverTimestamp(),\n          source: 'nuxt'\n",
        "          updated_at: serverTimestamp(),\n          operation_id: operationId,\n          last_operation_id: operationId,\n          revision: 1,\n          source: 'nuxt'\n",
        'create import item fields'
    )
    seg = rep(
        seg,
        "      tx.set(doc(collection(db, 'activity_logs')), activity('import_orders', 'create', code, orderPayload))\n",
        "      tx.set(operationRef, warehouseOperationPayload({\n        operationId,\n        action: 'import_create',\n        targetCollection: 'import_orders',\n        targetId: orderId,\n        resultCode: code,\n        targetRevision: 1,\n        createdBy\n      }))\n      tx.set(doc(collection(db, 'activity_logs')), activity('import_orders', 'create', code, orderPayload, operationId))\n",
        'create import operation commit'
    )
    seg = rep(
        seg,
        "    return { id: orderId, code }\n",
        "    return { id: resultId, code: resultCode, operationId, alreadyProcessed }\n",
        'create import return'
    )
    return common_segment_patches(seg, 'createImportOrder')

tx = patch_between(tx, "  async function createImportOrder(", "\n  function itemProduct(", patch_create_import, 'createImportOrder')

def patch_update_import(seg):
    seg = rep(seg, "    note?: string\n    lines:", "    note?: string\n    operation_id?: string\n    expected_revision?: number\n    lines:", 'update import signature')
    seg = rep(
        seg,
        "    const code = input.order?.code || input.order?.import_code || orderId\n",
        "    const code = input.order?.code || input.order?.import_code || orderId\n    const operationId = operationIdOf(input.operation_id, `import_update:${orderId}:${revisionOf(input.order)}`)\n    const expectedRevision = input.expected_revision ?? input.order?.revision ?? 0\n    let resultId = orderId\n    let resultCode = code\n    let resultRevision = revisionOf(input.order)\n    let alreadyProcessed = false\n",
        'update import operation vars'
    )
    seg = rep(
        seg,
        "    await runTransaction(db, async tx => {\n      const balanceSnaps = new Map<string, any>()\n",
        "    await runTransaction(db, async tx => {\n      const operationRef = doc(db, 'warehouse_operations', operationId)\n      const operationSnap = await tx.get(operationRef)\n      if (operationSnap.exists()) {\n        const previous = readOperationResult(operationSnap.data(), 'import_update')\n        resultId = previous.id || resultId\n        resultCode = previous.code || resultCode\n        resultRevision = previous.revision || resultRevision\n        alreadyProcessed = true\n        return\n      }\n\n      const orderRef = doc(db, 'import_orders', orderId)\n      const currentOrderSnap = await tx.get(orderRef)\n      if (!currentOrderSnap.exists()) throw new Error('Phiếu nhập không còn tồn tại.')\n      const currentOrder = currentOrderSnap.data() || {}\n      if (currentOrder.deleted === true || currentOrder.active === false) throw new Error('Phiếu nhập đã bị xóa.')\n      const currentRevision = assertExpectedRevision(currentOrder, expectedRevision, 'Phiếu nhập')\n      resultRevision = currentRevision + 1\n\n      const balanceSnaps = new Map<string, any>()\n",
        'update import transaction guard'
    )
    seg = rep(
        seg,
        "        updated_by: updatedBy,\n        updated_at: serverTimestamp()\n",
        "        updated_by: updatedBy,\n        operation_id: operationId,\n        last_operation_id: operationId,\n        revision: resultRevision,\n        updated_at: serverTimestamp()\n",
        'update import order revision'
    )
    seg = rep(
        seg,
        "          updated_by: updatedBy,\n          updated_at: serverTimestamp(),\n          source:",
        "          updated_by: updatedBy,\n          operation_id: operationId,\n          last_operation_id: operationId,\n          revision: revisionOf(oldItems[index]) + 1,\n          updated_at: serverTimestamp(),\n          source:",
        'update import item revision'
    )
    seg = rep(
        seg,
        "          deleted_at: serverTimestamp(),\n          updated_by: updatedBy,\n          updated_at: serverTimestamp()\n",
        "          deleted_at: serverTimestamp(),\n          updated_by: updatedBy,\n          operation_id: operationId,\n          last_operation_id: operationId,\n          revision: revisionOf(item) + 1,\n          updated_at: serverTimestamp()\n",
        'update import removed item revision'
    )
    seg = rep(
        seg,
        "      tx.set(doc(collection(db, 'activity_logs')), activity('import_orders', 'update', code, {\n",
        "      tx.set(operationRef, warehouseOperationPayload({\n        operationId,\n        action: 'import_update',\n        targetCollection: 'import_orders',\n        targetId: orderId,\n        resultCode: code,\n        targetRevision: resultRevision,\n        createdBy: updatedBy\n      }))\n      tx.set(doc(collection(db, 'activity_logs')), activity('import_orders', 'update', code, {\n",
        'update import operation commit'
    )
    seg = rep(
        seg,
        "        line_count: preparedNew.length\n      }))\n",
        "        line_count: preparedNew.length\n      }, operationId))\n",
        'update import activity operation'
    )
    seg = rep(
        seg,
        "    return { id: orderId, code }\n",
        "    return { id: resultId, code: resultCode, revision: resultRevision, operationId, alreadyProcessed }\n",
        'update import return'
    )
    return common_segment_patches(seg, 'updateImportOrder')

tx = patch_between(tx, "  async function updateImportOrder(", "\n  async function deleteImportOrder(", patch_update_import, 'updateImportOrder')

def patch_delete_import(seg):
    seg = rep(
        seg,
        "  async function deleteImportOrder(input: { order: any; existingItems: any[]; reason?: string }) {",
        "  async function deleteImportOrder(input: { order: any; existingItems: any[]; reason?: string; operation_id?: string; expected_revision?: number }) {",
        'delete import signature'
    )
    seg = rep(
        seg,
        "    const code = input.order?.code || input.order?.import_code || orderId\n",
        "    const code = input.order?.code || input.order?.import_code || orderId\n    const operationId = operationIdOf(input.operation_id, `import_delete:${orderId}:${revisionOf(input.order)}`)\n    const expectedRevision = input.expected_revision ?? input.order?.revision ?? 0\n    let resultId = orderId\n    let resultCode = code\n    let resultRevision = revisionOf(input.order)\n    let alreadyProcessed = false\n",
        'delete import operation vars'
    )
    seg = rep(
        seg,
        "    await runTransaction(db, async tx => {\n      const balanceSnaps = new Map<string, any>()\n",
        "    await runTransaction(db, async tx => {\n      const operationRef = doc(db, 'warehouse_operations', operationId)\n      const operationSnap = await tx.get(operationRef)\n      if (operationSnap.exists()) {\n        const previous = readOperationResult(operationSnap.data(), 'import_delete')\n        resultId = previous.id || resultId\n        resultCode = previous.code || resultCode\n        resultRevision = previous.revision || resultRevision\n        alreadyProcessed = true\n        return\n      }\n\n      const orderRef = doc(db, 'import_orders', orderId)\n      const currentOrderSnap = await tx.get(orderRef)\n      if (!currentOrderSnap.exists()) throw new Error('Phiếu nhập không còn tồn tại.')\n      const currentOrder = currentOrderSnap.data() || {}\n      if (currentOrder.deleted === true || currentOrder.active === false) throw new Error('Phiếu nhập đã được xóa trước đó.')\n      const currentRevision = assertExpectedRevision(currentOrder, expectedRevision, 'Phiếu nhập')\n      resultRevision = currentRevision + 1\n\n      const balanceSnaps = new Map<string, any>()\n",
        'delete import transaction guard'
    )
    seg = rep(
        seg,
        "        deleted_at: serverTimestamp(),\n        updated_by: deletedBy,\n        updated_at: serverTimestamp()\n",
        "        deleted_at: serverTimestamp(),\n        updated_by: deletedBy,\n        operation_id: operationId,\n        last_operation_id: operationId,\n        revision: resultRevision,\n        updated_at: serverTimestamp()\n",
        'delete import order revision'
    )
    seg = rep(
        seg,
        "          deleted_at: serverTimestamp(),\n          updated_by: deletedBy,\n          updated_at: serverTimestamp()\n",
        "          deleted_at: serverTimestamp(),\n          updated_by: deletedBy,\n          operation_id: operationId,\n          last_operation_id: operationId,\n          revision: revisionOf(item) + 1,\n          updated_at: serverTimestamp()\n",
        'delete import item revision'
    )
    seg = rep(
        seg,
        "      tx.set(doc(collection(db, 'activity_logs')), activity('import_orders', 'delete', code, {\n",
        "      tx.set(operationRef, warehouseOperationPayload({\n        operationId,\n        action: 'import_delete',\n        targetCollection: 'import_orders',\n        targetId: orderId,\n        resultCode: code,\n        targetRevision: resultRevision,\n        createdBy: deletedBy\n      }))\n      tx.set(doc(collection(db, 'activity_logs')), activity('import_orders', 'delete', code, {\n",
        'delete import operation commit'
    )
    seg = rep(
        seg,
        "        reason: input.reason || ''\n      }))\n",
        "        reason: input.reason || ''\n      }, operationId))\n",
        'delete import activity operation'
    )
    seg = rep(
        seg,
        "    return { id: orderId, code }\n",
        "    return { id: resultId, code: resultCode, revision: resultRevision, operationId, alreadyProcessed }\n",
        'delete import return'
    )
    return common_segment_patches(seg, 'deleteImportOrder')

tx = patch_between(tx, "  async function deleteImportOrder(", "\n  async function createExportOrder(", patch_delete_import, 'deleteImportOrder')

def patch_create_export(seg):
    seg = rep(seg, "    code?: string\n    lines:", "    code?: string\n    operation_id?: string\n    lines:", 'create export signature')
    seg = rep(
        seg,
        "    const code = input.code || makeCode('PXK')\n",
        "    const code = input.code || makeCode('PXK')\n    const operationId = operationIdOf(input.operation_id, `export_create:${orderId}`)\n    let resultId = orderId\n    let resultCode = code\n    let alreadyProcessed = false\n",
        'create export operation vars'
    )
    seg = rep(
        seg,
        "      updated_at: serverTimestamp(),\n      source: input.source_request_id ? 'kingcup_firestore' : 'nuxt'\n",
        "      updated_at: serverTimestamp(),\n      operation_id: operationId,\n      last_operation_id: operationId,\n      revision: 1,\n      source: input.source_request_id ? 'kingcup_firestore' : 'nuxt'\n",
        'create export order fields'
    )
    seg = rep(
        seg,
        "    await runTransaction(db, async tx => {\n      const balanceSnaps = new Map<string, any>()\n",
        "    await runTransaction(db, async tx => {\n      const operationRef = doc(db, 'warehouse_operations', operationId)\n      const operationSnap = await tx.get(operationRef)\n      if (operationSnap.exists()) {\n        const previous = readOperationResult(operationSnap.data(), 'export_create')\n        resultId = previous.id || resultId\n        resultCode = previous.code || resultCode\n        alreadyProcessed = true\n        return\n      }\n\n      const balanceSnaps = new Map<string, any>()\n",
        'create export transaction guard'
    )
    seg = rep(
        seg,
        "          updated_at: serverTimestamp(),\n          source: orderPayload.source\n",
        "          updated_at: serverTimestamp(),\n          operation_id: operationId,\n          last_operation_id: operationId,\n          revision: 1,\n          source: orderPayload.source\n",
        'create export item fields'
    )
    seg = rep(
        seg,
        "      tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'create', code, orderPayload))\n",
        "      tx.set(operationRef, warehouseOperationPayload({\n        operationId,\n        action: 'export_create',\n        targetCollection: 'export_orders',\n        targetId: orderId,\n        resultCode: code,\n        targetRevision: 1,\n        createdBy\n      }))\n      tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'create', code, orderPayload, operationId))\n",
        'create export operation commit'
    )
    seg = rep(
        seg,
        "    return { id: orderId, code, stockMovementIds }\n",
        "    return { id: resultId, code: resultCode, stockMovementIds, operationId, alreadyProcessed }\n",
        'create export return'
    )
    return common_segment_patches(seg, 'createExportOrder')

tx = patch_between(tx, "  async function createExportOrder(", "\n  async function updateExportOrder(", patch_create_export, 'createExportOrder')

def patch_update_export(seg):
    seg = rep(seg, "    note?: string\n    lines:", "    note?: string\n    operation_id?: string\n    expected_revision?: number\n    lines:", 'update export signature')
    seg = rep(
        seg,
        "    const code = order.code || order.export_code || orderId\n",
        "    const code = order.code || order.export_code || orderId\n    const operationId = operationIdOf(input.operation_id, `export_update:${orderId}:${revisionOf(order)}`)\n    const expectedRevision = input.expected_revision ?? order.revision ?? 0\n    let resultId = orderId\n    let resultCode = code\n    let resultRevision = revisionOf(order)\n    let alreadyProcessed = false\n",
        'update export operation vars'
    )
    seg = rep(
        seg,
        "    await runTransaction(db, async tx => {\n      const orderRef = doc(db, 'export_orders', orderId)\n      const currentOrderSnap = await tx.get(orderRef)\n      if (!currentOrderSnap.exists()) throw new Error('Phiếu xuất không còn tồn tại.')\n      if (isRequestGeneratedExport(currentOrderSnap.data())) {\n",
        "    await runTransaction(db, async tx => {\n      const operationRef = doc(db, 'warehouse_operations', operationId)\n      const operationSnap = await tx.get(operationRef)\n      if (operationSnap.exists()) {\n        const previous = readOperationResult(operationSnap.data(), 'export_update')\n        resultId = previous.id || resultId\n        resultCode = previous.code || resultCode\n        resultRevision = previous.revision || resultRevision\n        alreadyProcessed = true\n        return\n      }\n\n      const orderRef = doc(db, 'export_orders', orderId)\n      const currentOrderSnap = await tx.get(orderRef)\n      if (!currentOrderSnap.exists()) throw new Error('Phiếu xuất không còn tồn tại.')\n      const currentOrder = currentOrderSnap.data() || {}\n      if (isRequestGeneratedExport(currentOrder)) {\n",
        'update export transaction guard'
    )
    seg = rep(
        seg,
        "        throw new Error('Phiếu xuất sinh từ yêu cầu sale không được sửa trực tiếp.')\n      }\n\n      const balanceSnaps",
        "        throw new Error('Phiếu xuất sinh từ yêu cầu sale không được sửa trực tiếp.')\n      }\n      if (currentOrder.deleted === true || currentOrder.active === false || ['cancelled', 'deleted'].includes(String(currentOrder.status || ''))) {\n        throw new Error('Phiếu xuất đã hủy/xóa, không thể sửa.')\n      }\n      const currentRevision = assertExpectedRevision(currentOrder, expectedRevision, 'Phiếu xuất')\n      resultRevision = currentRevision + 1\n\n      const balanceSnaps",
        'update export revision check'
    )
    seg = rep(
        seg,
        "        note: input.note || '',\n        updated_by: updatedBy,\n        updated_at: serverTimestamp()\n",
        "        note: input.note || '',\n        updated_by: updatedBy,\n        operation_id: operationId,\n        last_operation_id: operationId,\n        revision: resultRevision,\n        updated_at: serverTimestamp()\n",
        'update export order revision'
    )
    seg = rep(
        seg,
        "          updated_by: updatedBy,\n          updated_at: serverTimestamp(),\n          source:",
        "          updated_by: updatedBy,\n          operation_id: operationId,\n          last_operation_id: operationId,\n          revision: revisionOf(oldItem) + 1,\n          updated_at: serverTimestamp(),\n          source:",
        'update export item revision'
    )
    seg = rep(
        seg,
        "          deleted_by: updatedBy,\n          updated_by: updatedBy,\n          updated_at: serverTimestamp()\n",
        "          deleted_by: updatedBy,\n          updated_by: updatedBy,\n          operation_id: operationId,\n          last_operation_id: operationId,\n          revision: revisionOf(item) + 1,\n          updated_at: serverTimestamp()\n",
        'update export removed item revision'
    )
    seg = rep(
        seg,
        "      tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'update', code, {\n",
        "      tx.set(operationRef, warehouseOperationPayload({\n        operationId,\n        action: 'export_update',\n        targetCollection: 'export_orders',\n        targetId: orderId,\n        resultCode: code,\n        targetRevision: resultRevision,\n        createdBy: updatedBy\n      }))\n      tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'update', code, {\n",
        'update export operation commit'
    )
    seg = rep(
        seg,
        "        line_count: preparedNew.length\n      }))\n",
        "        line_count: preparedNew.length\n      }, operationId))\n",
        'update export activity operation'
    )
    seg = rep(
        seg,
        "    return { id: orderId, code }\n",
        "    return { id: resultId, code: resultCode, revision: resultRevision, operationId, alreadyProcessed }\n",
        'update export return'
    )
    return common_segment_patches(seg, 'updateExportOrder')

tx = patch_between(tx, "  async function updateExportOrder(", "\n  async function deleteExportOrder(", patch_update_export, 'updateExportOrder')

def patch_delete_export(seg):
    seg = rep(
        seg,
        "    reason?: string\n  }) {",
        "    reason?: string\n    operation_id?: string\n    expected_revision?: number\n  }) {",
        'delete export signature'
    )
    seg = rep(
        seg,
        "    const reason = String(input.reason || '').trim() || 'Hủy phiếu xuất kho'\n",
        "    const reason = String(input.reason || '').trim() || 'Hủy phiếu xuất kho'\n    const operationId = operationIdOf(input.operation_id, `export_cancel:${orderId}:${revisionOf(order)}`)\n    const expectedRevision = input.expected_revision ?? order.revision ?? 0\n    let resultId = orderId\n    let resultCode = code\n    let resultRevision = revisionOf(order)\n    let alreadyProcessed = false\n",
        'delete export operation vars'
    )
    seg = rep(
        seg,
        "    await runTransaction(db, async tx => {\n      const orderRef = doc(db, 'export_orders', orderId)\n",
        "    await runTransaction(db, async tx => {\n      const operationRef = doc(db, 'warehouse_operations', operationId)\n      const operationSnap = await tx.get(operationRef)\n      if (operationSnap.exists()) {\n        const previous = readOperationResult(operationSnap.data(), 'export_cancel')\n        resultId = previous.id || resultId\n        resultCode = previous.code || resultCode\n        resultRevision = previous.revision || resultRevision\n        alreadyProcessed = true\n        return\n      }\n\n      const orderRef = doc(db, 'export_orders', orderId)\n",
        'delete export transaction guard'
    )
    seg = rep(
        seg,
        "      if (currentOrder.deleted === true || currentOrder.active === false) {\n        throw new Error('Phiếu xuất đã được hủy trước đó.')\n      }\n\n      const balanceSnaps",
        "      if (currentOrder.deleted === true || currentOrder.active === false) {\n        throw new Error('Phiếu xuất đã được hủy trước đó.')\n      }\n      const currentRevision = assertExpectedRevision(currentOrder, expectedRevision, 'Phiếu xuất')\n      resultRevision = currentRevision + 1\n\n      const balanceSnaps",
        'delete export revision check'
    )
    seg = rep(
        seg,
        "        cancel_reason: reason,\n        updated_by: deletedBy,\n        updated_at: serverTimestamp()\n",
        "        cancel_reason: reason,\n        updated_by: deletedBy,\n        operation_id: operationId,\n        last_operation_id: operationId,\n        revision: resultRevision,\n        updated_at: serverTimestamp()\n",
        'delete export order revision'
    )
    seg = rep(
        seg,
        "          deleted_reason: reason,\n          updated_by: deletedBy,\n          updated_at: serverTimestamp()\n",
        "          deleted_reason: reason,\n          updated_by: deletedBy,\n          operation_id: operationId,\n          last_operation_id: operationId,\n          revision: revisionOf(item) + 1,\n          updated_at: serverTimestamp()\n",
        'delete export item revision'
    )
    seg = rep(
        seg,
        "      tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'cancel', code, {\n",
        "      tx.set(operationRef, warehouseOperationPayload({\n        operationId,\n        action: 'export_cancel',\n        targetCollection: 'export_orders',\n        targetId: orderId,\n        resultCode: code,\n        targetRevision: resultRevision,\n        createdBy: deletedBy\n      }))\n      tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'cancel', code, {\n",
        'delete export operation commit'
    )
    seg = rep(
        seg,
        "        reason\n      }))\n",
        "        reason\n      }, operationId))\n",
        'delete export activity operation'
    )
    seg = rep(
        seg,
        "    return { id: orderId, code }\n",
        "    return { id: resultId, code: resultCode, revision: resultRevision, operationId, alreadyProcessed }\n",
        'delete export return'
    )
    return common_segment_patches(seg, 'deleteExportOrder')

tx = patch_between(tx, "  async function deleteExportOrder(", "\n  async function createInventoryAdjustment(", patch_delete_export, 'deleteExportOrder')

def patch_adjustment(seg):
    seg = rep(seg, "    note?: string\n  }) {", "    note?: string\n    operation_id?: string\n  }) {", 'adjustment signature')
    seg = rep(
        seg,
        "    const adjustmentId = makeId('adj')\n",
        "    const adjustmentId = makeId('adj')\n    const operationId = operationIdOf(input.operation_id, `inventory_adjust:${adjustmentId}`)\n    let resultId = adjustmentId\n    let alreadyProcessed = false\n",
        'adjustment operation vars'
    )
    seg = rep(
        seg,
        "      updated_at: serverTimestamp(),\n      source: 'nuxt'\n",
        "      updated_at: serverTimestamp(),\n      operation_id: operationId,\n      last_operation_id: operationId,\n      revision: 1,\n      source: 'nuxt'\n",
        'adjustment payload fields'
    )
    seg = rep(
        seg,
        "    await runTransaction(db, async tx => {\n      const balanceRef",
        "    await runTransaction(db, async tx => {\n      const operationRef = doc(db, 'warehouse_operations', operationId)\n      const operationSnap = await tx.get(operationRef)\n      if (operationSnap.exists()) {\n        const previous = readOperationResult(operationSnap.data(), 'inventory_adjust')\n        resultId = previous.id || resultId\n        alreadyProcessed = true\n        return\n      }\n\n      const balanceRef",
        'adjustment transaction guard'
    )
    seg = rep(
        seg,
        "      tx.set(doc(collection(db, 'activity_logs')), activity('inventory_adjustments', 'create', adjustmentId, payload))\n",
        "      tx.set(operationRef, warehouseOperationPayload({\n        operationId,\n        action: 'inventory_adjust',\n        targetCollection: 'inventory_adjustments',\n        targetId: adjustmentId,\n        targetRevision: 1,\n        createdBy\n      }))\n      tx.set(doc(collection(db, 'activity_logs')), activity('inventory_adjustments', 'create', adjustmentId, payload, operationId))\n",
        'adjustment operation commit'
    )
    seg = rep(
        seg,
        "    return { id: adjustmentId }\n",
        "    return { id: resultId, operationId, alreadyProcessed }\n",
        'adjustment return'
    )
    return common_segment_patches(seg, 'createInventoryAdjustment')

tx = patch_between(tx, "  async function createInventoryAdjustment(", "\n  async function processExportRequestToExportOrder(", patch_adjustment, 'createInventoryAdjustment')

def patch_request_release(seg):
    seg = rep(seg, "    notification_recipients?: string[]\n    lines:", "    notification_recipients?: string[]\n    operation_id?: string\n    lines:", 'release signature')
    seg = rep(
        seg,
        "    const code = safeDocId(`PXK-${request.request_id || requestDocId}`, 'PXK')\n",
        "    const code = safeDocId(`PXK-${request.request_id || requestDocId}`, 'PXK')\n    const operationId = operationIdOf(input.operation_id, `export_request_release:${requestDocId}`)\n    let resultId = orderId\n    let resultCode = code\n",
        'release operation vars'
    )
    seg = rep(
        seg,
        "      updated_at: serverTimestamp(),\n      source: 'kingcup_firestore'\n",
        "      updated_at: serverTimestamp(),\n      operation_id: operationId,\n      last_operation_id: operationId,\n      revision: 1,\n      source: 'kingcup_firestore'\n",
        'release order fields'
    )
    seg = rep(
        seg,
        "    await runTransaction(db, async tx => {\n      const requestRef",
        "    await runTransaction(db, async tx => {\n      const operationRef = doc(db, 'warehouse_operations', operationId)\n      const operationSnap = await tx.get(operationRef)\n      if (operationSnap.exists()) {\n        const previous = readOperationResult(operationSnap.data(), 'export_request_release')\n        resultId = previous.id || resultId\n        resultCode = previous.code || resultCode\n        alreadyProcessed = true\n        return\n      }\n\n      const requestRef",
        'release transaction guard'
    )
    seg = rep(
        seg,
        "             updated_at: serverTimestamp(),\n             source: 'kingcup_firestore'\n",
        "             updated_at: serverTimestamp(),\n             operation_id: operationId,\n             last_operation_id: operationId,\n             revision: 1,\n             source: 'kingcup_firestore'\n",
        'release item fields'
    )
    seg = rep(
        seg,
        "           request_timeline_json: JSON.stringify(nextTimeline),\n           updated_at: serverTimestamp()\n",
        "           request_timeline_json: JSON.stringify(nextTimeline),\n           operation_id: operationId,\n           last_operation_id: operationId,\n           revision: revisionOf(currentRequest) + 1,\n           updated_at: serverTimestamp()\n",
        'release request revision'
    )
    seg = seg.replace(
        "activity('export_orders', 'create_from_request', code, orderPayload)",
        "activity('export_orders', 'create_from_request', code, orderPayload, operationId)"
    )
    seg = rep(
        seg,
        "         tx.set(doc(collection(db, 'activity_logs')), activity('order_export_requests', 'warehouse_export', request.request_id || requestDocId, {\n",
        "         tx.set(doc(collection(db, 'activity_logs')), activity('order_export_requests', 'warehouse_export', request.request_id || requestDocId, {\n",
        'release activity anchor'
    )
    seg = rep(
        seg,
        "           export_code: code\n         }))\n",
        "           export_code: code\n         }, operationId))\n",
        'release activity operation'
    )
    insertion = """      }

      tx.set(operationRef, warehouseOperationPayload({
        operationId,
        action: 'export_request_release',
        targetCollection: 'export_orders',
        targetId: orderId,
        resultCode: code,
        targetRevision: 1,
        createdBy
      }))
    })"""
    seg = rep_last(seg, "      }\n    })", insertion, 'release operation commit')
    seg = rep(
        seg,
        "       id: orderId,\n       code,\n",
        "       id: resultId,\n       code: resultCode,\n",
        'release return result'
    )
    return common_segment_patches(seg, 'processExportRequestToExportOrder')

tx = patch_between(tx, "  async function processExportRequestToExportOrder(", "\n  async function getInventoryBalanceId(", patch_request_release, 'processExportRequestToExportOrder')

write(tx_path, tx)

imports_path = 'pages/imports.vue'
imports = read(imports_path)
imports = rep(imports, "  normalizeText,\n  toNumber,", "  normalizeText,\n  makeId,\n  toNumber,", 'imports makeId import')
imports = rep(imports, '  note: "",\n  lines:', '  note: "",\n  operation_id: makeId("op_import_create"),\n  lines:', 'imports form operation')
imports = rep(imports, '    note: "",\n    lines: [newBlankLine()],', '    note: "",\n    operation_id: makeId("op_import_create"),\n    lines: [newBlankLine()],', 'imports create modal operation')
imports = rep(imports, '    note: row.note || "",\n    lines:', '    note: row.note || "",\n    operation_id: makeId("op_import_update"),\n    lines:', 'imports edit modal operation')
imports = rep(imports, '      reason: "Xóa phiếu nhập kho",\n', '      reason: "Xóa phiếu nhập kho",\n      operation_id: `import_delete:${row.id}:${toNumber((row as any).revision)}`,\n      expected_revision: toNumber((row as any).revision),\n', 'imports delete operation')
imports = rep(imports, '      note: form.note,\n      lines:', '      note: form.note,\n      operation_id: form.operation_id,\n      lines:', 'imports save operation')
imports = rep(imports, '          existingItems: itemsForOrder(editing.value),\n          ...payload,', '          existingItems: itemsForOrder(editing.value),\n          expected_revision: toNumber((editing.value as any).revision),\n          ...payload,', 'imports expected revision')
write(imports_path, imports)

exports_path = 'pages/exports.vue'
exports = read(exports_path)
exports = rep(exports, "  formatDateTime,\n  normalizeText,", "  formatDateTime,\n  makeId,\n  normalizeText,", 'exports makeId import')
exports = rep(exports, '  note: "",\n  lines:', '  note: "",\n  operation_id: makeId("op_export_create"),\n  lines:', 'exports form operation')
exports = rep(exports, '    note: "",\n    lines: [newBlankLine()],', '    note: "",\n    operation_id: makeId("op_export_create"),\n    lines: [newBlankLine()],', 'exports create modal operation')
exports = rep(exports, '    note: row.note || "",\n    lines:', '    note: row.note || "",\n    operation_id: makeId("op_export_update"),\n    lines:', 'exports edit modal operation')
exports = rep(exports, '      reason: "Hủy phiếu xuất từ trang Xuất kho thật",\n', '      reason: "Hủy phiếu xuất từ trang Xuất kho thật",\n      operation_id: `export_cancel:${row.id}:${toNumber((row as any).revision)}`,\n      expected_revision: toNumber((row as any).revision),\n', 'exports cancel operation')
exports = rep(exports, '      note: form.note,\n      lines:', '      note: form.note,\n      operation_id: form.operation_id,\n      lines:', 'exports save operation')
exports = rep(exports, '          existingItems: itemsByOrder.value.get(editing.value.id) || [],\n', '          existingItems: itemsByOrder.value.get(editing.value.id) || [],\n          expected_revision: toNumber((editing.value as any).revision),\n', 'exports expected revision')
write(exports_path, exports)

adjust_path = 'pages/inventory-adjustments.vue'
adjust = read(adjust_path)
adjust = rep(adjust, "  formatDateTime,\n  normalizeText,", "  formatDateTime,\n  makeId,\n  normalizeText,", 'adjust makeId import')
adjust = rep(adjust, '  note: "",\n});', '  note: "",\n  operation_id: makeId("op_inventory_adjust"),\n});', 'adjust form operation')
adjust = rep(adjust, '    note: "",\n  });', '    note: "",\n    operation_id: makeId("op_inventory_adjust"),\n  });', 'adjust modal operation')
adjust = rep(adjust, '      note: form.note,\n    });', '      note: form.note,\n      operation_id: form.operation_id,\n    });', 'adjust save operation')
write(adjust_path, adjust)

rules_path = 'firestore.rules'
rules = read(rules_path)
rules = rep(
    rules,
    "        'updated_by',\n        'updated_at'\n",
    "        'updated_by',\n        'operation_id',\n        'last_operation_id',\n        'revision',\n        'updated_at'\n",
    'rules warehouse soft delete operation fields'
)
rules = rep(
    rules,
    "          'request_timeline_json',\n          'updated_at'\n",
    "          'request_timeline_json',\n          'operation_id',\n          'last_operation_id',\n          'revision',\n          'updated_at'\n",
    'rules export request operation fields'
)
operation_rules = """
    match /warehouse_operations/{docId} {
      allow read: if canReadInventoryCore();
      allow create: if canWriteInventoryCore()
        && request.resource.data.get('operation_id', '') == docId
        && request.resource.data.get('status', '') == 'completed'
        && ownEmailField(request.resource.data, 'created_by');
      // Operation records are immutable idempotency keys. A completed key must
      // never be rewritten or removed by a client.
      allow update, delete: if false;
    }

"""
rules = rep(
    rules,
    "    match /stock_movements/{docId} {\n",
    operation_rules + "    match /stock_movements/{docId} {\n",
    'rules warehouse operations collection'
)
write(rules_path, rules)

tests_path = 'tests/firestore.rules.test.mjs'
tests = read(tests_path)
tests += """

test('V7.5 cho phép nghiệp vụ kho tạo operation key bất biến', async () => {
  const db = env.authenticatedContext(STOCK, { email: STOCK }).firestore()
  const ref = doc(db, 'warehouse_operations', 'op-v75-stock')
  await assertSucceeds(setDoc(ref, {
    id: 'op-v75-stock',
    operation_id: 'op-v75-stock',
    action: 'import_create',
    target_collection: 'import_orders',
    target_id: 'import-v75',
    result_code: 'PNK-V75',
    target_revision: 1,
    created_by: STOCK,
    status: 'completed',
    active: true,
    deleted: false
  }))
  await assertFails(updateDoc(ref, { result_code: 'KHONG-DUOC-SUA' }))
  await assertFails(deleteDoc(ref))
})

test('V7.5 người không có quyền kho không được tạo operation key', async () => {
  const db = env.authenticatedContext(EDITOR, { email: EDITOR }).firestore()
  await assertFails(setDoc(doc(db, 'warehouse_operations', 'op-v75-editor'), {
    id: 'op-v75-editor',
    operation_id: 'op-v75-editor',
    action: 'import_create',
    target_collection: 'import_orders',
    target_id: 'import-v75-editor',
    created_by: EDITOR,
    status: 'completed',
    active: true,
    deleted: false
  }))
})

test('V7.5 quyền release được ghi revision và operation id khi cho xuất', async () => {
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
write(tests_path, tests)

tx_check = read(tx_path)
required = [
    "warehouse_operations",
    "operation_id: input.operationId",
    "assertExpectedRevision",
    "action: 'import_create'",
    "action: 'import_update'",
    "action: 'import_delete'",
    "action: 'export_create'",
    "action: 'export_update'",
    "action: 'export_cancel'",
    "action: 'inventory_adjust'",
    "action: 'export_request_release'",
]
for token in required:
    if token not in tx_check:
        raise SystemExit(f'missing required V7.5 token: {token}')

movement_count = tx_check.count("movementPayload({")
operation_lines = len(re.findall(r"\n\s+operationId\n\s+\}\)\)", tx_check))
if movement_count != operation_lines:
    raise SystemExit(f'movement operation id mismatch: movements={movement_count}, tagged={operation_lines}')

print('V7.5 patch applied successfully.')
