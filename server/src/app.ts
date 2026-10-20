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
import prisma from './utils/prisma';
import authRoutes from './routes/auth.routes';
import eventRoutes from './routes/event.routes';
import orderRoutes from './routes/order.routes';
import { startExpireOrdersJob } from './jobs/expireOrders.job';
import { logUnexpectedError } from './utils/errors';
import { assertAuthConfig } from './config/auth';
import { apiRateLimiter } from './middlewares/rateLimit.middleware';

const app = express();
const PORT = process.env.PORT || 5000;

// CORS: chỉ cho phép origin của frontend (khai báo qua CORS_ORIGINS, phân tách bằng dấu phẩy).
// - Không có Origin (curl, k6, server-to-server) -> cho qua.
// - Có Origin nhưng không nằm trong whitelist -> không gắn header CORS;
//   trình duyệt sẽ tự chặn. Không ném lỗi để tránh biến thành 500 gây nhiễu log.
const allowedOrigins = (
  process.env.CORS_ORIGINS ??
  'http://localhost:5173,http://127.0.0.1:5173',
  'http://localhost:5174,http://127.0.0.1:5174',
  'http://localhost:5176,http://127.0.0.1:5176',
  'http://localhost:5175,http://127.0.0.1:5175'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

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

// Fail fast: thiếu hoặc secret quá yếu thì chết ngay lúc khởi động, thay vì
// chạy với secret mặc định mà cả thế giới biết.
assertAuthConfig();

app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  // Node không có date_default_timezone_set như PHP -> múi giờ server do biến
  // môi trường TZ quyết định (xem server/.env.example).
  console.log(`🕒 Server timezone: ${process.env.TZ || '(theo múi giờ của OS)'}`);

  // Job dọn các đơn giữ chỗ quá hạn, trả vé về kho
  startExpireOrdersJob();
});