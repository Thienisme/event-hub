/**
 * QR động chống chụp màn hình (hợp đồng dùng chung với server).
 *
 * Chuỗi trong QR: `EH1.<ticketId>.<step>.<sig>`
 * - `step` = floor(giây Unix / QR_STEP_SECONDS).
 * - `sig` = 16 byte đầu của HMAC-SHA256(key = qrCode, message = `EH1.<ticketId>.<step>`),
 *   encode base64url không padding (luôn 22 ký tự).
 * Server chấp nhận step trong [hiện tại - 1, hiện tại + 1] theo đồng hồ của nó,
 * nên client cần bù lệch đồng hồ qua `offsetMs` (từ `serverTime` của API).
 */
export const QR_STEP_SECONDS = 30;

/** crypto.subtle chỉ có trên HTTPS hoặc localhost. */
export function canUseDynamicQr(): boolean {
  return !!globalThis.crypto?.subtle;
}

/** base64url không padding (chuẩn của chuỗi ký tự trong QR, không chứa +/=). */
function base64UrlNoPadding(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function buildDynamicQr(
  ticketId: string,
  qrCode: string,
  nowMs: number
): Promise<string> {
  const step = Math.floor(nowMs / 1000 / QR_STEP_SECONDS);
  const message = `EH1.${ticketId}.${step}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(qrCode),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const sig = base64UrlNoPadding(new Uint8Array(signature).slice(0, 16));

  return `EH1.${ticketId}.${step}.${sig}`;
}
