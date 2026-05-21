-- Biblioteca de arquivos estilo Google Drive: pastas públicas/privadas + hierarquia.

CREATE TABLE `StorageFolder` (
  `id`          VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `ownerId`     VARCHAR(191) NOT NULL,
  `name`        VARCHAR(191) NOT NULL,
  `visibility`  ENUM('PRIVATE', 'PUBLIC') NOT NULL DEFAULT 'PRIVATE',
  `parentId`    VARCHAR(191) NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `StorageFolder_workspaceId_parentId_idx` (`workspaceId`, `parentId`),
  INDEX `StorageFolder_workspaceId_ownerId_idx`  (`workspaceId`, `ownerId`),
  CONSTRAINT `StorageFolder_parentId_fkey`
    FOREIGN KEY (`parentId`) REFERENCES `StorageFolder`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Attachment`
  ADD COLUMN `folderId`   VARCHAR(191) NULL,
  ADD COLUMN `visibility` ENUM('PRIVATE', 'PUBLIC') NOT NULL DEFAULT 'PRIVATE';

ALTER TABLE `Attachment`
  ADD CONSTRAINT `Attachment_folderId_fkey`
    FOREIGN KEY (`folderId`) REFERENCES `StorageFolder`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `Attachment_workspaceId_folderId_idx`   ON `Attachment`(`workspaceId`, `folderId`);
CREATE INDEX `Attachment_workspaceId_uploadedBy_idx` ON `Attachment`(`workspaceId`, `uploadedBy`);
