from pathlib import Path

path = Path('tests/warehouse.transactions.test.mjs')
text = path.read_text(encoding='utf-8')
old = """  runTransaction,
  setDoc
"""
new = """  runTransaction,
  setDoc,
  updateDoc
"""
if text.count(old) != 1:
    raise SystemExit(f'Firebase import block: cần đúng 1, tìm thấy {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
Path('v7.5-rules-error.log').unlink(missing_ok=True)
print('Đã bổ sung updateDoc cho concurrency test và dọn log tạm.')
