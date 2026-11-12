ALTER TABLE `orders` ADD COLUMN `reminderSentAt` DATETIME(3) NULL;
CREATE INDEX `orders_status_reminderSentAt_idx` ON `orders`(`status`, `reminderSentAt`);
