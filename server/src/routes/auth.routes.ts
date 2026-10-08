import { Router, Request, Response } from 'express';
import { register, login } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validateBody, registerSchema, loginSchema } from '../utils/validation';
import { authRateLimiter, registerRateLimiter } from '../middlewares/rateLimit.middleware';
import prisma from '../utils/prisma';

const router = Router();

// Chống brute-force: 5 lần thất bại/phút cho login
router.post('/login', authRateLimiter, validateBody(loginSchema), login);
// Chống spam account: 10 lần đăng ký/phút (thành công hay thất bại đều đếm)
router.post('/register', registerRateLimiter, validateBody(registerSchema), register);

// Private Route: Yêu cầu đính kèm Bearer Token
router.get('/me', authenticate, async (req: Request, res: Response) => {
  // req.user là nội dung đã decode từ JWT (chỉ có userId/role/iat/exp),
  // nên phải query lại DB để trả về đủ fullName/email cho FE hiển thị.
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      createdAt: true,
    },
  });

  if (!user) {
    return res.status(404).json({ message: 'Không tìm thấy tài khoản!' });
  }

  return res.json({
    message: 'Lấy thông tin tài khoản thành công!',
    user,
  });
});

export default router;
