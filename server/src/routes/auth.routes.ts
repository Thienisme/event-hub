import { forgotPassword, resetPassword, verifyEmail, resendVerification } from '../controllers/emailAuth.controller';
import { forgotPasswordSchema, resetPasswordSchema, emailTokenSchema } from '../utils/validation';
import { forgotIpLimiter, forgotEmailLimiter, resendVerificationLimiter } from '../middlewares/rateLimit.middleware';
import { Router, Request, Response } from 'express';
import { register, login, updateProfile, changePassword, updateAvatar, removeAvatar } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';
import {
  validateBody,
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
} from '../utils/validation';
import {
  authRateLimiter,
  registerRateLimiter,
  passwordChangeRateLimiter,
} from '../middlewares/rateLimit.middleware';
import { parseImageUpload } from '../controllers/upload.controller';
import { uploadRateLimiter } from '../middlewares/rateLimit.middleware';
import prisma from '../utils/prisma';
import { handleControllerError } from '../utils/errors';

const router = Router();
router.post('/forgot-password', forgotIpLimiter, validateBody(forgotPasswordSchema), forgotEmailLimiter, forgotPassword);
router.post('/reset-password', validateBody(resetPasswordSchema), resetPassword);
router.post('/verify-email', validateBody(emailTokenSchema), verifyEmail);
router.post('/resend-verification', authenticate, resendVerificationLimiter, resendVerification);


// Chống brute-force: 5 lần thất bại/phút cho login
router.post('/login', authRateLimiter, validateBody(loginSchema), login);
// Chống spam account: 10 lần đăng ký/phút (thành công hay thất bại đều đếm)
router.post('/register', registerRateLimiter, validateBody(registerSchema), register);

// Private Route: Yêu cầu đính kèm Bearer Token
router.get('/me', authenticate, async (req: Request, res: Response) => {
  // req.user là nội dung đã decode từ JWT (chỉ có userId/role/iat/exp),
  // nên phải query lại DB để trả về đủ fullName/email cho FE hiển thị.
  // Bắt buộc có try/catch: lỗi ném trong handler async không được Express 4 bắt,
  // Node sẽ coi là unhandled rejection và thoát cả tiến trình.
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
        emailVerifiedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản!' });
    }

    return res.json({
      message: 'Lấy thông tin tài khoản thành công!',
      user,
    });
  } catch (error) {
    return handleControllerError(res, 'auth.me', error);
  }
});

router.post('/me/avatar', authenticate, uploadRateLimiter, parseImageUpload, updateAvatar);
router.delete('/me/avatar', authenticate, uploadRateLimiter, removeAvatar);

router.patch('/me', authenticate, validateBody(updateProfileSchema), updateProfile);
// Chống dò mật khẩu cũ bằng token bị lộ: 5 lần sai mỗi phút cho mỗi tài khoản.
router.post(
  '/change-password',
  authenticate,
  passwordChangeRateLimiter,
  validateBody(changePasswordSchema),
  changePassword
);

export default router;
