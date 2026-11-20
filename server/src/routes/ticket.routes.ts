import { Router } from 'express';
import { transferTicket } from '../controllers/ticket.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { ticketTransferRateLimiter } from '../middlewares/rateLimit.middleware';
import { validateBody, transferTicketSchema } from '../utils/validation';

const router = Router();

router.post('/:id/transfer', authenticate, ticketTransferRateLimiter, validateBody(transferTicketSchema), transferTicket);

export default router;
