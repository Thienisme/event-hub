# Lộ trình nâng cấp Event Hub

File tạm để nhớ việc. Làm xong mục nào thì đánh dấu `[x]` và ghi số PR. **Xong hết thì xoá file này.**

Ký hiệu người làm: **C** = Codex (việc khó: tiền, tranh chấp dữ liệu, migration), **O** = opencode/kilo (việc dễ, chủ yếu giao diện), **Cl** = Claude (thiết kế, review, gộp).

## Giai đoạn 1: Những thứ người dùng thấy thiếu ngay

Xong ở PR #16.

- [x] **1A. Hạ tầng email + quên mật khẩu + xác minh email** (C, #16)
  - `utils/mailer.ts`: driver `log` (mặc định, ghi file vào `MAIL_OUTBOX_DIR` cho test) và `brevo` (API HTTP, không cần thư viện).
  - Quên mật khẩu: token ngẫu nhiên, chỉ lưu bản băm, hết hạn 30 phút, dùng một lần; đặt lại thì tăng `tokenVersion`.
  - Xác minh email khi đăng ký: chưa xác minh vẫn dùng được, chỉ hiện nhắc.
- [x] **1B. Thời gian mở bán + link dạng chữ + ảnh xem trước khi chia sẻ** (C)
  - `saleStart`/`saleEnd` cho từng loại vé, chặn ngay trong câu `updateMany` giữ vé.
  - `slug` cho sự kiện (`/events/hoi-thao-web3`), link UUID cũ vẫn chạy.
  - Server chèn thẻ OG (tiêu đề, mô tả, ảnh) vào `index.html` cho `/events/:slug`, để dán link vào Facebook/Zalo hiện ảnh.
- [x] **1C. Nút trên trang sự kiện** (O)
  - Thêm vào lịch (file `.ics` và Google Calendar), mở Google Maps, chia sẻ / sao chép link.
- [x] **1D. Email vé và nhắc lịch** (C, sau 1A)
  - Gửi email kèm mã vé sau khi thanh toán (không được làm hỏng việc thanh toán nếu gửi lỗi).
  - Nhắc lịch 24 giờ trước sự kiện, mỗi đơn chỉ gửi một lần.
- [x] **Anh tự làm:** tạo tài khoản Brevo, xác minh email người gửi, đặt `BREVO_API_KEY`, `MAIL_FROM`, `APP_PUBLIC_URL` trên Render.

## Giai đoạn 2: Bán hàng thật

Xong ở PR #20 (giao diện thanh toán hoàn thiện ở #21).

- [x] Thanh toán VNPay và MoMo (sandbox), nhận kết quả qua webhook, mỗi đơn chỉ xác nhận một lần (C). Luồng và cách test: `docs/PAYMENTS.md`
- [x] Mã giảm giá: phần trăm hoặc số tiền, giới hạn lượt dùng, chống dùng vượt lượt khi áp cùng lúc (C)
- [x] Danh sách chờ khi hết vé, có vé trả về thì báo người đầu danh sách (C)
- [x] Trang thanh toán riêng `/checkout/:orderId` kiểu Ticketbox: chọn cổng, mã giảm giá thu gọn, đồng hồ giữ vé (C)
- [ ] Mua nhiều loại vé trong một đơn (chọn số lượng từng loại, một nút "Tiếp tục"). Đụng `createOrder`: trừ kho nhiều loại trong một transaction, Redlock nhiều khoá (C)
- [ ] **Anh tự làm:** đăng ký VNPay sandbox, gửi URL IPN `https://<render>/api/payments/vnpay/ipn` cho VNPay, đặt 5 biến `VNPAY_*`, `MOMO_*` trên Render

## Giai đoạn 3: Công cụ cho nhà tổ chức

- [ ] Bảng điều khiển bán vé: doanh thu theo ngày, tỉ lệ vào cổng, loại vé bán chạy (O, có biểu đồ)
- [ ] Xuất danh sách khách ra CSV, gửi email cho toàn bộ khách của sự kiện (C)
- [ ] Tài khoản nhân viên soát vé: chỉ được quét vé, không sửa sự kiện (C)
- [ ] Huỷ cả sự kiện: báo người mua, đánh dấu cần hoàn tiền (C)

## Giai đoạn 4: Khám phá và cộng đồng

- [ ] Lưu sự kiện yêu thích, theo dõi nhà tổ chức, trang công khai của nhà tổ chức (O + C)
- [x] Mục "Nổi bật" trên trang chủ (#22); còn "Sắp diễn ra gần bạn" (O)
- [ ] **Sự kiện miễn phí có duyệt đăng ký** kiểu Luma: người dùng gửi đăng ký, nhà tổ chức duyệt/từ chối từng người, được duyệt mới có vé (C)
- [ ] Đánh giá sau sự kiện, chỉ người đã check-in mới được đánh giá (C)

## Giai đoạn 5: Nâng cao

- [x] **Phòng chờ ảo khi mở bán vé hot** kiểu Ticketmaster/Ticketbox: xếp hàng bằng Redis sorted set, hiện vị trí trong hàng, cấp token vào cửa có hạn vài phút, giới hạn số người mua cùng lúc; đo bằng k6 (C, ưu tiên 2). Xong ở PR phòng chờ ảo; thiết kế: `docs/WAITING-ROOM.md`
- [ ] **QR động chống chụp màn hình** kiểu SafeTix/DICE: mã trên "Vé của tôi" đổi mỗi 30 giây (HMAC theo khung thời gian như TOTP), máy soát vé kiểm cả chữ ký lẫn thời gian, mã QR tĩnh cũ vẫn soát được trong giai đoạn chuyển đổi (C, ưu tiên 3)
- [ ] Chuyển nhượng vé, vé cũ mất hiệu lực ngay; bán lại không quá giá gốc, chống hai người cùng mua lại một vé (C)
- [ ] Sơ đồ chọn ghế (C)
- [ ] PWA: cài lên điện thoại, soát vé khi mất mạng (C)

## Chất lượng và vận hành

Thứ tự đã chọn (17/11/2026): E2E → phòng chờ ảo → QR động.

- [x] **Test giao diện tự động bằng Playwright, chạy trong CI** (#27, bắt buộc trong branch protection): luồng đăng nhập, lọc trang chủ, đặt vé và thanh toán giả lập, soát vé, hồ sơ; job CI riêng dựng MySQL/Redis, server phục vụ bản build client, lưu báo cáo khi fail (C, Cl review)
- [ ] Giám sát lỗi production (Sentry hoặc tương đương): lỗi tự báo kèm stack trace (C)
- [ ] Môi trường staging hoặc bản xem trước cho từng PR, thử trên web thật trước khi merge (Cl)
- [ ] Rate limit dùng chung qua Redis và refresh token, chuẩn bị chạy nhiều instance (C)

## Việc nhỏ còn treo

- [x] Chặn khoảng ngày ngược (`from` > `to`) ở bộ lọc trang chủ, hiện thông báo thay vì im lặng bỏ qua (O)
- [ ] Chạy lại `seed:demo` trên TiDB để sự kiện demo có đúng danh mục (anh quyết, vì lệnh này đặt lại mật khẩu tài khoản demo)
- [ ] Email đang vào Spam vì người gửi là `@gmail.com` qua máy chủ Brevo: khi dùng thật thì mua tên miền riêng, xác minh tên miền trên Brevo (SPF/DKIM/DMARC), đổi `MAIL_FROM` sang `no-reply@<tên miền>` (anh làm)
