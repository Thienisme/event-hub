/**
 * Test end-to-end: tạo sự kiện với dữ liệu vượt giới hạn.
 *
 * Kỳ vọng sau bản vá:
 *   - Dữ liệu hợp lệ (kể cả mô tả dài hơn 191 ký tự) -> 201, lưu đủ trong DB.
 *   - Dữ liệu vượt giới hạn -> 400 kèm thông báo tiếng Việt nêu rõ trường.
 *   - KHÔNG còn 500 "Lỗi máy chủ" trong bất kỳ trường hợp nào.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const API = 'http://localhost:5000/api';

const G = '\u001b[32m';
const R = '\u001b[31m';
const D = '\u001b[2m';
const X = '\u001b[0m';

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ${G}✅${X} ${name}${detail ? ` ${D}— ${detail}${X}` : ''}`);
  } else {
    failed += 1;
    console.log(`  ${R}❌${X} ${name}${detail ? ` ${D}— ${detail}${X}` : ''}`);
  }
}

async function main() {
  console.log(`\n${D}Test tạo sự kiện — giới hạn dữ liệu${X}`);

  // Dùng tài khoản RIÊNG cho test này, không dùng admin@test.com.
  //
  // Lý do: rate limiter đặt vé khoá theo tài khoản (15 lần/5 phút). Nếu dùng
  // chung tài khoản với k6 hay với test khác thì test sẽ hụt hạn mức và fail
  // một cách khó hiểu — thất bại do hạ tầng, không phải do logic cần kiểm.
  const email = `limits-admin-${Date.now()}@test.local`;
  const password = 'MatKhauDaiHon8KyTu';
  const bcrypt = require('bcryptjs');
  const testUser = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(password, 10),
      fullName: 'Limits Test Admin',
      role: 'ADMIN',
      isActive: true,
    },
    select: { id: true },
  });
  const testUserId = testUser.id;

  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { token } = await login.json();
  if (!token) throw new Error('Khong dang nhap duoc');

  const created = [];

  const post = async (payload) => {
    const res = await fetch(`${API}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (body && body.event) created.push(body.event.id);
    return {
      status: res.status,
      message: (body || {}).message || '',
      // Vị trí trả về: { message, event: { id, ticketTypes: [...] } }
      eventId: body && body.event ? body.event.id : null,
      ticketTypeId:
        body && body.event && body.event.ticketTypes && body.event.ticketTypes[0]
          ? body.event.ticketTypes[0].id
          : null,
    };
  };

  const base = {
    title: 'Sự kiện kiểm thử giới hạn',
    description: null,
    location: 'Hà Nội',
    bannerUrl: null,
    startTime: new Date(Date.now() + 86400000).toISOString(),
    endTime: new Date(Date.now() + 90000000).toISOString(),
  };

  // 1. Sự kiện bình thường -> 201
  const ok = await post(base);
  check('tạo sự kiện bình thường -> 201', ok.status === 201, `nhận ${ok.status}`);

  // 2. Mô tả dài 3000 ký tự (trước đây chết với 500 vì cột VARCHAR(191)) -> 201
  const longDesc = await post({ ...base, title: 'Mô tả dài', description: 'x'.repeat(3000) });
  check(
    'mô tả 3000 ký tự -> 201 (trước đây là 500)',
    longDesc.status === 201,
    `nhận ${longDesc.status} — "${longDesc.message}"`
  );

  // 2b. Mô tả lưu đủ trong DB, không bị cắt cụt
  if (longDesc.status === 201) {
    const saved = await prisma.event.findUnique({
      where: { id: created[created.length - 1] },
      select: { description: true },
    });
    check(
      'mô tả lưu đủ 3000 ký tự trong DB',
      saved && saved.description && saved.description.length === 3000,
      `độ dài ${saved && saved.description ? saved.description.length : 0}`
    );
  }

  // 3. Tiêu đề 300 ký tự > 255 -> 400 kèm message rõ ràng
  const longTitle = await post({ ...base, title: 'T'.repeat(300) });
  check(
    'tiêu đề 300 ký tự -> 400 kèm thông báo rõ ràng',
    longTitle.status === 400 && /255/.test(longTitle.message),
    `nhận ${longTitle.status} — "${longTitle.message}"`
  );

  // 4. URL banner 600 ký tự > 500 -> 400
  const longBanner = await post({ ...base, bannerUrl: `https://a.io/${'b'.repeat(600)}` });
  check(
    'URL banner 600 ký tự -> 400 kèm thông báo rõ ràng',
    longBanner.status === 400 && /500/.test(longBanner.message),
    `nhận ${longBanner.status} — "${longBanner.message}"`
  );

  // 5. Giá vé vượt DECIMAL(12,2) -> 400
  const badPrice = await post({
    ...base,
    ticketTypes: [{ name: 'VIP', price: 100000000000, totalQuantity: 10 }],
  });
  check(
    'giá vé vượt giới hạn DECIMAL -> 400 kèm thông báo rõ ràng',
    badPrice.status === 400 && /giá vé/i.test(badPrice.message),
    `nhận ${badPrice.status} — "${badPrice.message}"`
  );

  // 6. Số lượng vượt INT max -> 400
  const badQty = await post({
    ...base,
    ticketTypes: [{ name: 'VIP', price: 100000, totalQuantity: 99999999999 }],
  });
  check(
    'số lượng vượt giới hạn INTEGER -> 400 kèm thông báo rõ ràng',
    badQty.status === 400 && /số lượng vé/i.test(badQty.message),
    `nhận ${badQty.status} — "${badQty.message}"`
  );

  // 7. Tên loại vé 150 ký tự > 100 -> 400
  const longName = await post({
    ...base,
    ticketTypes: [{ name: 'N'.repeat(150), price: 100000, totalQuantity: 10 }],
  });
  check(
    'tên loại vé 150 ký tự -> 400 kèm thông báo rõ ràng',
    longName.status === 400 && /100/.test(longName.message),
    `nhận ${longName.status} — "${longName.message}"`
  );

  // 8. Giá vé hợp lệ nhưng lớn (100 triệu) -> 201 (trước đây lỗi DECIMAL(10,2))
  const bigPrice = await post({
    ...base,
    title: 'Vé giá 100 triệu',
    ticketTypes: [{ name: 'VIP', price: 100000000, totalQuantity: 10 }],
  });
  check(
    'giá vé 100.000.000 -> 201 (trước đây lỗi DECIMAL(10,2))',
    bigPrice.status === 201,
    `nhận ${bigPrice.status} — "${bigPrice.message}"`
  );

  // 9. Đường SỬA (PUT) dùng chung schema nhưng ghi khác -> phải cùng hành vi.
  const eventId = created[0];
  const put = async (payload) => {
    const res = await fetch(`${API}/events/${eventId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, message: (body || {}).message || '' };
  };

  const updateLongDesc = await put({ ...base, description: 'y'.repeat(3000) });
  check(
    'sửa sự kiện với mô tả 3000 ký tự -> 200',
    updateLongDesc.status === 200,
    `nhận ${updateLongDesc.status} — "${updateLongDesc.message}"`
  );

  const updateLongTitle = await put({ ...base, title: 'T'.repeat(300) });
  check(
    'sửa sự kiện với tiêu đề 300 ký tự -> 400 kèm thông báo rõ ràng',
    updateLongTitle.status === 400 && /255/.test(updateLongTitle.message),
    `nhận ${updateLongTitle.status} — "${updateLongTitle.message}"`
  );

  const updateBadPrice = await put({
    ...base,
    ticketTypes: [{ name: 'VIP', price: 100000000000, totalQuantity: 10 }],
  });
  check(
    'sửa sự kiện với giá vé vượt giới hạn -> 400 kèm thông báo rõ ràng',
    updateBadPrice.status === 400 && /giá vé/i.test(updateBadPrice.message),
    `nhận ${updateBadPrice.status} — "${updateBadPrice.message}"`
  );

  // 10. ★ Giá × số lượng vượt biên DECIMAL(12,2) của `orders.totalAmount`.
  //
  // Mỗi yếu tố đều hợp lệ (giá <= 9.999.999.999,99, số lượng <= 2.147.483.647)
  // nhưng TÍCH của chúng thì không lưu được vào `orders.totalAmount`. Nếu
  // không chặn ở lúc tạo sự kiện thì sự kiện lên kệ thành công, còn mọi đơn
  // đặt vé đều lỗi 400 -> người bán thấy sự kiện, người mua không mua được.
  const oversizedTotal = await post({
    ...base,
    title: 'Tong tien vuot bien DECIMAL(12,2)',
    ticketTypes: [{ name: 'Vip dat', price: 9999999999.99, totalQuantity: 2 }],
  });
  check(
    'giá × số lượng vượt biên totalAmount -> 400 ngay lúc tạo sự kiện',
    oversizedTotal.status === 400 && /tổng tiền/i.test(oversizedTotal.message),
    `nhận ${oversizedTotal.status} — "${oversizedTotal.message}"`
  );

  // 11. ★ Biên đúng: tích VỪA chạm biên thì vẫn tạo được VÀ đặt vé được.
  //
  // Dùng giá có đúng 2 chữ số thập phân (3.333.333.333,33 × 3 = 9.999.999.999,99
  // vừa khít DECIMAL(12,2)). Nếu dùng giá có 3 chữ số thập phân thì MySQL sẽ
  // làm tròn lúc lưu price, và tổng thành 10.000.000.000,00 — vượt biên, dù
  // phép tính "trên giấy" có vừa.
  const atLimit = await post({
    ...base,
    title: 'Tong tien vua cham bien',
    ticketTypes: [{ name: 'Vip dat', price: 3333333333.33, totalQuantity: 3 }],
  });
  check(
    'tổng tiền vừa chạm biên -> 201 (không chặn oan)',
    atLimit.status === 201,
    `nhận ${atLimit.status} — "${atLimit.message}"`
  );

  if (atLimit.status === 201) {
    const orderRes = await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ticketTypeId: atLimit.ticketTypeId, quantity: 3 }),
    });
    const orderBody = await orderRes.json().catch(() => null);
    check(
      'đặt vé tổng tiền vừa chạm biên -> 201 (đơn lưu được vào DECIMAL(12,2))',
      orderRes.status === 201,
      `nhận ${orderRes.status} — "${(orderBody || {}).message}"`
    );
  }

  // 12. ★ Số vé trong MỘT đơn có trần: controller tạo N bản ghi Ticket trong
  // RAM (Array.from({ length: quantity })), không có trần thì một request có
  // thể làm sập tiến trình Node.
  const tooManyInOneOrder = await post({
    ...base,
    title: 'Don qua nhieu ve',
    ticketTypes: [{ name: 'STANDARD', price: 50000, totalQuantity: 100000 }],
  });
  check(
    'tạo sự kiện có kho vé lớn -> 201 (giới hạn số vé áp cho TỪNG ĐƠN, không cấm kho)',
    tooManyInOneOrder.status === 201,
    `nhận ${tooManyInOneOrder.status} — "${tooManyInOneOrder.message}"`
  );

  if (tooManyInOneOrder.status === 201) {
    const orderRes = await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ticketTypeId: tooManyInOneOrder.ticketTypeId,
        quantity: 101,
      }),
    });
    const orderBody = await orderRes.json().catch(() => null);
    check(
      'đặt 101 vé trong một đơn -> 400 (bảo vệ server khỏi OOM)',
      orderRes.status === 400 && /100/.test((orderBody || {}).message || ''),
      `nhận ${orderRes.status} — "${(orderBody || {}).message}"`
    );
  }

  // Dọn dẹp
  for (const id of created) {
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  // Xoá tài khoản test (đơn hàng đã bị xoá cùng sự kiện).
  await prisma.adminAuditLog
    .deleteMany({ where: { OR: [{ actorId: testUserId }, { targetId: testUserId }] } })
    .catch(() => {});
  await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});

  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
