-- Fase C: Regras globais do workspace
-- Adiciona settings (Json) ao Workspace para fallback de distributionMode quando
-- o canal não tem config própria.

ALTER TABLE `Workspace`
  ADD COLUMN `settings` JSON NULL;
