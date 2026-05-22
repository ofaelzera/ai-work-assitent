-- EventLog: actor + target pra auditoria enriquecida e timeline
ALTER TABLE `EventLog`
  ADD COLUMN `actorUserId` VARCHAR(191) NULL,
  ADD COLUMN `targetType`  VARCHAR(64)  NULL,
  ADD COLUMN `targetId`    VARCHAR(191) NULL;

CREATE INDEX `EventLog_workspaceId_actorUserId_createdAt_idx`
  ON `EventLog` (`workspaceId`, `actorUserId`, `createdAt`);

CREATE INDEX `EventLog_workspaceId_targetType_targetId_createdAt_idx`
  ON `EventLog` (`workspaceId`, `targetType`, `targetId`, `createdAt`);

ALTER TABLE `EventLog`
  ADD CONSTRAINT `EventLog_actorUserId_fkey`
    FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
