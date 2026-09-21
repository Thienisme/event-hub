import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { handleControllerError } from '../utils/errors';
import { getJwtSecret } from '../config/auth';

// Người dùng tự đăng ký luôn được gán role CUSTOMER.
// Role ORGANIZER/ADMIN chỉ có thể thay đổi thông qua cơ chế nội bộ (ví dụ: admin panel).
const SELF_REGISTER_ROLE = 'CUSTOMER';

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