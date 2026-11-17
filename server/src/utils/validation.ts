import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { UPLOADED_IMAGE_PATH } from './storage';

/** URL banner hợp lệ: http(s) tuyệt đối, hoặc đường dẫn ảnh đã tải lên server. */
const isValidBannerUrl = (value: string): boolean => {
  if (UPLOADED_IMAGE_PATH.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Schema validation cho đăng ký người dùng.
 *
 * Bảo vệ chống:
 * - Input injection (SQL, NoSQL, command injection)
 * - Đăng ký role ADMIN bất hợp pháp
 * - Mật khẩu yếu
 *
 * KHÔNG có field `role`: server luôn gán `CUSTOMER` cho tài khoản mới. Trước đây
 * schema có `role: z.enum(['CUSTOMER','ORGANIZER']).optional()` và controller bỏ
 * qua nó — không phải lỗ hổng (role do server quyết định), nhưng nó khiến người
 * đọc code tưởng rằng client có thể tự chọn vai trò, và API docs ghi sai. Bỏ hẳn
 * field khỏi schema để điều đó không còn khả năng.
 */
export const registerSchema = z.object({
  email: z.string().email('Email không hợp lệ!'),
  password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự!'),
  fullName: z.string().min(2, 'Họ và tên phải có ít nhất 2 ký tự!'),
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
  // users.fullName là VARCHAR(191) mặc định của Prisma.
  FULL_NAME: 191,
  // bcrypt chỉ dùng 72 byte đầu: dài hơn thì phần sau bị bỏ qua âm thầm.
  PASSWORD_BYTES: 72,
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
 * Tính tích trong JS là số thực (double) nên có thể lệch (`0.1 * 3` ra
 * 0.30000000000000004), và nếu so sánh thẳng thì một đơn nằm đúng biên có thể bị
 * từ chối oan. Làm tròn về 2 chữ số thập phân trước khi so sánh.
 */
export const exceedsOrderAmount = (price: number, quantity: number): boolean => {
  const total = Math.round(price * quantity * 100) / 100;
  return total > LIMITS.MAX_ORDER_AMOUNT;
};

export const createEventSchema = z.object({
  category: z.enum(['MUSIC', 'SPORTS', 'CONFERENCE', 'WORKSHOP', 'THEATER', 'EXHIBITION', 'FESTIVAL', 'FOOD', 'OTHER'], {
    message: 'Danh mục sự kiện không hợp lệ!',
  }).optional(),
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
  // Nhận URL http(s) tuyệt đối (ảnh ở nơi khác) hoặc đường dẫn ảnh do chính
  // server sinh ra khi tải lên (`/uploads/<uuid>.<ext>`). Không dùng `.url()`
  // trần vì nó chấp nhận cả `javascript:`, `data:`...
  bannerUrl: z
    .string()
    .max(LIMITS.BANNER_URL, `URL banner không được vượt quá ${LIMITS.BANNER_URL} ký tự!`)
    .refine(isValidBannerUrl, 'URL banner không hợp lệ!')
    .optional()
    .nullable(),
  startTime: z.string().refine((val) => !isNaN(Date.parse(val)), 'Thời gian bắt đầu không hợp lệ!'),
  endTime: z.string().refine((val) => !isNaN(Date.parse(val)), 'Thời gian kết thúc không hợp lệ!'),
  ticketTypes: z
    .array(
      z.object({
        saleStart: z.string().refine(v => !isNaN(Date.parse(v)), 'Thời gian mở bán không hợp lệ!').nullable().optional(),
        saleEnd: z.string().refine(v => !isNaN(Date.parse(v)), 'Thời gian ngừng bán không hợp lệ!').nullable().optional(),
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
})
  // Sự kiện phải KẾT THÚC sau khi bắt đầu. Trước đây schema chỉ kiểm tra ngày có
  // parse được, nên tạo được sự kiện "kết thúc trước khi bắt đầu" — dữ liệu vô
  // nghĩa, và mọi màn hình hiển thị thời gian đều lộn xộn.
  //
  // Đây là ràng buộc QUAN HỆ giữa hai field, nên phải dùng `superRefine` ở cấp
  // object chứ không phải `refine` riêng cho từng field (mỗi field không biết
  // giá trị của field kia).
  .superRefine((data, ctx) => {
    data.ticketTypes?.forEach((ticket, index) => {
      if (ticket.saleEnd && ((ticket.saleStart && Date.parse(ticket.saleEnd) <= Date.parse(ticket.saleStart)) || Date.parse(ticket.saleEnd) > Date.parse(data.endTime))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ticketTypes', index, 'saleEnd'], message: 'Thời gian ngừng bán phải sau mở bán và không sau khi sự kiện kết thúc!' });
      }
    });
    const start = Date.parse(data.startTime);
    const end = Date.parse(data.endTime);

    if (!isNaN(start) && !isNaN(end) && end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'Thời gian kết thúc phải sau thời gian bắt đầu!',
      });
    }
  });

const fullNameField = z
  .string({ message: 'Họ và tên không hợp lệ!' })
  .trim()
  .min(2, 'Họ và tên phải có ít nhất 2 ký tự!')
  .max(LIMITS.FULL_NAME, `Họ và tên không được vượt quá ${LIMITS.FULL_NAME} ký tự!`);

/** Schema đổi hồ sơ: hiện chỉ có tên. */
export const updateProfileSchema = z.object({ fullName: fullNameField });

/** Schema đổi mật khẩu. Mật khẩu không trim: khoảng trắng là một phần mật khẩu. */
export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ message: 'Vui lòng nhập mật khẩu hiện tại!' })
    .min(1, 'Vui lòng nhập mật khẩu hiện tại!'),
  newPassword: z
    .string({ message: 'Mật khẩu mới không hợp lệ!' })
    .min(8, 'Mật khẩu mới phải có ít nhất 8 ký tự!')
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= LIMITS.PASSWORD_BYTES,
      `Mật khẩu mới không được dài quá ${LIMITS.PASSWORD_BYTES} byte!`
    ),
});

/**
 * Schema validation cho đặt hàng.
 */
export const promoCodeField = z.string().trim().toUpperCase()
  .min(3, 'Mã giảm giá phải có từ 3 đến 32 ký tự!')
  .max(32, 'Mã giảm giá phải có từ 3 đến 32 ký tự!')
  .regex(/^[A-Z0-9_-]+$/, 'Mã giảm giá chỉ gồm chữ, số, _ và -!');

export const applyOrderPromoSchema = z.object({ code: promoCodeField });

export const createOrderSchema = z.object({
  promoCode: promoCodeField.optional(),
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
 * Schema validation cho soát vé. Mã QR do server sinh là 22 ký tự base64url
 * (128 bit); trần 64 chỉ để chặn chuỗi rác dài, không ràng buộc định dạng.
 */
export const checkInSchema = z.object({
  qrCode: z
    .string({ message: 'Mã vé không hợp lệ!' })
    .trim()
    .min(1, 'Mã vé không được để trống!')
    .max(64, 'Mã vé không hợp lệ!'),
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
      // Ghi đè body bằng kết quả parse: đây mới là dữ liệu đã được trim và đã bỏ
      // các field lạ. Chỉ kiểm tra rồi vứt kết quả thì controller vẫn nhận dữ liệu gốc.
      req.body = schema.parse(req.body);
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
export const forgotPasswordSchema = z.object({ email: z.string().trim().email('Email không hợp lệ!') });
export const emailTokenSchema = z.object({ token: z.string().min(1, 'Liên kết không hợp lệ!').max(256, 'Liên kết không hợp lệ!') });
export const resetPasswordSchema = emailTokenSchema.extend({ newPassword: changePasswordSchema.shape.newPassword });

const promoFields = z.object({
  code: promoCodeField,
  isPublic: z.boolean({ message: 'Trạng thái công khai không hợp lệ!' }).optional(),
  discountType: z.enum(['PERCENT', 'FIXED'], { message: 'Loại giảm giá không hợp lệ!' }),
  discountValue: z.union([z.number(), z.string()]).refine(v => {
    try {
      const d = new Prisma.Decimal(v);
      return d.isFinite() && d.gt(0) && d.lte('9999999999.99') && d.decimalPlaces() <= 2;
    } catch { return false; }
  }, 'Giá trị giảm giá phải dương, tối đa 9.999.999.999,99 và có tối đa 2 chữ số thập phân!'),
  maxUses: z.number({ message: 'Giới hạn lượt dùng không hợp lệ!' }).int('Giới hạn lượt dùng phải là số nguyên!').min(1, 'Giới hạn lượt dùng phải lớn hơn 0!').max(LIMITS.QUANTITY, 'Giới hạn lượt dùng vượt quá giới hạn cột số nguyên!').nullable().optional(),
  perUserLimit: z.number({ message: 'Giới hạn theo tài khoản không hợp lệ!' }).int('Giới hạn theo tài khoản phải là số nguyên!').min(1, 'Giới hạn theo tài khoản phải lớn hơn 0!').max(LIMITS.QUANTITY, 'Giới hạn theo tài khoản vượt quá giới hạn cột số nguyên!').optional(),
  startsAt: z.string().refine(v => !isNaN(Date.parse(v)), 'Thời gian bắt đầu không hợp lệ!').nullable().optional(),
  endsAt: z.string().refine(v => !isNaN(Date.parse(v)), 'Thời gian kết thúc không hợp lệ!').nullable().optional(),
});
export const createPromoSchema = promoFields.extend({ isPublic: promoFields.shape.isPublic.default(false) });
export const updatePromoSchema = promoFields.partial().extend({ active: z.boolean({ message: 'Trạng thái mã giảm giá không hợp lệ!' }).optional() });
export const previewPromoSchema = createOrderSchema.omit({ promoCode: true }).extend({ code: promoCodeField });

export const payOrderSchema = z.object({ provider: z.enum(['VNPAY', 'MOMO'], { error: 'Cổng thanh toán không hợp lệ!' }) });
