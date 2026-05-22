-- Board: visibility + shares (mesmo padrão de StorageFolder/StorageFolderShare)
-- Boards existentes:
--   • ownerId = null → eram "globais" (visíveis a todos) → migra pra PUBLIC
--   • ownerId set → PRIVATE (default)

ALTER TABLE `Board`
  ADD COLUMN `visibility` ENUM('PRIVATE', 'SHARED', 'PUBLIC') NOT NULL DEFAULT 'PRIVATE';

-- Migra boards legados (ownerId NULL) pra PUBLIC, preservando o acesso
UPDATE `Board` SET `visibility` = 'PUBLIC' WHERE `ownerId` IS NULL;

CREATE TABLE `BoardShare` (
  `id`        VARCHAR(191) NOT NULL,
  `boardId`   VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `BoardShare_boardId_userId_key` (`boardId`, `userId`),
  INDEX `BoardShare_userId_idx` (`userId`),
  CONSTRAINT `BoardShare_boardId_fkey`
    FOREIGN KEY (`boardId`) REFERENCES `Board`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
