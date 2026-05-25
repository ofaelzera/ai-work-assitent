-- AlterTable
ALTER TABLE `Conversation`
    ADD COLUMN `lastQueuedAt` DATETIME(3) NULL,
    ADD COLUMN `eligibleAssigneeIds` JSON NULL;
