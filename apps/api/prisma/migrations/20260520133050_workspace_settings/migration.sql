-- DropIndex
DROP INDEX `Conversation_workspaceId_status_idx` ON `Conversation`;

-- AlterTable: adiciona coluna `signature`. Originalmente era um MODIFY
-- assumindo que a coluna já existia, mas ela só era criada na migration
-- 20260521_missing_columns (ordem errada em installs do zero).
ALTER TABLE `Channel` ADD COLUMN `signature` TEXT NULL;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_fromContactId_fkey` FOREIGN KEY (`fromContactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
