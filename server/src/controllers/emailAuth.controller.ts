import { Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { AppError, handleControllerError } from '../utils/errors';
import { invalidateUserState } from '../utils/userState';
import { escapeHtml, publicLink, sendMailSafe } from '../utils/mailer';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const resetInvalid = 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn!';
const verifyInvalid = 'Liên kết xác minh email không hợp lệ hoặc đã hết hạn!';

export async function sendVerificationEmail(user: { id: string; email: string; fullName: string }) {
  const token = randomBytes(32).toString('base64url');
  await prisma.emailVerificationToken.create({ data: {
    userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
  } });
  const link = publicLink('/verify-email', token);
  await sendMailSafe({ to: user.email, subject: 'Xác minh email EventHub',
    html: `<p>Xin chào ${escapeHtml(user.fullName)},</p><p><a href="${escapeHtml(link)}">Xác minh email</a> (hiệu lực 24 giờ).</p>`,
    text: `Xin chào ${user.fullName}, xác minh email (hiệu lực 24 giờ): ${link}` });
}

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.body.email } });
    if (user?.isActive) {
      const token = randomBytes(32).toString('base64url');
      await prisma.passwordResetToken.create({ data: {
        userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60_000),
      } });
      const link = publicLink('/reset-password', token);
      // KHÔNG await: chờ gửi thư làm phản hồi chậm hẳn khi email tồn tại,
      // đo thời gian là dò được email nào có tài khoản.
      void sendMailSafe({ to: user.email, subject: 'Đặt lại mật khẩu EventHub',
        html: `<p>Xin chào ${escapeHtml(user.fullName)},</p><p><a href="${escapeHtml(link)}">Đặt lại mật khẩu</a> (hiệu lực 30 phút).</p>`,
        text: `Đặt lại mật khẩu (hiệu lực 30 phút): ${link}` });
    }
    return res.json({ message: 'Nếu email thuộc tài khoản đang hoạt động, bạn sẽ nhận được liên kết đặt lại mật khẩu.' });
  } catch (error) { return handleControllerError(res, 'forgotPassword', error); }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const tokenHash = hashToken(req.body.token);
    const password = await bcrypt.hash(req.body.newPassword, 10);
    const userId = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now },
      });
      if (!claimed.count) throw new AppError(resetInvalid, 400);
      const token = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
      if (!user.isActive) throw new AppError(resetInvalid, 400);
      if (await bcrypt.compare(req.body.newPassword, user.password)) {
        throw new AppError('Mật khẩu mới phải khác mật khẩu hiện tại!', 400);
      }
      await tx.user.update({ where: { id: token.userId }, data: { password, tokenVersion: { increment: 1 } } });
      await tx.passwordResetToken.updateMany({ where: { userId: token.userId, usedAt: null }, data: { usedAt: now } });
      return token.userId;
    });
    await invalidateUserState(userId);
    setTimeout(() => void invalidateUserState(userId), 1000).unref();
    return res.json({ message: 'Đặt lại mật khẩu thành công! Vui lòng đăng nhập lại.' });
  } catch (error) { return handleControllerError(res, 'resetPassword', error); }
};

export const verifyEmail = async (req: Request, res: Response) => {
  try {
    const tokenHash = hashToken(req.body.token);
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now },
      });
      if (!claimed.count) throw new AppError(verifyInvalid, 400);
      const token = await tx.emailVerificationToken.findUniqueOrThrow({ where: { tokenHash } });
      await tx.user.updateMany({ where: { id: token.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
      await tx.emailVerificationToken.updateMany({ where: { userId: token.userId, usedAt: null }, data: { usedAt: now } });
    });
    return res.json({ message: 'Xác minh email thành công!' });
  } catch (error) { return handleControllerError(res, 'verifyEmail', error); }
};

export const resendVerification = async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });
    if (!user.emailVerifiedAt) await sendVerificationEmail(user);
    return res.json({ message: user.emailVerifiedAt ? 'Email đã được xác minh.' : 'Đã yêu cầu gửi email xác minh. Vui lòng kiểm tra hộp thư.' });
  } catch (error) { return handleControllerError(res, 'resendVerification', error); }
};
