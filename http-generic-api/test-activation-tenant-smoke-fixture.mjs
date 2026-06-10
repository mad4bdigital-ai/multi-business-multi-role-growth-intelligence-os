import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/270_sprint68_activation_tenant_smoke_fixture.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(migration, /Activation tenant smoke positive permission fixture/);
assert.match(migration, /00000000-0000-4000-a000-000000000099/);
assert.match(migration, /activation_smoke_user/);
assert.match(migration, /wordpress_api/);
assert.match(migration, /http_generic_api_connector/);
assert.match(migration, /permission_grants/);
assert.match(migration, /credential_ref`, `status`/);
assert.match(migration, /NULL, 'active'/);
assert.match(migration, /secrets_included/);
assert.doesNotMatch(migration, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
assert.doesNotMatch(migration, /value_ciphertext|secret_value|token_value|password|private_key/i);

assert.match(runner, /270_sprint68_activation_tenant_smoke_fixture\.sql/);
assert.match(runner, /ALLOWED_MIGRATIONS/);

console.log("Activation tenant smoke fixture migration guard passed");
