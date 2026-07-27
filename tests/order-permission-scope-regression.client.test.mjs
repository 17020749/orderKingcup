import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolveOrderOwnershipForSave } from '../utils/orderAtomicSave.mjs'

test('sửa order giữ nguyên tuyệt đối ownership legacy, kể cả field trống', () => {
  const ownership = resolveOrderOwnershipForSave({
    mode: 'edit',
    persistedOrder: {
      owner_email: '',
      created_by: 'sale@example.com',
      sale_email: '',
    },
    form: {
      owner_email: 'admin@example.com',
      created_by: 'admin@example.com',
      sale_email: 'admin@example.com',
    },
    actor: 'admin@example.com',
  })
  assert.deepEqual(ownership, {
    ownerEmail: '',
    createdBy: 'sale@example.com',
    saleEmail: '',
  })
})

test('tạo order mới vẫn lấy ownership từ form và actor hiện tại', () => {
  const ownership = resolveOrderOwnershipForSave({
    mode: 'create',
    form: { owner_email: '', sale_email: 'sale@example.com' },
    actor: 'creator@example.com',
  })
  assert.deepEqual(ownership, {
    ownerEmail: 'creator@example.com',
    createdBy: 'creator@example.com',
    saleEmail: 'sale@example.com',
  })
})

test('orders page dùng helper ownership thay vì fallback email khi edit', () => {
  const source = readFileSync('pages/orders.vue', 'utf8')
  assert.match(source, /resolveOrderOwnershipForSave/)
  assert.match(source, /persistedOrder: editing\.value \|\| \{\}/)
  assert.doesNotMatch(source, /const ownerEmail = form\.owner_email \|\| appUser\.value\?\.email/)
})

test('payment dependency loader chỉ query parent order thuộc scope khi thiếu payments.view_all', () => {
  const source = readFileSync('composables/useScopedQueries.ts', 'utf8')
  assert.match(source, /const ownedOrderIds = cleanIds\(orders\.filter\(ownsCurrentOrder\)\)/)
  assert.match(source, /if \(!hasPermission\('payments\.view'\)\) return \[\] as PaymentDoc\[\]/)
  assert.match(source, /fetchByFieldValues<PaymentDoc>\('payments', 'order_id', ownedOrderIds\)/)
})

test('printing rules dùng quyền đọc hoặc sửa parent thay vì bắt buộc ownership', () => {
  const rules = readFileSync('firestore.rules', 'utf8')
  assert.match(rules, /hasPerm\('printing\.orders_view'\)[\s\S]*canReadOrderById\(data\.get\('order_id', ''\)\)/)
  assert.match(rules, /hasAnyPerm\(\['orders\.edit', 'orders\.delete'\]\)[\s\S]*canMutateOrderById\(data\.get\('order_id', ''\)\)/)
})
