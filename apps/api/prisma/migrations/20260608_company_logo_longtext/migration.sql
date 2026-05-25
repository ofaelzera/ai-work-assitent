-- Aumenta logoUrl para LONGTEXT (suporta data URL base64 de imagens até ~2MB)
ALTER TABLE `Company` MODIFY COLUMN `logoUrl` LONGTEXT NULL;
