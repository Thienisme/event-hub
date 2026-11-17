import { createHmac, timingSafeEqual } from 'crypto';

// Đổi mã mỗi 30 giây để ảnh chụp màn hình tự hết hạn.
export const QR_STEP_SECONDS = 30;

export function currentQrStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / (QR_STEP_SECONDS * 1000));
}

export function signDynamicQr(ticketId: string, qrCode: string, step: number | string): string {
  return createHmac('sha256', Buffer.from(qrCode, 'utf8'))
    .update(`EH1.${ticketId}.${step}`, 'utf8').digest().subarray(0, 16).toString('base64url');
}

// Giữ nguyên chữ số của step để xác minh đúng chuỗi đã ký, kể cả số 0 ở đầu.
export type ParsedDynamicQr = { ticketId: string; step: string; sig: string };

export function parseDynamicQr(raw: string): ParsedDynamicQr | null {
  const match = /^EH1\.([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.([0-9]{1,12})\.([A-Za-z0-9_-]{22})$/.exec(raw);
  return match ? { ticketId: match[1]!, step: match[2]!, sig: match[3]! } : null;
}

export function verifyDynamicQr(parsed: ParsedDynamicQr, qrCode: string): boolean {
  const expected = Buffer.from(signDynamicQr(parsed.ticketId, qrCode, parsed.step), 'ascii');
  const actual = Buffer.from(parsed.sig, 'ascii');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
