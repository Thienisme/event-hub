/**
 * Seed dữ liệu khởi tạo cho môi trường dev.
 *
 * Tạo (hoặc ĐẶT LẠI) tài khoản quản trị. Vì sao cần:
 *
 * - Không có seed script thì mỗi máy mới phải tự tạo admin bằng tay qua
 *   Prisma Studio hoặc SQL — dễ sai, và dễ quên mật khẩu.
 * - Tài khoản admin là tài khoản có quyền CAO NHẤT. Nếu mất quyền (bị hạ
 *   quyền, bị khoá, bị xoá) thì hệ thống không còn ai quản trị được.
 * - Script này chạy lại được (idempotent): đặt lại mật khẩu và bật lại tài
 *   khoản cho admin đã tồn tại, thay vì báo lỗi trùng email.
 *
 * Chạy:  npm run seed
 *
 * Mật khẩu mặc định đọc từ biến môi trường SEED_ADMIN_PASSWORD; nếu không có
 * thì dùng "admin12345" (chỉ hợp lệ cho môi trường dev).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@test.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'admin12345';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || 'Admin Test';

async function main() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  // `upsert` thay cho "tìm rồi tạo / tìm rồi sửa": chạy lại bao nhiêu lần cũng
  // cho cùng một kết quả, và luôn đảm bảo mật khẩu đúng với tài khoản đã có.
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      password: passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
    create: {
      email: ADMIN_EMAIL,
      password: passwordHash,
      fullName: ADMIN_NAME,
      role: 'ADMIN',
      isActive: true,
    },
    select: { id: true, email: true, role: true, isActive: true },
  });

  console.log('✔ Đã tạo/đặt lại tài khoản quản trị:');
  console.log(`  email    : ${admin.email}`);
  console.log(`  mật khẩu : ${ADMIN_PASSWORD}`);
  console.log(`  role     : ${admin.role} | active: ${admin.isActive}`);

  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '\n⚠ Cảnh báo: đang chạy ở production. Hãy đặt SEED_ADMIN_PASSWORD bằng ' +
        'mật khẩu mạnh và riêng biệt, hoặc bỏ qua script này.'
    );
  }
}

main()
  .catch((error) => {
    console.error('✖ Seed thất bại:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
