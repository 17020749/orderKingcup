# Cursor pagination

## Danh sách lớn

Các trang đơn hàng, thanh toán, hóa đơn, vận chuyển, nhập kho, xuất kho và điều chỉnh tồn tải 50 bản ghi mới nhất trước, sau đó dùng Firestore document cursor cho nút **Tải thêm**.

Tài khoản có quyền xem toàn bộ dùng `orderBy + limit + startAfter`. Tài khoản bị giới hạn phạm vi giữ truy vấn ownership hiện tại để không bỏ sót hoặc lộ dữ liệu. Tìm kiếm và bộ lọc áp dụng trên các bản ghi đã tải; giao diện luôn hiển thị số bản ghi hiện có.

Quan hệ con chỉ được truy vấn theo ID của các bản ghi cha đã tải:

- Order items, payments, export requests và printing dependencies theo order ID.
- Import items theo import order ID.
- Export items theo export order ID.

## Dashboard

Dashboard tiếp tục dùng đường tổng hợp client hiện tại để bảo toàn số liệu. Firestore server aggregation trên `orders` đã được kiểm chứng bằng emulator nhưng vượt giới hạn 1.000 biểu thức của Rules vì quyền đọc phụ thuộc user document và ownership. Không nới Rules sang `signedIn()` vì sẽ làm lộ dữ liệu.

Tối ưu KPI Dashboard cần một backend dùng Admin SDK hoặc custom auth claim chuyên dụng; hạng mục đó được tách khỏi Giai đoạn 4.

## Kiểm tra

```bash
npm run test:pagination
npm run test:indexes
npm run build
npm run generate
npm run test:rules
```
