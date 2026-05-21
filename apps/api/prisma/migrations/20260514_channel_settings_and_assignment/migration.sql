-- Phase 1 (Roadmap) — fundamento para regras de canal e atribuição de conversas
-- Adiciona:
--   • Channel.settings (Json) — configs não-sensíveis: ignoreGroups, defaultAssigneeId,
--     autoResolveOnRead, distributionMode, imapFolders, lastAssignedUserId
--   • Conversation.assigneeId (FK → User) — usuário responsável pela conversa
--   • Conversation.folder (varchar) — pasta IMAP de origem (NULL para canais não-email)
--
-- Sem backfill: todas as colunas são nullable e os defaults se aplicam às novas linhas.

ALTER TABLE `Channel`
  ADD COLUMN `settings` JSON NULL;

ALTER TABLE `Conversation`
  ADD COLUMN `assigneeId` VARCHAR(191) NULL,
  ADD COLUMN `folder`     VARCHAR(191) NULL;

-- Foreign key Conversation.assigneeId → User.id (SET NULL on delete)
ALTER TABLE `Conversation`
  ADD CONSTRAINT `Conversation_assigneeId_fkey`
  FOREIGN KEY (`assigneeId`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Índices que vão suportar os filtros das próximas fases
CREATE INDEX `Conversation_workspaceId_assigneeId_idx`
  ON `Conversation`(`workspaceId`, `assigneeId`);

CREATE INDEX `Conversation_channelId_folder_idx`
  ON `Conversation`(`channelId`, `folder`);
