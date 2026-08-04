import assert from 'node:assert/strict';
import test from 'node:test';

import { isVisibleFirestoreDocument } from '../scripts/export-firestore-visible.mjs';

function document(fields = {}) {
  return { fields };
}

test('giữ document active và chưa xóa', () => {
  assert.equal(isVisibleFirestoreDocument(document({
    active: { booleanValue: true },
    deleted: { booleanValue: false },
    status: { stringValue: 'confirmed' },
  })), true);
});

test('giữ document legacy thiếu active và deleted', () => {
  assert.equal(isVisibleFirestoreDocument(document({
    status: { stringValue: 'confirmed' },
  })), true);
});

test('loại deleted true ở các biến thể field', () => {
  for (const field of ['deleted', 'isDeleted', 'is_deleted']) {
    assert.equal(isVisibleFirestoreDocument(document({
      [field]: { booleanValue: true },
    })), false);
  }
});

test('loại active false ở các biến thể field', () => {
  for (const field of ['active', 'isActive', 'is_active']) {
    assert.equal(isVisibleFirestoreDocument(document({
      [field]: { booleanValue: false },
    })), false);
  }
});

test('loại các trạng thái không còn hiển thị', () => {
  for (const status of ['deleted', 'inactive', 'Đã xóa', 'Ngừng hoạt động']) {
    assert.equal(isVisibleFirestoreDocument(document({
      status: { stringValue: status },
    })), false);
  }
});

test('không loại trạng thái nghiệp vụ hợp lệ như cancelled', () => {
  assert.equal(isVisibleFirestoreDocument(document({
    active: { booleanValue: true },
    deleted: { booleanValue: false },
    status: { stringValue: 'cancelled' },
  })), true);
});
