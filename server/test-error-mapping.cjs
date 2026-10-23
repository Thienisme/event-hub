/**
 * Test lớp ánh xạ lỗi Prisma -> thông báo tiếng Việt.
 *
 * Đây là LỚP PHÒNG THỦ CUỐI: nếu một trường nào đó lọt qua validation và chết
 * ở tầng DB, người dùng vẫn phải nhận 400/409 có thông báo rõ ràng, KHÔNG phải
 * 500 "Lỗi máy chủ".
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// errors.ts là TypeScript -> dùng ts-node để nạp thật, tránh chép lại logic.
// Phải khai báo module/moduleResolution giống hệt tsconfig của server,
// nếu không ts-node sẽ báo xung đột (TS5110).
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', esModuleInterop: true },
});
const { mapPrismaError } = require('./src/utils/errors.ts');

const G = '\u001b[32m';
const R = '\u001b[31m';
const D = '\u001b[2m';
const X = '\u001b[0m';

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ${G}✅${X} ${name}${detail ? ` ${D}— ${detail}${X}` : ''}`);
  } else {
    failed += 1;
    console.log(`  ${R}❌${X} ${name}${detail ? ` ${D}— ${detail}${X}` : ''}`);
  }
}

console.log(`\n${D}Test mapPrismaError${X}`);

// P2000 — giá trị quá dài cho cột (đúng như Prisma báo khi đọc từ MySQL)
const p2000 = {
  name: 'PrismaClientKnownRequestError',
  code: 'P2000',
  meta: { modelName: 'Event', column_name: 'description' },
  message: "Invalid `prisma.event.create()` invocation\nThe provided value for the column is too long for the column's type. Column: description",
};
const r2000 = mapPrismaError(p2000);
check(
  'P2000 -> 400, nêu đúng tên cột',
  r2000 && r2000.statusCode === 400 && r2000.message.includes('description'),
  r2000 ? `${r2000.statusCode} "${r2000.message}"` : 'null'
);

// P2020 — giá trị nằm ngoài khoảng của kiểu
const p2020 = {
  name: 'PrismaClientKnownRequestError',
  code: 'P2020',
  meta: { modelName: 'TicketType', details: "Out of range value for column 'price' at row 1" },
  message: "Value out of range for the type. Out of range value for column 'price' at row 1",
};
const r2020 = mapPrismaError(p2020);
check(
  'P2020 -> 400, nêu đúng tên cột',
  r2020 && r2020.statusCode === 400 && r2020.message.includes('price'),
  r2020 ? `${r2020.statusCode} "${r2020.message}"` : 'null'
);

// P2002 — trùng UNIQUE
const p2002 = {
  name: 'PrismaClientKnownRequestError',
  code: 'P2002',
  meta: { target: ['email'] },
  message: 'Unique constraint failed on the fields: (`email`)',
};
const r2002 = mapPrismaError(p2002);
check('P2002 -> 409', r2002 && r2002.statusCode === 409, r2002 ? `${r2002.statusCode}` : 'null');

// P2003 — sai foreign key
const p2003 = {
  name: 'PrismaClientKnownRequestError',
  code: 'P2003',
  meta: { field_name: 'organizerId' },
  message: 'Foreign key constraint failed on the field: `organizerId`',
};
const r2003 = mapPrismaError(p2003);
check('P2003 -> 400', r2003 && r2003.statusCode === 400, r2003 ? `${r2003.statusCode}` : 'null');

// Lỗi MySQL thô đi qua đường khác (không có mã Prisma)
const rawMysql = new Error("Data too long for column 'bannerUrl' at row 1");
const rRaw = mapPrismaError(rawMysql);
check(
  'lỗi MySQL thô (không mã Prisma) -> 400',
  rRaw && rRaw.statusCode === 400,
  rRaw ? `${rRaw.statusCode} "${rRaw.message}"` : 'null'
);

// Lỗi không xác định -> để caller rơi về 500
check(
  'lỗi lạ -> null (rơi về 500)',
  mapPrismaError(new Error('một lỗi nào đó')) === null &&
    mapPrismaError(undefined) === null &&
    mapPrismaError('string') === null
);

console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
