import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AppError, handleControllerError } from '../utils/errors';
import { joinQueue, getQueueStatus, leaveQueue } from '../utils/waitingRoom';

const handler = (mode: 'join' | 'me' | 'leave') => async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError('Người dùng chưa đăng nhập!', 401);
    const event = await prisma.event.findUnique({ where: { id: req.params.id },
      select: { id: true, queueEnabled: true, queueActiveLimit: true } });
    if (!event) throw new AppError('Sự kiện không tồn tại!', 404);
    if (!event.queueEnabled) {
      if (mode === 'join') throw new AppError('Sự kiện này không dùng phòng chờ!', 409);
      return res.json({ state: 'NONE', queueEnabled: false });
    }
    if (mode === 'leave') {
      await leaveQueue(event.id, userId);
      return res.json({ state: 'NONE', queueEnabled: true });
    }
    return res.json(await (mode === 'join' ? joinQueue : getQueueStatus)(event.id, userId, event.queueActiveLimit));
  } catch (error) {
    return handleControllerError(res, `queue:${mode}`, error);
  }
};
export const joinEventQueue = handler('join');
export const getMyQueueStatus = handler('me');
export const leaveEventQueue = handler('leave');
