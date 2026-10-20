import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types/express';
import { getJwtSecret } from '../config/auth';
import { getUserState } from '../utils/userState';

/**
 * Xác thực token VÀ kiểm tra tài khoản còn hoạt động.
 *
 * VÌ SAO PHẢI HỎI DB Ở ĐÂY (chứ không chỉ verify chữ ký):
 *
 * Token sống tới 1 ngày và chứa bản sao role từ lúc đăng nhập. Nếu chỉ verify
 * chữ ký thì khi admin khoá một tài khoản, tài khoản đó vẫn đặt vé, vẫn xem đơn,
 * vẫn gọi được API của organizer cho tới khi token hết hạn.
 *
 * Vì vậy sau khi verify token, ta đọc trạng thái tài khoản (có cache Redis, xem
 * utils/userState) và:
 *   - tài khoản không tồn tại  -> 401;
 *   - tài khoản bị khoá        -> 403 (mất mọi quyền ngay lập tức);
 *   - role mới nhất được gán vào `req.user.currentRole` cho các middleware sau.
 *
 * CHI PHÍ: đọc cache Redis (~0,1 ms). Chỉ khi cache trượt mới đọc DB.
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Không tìm thấy token xác thực hoặc sai định dạng!' });
  }

  const token = authHeader.split(' ')[1];

  // Lấy secret NGOÀI try. Thiếu JWT_SECRET là lỗi cấu hình phía SERVER, phải lộ
  // ra là lỗi server — không được đội lốt thành "token không hợp lệ" (403) rồi
  // khiến ta chẩn đoán nhầm phía client.
  const secret = getJwtSecret();

  let decoded: JwtPayload;
  try {
    // Ghim `algorithms` để chặn algorithm confusion: nếu để trống, thư viện tự
    // suy ra thuật toán từ chính header mà client gửi lên.
    decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload;
  } catch {
    return res.status(403).json({ message: 'Token không hợp lệ hoặc đã hết hạn!' });
  }

  req.user = decoded; // Gán thông tin user đã decode vào Request

  try {
    const state = await getUserState(decoded.userId);

    if (!state) {
      return res.status(401).json({ message: 'Không tìm thấy tài khoản!' });
    }

    // Tài khoản bị khoá: token còn hạn cũng không giữ được quyền.
    if (!state.isActive) {
      return res.status(403).json({ message: 'Tài khoản đã bị khoá!' });
    }

    // Role LẤY TỪ DB, không phải role trong token (token có thể đã cũ).
    req.user.currentRole = state.role;
    // Email cũng lấy từ DB: nhật ký quản trị cần "ai đã làm" mà không tốn
    // thêm một lượt đọc DB riêng.
    req.user.email = state.email;

    return next();
  } catch (error) {
    return next(error);
  }
};

/**
 * Phân quyền theo role.
 *
 * VÌ SAO PHẢI ĐỌC ROLE TỪ DB MÀ KHÔNG TIN JWT:
 *
 * Role nằm trong payload của token (`{ userId, role }`) và token sống tới 1 ngày.
 * Nếu chỉ tin JWT thì khi admin hạ quyền hoặc khoá một tài khoản, người đó vẫn
 * giữ được quyền cũ cho tới khi token hết hạn. Đây là lỗ hổng kinh điển của
 * "role trong token" khi không có cơ chế vô hiệu token.
 *
 * Vì vậy ở đây ta luôn hỏi DB về role và trạng thái hiện tại của user:
 *   - role trong DB mới là nguồn sự thật;
 *   - tài khoản bị khoá (isActive = false) thì mất mọi quyền ngay lập tức,
 *     kể cả khi token còn hạn.
 *
 * `authenticate` đã đọc trạng thái tài khoản rồi (và gán `currentRole`), nên bình
 * thường middleware này KHÔNG cần đọc DB lần nữa. Phần đọc lại bên dưới chỉ để
 * `authorize` vẫn dùng được khi ai đó gắn nó độc lập, không có `authenticate`.
 */
export const authorize = (...roles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const userId = user?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Chưa được xác thực!' });
    }

    try {
      let currentRole = user!.currentRole;

      if (!currentRole) {
        const state = await getUserState(userId);

        if (!state) {
          return res.status(401).json({ message: 'Không tìm thấy tài khoản!' });
        }

        if (!state.isActive) {
          return res.status(403).json({ message: 'Tài khoản đã bị khoá!' });
        }

        currentRole = state.role;
        user!.currentRole = currentRole;
      }

      if (!roles.includes(currentRole)) {
        return res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này!' });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};
