import { Router } from 'express';
import { createEvent, getEventCategories, getEventHighlights, getEvents, getEventById, updateEvent, deleteEvent } from '../controllers/event.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { checkInTicket, getCheckInStats } from '../controllers/checkin.controller';
import { validateBody, createEventSchema, checkInSchema, createPromoSchema, addEventStaffSchema } from '../utils/validation';
import { addEventStaff, listEventStaff, removeEventStaff } from '../controllers/eventStaff.controller';
import { eventStaffRateLimiter } from '../middlewares/rateLimit.middleware';

import { listPromoCodes, createPromoCode, getEventOffers } from '../controllers/promo.controller';

import { getMyWaitlist } from '../controllers/waitlist.controller';

import { joinEventQueue, getMyQueueStatus, leaveEventQueue } from '../controllers/queue.controller';

const router = Router();
router.post('/:id/queue', authenticate, joinEventQueue);
router.get('/:id/queue/me', authenticate, getMyQueueStatus);
router.delete('/:id/queue', authenticate, leaveEventQueue);
router.get('/:id/waitlist/me', authenticate, getMyWaitlist);
router.get('/:id/promo-codes', authenticate, authorize('ORGANIZER', 'ADMIN'), listPromoCodes);
router.post('/:id/promo-codes', authenticate, authorize('ORGANIZER', 'ADMIN'), validateBody(createPromoSchema), createPromoCode);

// Public Routes (Xem danh sách & chi tiết)
router.get('/', getEvents);
router.get('/categories', getEventCategories);
router.get('/highlights', getEventHighlights);
router.get('/:id/offers', getEventOffers);
router.get('/:id', getEventById);

// Protected Route (Chỉ ORGANIZER hoặc ADMIN mới được phép quản lý sự kiện)
router.post('/', authenticate, authorize('ORGANIZER', 'ADMIN'), validateBody(createEventSchema), createEvent);
router.put('/:id', authenticate, authorize('ORGANIZER', 'ADMIN'), validateBody(createEventSchema), updateEvent);
router.delete('/:id', authenticate, authorize('ORGANIZER', 'ADMIN'), deleteEvent);

// Soát vé: ORGANIZER của chính sự kiện, ADMIN hoặc nhân viên soát vé được gán.
// Không dùng authorize(role) vì nhân viên thường là CUSTOMER; controller kiểm quyền.
router.post('/:id/check-in', authenticate, validateBody(checkInSchema), checkInTicket);
router.get('/:id/check-in/stats', authenticate, getCheckInStats);

// Quản lý nhân viên soát vé: chỉ ORGANIZER của chính sự kiện hoặc ADMIN.
router.get('/:id/staff', authenticate, authorize('ORGANIZER', 'ADMIN'), listEventStaff);
router.post('/:id/staff', authenticate, authorize('ORGANIZER', 'ADMIN'), eventStaffRateLimiter, validateBody(addEventStaffSchema), addEventStaff);
router.delete('/:id/staff/:userId', authenticate, authorize('ORGANIZER', 'ADMIN'), removeEventStaff);

export default router;
