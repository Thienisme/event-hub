-- Nhật ký quản trị phải SỐNG SÓT khi tài khoản bị xoá.
--
-- Trước đây `actorId` là NOT NULL với ON DELETE RESTRICT: không xoá được một
-- admin từng thao tác quản trị. Với RESTRICT, việc xoá user bị chặn bởi chính
-- nhật ký mà nhật ký sinh ra — và nếu nới FK thành CASCADE thì nhật ký biến mất
-- đúng lúc cần truy vết.
--
-- Giải pháp: actorId nullable + ON DELETE SET NULL, kèm cột `actorEmail` chụp
-- lại email tại thời điểm ghi. Nhật ký không bao giờ mất, và vẫn biết "ai đã làm".

-- AlterTable
ALTER TABLE `admin_audit_logs`
    MODIFY `actorId` VARCHAR(191) NULL,
    ADD COLUMN `actorEmail` VARCHAR(191) NOT NULL DEFAULT '';

-- Backfill: điền email cho các dòng đã có sẵn từ trước khi thêm cột.
UPDATE `admin_audit_logs` `log`
    JOIN `users` `u` ON `u`.`id` = `log`.`actorId`
SET `log`.`actorEmail` = `u`.`email`
WHERE `log`.`actorEmail` = '';

-- Đổi quan hệ: RESTRICT -> SET NULL.
ALTER TABLE `admin_audit_logs` DROP FOREIGN KEY `admin_audit_logs_actorId_fkey`;

ALTER TABLE `admin_audit_logs` ADD CONSTRAINT `admin_audit_logs_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
