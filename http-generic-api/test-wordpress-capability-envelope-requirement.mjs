import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const orchestrator = readFileSync(new URL("./wordpressBlogPublishOrchestrator.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/226_sprint67_wordpress_capability_envelope_requirement.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(orchestrator, /extractCapabilityEnvelopeId/);
assert.match(orchestrator, /resolveCapabilityEnvelopeForWordpressWrite/);
assert.match(orchestrator, /capability_resolution_envelope_ledger/);
assert.match(orchestrator, /capability_resolution_envelope_required/);
assert.match(orchestrator, /ready_for_dispatch/);
assert.match(orchestrator, /dispatch_allowed/);
assert.match(orchestrator, /approval_required/);
assert.match(orchestrator, /blocking_gap_count/);
assert.match(orchestrator, /markCapabilityEnvelopeReferenced/);
assert.match(orchestrator, /createPost\(\{ brand, credential, postType, payload \}/);
assert.match(orchestrator, /secrets_included: false/);
assert.doesNotMatch(orchestrator, /decryptToken\(|value_ciphertext|oauth_token|private_key/i);

const envelopeGateIndex = orchestrator.indexOf("const envelope = await resolveCapabilityEnvelopeForWordpressWrite");
const createPostIndex = orchestrator.indexOf("const created = await createPost");
assert.ok(envelopeGateIndex > -1, "WordPress execution must validate capability envelope.");
assert.ok(createPostIndex > envelopeGateIndex, "WordPress createPost must occur after envelope validation.");

assert.match(migration, /wordpress_write_capability_envelope_requirement_v1/);
assert.match(migration, /capability_resolution_envelope_ledger/);
assert.match(migration, /credential_intake_requires_envelope',false/);
assert.match(migration, /diagnostics_require_envelope',false/);
assert.match(migration, /execution_requires_envelope',true/);
assert.match(migration, /required_envelope_status','ready_for_dispatch/);
assert.match(migration, /no_execution_without_envelope',true/);
assert.match(migration, /secrets_included',false/);
assert.match(migration, /capability_envelope_id_required_for_write_execution/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);
assert.match(runner, /226_sprint67_wordpress_capability_envelope_requirement\.sql/);

console.log("WordPress capability envelope requirement guard passed");
