import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { handleControllerError } from '../utils/errors';
import {
  cacheGetOrLoad,
  detailCacheKey,
  getListVersion,
  invalidateEventList,
  listCacheKey,
} from '../utils/cache';

// 1. Tạo sự kiện mới
export const createEvent = async (req: Request, res: Response) => {
  try {
    const { title, description, location, bannerUrl, startTime, endTime, ticketTypes } = req.body;
    const organizerId = req.user?.userId;

    if (!organizerId) {
      return res.status(401).json({ message: 'Không xác định được thông tin người tạo!' });
    }

    if (!title || !location || !startTime || !endTime) {
      return res.status(400).json({ message: 'Vui lòng nhập đầy đủ các trường bắt buộc!' });
    }

    const newEvent = await prisma.event.create({
      data: {
        title,
        description,
        location,
        bannerUrl,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        organizerId,
        ticketTypes: ticketTypes && ticketTypes.length > 0 ? {
          create: ticketTypes.map((ticket: { name: string; price: number; totalQuantity: number }) => ({
            name: ticket.name,
            price: ticket.price,
            totalQuantity: ticket.totalQuantity,
            availableQuantity: ticket.totalQuantity,
          })),
        } : undefined,
      },
      include: {
        ticketTypes: true,
      },
    });

    // Vô hiệu cache danh sách khi có event mới.
    // Chỉ tăng version (O(1)) thay cho `KEYS events:list:*` (O(N) và chặn Redis).
    await invalidateEventList();

    return res.status(201).json({
      message: 'Tạo sự kiện thành công!',
      event: newEvent,
    });
  } catch (error) {
    return handleControllerError(res, 'createEvent', error);
  }
};

// 2. Lấy danh sách sự kiện (Có Redis Cache)
export const getEvents = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || '';

    // Khoá cache có kèm version: khi version tăng, mọi key cũ trở nên vô hình.
    const version = await getListVersion();
    const cacheKey = listCacheKey(version, page, limit, search);

    // cacheGetOrLoad lo cả ba việc: đọc cache, chống stampede, và cho biết dữ liệu
    // đến từ đâu ('cache' | 'database') — vừa để FE biết, vừa để đo hit rate.
    const { value: result, source } = await cacheGetOrLoad(cacheKey, async () => {
      const skip = (page - 1) * limit;

      const whereCondition = search
        ? {
            OR: [
              { title: { contains: search } },
              { location: { contains: search } },
            ],
          }
        : {};

      const [events, total] = await Promise.all([
        prisma.event.findMany({
          where: whereCondition,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            organizer: {
              select: { id: true, fullName: true, email: true },
            },
            ticketTypes: true,
          },
        }),
        prisma.event.count({ where: whereCondition }),
      ]);

      return {
        data: events,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });

    return res.json({
      source,
      ...result,
    });
  } catch (error) {
    return handleControllerError(res, 'getEvents', error);
  }
};

// 3. Lấy chi tiết 1 sự kiện (Có Redis Cache)
export const getEventById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // `T` là `Event | null` vì sự kiện có thể không tồn tại. Giá trị null sẽ
    // không được ghi vào cache (xem cacheGetOrLoad).
    const { value: event, source } = await cacheGetOrLoad(
      detailCacheKey(id),
      () =>
        prisma.event.findUnique({
          where: { id },
          include: {
            organizer: {
              select: { id: true, fullName: true, email: true },
            },
            ticketTypes: true,
          },
        })
    );

    if (!event) {
      return res.status(404).json({ message: 'Không tìm thấy sự kiện!' });
    }

    return res.json({
      source,
      data: event,
    });
  } catch (error) {
    return handleControllerError(res, 'getEventById', error);
  }
};