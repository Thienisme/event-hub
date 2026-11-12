import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

type Mail = { to: string; subject: string; html: string; text: string };

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export const publicLink = (pathname: string, token: string): string => {
  const url = new URL(pathname, process.env.APP_PUBLIC_URL || 'http://localhost:5173');
  url.searchParams.set('token', token);
  return url.toString();
};

export async function sendMail(mail: Mail): Promise<void> {
  const driver = process.env.MAIL_DRIVER || 'log';
  if (driver === 'log') {
    if (process.env.MAIL_OUTBOX_DIR) {
      await mkdir(process.env.MAIL_OUTBOX_DIR, { recursive: true, mode: 0o700 });
      await writeFile(path.join(process.env.MAIL_OUTBOX_DIR, `${Date.now()}-${randomUUID()}.json`),
        JSON.stringify({ ...mail, createdAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
    } else {
      // Không ghi nội dung chứa token ra console, kể cả ở production.
      console.log(`[email] ${mail.subject} → ${mail.to}`);
    }
    return;
  }
  if (driver !== 'brevo') throw new Error('MAIL_DRIVER không hợp lệ');
  const sender = process.env.MAIL_FROM?.match(/^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (!sender || !process.env.BREVO_API_KEY) throw new Error('Thiếu cấu hình gửi email Brevo');
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ sender: { email: sender[2], name: sender[1] }, to: [{ email: mail.to }],
      subject: mail.subject, htmlContent: mail.html, textContent: mail.text }),
  });
  if (!response.ok) throw new Error(`Gửi email thất bại (HTTP ${response.status})`);
}

export async function sendMailSafe(mail: Mail): Promise<void> {
  try { await sendMail(mail); }
  catch { console.error('[email] Gửi email thất bại; kiểm tra cấu hình và dịch vụ gửi thư'); }
}
