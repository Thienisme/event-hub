-- Index cho job dọn đơn hết hạn: quét theo status + expiresAt thay vì full scan.
CREATE INDEX `orders_status_expiresAt_idx` ON `orders`(`status`, `expiresAt`);

-- Index cho danh sách sự kiện sắp theo createdAt DESC.
CREATE INDEX `events_createdAt_idx` ON `events`(`createdAt`);

-- Schema đang lệch: cột actorEmail có DEFAULT '' trong database nhưng schema
-- không khai báo default. Prisma sinh dòng này khi tạo migration mới; giữ lại
-- để database khớp với schema.
ALTER TABLE `admin_audit_logs` ALTER COLUMN `actorEmail` DROP DEFAULT;
