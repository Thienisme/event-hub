# OpenSSL cho Prisma; font giúp sharp sinh poster khi seed demo.
FROM node:20-slim AS base
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

FROM base AS client-build
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
ENV VITE_API_BASE_URL=/api
RUN npm run build

FROM base AS deps
COPY server/package.json server/package-lock.json ./
COPY server/prisma ./prisma
RUN npm ci
RUN npx prisma generate

FROM base AS server-build
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production \
    SERVE_CLIENT_DIR=/app/public \
    STORAGE_DRIVER=db
COPY server/package.json server/package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=server-build /app/dist ./dist
COPY server/prisma ./prisma
# Seed dùng ts-node nên cần giữ mã nguồn và cấu hình TypeScript.
COPY server/src ./src
COPY server/tsconfig.json ./
COPY --from=client-build /app/dist ./public
EXPOSE 10000
# Render free không có pre-deploy command nên migrate trước khi nhận request.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/app.js"]
