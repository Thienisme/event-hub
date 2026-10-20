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

/**
 * Giới hạn độ dài / giá trị — PHẢI khớp với cột DB.
 *
 * Xem migration `20261020120000_widen_content_columns`:
 *   events.title        VARCHAR(255)
 *   events.description  TEXT          -> lấy mốc 5000 cho UX
 *   events.location     VARCHAR(255)
 *   events.bannerUrl    VARCHAR(500)
 *   ticket_types.name   VARCHAR(100)
 *   ticket_types.price  DECIMAL(12,2) -> tối đa 9.999.999.999,99
 *   ticket_types.totalQuantity INTEGER -> tối đa 2.147.483.647
 *
 * VÌ SAO PHẢI GIỚI HẠN Ở ĐÂY:
 *
 * Nếu không, dữ liệu quá dài đi thẳng tới MySQL, MySQL từ chối, Prisma ném
 * P2000/P2020, và controller trả về 500 {"message":"Lỗi máy chủ"} — người dùng
 * không biết mình sai ở đâu. Giới hạn ở tầng validation biến lỗi đó thành 400
 * kèm thông báo nói rõ trường nào vượt và vượt bao nhiêu.
 *
 * Lưu ý: `description` là TEXT nên về kỹ thuật không giới hạn, nhưng ta vẫn chặn
 * ở 5000 ký tự để không dồn dữ liệu vô nghĩa vào DB.
 */
export const LIMITS = {
  TITLE: 255,
  DESCRIPTION: 5000,
  LOCATION: 255,
  BANNER_URL: 500,
  TICKET_NAME: 100,
  // 9.999.999.999,99 — biên trên của DECIMAL(12,2)
  PRICE: 9_999_999_999.99,
  // Biên trên của MySQL INTEGER
  QUANTITY: 2_147_483_647,
} as const;

export const createEventSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Tiêu đề không được để trống!')
    .max(LIMITS.TITLE, `Tiêu đề không được vượt quá ${LIMITS.TITLE} ký tự!`),
  description: z
    .string()
    .max(LIMITS.DESCRIPTION, `Mô tả không được vượt quá ${LIMITS.DESCRIPTION} ký tự!`)
    .optional()
    .nullable(),
  location: z
    .string()
    .trim()
    .min(1, 'Địa điểm không được để trống!')
    .max(LIMITS.LOCATION, `Địa điểm không được vượt quá ${LIMITS.LOCATION} ký tự!`),
  bannerUrl: z
    .string()
    .url('URL banner không hợp lệ!')
    .max(LIMITS.BANNER_URL, `URL banner không được vượt quá ${LIMITS.BANNER_URL} ký tự!`)
    .optional()
    .nullable(),
  startTime: z.string().refine((val) => !isNaN(Date.parse(val)), 'Thời gian bắt đầu không hợp lệ!'),
  endTime: z.string().refine((val) => !isNaN(Date.parse(val)), 'Thời gian kết thúc không hợp lệ!'),
  ticketTypes: z.array(
    z.object({
      id: z.string().uuid('ID loại vé không hợp lệ!').optional(),
      name: z
        .string()
        .trim()
        .min(1, 'Tên loại vé không được để trống!')
        .max(LIMITS.TICKET_NAME, `Tên loại vé không được vượt quá ${LIMITS.TICKET_NAME} ký tự!`),
      price: z
        .number()
        .min(0, 'Giá vé không được âm!')
        .max(LIMITS.PRICE, `Giá vé không được vượt quá ${LIMITS.PRICE.toLocaleString('vi-VN')}!`),
      totalQuantity: z
        .number()
        .int()
        .min(1, 'Số lượng vé phải lớn hơn 0!')
        .max(LIMITS.QUANTITY, `Số lượng vé không được vượt quá ${LIMITS.QUANTITY.toLocaleString('vi-VN')}!`),
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
 * Schema validation cho thao tác đổi vai trò tài khoản (ADMIN).
 *
 * Enum gồm cả 3 role hợp lệ. Việc "có được phép hạ quyền admin cuối cùng hay
 * không" không kiểm ở đây mà ở controller, vì cần đếm số admin còn lại trong DB.
 */
export const updateRoleSchema = z.object({
  role: z.enum(['CUSTOMER', 'ORGANIZER', 'ADMIN'] as const, {
    message: 'Vai trò không hợp lệ!',
  }),
});

/**
 * Schema validation cho thao tác khoá / mở khoá tài khoản (ADMIN).
 */
export const updateUserStatusSchema = z.object({
  isActive: z.boolean({
    message: 'Trạng thái tài khoản không hợp lệ!',
  }),
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