import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  clearGeneratedExportFiles,
  isVisibleFirestoreDocument,
} from '../scripts/export-firestore-visible.mjs';

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
  for (const field of ['status', 'lifecycleStatus', 'lifecycle_status']) {
    for (const status of ['deleted', 'inactive', 'Đã xóa', 'Ngừng hoạt động']) {
      assert.equal(isVisibleFirestoreDocument(document({
        [field]: { stringValue: status },
      })), false);
    }
  }
});

test('không loại trạng thái nghiệp vụ hợp lệ như cancelled', () => {
  assert.equal(isVisibleFirestoreDocument(document({
    active: { booleanValue: true },
    deleted: { booleanValue: false },
    status: { stringValue: 'cancelled' },
  })), true);
});

test('xóa sạch file export cũ nhưng giữ file không liên quan', () => {
  const directory = mkdtempSync(join(tmpdir(), 'firestore-visible-export-'));

  try {
    for (const file of [
      'customers.ndjson',
      'products.ndjson.visible.tmp',
      'firestore-export-manifest.json',
      'visible-export-manifest.json',
      'ghi-chu.txt',
    ]) {
      writeFileSync(join(directory, file), 'test', 'utf8');
    }

    const removed = clearGeneratedExportFiles(directory);

    assert.deepEqual(removed, [
      'customers.ndjson',
      'firestore-export-manifest.json',
      'products.ndjson.visible.tmp',
      'visible-export-manifest.json',
    ]);
    assert.deepEqual(readdirSync(directory), ['ghi-chu.txt']);
    assert.equal(existsSync(join(directory, 'customers.ndjson')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
