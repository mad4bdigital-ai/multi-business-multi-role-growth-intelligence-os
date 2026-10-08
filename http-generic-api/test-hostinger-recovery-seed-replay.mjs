import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const json = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
const sql = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const role = json("./config/staging-database-role-migration-manifest.json");
const autoDeploy = json("../autopilot-portable-staging/auto-deploy-policy.json");
const oneClick = json("../autopilot-portable-staging/autopilot-one-click-policy.json");
const hostinger = sql("./migrations/20261009_hostinger_recovery_allowlist_discovery.sql");
const admin = sql("./migrations/20261008_admin_local_connector_target_catalog_alignment.sql");
const foundation = sql("./migrations/150_sprint65_remote_ssh_runtime_foundation.sql");
const importer = sql("../autopilot-portable-staging/Clone-StagingDatabases.Legacy.ps1");
const names = [
  "hostinger_recovery_database_inventory", "hostinger_recovery_control_store_plan",
  "hostinger_recovery_database_create", "hostinger_recovery_environment_binding_plan",
  "hostinger_recovery_environment_binding_apply", "hostinger_recovery_grants_plan",
  "hostinger_recovery_grants_apply",
];
const expectedFiles = [
  "20261008_admin_local_connector_target_catalog_alignment.sql",
  "20261009_hostinger_recovery_allowlist_discovery.sql",
];

test("canonical seed source is single order authority across three Staging frontends", () => {
  const canonical = role.canonical_seed_lifecycle.seed_files;
  assert.deepEqual(autoDeploy.canonical_seed_lifecycle.seed_files, canonical);
  assert.deepEqual(oneClick.lifecycle.canonical_seeds.seed_files, canonical);
  assert.deepEqual(canonical.slice(-expectedFiles.length), expectedFiles);
  assert.equal(new Set(canonical).size, canonical.length);
  for (const policy of [role.canonical_seed_lifecycle, autoDeploy.canonical_seed_lifecycle]) {
    assert.equal(policy.production_access_forbidden, true);
    assert.equal(policy.provider_access_forbidden, true);
    assert.equal(policy.readback_required, true);
  }
  assert.equal(oneClick.lifecycle.canonical_seeds.explicit_apply_only, true);
  assert.equal(oneClick.lifecycle.canonical_seeds.readback_required, true);
  assert.equal(oneClick.safety.production_deploy, false);
  assert.equal(oneClick.safety.provider_mutation, false);
});

test("Hostinger catalog is deterministic on empty Runtime without a physical connector", () => {
  assert.match(foundation, /UNIQUE KEY uq_remote_runtime_command\s*\(plugin_key, command_key\)/);
  assert.equal((hostinger.match(/INSERT INTO remote_runtime_command_allowlists/g) || []).length, names.length);
  assert.equal((hostinger.match(/ON DUPLICATE KEY UPDATE/g) || []).length, names.length + 1);
  for (const key of names) {
    assert.equal((hostinger.match(new RegExp("'"+key+"'", "g")) || []).length, 1,
      "Every planned catalog command must have one canonical declaration: "+key);
  }
  assert.doesNotMatch(hostinger, /WHERE EXISTS\s*\(SELECT\s+1\s+FROM\s+connected_systems/i,
    "Static canonical command metadata cannot depend on operational connector rows");
  assert.doesNotMatch(hostinger, /system_key\s*=\s*'hostinger_ssh_prod_platform'/i,
    "A particular hosting account must never be hardcoded into cross-site seed replay");
  assert.match(hostinger, /'planned'/);
  assert.equal((hostinger.match(/'planned'/g) || []).length, names.length);
});

test("catalog replay remains incapable of authorizing execution, secrets or Production mutation", () => {
  assert.doesNotMatch(hostinger, /(?:INSERT\s+INTO|UPDATE)\s+remote_runtime_targets/i);
  assert.doesNotMatch(hostinger, /^\s*(?:GRANT|REVOKE|CREATE\s+USER|DROP\s+DATABASE|TRUNCATE|DELETE\s+FROM)\b/im,
    "Migration must not contain a privileged or destructive SQL statement");
  assert.doesNotMatch(hostinger, /\b(?:connector_secret|cf_token|password_value|plaintext_secret)\b/i);
  assert.doesNotMatch(hostinger, /status\s*=\s*'active'/i);
  assert.match(hostinger, /is_enabled=0/);
  assert.match(hostinger, /'remote_runtime_hostinger_recovery_allowlist_discover'/);
  assert.match(admin, /'admin_local_connector_devices'/);
  assert.doesNotMatch(admin, /(?:connector_secret|cf_token|password_value)/i);
});

test("eight canonical catalog rows have independent readback on first import and resume", () => {
  const contract = role.canonical_catalog_readback;
  assert.equal(contract.contract, "mad4b.staging.canonical-catalog-readback.v1");
  assert.equal(contract.target_role, "runtime");
  assert.equal(contract.read_only, true);
  assert.equal(contract.production_access_forbidden, true);
  assert.equal(contract.provider_access_forbidden, true);
  assert.equal(contract.secrets_included, false);
  assert.equal(contract.rows.length, names.length + 1);
  assert.deepEqual(
    contract.rows.filter(row => row.table === "remote_runtime_command_allowlists")
      .map(row => row.command_key),
    names,
  );
  assert(contract.rows.every(row => row.table !== "remote_runtime_command_allowlists"
    || (row.plugin_key === "remote_ssh_runtime" && row.status === "planned")));
  assert.deepEqual(contract.rows.at(-1), {
    table: "admin_platform_endpoint_tools",
    tool_key: "remote_runtime_hostinger_recovery_allowlist_discover",
    is_enabled: 0,
  });
  assert.match(importer, /function Assert-CanonicalCatalogRows/);
  assert.match(importer, /Duplicate canonical catalog readback identity/);
  assert.match(importer, /SELECT COUNT\(\*\) FROM remote_runtime_command_allowlists WHERE/);
  assert.match(importer, /SELECT COUNT\(\*\) FROM admin_platform_endpoint_tools WHERE/);
  assert.match(importer, /catalog_registry_row_counts = \$catalogRowCounts/);
  assert.match(importer, /\$CatalogReadbackContract/);
  assert.match(importer, /\$roleMigrationManifest\.canonical_catalog_readback/);
});
