import { z } from 'zod';

/**
 * Schema validation cho đăng ký người dùng.
 * 
 * Bảo vệ chống:
 * - Input injection (SQL, NoSQL, command injection)
 * - Đăng ký role ADMIN bất hợp pháp
 * - Mật khẩu yếu
 */
export const registerSchema = z.object({
  email: z.string().email('Email không hợp lệ!'),
  password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự!'),
  fullName: z.string().min(2, 'Họ và tên phải có ít nhất 2 ký tự!'),
  role: z.enum(['CUSTOMER', 'ORGANIZER']).optional(),
});

/**
 * Schema validation cho đăng nhập.
 */
export const loginSchema = z.object({
  email: z.string().email('Email không hợp lệ!'),
  password: z.string().min(1, 'Mật khẩu không được để trống!'),
});

/**
 * Schema validation cho tạo sự kiện.
 */
export const createEventSchema = z.object({
  title: z.string().min(1, 'Tiêu đề không được để trống!'),
  description: z.string().optional().nullable(),
  location: z.string().min(1, 'Địa điểm không được để trống!'),
  bannerUrl: z.string().url('URL banner không hợp lệ!').optional().nullable(),
  startTime: z.string().refine((val) => !isNaN(Date.parse(val)), 'Thời gian bắt đầu không hợp lệ!'),
  endTime: z.string().refine((val) => !isNaN(Date.parse(val)), 'Thời gian kết thúc không hợp lệ!'),
  ticketTypes: z.array(
    z.object({
      id: z.string().uuid('ID loại vé không hợp lệ!').optional(),
      name: z.string().min(1, 'Tên loại vé không được để trống!'),
      price: z.number().min(0, 'Giá vé không được âm!'),
      totalQuantity: z.number().int().min(1, 'Số lượng vé phải lớn hơn 0!'),
    })
  ).optional(),
});

/**
 * Schema validation cho đặt hàng.
 */
export const createOrderSchema = z.object({
  ticketTypeId: z.string().uuid('ID loại vé không hợp lệ!'),
  quantity: z.number().int().min(1, 'Số lượng phải lớn hơn 0!'),
});

/**
 * Middleware validation - validates request body against schema
 */
import { Request, Response, NextFunction } from 'express';

export const validateBody = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const message = (error as z.ZodError).issues.map((e) => e.message).join(', ');
        return res.status(400).json({ message });
      }
      next(error);
    }
  };
};