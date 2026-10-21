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
  /**
   * Biên trên của `orders.totalAmount` (DECIMAL(12,2)).
   *
   * Giá vé và số lượng phải được kiểm tra RIÊNG, nhưng TÍCH của chúng thì phải
   * vừa biên này: đơn hàng lưu `totalAmount = price * quantity`, nên một loại
   * vé có `price * totalQuantity` vượt biên sẽ tạo được sự kiện nhưng mọi đơn
   * đặt vé đều lỗi 400 khi tới bước ghi. Ràng buộc này chặn ngay lúc tạo sự
   * kiện, kèm thông báo nói rõ loại vé nào vượt.
   */
  MAX_ORDER_AMOUNT: 9_999_999_999.99,
  /**
   * Số vé tối đa trong MỘT đơn.
   *
   * Không chỉ là giới hạn nghiệp vụ mà còn là ràng buộc an toàn cho server:
   * `order.controller.ts` tạo N bản ghi `Ticket` trong RAM bằng
   * `Array.from({ length: quantity })` (~46 byte/phần tử). Một request với
   * quantity = 2.147.483.647 sẽ cần ~100 GB và làm sập tiến trình Node.
   */
  MAX_ORDER_QUANTITY: 100,
} as const;

/**
 * So sánh tổng tiền với biên `MAX_ORDER_AMOUNT`.
 *
 * Tính tích trong JS là số thực (double), nên `3333333333.33 * 3` có thể ra
 * 9999999999.99000000001 — lệch 1 cent so với giá trị thật, và nếu so sánh thẳng
 * thì một đơn HỢP LỆ sẽ bị từ chối oan. Làm tròn về 2 chữ số thập phân trước
 * khi so sánh để không bị sai ở biên.
 */
export const exceedsOrderAmount = (price: number, quantity: number): boolean => {
  const total = Math.round(price * quantity * 100) / 100;
  return total > LIMITS.MAX_ORDER_AMOUNT;
};

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
  ticketTypes: z
    .array(
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
    )
    .optional()
    .superRefine((ticketTypes, ctx) => {
      if (!ticketTypes) return;

      ticketTypes.forEach((ticket, index) => {
        // Giá và số lượng đã được giới hạn riêng ở trên, nhưng TÍCH của chúng
        // thì phải vừa biên của `orders.totalAmount`. Nếu không kiểm tra ở đây
        // thì tạo sự kiện sẽ thành công nhưng mọi đơn đặt vé đều lỗi 400 — người
        // bán thấy sự kiện lên kệ, người mua không mua được.
        if (exceedsOrderAmount(ticket.price, ticket.totalQuantity)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['ticketTypes', index, 'price'],
            message: `Tổng tiền của loại vé "${ticket.name}" (${ticket.price.toLocaleString('vi-VN')} × ${ticket.totalQuantity.toLocaleString('vi-VN')}) vượt quá giới hạn ${LIMITS.MAX_ORDER_AMOUNT.toLocaleString('vi-VN')} của một đơn hàng!`,
          });
        }
      });
    }),
});

/**
 * Schema validation cho đặt hàng.
 */
export const createOrderSchema = z.object({
  ticketTypeId: z.string().uuid('ID loại vé không hợp lệ!'),
  quantity: z
    .number()
    .int()
    .min(1, 'Số lượng phải lớn hơn 0!')
    // Bảo vệ server: controller tạo N bản ghi Ticket trong RAM
    // (Array.from({ length: quantity })), không có trần thì một request có thể
    // làm sập tiến trình Node. Xem LIMITS.MAX_ORDER_QUANTITY.
    .max(
      LIMITS.MAX_ORDER_QUANTITY,
      `Số lượng vé trong một đơn không được vượt quá ${LIMITS.MAX_ORDER_QUANTITY}!`
    ),
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