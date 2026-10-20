import { Router } from 'express';
import {
  listUsers,
  updateUserRole,
  updateUserStatus,
  getAdminStats,
  listAllEvents,
  listAuditLogs,
} from '../controllers/admin.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { validateBody, updateRoleSchema, updateUserStatusSchema } from '../utils/validation';
import { adminRateLimiter } from '../middlewares/rateLimit.middleware';

const router = Router();

// Toàn bộ API quản trị đều cần: đã đăng nhập + role ADMIN (đọc từ DB, xem
// middlewares/auth.middleware.ts) + rate limit riêng cho nhóm thao tác nhạy cảm.
router.use(authenticate, authorize('ADMIN'), adminRateLimiter);

router.get('/users', listUsers);
router.patch('/users/:id/role', validateBody(updateRoleSchema), updateUserRole);
router.patch('/users/:id/status', validateBody(updateUserStatusSchema), updateUserStatus);
router.get('/stats', getAdminStats);
router.get('/events', listAllEvents);
router.get('/audit-logs', listAuditLogs);

export default router;
