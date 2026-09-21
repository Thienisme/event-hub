import { Router } from 'express';
import { createEvent, getEvents, getEventById } from '../controllers/event.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { validateBody, createEventSchema } from '../utils/validation';

const router = Router();

// Public Routes (Xem danh sách & chi tiết)
router.get('/', getEvents);
router.get('/:id', getEventById);

// Protected Route (Chỉ ORGANIZER hoặc ADMIN mới được phép tạo sự kiện)
router.post('/', authenticate, authorize('ORGANIZER', 'ADMIN'), validateBody(createEventSchema), createEvent);

export default router;