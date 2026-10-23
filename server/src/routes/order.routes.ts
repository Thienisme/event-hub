import { Router } from 'express';
import { createOrder, MYOrders } from '../controllers/order.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { orderRateLimiter } from '../middlewares/rateLimit.middleware';
import { validateBody, createOrderSchema } from '../utils/validation';

const router = Router();

// Tất cả thao tác liên quan đến Order đều yêu cầu đăng nhập
router.post('/', authenticate, orderRateLimiter, validateBody(createOrderSchema), createOrder);
router.get('/my-orders', authenticate, MYOrders);

export default router;