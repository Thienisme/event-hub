# Thanh toán, mã giảm giá, danh sách chờ

Tài liệu cho người và AI làm việc với giai đoạn 2. Lấy code làm chuẩn nếu có chỗ lệch.

| Phần | File |
|---|---|
| Tạo thanh toán, IPN, return | `server/src/controllers/payment.controller.ts`, `server/src/routes/payment.routes.ts` |
| Xác nhận đơn sau khi trả tiền (dùng chung) | `server/src/payments/complete.ts` |
| Ký và kiểm chữ ký | `server/src/payments/vnpay.ts`, `server/src/payments/momo.ts` |
| Bật/tắt cổng, thời gian giữ vé | `server/src/config/payment.ts` |
| Mã giảm giá | `server/src/utils/promo.ts`, `server/src/controllers/promo.controller.ts`, `claimPromoUsage`/`releasePromoUsage` trong `server/src/utils/orderInventory.ts` |
| Áp/gỡ mã cho đơn đang chờ, xem một đơn | `server/src/controllers/order.controller.ts` (`getOrder`, `applyOrderPromo`, `removeOrderPromo`) |
| Danh sách chờ | `server/src/controllers/waitlist.controller.ts`, `server/src/utils/waitlistNotify.ts` |
| Giao diện | `client/src/views/CheckoutView.vue`, `PaymentResultView.vue`, `PromoCodesView.vue`, `client/src/stores/order.ts` |
| Test | `server/test-payments.cjs`, `server/test-promo-codes.cjs`, `server/test-waitlist.cjs` |

## 1. Luồng mua vé

```
Trang sự kiện ──Đặt vé──► POST /orders              đơn PENDING, giữ vé 10 phút
                              │
                              ▼
                     /checkout/:orderId              GET /orders/:id + GET /payments/providers
                     ├─ áp/gỡ mã: POST|DELETE /orders/:id/promo
                     └─ bấm "Thanh toán X đ"
                              │
            ┌─────────────────┼──────────────────────┐
         MOCK            VNPAY / MOMO             đơn 0 đ
 POST /orders/:id/confirm  POST /orders/:id/pay   POST /orders/:id/pay
            │                 │ tạo dòng Payment     │ xác nhận luôn
            │                 │ trả paymentUrl       │
            │                 ▼                      │
            │        Trang của VNPay/MoMo            │
            │          │                │            │
            │   IPN (server↔server)   khách quay về  │
            │   GET /payments/vnpay/ipn  /payment/result?provider=…
            │   POST /payments/momo/ipn  └► GET /payments/{vnpay|momo}/return
            │          └───────┬────────┘            │
            │                  ▼                     │
            │          completePayment()             │
            └──────────► đơn CONFIRMED, sinh QR, gửi email vé ◄┘
```

- **IPN và return đều gọi `completePayment`**, cái nào tới trước thì xác nhận, cái sau chỉ nhận lại kết quả cũ (`ALREADY_PROCESSED`).
  Ở máy local VNPay/MoMo không gọi được IPN vào `localhost`, nên đơn được xác nhận nhờ route return khi khách quay về.
- Thanh toán thất bại hoặc khách huỷ trên cổng: dòng `Payment` thành `FAILED`, **đơn vẫn PENDING**, khách bấm "Tiếp tục thanh toán" để thử lại.
  Mỗi đơn tối đa **3 lần** tạo thanh toán.
- `MOCK` chỉ có khi bật thanh toán giả lập (`ALLOW_SIMULATED_PAYMENT=true` hoặc môi trường dev). VNPay/MoMo chỉ hiện khi đủ khoá (`enabledProviders()`).

## 2. Các chốt chặn (đừng đổi thành "đọc rồi mới ghi")

| Rủi ro | Cách chặn |
|---|---|
| Một giao dịch được xác nhận hai lần (IPN và return tới cùng lúc) | `completePayment` khoá dòng `payments` bằng `SELECT ... FOR UPDATE` theo `txnRef`; chỉ xử lý khi `Payment.status = PENDING` |
| Đơn đã huỷ/hết hạn vẫn được xác nhận | Đổi đơn sang CONFIRMED bằng `updateMany` có điều kiện `status: 'PENDING'` (giống `confirmOrder`) |
| Tiền về sau khi đơn đã huỷ/hết hạn | Payment vẫn ghi `SUCCEEDED` nhưng `needsRefund = true` và log `[payment] Cần hoàn tiền cho đơn …`. **Hoàn tiền đang làm tay** trên trang quản trị của cổng |
| Giả mạo callback | Kiểm chữ ký: VNPay HMAC-SHA512, MoMo HMAC-SHA256, so bằng `timingSafeEqual`. VNPay còn kiểm `vnp_TmnCode` |
| Sửa số tiền | So `amount` callback với `Payment.amount` lúc tạo (VNPay gửi ×100). Lệch thì `AMOUNT_MISMATCH`, không xác nhận |
| Đơn hết hạn khi khách đang ở trang cổng | `/pay` cho cổng đóng sau `PAYMENT_HOLD_MINUTES` (15) phút và kéo `expiresAt` của đơn tới 15 + 5 phút, để job hết hạn không thả vé trước khi cổng đóng |
| Đổi mã sau khi đã gửi số tiền sang cổng | Áp/gỡ mã trả 409 khi đơn đã có ít nhất một `Payment` (`paymentStarted`) |
| Mã vượt số lượt (`maxUses`) khi nhiều người áp cùng lúc | `claimPromoUsage`: `UPDATE promo_codes SET usedCount = usedCount + 1 WHERE id = ? AND active = 1 AND (maxUses IS NULL OR usedCount < maxUses)`, cộng `CHECK usedCount >= 0` |
| Một người dùng quá `perUserLimit` | Câu đầu của transaction là `SELECT ... FOR UPDATE` trên dòng user (như `createOrder`), rồi mới đếm đơn PENDING/CONFIRMED dùng mã |
| Gửi email báo vé cho cùng một người chờ hai lần | `updateMany` có điều kiện `notifiedAt: null` trước khi gửi |

Phản hồi IPN VNPay: `00` thành công, `02` đã xử lý, `01` không thấy giao dịch, `04` sai số tiền, `97` sai chữ ký, `99` lỗi khác (luôn HTTP 200 theo yêu cầu của VNPay).
IPN MoMo trả `204` khi nhận.

## 3. Mã giảm giá

- Nhà tổ chức của sự kiện hoặc admin tạo ở `/my-events/:id/promo-codes`. Mã lưu chữ HOA, khách nhập thường cũng được.
- `PERCENT`: giảm `floor(tạm tính × % / 100)`, % là số nguyên 1..100. `FIXED`: giảm `min(số tiền, tạm tính)`.
- Đơn lưu `subtotalAmount`, `discountAmount`, `totalAmount = subtotal − discount`, `promoCodeId`.
- Lượt dùng được tính lúc **giữ vé**, không phải lúc trả tiền: đơn huỷ hoặc hết hạn thì `releasePromoUsage` trả lượt trong cùng transaction.
- Mã đã có người dùng thì không xoá được, chỉ tắt. Không hạ `maxUses` xuống dưới số lượt đã dùng.

## 4. Danh sách chờ

- Loại vé hết hàng thì trang sự kiện hiện nút **"Báo tôi khi có vé"**. Chỉ báo email, không giữ chỗ: ai vào đặt trước thì được trước.
- Gửi khi có vé quay lại: huỷ đơn, đơn hết hạn, hoặc nhà tổ chức tăng số lượng. Mỗi vé trả lại báo cho một người theo thứ tự đăng ký.
- Đặt vé thành công thì người đó tự ra khỏi danh sách chờ của loại vé đó. Người đã được báo mà đăng ký lại thì xếp cuối hàng.

## 5. Biến môi trường

| Biến | Ý nghĩa |
|---|---|
| `VNPAY_TMN_CODE` 🔒, `VNPAY_HASH_SECRET` 🔒 | Mã website và khoá bí mật VNPay. Thiếu một trong hai thì ẩn cổng VNPay |
| `VNPAY_PAY_URL` | Mặc định sandbox `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html` |
| `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY` 🔒 | Khoá MoMo. Thiếu một trong ba thì ẩn cổng MoMo |
| `MOMO_ENDPOINT` | Mặc định sandbox `https://test-payment.momo.vn/v2/gateway/api/create` |
| `APP_PUBLIC_URL` | Origin giao diện; trang về sau khi trả tiền là `<APP_PUBLIC_URL>/payment/result?provider=…` |
| `API_PUBLIC_URL` | Origin API cho `ipnUrl` của MoMo, mặc định bằng `APP_PUBLIC_URL` (đúng với Render vì chung một domain) |
| `PAYMENT_HOLD_MINUTES` | Thời gian cổng mở, mặc định 15 |

MoMo có bộ khoá test **công khai** trong tài liệu của họ, dùng được ngay cho sandbox:
`MOMO_PARTNER_CODE=MOMO`, `MOMO_ACCESS_KEY=F8BBA842ECF85`, `MOMO_SECRET_KEY=K951B6PE1waDMi640xX08PD3vg6EkVlz`.
Khoá VNPay phải tự đăng ký sandbox tại `sandbox.vnpayment.vn/devreg` và không đưa vào code hay chat.

IPN cần URL công khai, khai báo một lần:
- VNPay: gửi `https://<domain>/api/payments/vnpay/ipn` cho VNPay (trong email đăng ký hoặc trang quản trị sandbox).
- MoMo: không cần khai báo, server gửi `ipnUrl` theo từng giao dịch.

## 6. Cách test

### 6.1 Test tự động (không gọi VNPay/MoMo thật)

Test tự ký callback bằng khoá giả, nên **server và script phải dùng cùng bộ khoá giả**. Chỉ chạy trên MySQL cục bộ có tên database chứa `test`, `tmp` hoặc `temp`
(script tự từ chối nếu không đúng).

```bash
# MySQL và Redis tạm, không đụng database thật
docker run -d --name eh-test-mysql -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=eventhub_test -p 3317:3306 mysql:8.0
docker run -d --name eh-test-redis -p 6391:6379 redis:7-alpine

cd server
export DATABASE_URL=mysql://root:test@127.0.0.1:3317/eventhub_test REDIS_HOST=127.0.0.1 REDIS_PORT=6391
export JWT_SECRET=test-secret-0123456789abcdef0123456789 PORT=5055 BASE_URL=http://localhost:5055/api
export MAIL_DRIVER=log MAIL_OUTBOX_DIR=/tmp/eh-outbox NODE_ENV=development
export VNPAY_TMN_CODE=TESTTMN VNPAY_HASH_SECRET=testsecret
export MOMO_PARTNER_CODE=MOMO MOMO_ACCESS_KEY=testaccess MOMO_SECRET_KEY=testmomosecret
npx prisma migrate deploy && npm run seed
npm run build && node dist/app.js &     # server dùng đúng các biến trên (biến đã export thắng .env)

node test-payments.cjs                  # một bộ
npm run test:all                        # tất cả (khởi động lại server nếu gặp 429 rate limit)
```

Các bộ test giai đoạn 2 kiểm tra:
- `test-payments.cjs`: ký sai bị từ chối (`97`, return 400); sai số tiền không xác nhận (`04`); IPN gửi lại trả `02` và giữ nguyên QR;
  **10 IPN đồng thời chỉ 1 lần xác nhận**; thanh toán lỗi thì đơn vẫn chờ; tiền về khi đơn đã huỷ thì `needsRefund` và không trừ lại kho;
  IPN và return của MoMo; giới hạn 3 lần tạo thanh toán; đơn 0 đ xác nhận luôn, không tạo Payment.
- `test-promo-codes.cjs`: tính tiền PERCENT/FIXED; hạn, tắt, `perUserLimit`; huỷ/hết hạn trả lượt; áp/gỡ/đổi mã cho đơn đang chờ;
  **10 người áp cùng lúc mã `maxUses = 3` thì đúng 3 người được**; đã bắt đầu thanh toán thì không đổi mã (409).
- `test-waitlist.cjs`: chỉ tham gia được khi hết vé; trả 2 vé thì đúng 2 người đầu hàng nhận email; không gửi trùng; người đã được báo đăng ký lại thì về cuối hàng;
  danh sách chờ không giữ vé; người mua được vé tự ra khỏi danh sách.

CI (`.github/workflows/ci.yml`) chạy `test:all` với database `eventhub_test` và cùng bộ khoá giả trên.

Khi sửa một chốt chặn ở mục 2, hãy thử bỏ chốt đó đi và chạy lại test: test phải báo lỗi. Nếu test vẫn qua thì test chưa đủ.

### 6.2 Thử tay với sandbox thật

1. Đặt khoá sandbox thật vào `server/.env` (VNPay của mình, MoMo dùng bộ công khai ở mục 5), `APP_PUBLIC_URL` trỏ đúng cổng giao diện đang chạy.
2. Đăng nhập tài khoản khách (`khach@eventhub.demo` sau khi `npm run seed:demo`), đặt vé, chọn cổng ở trang thanh toán.
3. **VNPay**: chọn Thẻ nội địa → NCB, thẻ test `9704198526191432198`, tên `NGUYEN VAN A`, ngày phát hành `07/15`, OTP `123456`.
4. **MoMo**: trang MoMo hiện QR, quét bằng **app MoMo bản test** với tài khoản ví test (xem trang hướng dẫn test trên developers.momo.vn).
   Bấm huỷ trên trang MoMo để thử nhánh thất bại: về trang kết quả báo không thành công, đơn vẫn chờ.
5. Kết quả đúng: trang `/payment/result` báo thành công, "Vé của tôi" có QR, outbox/hộp thư có email vé.

Trên local chỉ có return, không có IPN. Muốn thử IPN thì chạy trên Render (hoặc mở tunnel công khai tới server) và kiểm log `[payment]`.

### 6.3 Kiểm tra trên production (Render)

- Đặt 5 biến `VNPAY_*`, `MOMO_*` ở trang Environment của Render, deploy lại, mở `GET /api/payments/providers` phải thấy `VNPAY`, `MOMO`.
- Đã gửi URL IPN cho VNPay. Trả một đơn nhỏ, rồi đóng tab ngay ở trang VNPay báo thành công (không quay về): đơn vẫn phải thành CONFIRMED nhờ IPN.
- Log có `[payment] Cần hoàn tiền` nghĩa là có khách trả tiền cho đơn đã huỷ/hết hạn: hoàn tiền tay trên trang quản trị của cổng.
