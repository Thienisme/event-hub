import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { joinWaitlist, leaveWaitlist } from '../controllers/waitlist.controller';

const router = Router();
router.post('/:id/waitlist', authenticate, joinWaitlist);
router.delete('/:id/waitlist', authenticate, leaveWaitlist);
export default router;
