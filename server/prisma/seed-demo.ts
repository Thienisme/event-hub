import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import { saveImage } from '../src/utils/storage';
import { buildExpiresAt } from '../src/config/order';

const prisma = new PrismaClient();

const PASSWORD = process.env.SEED_DEMO_PASSWORD || 'demo12345';

const ACCOUNTS = [
  { email: 'organizer@eventhub.demo', role: 'ORGANIZER' as const, fullName: 'Saigon Live Events' },
  { email: 'organizer2@eventhub.demo', role: 'ORGANIZER' as const, fullName: 'Hanoi Creative Hub' },
  { email: 'khach@eventhub.demo', role: 'CUSTOMER' as const, fullName: 'Nguyễn Minh Anh' },
];

/** Tiền tố tiêu đề sự kiện test cần dọn khi --purge-test. */
const PURGE_PREFIXES = [
  'E2E ',
  'DIAG ',
  'UI Check ',
  'Final Review ',
  'Tong tien vua cham bien',
  'Gia toi bien',
  'LIFECYCLE',
  'UPLOAD TEST',
  'Live Concert 17',
  'Đêm nhạc Trịnh 17',
  'test1',
];

// Asia/Ho_Chi_Minh = UTC+7, khong DST. Gio VN -> UTC: Date.UTC(y,m,d,h,mi) - 7h.
// Moc thoi gian bat dau/ket thuc lien ket tinh tu Date.now() truc tiep.
const OFFSET_MS = 7 * 60 * 60 * 1000;
const vnNow = (): Date => new Date(Date.now());
const vnLater = (days: number, hour: number, minute: number): Date => {
  const d = new Date(Date.now() + OFFSET_MS);
  d.setUTCDate(d.getUTCDate() + days);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute, 0) - OFFSET_MS);
};

type TicketKind = { name: string; price: number; quantity: number };

type EventInput = {
  organizer: 1 | 2;
  title: string;
  description: string;
  location: string;
  startTime: Date;
  endTime: Date;
  imageUrl: string;
  category: string;
  color1: string;
  color2: string;
  tickets: TicketKind[];
};

const EVENTS: EventInput[] = [
  {
    organizer: 1,
    title: 'Lần Hẹn Hò Acoustic',
    description:
      'Buổi tối nhạc acoustic gắn kết giọng nhạc trẻ Sài Gòn.\n' +
      'Nghe lại các bản hit không điện và ca khúc bản thu nhỏ.\n' +
      'Không gian nhỏ, ánh đèn ấm, chỗ ngồi gần sân khấu.\n' +
      'Số lượng vé hạn chế, hãy đặt sớm để chọn vị trí.\n' +
      'Thời lượng 2 giờ 30 phút, không có intermission.\n',
    location: 'Nhà hát Thành phố Hồ Chí Minh, Quận 1, TP.HCM',
    startTime: vnLater(14, 19, 30),
    endTime: new Date(vnLater(14, 19, 30).getTime() + 2 * 3_600_000 + 30 * 60_000),
    imageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1600&q=80&auto=format&fit=crop',
    category: 'Đêm nhạc acoustic',
    color1: '#7c3aed',
    color2: '#2563eb',
    tickets: [{ name: 'Vé thường', price: 250_000, quantity: 300 }],
  },
  {
    organizer: 1,
    title: 'Workshop Thiết Kế Bản Sắc',
    description:
      'Học tạo bản thiết kế đồ họa từ ý tưởng đến sản phẩm hoàn chỉnh.\n' +
      'Sử dụng công cụ vector hiện đại trong 3 giờ làm việc.\n' +
      'Mỗi học viên mang về một tác phẩm cá nhân.\n' +
      'Phù hợp người mới bắt đầu và sinh viên thiết kế.\n' +
      'Tổng số chỗ chỉ 50, sắp hết vé.\n',
    location: 'GEM Center, Tân Bình, TP.HCM',
    startTime: vnLater(7, 9, 0),
    endTime: new Date(vnLater(7, 9, 0).getTime() + 3 * 3_600_000),
    imageUrl: 'https://images.unsplash.com/photo-1493225362694-68887d91e2c4?w=1600&q=80&auto=format&fit=crop',
    category: 'Workshop thiết kế',
    color1: '#0ea5e9',
    color2: '#0f766e',
    tickets: [{ name: 'Vé tham gia', price: 350_000, quantity: 50 }],
  },
  {
    organizer: 1,
    title: 'Chạy Sáng Thành Phố',
    description:
      'Giải chạy marathon buổi sáng trên phố thành phố.\n' +
      'Hai quãng đường 5 km và 10 km cho mọi lứa tuổi.\n' +
      'Cuộc xuất phát đồng loạt cùng lúc 5 giờ sáng.\n' +
      'Kết thúc tại công viên với booth ăn uống và nhạc live.\n',
    location: 'Công viên Lê Văn Tám, Quận 1, TP.HCM',
    startTime: vnLater(30, 5, 0),
    endTime: new Date(vnLater(30, 5, 0).getTime() + 4 * 3_600_000),
    imageUrl: 'https://images.unsplash.com/photo-1504198395976-e6492c865e0e?w=1600&q=80&auto=format&fit=crop',
    category: 'Giải chạy marathon',
    color1: '#f59e0b',
    color2: '#b45309',
    tickets: [
      { name: 'Vé 5 km', price: 150_000, quantity: 1_200 },
      { name: 'Vé 10 km', price: 200_000, quantity: 800 },
    ],
  },
  {
    organizer: 1,
    title: 'Lễ Hội Ẩm Thực Phố Cũ',
    description:
      'Lễ hội ẩm thực miễn phí tập hợp các quán đường phố nổi tiếng.\n' +
      'Món ngon từ Bắc, Trung, Nam và ẩm thực đường phố Sài Gòn.\n' +
      'Có khu vực giới thiệu, âm nhạc live và lớp ẩm thực thực hành.\n' +
      'Mở cửa từ 10 giờ sáng đến tối, miễn phí vào cửa.\n' +
      'Gia đình và nhóm bạn đều được chào đón.\n',
    location: 'Công viên Tảo Đàn, Quận 1, TP.HCM',
    startTime: vnLater(45, 10, 0),
    endTime: new Date(vnLater(45, 10, 0).getTime() + 8 * 3_600_000),
    imageUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1600&q=80&auto=format&fit=crop',
    category: 'Lễ hội ẩm thực',
    color1: '#e11d48',
    color2: '#be123c',
    tickets: [{ name: 'Vé miễn phí', price: 0, quantity: 1_500 }],
  },
  {
    organizer: 1,
    title: 'Tối Stand-up Sài Gòn',
    description:
      'Tối stand-up với các hài hước sĩ nổi tiếng Sài Gòn.\n' +
      'Câu chuyện đời sự kể thẳng thắn bằng tiếng Việt.\n' +
      'Ghế ngồi sát sân khấu, tương tác trực tiếp với nghệ sĩ.\n' +
      'Không quay video, hãy đến trực tiếp để cười nức nở.\n' +
      'Thời lượng 2 tiếng, không có intermission.\n',
    location: 'Nhà hát IDECAF, Quận 1, TP.HCM',
    startTime: vnLater(21, 20, 0),
    endTime: new Date(vnLater(21, 20, 0).getTime() + 2 * 3_600_000),
    imageUrl: 'https://images.unsplash.com/photo-1514519770310-3f5a5f3c4a7e?w=1600&q=80&auto=format&fit=crop',
    category: 'Stand-up comedy',
    color1: '#db2777',
    color2: '#7c3aed',
    tickets: [{ name: 'Vé ghế thường', price: 180_000, quantity: 200 }],
  },
  {
    organizer: 1,
    title: 'Triển Lãm Sắc Màu',
    description:
      'Triển lãm mỹ thuật đương đại từ các họa sĩ Đông Nam Á.\n' +
      'Sơn mài, lài, ghép hình và tác phẩm tương tác.\n' +
      'Mở cửa 6 tiếng mỗi ngày, quay lại được nhiều lần.\n' +
      'Vé tham quan in mã QR và kiểm soát cửa.\n' +
      'Giới thiệu xu hướng nghệ thuật mới nhất khu vực.\n',
    location: 'Bảo tàng Thành phố Hồ Chí Minh, Quận 1, TP.HCM',
    startTime: vnLater(60, 8, 0),
    endTime: new Date(vnLater(60, 8, 0).getTime() + 6 * 3_600_000),
    imageUrl: 'https://images.unsplash.com/photo-1517246180172-7c399d963161?w=1600&q=80&auto=format&fit=crop',
    category: 'Triển lãm nghệ thuật',
    color1: '#10b981',
    color2: '#047857',
    tickets: [{ name: 'Vé tham quan', price: 120_000, quantity: 400 }],
  },
  {
    organizer: 2,
    title: 'Tối Nhạc Pop Việt Nam',
    description:
      'Tối nhạc pop Việt Nam với các ca sĩ yêu thích.\n' +
      'Nhà hát Lớn Hà Nội, âm thanh và ánh sáng chuyên nghiệp.\n' +
      'Vé thường và vé VIP có chỗ ngồi hạng nhất.\n' +
      'Thời lượng 3 giờ kèm intermission 20 phút.\n' +
      'Điểm dừng cho fan nhạc thành phố.\n',
    location: 'Nhà hát Lớn Hà Nội, Quận Hoàn Kiếm, Hà Nội',
    startTime: vnLater(10, 19, 30),
    endTime: new Date(vnLater(10, 19, 30).getTime() + 3 * 3_600_000 + 20 * 60_000),
    imageUrl: 'https://images.unsplash.com/photo-1459748940418-60727bc043c1?w=1600&q=80&auto=format&fit=crop',
    category: 'Concert',
    color1: '#ef4444',
    color2: '#b91c1c',
    tickets: [
      { name: 'Vé thường', price: 400_000, quantity: 600 },
      { name: 'Vé VIP', price: 750_000, quantity: 200 },
    ],
  },
  {
    organizer: 2,
    title: 'Hội Thảo Web3 & Blockchain',
    description:
      'Hội thảo công nghệ miễn phí tại Trung tâm Hội nghị Quốc gia.\n' +
      'Bao gồm blockchain, tiền mã hóa và ứng dụng Web3.\n' +
      'Gồm bài giảng và bàn tròn với chuyên gia.\n' +
      'Vé miễn phí, đăng ký trước để nhận mã sự kiện.\n' +
      'Thời lượng 4 giờ buổi sáng.\n',
    location: 'Trung tâm Hội nghị Quốc gia, Hà Nội',
    startTime: vnLater(3, 8, 30),
    endTime: new Date(vnLater(3, 8, 30).getTime() + 4 * 3_600_000),
    imageUrl: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?w=1600&q=80&auto=format&fit=crop',
    category: 'Hội thảo công nghệ',
    color1: '#3b82f6',
    color2: '#1d4ed8',
    tickets: [{ name: 'Vé miễn phí', price: 0, quantity: 300 }],
  },
  {
    organizer: 2,
    title: 'Workshop Pha Chế Cà Phê',
    description:
      'Học pha chế cà phê phin và cappuccino tại Cà phê Cống.\n' +
      'Thực hành với barista và mang ly cà phê về nhà.\n' +
      'Chỉ 30 chỗ, dụng cụ được cấp phát miễn phí.\n' +
      'Thời lượng 2 giờ 30 phút buổi chiều.\n' +
      'Phù hợp người mới và những người yêu cà phê.\n',
    location: 'Cà phê Cống, Hà Nội',
    startTime: vnLater(17, 14, 0),
    endTime: new Date(vnLater(17, 14, 0).getTime() + 2 * 3_600_000 + 30 * 60_000),
    imageUrl: 'https://images.unsplash.com/photo-1447933601403-0c668c8d7d5e?w=1600&q=80&auto=format&fit=crop',
    category: 'Workshop pha chế cà phê',
    color1: '#a16207',
    color2: '#713f12',
    tickets: [{ name: 'Vé thực hành', price: 220_000, quantity: 30 }],
  },
  {
    organizer: 2,
    title: 'Hội Chợ Sách Hà Nội',
    description:
      'Hội chợ sách miễn phí tại Văn Miếu - Quốc Tử Giám.\n' +
      'Hàng trăm booth sách mới, sách cũ và sách hiếm.\n' +
      'Gặp gỡ nhà văn và phiên ký tên sách mới.\n' +
      'Mở cửa 7 giờ sáng hàng ngày trong hai cuối tuần.\n' +
      'Gia đình và bạn đọc mọi lứa tuổi.\n',
    location: 'Văn Miếu - Quốc Tử Giám, Hà Nội',
    startTime: vnLater(50, 8, 0),
    endTime: new Date(vnLater(50, 8, 0).getTime() + 7 * 3_600_000),
    imageUrl: 'https://images.unsplash.com/photo-1481627834876-77e0a2a29573?w=1600&q=80&auto=format&fit=crop',
    category: 'Hội chợ sách',
    color1: '#166534',
    color2: '#0f172a',
    tickets: [{ name: 'Vé vào hội', price: 0, quantity: 1_000 }],
  },
  {
    organizer: 2,
    title: 'Festival Nhạc Ngoài Trời',
    description:
      'Festival âm nhạc ngoài trời tại Công viên Bờ Đông Sông Hàn.\n' +
      'Dàn nghệ sĩ dân ca và nhạc điện tử địa phương.\n' +
      'Vé Early Bird và vé thường, chỗ đứng trên cỏ.\n' +
      'Bắt đầu chiều và kéo dài đến đêm.\n' +
      'Sự kiện đang diễn ra và kết thúc sau 5 tiếng nữa.\n',
    location: 'Công viên Bờ Đông Sông Hàn, Đà Nẵng',
    startTime: new Date(vnNow().getTime() - 1 * 3_600_000),
    endTime: new Date(vnNow().getTime() + 5 * 3_600_000),
    imageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1600&q=80&auto=format&fit=crop',
    category: 'Festival âm nhạc ngoài trời',
    color1: '#f59e0b',
    color2: '#d97706',
    tickets: [
      { name: 'Vé Early Bird', price: 250_000, quantity: 400 },
      { name: 'Vé thường', price: 300_000, quantity: 800 },
    ],
  },
  {
    organizer: 2,
    title: 'Kịch Câu Chuyện Phố Phụng',
    description:
      'Kịch-lang giọng kể chuyện phố cổ Hà Nội.\n' +
      'Sân khấu Hồng Hà, ánh sáng và trang phục thời kỳ.\n' +
      'Vé ghế ngồi, thời lượng 2 tiếng 30 phút.\n' +
      'Một đêm về những câu chuyện phố phố.\n' +
      'Sự kiện đã kết thúc và đang lưu trong lịch sử.\n',
    location: 'Sân khấu Hồng Hà, Hà Nội',
    startTime: new Date(vnNow().getTime() - 7 * 86_400_000 - 3 * 3_600_000),
    endTime: new Date(vnNow().getTime() - 7 * 86_400_000 + 1 * 3_600_000),
    imageUrl: 'https://images.unsplash.com/photo-1517434408262-3079792971b9?w=1600&q=80&auto=format&fit=crop',
    category: 'Kịch',
    color1: '#4338ca',
    color2: '#3730a3',
    tickets: [{ name: 'Vé ghế', price: 280_000, quantity: 450 }],
  },
];

const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] ?? c));

const makePoster = (title: string, category: string, color1: string, color2: string): Buffer => {
  const svg = `<svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color1}" />
        <stop offset="100%" stop-color="${color2}" />
      </linearGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#g)" />
    <text x="800" y="420" font-family="sans-serif" font-size="64" font-weight="bold" fill="#ffffff" text-anchor="middle">${escapeXml(title)}</text>
    <text x="800" y="500" font-family="sans-serif" font-size="34" fill="#ffffff" text-anchor="middle">${escapeXml(category)}</text>
    <text x="800" y="545" font-family="sans-serif" font-size="24" fill="#ffffff" text-anchor="middle">Event Hub - Du lieu demo</text>
  </svg>`;
  return Buffer.from(svg, 'utf8');
};

const fetchImage = async (url: string): Promise<Buffer> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
};

/** Tải Unsplash; lỗi thì sinh poster 1600x900 bằng sharp. Cả hai đều qua saveImage. */
const resolveBanner = async (input: EventInput): Promise<{ url: string | null; source: string }> => {
  try {
    const buf = await fetchImage(input.imageUrl);
    const url = await saveImage(buf);
    return { url, source: 'unsplash' };
  } catch {
    // unsplash lỗi -> sinh poster
  }
  try {
    const poster = makePoster(input.title, input.category, input.color1, input.color2);
    const png = await sharp(poster).png().toBuffer();
    const url = await saveImage(png);
    return { url, source: 'poster' };
  } catch {
    return { url: null, source: 'none' };
  }
};

/** Xoá dữ liệu test cũ (tiêu đề khớp tiền tố + tài khoản @test.local). */
async function purgeTestData(yes: boolean): Promise<void> {
  const events = await prisma.event.findMany({
    where: { OR: PURGE_PREFIXES.map((p) => ({ title: { startsWith: p } })) },
    select: { id: true, title: true, organizerId: true },
  });
  const eventIds = events.map((e) => e.id);
  const purgeEventIdSet = new Set(eventIds);

  // Don hang cua cac su kien test bi xoa.
  const eventOrders = await prisma.order.findMany({
    where: { tickets: { some: { ticketType: { eventId: { in: eventIds } } } } },
    select: { id: true },
  });

  const testUsers = await prisma.user.findMany({
    where: { email: { endsWith: '@test.local' } },
    include: { events: { select: { id: true, title: true } }, orders: { select: { id: true } } },
  });

  const testUserOrderIds = testUsers.flatMap((u) => u.orders.map((o) => o.id));
  const allOrderIds = Array.from(new Set([...eventOrders.map((o) => o.id), ...testUserOrderIds]));

  console.log('\n=== DANH SACH SE XOA (dry run) ===');
  console.log(`Su kien khop tien to: ${events.length}`);
  for (const e of events) console.log(`  - ${e.title} (${e.id})`);
  console.log(`Don hang lien quan: ${allOrderIds.length}`);
  console.log(`Tai khoan @test.local: ${testUsers.length}`);
  for (const u of testUsers) console.log(`  - ${u.email} (${u.events.length} su kien, ${u.orders.length} don)`);

  if (!yes) {
    console.log('Day la dry run. Them --yes de thuc hien xoa.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Tra kho don PENDING/CONFIRMED chua ve cua loai ve thuoc su kien KHONG bi xoa,
    // trong cung transaction truoc khi xoa don. Don EXPIRED/CANCELLED da tra kho roi.
    if (allOrderIds.length > 0) {
      const orders = await tx.order.findMany({
        where: { id: { in: allOrderIds } },
        select: {
          id: true,
          status: true,
          tickets: {
            select: {
              ticketTypeId: true,
              ticketType: { select: { id: true, eventId: true } },
            },
          },
        },
      });
      const returnsByType = new Map<string, number>();
      for (const order of orders) {
        if (order.status !== 'PENDING' && order.status !== 'CONFIRMED') continue;
        for (const t of order.tickets) {
          if (purgeEventIdSet.has(t.ticketType.eventId)) continue;
          returnsByType.set(t.ticketTypeId, (returnsByType.get(t.ticketTypeId) ?? 0) + 1);
        }
      }
      for (const [typeId, qty] of returnsByType) {
        await tx.ticketType.update({
          where: { id: typeId },
          data: { availableQuantity: { increment: qty } },
        });
      }
    }

    // Xoa don hang (ve bi xoa theo cascade), sau do xoa su kien.
    if (allOrderIds.length > 0) await tx.order.deleteMany({ where: { id: { in: allOrderIds } } });
    if (eventIds.length > 0) await tx.event.deleteMany({ where: { id: { in: eventIds } } });
  });

  for (const u of testUsers) {
    const hasSurvivor = u.events.some((e) => !purgeEventIdSet.has(e.id));
    if (hasSurvivor) {
      console.warn(`Bo qua ${u.email}: la organizer cua su kien con lai.`);
      continue;
    }
    await prisma.user.delete({ where: { id: u.id } });
    console.log(`  da xoa ${u.email}`);
  }
  console.log('=== XOA HOAN TAT ===');
}

async function main() {
  const args = process.argv.slice(2);
  const purgeTest = args.includes('--purge-test');
  const yes = args.includes('--yes');

  if (purgeTest && process.env.NODE_ENV === 'production') {
    console.error('Tu choi --purge-test khi NODE_ENV=production.');
    process.exitCode = 1;
    return;
  }

  if (purgeTest) {
    await purgeTestData(yes);
    return; // --purge-test la che do RIENG: chi purge, khong seed demo.
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const users: Record<string, { id: string; email: string; role: string; fullName: string }> = {};
  for (const acc of ACCOUNTS) {
    const u = await prisma.user.upsert({
      where: { email: acc.email },
      update: { password: passwordHash, role: acc.role, fullName: acc.fullName, isActive: true },
      create: {
        email: acc.email,
        password: passwordHash,
        role: acc.role,
        fullName: acc.fullName,
        isActive: true,
      },
      select: { id: true, email: true, role: true, fullName: true },
    });
    users[acc.email] = u;
  }
  console.log(`\nDa tao/dat lai ${Object.keys(users).length} tai khoan demo (mat khau: ${PASSWORD})`);

  const org1 = users['organizer@eventhub.demo'].id;
  const org2 = users['organizer2@eventhub.demo'].id;
  const customer = users['khach@eventhub.demo'].id;

  // Chay lai duoc: xoa het su kien cua 2 organizer demo + don hang/ve lien quan, trong 1 transaction.
  const demoEventIds = (
    await prisma.event.findMany({
      where: { organizerId: { in: [org1, org2] } },
      select: { id: true },
    })
  ).map((e) => e.id);
  const demoOrderIds = (
    await prisma.order.findMany({
      where: { tickets: { some: { ticketType: { eventId: { in: demoEventIds } } } } },
      select: { id: true },
    })
  ).map((o) => o.id);
  await prisma.$transaction(async (tx) => {
    if (demoOrderIds.length > 0) await tx.order.deleteMany({ where: { id: { in: demoOrderIds } } });
    if (demoEventIds.length > 0) await tx.event.deleteMany({ where: { id: { in: demoEventIds } } });
  });
  console.log(`Da xoa ${demoEventIds.length} su kien demo cu (va ${demoOrderIds.length} don lien quan).`);

  // Tao 12 su kien.
  const createdEvents: Array<{
    id: string;
    title: string;
    ticketTypes: { id: string; name: string }[];
  }> = [];
  for (const input of EVENTS) {
    const { url, source } = await resolveBanner(input);
    console.log(`  banner ${input.title}: ${source}`);
    const event = await prisma.event.create({
      data: {
        title: input.title,
        description: input.description,
        location: input.location,
        bannerUrl: url,
        startTime: input.startTime,
        endTime: input.endTime,
        organizerId: input.organizer === 1 ? org1 : org2,
        ticketTypes: {
          create: input.tickets.map((t) => ({
            name: t.name,
            price: new Prisma.Decimal(t.price),
            totalQuantity: t.quantity,
            availableQuantity: t.quantity,
          })),
        },
      },
      include: { ticketTypes: true },
    });
    createdEvents.push({
      id: event.id,
      title: event.title,
      ticketTypes: event.ticketTypes.map((t) => ({ id: t.id, name: t.name })),
    });
  }
  console.log(`\nDa tao ${createdEvents.length} su kien.`);

  const typeByEventAndName = new Map<string, Map<string, string>>();
  const priceByEventAndName = new Map<string, Map<string, number>>();
  for (const input of EVENTS) {
    const typeMap = new Map<string, string>();
    const priceMap = new Map<string, number>();
    const created = createdEvents.find((e) => e.title === input.title);
    for (const t of created!.ticketTypes) typeMap.set(t.name, t.id);
    for (const t of input.tickets) priceMap.set(t.name, t.price);
    typeByEventAndName.set(input.title, typeMap);
    priceByEventAndName.set(input.title, priceMap);
  }

  const tenMinLater = buildExpiresAt();

  // Du lieu ban ve: 4 don CONFIRMED, su kien sap het ve (50 tong, con 3), 1 don PENDING dem chuong ngoc.
  await prisma.$transaction(async (tx) => {
    const placeConfirmed = async (eventTitle: string, typeName: string, qty: number) => {
      const typeId = typeByEventAndName.get(eventTitle)!.get(typeName)!;
      const price = priceByEventAndName.get(eventTitle)!.get(typeName)!;
      const totalAmount = new Prisma.Decimal(price).mul(qty);
      await tx.order.create({
        data: {
          userId: customer,
          totalAmount,
          status: 'CONFIRMED',
          expiresAt: null,
          tickets: {
            create: Array.from({ length: qty }, () => ({
              qrCode: randomBytes(16).toString('base64url'),
              ticketType: { connect: { id: typeId } },
            })),
          },
        },
      });
      await tx.ticketType.update({
        where: { id: typeId },
        data: { availableQuantity: { decrement: qty } },
      });
    };

    await placeConfirmed('Lần Hẹn Hò Acoustic', 'Vé thường', 2);
    await placeConfirmed('Chạy Sáng Thành Phố', 'Vé 10 km', 1);
    await placeConfirmed('Tối Nhạc Pop Việt Nam', 'Vé VIP', 2);
    await placeConfirmed('Festival Nhạc Ngoài Trời', 'Vé Early Bird', 3);

    // Su kien sap het ve: tong 50, dat 47, con 3.
    await placeConfirmed('Workshop Thiết Kế Bản Sắc', 'Vé tham gia', 20);
    await placeConfirmed('Workshop Thiết Kế Bản Sắc', 'Vé tham gia', 15);
    await placeConfirmed('Workshop Thiết Kế Bản Sắc', 'Vé tham gia', 12);

    // Don PENDING de demo dong ho dem nguoc (het han sau 10 phut).
    const pendingTypeId = typeByEventAndName.get('Tối Nhạc Pop Việt Nam')!.get('Vé thường')!;
    const pendingPrice = priceByEventAndName.get('Tối Nhạc Pop Việt Nam')!.get('Vé thường')!;
    const pendingTotal = new Prisma.Decimal(pendingPrice).mul(1);
    await tx.order.create({
      data: {
        userId: customer,
        totalAmount: pendingTotal,
        status: 'PENDING',
        expiresAt: tenMinLater,
        tickets: {
          create: [{ ticketType: { connect: { id: pendingTypeId } } }],
        },
      },
    });
    await tx.ticketType.update({
      where: { id: pendingTypeId },
      data: { availableQuantity: { decrement: 1 } },
    });
  });

  // Tang version cache danh sach su kien (fail-open, khong treo tien trinh).
  const cacheRedis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    lazyConnect: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    commandTimeout: 3000,
  });
  try {
    await cacheRedis.incr('events:list:v');
    console.log('\nDa tang version cache danh sach su kien (events:list:v).');
  } catch {
    // Redis khong duoc lam hỏng script.
  } finally {
    try {
      await cacheRedis.disconnect();
    } catch {
      // bo qua loi ngat ket noi Redis.
    }
  }

  const demoOrderCount = await prisma.order.count({ where: { userId: customer } });

  console.log('\n=== TOM TAT DU LIEU DEMO ===');
  console.log(`Su kien: ${createdEvents.length}`);
  console.log(`Don hang demo (khach@eventhub.demo): ${demoOrderCount}`);
  console.log(`\nTai khoan demo (mat khau: ${PASSWORD}):`);
  for (const acc of ACCOUNTS) {
    const u = users[acc.email];
    console.log(`  - ${u.email} | ${acc.role} | ${u.fullName}`);
  }
  console.log('\nChay lai script bat cu luc nao de dat lai du lieu demo.');
}

main()
  .catch((error) => {
    console.error('Seed-demo that bai:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
