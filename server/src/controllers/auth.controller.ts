import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { AppError, handleControllerError } from '../utils/errors';
import { invalidateUserState } from '../utils/userState';
import { getJwtSecret } from '../config/auth';

// Người dùng tự đăng ký luôn được gán role CUSTOMER.
// Role ORGANIZER/ADMIN chỉ có thể thay đổi thông qua cơ chế nội bộ (ví dụ: admin panel).
const SELF_REGISTER_ROLE = 'CUSTOMER';

/** Token mang `tv` = tokenVersion lúc cấp; xem `authenticate`. */
const signAccessToken = (user: { id: string; role: Role; tokenVersion: number }) =>
  jwt.sign({ userId: user.id, role: user.role, tv: user.tokenVersion }, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: '1d',
  });

const PROFILE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  createdAt: true,
} as const;

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin!' });
    }

    // Luôn gán role = CUSTOMER, bỏ qua giá trị role từ client
    // để ngăn chặn leo thang đặc quyền
    const finalRole = SELF_REGISTER_ROLE;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: 'Email này đã được sử dụng!' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        fullName,
        role: finalRole,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
      },
    });

    return res.status(201).json({
      message: 'Đăng ký tài khoản thành công!',
      user,
    });
  } catch (error) {
    return handleControllerError(res, 'register', error);
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Vui lòng nhập Email và Mật khẩu!' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không chính xác!' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không chính xác!' });
    }

    // Tài khoản bị khoá: vẫn kiểm tra mật khẩu trước để không lộ ra việc
    // "email này tồn tại nhưng đã bị khoá" cho người lạ.
    if (!user.isActive) {
      return res.status(403).json({
        message: 'Tài khoản đã bị khoá. Vui lòng liên hệ quản trị viên!',
      });
    }

    // Thuật toán được ghim HS256 trong signAccessToken (khớp với verify).
    const token = signAccessToken(user);

    return res.json({
      message: 'Đăng nhập thành công!',
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    });
  } catch (error) {
    return handleControllerError(res, 'login', error);
  }
};

/**
 * PATCH /api/auth/me  { fullName }
 * Chỉ đổi được tên. Email và role không đổi qua đây.
 */
export const updateProfile = async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { fullName: req.body.fullName },
      select: PROFILE_SELECT,
    });

    return res.json({ message: 'Cập nhật hồ sơ thành công!', user });
  } catch (error) {
    return handleControllerError(res, 'updateProfile', error);
  }
};

/**
 * POST /api/auth/change-password  { currentPassword, newPassword }
 *
 * THU HỒI TOKEN: tăng `tokenVersion` cùng lúc với đổi mật khẩu. Mọi token cấp
 * trước đó mang `tv` cũ nên `authenticate` từ chối ngay ở request kế tiếp (cache
 * trạng thái được xoá ngay sau khi ghi). Thiết bị đang đổi mật khẩu nhận token
 * mới trong response để không bị đăng xuất.
 *
 * Mật khẩu sai trả 400, KHÔNG phải 401: client coi mọi 401 là hết phiên.
 *
 * Ghi bằng `updateMany` có điều kiện `tokenVersion` vừa đọc: hai request đổi
 * mật khẩu cùng lúc (cùng chứng minh bằng mật khẩu cũ) thì chỉ một bên thắng.
 * Không có điều kiện này, bên thua vẫn ghi đè mật khẩu dù mật khẩu cũ nó dùng
 * để chứng minh đã không còn đúng.
 */
export const changePassword = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, password: true, tokenVersion: true },
    });
    if (!user) throw new AppError('Không tìm thấy tài khoản!', 404);

    if (!(await bcrypt.compare(currentPassword, user.password))) {
      throw new AppError('Mật khẩu hiện tại không đúng!', 400);
    }
    if (currentPassword === newPassword) {
      throw new AppError('Mật khẩu mới phải khác mật khẩu hiện tại!', 400);
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    const claimed = await prisma.user.updateMany({
      where: { id: userId, tokenVersion: user.tokenVersion },
      data: { password: hashed, tokenVersion: { increment: 1 } },
    });

    if (claimed.count === 0) {
      throw new AppError('Mật khẩu vừa được đổi ở nơi khác, vui lòng thử lại!', 409);
    }

    await invalidateUserState(userId);
    // Xoá lần hai sau 1 giây: một request đọc DB ngay TRƯỚC khi ghi có thể ghi
    // trạng thái cũ vào cache SAU lần xoá đầu, giữ token cũ sống thêm tối đa 30 giây.
    setTimeout(() => void invalidateUserState(userId), 1000).unref();

    const token = signAccessToken({ ...user, tokenVersion: user.tokenVersion + 1 });
    return res.json({ message: 'Đổi mật khẩu thành công!', token });
  } catch (error) {
    return handleControllerError(res, 'changePassword', error);
  }
};
