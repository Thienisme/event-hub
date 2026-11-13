CREATE TABLE `waitlist_entries` (
  `id` VARCHAR(191) NOT NULL,
  `ticketTypeId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `notifiedAt` DATETIME(3) NULL,
  UNIQUE INDEX `waitlist_entries_ticketTypeId_userId_key` (`ticketTypeId`, `userId`),
  INDEX `waitlist_entries_ticketTypeId_notifiedAt_createdAt_idx` (`ticketTypeId`, `notifiedAt`, `createdAt`),
  INDEX `waitlist_entries_userId_idx` (`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `waitlist_entries` ADD CONSTRAINT `waitlist_entries_ticketTypeId_fkey` FOREIGN KEY (`ticketTypeId`) REFERENCES `ticket_types` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `waitlist_entries` ADD CONSTRAINT `waitlist_entries_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
