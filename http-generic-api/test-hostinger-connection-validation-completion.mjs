import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/20260714_validate_hostinger_connection_and_complete_continuation_task.sql", import.meta.url),
  "utf8",
);

assert.equal((migration.match(/^UPDATE\s+/gim) || []).length, 2);
assert.match(migration, /UPDATE user_app_connections/);
assert.match(migration, /connection_id = 'd43275c7-2e41-4686-9c32-b3fff36efb7d'/);
assert.match(migration, /validation_status = 'validated'/);
assert.match(migration, /last_validated_at = CURRENT_TIMESTAMP/);
assert.match(migration, /UPDATE platform_pending_tasks/);
assert.match(migration, /task_id = 'adc3d06f-7f0b-11f1-9a4d-d342cf4a053c'/);
assert.match(migration, /status = 'done'/);
assert.match(migration, /provider_validation_mode', 'read_only'/);
assert.match(migration, /provider_mutation_performed', FALSE/);
assert.doesNotMatch(migration, /encrypted_credentials|decryptCredentials|Authorization:/i);
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

console.log("Hostinger connection validation completion migration guards passed");
