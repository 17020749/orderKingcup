# Runtime export and relation sync repair

Scope:

- Restore the cost-aware `cancelExportRequestRelease` runtime function.
- Preserve lot allocations while reversing stock.
- Restore Step 8 release lifecycle fields in the cost-aware path.
- Allow absolute admins to reconcile relation locks with a narrow Rules branch.
- Do not change printing reconciliation behavior.
- Do not loosen normal order edit rules.
