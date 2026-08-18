# Warehouse lifecycle release checklist

The warehouse lifecycle client and Firestore Rules must be released together. The
client must never be promoted while the previous Rules version is still active.

## Automated verification

Run the focused client and emulator suite:

```bash
npm run test:warehouse-lifecycle
```

Then run the full regression suite and production generation:

```bash
npm run test:rules
npm run generate
git diff --check
```

The focused suite covers canonical lifecycle transitions, external releases and
cancellation, request siblings, warehouse-only snapshots, deterministic release
identifiers, and the paired Firestore writes enforced by Rules.

Run the read-only production data audit with a service account that has Datastore
read access:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/secure/service-account.json npm run audit:warehouse-lifecycle
```

The audit never writes data. It exits with code `2` when it finds lifecycle/status
mismatches, missing document links or items, cancelled exports that remain linked,
operations stuck in `processing`, or stale order summaries.

## Safe production release

Authenticate the current Firebase CLI identity and verify that the active project
is `orderfirestore-501909`. The repository's `.firebaserc` already selects that
project. Then run:

```bash
npm run deploy:warehouse-lifecycle
```

This command deliberately performs the release in this order:

1. Generate the static client.
2. Deploy `firestore:rules` and stop immediately if that fails.
3. Deploy Hosting only after the Rules deployment succeeds.

Do not replace the command with a Hosting-only deploy. If Rules deployment returns
`503 UNAVAILABLE`, leave Hosting unchanged and retry the same command after the
Firebase API recovers.

## Post-deployment smoke test

With a warehouse-only account, verify `/warehouse-export-requests` in production:

1. Accept and reject a request, including a request reopened after cancellation.
2. Release one request from an order that has a pending or accepted sibling.
3. Record an external release and cancel it; confirm no stock balance or movement
   changes.
4. Cancel a normal release and confirm its lot allocations are restored.
5. Retry an already completed action and confirm that it does not create another
   export document or notification.
6. Confirm the order summary is reconciled from every request for the order.

If notification or order-summary reconciliation reports a warning, verify that the
core request/export transaction remains committed and use the operation identifier
from the diagnostic log for follow-up.

## Current environment audit (2026-08-17)

- Commit under review: `28fd233` (`fix warehouse export lifecycle consistency`).
- Focused client/static suite: 40 tests passed.
- Remote Firebase deployment could not be performed from the handoff container:
  it has no authorized Firebase account, and package/emulator downloads are denied
  by the environment network policy.
- No Hosting deployment was attempted, so the safety ordering above was preserved.
