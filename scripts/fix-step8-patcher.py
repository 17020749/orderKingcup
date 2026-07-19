from pathlib import Path

path = Path('scripts/apply-step8-export-lifecycle.py')
source = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global source
    if old not in source:
        raise SystemExit(f'Missing fix target: {old[:140]!r}')
    source = source.replace(old, new, 1)


def replace_nth(old: str, new: str, occurrence: int) -> None:
    global source
    start = -1
    for _ in range(occurrence):
        start = source.find(old, start + 1)
        if start < 0:
            raise SystemExit(f'Missing fix target occurrence {occurrence}: {old[:140]!r}')
    source = source[:start] + new + source[start + len(old):]


replace_once(
    "import { canCancelExportRequestRelease } from '~/utils/exportLifecycle.mjs'",
    "import { canCancelExportRequestRelease, canReleaseExportRequest } from '~/utils/exportLifecycle.mjs'",
)

# The old and replacement UI snippets contain the same function text. Only
# rewrite the replacement (second occurrence), otherwise the patcher would look
# for code that is not present in the original Vue page.
old_release_function = """function canReleaseRequest(row: any) {
  return canReleaseAction.value && !requestHasExported(row)
    && ['da_tiep_nhan', 'cho_xuat_kho', 'loi'].includes(String(row.status || ''))
}"""
new_release_function = """function canReleaseRequest(row: any) {
  return canReleaseAction.value && canReleaseExportRequest(row) && !requestHasExported(row)
}"""
replace_nth(old_release_function, new_release_function, 2)

replacements = [
    (
        """    function generatedExportCreateMatchesRequest(exportOrderId) {
""",
        """    function manualExportOrderAfterById(exportOrderId) {
      let path = exportOrderPath(exportOrderId);
      return exportOrderId is string
        && exportOrderId != ''
        && existsAfter(path)
        && manualExportOrderData(getAfter(path).data);
    }

    function generatedExportCancelOnly() {
      return onlyChanged([
        'lifecycle_status', 'deleted', 'active', 'status', 'deleted_at',
        'deleted_by', 'deleted_reason', 'cancelled_at', 'cancelled_by',
        'cancel_reason', 'updated_by', 'operation_id', 'last_operation_id',
        'revision', 'updated_at'
      ]);
    }

    function generatedExportCreateMatchesRequest(exportOrderId) {
""",
    ),
    (
        """        && getAfter(path).data.get('release_sequence', 0) == request.resource.data.get('release_sequence', -1)
        && getAfter(path).data.get('operation_id', '') == request.resource.data.get('request_operation_id', '');
""",
        """        && getAfter(path).data.get('release_sequence', 0) == request.resource.data.get('release_sequence', -1)
        && request.resource.data.get('source_request_revision', -1) == get(path).data.get('revision', 0)
        && getAfter(path).data.get('operation_id', '') == request.resource.data.get('request_operation_id', '');
""",
    ),
    (
        """        && warehouseSoftDeleteOnly()
        && request.resource.data.get('lifecycle_status', '') == 'cancelled'
""",
        """        && generatedExportCancelOnly()
        && request.resource.data.get('lifecycle_status', '') == 'cancelled'
        && request.resource.data.get('revision', -1) == resource.data.get('revision', 0) + 1
""",
    ),
    (
        """        && warehouseSoftDeleteOnly()
        && exists(path)
""",
        """        && warehouseSoftDeleteOnly()
        && request.resource.data.get('revision', -1) == resource.data.get('revision', 0) + 1
        && exists(path)
""",
    ),
    (
        """    function exportRequestReleaseLinkValid() {
""",
        """    function exportRequestReleaseLinkValid(requestId) {
""",
    ),
    (
        """        && getAfter(path).data.get('source_request_id', '') == docId
""",
        """        && getAfter(path).data.get('source_request_id', '') == requestId
""",
    ),
    (
        """        && request.resource.data.get('release_sequence', 0) == resource.data.get('release_sequence', 0) + 1
""",
        """        && request.resource.data.get('release_sequence', 0) == resource.data.get('release_sequence', 0) + 1
        && request.resource.data.get('revision', -1) == resource.data.get('revision', 0) + 1
""",
    ),
    (
        """    function exportRequestCancelLinkValid() {
""",
        """    function exportRequestCancelLinkValid(requestId) {
""",
    ),
    (
        """        && request.resource.data.get('release_sequence', -1) == resource.data.get('release_sequence', -2)
""",
        """        && request.resource.data.get('release_sequence', -1) == resource.data.get('release_sequence', -2)
        && request.resource.data.get('revision', -1) == resource.data.get('revision', 0) + 1
""",
    ),
    (
        """            && exportRequestReleaseLinkValid()
""",
        """            && exportRequestReleaseLinkValid(docId)
""",
    ),
    (
        """            && exportRequestCancelLinkValid()
""",
        """            && exportRequestCancelLinkValid(docId)
""",
    ),
    (
        """            && manualExportOrderById(request.resource.data.export_order_id)
""",
        """            && manualExportOrderAfterById(request.resource.data.export_order_id)
""",
    ),
]

for old, new in replacements:
    replace_once(old, new)

path.write_text(source, encoding='utf-8')
print('Step 8 patcher fixes applied')
