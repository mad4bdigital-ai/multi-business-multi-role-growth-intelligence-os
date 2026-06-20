import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assessMigrationSqlPreflight,
  extractMigrationReadinessRequirementsFromSql,
  splitSqlStatements
} from "./releaseReadiness.js";

const migrations = [
  {
    file:"319_sprint69_dynamic_container_authority_foundation.sql",
    statements:22,
    requiredObjects:[
      "containers",
      "container_relationships",
      "container_closure",
      "container_role_assignments",
      "container_resource_bindings",
      "v_container_relationship_issues"
    ]
  },
  {
    file:"320_sprint69_dynamic_container_authority_runtime_contracts.sql",
    statements:25,
    requiredObjects:[
      "container_effective_context_ledger",
      "container_shadow_comparisons",
      "container_override_requests",
      "container_resolution_performance_samples",
      "v_container_resolution_performance_summary",
      "v_container_audit_coverage",
      "v_container_rollout_readiness"
    ]
  }
];

const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs",import.meta.url),"utf8");

for (const migration of migrations) {
  const sql = readFileSync(new URL(`./migrations/${migration.file}`,import.meta.url),"utf8");
  const preflight = assessMigrationSqlPreflight(migration.file,sql);
  const requirements = extractMigrationReadinessRequirementsFromSql(sql);
  const statements = splitSqlStatements(sql);

  assert.equal(preflight.status,"pass",`${migration.file} must pass branch-safe migration preflight`);
  assert.equal(Number(preflight.risk_count || 0),0,`${migration.file} must have zero preflight risks`);
  assert.equal(statements.length,migration.statements,`${migration.file} statement count changed unexpectedly`);
  assert.equal(Number(preflight.counts?.statements),statements.length,`${migration.file} preflight statement count must match executable split`);
  for (const objectName of migration.requiredObjects) {
    assert(requirements.schema_objects.includes(objectName),`${migration.file} must expose ${objectName} as a readiness object`);
  }
  assert(runner.includes(`"${migration.file}"`),`${migration.file} must be bootstrap-authorized before self-authorization exists`);
  assert(sql.includes(`'${migration.file}','authorized','migration_seed'`),`${migration.file} must self-authorize future governed dry-run/apply`);
  assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(sql),`${migration.file} must remain additive`);
  assert.match(sql,/no_provider_call/);
  assert.match(sql,/no_credential_payload_read/);
  assert.match(sql,/no_raw_secrets/);
  assert.match(sql,/no_external_send/);
  assert.match(sql,/no_external_write/);
  assert.match(sql,/secrets_included=false/);
}

console.log("dynamic container migration preflight contracts passed");
