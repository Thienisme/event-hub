-- Chuyển nhượng vé: người giữ hiện tại (NULL = người mua) và lịch sử chuyển.
ALTER TABLE `tickets` ADD COLUMN `holderId` VARCHAR(191) NULL;

CREATE INDEX `tickets_holderId_idx` ON `tickets`(`holderId`);

ALTER TABLE `tickets` ADD CONSTRAINT `tickets_holderId_fkey` FOREIGN KEY (`holderId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `ticket_transfers` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `fromUserId` VARCHAR(191) NOT NULL,
    `toUserId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ticket_transfers_ticketId_idx`(`ticketId`),
    INDEX `ticket_transfers_fromUserId_idx`(`fromUserId`),
    INDEX `ticket_transfers_toUserId_idx`(`toUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ticket_transfers` ADD CONSTRAINT `ticket_transfers_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ticket_transfers` ADD CONSTRAINT `ticket_transfers_fromUserId_fkey` FOREIGN KEY (`fromUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ticket_transfers` ADD CONSTRAINT `ticket_transfers_toUserId_fkey` FOREIGN KEY (`toUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
