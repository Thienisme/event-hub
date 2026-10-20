-- AlterTable
ALTER TABLE `users` ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `roleChangedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `admin_audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `admin_audit_logs_actorId_idx`(`actorId`),
    INDEX `admin_audit_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `users_role_idx` ON `users`(`role`);

-- CreateIndex
CREATE INDEX `users_isActive_idx` ON `users`(`isActive`);

-- AddForeignKey
ALTER TABLE `admin_audit_logs` ADD CONSTRAINT `admin_audit_logs_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
