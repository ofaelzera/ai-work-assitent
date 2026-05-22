-- Board.ownerId: nullable. null = board compartilhado/global do workspace.
-- Boards existentes ficam como compartilhados (ownerId = null) — preserva acesso.

ALTER TABLE `Board`
  ADD COLUMN `ownerId` VARCHAR(191) NULL;

CREATE INDEX `Board_workspaceId_ownerId_idx` ON `Board`(`workspaceId`, `ownerId`);
