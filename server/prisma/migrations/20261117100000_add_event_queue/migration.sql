ALTER TABLE `events`
  ADD `queueEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD `queueActiveLimit` INT NOT NULL DEFAULT 100;
