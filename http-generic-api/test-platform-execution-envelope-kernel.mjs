import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPlatformExecutionEnvelope, executionEnvelopeHash, transitionPlatformExecutionEnvelope, validatePlatformExecutionEnvelope } from "./platformExecutionEnvelopeKernel.js";

const source = fs.readFileSync(new URL("./platformExecutionEnvelopeKernel.js", import.meta.url), "utf8");
const tasks = fs.readFileSync(new URL("../specs/006-adaptive-authorization-execution-governance/tasks.md", import.meta.url), "utf8");
const docs = fs.readFileSync(new URL("../docs/platform-execution-envelope-kernel.md", import.meta.url), "utf8");

for (const phrase of ["platform_execution_envelope_v1", "revision_vector_hash", "nonce_hash", "idempotency_key_hash", "replay_key", "execution_envelope_expired", "execution_envelope_replay_detected", "execution_envelope_revision_mismatch", "provider_apply_allowed: false", "enforcement_cutover: false"]) {
  assert(source.includes(phrase), `execution envelope kernel must include ${phrase}`);
}
for (const secretToken of ["access_token", "refresh_token", "private_key", "client_secret", "encrypted_credentials"]) {
  assert(!source.includes(secretToken), `execution envelope kernel must not reference ${secretToken}`);
}
assert(tasks.includes("- [x] T021 Implement revision-bound, expiring, replay-resistant envelopes."));
assert(docs.includes("replay-resistant"));
assert(docs.includes("revision-bound"));

const enforcement = {
  ok: true,
  enforcement_status: "shadow_allow",
  boundary: { boundary_key: "content.wordpress.publish", boundary_family: "external_high_impact" },
  revision_vector: { workspace: { workspace_id: "w1" }, capability: { capability_key: "content.wordpress.publish", schema_version: "v1" } },
  enforcement_policy: { policy_version: "tenant_capability_dynamic_enforcement_policy_v1", boundary_family: "external_high_impact" },
  obligations: ["approval_required", "provider_apply_forbidden"],
  mismatch: { taxonomy_version: "tenant_capability_mismatch_taxonomy_v1", family: "ready" },
  provider_apply_allowed: false,
  mutations_executed: false,
  enforcement_cutover: false,
};

const envelope = buildPlatformExecutionEnvelope({ enforcement, capability_envelope_id: "env-123", idempotency_key: "idem-1", nonce: "nonce-1", issued_at: "2026-07-08T00:00:00.000Z", ttl_seconds: 600 });
assert.equal(envelope.ok, true);
assert.equal(envelope.provider_apply_allowed, false);
assert.equal(envelope.mutation_allowed, false);
assert.equal(envelope.enforcement_cutover, false);
assert.equal(envelope.secrets_included, false);
assert.equal(envelope.revision_vector_hash, executionEnvelopeHash(enforcement.revision_vector));
assert.equal(envelope.policy_hash, executionEnvelopeHash(enforcement.enforcement_policy));

const valid = validatePlatformExecutionEnvelope(envelope, { enforcement, now: "2026-07-08T00:05:00.000Z" });
assert.equal(valid.ok, true);
assert.equal(valid.status, "execution_envelope_ready");

const expired = validatePlatformExecutionEnvelope(envelope, { enforcement, now: "2026-07-08T00:20:00.000Z" });
assert.equal(expired.ok, false);
assert.equal(expired.status, "execution_envelope_expired");

const replayed = validatePlatformExecutionEnvelope(envelope, { enforcement, now: "2026-07-08T00:05:00.000Z", seen_replay_keys: [envelope.replay_key] });
assert.equal(replayed.ok, false);
assert.equal(replayed.status, "execution_envelope_replay_detected");

const changedRevision = structuredClone(enforcement);
changedRevision.revision_vector.capability.schema_version = "v2";
const mismatch = validatePlatformExecutionEnvelope(envelope, { enforcement: changedRevision, now: "2026-07-08T00:05:00.000Z" });
assert.equal(mismatch.ok, false);
assert.equal(mismatch.status, "execution_envelope_revision_mismatch");

const executed = transitionPlatformExecutionEnvelope(envelope, "execute");
assert.equal(executed.ok, true);
assert.equal(executed.envelope.execution_status, "executed");
assert.equal(executed.envelope.provider_apply_allowed, false);
const terminal = validatePlatformExecutionEnvelope(executed.envelope, { enforcement, now: "2026-07-08T00:05:00.000Z" });
assert.equal(terminal.ok, false);
assert.equal(terminal.status, "execution_envelope_already_terminal");

console.log("platform execution envelope kernel tests passed");
