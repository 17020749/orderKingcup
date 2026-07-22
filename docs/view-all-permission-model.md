# Mô hình quyền `view_all` và action

Tài liệu này áp dụng cho các module Đơn hàng, Yêu cầu xuất kho, Thanh toán, Hóa đơn và Vận chuyển.

## Nguyên tắc

- Quyền `*.view` chỉ cho phép đọc các bản ghi thuộc phạm vi đơn hàng của người dùng.
- Quyền `*.view_all` chỉ mở rộng phạm vi đọc; quyền này không tự cấp quyền tạo, sửa hoặc xóa.
- `*.view_all` kết hợp với quyền action của cùng module cho phép action trên tất cả bản ghi của module đó.
- Có quyền action nhưng không có `*.view_all` thì action chỉ áp dụng cho bản ghi thuộc phạm vi đơn hàng của người dùng.
- Quyền `view_all` của module này không được mở rộng action của module khác, kể cả khi các module cùng liên kết tới một đơn hàng.

## Ma trận

| Module | Quyền xem tất cả | Quyền action toàn phạm vi |
| --- | --- | --- |
| Đơn hàng | `orders.view_all` | `orders.edit`, `orders.delete` |
| Yêu cầu xuất kho | `export_requests.view_all` | `orders.warehouse_export`, `export_requests.delete` |
| Thanh toán | `payments.view_all` | `payments.create`, `payments.edit`, `payments.delete` |
| Hóa đơn | `invoices.view_all` | `invoices.create`, `invoices.edit`, `invoices.delete` |
| Vận chuyển | `shipments.view_all` | `shipments.create`, `shipments.edit`, `shipments.delete` |

Các quyền `view_all` của chứng từ liên kết kéo theo quyền mở page, quyền `*.view` tương ứng và `orders.view_all` để client có thể tải đơn hàng nguồn. Modal phân quyền phải resolve dependency ngay khi mở để các checkbox phụ thuộc hiển thị đúng trạng thái.

Rule quan hệ ưu tiên kiểm tra `view_all` đúng module để short-circuit sớm cho người quản lý. Rule thao tác trực tiếp trên đơn hàng ưu tiên owner trước, sau đó mới kiểm tra `orders.view_all`; kết quả phân quyền không đổi nhưng tránh vượt giới hạn biểu thức Firestore cho cả sale và quản lý.

Các cập nhật đơn hàng thông thường được dispatch trước các nhánh tổng hợp đắt hơn, nhưng chỉ khi marker relation, printing và warehouse không thay đổi. Vì vậy batch thanh toán, hóa đơn, vận chuyển, kho và in ấn vẫn đi qua đúng rule nghiệp vụ chuyên biệt.

## Guard sửa và chẩn đoán lỗi

- Nút thao tác, mở modal, lưu, xóa và helper ghi Firestore phải dùng cùng một quyết định gồm quyền action, quyền scope và ownership của bản ghi.
- Bản ghi payment, invoice hoặc shipment cũ thiếu `created_by` không được tự điền người đang sửa; `created_by`, `created_at` và `order_id` là các trường bất biến.
- Khi thiếu quyền, thông báo phải liệt kê khóa cụ thể, ví dụ `[payments.edit]` hoặc `[export_requests.view_all]`.
- Khi người dùng đã đủ quyền client nhưng Firestore Rules vẫn từ chối, thông báo phải nêu mã chẩn đoán và nhóm ràng buộc dữ liệu cần kiểm tra thay vì trả lỗi quyền chung chung.

## Kiểm thử bắt buộc

- Test dependency và client matrix xác nhận `view_all` không tự cấp action.
- Test client phải chạy bằng các bundle `permissions_flat` đại diện cho role thực tế, không chỉ kiểm tra chuỗi source tối giản.
- Firestore emulator kiểm tra đủ các trường hợp owner-only, view-only, `view_all + action`, bản ghi legacy thiếu identity và chặn quyền chéo module.
- Toàn bộ Rules suite phải chạy tuần tự để phát hiện cả lỗi expression budget và hồi quy nghiệp vụ liên kết.
- Khi bổ sung một module có scope mới, phải cập nhật đồng thời catalog, dependency, scoped query, Rules và ma trận test.
- PR chỉ được xem là hoàn tất khi build, generate, kiểm tra indexes, deploy Rules staging và Hosting Preview đều thành công trên cây commit cuối cùng.

## Ngoại lệ

Module Tiến độ in ấn giữ nguyên mô hình nghiệp vụ riêng và không áp dụng ma trận trong tài liệu này.
