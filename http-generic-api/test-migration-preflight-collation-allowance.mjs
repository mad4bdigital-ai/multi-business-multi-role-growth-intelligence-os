import assert from "node:assert/strict";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

const allowedSql = `ALTER TABLE secret_references
  MODIFY COLUMN secret_key VARCHAR(128)
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;`;

const allowed = assessMigrationSqlPreflight(
  "20260720_credential_intake_platform_secret_governance_hardening.sql",
  allowedSql
);
assert.equal(allowed.status, "pass", "the governed filename and exact collation statement must pass");
assert.equal(allowed.counts.alter_table_idempotent, 1, "the exact governed ALTER must be classified as reviewed and idempotent");

const wrongFilename = assessMigrationSqlPreflight("unreviewed_migration.sql", allowedSql);
assert.equal(wrongFilename.status, "warn", "the same ALTER under another filename must remain blocked for manual review");
assert.equal(wrongFilename.risks[0]?.code, "alter_table_requires_manual_idempotency_review");

const broadAlter = assessMigrationSqlPreflight(
  "20260720_credential_intake_platform_secret_governance_hardening.sql",
  "ALTER TABLE secret_references MODIFY COLUMN owner_id VARCHAR(255) NOT NULL;"
);
assert.equal(broadAlter.status, "warn", "other ALTER statements in the governed file must remain blocked");
assert.equal(broadAlter.risks[0]?.code, "alter_table_requires_manual_idempotency_review");

const repositoryResourceEnumSql = `ALTER TABLE workspace_resource_grants
  MODIFY COLUMN resource_type ENUM('workspace','brand','site','app','asset','workflow','agent','vault','repository') NOT NULL;`;

const reviewedRepositoryResourceEnum = assessMigrationSqlPreflight(
  "20260721_repository_authority_capability_bindings_v2.sql",
  repositoryResourceEnumSql
);
assert.equal(reviewedRepositoryResourceEnum.status, "pass", "the exact reviewed repository resource ENUM extension must pass");
assert.equal(reviewedRepositoryResourceEnum.counts.alter_table_idempotent, 1, "the reviewed ENUM extension must be classified as idempotent");

const repositoryResourceEnumWrongFilename = assessMigrationSqlPreflight(
  "unreviewed_repository_resource_enum.sql",
  repositoryResourceEnumSql
);
assert.equal(repositoryResourceEnumWrongFilename.status, "warn", "the repository ENUM ALTER under another filename must remain blocked");
assert.equal(repositoryResourceEnumWrongFilename.risks[0]?.code, "alter_table_requires_manual_idempotency_review");

const repositoryResourceEnumBroadened = assessMigrationSqlPreflight(
  "20260721_repository_authority_capability_bindings_v2.sql",
  "ALTER TABLE workspace_resource_grants MODIFY COLUMN resource_type ENUM('workspace','brand','site','app','asset','workflow','agent','vault','repository','other') NOT NULL;"
);
assert.equal(repositoryResourceEnumBroadened.status, "warn", "a broader ENUM change must remain blocked for manual review");
assert.equal(repositoryResourceEnumBroadened.risks[0]?.code, "alter_table_requires_manual_idempotency_review");

const agentSkillCollationRepairSql = `ALTER TABLE agent_skill_grant_requests
  MODIFY COLUMN request_id VARCHAR(36)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY COLUMN agent_id VARCHAR(36)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY COLUMN skill_id VARCHAR(36)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY COLUMN tenant_id VARCHAR(36)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL,
  MODIFY COLUMN brand_key VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL;`;

const reviewedAgentSkillCollationRepair = assessMigrationSqlPreflight(
  "20260725_agent_skill_grant_request_collation_repair.sql",
  agentSkillCollationRepairSql
);
assert.equal(reviewedAgentSkillCollationRepair.status, "pass", "the exact reviewed agent-skill collation repair must pass");
assert.equal(reviewedAgentSkillCollationRepair.counts.alter_table_idempotent, 1);

const agentSkillCollationWrongFilename = assessMigrationSqlPreflight(
  "unreviewed_agent_skill_collation_repair.sql",
  agentSkillCollationRepairSql
);
assert.equal(agentSkillCollationWrongFilename.status, "warn", "the same repair under another filename must remain blocked");
assert.equal(agentSkillCollationWrongFilename.risks[0]?.code, "alter_table_requires_manual_idempotency_review");

const agentSkillCollationChanged = assessMigrationSqlPreflight(
  "20260725_agent_skill_grant_request_collation_repair.sql",
  agentSkillCollationRepairSql.replace("brand_key VARCHAR(128)", "brand_key VARCHAR(255)")
);
assert.equal(agentSkillCollationChanged.status, "warn", "a changed column definition must remain blocked");
assert.equal(agentSkillCollationChanged.risks[0]?.code, "alter_table_requires_manual_idempotency_review");

console.log("migration preflight collation allowance tests passed");
