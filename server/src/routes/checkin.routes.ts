import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { listMyCheckInEvents } from '../controllers/eventStaff.controller';

const router = Router();

// Sự kiện mà tài khoản đang đăng nhập được gán làm nhân viên soát vé.
router.get('/events', authenticate, listMyCheckInEvents);

export default router;
