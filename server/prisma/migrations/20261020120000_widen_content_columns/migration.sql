-- Nới độ dài các cột nội dung.
--
-- VÌ SAO:
--
-- Prisma mặc định mọi cột String thành VARCHAR(191). 191 là HỆ QUẢ của giới hạn
-- index utf8mb4 (191 * 4 byte = 764 < 767 byte), KHÔNG phải thiết kế có chủ đích.
--
-- Hậu quả: Zod không giới hạn độ dài và form không có maxlength, nên một mô tả dài
-- hơn 191 ký tự đi thẳng tới MySQL. MySQL từ chối ("Data too long for column"),
-- Prisma ném P2000, controller bắt lỗi rồi trả về 500 {"message":"Lỗi máy chủ"} —
-- người dùng không biết mình sai ở đâu.
--
-- Migration này nới cột cho đúng nhu cầu nội dung, và giới hạn tương ứng được
-- đặt ở tầng validation (server/src/utils/validation.ts) để lỗi quá dài được báo
-- cho người dùng dưới dạng 400 kèm thông báo rõ ràng, thay vì 500.
--
-- Không dùng `prisma migrate dev` cho migration này: dự án có một CHECK constraint
-- viết tay (ticket_types_availableQuantity_non_negative) mà Prisma không introspect,
-- `migrate dev` có thể đòi reset database. `migrate deploy` thì không.
ALTER TABLE `events`
  MODIFY COLUMN `title` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `description` TEXT NULL,
  MODIFY COLUMN `location` VARCHAR(255) NOT NULL,
  MODIFY COLUMN `bannerUrl` VARCHAR(500) NULL;

ALTER TABLE `ticket_types`
  MODIFY COLUMN `name` VARCHAR(100) NOT NULL,
  MODIFY COLUMN `price` DECIMAL(12, 2) NOT NULL;

-- Thang tiền phải khớp với ticket_types.price: nếu không, một đơn mua vé giá lớn
-- sẽ không lưu được vào bảng orders.
ALTER TABLE `orders`
  MODIFY COLUMN `totalAmount` DECIMAL(12, 2) NOT NULL;
