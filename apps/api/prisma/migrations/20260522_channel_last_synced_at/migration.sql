-- Adiciona timestamp da última sincronização bem-sucedida ao canal.
-- Usado pelo smart-sync para detectar mensagens novas desde a última sincronização
-- e auto-resolver conversas lidas no celular durante períodos offline.

ALTER TABLE `Channel`
  ADD COLUMN `lastSyncedAt` DATETIME(3) NULL;
