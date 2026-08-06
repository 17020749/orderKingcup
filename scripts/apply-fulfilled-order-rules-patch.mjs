import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const rulesPath = path.resolve(process.cwd(), 'firestore.rules')
let source = fs.readFileSync(rulesPath, 'utf8')

const functionMarker = '    function fulfilledOrderMetadataUpdateAllowed() {'
const insertionAnchor = '    function orderWarehouseSummaryUpdateAllowed() {'

const fulfilledFunction = `    function fulfilledOrderMetadataUpdateAllowed() {
      let orderDate = request.resource.data.get('order_date', null);
      return fulfillmentStatus() == 'da_xuat_du'
        && hasPerm('orders.edit')
        && (
          ownsOrderData(resource.data)
          || hasPerm('orders.view_all')
        )
        && orderIdentityUnchanged()
        && changedAny([
          'order_date',
          'order_status'
        ])
        && onlyChanged([
          'order_date',
          'order_status',
          'revision',
          'last_operation_id',
          'updated_at'
        ])
        && (
          orderDate is timestamp
          || (
            orderDate is string
            && orderDate.size() >= 1
            && orderDate.size() <= 40
          )
        )
        && validBoundedString(
          request.resource.data.get('order_status', ''),
          1,
          200
        )
        && request.resource.data.get('revision', -1) is int
        && request.resource.data.get('revision', -1)
          == resource.data.get('revision', 0) + 1
        && validBoundedString(
          request.resource.data.get('last_operation_id', ''),
          1,
          200
        )
        && request.resource.data.get('updated_at', null) is timestamp
        && request.resource.data.get('updated_at', null) == request.time;
    }

`

if (!source.includes(functionMarker)) {
  if (!source.includes(insertionAnchor)) {
    throw new Error('Không tìm thấy vị trí chèn fulfilledOrderMetadataUpdateAllowed().')
  }
  source = source.replace(insertionAnchor, `${fulfilledFunction}${insertionAnchor}`)
}

const originalBranch = `              : (
                hasPerm('orders.edit')
                && (ownsOrderData(resource.data) || hasPerm('orders.view_all'))
                && orderIdentityUnchanged()
                && normalOrderEditKeepsSystemFields()
                && fulfillmentStatus() != 'da_xuat_du'
              );`

const patchedBranch = `              : (
                fulfilledOrderMetadataUpdateAllowed()
                || (
                  hasPerm('orders.edit')
                  && (ownsOrderData(resource.data) || hasPerm('orders.view_all'))
                  && orderIdentityUnchanged()
                  && normalOrderEditKeepsSystemFields()
                  && fulfillmentStatus() != 'da_xuat_du'
                )
              );`

if (!source.includes('fulfilledOrderMetadataUpdateAllowed()\n                || (')) {
  if (!source.includes(originalBranch)) {
    throw new Error('Không tìm thấy nhánh cập nhật orders cần vá.')
  }
  source = source.replace(originalBranch, patchedBranch)
}

fs.writeFileSync(rulesPath, source)
console.log('Đã áp dụng ngoại lệ sửa metadata cho đơn xuất đủ.')
