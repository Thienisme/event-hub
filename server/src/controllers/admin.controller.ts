import { Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { handleControllerError } from '../utils/errors';
import { writeAuditLog } from '../utils/audit';
import { invalidateUserState } from '../utils/userState';

const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Lỗi nghiệp vụ: hành động sẽ để lại hệ thống không còn admin nào quản trị được.
 *
 * Tách riêng khỏi lỗi kỹ thuật để trả về đúng mã 400 (lỗi nghiệp vụ) thay vì 500.
 */
class LastAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LastAdminError';
  }
}

/**
 * Khoá các dòng admin đang hoạt động rồi đếm số lượng, trong cùng transaction.
 *
 * VÌ SAO PHẢI KHOÁ:
 *
 * Nếu chỉ đếm rồi mới cập nhật (không khoá), hai admin có thể CÙNG LÚC hạ quyền
 * lẫn nhau: cả hai đều thấy "còn admin khác đang hoạt động" nên cả hai đều được
 * phép, và sau đó hệ thống không còn admin nào. `SELECT ... FOR UPDATE` xếp hai
 * giao dịch này thành hàng đợi, nên giao dịch sau luôn thấy trạng thái đã commit
 * của giao dịch trước và tự chặn nếu việc đó sẽ làm hệ thống hết admin.
 *
 * Đếm bằng cách đọc các dòng (locking read) rồi đếm trong JS, KHÔNG dùng
 * `count()`: trong MySQL, `count()` là consistent read theo snapshot của
 * transaction, nên có thể đọc trạng thái CŨ hơn trạng thái mà locking read vừa
 * khoá — mở lại đúng lỗ hổng ta đang cố chặn.
 */
const lockAndCountActiveAdmins = async (
  tx: Prisma.TransactionClient
): Promise<number> => {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM \`users\` WHERE \`role\` = 'ADMIN' AND \`isActive\` = 1 FOR UPDATE
  `;
  return rows.length;
};

/**
 * Danh sách người dùng (ADMIN).
 *
 * Phân trang ở server: bảng users có thể lớn, không bao giờ trả về toàn bộ.
 * Lọc theo: từ khoá (email/tên), role, trạng thái (đang hoạt động / bị khoá).
 */
export const listUsers = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const search = String(req.query.search ?? '').trim();
    const role = String(req.query.role ?? '').trim();
    const status = String(req.query.status ?? '').trim();

    const where = {
      ...(search
        ? {
            OR: [
              { email: { contains: search } },
              { fullName: { contains: search } },
            ],
          }
        : {}),
      ...(role && role !== 'ALL' ? { role: role as Role } : {}),
      ...(status === 'ACTIVE' ? { isActive: true } : {}),
      ...(status === 'LOCKED' ? { isActive: false } : {}),
    };

    const [users, total, counts] = await Promise.all([
      prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
      prisma.user.groupBy({
        by: ['role'],
        _count: { _all: true },
      }),
    ]);

    // Tổng số theo trạng thái để vẽ badge cạnh bộ lọc.
    const [activeCount, lockedCount] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isActive: false } }),
    ]);

    return res.json({
      message: 'Lấy danh sách người dùng thành công!',
      data: users,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      stats: {
        total: counts.reduce((sum, item) => sum + item._count._all, 0),
        active: activeCount,
        locked: lockedCount,
        byRole: counts.reduce<Record<string, number>>((acc, item) => {
          acc[item.role] = item._count._all;
          return acc;
        }, {}),
      },
    });
  } catch (error) {
    return handleControllerError(res, 'admin.listUsers', error);
  }
};

/**
 * Đổi role của một tài khoản (ADMIN).
 *
 * Chốt chặn quan trọng:
 * - Không cho admin tự hạ quyền chính mình: dễ xảy ra nhầm lẫn, và nếu là admin
 *   cuối cùng thì hệ thống không còn ai quản trị được.
 * - Không để lại hệ thống không còn admin nào: khoá dòng admin trong transaction
 *   để chặn cả trường hợp hai admin hạ quyền lẫn nhau cùng lúc.
 */
export const updateUserRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { role } = req.body as { role: Role };
    const actorId = req.user!.userId;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true, email: true },
    });

    if (!target) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản!' });
    }

    if (target.id === actorId && role !== 'ADMIN') {
      return res.status(400).json({
        message: 'Bạn không thể tự hạ quyền tài khoản của chính mình!',
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const activeAdmins = await lockAndCountActiveAdmins(tx);

      // Đây là admin đang hoạt động cuối cùng -> hạ quyền nó là hệ thống không
      // còn ai quản trị được.
      if (target.role === 'ADMIN' && role !== 'ADMIN' && activeAdmins <= 1) {
        throw new LastAdminError('Không thể hạ quyền admin cuối cùng của hệ thống!');
      }

      return tx.user.update({
        where: { id },
        data: { role, roleChangedAt: new Date() },
        select: USER_SELECT,
      });
    });

    // Vô hiệu cache trạng thái: tài khoản này phải nhận quyền mới ngay ở request
    // kế tiếp, không đợi cache hết hạn.
    await invalidateUserState(id);

    await writeAuditLog(
      { id: actorId, email: req.user!.email ?? '' },
      'user.role.updated',
      id,
      {
        from: target.role,
        to: role,
        email: target.email,
      }
    );

    return res.json({
      message: `Đã cập nhật vai trò thành ${role}!`,
      data: updated,
    });
  } catch (error) {
    if (error instanceof LastAdminError) {
      return res.status(400).json({ message: error.message });
    }
    return handleControllerError(res, 'admin.updateUserRole', error);
  }
};

/**
 * Khoá / mở khoá tài khoản (ADMIN).
 *
 * Khoá = không đăng nhập được + token đang cầm mất quyền ngay (kiểm tra isActive
 * trong authorize). Admin không được tự khoá chính mình.
 */
export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body as { isActive: boolean };
    const actorId = req.user!.userId;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true, email: true },
    });

    if (!target) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản!' });
    }

    if (target.id === actorId && !isActive) {
      return res.status(400).json({
        message: 'Bạn không thể tự khoá tài khoản của chính mình!',
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const activeAdmins = await lockAndCountActiveAdmins(tx);

      // Khoá admin đang hoạt động cuối cùng -> không còn ai quản trị được.
      if (target.role === 'ADMIN' && target.isActive && !isActive && activeAdmins <= 1) {
        throw new LastAdminError('Không thể khoá admin cuối cùng của hệ thống!');
      }

      return tx.user.update({
        where: { id },
        data: { isActive },
        select: USER_SELECT,
      });
    });

    // Vô hiệu cache trạng thái: tài khoản bị khoá phải mất quyền ngay ở request
    // kế tiếp (dù token của nó còn hạn tới 1 ngày).
    await invalidateUserState(id);

    await writeAuditLog(
      { id: actorId, email: req.user!.email ?? '' },
      isActive ? 'user.unlocked' : 'user.locked',
      id,
      {
        email: target.email,
      }
    );

    return res.json({
      message: isActive ? 'Đã mở khoá tài khoản!' : 'Đã khoá tài khoản!',
      data: updated,
    });
  } catch (error) {
    if (error instanceof LastAdminError) {
      return res.status(400).json({ message: error.message });
    }
    return handleControllerError(res, 'admin.updateUserStatus', error);
  }
};

/**
 * Thống kê tổng quan (ADMIN).
 *
 * Doanh thu chỉ tính đơn CONFIRMED: PENDING là vé đang giữ chỗ, EXPIRED/CANCELLED
 * thì không thu được tiền.
 */
export const getAdminStats = async (req: Request, res: Response) => {
  try {
    const [userCount, organizerCount, eventCount, orderCount, revenueAgg, recentOrders] =
      await Promise.all([
        prisma.user.count({ where: { role: 'CUSTOMER' } }),
        prisma.user.count({ where: { role: 'ORGANIZER' } }),
        prisma.event.count(),
        prisma.order.count(),
        prisma.order.aggregate({
          where: { status: 'CONFIRMED' },
          _sum: { totalAmount: true },
          _count: { _all: true },
        }),
        prisma.order.findMany({
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            totalAmount: true,
            status: true,
            createdAt: true,
            user: { select: { id: true, fullName: true, email: true } },
          },
        }),
      ]);

    return res.json({
      message: 'Lấy thống kê thành công!',
      data: {
        users: userCount,
        organizers: organizerCount,
        events: eventCount,
        orders: orderCount,
        confirmedOrders: revenueAgg._count._all,
        revenue: revenueAgg._sum.totalAmount ?? 0,
        recentOrders,
      },
    });
  } catch (error) {
    return handleControllerError(res, 'admin.getStats', error);
  }
};

/** Danh sách toàn bộ sự kiện (ADMIN) — kèm số vé đã bán để quản lý. */
export const listAllEvents = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const search = String(req.query.search ?? '').trim();

    const where = search
      ? { OR: [{ title: { contains: search } }, { location: { contains: search } }] }
      : {};

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          title: true,
          location: true,
          startTime: true,
          endTime: true,
          createdAt: true,
          organizer: { select: { id: true, fullName: true, email: true } },
          ticketTypes: {
            select: {
              id: true,
              name: true,
              price: true,
              totalQuantity: true,
              availableQuantity: true,
            },
          },
        },
      }),
      prisma.event.count({ where }),
    ]);

    return res.json({
      message: 'Lấy danh sách sự kiện thành công!',
      data: events,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return handleControllerError(res, 'admin.listAllEvents', error);
  }
};

/** Nhật ký thao tác quản trị (ADMIN). */
export const listAuditLogs = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));

    const [logs, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          action: true,
          targetId: true,
          metadata: true,
          createdAt: true,
          // `actor` có thể null nếu tài khoản đã bị xoá sau đó (FK SET NULL).
          // `actorEmail` là bản chụp nên nhật ký vẫn biết "ai đã làm".
          actorEmail: true,
          actor: { select: { id: true, fullName: true, email: true } },
        },
      }),
      prisma.adminAuditLog.count(),
    ]);

    return res.json({
      message: 'Lấy nhật ký quản trị thành công!',
      data: logs,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return handleControllerError(res, 'admin.listAuditLogs', error);
  }
};
