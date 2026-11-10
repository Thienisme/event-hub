import { Router } from 'express';
import { parseImageUpload, uploadImage } from '../controllers/upload.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { uploadRateLimiter } from '../middlewares/rateLimit.middleware';

const router = Router();

// Chỉ người được tạo sự kiện mới được tải ảnh. Thứ tự quan trọng: xác thực và
// rate limit chạy TRƯỚC multer, để request trái phép không tốn RAM đọc 5MB.
router.post(
  '/',
  authenticate,
  authorize('ORGANIZER', 'ADMIN'),
  uploadRateLimiter,
  parseImageUpload,
  uploadImage
);

export default router;
