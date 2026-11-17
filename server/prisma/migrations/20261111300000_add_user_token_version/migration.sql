-- Phiên bản token: tăng khi đổi mật khẩu để thu hồi mọi token đã cấp.
ALTER TABLE `users` ADD COLUMN `tokenVersion` INTEGER NOT NULL DEFAULT 0;
