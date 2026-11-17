CREATE TABLE `promo_codes` (
  `id` VARCHAR(191) NOT NULL,
  `eventId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(32) NOT NULL,
  `discountType` ENUM('PERCENT', 'FIXED') NOT NULL,
  `discountValue` DECIMAL(12,2) NOT NULL,
  `maxUses` INTEGER NULL,
  `usedCount` INTEGER NOT NULL DEFAULT 0,
  `perUserLimit` INTEGER NOT NULL DEFAULT 1,
  `startsAt` DATETIME(3) NULL,
  `endsAt` DATETIME(3) NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `promo_codes_eventId_code_key` (`eventId`, `code`),
  CONSTRAINT `promo_codes_usedCount_check` CHECK (`usedCount` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `promo_codes` ADD CONSTRAINT `promo_codes_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `orders` ADD COLUMN `subtotalAmount` DECIMAL(12,2) NULL,
  ADD COLUMN `discountAmount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `promoCodeId` VARCHAR(191) NULL;
UPDATE `orders` SET `subtotalAmount` = `totalAmount`, `discountAmount` = 0;
ALTER TABLE `orders` MODIFY COLUMN `subtotalAmount` DECIMAL(12,2) NOT NULL;
CREATE INDEX `orders_promoCodeId_userId_status_idx` ON `orders` (`promoCodeId`, `userId`, `status`);
ALTER TABLE `orders` ADD CONSTRAINT `orders_promoCodeId_fkey` FOREIGN KEY (`promoCodeId`) REFERENCES `promo_codes` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
