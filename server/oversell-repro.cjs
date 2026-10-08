/**
 * TAI HIEN OVERSELL TREN API THAT
 *
 * Chay: node oversell-repro.cjs      (can BE :5000 + MySQL + Redis dang chay)
 *
 * Khong sua code production. Chi dung 2 "van dong":
 *   1. Mot row lock MySQL de lam cham transaction cua request A
 *   2. Xoa lock Redis giua transaction cua A
 *      -> mo phong dung lop loi that: key bi eviction (maxmemory),
 *         Redis failover mat write, hoac TTL bi chinh ngan hon.
 *
 * Neu sau khi lock mat ma DB van bao ve duoc so ve -> khong co lo hong.
 * Neu availableQuantity xuong -1 -> bai toan chong oversell dang
 *   phu thuoc HOAN TOAN vao Redis, khong co luoi an toan o tang DB.
 */
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const prisma = new PrismaClient();
const redis = new Redis({ host: '127.0.0.1', port: 6379 });
const BASE = 'http://localhost:5000/api';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('  ', ...a);

async function api(path, opts) {
  const res = await fetch(BASE + path, opts);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function qty(ticketTypeId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT availableQuantity AS q FROM ticket_types WHERE id = '${ticketTypeId}'`
  );
  return rows[0].q;
}

(async () => {
  let TICKET_TYPE, LOCK_KEY, token, email;
  try {
    // ---------- 0. Chuan bi ----------
    const created = await prisma.ticketType.create({
      data: {
        eventId: (await prisma.event.findFirst()).id,
        name: `Oversell Test ${Date.now()}`,
        price: 100000,
        totalQuantity: 1,
        availableQuantity: 1,
        saleStart: new Date(),
        saleEnd: new Date(Date.now() + 86400000),
      },
    });
    TICKET_TYPE = created.id;
    LOCK_KEY = `locks:ticketType:${TICKET_TYPE}`;
    console.log('\n[0] Tao ticket type:', TICKET_TYPE, '(availableQuantity = 1)\n');

    email = `oversell_${Date.now()}@test.local`;
    const reg = await api('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test12345', fullName: 'Oversell Probe' }),
    });
    const login = await api('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test12345' }),
    });
    token = login.body?.token || login.body?.accessToken;
    if (!token) throw new Error('Khong lay duoc token: ' + JSON.stringify(login.body).slice(0, 200));

    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const buy = () =>
      api('/orders', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ ticketTypeId: TICKET_TYPE, quantity: 1 }),
      });

    // ---------- 1. Holder giu row lock ----------
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
    log('[1] Holder dang giu row lock tren ticket_types (mo phong DB cham luc cao diem)');

    // ---------- 2. Request A ----------
    const pA = buy().then((r) => {
      log(`[A] tra ve HTTP ${r.status} | ${r.body?.message ?? r.body?.order?.id}`);
      return r;
    });
    await sleep(500);
    log('[2] A da giu lock:', (await redis.get(LOCK_KEY)) ? 'CO' : 'KHONG');
    log('    So ve DB luc nay (A chua commit):', await qty(TICKET_TYPE));

    // ---------- 3. Lock bi mat giua transaction ----------
    await sleep(1400);
    await redis.del(LOCK_KEY);
    log('[3] >>> XOA LOCK giua transaction cua A (lock bi mat / eviction / failover)');
    log('    A con dang chay khong? Van chay - no dang bi block, chua commit.');

    // ---------- 4. Request B chen vao ----------
    await sleep(150);
    const pB = buy().then((r) => {
      log(`[B] tra ve HTTP ${r.status} | ${r.body?.message ?? r.body?.order?.id}`);
      return r;
    });
    await sleep(400);
    log('[4] B da giu lock:', (await redis.get(LOCK_KEY)) ? 'CO' : 'KHONG');
    log('    B doc duoc so ve nao?', await qty(TICKET_TYPE), '(A chua commit nen B van thay 1)');

    // ---------- 5. Nha row lock ----------
    await sleep(600);
    log('[5] >>> NHA row lock. A va B se lan luot chay tiep va commit.');
    openGate();

    const [a, b] = await Promise.all([pA, pB]);
    await Promise.allSettled([holder]);

    // ---------- 6. Ket qua ----------
    const finalQty = await qty(TICKET_TYPE);
    const orders = await prisma.order.count({ where: { user: { email } } });

    const oversell = finalQty < 0 || orders > 1;

    console.log('\n================= KET QUA =================');
    console.log('  A tra ve          :', a.status, '|', String(a.body?.message ?? '').split('\n')[0]);
    console.log('  B tra ve          :', b.status, '|', String(b.body?.message ?? '').split('\n')[0]);
    console.log('  So don da tao     :', orders, ' (chi co 1 ve duy nhat ton tai)');
    console.log('  availableQuantity :', finalQty);
    console.log('  ------------------------------------------');
    console.log(
      oversell
        ? '  ❌ OVERSELL: da ban nhieu hon so ve co san'
        : '  ✅ KHONG OVERSELL: ban dung 1 ve, ton kho khong am'
    );
    console.log('===========================================\n');
  } catch (e) {
    console.error('\n[LOI]', e.message);
  } finally {
    await prisma.$disconnect();
    redis.disconnect();
  }
})();