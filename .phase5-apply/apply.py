from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_count(text: str, old: str, new: str, expected: int, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{label}: expected {expected} matches, found {count}")
    return text.replace(old, new)


old_notification_helpers = """    function notificationAudienceMatches(data) {
      return data.get('audience', '') == 'warehouse_export'
        && hasPerm('page.warehouse_export_requests')
        && hasAnyPerm([
          'export_requests.accept',
          'export_requests.reject',
          'export_requests.release',
          'export_requests.process'
        ]);
    }

    function notificationCreateTargetIsValid() {
      let directEmail = request.resource.data.get('to_email', '');
      let audience = request.resource.data.get('audience', '');
      return (
          directEmail is string
          && directEmail != ''
        )
        || (
          audience == 'warehouse_export'
          && hasPerm('orders.warehouse_export')
        );
    }
"""

new_notification_helpers = """    function notificationAudienceMatches(data) {
      return data.get('audience', '') == 'warehouse_export'
        && hasPerm('page.warehouse_export_requests')
        && hasAnyPerm([
          'export_requests.accept',
          'export_requests.reject',
          'export_requests.release',
          'export_requests.process'
        ]);
    }

    function validBoundedString(value, minSize, maxSize) {
      return value is string
        && value.size() >= minSize
        && value.size() <= maxSize;
    }

    function validActivityLogCreate(data) {
      return activeUser()
        && data.keys().hasAll(['module', 'action', 'changed_by', 'created_at'])
        && data.keys().hasOnly([
          'module', 'action', 'item_code', 'item_name', 'changed_by',
          'before_json', 'after_json', 'operation_id',
          'permission_schema_version', 'created_at', 'active', 'deleted'
        ])
        && validBoundedString(data.get('module', ''), 1, 80)
        && data.get('module', '').matches('^[A-Za-z0-9_]{1,80}$')
        && validBoundedString(data.get('action', ''), 1, 80)
        && data.get('action', '').matches('^[A-Za-z0-9_]{1,80}$')
        && validBoundedString(data.get('changed_by', ''), 3, 254)
        && data.get('changed_by', '').lower() == email()
        && data.get('created_at', null) is timestamp
        && data.get('created_at', null) == request.time
        && data.get('item_code', '') is string
        && data.get('item_code', '').size() <= 200
        && data.get('item_name', '') is string
        && data.get('item_name', '').size() <= 500
        && data.get('operation_id', '') is string
        && data.get('operation_id', '').size() <= 500
        && data.get('before_json', '') is string
        && data.get('before_json', '').size() <= 100000
        && data.get('after_json', '') is string
        && data.get('after_json', '').size() <= 100000
        && data.get('permission_schema_version', 0) is int
        && data.get('permission_schema_version', 0) >= 0
        && data.get('permission_schema_version', 0) <= 1000
        && data.get('active', true) == true
        && data.get('deleted', false) == false;
    }

    function notificationRequestPath(data) {
      return /databases/$(database)/documents/order_export_requests/$(data.get('entity_id', ''));
    }

    function notificationIsAudienceType(data) {
      return data.get('type', '') in [
        'warehouse_export_request_created',
        'warehouse_export_request_updated'
      ];
    }

    function notificationIsDirectType(data) {
      return data.get('type', '') in [
        'warehouse_export_request_accepted',
        'warehouse_export_request_rejected',
        'warehouse_export_request_released',
        'warehouse_export_request_cancelled'
      ];
    }

    function notificationAudiencePermissionListIsValid(data) {
      let permissions = data.get('audience_permissions', []);
      return permissions is list
        && permissions.size() == 4
        && permissions.hasAll([
          'export_requests.accept',
          'export_requests.reject',
          'export_requests.release',
          'export_requests.process'
        ]);
    }

    function notificationCommonPayloadIsValid(data) {
      let type = data.get('type', '');
      let route = data.get('route', '');
      let targetEmail = data.get('to_email', '');
      return data.keys().hasAll([
          'type', 'title', 'message', 'route', 'entity_collection',
          'entity_id', 'created_by', 'to_email', 'audience',
          'audience_permissions', 'metadata_json', 'status', 'read',
          'active', 'deleted', 'created_at', 'updated_at'
        ])
        && data.keys().hasOnly([
          'type', 'title', 'message', 'route', 'entity_collection',
          'entity_id', 'entity_code', 'created_by', 'to_email', 'audience',
          'audience_permissions', 'metadata_json', 'status', 'read',
          'active', 'deleted', 'created_at', 'updated_at'
        ])
        && (notificationIsAudienceType(data) || notificationIsDirectType(data))
        && validBoundedString(data.get('title', ''), 1, 200)
        && validBoundedString(data.get('message', ''), 1, 2000)
        && data.get('entity_collection', '') == 'order_export_requests'
        && validBoundedString(data.get('entity_id', ''), 1, 200)
        && data.get('entity_id', '').matches('^[A-Za-z0-9._:-]{1,200}$')
        && data.get('entity_code', '') is string
        && data.get('entity_code', '').size() <= 200
        && validBoundedString(data.get('created_by', ''), 3, 254)
        && data.get('created_by', '').lower() == email()
        && targetEmail is string
        && targetEmail.size() <= 254
        && (targetEmail == '' || targetEmail == targetEmail.lower())
        && data.get('audience', '') is string
        && data.get('audience', '').size() <= 80
        && data.get('metadata_json', '') is string
        && data.get('metadata_json', '').size() <= 20000
        && data.get('status', '') == 'unread'
        && data.get('read', true) == false
        && data.get('active', false) == true
        && data.get('deleted', true) == false
        && data.get('created_at', null) is timestamp
        && data.get('created_at', null) == request.time
        && data.get('updated_at', null) is timestamp
        && data.get('updated_at', null) == request.time
        && (
          (
            notificationIsAudienceType(data)
            && route == '/warehouse-export-requests'
            && targetEmail == ''
            && data.get('audience', '') == 'warehouse_export'
            && notificationAudiencePermissionListIsValid(data)
          )
          || (
            notificationIsDirectType(data)
            && route == '/export-requests'
            && targetEmail != ''
            && data.get('audience', '') == ''
            && data.get('audience_permissions', []) is list
            && data.get('audience_permissions', []).size() == 0
          )
        );
    }

    function notificationRecipientMatchesRequest(data, requestData) {
      let targetEmail = data.get('to_email', '').lower();
      return targetEmail != ''
        && (
          requestData.get('requested_by', '') is string
          && requestData.get('requested_by', '').lower() == targetEmail
          || requestData.get('created_by', '') is string
          && requestData.get('created_by', '').lower() == targetEmail
          || requestData.get('order_sale_email', '') is string
          && requestData.get('order_sale_email', '').lower() == targetEmail
          || requestData.get('order_created_by', '') is string
          && requestData.get('order_created_by', '').lower() == targetEmail
          || requestData.get('order_owner_email', '') is string
          && requestData.get('order_owner_email', '').lower() == targetEmail
        );
    }

    function notificationAudienceCreatorMatches(data, requestData) {
      return (
          data.get('type', '') == 'warehouse_export_request_created'
          && requestData.get('requested_by', '') is string
          && requestData.get('requested_by', '').lower() == email()
        )
        || (
          data.get('type', '') == 'warehouse_export_request_updated'
          && requestData.get('updated_by', '') is string
          && requestData.get('updated_by', '').lower() == email()
        );
    }

    function notificationDirectCreatorMatches(data, requestData) {
      let type = data.get('type', '');
      let status = requestData.get('status', '');
      return requestData.get('warehouse_handled_by', '') is string
        && requestData.get('warehouse_handled_by', '').lower() == email()
        && (
          type == 'warehouse_export_request_accepted'
          && status in ['da_tiep_nhan', 'cho_xuat_kho']
          || type == 'warehouse_export_request_rejected'
          && status == 'tu_choi'
          || type == 'warehouse_export_request_released'
          && status == 'da_xuat'
          && requestData.get('lifecycle_status', '') == 'released'
          || type == 'warehouse_export_request_cancelled'
          && status in ['da_tiep_nhan', 'cho_xuat_kho']
          && requestData.get('lifecycle_status', '') == 'release_cancelled'
        );
    }

    function notificationCreatorPermissionIsValid(data) {
      let type = data.get('type', '');
      return (
          notificationIsAudienceType(data)
          && hasPerm('orders.warehouse_export')
        )
        || (
          type == 'warehouse_export_request_accepted'
          && hasAnyPerm(['export_requests.accept', 'export_requests.process'])
        )
        || (
          type == 'warehouse_export_request_rejected'
          && hasAnyPerm(['export_requests.reject', 'export_requests.process'])
        )
        || (
          type in [
            'warehouse_export_request_released',
            'warehouse_export_request_cancelled'
          ]
          && hasAnyPerm(['export_requests.release', 'export_requests.process'])
        );
    }

    function notificationCreateTargetIsValid(data) {
      let path = notificationRequestPath(data);
      return existsAfter(path)
        && notificationCreatorPermissionIsValid(data)
        && (
          notificationIsAudienceType(data)
          && notificationAudienceCreatorMatches(data, getAfter(path).data)
          || notificationIsDirectType(data)
          && notificationDirectCreatorMatches(data, getAfter(path).data)
          && notificationRecipientMatchesRequest(data, getAfter(path).data)
        );
    }

    function validNotificationCreate(data) {
      return activeUser()
        && notificationCommonPayloadIsValid(data)
        && notificationCreateTargetIsValid(data);
    }

    function validNotificationReadUpdate() {
      let changed = request.resource.data.diff(resource.data).affectedKeys();
      return changed.size() > 0
        && changed.hasOnly([
          'read', 'is_read', 'read_at', 'seen', 'seen_at', 'status', 'updated_at'
        ])
        && (
          !changed.hasAny(['read'])
          || request.resource.data.get('read', false) is bool
          && request.resource.data.get('read', false) == true
        )
        && (
          !changed.hasAny(['is_read'])
          || request.resource.data.get('is_read', false) is bool
          && request.resource.data.get('is_read', false) == true
        )
        && (
          !changed.hasAny(['seen'])
          || request.resource.data.get('seen', false) is bool
          && request.resource.data.get('seen', false) == true
        )
        && (
          !changed.hasAny(['status'])
          || request.resource.data.get('status', '') in ['read', 'seen']
        )
        && (
          !changed.hasAny(['read_at'])
          || request.resource.data.get('read_at', null) is timestamp
          && request.resource.data.get('read_at', null) == request.time
        )
        && (
          !changed.hasAny(['seen_at'])
          || request.resource.data.get('seen_at', null) is timestamp
          && request.resource.data.get('seen_at', null) == request.time
        )
        && (
          !changed.hasAny(['updated_at'])
          || request.resource.data.get('updated_at', null) is timestamp
          && request.resource.data.get('updated_at', null) == request.time
        );
    }
"""

old_matches = """    match /activity_logs/{docId} {
      allow read: if hasPerm('activity_logs.view');

      // Rules can guarantee the authenticated actor email. A fully tamper-
      // proof audit trail still requires a trusted backend trigger.
      allow create: if signedIn()
        && ownEmailField(request.resource.data, 'changed_by');

      allow update, delete: if isAdmin();
    }

    match /notifications/{docId} {
      allow read: if isAdmin()
        || (
          activeUser()
          && (
            ownEmailField(resource.data, 'to_email')
            || notificationAudienceMatches(resource.data)
          )
        );

      allow create: if activeUser()
        && ownEmailField(request.resource.data, 'created_by')
        && notificationCreateTargetIsValid();

      // Direct recipients may still update legacy read fields. Broadcast
      // notifications use notification_reads so each warehouse user has an
      // independent read state.
      allow update: if isAdmin()
        || (
          activeUser()
          && ownEmailField(resource.data, 'to_email')
          && unchanged(['to_email', 'audience', 'audience_permissions', 'created_by', 'created_at'])
          && onlyChanged([
            'read',
            'is_read',
            'read_at',
            'seen',
            'seen_at',
            'status',
            'updated_at'
          ])
        );

      allow delete: if isAdmin();
    }
"""

new_matches = """    match /activity_logs/{docId} {
      allow read: if hasPerm('activity_logs.view');

      // Client-side logs are append-only and actor/time-bound. They improve
      // traceability but are not a substitute for a trusted backend audit log.
      allow create: if validActivityLogCreate(request.resource.data);
      allow update, delete: if false;
    }

    match /notifications/{docId} {
      allow read: if isAdmin()
        || (
          activeUser()
          && (
            ownEmailField(resource.data, 'to_email')
            || notificationAudienceMatches(resource.data)
          )
        );

      allow create: if validNotificationCreate(request.resource.data);

      // The recipient (or an active admin) may only move read/seen state
      // forward. Recipient, sender, type, route and entity remain immutable.
      allow update: if activeUser()
        && (isAdmin() || ownEmailField(resource.data, 'to_email'))
        && validNotificationReadUpdate();

      allow delete: if isAdmin();
    }
"""

rules = read("firestore.rules")
rules = replace_once(rules, old_notification_helpers, new_notification_helpers, "firestore helper block")
rules = replace_once(rules, old_matches, new_matches, "firestore match block")
write("firestore.rules", rules)

notifications = read("composables/useNotifications.ts")
constants_anchor = """export const WAREHOUSE_NOTIFICATION_PERMISSIONS = [
  'export_requests.accept',
  'export_requests.reject',
  'export_requests.release',
  'export_requests.process',
]
"""
constants_replacement = constants_anchor + """
export const WAREHOUSE_NOTIFICATION_TYPES = [
  'warehouse_export_request_created',
  'warehouse_export_request_updated',
  'warehouse_export_request_accepted',
  'warehouse_export_request_rejected',
  'warehouse_export_request_released',
  'warehouse_export_request_cancelled',
] as const

const AUDIENCE_NOTIFICATION_TYPES = new Set([
  'warehouse_export_request_created',
  'warehouse_export_request_updated',
])
const DIRECT_NOTIFICATION_TYPES = new Set([
  'warehouse_export_request_accepted',
  'warehouse_export_request_rejected',
  'warehouse_export_request_released',
  'warehouse_export_request_cancelled',
])
const NOTIFICATION_ENTITY_COLLECTION = 'order_export_requests'
const AUDIENCE_ROUTE = '/warehouse-export-requests'
const DIRECT_ROUTE = '/export-requests'
const MAX_NOTIFICATION_METADATA_LENGTH = 20_000

function boundedNotificationText(value: any, label: string, maxLength: number) {
  const text = String(value || '').trim()
  if (!text) throw new Error(`${label} không được để trống.`)
  if (text.length > maxLength) throw new Error(`${label} vượt quá ${maxLength} ký tự.`)
  return text
}

function exactWarehousePermissions(value: string[]) {
  const permissions = Array.from(new Set(value.filter(Boolean)))
  return permissions.length === WAREHOUSE_NOTIFICATION_PERMISSIONS.length
    && WAREHOUSE_NOTIFICATION_PERMISSIONS.every(permission => permissions.includes(permission))
}
"""
notifications = replace_once(notifications, constants_anchor, constants_replacement, "notification constants")
old_builder = """export function buildNotificationPayload(input: NotificationPayloadInput) {
  return {
    type: input.type,
    title: input.title,
    message: input.message,
    route: input.route || '',
    entity_collection: input.entity_collection || '',
    entity_id: input.entity_id || '',
    entity_code: input.entity_code || '',
    created_by: normalizeEmail(input.created_by),
    to_email: normalizeEmail(input.to_email || ''),
    audience: String(input.audience || '').trim(),
    audience_permissions: Array.from(new Set((input.audience_permissions || []).filter(Boolean))),
    metadata_json: JSON.stringify(input.metadata || {}),
    status: 'unread',
    read: false,
    active: true,
    deleted: false,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }
}
"""
new_builder = """export function buildNotificationPayload(input: NotificationPayloadInput) {
  const type = String(input.type || '').trim()
  const audienceType = AUDIENCE_NOTIFICATION_TYPES.has(type)
  const directType = DIRECT_NOTIFICATION_TYPES.has(type)
  if (!audienceType && !directType) throw new Error('Loại thông báo không được phép.')

  const title = boundedNotificationText(input.title, 'Tiêu đề thông báo', 200)
  const message = boundedNotificationText(input.message, 'Nội dung thông báo', 2_000)
  const route = String(input.route || '').trim()
  const entityCollection = String(input.entity_collection || '').trim()
  const entityId = String(input.entity_id || '').trim()
  const entityCode = String(input.entity_code || '').trim()
  const createdBy = normalizeEmail(input.created_by)
  const toEmail = normalizeEmail(input.to_email || '')
  const audience = String(input.audience || '').trim()
  const audiencePermissions = Array.from(new Set((input.audience_permissions || []).filter(Boolean)))

  if (!createdBy) throw new Error('Không xác định được người tạo thông báo.')
  if (entityCollection !== NOTIFICATION_ENTITY_COLLECTION) throw new Error('Collection đích của thông báo không hợp lệ.')
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(entityId)) throw new Error('ID đối tượng của thông báo không hợp lệ.')
  if (entityCode.length > 200) throw new Error('Mã đối tượng của thông báo quá dài.')

  if (audienceType) {
    if (route !== AUDIENCE_ROUTE) throw new Error('Route thông báo tới Kho không hợp lệ.')
    if (toEmail) throw new Error('Thông báo audience không được chỉ định recipient trực tiếp.')
    if (audience !== 'warehouse_export') throw new Error('Audience thông báo không hợp lệ.')
    if (!exactWarehousePermissions(audiencePermissions)) throw new Error('Danh sách quyền audience không hợp lệ.')
  }

  if (directType) {
    if (route !== DIRECT_ROUTE) throw new Error('Route thông báo tới Sale không hợp lệ.')
    if (!toEmail) throw new Error('Thông báo trực tiếp phải có recipient.')
    if (audience || audiencePermissions.length) throw new Error('Thông báo trực tiếp không được chứa audience.')
  }

  let metadataJson = '{}'
  try {
    metadataJson = JSON.stringify(input.metadata || {})
  } catch {
    throw new Error('Metadata thông báo không thể chuyển thành JSON.')
  }
  if (metadataJson.length > MAX_NOTIFICATION_METADATA_LENGTH) {
    throw new Error('Metadata thông báo vượt giới hạn cho phép.')
  }

  return {
    type,
    title,
    message,
    route,
    entity_collection: entityCollection,
    entity_id: entityId,
    entity_code: entityCode,
    created_by: createdBy,
    to_email: toEmail,
    audience,
    audience_permissions: audiencePermissions,
    metadata_json: metadataJson,
    status: 'unread',
    read: false,
    active: true,
    deleted: false,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }
}
"""
notifications = replace_once(notifications, old_builder, new_builder, "notification payload builder")
write("composables/useNotifications.ts", notifications)

repo = read("composables/useRepo.ts")
repo_anchor = """type SaveOptions = {
  isCreate?: boolean
  log?: boolean
}

"""
repo_replacement = repo_anchor + """const MAX_ACTIVITY_JSON_LENGTH = 100_000

function serializeActivityJson(value: any) {
  let serialized: string
  try {
    serialized = JSON.stringify(value || {})
  } catch {
    throw new Error('Dữ liệu Activity Log không thể chuyển thành JSON.')
  }
  if (serialized.length > MAX_ACTIVITY_JSON_LENGTH) {
    throw new Error('Dữ liệu Activity Log vượt giới hạn 100.000 ký tự.')
  }
  return serialized
}

"""
repo = replace_once(repo, repo_anchor, repo_replacement, "activity serializer")
repo = replace_once(repo, "      after_json: JSON.stringify(after || {}),", "      after_json: serializeActivityJson(after),", "activity serializer usage")
write("composables/useRepo.ts", repo)

# Align existing emulator fixtures with server-timestamp and exact audience rules.
path = "tests/firestore.rules.test.mjs"
text = read(path)
text = replace_once(text, "  query,\n  setDoc,", "  query,\n  serverTimestamp,\n  setDoc,", f"{path} import")
text = replace_count(
    text,
    "    created_at: 'now',\n    active: true,\n    deleted: false\n  })",
    "    created_at: serverTimestamp(),\n    active: true,\n    deleted: false\n  })",
    2,
    f"{path} activity timestamps",
)
write(path, text)

path = "tests/customer-create-flow.test.mjs"
text = read(path)
text = replace_once(text, "  runTransaction,\n  setDoc", "  runTransaction,\n  serverTimestamp,\n  setDoc", f"{path} import")
text = replace_once(
    text,
    "      changed_by: CREATOR,\n      active: true,\n      deleted: false,\n      created_at: 'now'",
    "      changed_by: CREATOR,\n      active: true,\n      deleted: false,\n      created_at: serverTimestamp()",
    f"{path} activity timestamp",
)
write(path, text)

path = "tests/order-items-by-order.rules.test.mjs"
text = read(path)
text = replace_once(text, "  query,\n  setDoc,", "  query,\n  serverTimestamp,\n  setDoc,", f"{path} import")
text = replace_once(
    text,
    "    after_json: '{}',\n    created_at: '2026-07-19T06:00:00.000Z',",
    "    after_json: '{}',\n    created_at: serverTimestamp(),",
    f"{path} activity timestamp",
)
text = replace_once(
    text,
    "    audience_permissions: ['export_requests.accept'],",
    "    audience_permissions: [\n      'export_requests.accept',\n      'export_requests.reject',\n      'export_requests.release',\n      'export_requests.process',\n    ],",
    f"{path} audience permissions",
)
text = replace_once(
    text,
    "    created_at: '2026-07-19T06:00:00.000Z',\n    updated_at: '2026-07-19T06:00:00.000Z',\n  })\n\n  await assertSucceeds(batch.commit())",
    "    created_at: serverTimestamp(),\n    updated_at: serverTimestamp(),\n  })\n\n  await assertSucceeds(batch.commit())",
    f"{path} notification timestamps",
)
write(path, text)

path = "tests/order-atomic-save.rules.test.mjs"
text = read(path)
text = replace_once(text, "  runTransaction,\n  setDoc,", "  runTransaction,\n  serverTimestamp,\n  setDoc,", f"{path} import")
text = replace_once(
    text,
    "      operation_id: 'operation-create',\n      active: true,\n      deleted: false,\n      created_at: '2026-07-19T01:00:00.000Z',",
    "      operation_id: 'operation-create',\n      active: true,\n      deleted: false,\n      created_at: serverTimestamp(),",
    f"{path} create activity timestamp",
)
text = replace_once(
    text,
    "      operation_id: 'operation-edit',\n      active: true,\n      deleted: false,\n      created_at: '2026-07-19T02:00:00.000Z',",
    "      operation_id: 'operation-edit',\n      active: true,\n      deleted: false,\n      created_at: serverTimestamp(),",
    f"{path} edit activity timestamp",
)
write(path, text)

package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
rule_script = package["scripts"]["test:rules"]
new_test = "tests/activity-notifications.rules.test.mjs"
if new_test not in rule_script:
    marker = "tests/firestore.rules.test.mjs"
    if marker not in rule_script:
        raise RuntimeError("package.json: test:rules marker missing")
    rule_script = rule_script.replace(marker, f"{marker} {new_test}", 1)
    package["scripts"]["test:rules"] = rule_script
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

security = read("SECURITY_CHANGES.md")
phase5 = """

## Phase 5 - Activity Log and Notification hardening

- `activity_logs.create` now requires an active account, authenticated actor identity, server time, bounded string fields and bounded JSON text fields.
- Client Activity Logs are append-only: client update and delete are denied, including for admins. This remains a client-generated trace and is not an absolute audit trail; a trusted backend is required for that guarantee.
- Direct reads of `activity_logs` require `activity_logs.view` (absolute admins inherit it through the existing permission helper).
- Notification types, routes and `entity_collection` are allowlisted for the existing `order_export_requests` workflow.
- Direct recipients must match the Sale/owner identity stored on the referenced export request; audience notifications are limited to the exact Warehouse permission set.
- Notification creation requires an active creator, a matching business permission and a request state/actor compatible with the notification type.
- Recipients and admins may only advance read/seen fields. Normal users cannot delete notifications; admins retain explicit delete access.
- Firestore emulator tests cover allow/deny cases for disabled and anonymous users, forged actors/recipients, timestamps, payload limits, append-only logs, read permissions, immutable notification fields and role-specific notification creation.
"""
if "## Phase 5 - Activity Log and Notification hardening" not in security:
    security += phase5
write("SECURITY_CHANGES.md", security)

print("Phase 5 source patch applied successfully.")
