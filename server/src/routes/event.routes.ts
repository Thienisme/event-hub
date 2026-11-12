import { Router } from 'express';
import { createEvent, getEvents, getEventById, updateEvent, deleteEvent } from '../controllers/event.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { checkInTicket, getCheckInStats } from '../controllers/checkin.controller';
import { validateBody, createEventSchema, checkInSchema } from '../utils/validation';

const router = Router();

// Public Routes (Xem danh sách & chi tiết)
router.get('/', getEvents);
router.get('/:id', getEventById);

// Protected Route (Chỉ ORGANIZER hoặc ADMIN mới được phép quản lý sự kiện)
router.post('/', authenticate, authorize('ORGANIZER', 'ADMIN'), validateBody(createEventSchema), createEvent);
router.put('/:id', authenticate, authorize('ORGANIZER', 'ADMIN'), validateBody(createEventSchema), updateEvent);
router.delete('/:id', authenticate, authorize('ORGANIZER', 'ADMIN'), deleteEvent);

// Soát vé: ORGANIZER của chính sự kiện hoặc ADMIN (kiểm quyền sở hữu trong controller).
router.post('/:id/check-in', authenticate, authorize('ORGANIZER', 'ADMIN'), validateBody(checkInSchema), checkInTicket);
router.get('/:id/check-in/stats', authenticate, authorize('ORGANIZER', 'ADMIN'), getCheckInStats);

export default router;
