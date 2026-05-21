-- Colunas presentes no schema.prisma mas ausentes no banco após reset.
-- Channel.signature, Message.deliveryStatus, Message.quotedMsgId/Body/Sender

ALTER TABLE `Channel`
  ADD COLUMN `signature` LONGTEXT NULL;

ALTER TABLE `Message`
  ADD COLUMN `deliveryStatus` VARCHAR(191) NULL,
  ADD COLUMN `quotedMsgId`    VARCHAR(191) NULL,
  ADD COLUMN `quotedBody`     TEXT         NULL,
  ADD COLUMN `quotedSender`   VARCHAR(191) NULL;
