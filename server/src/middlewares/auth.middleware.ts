import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types/express';
import { getJwtSecret } from '../config/auth';

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Không tìm thấy token xác thực hoặc sai định dạng!' });
  }

  const token = authHeader.split(' ')[1];

  // Lấy secret NGOÀI try. Thiếu JWT_SECRET là lỗi cấu hình phía SERVER, phải lộ
  // ra là lỗi server — không được đội lốt thành "token không hợp lệ" (403) rồi
  // khiến ta đi chẩn đoán nhầm phía client.
  const secret = getJwtSecret();

  try {
    // Ghim `algorithms` để chặn algorithm confusion: nếu bỏ trống, thư viện tự
    // suy ra thuật toán từ chính header mà client gửi lên.
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload;
    req.user = decoded; // Gán thông tin user đã decode vào Request
    next(); // Chuyển sang Controller/Middleware tiếp theo
  } catch {
    return res.status(403).json({ message: 'Token không hợp lệ hoặc đã hết hạn!' });
  }
};

// Middleware phân quyền dựa trên Role (VD: Chỉ ORGANIZER mới được tạo sự kiện)
export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Chưa được xác thực!' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này!' });
    }

    next();
  };
};