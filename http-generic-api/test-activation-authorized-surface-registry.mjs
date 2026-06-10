import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/269_sprint68_activation_authorized_surface_registry.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const activationRoutes = readFileSync(new URL("./routes/activationRoutes.js", import.meta.url), "utf8");

assert.match(migration, /activation_authorized_surface_registry/);
assert.match(migration, /v_activation_authorized_surface_registry_readiness/);
assert.match(migration, /result_columns_json/);
assert.match(migration, /include_for_tenant/);
assert.match(migration, /secrets_included/);
assert.match(migration, /workspace_registry/);
assert.match(migration, /connected_systems/);
assert.match(migration, /installations/);
assert.match(migration, /permission_grants/);
assert.doesNotMatch(migration, /credential_ref.*result_columns_json|config_json.*result_columns_json|secret_value|token_value|value_ciphertext/i);

assert.match(runner, /269_sprint68_activation_authorized_surface_registry\.sql/);
assert.match(runner, /ALLOWED_MIGRATIONS/);

assert.match(activationRoutes, /loadActivationRegisteredSurfaces/);
assert.match(activationRoutes, /ACTIVATION_BLOCKED_COLUMN_PATTERN/);
assert.match(activationRoutes, /activation_authorized_surface_registry/);
assert.match(activationRoutes, /registered_surfaces/);
assert.match(activationRoutes, /tenant_surface_requires_scope_column/);
assert.doesNotMatch(activationRoutes, /SELECT \*\s+FROM .*activation_authorized_surface_registry/i);

console.log("Activation authorized surface registry guard passed");
