-- User.settings: configurações pessoais do usuário (welcomeMessage, closingMessage, signature)
-- Espelha o padrão de Channel.settings e Workspace.settings — JSON flexível.

ALTER TABLE `User`
  ADD COLUMN `settings` JSON NULL;
