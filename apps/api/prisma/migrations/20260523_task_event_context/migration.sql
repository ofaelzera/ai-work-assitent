-- Fase D: Tarefa / Evento a partir de contato/conversa/mensagem
-- Adiciona contexto opcional a Task e CalendarEvent para permitir criação
-- direto da conversa, com link de volta ao contato e mensagem de origem.

ALTER TABLE `Task`
  ADD COLUMN `contactId`      VARCHAR(191) NULL,
  ADD COLUMN `conversationId` VARCHAR(191) NULL,
  ADD COLUMN `messageId`      VARCHAR(191) NULL,
  ADD COLUMN `assigneeId`     VARCHAR(191) NULL,
  ADD COLUMN `description`    TEXT NULL;

ALTER TABLE `Task`
  ADD CONSTRAINT `Task_contactId_fkey`
    FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `Task_conversationId_fkey`
    FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `Task_assigneeId_fkey`
    FOREIGN KEY (`assigneeId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `Task_workspaceId_assigneeId_done_idx` ON `Task`(`workspaceId`, `assigneeId`, `done`);
CREATE INDEX `Task_contactId_idx`                   ON `Task`(`contactId`);
CREATE INDEX `Task_conversationId_idx`              ON `Task`(`conversationId`);

ALTER TABLE `CalendarEvent`
  ADD COLUMN `contactId`      VARCHAR(191) NULL,
  ADD COLUMN `conversationId` VARCHAR(191) NULL,
  ADD COLUMN `messageId`      VARCHAR(191) NULL;

ALTER TABLE `CalendarEvent`
  ADD CONSTRAINT `CalendarEvent_contactId_fkey`
    FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `CalendarEvent_conversationId_fkey`
    FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `CalendarEvent_contactId_idx`      ON `CalendarEvent`(`contactId`);
CREATE INDEX `CalendarEvent_conversationId_idx` ON `CalendarEvent`(`conversationId`);
