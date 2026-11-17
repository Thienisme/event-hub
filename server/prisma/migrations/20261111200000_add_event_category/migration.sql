ALTER TABLE `events` ADD COLUMN `category` ENUM('MUSIC', 'SPORTS', 'CONFERENCE', 'WORKSHOP', 'THEATER', 'EXHIBITION', 'FESTIVAL', 'FOOD', 'OTHER') NOT NULL DEFAULT 'OTHER';

CREATE INDEX `events_category_startTime_idx` ON `events` (`category`, `startTime`);
