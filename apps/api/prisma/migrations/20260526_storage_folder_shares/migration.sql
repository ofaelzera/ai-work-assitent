-- Compartilhamento de pastas com usuários específicos.
-- Adiciona valor SHARED ao enum + nova tabela StorageFolderShare.

ALTER TABLE `StorageFolder`
  MODIFY COLUMN `visibility` ENUM('PRIVATE', 'SHARED', 'PUBLIC') NOT NULL DEFAULT 'PRIVATE';

ALTER TABLE `Attachment`
  MODIFY COLUMN `visibility` ENUM('PRIVATE', 'SHARED', 'PUBLIC') NOT NULL DEFAULT 'PRIVATE';

CREATE TABLE `StorageFolderShare` (
  `id`        VARCHAR(191) NOT NULL,
  `folderId`  VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `StorageFolderShare_folderId_userId_key` (`folderId`, `userId`),
  INDEX `StorageFolderShare_userId_idx` (`userId`),
  CONSTRAINT `StorageFolderShare_folderId_fkey`
    FOREIGN KEY (`folderId`) REFERENCES `StorageFolder`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
