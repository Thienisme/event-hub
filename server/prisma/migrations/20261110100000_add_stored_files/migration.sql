-- Chỉ thêm bảng ảnh, tránh thay đổi default actorEmail ngoài phạm vi.
CREATE TABLE `stored_files` (
    `name` VARCHAR(64) NOT NULL,
    `mime` VARCHAR(32) NOT NULL,
    `size` INTEGER NOT NULL,
    `data` MEDIUMBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
