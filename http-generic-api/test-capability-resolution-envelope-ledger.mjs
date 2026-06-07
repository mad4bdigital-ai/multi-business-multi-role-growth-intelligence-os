import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/capability-resolution-envelope-create.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/225_sprint67_capability_resolution_envelope_ledger.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /runCapabilityResolutionDryRun/);
assert.match(script, /capability_resolution_envelope_ledger/);
assert.match(script, /sha256Json/);
assert.match(script, /redactDangerousKeys/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /CAST\(\? AS JSON\)/);
assert.match(script, /DATE_ADD\(NOW\(\), INTERVAL \? MINUTE\)/);
assert.match(script, /dispatch_allowed/);
assert.match(script, /apply_allowed/);
assert.match(script, /approval_required/);
assert.match(script, /quota_required/);
assert.doesNotMatch(script, /decryptToken|value_ciphertext|encrypted_credentials|private_key|oauth_token/i);
assert.doesNotMatch(script, /fetch\(|axios|child_process|exec\(|spawn\(/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS capability_resolution_envelope_ledger/);
assert.match(migration, /envelope_sha256 CHAR\(64\)/);
assert.match(migration, /envelope_json JSON NOT NULL/);
assert.match(migration, /execution_status ENUM\('not_executed','referenced','executed','failed','cancelled'\)/);
assert.match(migration, /chk_capability_resolution_envelope_no_secrets/);
assert.match(migration, /capability_resolution_envelope_ledger_policy_v1/);
assert.match(migration, /execution_tools_should_require_envelope_id/);
assert.match(migration, /expired_envelopes_must_not_execute/);
assert.match(migration, /must_not_store/);
assert.match(migration, /value_ciphertext/);
assert.match(migration, /capability_resolution_envelope_create/);
assert.match(migration, /no_execution/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

assert.match(adminCli, /capability_resolution_envelope_create/);
assert.match(adminCli, /scripts\/capability-resolution-envelope-create\.mjs/);
assert.match(runner, /225_sprint67_capability_resolution_envelope_ledger\.sql/);

console.log("Capability resolution envelope ledger guard passed");
