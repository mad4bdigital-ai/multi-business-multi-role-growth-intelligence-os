import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/20260723_operation_registry_foundation.sql", import.meta.url),
  "utf8",
);

const activationSurface = JSON.parse(
  readFileSync(
    new URL("./activation-surfaces/operation_execution_bindings.json", import.meta.url),
    "utf8",
  ),
);

for (const marker of [
  "no provider call",
  "no external send",
  "no credential payload read",
  "no raw secrets",
  "no runtime activation",
  "secrets_included=false",
]) {
  assert.ok(migration.includes(marker), `migration must declare safety marker: ${marker}`);
}

for (const table of [
  "operation_registry",
  "operation_step_registry",
  "operation_execution_bindings",
]) {
  assert.match(
    migration,
    new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`),
    `migration must create ${table}`,
  );
}

assert.match(migration, /CREATE OR REPLACE VIEW v_operation_registry_foundation AS/);
assert.match(migration, /UNIQUE KEY uq_operation_registry_key_version \(operation_key, version\)/);
assert.match(migration, /UNIQUE KEY uq_operation_step_registry_operation_step \(operation_registry_id, step_key\)/);
assert.match(migration, /UNIQUE KEY uq_operation_execution_bindings_operation_key \(operation_registry_id, binding_key\)/);
assert.match(migration, /FOREIGN KEY \(operation_registry_id\) REFERENCES operation_registry \(id\)/g);
assert.match(migration, /binding_scope_type ENUM\('resource', 'workspace', 'tenant', 'platform'\)/);
assert.match(migration, /dispatch_binding_key VARCHAR\(191\)/);
assert.match(migration, /endpoint_export_key VARCHAR\(191\)/);
assert.match(migration, /resource_authority_recipe_key VARCHAR\(191\)/);
assert.match(migration, /credential_scope_key VARCHAR\(191\)/);
assert.match(migration, /requires_readback TINYINT\(1\) NOT NULL DEFAULT 1/);
assert.match(migration, /ready_for_shadow_validation/);
assert.match(migration, /0 AS secrets_included/);

assert.equal(activationSurface.surface_key, "operation_execution_bindings");
assert.equal(activationSurface.source_table, "operation_execution_bindings");
assert.deepEqual(activationSurface.covered_source_tables, ["operation_execution_bindings"]);
assert.equal(activationSurface.result_key_column, "binding_id");
assert.equal(activationSurface.result_label_column, "binding_key");
assert.equal(activationSurface.status_column, "status");
assert.deepEqual(activationSurface.active_status_values, ["active"]);
assert.equal(activationSurface.include_for_admin, true);
assert.equal(activationSurface.include_for_tenant, false);
assert.equal(activationSurface.max_rows, 200);
assert.ok(activationSurface.result_columns.includes("dispatch_binding_key"));
assert.ok(activationSurface.result_columns.includes("requires_readback"));
assert.ok(!activationSurface.result_columns.includes("metadata_json"));

for (const lifecycle of ["draft", "shadow", "active", "degraded", "disabled", "archived"]) {
  assert.ok(migration.includes(`'${lifecycle}'`), `migration must support lifecycle ${lifecycle}`);
}

const sqlWithoutLineComments = migration.replace(/--.*$/gm, "");
assert.doesNotMatch(
  sqlWithoutLineComments,
  /(?:^|;)\s*(?:INSERT\s+INTO|UPDATE\s+[\w`]|DELETE\s+FROM|DROP\s+(?:TABLE|VIEW|DATABASE)|TRUNCATE(?:\s+TABLE)?|RENAME\s+TABLE)\b/im,
  "foundation migration must contain additive DDL only",
);

assert.doesNotMatch(
  migration,
  /\b(?:password|access_token|refresh_token|private_key|secret_value|credential_payload)\b/i,
  "registry schema must not define secret-bearing fields",
);

assert.doesNotMatch(
  migration,
  /\b(?:provider_url|endpoint_url|base_url)\b/i,
  "operation registries must not duplicate provider transport authority",
);

console.log("operation registry foundation contract tests passed");
