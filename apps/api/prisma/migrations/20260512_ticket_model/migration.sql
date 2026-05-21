-- Cria índice simples em channelId antes de dropar o unique (MySQL exige para FK)
CREATE INDEX `Conversation_channelId_idx` ON `Conversation`(`channelId`);

-- Agora pode dropar o unique (channelId coberto pelo índice acima)
ALTER TABLE `Conversation` DROP INDEX `Conversation_channelId_externalId_key`;

-- Índices para busca de tickets ativos e histórico
CREATE INDEX `Conversation_channelId_externalId_idx` ON `Conversation`(`channelId`, `externalId`);
CREATE INDEX `Conversation_workspaceId_status_lastMessageAt_idx` ON `Conversation`(`workspaceId`, `status`, `lastMessageAt`);
