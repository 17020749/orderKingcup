# Order Kingcup Nuxt + Firebase Hosting + Firestore

Đây là bản chuyển Order Kingcup từ Google Apps Script sang NuxtJS SPA để deploy Firebase Hosting. Firestore là database chính, Firebase Auth dùng Google login.

## Bản này đã có

- Login Google bằng Firebase Auth, không dùng OAuth/session Apps Script nữa.
- Kiểm tra tài khoản trong `users/{email}` trên Firestore.
- Đọc role/permission từ `roles` và `users.permissions_flat`.
- Layout/sidebar theo quyền.
- Page Dashboard.
- Page Khách hàng: thêm/sửa/xóa mềm.
- Page Sản phẩm: xem/tìm kiếm.
- Page Đơn hàng: tạo/sửa/xóa mềm, chi tiết sản phẩm trong `order_items`.
- Page Thanh toán: tạo/sửa/xóa mềm, tự tính trạng thái thanh toán và công nợ cho đơn.
- Page Phiếu xuất kho: tạo yêu cầu xuất kho trên `order_export_requests`.
- Page Người dùng/Vai trò: quản lý user/role trực tiếp trên Firestore.
- Page Nhật ký hoạt động.
- `firestore.rules` và `firestore.indexes.json` khởi đầu.

## Chưa tối ưu sâu trong bản đầu

- Chưa dùng phân trang cursor cho mọi bảng.
- Dashboard vẫn đọc collection để tính nhanh giai đoạn đầu, sau này nên chuyển sang `dashboard_summaries`.
- Phiếu xuất kho mới là luồng Kingcup tạo yêu cầu; Warehouse Nuxt sẽ làm tiếp để xử lý realtime.
- Import/export Excel/PDF chưa chuyển sang Nuxt.
- Search nâng cao nên tối ưu bằng field `_norm` hoặc dịch vụ search riêng nếu dữ liệu rất lớn.

## Yêu cầu môi trường

- Node.js `20.19.4` (xem `.nvmrc`).
- npm `10.9.x`; repository chỉ sử dụng npm, không dùng pnpm, Yarn hoặc Bun.
- Dùng `npm ci` để cài đặt sạch, tái lập đúng `package-lock.json`.
- Chỉ dùng `npm install` khi chủ động thay đổi dependency và cần cập nhật lockfile.

## Cài đặt

```bash
npm ci
cp .env.example .env
```

Điền cấu hình Firebase Web App vào `.env`:

```env
NUXT_PUBLIC_FIREBASE_API_KEY=...
NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN=orderfirestore-501909.firebaseapp.com
NUXT_PUBLIC_FIREBASE_PROJECT_ID=orderfirestore-501909
NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET=orderfirestore-501909.appspot.com
NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NUXT_PUBLIC_FIREBASE_APP_ID=...
```

Chạy local:

```bash
npm run dev
```

## Deploy Firebase Hosting

Tạo `.firebaserc` từ file mẫu:

```bash
cp .firebaserc.example .firebaserc
```

Build static và deploy:

```bash
npm run generate
firebase deploy --only hosting
```

Có thể dùng lệnh tắt:

```bash
npm run deploy
```

## Firestore indexes

Kiểm tra cấu hình index và đối chiếu với query trong source:

```bash
npm run test:indexes
```

Việc deploy index được tách khỏi workflow Hosting/Rules và chỉ chạy thủ công tại **GitHub Actions → Firestore Indexes**. Luôn deploy staging trước, nhập đúng project ID để xác nhận và dùng GitHub Environment `production` cho production approval. Workflow chỉ deploy `firestore:indexes`, kiểm tra service account thuộc đúng project và không dùng `--force`.

Chi tiết inventory, cách validate và quy trình staging/production: [`docs/firestore-indexes.md`](docs/firestore-indexes.md).

## Dữ liệu yêu cầu trước khi đăng nhập

Firebase Auth chỉ xác thực Google. Muốn vào app, email đó phải có document trong Firestore:

```text
users/{email}
```

Ví dụ:

```json
{
  "email": "admin@gmail.com",
  "display_name": "Admin",
  "roles": ["Admin"],
  "role": "Admin",
  "status": "active",
  "active": true,
  "deleted": false,
  "is_admin": true,
  "permissions_flat": ["*"]
}
```

Role Admin:

```text
roles/Admin
```

```json
{
  "id": "Admin",
  "name": "Admin",
  "permissions": ["*"],
  "status": "active",
  "active": true,
  "deleted": false
}
```

Bộ migration Apps Script trước đó nên tạo sẵn `users`, `roles`, `customers`, `products`, `orders`, `order_items`, `payments`, `order_export_requests`.

## Ghi chú bảo mật

- `.env` chỉ chứa Firebase Web config, không chứa private key service account.
- Service account JSON chỉ dùng cho migration bằng Apps Script, không đưa vào Nuxt.
- `firestore.rules` bản này đủ để test chuyển đổi. Khi nghiệp vụ ổn, nên siết rules theo permission chi tiết hoặc dùng Cloud Functions/Cloud Run cho các thao tác nhạy cảm như trừ tồn kho/xử lý xuất kho.
