import { Router } from 'express';
import { providers, vnpayIpn, momoIpn, paymentReturn } from '../controllers/payment.controller';
const router = Router();
router.get('/providers', providers);
router.get('/vnpay/ipn', vnpayIpn);
router.get('/vnpay/return', paymentReturn('VNPAY'));
router.post('/momo/ipn', momoIpn);
router.get('/momo/return', paymentReturn('MOMO'));
export default router;
