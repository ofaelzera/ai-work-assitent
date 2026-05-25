-- CreateEnum
CREATE TABLE IF NOT EXISTS `EvolutionServer` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `apiKey` TEXT NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'MAINTENANCE') NOT NULL DEFAULT 'ACTIVE',
    `maxInstances` INTEGER NOT NULL DEFAULT 100,
    `instanceCount` INTEGER NOT NULL DEFAULT 0,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `isHealthy` BOOLEAN NOT NULL DEFAULT true,
    `lastHealthCheck` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `Channel`
    ADD COLUMN `evolutionServerId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Channel_evolutionServerId_idx` ON `Channel`(`evolutionServerId`);

-- AddForeignKey
ALTER TABLE `Channel` ADD CONSTRAINT `Channel_evolutionServerId_fkey`
    FOREIGN KEY (`evolutionServerId`) REFERENCES `EvolutionServer`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
