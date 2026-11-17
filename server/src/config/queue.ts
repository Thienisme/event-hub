/** Bỏ qua cấu hình sai để tránh lượt có thời hạn âm hoặc vô hạn. */
const seconds = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 86400 ? parsed : fallback;
};
export const QUEUE_PASS_TTL_SECONDS = seconds(process.env.QUEUE_PASS_TTL_SECONDS, 300);
export const QUEUE_STALE_SECONDS = seconds(process.env.QUEUE_STALE_SECONDS, 30);
