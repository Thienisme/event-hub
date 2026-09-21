/**
 * DOI CHUNG: KHONG can thiep gi. De lock TTL het han TU NHIEN.
 *
 * Chay: node oversell-natural.cjs   (can BE :5000 + MySQL + Redis dang chay)
 *
 * Cau hoi: khi lock 5000ms tu het trong luc transaction A con dang chay,
 * thi co oversell khong?
 *
 * Neu KHONG oversell -> chung minh duoc rang he thong dang duoc bao ve
 *   boi su TRUNG HOP: lock TTL (5000) == Prisma transaction timeout (5000).
 */
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const prisma = new PrismaClient();
const redis = new Redis({ host: '127.0.0.1', port: 6379 });
const BASE = 'http://localhost:5000/api';
const TICKET_TYPE = 'f8978946-4c77-4911-8422-4c36624554ac';
const LOCK_KEY = `locks:ticketType:${TICKET_TYPE}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('  ', ...a);

async function api(path, opts) {
  const res = await fetch(BASE + path, opts);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
async function qty() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT availableQuantity AS q FROM ticket_types WHERE id = '${TICKET_TYPE}'`
  );
  return rows[0].q;
}

(async () => {
  try {
    await prisma.ticketType.update({
      where: { id: TICKET_TYPE },
      data: { availableQuantity: 1 },
    });
    console.log('\n[0] Dat so ve kha dung = 1\n');

    const email = `natural_${Date.now()}@test.local`;
    await api('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test12345', fullName: 'Natural Probe' }),
    });
    const login = await api('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test12345' }),
    });
    const token = login.body?.token || login.body?.accessToken;
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const buy = () =>
      api('/orders', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ ticketTypeId: TICKET_TYPE, quantity: 1 }),
      });

    // Holder giu row lock
    let openGate;
    const gate = new Promise((r) => (openGate = r));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          `SELECT id FROM ticket_types WHERE id = '${TICKET_TYPE}' FOR UPDATE`
        );
        await gate;
        await tx.$queryRawUnsafe('SELECT 1');
      },
      { timeout: 60000, maxWait: 20000 }
    );
    await sleep(300);

    // A
    const t0 = Date.now();
    const pA = buy().then((r) => {
      log(`[A] HTTP ${r.status} sau ${Date.now() - t0}ms | ${r.body?.message ?? 'OK'}`);
      return r;
    });
    await sleep(400);
    log('[1] A dang giu lock. Cho lock TTL 5000ms TU HET (khong can thiep)...');

    // Cho lock tu het
    let expiredAt = null;
    for (let i = 0; i < 400; i++) {
      await sleep(20);
      if (!(await redis.get(LOCK_KEY))) {
        expiredAt = Date.now() - t0;
        break;
      }
    }
    log(`[2] Lock TU HET sau ${expiredAt}ms (A van dang chay, chua commit)`);

    // B chen vao ngay khi lock vua het
    const pB = buy().then((r) => {
      log(`[B] HTTP ${r.status} sau ${Date.now() - t0}ms | ${r.body?.message ?? 'OK'}`);
      return r;
    });
    await sleep(400);
    log('[3] B doc duoc so ve nao?', await qty(), '(A chua commit nen van thay 1)');

    await sleep(300);
    log('[4] NHA row lock de A va B chay tiep');
    openGate();

    const [a, b] = await Promise.all([pA, pB]);
    await Promise.allSettled([holder]);

    const finalQty = await qty();
    const orders = await prisma.order.count({ where: { user: { email } } });
    console.log('\n=========== KET QUA (khong can thiep) ===========');
    console.log('  A tra ve          :', a.status, '|', a.body?.message ?? '');
    console.log('  B tra ve          :', b.status, '|', b.body?.message ?? '');
    console.log('  So don da tao     :', orders);
    console.log('  availableQuantity :', finalQty);
    console.log('=================================================\n');
  } catch (e) {
    console.error('\n[LOI]', e.message);
  } finally {
    await prisma.$disconnect();
    redis.disconnect();
  }
})();
