import { Role } from '@prisma/client';

export interface JwtPayload {
  userId: string; // ✅ Sửa String thành string (chữ s viết thường)
  role: Role;
  /**
   * Phiên bản token lúc cấp (`users.tokenVersion`). Token cũ không có trường này
   * được coi là 0. Lệch với DB nghĩa là mật khẩu đã đổi sau khi cấp token.
   */
  tv?: number;
  /**
   * Role LẤY TỪ DB (không phải role trong token).
   *
   * Middleware `authorize` ghi đè giá trị này mỗi lần nó chạy. Controller nào
   * cần quyền (VD: ADMIN được sửa/xoá sự kiện của người khác) thì đọc
   * `currentRole`, đừng đọc `role` — vì role trong token có thể đã cũ.
   */
  currentRole?: Role;
  /**
   * Email lấy từ DB (cùng lượt đọc với `currentRole`).
   *
   * Dùng cho nhật ký quản trị: ghi lại "ai đã làm" mà không phải hỏi DB thêm.
   */
  email?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}