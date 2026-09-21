import { Role } from '@prisma/client';

export interface JwtPayload {
  userId: string; // ✅ Sửa String thành string (chữ s viết thường)
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}