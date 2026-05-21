-- DropIndex
DROP INDEX `Conversation_workspaceId_status_idx` ON `Conversation`;

-- AlterTable
ALTER TABLE `Channel` MODIFY `signature` TEXT NULL;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_fromContactId_fkey` FOREIGN KEY (`fromContactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
