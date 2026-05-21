-- Adiciona Message.metadata para guardar dados específicos do canal,
-- principalmente { imapUid, imapFolder } necessários para moveImapMessage()
-- e DELETE de email via IMAP.
ALTER TABLE `Message` ADD COLUMN `metadata` JSON NULL;
