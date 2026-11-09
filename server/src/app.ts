// PHẢI là import ĐẦU TIÊN: nạp .env trước khi bất kỳ module nào đọc process.env.
//
// Trước đây file này gọi `dotenv.config()` ở thân module, nhưng mọi `import` đều
// chạy TRƯỚC thân module (CommonJS biến chúng thành require() tại chỗ). Nên .env
// được nạp QUÁ MUỘN: các module đọc process.env ở cấp module — config/redis.ts,
// config/order.ts, controllers/auth.controller.ts — đều thấy `undefined` và âm
// thầm rơi vào giá trị mặc định.
import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import prisma from './utils/prisma';
import authRoutes from './routes/auth.routes';
import eventRoutes from './routes/event.routes';
import orderRoutes from './routes/order.routes';
import adminRoutes from './routes/admin.routes';
import organizerRoutes from './routes/organizer.routes';
import { startExpireOrdersJob } from './jobs/expireOrders.job';
import { errorMiddleware, logUnexpectedError } from './utils/errors';
import { parseAllowedOrigins } from './utils/cors';
import { assertAuthConfig } from './config/auth';
import { apiRateLimiter } from './middlewares/rateLimit.middleware';
import { cacheClient, redisClient } from './config/redis';

const app = express();
const PORT = process.env.PORT || 5000;

// Chỉ bật khi server chạy sau reverse proxy/load balancer (nginx, ALB...).
// `trust proxy` quyết định `req.ip` lấy từ X-Forwarded-For hay từ socket, nên
// đặt SAI sẽ cho client tự khai IP của mình và vô hiệu hoá rate limit theo IP.
// Mặc định tắt: chạy trực tiếp thì không có proxy nào để tin.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY));
}

// Thêm các header bảo mật cơ bản (X-Content-Type-Options, X-Frame-Options,
// Strict-Transport-Security...). API trả JSON nên không cần cấu hình CSP riêng.
app.use(helmet());

// CORS: chỉ cho phép origin của frontend (khai báo qua CORS_ORIGINS, phân tách bằng dấu phẩy).
// - Không có Origin (curl, k6, server-to-server) -> cho qua.
// - Có Origin nhưng không nằm trong whitelist -> không gắn header CORS;
//   trình duyệt sẽ tự chặn. Không ném lỗi để tránh biến thành 500 gây nhiễu log.
//
// Logic whitelist nằm ở `utils/cors.ts` để test được trực tiếp — xem cảnh báo
// về toán tử comma trong file đó (bug đã xảy ra: mọi origin ngoài 5175 đều bị
// chặn, kể cả origin hợp lệ khai trong CORS_ORIGINS).
const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGINS);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
  })
);
app.use(express.json());

// Áp dụng rate limiter chung cho toàn bộ API
app.use('/api/', apiRateLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/orders', orderRoutes);
// Quản trị (chỉ ADMIN) và quản lý sự kiện của bản thân (ORGANIZER/ADMIN).
app.use('/api/admin', adminRoutes);
app.use('/api/organizer', organizerRoutes);

// Health Check
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      message: 'EventHub Server & Database are running smoothly!',
    });
  } catch (error) {
    // Endpoint này là public: bất kỳ ai cũng gọi được, nên chi tiết lỗi chỉ
    // được ghi vào log của server (có thể chứa host, cổng, tên database...).
    logUnexpectedError('health', error);
    res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
    });
  }
});

// Phải đứng sau mọi route: Express chỉ chuyển lỗi tới middleware khai báo sau đó.
app.use(errorMiddleware);

// Fail fast: thiếu hoặc secret quá yếu thì chết ngay lúc khởi động, thay vì
// chạy với secret mặc định mà cả thế giới biết.
assertAuthConfig();

const server = app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  // In ra danh sách origin được phép: khi client báo lỗi CORS, đây là thứ đầu
  // tiên cần đối chiếu (client chạy cổng nào, cổng đó có trong danh sách không).
  console.log(`🌐 CORS allowed origins: ${allowedOrigins.join(', ')}`);
  // Node không có date_default_timezone_set như PHP -> múi giờ server do biến
  // môi trường TZ quyết định (xem server/.env.example).
  console.log(`🕒 Server timezone: ${process.env.TZ || '(theo múi giờ của OS)'}`);

  // Job dọn các đơn giữ chỗ quá hạn, trả vé về kho
  startExpireOrdersJob();
});

/**
 * Tắt êm khi orchestrator (Docker, systemd, Kubernetes) gửi SIGTERM.
 *
 * Thứ tự quan trọng: ngừng nhận request mới trước, chờ request đang chạy xong,
 * rồi mới đóng Prisma/Redis. Đóng kết nối khi request còn đang chạy sẽ biến
 * một lần deploy bình thường thành lỗi 500 cho người dùng.
 */
let shuttingDown = false;

const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`🛑 Nhận ${signal}, dừng nhận request mới...`);

  // Keep-alive connection có thể giữ server.close() mãi; chặn bằng hạn cứng.
  const forceExit = setTimeout(() => {
    console.error('❌ Quá 10s chưa đóng xong, thoát cưỡng bức.');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    console.log('✅ Đã đóng HTTP server.');

    await prisma.$disconnect();
    console.log('✅ Đã đóng kết nối Prisma.');

    await Promise.allSettled([redisClient.quit(), cacheClient.quit()]);
    console.log('✅ Đã đóng kết nối Redis.');
  } catch (error) {
    console.error('❌ Lỗi khi tắt server:', error);
    process.exitCode = 1;
  } finally {
    clearTimeout(forceExit);
    process.exit(process.exitCode ?? 0);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));