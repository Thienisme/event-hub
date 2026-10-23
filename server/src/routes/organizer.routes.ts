import { Router } from 'express';
import { listMyEvents, getOrganizerStats } from '../controllers/organizer.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// Mọi route ở đây đều cần đăng nhập. Phân quyền chi tiết (chỉ xem được sự kiện
// CỦA MÌNH) được đảm bảo bằng cách luôn lọc theo organizerId lấy từ token.
router.use(authenticate);

router.get('/events', listMyEvents);
router.get('/stats', getOrganizerStats);

export default router;
