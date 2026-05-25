-- AlterTable
ALTER TABLE `Conversation`
    ADD COLUMN `companyId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Conversation_workspaceId_companyId_idx` ON `Conversation`(`workspaceId`, `companyId`);

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
