-- Colunas presentes no schema.prisma mas ausentes em algumas instalações.
-- Channel.signature foi movido pra 20260520133050_workspace_settings (era
-- duplicata aqui, gerava erro em installs do zero).

ALTER TABLE `Message`
  ADD COLUMN `deliveryStatus` VARCHAR(191) NULL,
  ADD COLUMN `quotedMsgId`    VARCHAR(191) NULL,
  ADD COLUMN `quotedBody`     TEXT         NULL,
  ADD COLUMN `quotedSender`   VARCHAR(191) NULL;
