import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/capability-resolution-envelope-approve.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/235_sprint67_capability_envelope_approval_tool.sql", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /approveCapabilityResolutionEnvelope/);
assert.match(script, /ready_requires_approval/);
assert.match(script, /ready_for_dispatch/);
assert.match(script, /dispatch_allowed/);
assert.match(script, /blocking_gap_count/);
assert.match(script, /approval_required/);
assert.match(script, /approval_holds/);
assert.match(script, /assertNoSecretBearingFields/);
assert.match(script, /capabilityEnvelopeSecretPolicy/);
assert.match(script, /envelope_sha256/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /CAST\(\? AS JSON\)/);
assert.doesNotMatch(script, /decryptToken|value_ciphertext|encrypted_credentials|oauth_token|private_key|api_key_value/i);
assert.doesNotMatch(script, /fetch\(|axios|child_process|exec\(|spawn\(/);

assert.match(migration, /capability_resolution_envelope_approval_tool_policy_v1/);
assert.match(migration, /capability_resolution_envelope_approve/);
assert.match(migration, /ready_requires_approval/);
assert.match(migration, /ready_for_dispatch/);
assert.match(migration, /writes_approval_holds/);
assert.match(migration, /does_not_execute_target_capability/);
assert.match(migration, /secrets_included',false/);
assert.match(migration, /no_execution/);
assert.match(migration, /no_secrets/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|GITHUB_TOKEN\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);

assert.match(adminCli, /capability_resolution_envelope_approve/);
assert.match(adminCli, /scripts\/capability-resolution-envelope-approve\.mjs/);
assert.match(runner, /235_sprint67_capability_envelope_approval_tool\.sql/);

console.log("Capability envelope approval tool guard passed");
