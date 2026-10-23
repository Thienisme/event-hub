import prisma from './prisma';
import { logUnexpectedError } from './errors';

/**
 * Người thực hiện thao tác, dùng để ghi nhật ký.
 *
 * `email` là bản chụp tại thời điểm ghi: nhật ký tồn tại lâu hơn tài khoản, nên
 * khi user bị xoá (`actorId` thành NULL) vẫn phải biết được "ai đã làm".
 */
export interface AuditActor {
  id: string;
  email: string;
}

/**
 * Ghi nhật ký thao tác quản trị.
 *
 * Mọi thao tác đổi role / khoá tài khoản đều phải để lại dấu vết: ai làm, làm
 * gì, lên ai. Nếu không có nhật ký thì khi có sự cố không truy được nguyên nhân.
 *
 * KHÔNG để lỗi ghi log làm hỏng request chính: ghi log là thao tác phụ, thất bại
 * thì chỉ ghi log ở server, không ném lỗi ra client.
 */
export const writeAuditLog = async (
  actor: AuditActor,
  action: string,
  targetId?: string | null,
  metadata?: Record<string, unknown> | null
): Promise<void> => {
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorId: actor.id,
        actorEmail: actor.email,
        action,
        targetId: targetId ?? null,
        metadata: (metadata ?? undefined) as never,
      },
    });
  } catch (error) {
    logUnexpectedError(`audit:${action}`, error);
  }
};
