# Invoice amount synchronization – Firestore audit

- Target: Standard Firestore Web SDK (repository `firebase.json` configures `firestore.rules` and the Web SDK is used).
- Read path added: a transaction queries `invoices` by `order_id` only while editing the parent order, then only active invoice records are considered.
- Write path: active invoice `invoice_amount` is written only to the parent order's post-transaction `payable_amount`, with the same operation id and server timestamp.
- Authorization: rule requires `orders.edit`, order ownership or global order view permission, an active parent, immutable child identity/ownership, only `invoice_amount` plus audit fields changed, parent revision advanced exactly once, and equality with parent post-state amount.
- Admin repair: active invoices with missing parent or inactive/deleted parent are skipped and reported; it creates no records.
- Adversarial checks: a standalone invoice amount write, a mismatched amount, a stale operation id, an ownership change, or a non-owner write fail the narrow rule predicates.