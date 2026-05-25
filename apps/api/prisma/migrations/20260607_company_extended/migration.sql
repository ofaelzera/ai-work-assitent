-- AlterTable
ALTER TABLE `Company`
    ADD COLUMN `logoUrl` VARCHAR(191) NULL,
    ADD COLUMN `cnpj` VARCHAR(191) NULL,
    ADD COLUMN `phone` VARCHAR(191) NULL,
    ADD COLUMN `email` VARCHAR(191) NULL,
    ADD COLUMN `website` VARCHAR(191) NULL,
    ADD COLUMN `address` TEXT NULL,
    ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `distributionMode` VARCHAR(191) NULL,
    ADD COLUMN `defaultAssigneeId` VARCHAR(191) NULL,
    ADD COLUMN `roundRobinUserIds` JSON NULL,
    ADD COLUMN `rrCursor` INTEGER NULL;
