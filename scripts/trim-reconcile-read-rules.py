from pathlib import Path

path = Path('firestore.rules')
source = path.read_text(encoding='utf-8')
replacements = [
    (
        """    match /orders/{docId} {
      allow read: if isAdmin()
        || hasPerm('orders.view_all')
""",
        """    match /orders/{docId} {
      allow read: if hasPerm('orders.view_all')
""",
    ),
    (
        """    match /payments/{docId} {
      allow read: if isAdmin()
        || hasPerm('payments.view_all')
""",
        """    match /payments/{docId} {
      allow read: if hasPerm('payments.view_all')
""",
    ),
]
for old, new in replacements:
    if old not in source:
        raise SystemExit(f'Missing target: {old!r}')
    source = source.replace(old, new, 1)
path.write_text(source, encoding='utf-8')
print('Removed redundant admin read branches')
