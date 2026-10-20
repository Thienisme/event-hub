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
 * Ánh xạ lỗi Prisma/MySQL sang thông điệp viết cho người dùng + status code.
 *
 * VÌ SAO CẦN:
 *
 * Prisma báo lỗi hạ tầng bằng mã lỗi riêng. Nếu để mọi lỗi đó rơi về 500
 * "Lỗi máy chủ", người dùng không biết mình sai ở đâu: họ nhận "Lỗi máy chủ"
 * trong khi thực ra chỉ cần rút ngắn mô tả xuống dưới 255 ký tự.
 *
 * Các mã Prisma quan trọng (xem https://www.prisma.io/docs/orm/reference/error-reference):
 *   P2000 — giá trị quá dài cho cột ("too long for the column's type")
 *   P2002 — vi phạm ràng buộc UNIQUE
 *   P2003 — vi phạm ràng buộc FOREIGN KEY
 *   P2020 — giá trị nằm ngoài khoảng của kiểu (ví dụ vượt DECIMAL/INTEGER)
 *
 * @returns `null` nếu không phải lỗi hạ tầng đã biết -> để caller rơi về 500.
 */
export const mapPrismaError = (
  error: unknown
): { statusCode: number; message: string } | null => {
  if (!error || typeof error !== 'object') return null;

  const prismaError = error as { code?: string; meta?: Record<string, unknown>; message?: string };
  const code = prismaError.code;
  const meta = prismaError.meta ?? {};
  const rawMessage = String(prismaError.message ?? '');

  // Tên cột lấy từ meta nếu có; nếu không thì bóc từ message (MySQL bản ghi kèm).
  const columnName =
    (typeof meta.column_name === 'string' && meta.column_name) ||
    rawMessage.match(/column '([^']+)'/)?.[1] ||
    '';

  const columnLabel = columnName ? `"${columnName}"` : '';

  switch (code) {
    case 'P2000':
      return {
        statusCode: 400,
        message: columnName
          ? `Dữ liệu của trường ${columnLabel} vượt quá độ dài cho phép!`
          : 'Dữ liệu vượt quá độ dài cho phép!',
      };

    case 'P2002':
      return { statusCode: 409, message: 'Dữ liệu đã tồn tại!' };

    case 'P2003':
      return { statusCode: 400, message: 'Dữ liệu tham chiếu không tồn tại!' };

    case 'P2020':
      return {
        statusCode: 400,
        message: columnName
          ? `Giá trị của trường ${columnLabel} vượt quá giới hạn cho phép!`
          : 'Giá trị vượt quá giới hạn cho phép!',
      };

    default:
      break;
  }

  // Lỗi MySQL đi qua đường khác (ví dụ $queryRaw) thì không có mã Prisma, chỉ có
  // message gốc. Bắt theo message cho chắc.
  if (/too long for the column|Data too long for column/i.test(rawMessage)) {
    return { statusCode: 400, message: 'Dữ liệu vượt quá độ dài cho phép!' };
  }

  if (/Out of range value/i.test(rawMessage)) {
    return { statusCode: 400, message: 'Giá trị vượt quá giới hạn cho phép!' };
  }

  if (/Duplicate entry/i.test(rawMessage)) {
    return { statusCode: 409, message: 'Dữ liệu đã tồn tại!' };
  }

  if (/foreign key constraint fails/i.test(rawMessage)) {
    return { statusCode: 400, message: 'Dữ liệu tham chiếu không tồn tại!' };
  }

  return null;
};

/**
 * Xử lý lỗi tập trung cho controller — nơi duy nhất quyết định cái gì được ra client.
 *
 * - `AppError`: trả đúng status + message (thông điệp đã viết cho người dùng).
 * - Lỗi Prisma/MySQL đã biết: trả 400/409 kèm thông báo chỉ rõ nguyên nhân.
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

  const mapped = mapPrismaError(error);
  if (mapped) {
    logUnexpectedError(context, error);
    return res.status(mapped.statusCode).json({ message: mapped.message });
  }

  logUnexpectedError(context, error);

  return res.status(fallback.statusCode).json({ message: fallback.message });
};
