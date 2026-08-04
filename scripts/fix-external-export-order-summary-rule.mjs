import { readFileSync, writeFileSync, rmSync } from 'node:fs'

const path = 'firestore.rules'
let source = readFileSync(path, 'utf8')
const marker = '    function exportRequestExternalReleaseAllowed(requestId) {'
if (!source.includes(marker)) throw new Error('Không tìm thấy external release rule.')
if (source.includes('function externalReleaseOrderSummaryMatches()')) {
  throw new Error('Helper externalReleaseOrderSummaryMatches đã tồn tại.')
}

const helper = `    function externalReleaseOrderSummaryMatches() {
      let orderId = resource.data.get('order_id', '');
      let path = orderPath(orderId);
      return orderId is string
        && orderId != ''
        && exists(path)
        && existsAfter(path)
        && getAfter(path).data.get('warehouse_request_status', '') == 'da_xuat'
        && getAfter(path).data.get('warehouse_fulfillment_status', '') in ['da_xuat_1_phan', 'da_xuat_du']
        && getAfter(path).data.get('updated_at', null) is timestamp
        && getAfter(path).data.get('updated_at', null) == request.time;
    }

`

source = source.replace(marker, helper + marker)
writeFileSync(path, source, 'utf8')
rmSync('.github/workflows/fix-external-export-order-summary-rule.yml', { force: true })
rmSync('scripts/fix-external-export-order-summary-rule.mjs', { force: true })
console.log('External export order summary helper added.')
