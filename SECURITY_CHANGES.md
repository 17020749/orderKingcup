# Firestore security hardening

## Baseline used

The revised rules were rebuilt from the original 477-line `firestore.rules`, not from the shortened 279-line draft.

The new file intentionally remains verbose so ownership, immutable fields and exceptional Warehouse operations can be reviewed collection by collection.

## Main protections

- Authenticated identity always comes from `request.auth.token.email`.
- Normal users can only mutate documents they created or documents attached to an order they own/create/sell.
- Child records are authorized from the real parent `/orders/{orderId}` document.
- `order_id`, creator fields, parent ownership fields and creation timestamps are immutable on existing records.
- A client cannot claim its own email in denormalized fields to attach a payment, export request, shipment or invoice to another user's order.
- Hard-delete checks ownership for orders, items, payments, export requests, shipments and invoices.
- Only absolute admins can modify users or roles; `users.manage` alone cannot self-grant `*`, `is_admin` or an admin role.
- Warehouse processors can update only warehouse processing fields, and `warehouse_handled_by` must equal the authenticated email.
- Export-request owners can edit only while the request is in an editable pre-fulfillment state.
- Normal order edits cannot directly overwrite payment summaries, warehouse summaries, invoice state or soft-delete state.
- Activity-log actor identity and notification sender identity must equal the authenticated email.
- Notification recipients can only update read/seen state.
- `cache_manifest` writes are admin-only.

## Compatibility retained

- Active status supports `active: true`, `status: "active"` and `status: "Hoạt động"`.
- Admin detection supports `admin`, `Admin`, `role_admin`, scalar `role`, list `role`, list `roles`, `is_admin` and `permissions_flat: ["*"]`.
- All 19 original collection match blocks remain present.
- `warehouse_export_logs` remains readable by active internal users.
- Order items use their actual ownership fields: `owner_email`, `created_by`, `sale_email`.

## Client alignment

`pages/orders.vue` no longer sends payment, warehouse, invoice or deletion state during a normal order edit. Existing order items also no longer have active/deleted fields rewritten during every edit.

## Verification status

- Nuxt production build: passed.
- Rules test suite: 22 tests prepared.
- Emulator execution was not completed in this environment because the Firestore emulator JAR could not be downloaded from Google Storage.
- Rules were not deployed.

Run locally before deployment:

```bash
npm install
npm run test:rules
npm run build
```

Deploy only after every rules test passes:

```bash
firebase deploy --only firestore:rules
```

## Test runner fix

- Fixed Firestore test imports: `collection` now comes from `firebase/firestore`.
- `@firebase/rules-unit-testing` is used only for `assertFails`, `assertSucceeds`, and `initializeTestEnvironment`.

## V3 - Fix giới hạn biểu thức Firestore Rules

- Tối ưu đọc hồ sơ người dùng: mỗi helper quyền chỉ đọc user document một lần và không còn gọi lồng `hasPerm() -> isAdmin() -> activeUser()`.
- Thêm `hasAnyPerm()` để kiểm tra nhóm quyền mà không đánh giá lại toàn bộ user/admin nhiều lần.
- Tối ưu helper parent order bằng biến `let`, giảm các lần `get()` và biểu thức lặp lại.
- Sửa ánh xạ ownership của child document: `order_owner_email`, `order_created_by`, `order_sale_email` phải đối chiếu tương ứng với `owner_email`, `created_by`, `sale_email` của parent order.
- Giữ nguyên nguyên tắc: user thường chỉ thao tác dữ liệu của mình, admin thao tác toàn bộ, Warehouse chỉ sửa nhóm field xử lý.
- Nuxt production build đã chạy thành công. Bộ test emulator cần chạy lại trên máy người dùng vì môi trường đóng gói không tải được Firestore Emulator JAR.

## V4 - Atomic order delete and stable Firestore transport

- Soft-delete an order and all of its `order_items` in one Firestore batch so a failed child update cannot leave the parent deleted while the UI reports an error.
- Stop rewriting ownership fields during delete; ownership remains immutable and is validated from the existing document/parent order.
- Add a Rules emulator regression test for the atomic order + order-items soft-delete path.
- Initialize the Firestore Web SDK with forced long-polling to avoid intermittent QUIC/WebChannel failures on affected Windows networks, proxies, or antivirus software.
## V5.1 - Export request edit rule

- Giảm số lần kiểm tra parent/user lặp lại khi chủ phiếu sửa phiếu còn ở trạng thái cho phép.
- Giữ bất biến toàn bộ field liên kết, ownership, trạng thái xử lý và xóa mềm.
- Mục tiêu sửa test `Chủ phiếu chỉ sửa khi phiếu còn ở trạng thái cho phép` bị vượt giới hạn 1000 biểu thức.


## V6.1 - giảm biểu thức Rules cho batch phiếu xuất

- Sửa hai test còn fail ở V6: tạo phiếu xuất + cập nhật tổng hợp đơn trong cùng batch, và xóa mềm phiếu + cập nhật tổng hợp đơn trong cùng batch.
- Thêm các helper chuyên biệt cho `order_export_requests.create`, `order_export_requests.update` và `orders.update` dạng warehouse summary để tránh gọi lồng `hasPerm()` / `isAdmin()` / `ownsOrderById()` nhiều lần.
- `activity_logs.create` chỉ kiểm tra email người thao tác khớp Firebase Auth, tránh thêm một lần đọc user document trong cùng batch. Log vẫn không được coi là audit tuyệt đối nếu không có backend tin cậy.
- Không thay đổi code Nuxt; bản vá này chỉ thay `firestore.rules` và tài liệu ghi chú.
