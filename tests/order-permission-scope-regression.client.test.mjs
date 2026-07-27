import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolveOrderOwnershipForSave } from '../utils/orderAtomicSave.mjs'

// Legacy orders may legitimately keep blank ownership fields. Editing must not
// replace those immutable values with the current admin or Sale email.
test('sửa order giữ nguyên tuyệt đối ownership legacy, kể cả field trống', () => {
  const ownership = resolveOrderOwnershipForSave({
    mode: 'edit',
    persistedOrder: {
      owner_email: '',
      created_by: 'sale@example.com',
      sale_email: '',
    },
    requestedOwnership: {
      ownerEmail: 'admin@example.com',
      createdBy: 'admin@example.com',
      saleEmail: 'admin@example.com',
    },
  })
  assert.deepEqual(ownership, {
    ownerEmail: '',
    createdBy: 'sale@example.com',
    saleEmail: '',
  })
})

test('tạo order mới giữ ownership do client đã xác thực', () => {
  const ownership = resolveOrderOwnershipForSave({
    mode: 'create',
    persistedOrder: {},
    requestedOwnership: {
      ownerEmail: 'creator@example.com',
      createdBy: 'creator@example.com',
      saleEmail: 'sale@example.com',
    },
  })
  assert.deepEqual(ownership, {
    ownerEmail: 'creator@example.com',
    createdBy: 'creator@example.com',
    saleEmail: 'sale@example.com',
  })
})

test('atomic save ghi đè ownership edit bằng dữ liệu persisted trước khi ghi order, invoice và items', () => {
  const source = readFileSync('composables/useAtomicOrderSave.ts', 'utf8')
  assert.match(source, /resolveOrderOwnershipForSave/)
  assert.match(source, /persistedOrder: existingOrder/)
  assert.match(source, /owner_email: effectiveOwnership\.ownerEmail/)
  assert.match(source, /order_owner_email: effectiveOwnership\.ownerEmail/)
  assert.match(source, /created_by: effectiveOwnership\.createdBy/)
  assert.match(source, /sale_email: effectiveOwnership\.saleEmail/)
})
