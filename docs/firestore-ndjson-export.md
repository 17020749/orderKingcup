# Xuất dữ liệu Firestore đang hiển thị thành NDJSON

Lệnh mặc định chỉ giữ các document còn hiển thị trong source cũ:

- `deleted`, `isDeleted` hoặc `is_deleted` không phải `true`;
- `active`, `isActive` hoặc `is_active` không phải `false`;
- `status` không thuộc `deleted`, `inactive`, `đã xóa`, `ngừng hoạt động`;
- document legacy thiếu các field trên vẫn được giữ.

Script tự động:

1. Xác thực bằng Service Account.
2. Đọc toàn bộ collection cấp cao trong Firestore.
3. Xuất một file NDJSON cho mỗi collection.
4. Lọc bỏ document đã xóa hoặc ngừng hoạt động.
5. Ghi trực tiếp vào `cms_manager_order/storage/app/legacy` nếu hai repository đặt cạnh nhau.
6. Tạo `firestore-export-manifest.json` ghi số bản ghi đã đọc, giữ lại và loại bỏ.

Script dùng Firestore REST API và Node.js có sẵn trong dự án, không cần cài thêm `firebase-admin`.

## Chạy trên PowerShell

Đứng trong repository `orderKingcup`:

```powershell
npm run export:firestore:ndjson -- --credentials "C:\Users\Administrator\Downloads\firebase-service-account.json"
```

Đường dẫn mặc định đầu ra:

```text
C:\Users\Administrator\Desktop\cms_manager_order\storage\app\legacy
```

## Xóa file cũ trước khi xuất lại

```powershell
Remove-Item "C:\Users\Administrator\Desktop\cms_manager_order\storage\app\legacy\*.ndjson" -Force -ErrorAction SilentlyContinue
Remove-Item "C:\Users\Administrator\Desktop\cms_manager_order\storage\app\legacy\firestore-export-manifest.json" -Force -ErrorAction SilentlyContinue
```

## Chọn thư mục đầu ra khác

```powershell
npm run export:firestore:ndjson -- `
  --credentials "C:\keys\firebase-service-account.json" `
  --output "C:\data\firestore-export"
```

## Chỉ xuất một số collection

```powershell
npm run export:firestore:ndjson -- `
  --credentials "C:\keys\firebase-service-account.json" `
  --include customers,products,warehouses
```

## Bỏ qua collection không cần thiết

```powershell
npm run export:firestore:ndjson -- `
  --credentials "C:\keys\firebase-service-account.json" `
  --exclude customer_codes,activity_logs
```

## Xuất toàn bộ, kể cả document đã xóa

Chỉ dùng khi cần bản sao lưu đầy đủ:

```powershell
npm run export:firestore:all -- --credentials "C:\Users\Administrator\Downloads\firebase-service-account.json"
```

## Kiểm thử bộ lọc

```powershell
npm run test:firestore-export
```

## Sau khi xuất xong

Trong repository Laravel:

```powershell
cd ..\cms_manager_order
php artisan legacy:migrate-all storage/app/legacy --dry-run --replace
```

Chỉ các collection đã có importer mới được ghi vào bảng nghiệp vụ.

## Bảo mật

Không commit Service Account JSON lên GitHub. `.gitignore` đã chặn các tên khóa thông dụng như `service-account*.json` và `*-firebase-adminsdk-*.json`.
