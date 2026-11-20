import 'dotenv/config';
import { randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import Redis from 'ioredis';
import {
  PrismaClient,
  Prisma,
  EventCategory,
  DiscountType,
  OrderStatus,
  Role,
} from '@prisma/client';
import { createEventSlug } from '../src/utils/slug';
import { ensureUploadDir, saveImage } from '../src/utils/storage';
import { buildExpiresAt, MAX_TICKETS_PER_USER_PER_EVENT } from '../src/config/order';
import { computeDiscount } from '../src/utils/promo';
import storagePrisma from '../src/utils/prisma';

// Seed có thể chạy từ máy cá nhân tới database ở vùng khác (ví dụ TiDB Singapore), mỗi câu lệnh
// mất 50-100ms đi về, nên tăng giới hạn chờ và timeout giao dịch so với mặc định 5 giây của Prisma.
const prisma = new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } });

const PASSWORD = process.env.SEED_DEMO_PASSWORD || 'demo12345';

// Asia/Ho_Chi_Minh = UTC+7, không DST. Giờ VN -> UTC: Date.UTC(y, m, d, h, mi) - 7h.
const OFFSET_MS = 7 * 60 * 60 * 1000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Bộ sinh số giả ngẫu nhiên mulberry32 cố định seed để chạy lại ra cùng phân phối dữ liệu. */
const createMulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const rng = createMulberry32(2026);
const randInt = (min: number, max: number): number => Math.floor(rng() * (max - min + 1)) + min;
const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)];

const vnAt = (baseNowMs: number, daysOffset: number, hour: number, minute: number): Date => {
  const d = new Date(baseNowMs + OFFSET_MS);
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute, 0) - OFFSET_MS
  );
};

type AccountInput = {
  email: string;
  role: Role;
  fullName: string;
};

// Gồm 3 tài khoản gốc từ seed-demo (chỉ tạo nếu chưa có, không bao giờ sửa tài khoản đã tồn tại),
// cộng thêm 2 nhà tổ chức mới và 12 khách hàng mới.
const ACCOUNTS: readonly AccountInput[] = [
  { email: 'organizer@eventhub.demo', role: 'ORGANIZER', fullName: 'Saigon Live Events' },
  { email: 'organizer2@eventhub.demo', role: 'ORGANIZER', fullName: 'Hanoi Creative Hub' },
  { email: 'organizer3@eventhub.demo', role: 'ORGANIZER', fullName: 'Đà Nẵng Fest' },
  { email: 'organizer4@eventhub.demo', role: 'ORGANIZER', fullName: 'Huế Văn Hoá' },
  { email: 'khach@eventhub.demo', role: 'CUSTOMER', fullName: 'Nguyễn Minh Anh' },
  { email: 'khach2@eventhub.demo', role: 'CUSTOMER', fullName: 'Trần Thu Hà' },
  { email: 'khach3@eventhub.demo', role: 'CUSTOMER', fullName: 'Lê Quốc Bảo' },
  { email: 'khach4@eventhub.demo', role: 'CUSTOMER', fullName: 'Phạm Ngọc Hân' },
  { email: 'khach5@eventhub.demo', role: 'CUSTOMER', fullName: 'Hoàng Đức Mạnh' },
  { email: 'khach6@eventhub.demo', role: 'CUSTOMER', fullName: 'Vũ Thanh Trúc' },
  { email: 'khach7@eventhub.demo', role: 'CUSTOMER', fullName: 'Đặng Minh Quân' },
  { email: 'khach8@eventhub.demo', role: 'CUSTOMER', fullName: 'Bùi Khánh Linh' },
  { email: 'khach9@eventhub.demo', role: 'CUSTOMER', fullName: 'Đỗ Hải Đăng' },
  { email: 'khach10@eventhub.demo', role: 'CUSTOMER', fullName: 'Ngô Phương Thảo' },
  { email: 'khach11@eventhub.demo', role: 'CUSTOMER', fullName: 'Dương Gia Huy' },
  { email: 'khach12@eventhub.demo', role: 'CUSTOMER', fullName: 'Lý Hồng Nhung' },
  { email: 'khach13@eventhub.demo', role: 'CUSTOMER', fullName: 'Tô Tuấn Kiệt' },
];

const CUSTOMER_EMAILS: readonly string[] = [
  'khach@eventhub.demo',
  'khach2@eventhub.demo',
  'khach3@eventhub.demo',
  'khach4@eventhub.demo',
  'khach5@eventhub.demo',
  'khach6@eventhub.demo',
  'khach7@eventhub.demo',
  'khach8@eventhub.demo',
  'khach9@eventhub.demo',
  'khach10@eventhub.demo',
  'khach11@eventhub.demo',
  'khach12@eventhub.demo',
  'khach13@eventhub.demo',
];

const CATEGORY_COLORS: Record<EventCategory, [string, string]> = {
  MUSIC: ['#7c3aed', '#2563eb'],
  SPORTS: ['#f59e0b', '#b45309'],
  WORKSHOP: ['#0ea5e9', '#0f766e'],
  FOOD: ['#e11d48', '#be123c'],
  CONFERENCE: ['#3b82f6', '#1d4ed8'],
  FESTIVAL: ['#16a34a', '#065f46'],
  EXHIBITION: ['#10b981', '#047857'],
  THEATER: ['#db2777', '#7c3aed'],
  OTHER: ['#475569', '#1e293b'],
};

type EventPhase = 'upcoming' | 'ongoing' | 'ended';
type StockMode = 'normal' | 'nearly_sold_out' | 'sold_out';

type TicketKind = {
  name: string;
  price: number;
  quantity: number;
  saleStart?: Date;
};

type PromoInput = {
  code: string;
  discountType: DiscountType;
  discountValue: number;
  maxUses: number;
  perUserLimit: number;
};

type EventInput = {
  organizerEmail: string;
  phase: EventPhase;
  stockMode: StockMode;
  targetRemaining?: number;
  title: string;
  description: string;
  location: string;
  startTime: Date;
  endTime: Date;
  imageUrl: string;
  category: EventCategory;
  tickets: TicketKind[];
  promo?: PromoInput;
};

/** 2 sự kiện sắp diễn ra của organizer@ được gán nhân viên soát vé (khach2@, khach3@). */
const STAFF_EVENT_TITLES = [
  'Đêm Nhạc Trịnh Giữa Lòng Sài Gòn',
  'Giải Chạy Cầu Cần Thơ',
] as const;

const STAFF_EMAILS = ['khach2@eventhub.demo', 'khach3@eventhub.demo'] as const;

const buildEvents = (nowMs: number): EventInput[] => {
  const later = (days: number, hour: number, minute: number) => vnAt(nowMs, days, hour, minute);

  // 24 sự kiện: 15 sắp diễn ra (1-90 ngày tới), 2 đang diễn ra, 7 đã kết thúc (7-120 ngày trước);
  // chia đều cho 4 nhà tổ chức (mỗi người 6 sự kiện), đủ 9 danh mục và 8 thành phố lớn.
  return [
    // --- 15 SỰ KIỆN SẮP DIỄN RA ---
    {
      organizerEmail: 'organizer@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'normal',
      title: 'Đêm Nhạc Trịnh Giữa Lòng Sài Gòn',
      description:
        'Đêm nhạc tưởng nhớ nhạc sĩ Trịnh Công Sơn với dàn nhạc bán cổ điển và các giọng ca quen thuộc.\n' +
        'Không gian Nhà hát Bến Thành được dàn dựng tối giản với ánh đèn vàng ấm cúng.\n' +
        'Khán giả được lắng nghe hơn hai mươi nhạc phẩm bất hủ phối khí mới hoàn toàn.\n' +
        'Cửa soát vé mở trước giờ diễn 45 phút, vui lòng chuẩn bị sẵn mã QR trên điện thoại.\n',
      location: 'Nhà hát Bến Thành, Quận 1, TP.HCM',
      startTime: later(18, 19, 30),
      endTime: new Date(later(18, 19, 30).getTime() + 2.5 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1600&q=80&auto=format&fit=crop',
      category: 'MUSIC',
      tickets: [
        { name: 'Vé Phổ Thông', price: 350_000, quantity: 400 },
        { name: 'Vé Hạng Nhất', price: 650_000, quantity: 150 },
        { name: 'Vé VIP Đợt 2', price: 1_200_000, quantity: 80, saleStart: later(5, 10, 0) },
      ],
      promo: { code: 'GIAM10', discountType: 'PERCENT', discountValue: 10, maxUses: 50, perUserLimit: 2 },
    },
    {
      organizerEmail: 'organizer@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'sold_out',
      title: 'Đêm Indie Trên Đồi Thông Đà Lạt',
      description:
        'Buổi biểu diễn nhạc indie ngoài trời giữa tiết trời se lạnh buổi chiều tà Đà Lạt.\n' +
        'Ba ban nhạc trẻ mang đến những ca khúc tự sáng tác mộc mạc cùng phần giao lưu gần gũi.\n' +
        'Mỗi vé bao gồm một ly trà gừng nóng và chỗ ngồi trên khu vực sân cỏ nhìn ra hồ Xuân Hương.\n' +
        'Sức chứa giới hạn đúng 50 khán giả để giữ trọn vẹn âm thanh tự nhiên.\n',
      location: 'Quảng trường Lâm Viên, Phường 10, Đà Lạt',
      startTime: later(8, 18, 30),
      endTime: new Date(later(8, 18, 30).getTime() + 3 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1600&q=80&auto=format&fit=crop',
      category: 'MUSIC',
      tickets: [{ name: 'Vé Sân Cỏ', price: 280_000, quantity: 50 }],
    },
    {
      organizerEmail: 'organizer@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'normal',
      title: 'Giải Chạy Cầu Cần Thơ',
      description:
        'Giải chạy phong trào quy mô miền Tây với cung đường ven sông Hậu rợp bóng cây xanh.\n' +
        'Ba cự ly 5 km, 10 km và 21 km phù hợp từ người mới tập đến vận động viên bán chuyên.\n' +
        'Toàn bộ người tham gia nhận bộ race-kit gồm áo đấu, số BIB gắn chip và huy chương hoàn thành.\n' +
        'Các trạm tiếp nước và đội ngũ y tế bố trí dọc toàn tuyến cách nhau 2 km.\n',
      location: 'Công viên Sông Hậu, Quận Ninh Kiều, Cần Thơ',
      startTime: later(22, 5, 30),
      endTime: new Date(later(22, 5, 30).getTime() + 4.5 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?w=1600&q=80&auto=format&fit=crop',
      category: 'SPORTS',
      tickets: [
        { name: 'Cự ly 5 km', price: 180_000, quantity: 800 },
        { name: 'Cự ly 10 km', price: 280_000, quantity: 500 },
        { name: 'Cự ly 21 km', price: 450_000, quantity: 300 },
      ],
      promo: { code: 'UUDAI20', discountType: 'PERCENT', discountValue: 20, maxUses: 45, perUserLimit: 1 },
    },
    {
      organizerEmail: 'organizer2@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'normal',
      title: 'Diễn Đàn AI & Sản Phẩm Số Việt Nam',
      description:
        'Hội nghị chuyên sâu kết nối kỹ sư trí tuệ nhân tạo, quản lý sản phẩm và lãnh đạo công nghệ.\n' +
        'Chương trình gồm sáu bài tham luận thực chiến về triển khai mô hình ngôn ngữ lớn trong doanh nghiệp.\n' +
        'Buổi chiều có phiên thảo luận mở và khu vực trình diễn sản phẩm từ hai mươi đội ngũ trong nước.\n' +
        'Vé doanh nghiệp bao gồm tiệc trưa kết nối và bộ tài liệu tổng hợp sau hội nghị.\n',
      location: 'Cung Văn hóa Hữu nghị Việt Xô, Quận Hoàn Kiếm, Hà Nội',
      startTime: later(25, 8, 30),
      endTime: new Date(later(25, 8, 30).getTime() + 8 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1600&q=80&auto=format&fit=crop',
      category: 'CONFERENCE',
      tickets: [
        { name: 'Vé Tiêu Chuẩn', price: 450_000, quantity: 500 },
        { name: 'Vé Doanh Nghiệp', price: 1_500_000, quantity: 120 },
      ],
      promo: { code: 'EARLY50K', discountType: 'FIXED', discountValue: 50_000, maxUses: 40, perUserLimit: 1 },
    },
    {
      organizerEmail: 'organizer2@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'nearly_sold_out',
      targetRemaining: 3,
      title: 'Workshop Nhiếp Ảnh Phố Cổ Hà Nội',
      description:
        'Buổi thực hành chụp ảnh đường phố buổi sáng cùng nhiếp ảnh gia tư liệu nhiều năm kinh nghiệm.\n' +
        'Học viên được hướng dẫn cách đón ánh sáng tự nhiên, chọn bố cục và ghi lại nhịp sống phố phường.\n' +
        'Sau hai giờ đi thực địa quanh khu phố cổ, cả lớp quay lại quán trà để nhận xét từng bộ ảnh.\n' +
        'Bạn có thể mang theo máy ảnh ống kính rời hoặc điện thoại thông minh đều tham gia được.\n',
      location: 'Phố đi bộ Hồ Gươm, Quận Hoàn Kiếm, Hà Nội',
      startTime: later(4, 7, 30),
      endTime: new Date(later(4, 7, 30).getTime() + 3.5 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1452587925148-ce544e77e70d?w=1600&q=80&auto=format&fit=crop',
      category: 'WORKSHOP',
      tickets: [{ name: 'Vé Học Viên', price: 320_000, quantity: 50 }],
    },
    {
      organizerEmail: 'organizer3@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'normal',
      title: 'Giải Chạy Đường Biển Nha Trang',
      description:
        'Chinh phục cung đường ven vịnh biển Trần Phú trong ánh bình minh rực rỡ của Nha Trang.\n' +
        'Đường chạy phẳng, rộng rãi và được đóng hoàn toàn để bảo đảm an toàn cho vận động viên.\n' +
        'Khu vực đích đến có quầy trái cây nhiệt đới, khu giãn cơ và không gian chụp ảnh lưu niệm.\n' +
        'Đợt mở bán thứ hai cho cự ly 42 km sẽ bắt đầu sau mười ngày nữa.\n',
      location: 'Quảng trường 2 Tháng 4, Phường Lộc Thọ, Nha Trang',
      startTime: later(42, 5, 0),
      endTime: new Date(later(42, 5, 0).getTime() + 5 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=1600&q=80&auto=format&fit=crop',
      category: 'SPORTS',
      tickets: [
        { name: 'Cự ly 10 km', price: 320_000, quantity: 1_000 },
        { name: 'Cự ly 21 km', price: 550_000, quantity: 600 },
        { name: 'Cự ly 42 km - Đợt 2', price: 850_000, quantity: 250, saleStart: later(10, 9, 0) },
      ],
    },
    {
      organizerEmail: 'organizer3@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'normal',
      title: 'Lễ Hội Ánh Sáng & Âm Nhạc Sông Hàn',
      description:
        'Đêm hội âm nhạc điện tử kết hợp trình diễn ánh sáng nghệ thuật trên bầu trời sông Hàn.\n' +
        'Sân khấu ngoài trời quy tụ nhiều DJ hàng đầu cùng các ca sĩ khách mời được yêu thích.\n' +
        'Khu vực khán đài có tầm nhìn thoáng toàn cảnh sân khấu và màn trình diễn drone nghệ thuật.\n' +
        'Khán giả nên đến sớm từ 16 giờ để tham gia khu ẩm thực và hoạt động chụp ảnh check-in.\n',
      location: 'Công viên Biển Đông, Quận Sơn Trà, Đà Nẵng',
      startTime: later(35, 16, 0),
      endTime: new Date(later(35, 16, 0).getTime() + 6 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1600&q=80&auto=format&fit=crop',
      category: 'FESTIVAL',
      tickets: [
        { name: 'Vé Phổ Thông', price: 250_000, quantity: 1_500 },
        { name: 'Vé Khán Đài', price: 600_000, quantity: 400 },
        { name: 'Vé Lounge VIP', price: 1_800_000, quantity: 100 },
      ],
      promo: { code: 'DANANG15', discountType: 'PERCENT', discountValue: 15, maxUses: 60, perUserLimit: 2 },
    },
    {
      organizerEmail: 'organizer3@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'normal',
      title: 'Lễ Hội Hải Sản Biển Đông Đà Nẵng',
      description:
        'Hơn sáu mươi gian hàng giới thiệu hải sản tươi sống và đặc sản miền Trung chế biến tại chỗ.\n' +
        'Khách tham quan vào cổng miễn phí hoặc chọn vé combo để thưởng thức năm món tuyển chọn của đầu bếp.\n' +
        'Sân khấu giữa quảng trường có biểu diễn nhạc dân gian và phần thi chế biến món ăn nhanh.\n' +
        'Không gian thoáng gió biển, rất phù hợp cho gia đình và nhóm bạn dịp cuối tuần.\n',
      location: 'Trung tâm Hội chợ Triển lãm Đà Nẵng, Quận Cẩm Lệ, Đà Nẵng',
      startTime: later(14, 17, 0),
      endTime: new Date(later(14, 17, 0).getTime() + 5 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1600&q=80&auto=format&fit=crop',
      category: 'FOOD',
      tickets: [
        { name: 'Vé Vào Cổng Miễn Phí', price: 0, quantity: 2_000 },
        { name: 'Vé Combo Thưởng Vị', price: 390_000, quantity: 400 },
      ],
    },
    {
      organizerEmail: 'organizer2@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'sold_out',
      title: 'Workshop Làm Gốm Thủ Công Duyên Hải',
      description:
        'Trải nghiệm trọn vẹn quy trình tạo hình đất sét trên bàn xoay cùng nghệ nhân gốm truyền thống.\n' +
        'Mỗi học viên tự tay nặn và vẽ men hai sản phẩm cốc hoặc đĩa mang dấu ấn cá nhân.\n' +
        'Toàn bộ nguyên liệu đất, màu men và chi phí nung lò hoàn thiện đã bao gồm trong giá vé.\n' +
        'Thành phẩm sau khi nung sẽ được đóng gói cẩn thận và gửi tận nhà sau bảy ngày.\n',
      location: 'Cung Văn hóa Lao động Hữu nghị Việt Tiệp, Quận Ngô Quyền, Hải Phòng',
      startTime: later(11, 14, 0),
      endTime: new Date(later(11, 14, 0).getTime() + 3 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=1600&q=80&auto=format&fit=crop',
      category: 'WORKSHOP',
      tickets: [{ name: 'Vé Trải Nghiệm', price: 240_000, quantity: 55 }],
    },
    {
      organizerEmail: 'organizer4@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'normal',
      title: 'Đêm Nhã Nhạc & Tuồng Cổ Cung Đình',
      description:
        'Chương trình nghệ thuật truyền thống tái hiện không gian âm nhạc và sân khấu tuồng cổ xứ Huế.\n' +
        'Các nghệ sĩ Nhà hát Nghệ thuật Truyền thống Cung đình Huế trình diễn nguyên bản nhiều trích đoạn kinh điển.\n' +
        'Hệ thống phụ đề song ngữ Việt - Anh giúp khán giả trẻ và du khách dễ dàng theo dõi cốt truyện.\n' +
        'Trước giờ diễn có khu trưng bày trang phục, mặt nạ tuồng và nhạc cụ dân tộc tại sảnh chính.\n',
      location: 'Nhà hát Sông Hương, Phường Vĩnh Ninh, Huế',
      startTime: later(28, 19, 30),
      endTime: new Date(later(28, 19, 30).getTime() + 2.5 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=1600&q=80&auto=format&fit=crop',
      category: 'THEATER',
      tickets: [
        { name: 'Vé Ghế Thường', price: 300_000, quantity: 300 },
        { name: 'Vé Ghế Vàng', price: 650_000, quantity: 100 },
      ],
      promo: { code: 'HUE80K', discountType: 'FIXED', discountValue: 80_000, maxUses: 30, perUserLimit: 1 },
    },
    {
      organizerEmail: 'organizer3@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'nearly_sold_out',
      targetRemaining: 4,
      title: 'Đêm Nhạc Jazz Bên Bờ Sông Hàn',
      description:
        'Tối nhạc jazz ngẫu hứng với tứ tấu saxophone, piano, contrabass và trống trong khán phòng ấm cúng.\n' +
        'Chương trình kết hợp các bản jazz cổ điển thế giới với giai điệu Việt Nam được phối lại tinh tế.\n' +
        'Mỗi vé bao gồm một phần đồ uống không cồn hoặc rượu vang chào mừng tại quầy sảnh.\n' +
        'Phòng hòa nhạc chỉ mở bán 60 chỗ để đảm bảo chất lượng âm thanh mộc chuẩn xác.\n',
      location: 'Nhà hát Trưng Vương, Quận Hải Châu, Đà Nẵng',
      startTime: later(9, 20, 0),
      endTime: new Date(later(9, 20, 0).getTime() + 2.5 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1600&q=80&auto=format&fit=crop',
      category: 'MUSIC',
      tickets: [{ name: 'Vé Khán Phòng', price: 420_000, quantity: 60 }],
    },
    {
      organizerEmail: 'organizer4@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'normal',
      title: 'Lễ Hội Hoa Đăng Sông Hương',
      description:
        'Hàng nghìn chiếc đèn hoa đăng thủ công sẽ được thắp sáng và thả trôi dọc dòng sông Hương thơ mộng.\n' +
        'Dọc bờ bắc có khu gian hàng làm đèn lồng giấy, biểu diễn ca Huế và trà sen truyền thống.\n' +
        'Du khách có thể chọn vé bờ bắc ngắm cảnh hoặc chờ đợt mở bán vé ngồi thuyền rồng giữa dòng.\n' +
        'Toàn bộ hoa đăng đều làm từ giấy phân hủy sinh học thân thiện với môi trường sông nước.\n',
      location: 'Công viên Thương Bạc, Phường Đông Ba, Huế',
      startTime: later(55, 18, 0),
      endTime: new Date(later(55, 18, 0).getTime() + 4 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=1600&q=80&auto=format&fit=crop',
      category: 'FESTIVAL',
      tickets: [
        { name: 'Vé Khu Vực Bờ Bắc', price: 120_000, quantity: 1_200 },
        { name: 'Vé Du Thuyền Thả Đèn', price: 480_000, quantity: 120, saleStart: later(12, 8, 0) },
      ],
    },
    {
      organizerEmail: 'organizer4@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'normal',
      title: 'Triển Lãm Pháp Lam & Cổ Vật Triều Nguyễn',
      description:
        'Trưng bày hơn một trăm hiện vật pháp lam Huế, gốm ký kiểu và bản vẽ kiến trúc cung đình quý hiếm.\n' +
        'Không gian triển lãm ứng dụng công nghệ chiếu sáng bảo tàng giúp người xem quan sát rõ từng lớp men.\n' +
        'Vé thuyết minh chuyên sâu đi kèm tai nghe hướng dẫn và buổi trò chuyện cùng nhà nghiên cứu di sản.\n' +
        'Triển lãm mở cửa liên tục trong ngày, phù hợp cho sinh viên nghiên cứu và du khách yêu lịch sử.\n',
      location: 'Cung An Định, Phường An Cựu, Huế',
      startTime: later(65, 9, 0),
      endTime: new Date(later(65, 9, 0).getTime() + 8 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=1600&q=80&auto=format&fit=crop',
      category: 'EXHIBITION',
      tickets: [
        { name: 'Vé Tham Quan', price: 90_000, quantity: 800 },
        { name: 'Vé Thuyết Minh Chuyên Sâu', price: 220_000, quantity: 150 },
      ],
    },
    {
      organizerEmail: 'organizer@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'normal',
      title: 'Hội Nghị Khởi Nghiệp Công Nghệ Đông Nam Á',
      description:
        'Sự kiện kết nối các nhà sáng lập công nghệ trẻ với hơn ba mươi quỹ đầu tư trong khu vực.\n' +
        'Mười hai dự án khởi nghiệp xuất sắc sẽ trình bày trực tiếp trước hội đồng giám khảo quốc tế.\n' +
        'Khu vực sảnh triển lãm mở cơ hội tuyển dụng, trao đổi đối tác và trải nghiệm sản phẩm mới.\n' +
        'Vé kết nối nhà đầu tư bao gồm lịch hẹn một-một và tiệc tối giao lưu cuối ngày.\n',
      location: 'Trung tâm Triển lãm SECC, Quận 7, TP.HCM',
      startTime: later(16, 9, 0),
      endTime: new Date(later(16, 9, 0).getTime() + 7 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=1600&q=80&auto=format&fit=crop',
      category: 'CONFERENCE',
      tickets: [
        { name: 'Vé Tham Dự', price: 500_000, quantity: 300 },
        { name: 'Vé Kết Nối Nhà Đầu Tư', price: 2_500_000, quantity: 80 },
      ],
    },
    {
      organizerEmail: 'organizer4@eventhub.demo',
      phase: 'upcoming',
      stockMode: 'normal',
      title: 'Đêm Ngắm Sao & Giao Lưu Thiên Văn Cao Nguyên',
      description:
        'Hoạt động quan sát bầu trời đêm trên vùng cao nguyên ít ô nhiễm ánh sáng cùng câu lạc bộ thiên văn.\n' +
        'Người tham gia được hướng dẫn nhận diện chòm sao, ngắm tinh vân và chụp ảnh dải ngân hà.\n' +
        'Ban tổ chức chuẩn bị sẵn kính thiên văn phản xạ cỡ lớn, đèn đỏ chuyên dụng và nước ấm.\n' +
        'Vui lòng mang theo áo khoác ấm và giày thể thao để di chuyển thuận tiện trên đồi cỏ.\n',
      location: 'Đồi Chè Cầu Đất, Xã Xuân Trường, Đà Lạt',
      startTime: later(75, 19, 0),
      endTime: new Date(later(75, 19, 0).getTime() + 3.5 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1600&q=80&auto=format&fit=crop',
      category: 'OTHER',
      tickets: [
        { name: 'Vé Cắm Trại Ngắm Sao', price: 180_000, quantity: 150 },
        { name: 'Vé Kèm Hướng Dẫn Kính Thiên Văn', price: 350_000, quantity: 60 },
      ],
    },

    // --- 2 SỰ KIỆN ĐANG DIỄN RA ---
    {
      organizerEmail: 'organizer@eventhub.demo',
      phase: 'ongoing',
      stockMode: 'normal',
      title: 'Ngày Hội Cà Phê Đặc Sản Sài Gòn',
      description:
        'Quy tụ bốn mươi xưởng rang xay và nông trại cà phê từ Lâm Đồng, Đắk Lắk và Sơn La.\n' +
        'Khách tham quan được nếm thử miễn phí hàng chục dòng cà phê pha máy, pour-over và ủ lạnh.\n' +
        'Khu cupping chuyên gia tổ chức các phiên thử nếm mù theo khung giờ suốt cả buổi.\n' +
        'Sự kiện đang diễn ra sôi nổi tại công viên ven sông với không gian thoáng mát.\n',
      location: 'Công viên Bờ sông Sài Gòn, TP. Thủ Đức, TP.HCM',
      startTime: new Date(nowMs - 2 * HOUR_MS),
      endTime: new Date(nowMs + 4 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1600&q=80&auto=format&fit=crop',
      category: 'FOOD',
      tickets: [
        { name: 'Vé Tham Quan', price: 80_000, quantity: 1_000 },
        { name: 'Vé Cupping Chuyên Gia', price: 260_000, quantity: 200 },
      ],
    },
    {
      organizerEmail: 'organizer3@eventhub.demo',
      phase: 'ongoing',
      stockMode: 'normal',
      title: 'Triển Lãm Ảnh Phố Cảng Xưa Và Nay',
      description:
        'Bộ sưu tập hai trăm bức ảnh tư liệu và ảnh đương đại ghi lại hành trình chuyển mình của thành phố cảng.\n' +
        'Tác phẩm được in khổ lớn trên giấy mỹ thuật, chia thành ba chủ đề kiến trúc, bến cảng và đời sống.\n' +
        'Cửa vào mở miễn phí cho mọi công dân, kèm lựa chọn đặt trước ấn phẩm sách ảnh in giới hạn.\n' +
        'Sự kiện đang mở cửa đón khách tham quan và giao lưu trực tiếp với các tác giả ảnh.\n',
      location: 'Nhà hát Lớn Hải Phòng, Quận Hồng Bàng, Hải Phòng',
      startTime: new Date(nowMs - 3 * HOUR_MS),
      endTime: new Date(nowMs + 3 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1531243269054-5ebf6f34081e?w=1600&q=80&auto=format&fit=crop',
      category: 'EXHIBITION',
      tickets: [
        { name: 'Vé Vào Cửa Miễn Phí', price: 0, quantity: 600 },
        { name: 'Vé Kèm Sách Ảnh Kỷ Niệm', price: 190_000, quantity: 150 },
      ],
    },

    // --- 7 SỰ KIỆN ĐÃ KẾT THÚC (7-120 NGÀY TRƯỚC) ---
    {
      organizerEmail: 'organizer@eventhub.demo',
      phase: 'ended',
      stockMode: 'normal',
      title: 'Vở Kịch Chuyến Tàu Đêm Phương Nam',
      description:
        'Vở chính kịch giàu cảm xúc kể về những cuộc gặp gỡ định mệnh trên chuyến tàu Bắc - Nam thập niên 90.\n' +
        'Thiết kế sân khấu xoay sống động tái hiện toa tàu gỗ, sân ga mưa đêm và tiếng còi tàu vang vọng.\n' +
        'Đội ngũ diễn viên giàu nội lực mang đến ba giờ diễn đầy nước mắt và tiếng cười lắng đọng.\n' +
        'Suất diễn đã khép lại thành công với sự hưởng ứng nồng nhiệt từ khán giả thành phố.\n',
      location: 'Bảo tàng Mỹ thuật TP.HCM, Quận 1, TP.HCM',
      startTime: later(-12, 19, 30),
      endTime: new Date(later(-12, 19, 30).getTime() + 3 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=1600&q=80&auto=format&fit=crop',
      category: 'THEATER',
      tickets: [
        { name: 'Vé Hạng Phổ Thông', price: 220_000, quantity: 350 },
        { name: 'Vé Hạng Nhất', price: 420_000, quantity: 120 },
      ],
    },
    {
      organizerEmail: 'organizer2@eventhub.demo',
      phase: 'ended',
      stockMode: 'normal',
      title: 'Hòa Nhạc Giao Hưởng Mùa Thu Hà Nội',
      description:
        'Đêm hòa nhạc cổ điển với dàn nhạc giao hưởng sáu mươi nhạc công dưới sự chỉ huy của nhạc trưởng khách mời.\n' +
        'Chương trình trình tấu các bản giao hưởng nổi tiếng của Tchaikovsky và tổ khúc viết riêng cho mùa thu Hà Nội.\n' +
        'Khán phòng đạt chuẩn âm học mang đến trải nghiệm nghe trọn vẹn không cần khuếch đại điện tử.\n' +
        'Đêm diễn đã hoàn tất và lưu lại nhiều khoảnh khắc đáng nhớ trong mùa nghệ thuật năm nay.\n',
      location: 'Trung tâm Nghệ thuật Âu Cơ, Quận Ba Đình, Hà Nội',
      startTime: later(-24, 19, 0),
      endTime: new Date(later(-24, 19, 0).getTime() + 3 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=1600&q=80&auto=format&fit=crop',
      category: 'MUSIC',
      tickets: [
        { name: 'Vé Tầng 2', price: 500_000, quantity: 300 },
        { name: 'Vé Tầng 1', price: 1_100_000, quantity: 200 },
        { name: 'Vé VIP', price: 2_200_000, quantity: 80 },
      ],
    },
    {
      organizerEmail: 'organizer2@eventhub.demo',
      phase: 'ended',
      stockMode: 'normal',
      title: 'Hội Thảo Thiết Kế Trải Nghiệm Người Dùng',
      description:
        'Diễn đàn thường niên dành cho cộng đồng thiết kế giao diện, nghiên cứu người dùng và sản phẩm số.\n' +
        'Các diễn giả chia sẻ bài học thực tế khi xây dựng hệ thống thiết kế cho ứng dụng hàng triệu người dùng.\n' +
        'Phiên workshop buổi chiều tập trung kiểm thử khả năng sử dụng và cải thiện luồng thanh toán.\n' +
        'Sự kiện đã kết thúc tốt đẹp và toàn bộ tài liệu trình bày đã được gửi đến người tham dự.\n',
      location: 'Hoàng thành Thăng Long, Quận Ba Đình, Hà Nội',
      startTime: later(-39, 9, 0),
      endTime: new Date(later(-39, 9, 0).getTime() + 4 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1591115765373-5207764f72e7?w=1600&q=80&auto=format&fit=crop',
      category: 'CONFERENCE',
      tickets: [
        { name: 'Vé Tham Dự', price: 300_000, quantity: 400 },
        { name: 'Vé Kèm Workshop Chiều', price: 650_000, quantity: 100 },
      ],
    },
    {
      organizerEmail: 'organizer4@eventhub.demo',
      phase: 'ended',
      stockMode: 'normal',
      title: 'Tuần Lễ Ẩm Thực Cố Đô Huế',
      description:
        'Hội tụ tinh hoa ẩm thực dân gian và ẩm thực cung đình từ các nghệ nhân nổi tiếng xứ Huế.\n' +
        'Khách tham quan thưởng thức bún bò, bánh bèo nậm lọc, chè cung đình và các món chay thanh đạm.\n' +
        'Bàn tiệc cung đình buổi tối phục vụ thực đơn bảy món trình bày theo nghi thức truyền thống.\n' +
        'Sự kiện đã khép lại sau nhiều ngày đón tiếp đông đảo thực khách trong và ngoài nước.\n',
      location: 'Ngọ Môn - Đại Nội Huế, Phường Đông Ba, Huế',
      startTime: later(-54, 16, 0),
      endTime: new Date(later(-54, 16, 0).getTime() + 5 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1600&q=80&auto=format&fit=crop',
      category: 'FOOD',
      tickets: [
        { name: 'Vé Vào Cổng Miễn Phí', price: 0, quantity: 1_500 },
        { name: 'Vé Tiệc Cung Đình', price: 550_000, quantity: 180 },
      ],
    },
    {
      organizerEmail: 'organizer3@eventhub.demo',
      phase: 'ended',
      stockMode: 'normal',
      title: 'Giải Đạp Xe Cung Đường Biển Khánh Hòa',
      description:
        'Hành trình đạp xe 60 km uốn lượn qua những đoạn đèo ven biển đẹp nhất tỉnh Khánh Hòa.\n' +
        'Các tay đua tranh tài ở hạng mục cá nhân và đồng đội dưới sự điều phối chuyên nghiệp.\n' +
        'Xe kỹ thuật hỗ trợ vá lốp, tiếp nước và dẫn đường đi theo đoàn suốt chặng đua.\n' +
        'Giải đấu đã kết thúc an toàn với nhiều thành tích cá nhân ấn tượng được thiết lập.\n',
      location: 'Tháp Bà Ponagar, Phường Vĩnh Phước, Nha Trang',
      startTime: later(-72, 6, 0),
      endTime: new Date(later(-72, 6, 0).getTime() + 4 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1517649763962-0c62326601db?w=1600&q=80&auto=format&fit=crop',
      category: 'SPORTS',
      tickets: [
        { name: 'Vé Cá Nhân', price: 250_000, quantity: 500 },
        { name: 'Vé Đồng Đội', price: 900_000, quantity: 120 },
      ],
    },
    {
      organizerEmail: 'organizer4@eventhub.demo',
      phase: 'ended',
      stockMode: 'normal',
      title: 'Workshop Đan Lát Thủ Công Miền Tây',
      description:
        'Lớp học trải nghiệm nghề đan lục bình và tre nứa truyền thống cùng các bà, các cô làng nghề.\n' +
        'Người tham gia được hướng dẫn kỹ thuật xử lý nguyên liệu tự nhiên và đan giỏ đựng đồ hoàn chỉnh.\n' +
        'Buổi học diễn ra trong không gian thoáng mát cạnh bến sông kèm bánh dân gian Nam Bộ.\n' +
        'Chương trình đã kết thúc và mỗi học viên đều mang về sản phẩm tự tay thực hiện.\n',
      location: 'Bến Ninh Kiều, Quận Ninh Kiều, Cần Thơ',
      startTime: later(-95, 14, 0),
      endTime: new Date(later(-95, 14, 0).getTime() + 3 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=1600&q=80&auto=format&fit=crop',
      category: 'WORKSHOP',
      tickets: [{ name: 'Vé Thực Hành', price: 150_000, quantity: 80 }],
    },
    {
      organizerEmail: 'organizer2@eventhub.demo',
      phase: 'ended',
      stockMode: 'normal',
      title: 'Ngày Hội Sách Cũ & Trò Chơi Boardgame',
      description:
        'Không gian giao lưu dành cho người mê đọc sách cũ và cộng đồng yêu thích trò chơi bàn cờ chiến thuật.\n' +
        'Khu vực trao đổi sách mở cửa tự do với hàng nghìn đầu sách văn học, lịch sử và truyện tranh hiếm.\n' +
        'Giải đấu boardgame tổ chức song song suốt ngày với nhiều phần quà từ các nhà phát hành trong nước.\n' +
        'Sự kiện đã kết thúc trong không khí hào hứng và hẹn gặp lại vào mùa thu năm sau.\n',
      location: 'Cung Thể thao Tiên Sơn, Quận Hải Châu, Đà Nẵng',
      startTime: later(-112, 9, 0),
      endTime: new Date(later(-112, 9, 0).getTime() + 7 * HOUR_MS),
      imageUrl: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=1600&q=80&auto=format&fit=crop',
      category: 'OTHER',
      tickets: [
        { name: 'Vé Vào Cửa Miễn Phí', price: 0, quantity: 900 },
        { name: 'Vé Khu Thi Đấu Boardgame', price: 120_000, quantity: 200 },
      ],
    },
  ];
};

const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] ?? c));

const makePoster = (title: string, category: EventCategory): Buffer => {
  const [color1, color2] = CATEGORY_COLORS[category];
  const fontSize = title.length > 36 ? 48 : 58;
  const svg = `<svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color1}" />
        <stop offset="100%" stop-color="${color2}" />
      </linearGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#g)" />
    <text x="800" y="420" font-family="sans-serif" font-size="${fontSize}" font-weight="bold" fill="#ffffff" text-anchor="middle">${escapeXml(title)}</text>
    <text x="800" y="500" font-family="sans-serif" font-size="34" fill="#ffffff" text-anchor="middle">${escapeXml(category)}</text>
    <text x="800" y="545" font-family="sans-serif" font-size="24" fill="#ffffff" text-anchor="middle">Event Hub - Dữ liệu demo</text>
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

/** Tải ảnh Unsplash; lỗi thì sinh poster 1600x900 bằng sharp. Cả hai đều lưu qua saveImage. */
const resolveBanner = async (input: EventInput): Promise<{ url: string | null; source: string }> => {
  try {
    const buf = await fetchImage(input.imageUrl);
    const url = await saveImage(buf);
    return { url, source: 'unsplash' };
  } catch {
    // Ảnh Unsplash lỗi hoặc không có mạng -> sinh poster dự phòng.
  }
  try {
    const poster = makePoster(input.title, input.category);
    const png = await sharp(poster).png().toBuffer();
    const url = await saveImage(png);
    return { url, source: 'poster' };
  } catch {
    return { url: null, source: 'none' };
  }
};

/** Tách host và tên database từ DATABASE_URL mà không bao giờ lộ user hay mật khẩu. */
const parseDatabaseTarget = (rawUrl: string): { host: string; database: string } | null => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname;
    const database = parsed.pathname.replace(/^\/+/, '');
    if (!host) return null;
    return { host, database };
  } catch {
    return null;
  }
};

/** Sinh thời điểm tạo đơn trong 90 ngày trước giờ bắt đầu sự kiện và không vượt quá hiện tại. */
const pickOrderCreatedAt = (event: EventInput, status: OrderStatus, nowMs: number): Date => {
  const startMs = event.startTime.getTime();
  const windowStartMs = startMs - 90 * DAY_MS;
  const bufferMs = status === 'EXPIRED' ? 15 * MINUTE_MS : MINUTE_MS;
  const windowEndMs = Math.min(startMs - bufferMs, nowMs - bufferMs);

  // Đơn PENDING đang giữ chỗ nên thời điểm tạo chỉ cách hiện tại vài phút.
  if (status === 'PENDING') {
    const recentMs = nowMs - randInt(1, 5) * MINUTE_MS;
    const clamped = Math.max(windowStartMs, Math.min(windowEndMs, recentMs));
    return new Date(clamped);
  }

  if (windowEndMs <= windowStartMs) {
    return new Date(windowEndMs);
  }
  const span = windowEndMs - windowStartMs;
  return new Date(windowStartMs + Math.floor(rng() * span));
};

/** Sinh thời điểm check-in hợp lệ trong khung giờ sự kiện (và không ở tương lai). */
const pickCheckedInAt = (event: EventInput, nowMs: number): Date => {
  const startMs = event.startTime.getTime();
  const endMs = event.endTime.getTime();
  const maxMs = event.phase === 'ongoing' ? Math.min(endMs, nowMs) : endMs;
  const span = Math.max(1, maxMs - startMs);
  return new Date(startMs + Math.floor(rng() * span));
};

/** Chọn trạng thái đơn theo pha sự kiện sao cho tổng thể đạt ~80% CONFIRMED, ~8% CANCELLED, ~7% EXPIRED, ~5% PENDING. */
const pickNormalOrderStatus = (phase: EventPhase): OrderStatus => {
  const r = rng();
  if (phase === 'upcoming') {
    if (r < 0.76) return 'CONFIRMED';
    if (r < 0.87) return 'PENDING';
    if (r < 0.94) return 'CANCELLED';
    return 'EXPIRED';
  }
  if (phase === 'ongoing') {
    if (r < 0.82) return 'CONFIRMED';
    if (r < 0.92) return 'CANCELLED';
    return 'EXPIRED';
  }
  // Sự kiện đã kết thúc không có đơn PENDING đang giữ chỗ.
  if (r < 0.80) return 'CONFIRMED';
  if (r < 0.90) return 'CANCELLED';
  return 'EXPIRED';
};

async function invalidateEventListCache(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  const redisOptions = {
    lazyConnect: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    commandTimeout: 3000,
  };
  const cacheRedis = redisUrl
    ? new Redis(redisUrl, redisOptions)
    : new Redis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT) || 6379,
        ...redisOptions,
      });

  // Tránh cảnh báo Unhandled error event của ioredis; lỗi được xử lý ở catch bên dưới.
  cacheRedis.on('error', () => {});

  try {
    await cacheRedis.connect();
    await cacheRedis.incr('events:list:v');
    console.log('\nĐã tăng version cache danh sách sự kiện (events:list:v).');
  } catch (err) {
    console.warn(
      '\nCảnh báo: không thể xoá cache danh sách sự kiện trên Redis:',
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    try {
      cacheRedis.disconnect();
    } catch {
      // Bỏ qua lỗi khi ngắt kết nối Redis.
    }
  }
}

async function main() {
  // 0. Kiểm tra an toàn database đích trước khi chạm vào dữ liệu hay ổ đĩa.
  const rawDbUrl = process.env.DATABASE_URL;
  if (!rawDbUrl) {
    console.error('Thiếu biến môi trường DATABASE_URL.');
    process.exitCode = 1;
    return;
  }

  const dbTarget = parseDatabaseTarget(rawDbUrl);
  if (!dbTarget) {
    console.error('DATABASE_URL không hợp lệ, không thể tách host và tên database.');
    process.exitCode = 1;
    return;
  }

  console.log(`Database đích: host=${dbTarget.host}, database=${dbTarget.database || '(không rõ)'}`);

  const isLocalHost = dbTarget.host === 'localhost' || dbTarget.host === '127.0.0.1';
  const yes = process.argv.slice(2).includes('--yes');
  if (!isLocalHost && !yes) {
    console.error(
      `Từ chối chạy trên host không phải cục bộ (${dbTarget.host}). Thêm cờ --yes để xác nhận.`
    );
    process.exitCode = 1;
    return;
  }

  // Tạo thư mục uploads trước khi lưu ảnh nếu đang dùng STORAGE_DRIVER=disk.
  ensureUploadDir();

  const summary = {
    createdUsers: 0,
    skippedUsers: 0,
    createdEvents: 0,
    skippedEvents: 0,
    createdOrders: 0,
    createdTickets: 0,
    createdPromos: 0,
    skippedPromos: 0,
    createdStaff: 0,
    skippedStaff: 0,
  };

  // 1. Tạo người dùng nếu chưa có theo email (không sửa mật khẩu hay role của user đã tồn tại).
  let cachedPasswordHash: string | null = null;
  const userIdByEmail = new Map<string, string>();

  for (const acc of ACCOUNTS) {
    const existing = await prisma.user.findUnique({
      where: { email: acc.email },
      select: { id: true },
    });

    if (existing) {
      userIdByEmail.set(acc.email, existing.id);
      summary.skippedUsers += 1;
      continue;
    }

    if (!cachedPasswordHash) {
      cachedPasswordHash = await bcrypt.hash(PASSWORD, 10);
    }

    const created = await prisma.user.create({
      data: {
        email: acc.email,
        password: cachedPasswordHash,
        role: acc.role,
        fullName: acc.fullName,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
      select: { id: true },
    });
    userIdByEmail.set(acc.email, created.id);
    summary.createdUsers += 1;
  }

  const customerIds = CUSTOMER_EMAILS.map((email) => userIdByEmail.get(email)!);
  const nowMs = Date.now();
  const events = buildEvents(nowMs);
  const eventIdByTitle = new Map<string, string>();

  // 2. Thêm 24 sự kiện mới + mã giảm giá + đơn hàng + vé (bỏ qua sự kiện đã tồn tại theo title).
  for (const input of events) {
    const existingEvent = await prisma.event.findFirst({
      where: { title: input.title },
      select: { id: true },
    });

    if (existingEvent) {
      eventIdByTitle.set(input.title, existingEvent.id);
      summary.skippedEvents += 1;

      // Đảm bảo mã giảm giá của sự kiện vẫn idempotent nếu trước đó chưa được tạo.
      if (input.promo) {
        const existingPromo = await prisma.promoCode.findUnique({
          where: { eventId_code: { eventId: existingEvent.id, code: input.promo.code } },
          select: { id: true },
        });
        if (existingPromo) {
          summary.skippedPromos += 1;
        } else {
          await prisma.promoCode.create({
            data: {
              eventId: existingEvent.id,
              code: input.promo.code,
              discountType: input.promo.discountType,
              discountValue: new Prisma.Decimal(input.promo.discountValue),
              maxUses: input.promo.maxUses,
              perUserLimit: input.promo.perUserLimit,
              startsAt: null,
              endsAt: input.startTime,
              active: true,
              isPublic: true,
            },
          });
          summary.createdPromos += 1;
        }
      }
      continue;
    }

    const organizerId = userIdByEmail.get(input.organizerEmail)!;
    const { url: bannerUrl, source } = await resolveBanner(input);
    console.log(`  [${input.category}] ${input.title} -> banner: ${source}`);

    const result = await prisma.$transaction(async (tx) => {
      const createdEvent = await tx.event.create({
        data: {
          slug: createEventSlug(input.title),
          title: input.title,
          description: input.description,
          location: input.location,
          category: input.category,
          bannerUrl,
          startTime: input.startTime,
          endTime: input.endTime,
          organizerId,
          ticketTypes: {
            create: input.tickets.map((t) => ({
              name: t.name,
              price: new Prisma.Decimal(t.price),
              totalQuantity: t.quantity,
              availableQuantity: t.quantity,
              saleStart: t.saleStart ?? null,
            })),
          },
        },
        include: { ticketTypes: true },
      });

      let promoRecord: {
        id: string;
        discountType: DiscountType;
        discountValue: Prisma.Decimal;
        maxUses: number | null;
        perUserLimit: number;
      } | null = null;

      if (input.promo) {
        promoRecord = await tx.promoCode.create({
          data: {
            eventId: createdEvent.id,
            code: input.promo.code,
            discountType: input.promo.discountType,
            discountValue: new Prisma.Decimal(input.promo.discountValue),
            maxUses: input.promo.maxUses,
            perUserLimit: input.promo.perUserLimit,
            startsAt: null,
            endsAt: input.startTime,
            active: true,
            isPublic: true,
          },
          select: {
            id: true,
            discountType: true,
            discountValue: true,
            maxUses: true,
            perUserLimit: true,
          },
        });
      }

      // Chỉ tạo đơn cho loại vé đã mở bán (saleStart null hoặc <= hiện tại).
      const openTypes = createdEvent.ticketTypes.filter(
        (t) => !t.saleStart || t.saleStart.getTime() <= nowMs
      );
      const remainingByType = new Map<string, number>();
      for (const t of createdEvent.ticketTypes) {
        remainingByType.set(t.id, t.totalQuantity);
      }

      const heldByUser = new Map<string, number>();
      const promoUseByUser = new Map<string, number>();
      let promoUsedCount = 0;

      // Tỷ lệ check-in riêng cho từng sự kiện đang diễn ra (30-60%) và đã kết thúc (70-95%).
      const checkInRate =
        input.phase === 'ended'
          ? 0.70 + rng() * 0.25
          : input.phase === 'ongoing'
            ? 0.30 + rng() * 0.30
            : 0;

      const orderRows: Prisma.OrderCreateManyInput[] = [];
      const ticketRows: Prisma.TicketCreateManyInput[] = [];

      const pickCustomerWithCap = (qty: number, countsTowardsCap: boolean): string => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const candidate = pick(customerIds);
          if (!countsTowardsCap) return candidate;
          const held = heldByUser.get(candidate) ?? 0;
          if (held + qty <= MAX_TICKETS_PER_USER_PER_EVENT) return candidate;
        }
        return customerIds[0];
      };

      const pushOrder = (
        ticketType: (typeof openTypes)[number],
        qty: number,
        status: OrderStatus
      ) => {
        const holdsStock = status === 'CONFIRMED' || status === 'PENDING';
        const userId = pickCustomerWithCap(qty, holdsStock);
        const createdAt = pickOrderCreatedAt(input, status, nowMs);

        let expiresAt: Date | null = null;
        if (status === 'PENDING') {
          expiresAt = buildExpiresAt(new Date(nowMs + randInt(0, 5) * MINUTE_MS));
        } else if (status === 'EXPIRED') {
          expiresAt = new Date(createdAt.getTime() + 10 * MINUTE_MS);
        }

        const subtotalAmount = ticketType.price.mul(qty);
        let discountAmount = new Prisma.Decimal(0);
        let totalAmount = subtotalAmount;
        let promoCodeId: string | null = null;

        // Áp dụng mã giảm giá cho một số đơn CONFIRMED có giá > 0, tuân thủ maxUses và perUserLimit.
        if (
          promoRecord &&
          status === 'CONFIRMED' &&
          subtotalAmount.gt(0) &&
          (promoRecord.maxUses === null || promoUsedCount < promoRecord.maxUses) &&
          (promoUseByUser.get(userId) ?? 0) < promoRecord.perUserLimit &&
          (promoUsedCount < 2 || rng() < 0.45)
        ) {
          const computed = computeDiscount(subtotalAmount, promoRecord);
          discountAmount = computed.discountAmount;
          totalAmount = computed.totalAmount;
          promoCodeId = promoRecord.id;
          promoUsedCount += 1;
          promoUseByUser.set(userId, (promoUseByUser.get(userId) ?? 0) + 1);
        }

        const orderId = randomUUID();
        orderRows.push({
          id: orderId,
          userId,
          subtotalAmount,
          discountAmount,
          totalAmount,
          promoCodeId,
          status,
          expiresAt,
          createdAt,
          updatedAt: createdAt,
        });

        for (let i = 0; i < qty; i += 1) {
          const checkedIn = status === 'CONFIRMED' && checkInRate > 0 && rng() < checkInRate;
          ticketRows.push({
            orderId,
            ticketTypeId: ticketType.id,
            qrCode: status === 'CONFIRMED' ? randomBytes(16).toString('base64url') : null,
            checkedInAt: checkedIn ? pickCheckedInAt(input, nowMs) : null,
            checkedInById: checkedIn ? organizerId : null,
            createdAt,
          });
        }

        if (holdsStock) {
          remainingByType.set(ticketType.id, (remainingByType.get(ticketType.id) ?? 0) - qty);
          heldByUser.set(userId, (heldByUser.get(userId) ?? 0) + qty);
        }
      };

      if (input.stockMode === 'sold_out' || input.stockMode === 'nearly_sold_out') {
        // Lấp đầy tồn kho bằng đơn CONFIRMED (1-4 vé/đơn) để đạt chính xác trạng thái hết vé / gần hết vé.
        const mainType = openTypes[0];
        const targetRemaining = input.stockMode === 'sold_out' ? 0 : (input.targetRemaining ?? 3);
        let toSell = Math.max(0, mainType.totalQuantity - targetRemaining);

        while (toSell > 0) {
          const qty = toSell <= 4 ? toSell : randInt(1, 4);
          pushOrder(mainType, qty, 'CONFIRMED');
          toSell -= qty;
        }

        // Thêm vài đơn CANCELLED/EXPIRED (không trừ kho) cho lịch sử đơn tự nhiên.
        const extraReleased = randInt(2, 4);
        for (let i = 0; i < extraReleased; i += 1) {
          const releasedStatus: OrderStatus = rng() < 0.55 ? 'CANCELLED' : 'EXPIRED';
          pushOrder(mainType, randInt(1, 4), releasedStatus);
        }
      } else {
        const orderCount =
          input.phase === 'upcoming'
            ? randInt(11, 15)
            : input.phase === 'ongoing'
              ? randInt(12, 15)
              : randInt(10, 14);

        for (let i = 0; i < orderCount; i += 1) {
          let status = pickNormalOrderStatus(input.phase);
          const holdsStock = status === 'CONFIRMED' || status === 'PENDING';

          if (holdsStock) {
            const availableTypes = openTypes.filter((t) => (remainingByType.get(t.id) ?? 0) > 0);
            if (availableTypes.length === 0) {
              status = 'CANCELLED';
              pushOrder(pick(openTypes), randInt(1, 4), status);
              continue;
            }
            const chosenType = pick(availableTypes);
            const left = remainingByType.get(chosenType.id) ?? 0;
            const qty = randInt(1, Math.min(4, left));
            pushOrder(chosenType, qty, status);
          } else {
            pushOrder(pick(openTypes), randInt(1, 4), status);
          }
        }
      }

      if (orderRows.length > 0) {
        await tx.order.createMany({ data: orderRows });
      }
      if (ticketRows.length > 0) {
        await tx.ticket.createMany({ data: ticketRows });
      }

      // Cập nhật tồn kho availableQuantity = totalQuantity - số vé PENDING/CONFIRMED, không âm.
      for (const t of createdEvent.ticketTypes) {
        const remaining = remainingByType.get(t.id) ?? t.totalQuantity;
        if (remaining < 0) {
          throw new Error(`Tồn kho âm cho loại vé ${t.name} của sự kiện ${input.title}`);
        }
        if (remaining !== t.totalQuantity) {
          await tx.ticketType.update({
            where: { id: t.id },
            data: { availableQuantity: remaining },
          });
        }
      }

      if (promoRecord && promoUsedCount > 0) {
        await tx.promoCode.update({
          where: { id: promoRecord.id },
          data: { usedCount: promoUsedCount },
        });
      }

      return {
        eventId: createdEvent.id,
        orders: orderRows.length,
        tickets: ticketRows.length,
        promoCreated: promoRecord ? 1 : 0,
      };
    });

    eventIdByTitle.set(input.title, result.eventId);
    summary.createdEvents += 1;
    summary.createdOrders += result.orders;
    summary.createdTickets += result.tickets;
    summary.createdPromos += result.promoCreated;
  }

  // 3. Gán khach2@ và khach3@ làm nhân viên soát vé cho 2 sự kiện sắp diễn ra của organizer@.
  for (const title of STAFF_EVENT_TITLES) {
    const eventId = eventIdByTitle.get(title);
    if (!eventId) continue;

    for (const staffEmail of STAFF_EMAILS) {
      const userId = userIdByEmail.get(staffEmail);
      if (!userId) continue;

      const existingStaff = await prisma.eventStaff.findUnique({
        where: { eventId_userId: { eventId, userId } },
        select: { eventId: true },
      });

      if (existingStaff) {
        summary.skippedStaff += 1;
      } else {
        await prisma.eventStaff.create({
          data: { eventId, userId },
        });
        summary.createdStaff += 1;
      }
    }
  }

  // 4. Xoá cache danh sách sự kiện trên Redis (lỗi chỉ cảnh báo).
  await invalidateEventListCache();

  // 5. In tóm tắt kết quả.
  console.log('\n=== TÓM TẮT SEED-MORE ===');
  console.log(`Người dùng:  mới tạo ${summary.createdUsers}, bỏ qua ${summary.skippedUsers}`);
  console.log(`Sự kiện:     mới tạo ${summary.createdEvents}, bỏ qua ${summary.skippedEvents}`);
  console.log(`Đơn hàng:    mới tạo ${summary.createdOrders}`);
  console.log(`Vé:          mới tạo ${summary.createdTickets}`);
  console.log(`Mã giảm giá: mới tạo ${summary.createdPromos}, bỏ qua ${summary.skippedPromos}`);
  console.log(`Nhân viên:   mới gán ${summary.createdStaff}, bỏ qua ${summary.skippedStaff}`);
  if (summary.createdUsers > 0) {
    console.log(`\nTài khoản demo mới dùng mật khẩu SEED_DEMO_PASSWORD (mặc định demo12345); không in giá trị để tránh lộ mật khẩu môi trường thật.`);
  }
}

main()
  .catch((error) => {
    console.error('Seed-more thất bại:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await storagePrisma.$disconnect();
  });
