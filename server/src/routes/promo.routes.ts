import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { validateBody, updatePromoSchema, previewPromoSchema } from '../utils/validation';
import { updatePromoCode, deletePromoCode, previewPromoCode } from '../controllers/promo.controller';

const router = Router();
router.post('/preview', authenticate, validateBody(previewPromoSchema), previewPromoCode);
router.patch('/:id', authenticate, authorize('ORGANIZER', 'ADMIN'), validateBody(updatePromoSchema), updatePromoCode);
router.delete('/:id', authenticate, authorize('ORGANIZER', 'ADMIN'), deletePromoCode);
export default router;
