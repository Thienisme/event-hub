ALTER TABLE `ticket_types` ADD COLUMN `saleStart` DATETIME(3) NULL, ADD COLUMN `saleEnd` DATETIME(3) NULL;
-- Backfill bằng ID vì LOWER/REPLACE trong SQL không bỏ đầy đủ dấu tiếng Việt.
ALTER TABLE `events` ADD COLUMN `slug` VARCHAR(191) NULL;
UPDATE `events` SET `slug` = CONCAT('su-kien-', LEFT(REPLACE(id, '-', ''), 12));
ALTER TABLE `events` MODIFY COLUMN `slug` VARCHAR(191) NOT NULL;
CREATE UNIQUE INDEX `events_slug_key` ON `events` (`slug`);
