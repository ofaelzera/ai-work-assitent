-- ─── Teams (Setores de Atendimento) ─────────────────────────────────────────
CREATE TABLE `Team` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NOT NULL DEFAULT '#6366f1',
    `icon` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `distributionMode` VARCHAR(191) NOT NULL DEFAULT 'all',
    `defaultAssigneeId` VARCHAR(191) NULL,
    `roundRobinUserIds` JSON NULL,
    `rrCursor` INTEGER NOT NULL DEFAULT 0,
    `businessHours` JSON NULL,
    `slaFirstResponseMin` INTEGER NULL,
    `slaResolutionMin` INTEGER NULL,
    `overflowTeamId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Team_workspaceId_slug_key`(`workspaceId`, `slug`),
    INDEX `Team_workspaceId_isActive_idx`(`workspaceId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TeamMembership` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('LEADER', 'AGENT') NOT NULL DEFAULT 'AGENT',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `capacity` INTEGER NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TeamMembership_teamId_userId_key`(`teamId`, `userId`),
    INDEX `TeamMembership_userId_isActive_idx`(`userId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── ConversationTransfer (histórico estruturado) ────────────────────────────
CREATE TABLE `ConversationTransfer` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `fromUserId` VARCHAR(191) NULL,
    `fromTeamId` VARCHAR(191) NULL,
    `toUserId` VARCHAR(191) NULL,
    `toTeamId` VARCHAR(191) NULL,
    `kind` ENUM('SYSTEM', 'MANUAL', 'RELEASE', 'TAKEOVER') NOT NULL DEFAULT 'MANUAL',
    `reason` TEXT NULL,
    `actorUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ConversationTransfer_workspaceId_conversationId_createdAt_idx`(`workspaceId`, `conversationId`, `createdAt`),
    INDEX `ConversationTransfer_workspaceId_toTeamId_createdAt_idx`(`workspaceId`, `toTeamId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── RoutingRule ────────────────────────────────────────────────────────────
CREATE TABLE `RoutingRule` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `matcher` JSON NOT NULL,
    `action` JSON NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `triggers` JSON NULL,
    `assignTeamId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RoutingRule_workspaceId_isActive_priority_idx`(`workspaceId`, `isActive`, `priority`),
    INDEX `RoutingRule_assignTeamId_idx`(`assignTeamId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Flow + FlowExecution ───────────────────────────────────────────────────
CREATE TABLE `Flow` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `trigger` JSON NOT NULL,
    `graph` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Flow_workspaceId_isActive_priority_idx`(`workspaceId`, `isActive`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FlowExecution` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `flowId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `currentNodeId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'RUNNING',
    `context` JSON NOT NULL,
    `trace` JSON NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `FlowExecution_conversationId_status_idx`(`conversationId`, `status`),
    INDEX `FlowExecution_workspaceId_status_idx`(`workspaceId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── AlterTable: Channel.defaultTeamId / defaultFlowId ──────────────────────
ALTER TABLE `Channel`
    ADD COLUMN `defaultTeamId` VARCHAR(191) NULL,
    ADD COLUMN `defaultFlowId` VARCHAR(191) NULL;

CREATE INDEX `Channel_defaultTeamId_idx` ON `Channel`(`defaultTeamId`);

-- ─── AlterTable: Conversation.teamId / tags ─────────────────────────────────
ALTER TABLE `Conversation`
    ADD COLUMN `teamId` VARCHAR(191) NULL,
    ADD COLUMN `tags` JSON NULL;

CREATE INDEX `Conversation_workspaceId_teamId_status_idx` ON `Conversation`(`workspaceId`, `teamId`, `status`);

-- ─── Foreign Keys ───────────────────────────────────────────────────────────
ALTER TABLE `Team` ADD CONSTRAINT `Team_workspaceId_fkey`
    FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Team` ADD CONSTRAINT `Team_overflowTeamId_fkey`
    FOREIGN KEY (`overflowTeamId`) REFERENCES `Team`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `TeamMembership` ADD CONSTRAINT `TeamMembership_teamId_fkey`
    FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `TeamMembership` ADD CONSTRAINT `TeamMembership_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ConversationTransfer` ADD CONSTRAINT `ConversationTransfer_workspaceId_fkey`
    FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ConversationTransfer` ADD CONSTRAINT `ConversationTransfer_conversationId_fkey`
    FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ConversationTransfer` ADD CONSTRAINT `ConversationTransfer_fromUserId_fkey`
    FOREIGN KEY (`fromUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ConversationTransfer` ADD CONSTRAINT `ConversationTransfer_toUserId_fkey`
    FOREIGN KEY (`toUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ConversationTransfer` ADD CONSTRAINT `ConversationTransfer_fromTeamId_fkey`
    FOREIGN KEY (`fromTeamId`) REFERENCES `Team`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ConversationTransfer` ADD CONSTRAINT `ConversationTransfer_toTeamId_fkey`
    FOREIGN KEY (`toTeamId`) REFERENCES `Team`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ConversationTransfer` ADD CONSTRAINT `ConversationTransfer_actorUserId_fkey`
    FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `RoutingRule` ADD CONSTRAINT `RoutingRule_workspaceId_fkey`
    FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `RoutingRule` ADD CONSTRAINT `RoutingRule_assignTeamId_fkey`
    FOREIGN KEY (`assignTeamId`) REFERENCES `Team`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Flow` ADD CONSTRAINT `Flow_workspaceId_fkey`
    FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `FlowExecution` ADD CONSTRAINT `FlowExecution_workspaceId_fkey`
    FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `FlowExecution` ADD CONSTRAINT `FlowExecution_flowId_fkey`
    FOREIGN KEY (`flowId`) REFERENCES `Flow`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `FlowExecution` ADD CONSTRAINT `FlowExecution_conversationId_fkey`
    FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Channel` ADD CONSTRAINT `Channel_defaultTeamId_fkey`
    FOREIGN KEY (`defaultTeamId`) REFERENCES `Team`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Channel` ADD CONSTRAINT `Channel_defaultFlowId_fkey`
    FOREIGN KEY (`defaultFlowId`) REFERENCES `Flow`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_teamId_fkey`
    FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
