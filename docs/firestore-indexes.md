# Firestore index inventory and deployment

## Current query inventory

The source scan covers JavaScript, TypeScript and Vue files outside generated, test and dependency directories.

| Query family | Current constraints | Composite index required |
|---|---|---|
| Activity logs | `orderBy(created_at desc)` + `limit(300)` | No; single-field index |
| Order and printing relationships | `order_id ==/in`, `print_order_id in` | No; single-field indexes |
| Ownership scopes | equality or OR equality on owner/creator/sale fields | No composite index without ordering |
| Notifications and reads | equality on recipient/audience/user fields | No; single-field indexes |
| Generic repository loaders | dynamic constraints, reviewed by caller inventory | Validator reports these as unresolved for review |

At the time of this inventory, the application source does not contain a literal query that requires a new composite index. The 27 existing composite indexes are retained because they may support staging data, administrative queries or planned cursor pagination. This phase does not delete indexes.

## Validation

Run locally:

```bash
npm run test:indexes
```

The validator checks:

- `firebase.json` points to `firestore.indexes.json`.
- JSON structure and supported index options.
- Duplicate index definitions and duplicate field paths.
- Literal Firestore queries that require a composite index are covered.
- Dynamic query calls are listed for explicit review.
- The deployment workflow is manual, project-confirmed and contains no `--force`.

Warehouse CI runs the same validation for pull requests and pushes.

## Deployment workflow

Use **Actions → Firestore Indexes → Run workflow**.

1. Select `staging` first and enter `kingcupmanagerstaging` in `confirm_project_id`.
2. Review the staging deployment and index build state in Firebase Console.
3. For production, select `production` and enter `orderfirestore-501909`.
4. The production job uses the GitHub `production` Environment. Configure required reviewers in repository Environment settings before production use.

The workflow validates the environment service account belongs to the exact selected project and deploys only:

```text
firestore:indexes
```

It never uses `--force` and does not deploy Hosting or Firestore Rules.
