import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const surfaceDir = new URL("./activation-surfaces/", import.meta.url);
const files = readdirSync(surfaceDir).filter((file) => file.endsWith(".json")).sort();
const script = readFileSync(new URL("./scripts/activation-authorized-surface-registry-sync.mjs", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const activationRoutes = readFileSync(new URL("./routes/activationRoutes.js", import.meta.url), "utf8");

const blocked = /(secret|credential_ref|credential|token|password|private_key|cipher|api_key|value_ciphertext|value_sha|config_json)/i;
const safeIdentifier = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

assert(files.length >= 4, "repo must contain activation surface manifests");
assert(files.includes("workspace_registry.json"));
assert(files.includes("connected_systems.json"));
assert(files.includes("installations.json"));
assert(files.includes("permission_grants.json"));

const surfaceKeys = new Set();
for (const file of files) {
  const manifest = JSON.parse(readFileSync(new URL(file, surfaceDir), "utf8"));
  for (const key of ["surface_key", "display_name", "source_table", "result_columns", "include_for_admin", "include_for_tenant"]) {
    assert(key in manifest, `${file} missing ${key}`);
  }
  assert(safeIdentifier.test(manifest.surface_key), `${file} has unsafe surface_key`);
  assert(safeIdentifier.test(manifest.source_table), `${file} has unsafe source_table`);
  assert(!surfaceKeys.has(manifest.surface_key), `${file} duplicates surface_key`);
  surfaceKeys.add(manifest.surface_key);
  assert(Array.isArray(manifest.result_columns) && manifest.result_columns.length > 0, `${file} requires result_columns`);
  if (manifest.include_for_tenant === true) {
    assert(manifest.tenant_column || manifest.user_column, `${file} tenant-visible surface requires tenant_column or user_column`);
  }
  for (const column of manifest.result_columns) {
    assert(safeIdentifier.test(column), `${file} has unsafe column ${column}`);
    assert(!blocked.test(column), `${file} exposes blocked column ${column}`);
  }
}

assert.match(script, /activation-surfaces/);
assert.match(script, /APPLY_ACTIVATION_AUTHORIZED_SURFACE_REGISTRY_SYNC/);
assert.match(script, /ON DUPLICATE KEY UPDATE/);
assert.match(script, /BLOCKED_COLUMN_PATTERN/);
assert.match(script, /Tenant-visible activation surface/);
assert.match(script, /external_provider_called: false/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /SELECT \*/i);

assert.match(adminCli, /activation_authorized_surface_registry_sync/);
assert.match(adminCli, /activation-authorized-surface-registry-sync\.mjs/);
assert.match(adminCli, /allow_extra_args: true/);
assert.match(activationRoutes, /loadActivationRegisteredSurfaces/);
assert.match(activationRoutes, /registered_surfaces/);

console.log("Activation authorized surface registry sync automation guard passed");
