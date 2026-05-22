-- RBAC: roles customizáveis por workspace + atribuição opcional ao usuário.

CREATE TABLE `CustomRole` (
  `id`          VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `name`        VARCHAR(191) NOT NULL,
  `description` VARCHAR(191) NULL,
  `permissions` JSON NOT NULL,
  `isSystem`    BOOLEAN NOT NULL DEFAULT false,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `CustomRole_workspaceId_name_key` (`workspaceId`, `name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `User`
  ADD COLUMN `customRoleId` VARCHAR(191) NULL,
  ADD CONSTRAINT `User_customRoleId_fkey`
    FOREIGN KEY (`customRoleId`) REFERENCES `CustomRole`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `User_customRoleId_idx` ON `User`(`customRoleId`);
