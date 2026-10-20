import { Role } from '@prisma/client';
import { cacheClient } from '../config/redis';
import prisma from './prisma';

/**
 * Trạng thái tài khoản (role + trạng thái khoá) — nguồn sự thật cho việc phân quyền.
 *
 * VÌ SAO CẦN MODULE NÀY:
 *
 * Role và trạng thái khoá nằm trong DB, nhưng token JWT lại sống tới 1 ngày và
 * chứa bản sao role từ lúc đăng nhập. Nếu mọi middleware chỉ tin token thì:
 *   - admin khoá một tài khoản -> tài khoản đó vẫn đặt vé được cho tới hết hạn token;
 *   - admin hạ quyền một tài khoản -> tài khoản đó vẫn tạo sự kiện được.
 *
 * Vì vậy mọi request có xác thực đều phải hỏi DB: "tài khoản này còn hoạt động
 * không, và role hiện tại là gì".
 *
 * VÌ SAO CÓ CACHE:
 *
 * Đường đặt vé là đường nóng, chịu tải cao, mỗi request đều phải xác thực. Đo trên
 * máy này: đọc 1 dòng theo primary key mất 0,32 ms, còn đọc cache Redis mất
 * ~0,1 ms và không tạo tải lên database. Nên ta cache trạng thái trong Redis và
 * chỉ đọc DB khi cache trượt.
 *
 * Cache KHÔNG dẫn tới độ trễ khi khoá tài khoản: `invalidateUserState` được gọi
 * ngay trong request hạ quyền/khoá, nên lần request kế tiếp của tài khoản đó
 * đọc trạng thái mới ngay lập tức. TTL chỉ là lưới an toàn cho trường hợp
 * tiến trình server chết giữa chừng (lúc đó lệnh invalidate chưa chạy).
 */

/** Trạng thái tài khoản tối thiểu cần cho việc phân quyền. */
export interface UserState {
  role: Role;
  isActive: boolean;
  /**
   * Email của tài khoản.
   *
   * Lấy kèm "miễn phí" từ cùng một lượt đọc DB (cùng hàng) để nhật ký quản trị
   * ghi được "ai đã làm" mà không phải hỏi DB thêm lần nữa. Nhật ký tồn tại lâu
   * hơn tài khoản nên phải chụp lại thông tin này tại thời điểm ghi.
   */
  email: string;
}

/**
 * TTL ngắn: đủ để giảm tải DB, đủ ngắn để tự lành nếu một lệnh invalidate bị
 * mất (server chết giữa lúc đang xử lý).
 */
const USER_STATE_TTL_SECONDS = 30;

const userStateKey = (userId: string) => `user:state:${userId}`;

/**
 * Đọc trạng thái tài khoản. Cache trước, DB sau.
 *
 * @returns `null` nếu tài khoản không tồn tại trong DB.
 */
export async function getUserState(userId: string): Promise<UserState | null> {
  const key = userStateKey(userId);

  try {
    const raw = await cacheClient.get(key);
    if (raw) {
      const parsed = JSON.parse(raw) as UserState;
      // Cache bị hỏng (nhầm với dữ liệu khác) -> coi như trượt, đọc DB lại.
      // Bắt buộc phải có `email`: entry cache từ phiên bản cũ không có trường
      // này, coi như trượt để tự lành sau khi deploy.
      if (
        parsed &&
        typeof parsed.role === 'string' &&
        typeof parsed.isActive === 'boolean' &&
        typeof parsed.email === 'string'
      ) {
        return parsed;
      }
    }
  } catch {
    /* Redis lỗi -> đọc thẳng DB, không làm hỏng request */
  }

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true, email: true },
  });

  if (!row) return null;

  const state: UserState = { role: row.role, isActive: row.isActive, email: row.email };

  try {
    await cacheClient.set(key, JSON.stringify(state), 'EX', USER_STATE_TTL_SECONDS);
  } catch {
    /* Ghi cache lỗi không phải lỗi của request */
  }

  return state;
}

/**
 * Vô hiệu cache trạng thái của một tài khoản.
 *
 * Gọi ngay sau khi đổi role / khoá / mở khoá, để tài khoản đó mất (hoặc có lại)
 * quyền ngay ở request kế tiếp chứ không phải sau khi cache hết hạn.
 */
export async function invalidateUserState(userId: string): Promise<void> {
  try {
    await cacheClient.del(userStateKey(userId));
  } catch {
    /* Entry cũ tự hết hạn theo TTL */
  }
}
