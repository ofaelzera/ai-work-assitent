-- Agent v2: triggers customizáveis + tools habilitados
ALTER TABLE `Agent`
  ADD COLUMN `trigger`      JSON NULL,
  ADD COLUMN `enabledTools` JSON NULL;
