-- LID (Linked ID) support for WhatsApp privacy-protected contacts
-- Adds phoneType enum + lid column, then backfills existing data.

-- ─── Schema ──────────────────────────────────────────────────────────────────

ALTER TABLE `Contact`
  ADD COLUMN `phoneType` ENUM('PN', 'LID', 'UNKNOWN') NOT NULL DEFAULT 'PN',
  ADD COLUMN `lid`       VARCHAR(191) NULL;

CREATE INDEX `Contact_workspaceId_lid_idx` ON `Contact`(`workspaceId`, `lid`);

-- ─── Backfill: marca contatos cujo "phone" é na verdade um LID ───────────────
-- Heurística (alinhada com isLidLikely() em apps/api/src/lib/phone.ts):
--   • PN BR moderno: 13 dígitos começando com 55 + DDD (11–99)
--   • PN BR antigo:  12 dígitos começando com 55
--   • PN local:      10–11 dígitos puros
--   • PN E.164:      8–13 dígitos (qualquer país)
-- Tudo o que NÃO se encaixa nisso e tem só dígitos é classificado como LID.

UPDATE `Contact`
SET
  `lid`       = `phone`,
  `phone`     = NULL,
  `phoneType` = 'LID'
WHERE `phone` IS NOT NULL
  AND `phone` REGEXP '^[0-9]+$'
  AND CHAR_LENGTH(`phone`) >= 14
  AND NOT (
    -- exclui PN BR moderno (13 dígitos, começa com 55, DDD válido)
    CHAR_LENGTH(`phone`) = 13
    AND `phone` LIKE '55%'
    AND CAST(SUBSTRING(`phone`, 3, 2) AS UNSIGNED) BETWEEN 11 AND 99
  );

-- ─── Hard-delete dos LIDs órfãos ─────────────────────────────────────────────
-- "Órfão" = contato LID sem nenhuma conversa, mensagem ou card referenciando.
-- Usamos DELETE com LEFT JOIN para evitar IN (SELECT) gigante.

DELETE c FROM `Contact` c
LEFT JOIN `Conversation` conv ON conv.`contactId` = c.`id`
LEFT JOIN `Message`      msg  ON msg.`fromContactId` = c.`id`
LEFT JOIN `Card`         card ON card.`contactId` = c.`id`
WHERE c.`phoneType` = 'LID'
  AND conv.`id` IS NULL
  AND msg.`id`  IS NULL
  AND card.`id` IS NULL;
