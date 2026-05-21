-- Compartilhamento por arquivo (independente da pasta).

CREATE TABLE `AttachmentShare` (
  `id`           VARCHAR(191) NOT NULL,
  `attachmentId` VARCHAR(191) NOT NULL,
  `userId`       VARCHAR(191) NOT NULL,
  `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `AttachmentShare_attachmentId_userId_key` (`attachmentId`, `userId`),
  INDEX `AttachmentShare_userId_idx` (`userId`),
  CONSTRAINT `AttachmentShare_attachmentId_fkey`
    FOREIGN KEY (`attachmentId`) REFERENCES `Attachment`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
