# syntax=docker/dockerfile:1

# Prisma cần OpenSSL để chạy schema engine (migrate/generate). Dùng Debian slim
# thay vì Alpine để engine chọn đúng bản build cho glibc/OpenSSL 3.
FROM node:20-slim AS base
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Giai đoạn 1: cài dependency (gồm dev) và sinh Prisma Client.
# Prisma Client được generate vào node_modules nên phải làm trước khi build.
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

# Giai đoạn 2: biên dịch TypeScript sang dist/.
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm run build

# Giai đoạn 3: runtime, chỉ chứa node_modules + dist + prisma.
# Giữ prisma CLI (dev dependency) để service migrate trong docker-compose.prod.yml
# chạy được `npx prisma migrate deploy` trên cùng image.
FROM base AS runner
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
# Thư mục ảnh tải lên; docker-compose.prod.yml gắn volume vào đây để không mất ảnh khi build lại.
RUN mkdir -p /app/uploads
ENV UPLOAD_DIR=/app/uploads
EXPOSE 5000
CMD ["node", "dist/app.js"]
