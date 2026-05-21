-- Fase B — Fila pública + Assumir atendimento
-- Adiciona campos para controle de claim/release de conversas.
-- claimedAt: quando alguém assumiu a conversa
-- releasedFrom: JSON array com auditoria de devoluções à fila

ALTER TABLE `Conversation`
  ADD COLUMN `claimedAt`    DATETIME(3) NULL,
  ADD COLUMN `releasedFrom` JSON        NULL;
