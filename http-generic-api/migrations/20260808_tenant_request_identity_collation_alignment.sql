-- Tenant request identity collation alignment.
-- Source incident: Spec 017 fixture readback run 31250853393 returned ER_CANT_AGGREGATE_2COLLATIONS
-- from the canonical Admin tenant-request detail read before any JWT/grant/provider mutation.
--
-- The runtime compatibility layer normalizes both sides of cross-table identity comparisons
-- to utf8mb4_unicode_ci so reads remain available before and after this migration.
-- This migration intentionally does not ALTER the central tickets table because other ticket_*
-- families still inherit utf8mb4_uca1400_ai_ci; recollating tickets requires a separate whole-domain audit.
-- No data deletion, provider call, credential access, Production mutation, or Migration Apply is performed by this source file.

ALTER TABLE `ticket_lifecycle_events`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ticket_lifecycle_events`
  MODIFY COLUMN `ticket_id` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN `tenant_id` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE `tenant_resolution_cases`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `tenant_resolution_cases`
  MODIFY COLUMN `tenant_id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN `resource_ref` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN `ticket_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
