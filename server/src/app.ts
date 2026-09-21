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

app.use(cors());
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

  // Job dọn các đơn giữ chỗ quá hạn, trả vé về kho
  startExpireOrdersJob();
});