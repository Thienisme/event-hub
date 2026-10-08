# EventHub — Hệ thống bán vé sự kiện

Hệ thống bán vé trực tuyến với trọng tâm **chống oversell khi hàng nghìn người mua cùng lúc**.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Express 4, TypeScript, Prisma ORM |
| Database | MySQL 8 (CHECK constraint, row-level lock) |
| Cache / Lock | Redis 7 (ioredis, Redlock) |
| Frontend | Vue 3, TypeScript, Pinia, Tailwind v4, Vue Router |
| Auth | JWT HS256, bcrypt cost 10, HttpOnly cookie |
| Test / Load | k6, custom oversell scripts |

## Tính năng chính

- **Đăng ký / Đăng nhập** — JWT + bcrypt, rate limit 5 lần sai/1 phút cho `/auth/*`
- **Quản lý sự kiện** — CRUD, phân quyền organizer/admin, kiểm tra ownership
- **Đặt vé** — Giữ chỗ 10 phút (`PENDING`), job nền chuyển `EXPIRED` và trả vé về kho
- **Chống oversell (3 lớp)**:
  1. Redis Redlock (TTL 10s, auto-extend)
  2. CAS `updateMany` trong transaction (`WHERE quantity > 0`)
  3. MySQL `CHECK (quantity >= 0)` — last line of defense
- **Cache Redis** — versioned key, single-flight, fail-open, TTL 60s
- **Bảo mật** — Zod validation, CORS whitelist, helmet, rate limit, error classification 400/429/500

## Quick Start

```bash
# Backend
cd server
cp .env.example .env   # chỉnh DATABASE_URL, REDIS_URL, JWT_SECRET
npm install
npx prisma migrate deploy
npm run dev

# Frontend
cd client
npm install
npm run dev
```

## Scripts hữu ích

```bash
# Server
npm run dev          # ts-node-dev watch
npm run build        # tsc compile
npm run test:security   # 13 JWT security tests
npm run test:oversell   # 2 oversell scenarios (lock expiry / lock deletion)

# Load test (k6)
k6 run load-test-concurrent.js

# Frontend
npm run dev
npm run build
```

## Kiến trúc chống oversell

```
Request → Redlock (Redis) → Prisma Transaction
                    ↓
            SELECT FOR UPDATE (ticket_types)
                    ↓
            CAS: UPDATE ticket_types SET quantity = quantity - 1
                 WHERE id = ? AND quantity > 0
                    ↓
            CHECK constraint (quantity >= 0) — MySQL guarantee
```

Kết quả load test: **200 VU, 10 vé → đúng 10 đơn, 0 oversell, 0 lỗi 5xx**.

## Tài liệu chi tiết

Xem `PROJECT_NOTES.md` (833 dòng) — giải thích trade-off, số đo benchmark, gap đã biết.

## License

MIT