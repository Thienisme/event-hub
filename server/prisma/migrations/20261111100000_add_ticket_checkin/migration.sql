-- Soát vé bằng QR: thời điểm check-in và người quét.
ALTER TABLE `tickets` ADD COLUMN `checkedInAt` DATETIME(3) NULL,
    ADD COLUMN `checkedInById` VARCHAR(191) NULL;

CREATE INDEX `tickets_checkedInById_idx` ON `tickets`(`checkedInById`);

ALTER TABLE `tickets` ADD CONSTRAINT `tickets_checkedInById_fkey` FOREIGN KEY (`checkedInById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
