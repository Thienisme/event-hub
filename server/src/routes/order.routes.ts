import { Router } from 'express';
import { cancelOrder, confirmOrder, createOrder, MYOrders, getOrder, applyOrderPromo, removeOrderPromo } from '../controllers/order.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { orderRateLimiter } from '../middlewares/rateLimit.middleware';
import { validateBody, createOrderSchema, payOrderSchema, applyOrderPromoSchema } from '../utils/validation';

import { payOrder } from '../controllers/payment.controller';

const router = Router();
router.post('/:id/pay', authenticate, validateBody(payOrderSchema), payOrder);

// Tất cả thao tác liên quan đến Order đều yêu cầu đăng nhập
router.post('/', authenticate, orderRateLimiter, validateBody(createOrderSchema), createOrder);
router.get('/my-orders', authenticate, MYOrders);
router.get('/:id', authenticate, getOrder);
router.post('/:id/promo', authenticate, validateBody(applyOrderPromoSchema), applyOrderPromo);
router.delete('/:id/promo', authenticate, removeOrderPromo);
router.post('/:id/confirm', authenticate, confirmOrder);
router.post('/:id/cancel', authenticate, cancelOrder);

export default router;