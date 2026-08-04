# Xuất toàn bộ Firestore thành NDJSON

Script `scripts/export-firestore-all.mjs` tự động:

1. Xác thực bằng Service Account.
2. Đọc toàn bộ collection cấp cao trong Firestore.
3. Tạo một file NDJSON cho mỗi collection.
4. Ghi trực tiếp vào thư mục `cms_manager_order/storage/app/legacy` nếu hai repository đặt cạnh nhau.
5. Tạo `firestore-export-manifest.json` để đối chiếu số collection và số document.

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

Kết quả ví dụ:

```text
customers.ndjson
products.ndjson
warehouses.ndjson
orders.ndjson
order_items.ndjson
payments.ndjson
firestore-export-manifest.json
```

Mỗi dòng trong file NDJSON là một Firestore REST document hoàn chỉnh, có `_collection`, `document_id`, `name`, `fields`, `createTime` và `updateTime`. Định dạng này dùng trực tiếp được với pipeline `legacy:stage` của Laravel.

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

## Dùng biến môi trường

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\keys\firebase-service-account.json"
npm run export:firestore:ndjson
```

## Sau khi xuất xong

Trong repository Laravel:

```powershell
cd ..\cms_manager_order
php artisan legacy:migrate-all storage/app/legacy --dry-run --replace
```

Chỉ các collection đã có importer sẽ được ghi vào bảng nghiệp vụ. Các file NDJSON còn lại được giữ sẵn để phát triển importer tiếp theo.

## Bảo mật

Không commit Service Account JSON lên GitHub. `.gitignore` của dự án đã chặn các tên khóa thông dụng như `service-account*.json` và `*-firebase-adminsdk-*.json`.
