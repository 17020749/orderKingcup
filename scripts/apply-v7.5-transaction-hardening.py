from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: cần đúng 1 vị trí, tìm thấy {count}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'composables/useWarehouseTransactions.ts',
    """  const status = String(data?.status || '')
  if (!['pending', 'completed'].includes(status)) {
    throw new Error(`operation_id đang ở trạng thái không hợp lệ: ${status || 'trống'}.`)
  }
""",
    """  const status = String(data?.status || '')
  if (!['pending', 'processing', 'failed', 'completed'].includes(status)) {
    throw new Error(`operation_id đang ở trạng thái không hợp lệ: ${status || 'trống'}.`)
  }
""",
    'operation status guard',
)

replace_once(
    'firestore.rules',
    """
    function warehouseProcessingOperationOwned(operationId) {
      let path = /databases/$(database)/documents/warehouse_operations/$(operationId);
      let operation = get(path).data;
      return operationId is string
        && operationId != ''
        && exists(path)
        && operation.get('status', '') == 'processing'
        && operation.get('created_by', '').lower() == email();
    }
""",
    "",
    'unused operation lookup helper',
)

replace_once(
    'firestore.rules',
    """      allow update: if resource.data.get('operation_id', '') == docId
        && request.resource.data.get('operation_id', '') == docId
        && resource.data.get('created_by', '').lower() == email()
        && request.resource.data.get('created_by', '') == resource.data.get('created_by', '')
        && request.resource.data.get('action', '') == resource.data.get('action', '')
        && (
          (
            resource.data.get('status', '') == 'processing'
            && ['completed', 'failed'].hasAny([request.resource.data.get('status', '')])
          )
          || (
            ['failed', 'pending'].hasAny([resource.data.get('status', '')])
            && request.resource.data.get('status', '') == 'processing'
          )
        );
""",
    """      allow update: if resource.data.get('operation_id', '') == docId
        && request.resource.data.get('operation_id', '') == docId
        && resource.data.get('created_by', '').lower() == email()
        && unchanged([
          'operation_id',
          'action',
          'target_collection',
          'target_id',
          'created_by',
          'created_at',
          'source'
        ])
        && onlyChanged([
          'status',
          'processing_at',
          'completed_at',
          'failed_at',
          'failure_message',
          'result_code',
          'target_revision'
        ])
        && (
          (
            resource.data.get('status', '') == 'processing'
            && ['completed', 'failed'].hasAny([request.resource.data.get('status', '')])
          )
          || (
            ['failed', 'pending'].hasAny([resource.data.get('status', '')])
            && request.resource.data.get('status', '') == 'processing'
          )
        );
""",
    'warehouse operation update rule',
)

replace_once(
    'firestore.rules',
    """      allow create: if (
          request.resource.data.get('operation_id', '') != ''
          ? (
            warehouseProcessingOperationOwned(request.resource.data.get('operation_id', ''))
            && ownEmailField(request.resource.data, 'created_by')
          )
          : (
            canWriteInventoryCore()
            && ownEmailField(request.resource.data, 'created_by')
          )
        )
        && quantityIsNumber(request.resource.data)
        && request.resource.data.get('quantity', 0) != 0;
""",
    """      allow create: if canWriteInventoryCore()
        && request.resource.data.get('operation_id', '') != ''
        && quantityIsNumber(request.resource.data)
        && request.resource.data.get('quantity', 0) != 0
        && ownEmailField(request.resource.data, 'created_by');
""",
    'stock movement create rule',
)

replace_once(
    'firestore.rules',
    """      allow create, update: if (
          request.resource.data.get('last_operation_id', '') != ''
          ? (
            warehouseProcessingOperationOwned(request.resource.data.get('last_operation_id', ''))
            && ownEmailField(request.resource.data, 'updated_by')
          )
          : canWriteInventoryCore()
        )
        && balanceQuantityIsSafe();
""",
    """      allow create, update: if canWriteInventoryCore()
        && request.resource.data.get('last_operation_id', '') != ''
        && ownEmailField(request.resource.data, 'updated_by')
        && balanceQuantityIsSafe();
""",
    'inventory balance write rule',
)

for temporary_path in [
    Path('.github/workflows/finalize-v7.5.yml'),
    Path('.github/workflows/verify-v7.5.yml'),
    Path('.github/workflows/add-v7.5-concurrency-tests.yml'),
    Path('.github/v7.5-final-rules-trigger'),
    Path('.github/v7.5-final-trigger'),
    Path('v7.5-final-tests-error.log'),
    Path('v7.5-rules-error.log'),
]:
    temporary_path.unlink(missing_ok=True)

print('Đã hoàn thiện operation state guard, tinh gọn stock rules và dọn workflow tạm V7.5.')
