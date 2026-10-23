import { PrismaClient } from '@prisma/client';

// Ở production KHÔNG log `query`/`info`: vừa ồn vừa có thể ghi dữ liệu truy vấn
// vào log. Chỉ giữ `warn`/`error`. Môi trường dev vẫn log đầy đủ để debug.
const isProduction = process.env.NODE_ENV === 'production';

const prisma = new PrismaClient({
  log: isProduction
    ? ['warn', 'error']
    : ['query', 'info', 'warn', 'error'],
});

export default prisma;