-- Tenant request relational identity collation alignment.
-- Source incident: Spec 017 fixture readback run 31250853393 returned ER_CANT_AGGREGATE_2COLLATIONS.
-- ticket_lifecycle_events was canonically created by migration 233 with utf8mb4_uca1400_ai_ci.
-- tenant_resolution_cases was created with utf8mb4_unicode_ci, but tenant_id/ticket_id are relational ticket identity keys.
-- Runtime reads actual dependent-column collations and normalizes only outer expressions, so it remains compatible before and after this source-only migration.
-- No data deletion, provider call, credential access, Production mutation, or Migration Apply is performed by this source file.

ALTER TABLE `ticket_lifecycle_events`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

ALTER TABLE `ticket_lifecycle_events`
  MODIFY COLUMN `ticket_id` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY COLUMN `tenant_id` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL;

ALTER TABLE `tenant_resolution_cases`
  MODIFY COLUMN `tenant_id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY COLUMN `ticket_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL;
