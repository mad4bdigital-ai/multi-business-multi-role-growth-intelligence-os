import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/244_sprint68_cms_grant_dedupe_and_null_guard.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(migration, /UPDATE cms_site_access_grants/);
assert.match(migration, /status = 'revoked'/);
assert.match(migration, /99354c25-7e0c-476d-817c-129328a1962c/);
assert.match(migration, /0548b6ef-b83a-4a9d-9241-7dbb8788ae37/);
assert.match(migration, /3e2ba8be-3137-4b55-bd5e-584b15917c8f/);
assert.match(migration, /active_grant_scope_key/);
assert.match(migration, /GENERATED ALWAYS AS/);
assert.match(migration, /__NULL_WORKSPACE__/);
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_cms_active_grant_scope_key/);
assert.match(migration, /CREATE OR REPLACE VIEW v_cms_active_grant_duplicate_groups/);
assert.match(migration, /HAVING COUNT\(\*\) > 1/);
assert.doesNotMatch(migration, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE/i);
assert.doesNotMatch(migration, /encrypted_credentials|credential_ref|client_secret|refresh_token|private_key/i);

assert.match(runner, /244_sprint68_cms_grant_dedupe_and_null_guard\.sql/);

console.log("CMS grant dedupe hardening guard passed");
