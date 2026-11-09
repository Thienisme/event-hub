# Bàn giao: các việc còn lại cho AI khác

Backend vòng đời đơn hàng đã xong và có test trên nhánh `feat/order-lifecycle`. Tài liệu này gồm các việc dễ còn lại. Mỗi prompt độc lập: dán nguyên khối vào AI khác, mỗi lần một prompt, trên nhánh tách từ `feat/order-lifecycle`.

Thứ tự đề xuất: Prompt 1, 2, 3 rồi 4.

---

## Prompt 1: UI vòng đời đơn hàng (ưu tiên cao)

```text
Bạn làm việc trong repo Event Hub. Đọc CLAUDE.md trước. Chỉ sửa client/, không sửa server/.
Giao diện dùng Vue 3 Composition API, Pinia, Tailwind; thông báo hiển thị bằng tiếng Việt.

API đã có sẵn (đều cần Bearer token, axios `apiClient` tự gắn):
- GET  /orders/my-orders -> mảng Order, mỗi tickets[] có qrCode (null khi chưa thanh toán)
- POST /orders/:id/confirm -> 200 { message, order }. Thanh toán giả lập, sinh qrCode. Gọi lại vẫn 200.
- POST /orders/:id/cancel  -> 200 { message, order }. Chỉ với đơn PENDING. Gọi lại vẫn 200.
Lỗi có dạng { message }: 404 không thấy đơn; 409 đơn đã hết hạn, đã huỷ, hoặc đã thanh toán.
Ở production, confirm có thể trả 404 "Chức năng thanh toán giả lập không khả dụng!".

Việc cần làm:
1. client/src/stores/order.ts: thêm confirmOrder(id) và cancelOrder(id), gọi API rồi thay đơn tương ứng trong
   state `orders` bằng dữ liệu trả về. Lưu ý response không kèm ticketType.event, nên phải giữ lại thông tin
   tickets cũ khi ghép, hoặc gọi lại fetchMyOrders() sau khi thành công.
2. client/src/views/MyOrdersView.vue, với đơn PENDING:
   - Nút "Thanh toán (giả lập)" và nút "Huỷ đơn". Huỷ phải hỏi lại bằng components/ConfirmDialog.vue.
   - Đồng hồ đếm ngược tới expiresAt (dọn timer trong onUnmounted). Hết giờ thì ẩn hai nút và hiện "Đã hết hạn giữ chỗ".
   - Disable nút trong lúc gửi để tránh bấm hai lần. Không đăng xuất người dùng khi gặp 409.
3. Với đơn CONFIRMED: hiện mã QR của từng vé. Thêm thư viện `qrcode` để vẽ từ chuỗi ticket.qrCode, có nút xem lớn.
   Đơn khác CONFIRMED không hiện QR.
4. Dùng stores/toast.ts để báo thành công và hiển thị message lỗi từ server.

Tiêu chí hoàn thành:
- `npm run build` trong client/ không lỗi.
- Tự kiểm tra trên trình duyệt: đặt vé -> thanh toán -> thấy QR, F5 vẫn còn; đặt vé -> huỷ -> số vé ở trang sự kiện tăng lại;
  mở hai tab, huỷ ở tab này rồi thanh toán ở tab kia -> thấy thông báo lỗi, giao diện cập nhật đúng.
```

---

## Prompt 2: Các sửa nhỏ ở backend

```text
Bạn làm việc trong repo Event Hub. Đọc CLAUDE.md trước. Mỗi mục một commit, không đổi logic đặt vé trong createOrder.

1. server/src/middlewares/rateLimit.middleware.ts: đổi mọi `message` dạng chuỗi thành object { message: '...' },
   vì client đọc data.message. Sửa các script test nếu đang đọc 429 dạng text.
2. server/src/app.ts: thêm helmet, và đọc TRUST_PROXY từ env: nếu có thì app.set('trust proxy', Number(TRUST_PROXY)).
   Mặc định không bật. Khai báo trong server/.env.example kèm giải thích.
3. server/prisma/schema.prisma: thêm @@index([status, expiresAt]) cho Order và @@index([createdAt]) cho Event.
   Tạo migration. Migration sẽ kèm DROP DEFAULT của actorEmail do schema đang lệch, đó là bình thường.
4. server/src/controllers/order.controller.ts: tính totalAmount bằng ticketType.price.mul(quantity) thay vì số thực.
   Giữ nguyên exceedsOrderAmount.
5. MYOrders: thêm phân trang page, limit (mặc định 20, tối đa 100), trả { data, pagination } theo đúng dạng của
   listAllEvents trong admin.controller.ts. Sửa client/src/stores/order.ts cho khớp.
6. server/test-admin-race.cjs: từ chối chạy nếu NODE_ENV=production hoặc tên database không chứa "test", "dev",
   "verify" hay "eventhub", trừ khi đặt ALLOW_DESTRUCTIVE_TESTS=true.

Tiêu chí hoàn thành: `npx tsc --noEmit` không lỗi và `npm run test:all` đạt hết. Test ghi thật vào database,
nên chỉ chạy trên database dev. Chạy `npm run seed` trước, và chờ 1 phút giữa các lần chạy vì rate limit.
```

---

## Prompt 3: CI và Docker

```text
Bạn làm việc trong repo Event Hub. Đọc CLAUDE.md trước.

1. Thêm script "start": "node dist/app.js" vào server/package.json, kiểm tra `npm run build` rồi chạy được.
2. Thêm server/Dockerfile và client/Dockerfile dạng multi-stage (client phục vụ bằng nginx). Thêm .dockerignore.
   Giữ nguyên docker-compose.yml hiện tại cho dev; tạo docker-compose.prod.yml riêng. Không ghi secret vào file.
3. Thêm .github/workflows/ci.yml: chạy khi có pull request, gồm service MySQL 8 và Redis 7, tạo .env từ giá trị giả,
   chạy prisma migrate deploy, seed, tsc, khởi động server rồi `npm run test:all`; build client bằng `npm run build`.
4. Thêm graceful shutdown cho SIGTERM trong server/src/app.ts: dừng nhận request, đóng Prisma và Redis.

Tiêu chí hoàn thành: `docker compose -f docker-compose.prod.yml up --build` chạy được và /api/health trả 200.
Workflow hợp lệ, không dùng secret thật. Không thêm badge vào README khi CI chưa chạy thật.
```

---

## Prompt 4: Cập nhật tài liệu (làm sau cùng)

```text
Bạn làm việc trong repo Event Hub. Chỉ sửa README.md, CLAUDE.md, PROJECT_NOTES.md, TRICK.md. Đối chiếu với code rồi mới ghi,
không khẳng định điều gì chưa kiểm chứng, không ghi số dòng code.

Cập nhật theo code hiện tại:
- API: POST /orders/:id/confirm, POST /orders/:id/cancel, hạn mức MAX_TICKETS_PER_USER_PER_EVENT,
  ALLOW_SIMULATED_PAYMENT, mã QR ngẫu nhiên cho từng vé.
- PROJECT_NOTES mục 15.2 và 16, TRICK mục 12: đơn đã có thể CONFIRMED và CANCELLED, doanh thu không còn luôn bằng 0;
  gap 3.000 vé đã giảm còn 100 vé mỗi sự kiện cho mỗi tài khoản (vẫn lách được bằng nhiều tài khoản).
- Cập nhật số bộ test thành 9 và bổ sung test-order-lifecycle.cjs.
- Thêm vào mục câu hỏi: vì sao hạn mức cần `SELECT ... FOR UPDATE` trên dòng user và phải là câu đầu tiên của transaction
  (Redlock khoá theo loại vé nên không xếp hàng được đơn trên nhiều loại vé; REPEATABLE READ chụp snapshot ở lần đọc thường
  đầu tiên). Số liệu thật: khi gỡ khoá, 8 đơn đồng thời mỗi đơn 30 vé giữ được 120 vé, vượt hạn mức 100.
- Bổ sung kết quả của Prompt 1, 2, 3 nếu đã làm xong.
```

---

## Chưa nằm trong các prompt trên

Những việc này cần thiết kế cẩn thận, không nên giao như việc dễ:

- Idempotency key khi đặt vé, để bấm hai lần không tạo hai đơn.
- Thanh toán thật (VNPay, MoMo) với webhook có xác thực chữ ký.
- Soát vé bằng QR: endpoint check-in và chống quét trùng.
- Huỷ đơn đã thanh toán kèm hoàn tiền.
- Tìm nguyên nhân lỗi thỉnh thoảng gặp `Server has closed the connection`.
