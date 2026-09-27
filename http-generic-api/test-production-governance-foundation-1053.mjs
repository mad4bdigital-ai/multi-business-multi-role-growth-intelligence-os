import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("./migrations/1053_production_governance_capability_envelope_foundation.sql");
const operator = read("../.github/ops/production-governance-foundation-1053.mjs");
const workflow = read("../.github/workflows/production-governance-foundation-1053.yml");
const recoveryRoutes = JSON.parse(read("../.github/ops/production-runtime-recovery-routes.json"));
const bootstrapContract = JSON.parse(read("./config/runtime-bootstrap-contract.json"));
const gptRoutes = read("./routes/gptToolsRoutes.js");

const checksum = createHash("sha256").update(migration, "utf8").digest("hex");
assert.equal(checksum, "21caf065fa700a92b301fb0abf82cc0e34520acbf4b2c913b920b7914c158e46");
const statements = splitMigrationSqlStatements(migration);
assert.equal(statements.length, 1);
assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS capability_resolution_envelope_ledger\b/iu);
assert.doesNotMatch(migration, /\b(?:DROP|DELETE|ALTER|TRUNCATE|GRANT|REVOKE|CALL|LOAD\s+DATA)\b/iu);
assert.doesNotMatch(migration, /platform_runtime_config|admin_platform_endpoint_tools/iu);

assert.match(operator, /MIGRATION = "1053_production_governance_capability_envelope_foundation\.sql"/u);
assert.match(operator, /MIGRATION_SHA256 = "21caf065fa700a92b301fb0abf82cc0e34520acbf4b2c913b920b7914c158e46"/u);
assert.match(operator, /STATEMENT_COUNT = 1/u);
assert.match(operator, /APPLY_PRODUCTION_GOVERNANCE_FOUNDATION_1053/u);
assert.match(operator, /governance_database/u);
assert.match(operator, /FOUNDATION_GOVERNANCE_DATABASE_NOT_DEDICATED/u);
assert.match(operator, /production_hostinger_autodeploy/u);
assert.match(operator, /runtime_class_explicit === true/u);
assert.match(operator, /legacy_migration_225_marked_applied: false/u);
assert.match(operator, /caller_database_allowed: false/u);
assert.match(operator, /caller_sql_allowed: false/u);
assert.match(operator, /automatic_replay_allowed: false/u);
assert.doesNotMatch(operator, /process\.env\.(?:DB_NAME|GOVERNANCE_DB_NAME)/u);

assert.match(workflow, /^name: Production Governance Foundation 1053/mu);
assert.match(workflow, /PLAN_PRODUCTION_GOVERNANCE_FOUNDATION_1053:/u);
assert.match(workflow, /APPLY_PRODUCTION_GOVERNANCE_FOUNDATION_1053:/u);
assert.match(workflow, /VERIFY_PRODUCTION_GOVERNANCE_FOUNDATION_1053:/u);
assert.match(workflow, /environment: Production/u);
assert.match(workflow, /RUNTIME_BOOTSTRAP_TARGETS_JSON/u);
assert.match(workflow, /MYSQL_BOOTSTRAP_PASSWORD: \$\{\{ secrets\.MYSQL_BOOTSTRAP_PASSWORD \}\}/u);
assert.match(workflow, /legacy Migration 225 Apply authorized: false/u);
assert.match(workflow, /runtime_database_mutation_performed==false/u);
assert.match(workflow, /automatic_replay_allowed==false/u);

assert.deepEqual(recoveryRoutes.recovery_migrations["225_sprint67_capability_resolution_envelope_ledger.sql"].allowed_modes, ["dry_run"]);
assert.equal(recoveryRoutes.recovery_migrations["225_sprint67_capability_resolution_envelope_ledger.sql"].incident_role, "verification_only");
assert.deepEqual(bootstrapContract.migrations["225_sprint67_capability_resolution_envelope_ledger.sql"].allowed_modes, ["dry_run"]);
assert.equal(bootstrapContract.migrations["225_sprint67_capability_resolution_envelope_ledger.sql"].role, "verification_only");

const readbackToolBlock = gptRoutes.slice(
  gptRoutes.indexOf('name: "governed_migration_schema_readback"'),
  gptRoutes.indexOf('name: "dynamic_container_projection_apply"'),
);
assert.match(readbackToolBlock, /database_role: \{ type: "string", enum: \["runtime", "governance"\]/u);
const authorizationToolBlock = gptRoutes.slice(
  gptRoutes.indexOf('name: "governed_migration_authorization_bootstrap"'),
  gptRoutes.indexOf('name: "governed_migration_schema_readback"'),
);
assert.doesNotMatch(authorizationToolBlock, /database_role: \{ type: "string", enum: \["runtime", "governance"\]/u);
assert.match(gptRoutes, /databaseRole === "governance" \? getGovernancePool\(\) : getPool\(\)/u);
assert.doesNotMatch(gptRoutes, /database_name.*governed_migration_schema_readback/iu);

console.log("Production Governance Foundation 1053 contract tests passed");
