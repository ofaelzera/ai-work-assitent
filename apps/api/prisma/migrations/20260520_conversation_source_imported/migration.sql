-- Fase A — Sync inteligente
-- Separa conversas LIVE (real-time) de IMPORTED (sync histórico).
-- Conversas importadas nascem RESOLVED e não aparecem no inbox padrão.
--
-- Sem backfill: todas as conversas existentes mantêm o default LIVE (atendimento normal).

ALTER TABLE `Conversation`
  ADD COLUMN `source`     ENUM('LIVE', 'IMPORTED') NOT NULL DEFAULT 'LIVE',
  ADD COLUMN `importedAt` DATETIME(3) NULL;

-- Índice para filtros de "esconder IMPORTED do inbox padrão"
CREATE INDEX `Conversation_workspaceId_source_idx`
  ON `Conversation`(`workspaceId`, `source`);
