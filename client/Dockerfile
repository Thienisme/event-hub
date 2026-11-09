# syntax=docker/dockerfile:1

# Giai đoạn 1: build Vue + Vite.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Mặc định gọi cùng origin: nginx bên dưới chuyển /api sang service server.
# Có thể override bằng build arg khi client và API nằm ở domain khác.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# Giai đoạn 2: phục vụ file tĩnh bằng nginx.
FROM nginx:1.27-alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
