import { Router } from 'express';
import { createOrder, MYOrders } from '../controllers/order.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validateBody, createOrderSchema } from '../utils/validation';

const router = Router();

// Tất cả thao tác liên quan đến Order đều yêu cầu đăng nhập
router.post('/', authenticate, validateBody(createOrderSchema), createOrder);
router.get('/my-orders', authenticate, MYOrders);

export default router;