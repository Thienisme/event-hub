import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { handleControllerError } from '../utils/errors';
import { getJwtSecret } from '../config/auth';

// Chỉ cho phép tự đăng ký 2 role này qua API công khai.
// ADMIN cố tình KHÔNG nằm trong danh sách để tránh leo thang đặc quyền
// (client gửi role gì lên cũng không thể tự phong mình làm ADMIN).
const SELF_REGISTER_ROLES = ['CUSTOMER', 'ORGANIZER'] as const;
type SelfRegisterRole = (typeof SELF_REGISTER_ROLES)[number];

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, fullName, role } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin!' });
    }

    // Không bao giờ tin dữ liệu client gửi lên: role lạ (hoặc ADMIN) -> hạ xuống CUSTOMER
    const finalRole: SelfRegisterRole = SELF_REGISTER_ROLES.includes(role)
      ? (role as SelfRegisterRole)
      : 'CUSTOMER';

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

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      getJwtSecret(),
      // Ghim thuật toán thay vì để mặc định: mặc định của thư viện có thể đổi
      // giữa các version, và ta muốn token sinh ra và token verify dùng CHUNG
      // một thuật toán được chỉ định tường minh.
      { algorithm: 'HS256', expiresIn: '1d' }
    );

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