import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import path from 'path';
import { AppError } from './errors';

/**
 * Lưu file người dùng tải lên (hiện chỉ có ảnh banner sự kiện).
 *
 * Mọi chỗ khác chỉ gọi `saveImage()` và nhận lại URL. Khi chuyển sang S3/MinIO,
 * chỉ cần viết lại file này; controller, route và client giữ nguyên.
 *
 * URL trả về là ĐƯỜNG DẪN TƯƠNG ĐỐI `/uploads/<uuid>.<ext>`, không kèm host:
 * - dev: client tự ghép với origin của API (client và API khác cổng);
 * - production: nginx chuyển `/uploads/` sang server, cùng origin với client.
 * Lưu host vào database thì đổi domain là toàn bộ ảnh cũ hỏng.
 */

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));

export const UPLOAD_URL_PREFIX = '/uploads/';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Chỉ khớp đúng dạng tên file do server tự đặt, nên không thể trỏ ra ngoài thư mục upload. */
export const UPLOADED_IMAGE_PATH = /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

type ImageKind = { ext: 'jpg' | 'png' | 'webp'; mime: string };

/**
 * Nhận diện ảnh bằng magic bytes ở đầu file.
 *
 * KHÔNG tin `mimetype` hay đuôi file mà trình duyệt gửi lên: cả hai đều do client
 * tự khai. Một file HTML đổi tên thành .png vẫn có mimetype image/png nếu kẻ tấn
 * công muốn, và nếu được phục vụ lại như HTML thì thành XSS trên domain của mình.
 */
export const detectImageType = (buf: Buffer): ImageKind | null => {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
};

/** Tạo thư mục upload lúc khởi động để lỗi quyền ghi lộ ra ngay, không đợi lần upload đầu. */
export const ensureUploadDir = (): void => {
  mkdirSync(UPLOAD_DIR, { recursive: true });
};

/**
 * Kiểm tra rồi ghi ảnh xuống đĩa, trả về đường dẫn công khai.
 * Tên file là UUID do server sinh: không dùng tên gốc của người dùng
 * (tránh path traversal, ký tự lạ, trùng tên ghi đè ảnh người khác).
 */
export const saveImage = async (buf: Buffer): Promise<string> => {
  if (buf.length === 0) {
    throw new AppError('File ảnh rỗng!', 400);
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new AppError('Ảnh không được vượt quá 5MB!', 413);
  }

  const kind = detectImageType(buf);
  if (!kind) {
    throw new AppError('Chỉ chấp nhận ảnh JPG, PNG hoặc WEBP!', 400);
  }

  const fileName = `${randomUUID()}.${kind.ext}`;
  // flag 'wx': không bao giờ ghi đè file đã có.
  await writeFile(path.join(UPLOAD_DIR, fileName), buf, { flag: 'wx' });
  return `${UPLOAD_URL_PREFIX}${fileName}`;
};
