-- Adiciona FK + índice para Message.fromUserId (relação fromUser → User)
-- A coluna `fromUserId` já existia; só precisa de constraint e index.

CREATE INDEX `Message_fromUserId_idx` ON `Message` (`fromUserId`);

ALTER TABLE `Message`
  ADD CONSTRAINT `Message_fromUserId_fkey`
    FOREIGN KEY (`fromUserId`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
