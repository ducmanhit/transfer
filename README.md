# QuickRoom — truyền text và ảnh realtime

Web tĩnh HTML/CSS/JavaScript, dùng Supabase cho:

- Email/password Authentication
- PostgreSQL database
- Realtime messages
- Private Storage cho ảnh
- Row Level Security: mỗi tài khoản chỉ đọc dữ liệu của chính mình
- Nén ảnh ở trình duyệt trước khi upload

## 1. Tạo Supabase project

1. Đăng ký Supabase và tạo một project Free.
2. Mở **SQL Editor**.
3. Dán toàn bộ nội dung file `supabase-setup.sql` rồi bấm **Run**.
4. Trong phần Authentication, bật Email provider. Nếu muốn tạo tài khoản dùng ngay, có thể tắt yêu cầu xác nhận email; nếu giữ bật thì xác nhận email sau khi đăng ký.

## 2. Điền thông tin API

Trong Supabase Dashboard, mở **Project Settings → API** rồi lấy:

- Project URL
- `anon` / public key

Mở `config.js` và thay:

```js
export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...";
```

`anon` key có thể xuất hiện trong frontend vì quyền truy cập được bảo vệ bằng RLS. Không bao giờ dùng `service_role` key trong web.

## 3. Chạy thử trên máy

Không nên mở trực tiếp `index.html` bằng `file://` vì JavaScript module có thể bị trình duyệt chặn.

Chạy một web server nhỏ trong thư mục dự án:

```bash
python -m http.server 5500
```

Sau đó mở:

```text
http://localhost:5500
```

## 4. Đăng lên GitHub Pages

1. Tạo repo mới, ví dụ `quickroom`.
2. Upload toàn bộ các file trong thư mục này lên nhánh `main`.
3. Mở **Settings → Pages**.
4. Chọn **Deploy from a branch → main → /(root)**.
5. Có thể gắn subdomain như `room.ducmanh.io.vn` bằng file `CNAME` và bản ghi DNS CNAME trỏ đến `<username>.github.io`.

## Cách dùng

1. Tạo một tài khoản bằng email và mật khẩu.
2. Đăng nhập cùng tài khoản đó trên điện thoại và máy tính.
3. Gửi text, chọn ảnh hoặc dán ảnh bằng Ctrl + V.
4. Ảnh được giảm kích thước tối đa xuống 1600 px và chuyển sang WebP trước khi upload.

## Lưu ý

- Đây là mô hình **một phòng riêng cho mỗi tài khoản**, phù hợp truyền dữ liệu giữa các thiết bị cá nhân.
- Không dùng một “key bí mật” viết cứng trong JavaScript vì bất kỳ ai cũng có thể xem mã nguồn frontend.
- Gói Supabase Free có thể pause project sau một tuần không hoạt động. Khi dùng thường xuyên, Realtime sẽ hoạt động ngay; tốc độ thực tế vẫn phụ thuộc mạng và khu vực máy chủ.
