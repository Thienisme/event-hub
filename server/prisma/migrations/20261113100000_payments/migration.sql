CREATE TABLE `payments` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `provider` ENUM('MOCK', 'VNPAY', 'MOMO') NOT NULL,
  `txnRef` VARCHAR(20) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `status` ENUM('PENDING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `providerTransactionId` VARCHAR(191) NULL,
  `needsRefund` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `paidAt` DATETIME(3) NULL,
  UNIQUE INDEX `payments_txnRef_key` (`txnRef`),
  INDEX `payments_orderId_idx` (`orderId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `payments_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
