-- AlterTable: add status and metrics columns to Conversation
ALTER TABLE `Conversation`
  ADD COLUMN `status`          ENUM('OPEN','WAITING','RESOLVED') NOT NULL DEFAULT 'OPEN',
  ADD COLUMN `firstResponseAt` DATETIME(3) NULL,
  ADD COLUMN `resolvedAt`      DATETIME(3) NULL,
  ADD COLUMN `reopenCount`     INT NOT NULL DEFAULT 0,
  ADD COLUMN `triageCount`     INT NOT NULL DEFAULT 0;

-- Index for status filtering
CREATE INDEX `Conversation_workspaceId_status_idx` ON `Conversation`(`workspaceId`, `status`);
