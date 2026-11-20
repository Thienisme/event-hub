import { Router } from 'express';
import { listMyEvents, getOrganizerStats } from '../controllers/organizer.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { getSalesDashboard } from '../controllers/dashboard.controller';

const router = Router();

// Mọi route ở đây đều cần đăng nhập. Phân quyền chi tiết (chỉ xem được sự kiện
// CỦA MÌNH) được đảm bảo bằng cách luôn lọc theo organizerId lấy từ token.
router.use(authenticate);

router.get('/events', listMyEvents);
router.get('/stats', getOrganizerStats);
// Bảng điều khiển bán vé: doanh thu theo ngày, loại vé bán chạy, tỉ lệ vào cổng.
router.get('/dashboard', authorize('ORGANIZER', 'ADMIN'), getSalesDashboard);

export default router;
