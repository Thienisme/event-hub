import { Router } from 'express';
import { cancelOrder, confirmOrder, createOrder, MYOrders } from '../controllers/order.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { orderRateLimiter } from '../middlewares/rateLimit.middleware';
import { validateBody, createOrderSchema, payOrderSchema } from '../utils/validation';

import { payOrder } from '../controllers/payment.controller';

const router = Router();
router.post('/:id/pay', authenticate, validateBody(payOrderSchema), payOrder);

// Tất cả thao tác liên quan đến Order đều yêu cầu đăng nhập
router.post('/', authenticate, orderRateLimiter, validateBody(createOrderSchema), createOrder);
router.get('/my-orders', authenticate, MYOrders);
router.post('/:id/confirm', authenticate, confirmOrder);
router.post('/:id/cancel', authenticate, cancelOrder);

export default router;