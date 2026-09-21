import { Response } from 'express';

/**
 * Lỗi NGHIỆP VỤ: message được viết để NGƯỜI DÙNG cuối đọc
 * (VD: "Rất tiếc, chỉ còn lại 0 vé!"), nên an toàn khi trả nguyên văn ra client.
 *
 * Mọi lỗi KHÔNG phải AppError đều bị coi là lỗi nội bộ. Message của chúng có thể
 * chứa chi tiết hạ tầng: tên bảng/cột, câu SQL, tên host & cổng, stack trace,
 * thậm chí cả mảnh dữ liệu người dùng. Những thứ đó chỉ được ghi log ở server.
 */
export class AppError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
  }
}

/**
 * Ghi log chi tiết một lỗi không mong đợi. Chỉ chạy ở server.
 *
 * Cố tình log cả `stack` lẫn `name`: `message` một mình thường không đủ để
 * chẩn đoán (Prisma error code nằm ở `name`/`code`, vị trí hỏng nằm ở `stack`).
 */
export const logUnexpectedError = (context: string, error: unknown): void => {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(
    `[${context}] ${err.name}: ${err.message}${err.stack ? `\n${err.stack}` : ''}`
  );
};

/**
 * Xử lý lỗi tập trung cho controller — nơi duy nhất quyết định cái gì được ra client.
 *
 * - `AppError`: trả đúng status + message (thông điệp đã viết cho người dùng).
 * - Lỗi khác: ghi log đầy đủ ở server, chỉ trả về câu thông báo chung.
 *
 * Toàn bộ controller đi qua hàm này để không còn chỗ nào tự nối `error.message`
 * vào response.
 */
export const handleControllerError = (
  res: Response,
  context: string,
  error: unknown,
  fallback: { statusCode: number; message: string } = {
    statusCode: 500,
    message: 'Lỗi máy chủ',
  }
): Response => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  logUnexpectedError(context, error);

  return res.status(fallback.statusCode).json({ message: fallback.message });
};
