import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/20260714_reconcile_hostinger_credential_intake_task_title.sql", import.meta.url),
  "utf8",
);

assert.match(migration, /^UPDATE platform_pending_tasks$/m);
assert.match(migration, /task_id = 'adc3d06f-7f0b-11f1-9a4d-d342cf4a053c'/);
assert.match(migration, /task_key = 'credential_intake_completed:dd9f8870-0fe4-4059-b315-c14869bd3b8f'/);
assert.match(migration, /source_surface = 'credential_intake\.completed'/);
assert.match(migration, /status = 'pending'/);
assert.match(migration, /title = 'Credential intake completed for hostinger'/);
assert.match(migration, /auto_promotion_status[^\n]*completed/);
assert.match(migration, /COALESCE\(JSON_UNQUOTE\(JSON_EXTRACT\(context_json, '\$\.secrets_included'\)\), 'false'\) = 'false'/);
assert.doesNotMatch(migration, /JSON_FALSE\s*\(/i);
assert.match(migration, /Validate credential intake continuation for hostinger/);
assert.doesNotMatch(migration, /SET\s+status\s*=/i);
assert.doesNotMatch(migration, /DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE/i);
for (const marker of [
  "no_provider_call",
  "no_credential_payload_read",
  "no_raw_secrets",
  "no_external_send",
  "no_external_write",
  "secrets_included_false",
]) {
  assert.match(migration, new RegExp(marker));
}

console.log("Credential intake task title reconciliation migration guard passed");
