import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const helper = readFileSync(new URL("./capabilityResolutionEnvelopeGuard.js", import.meta.url), "utf8");
const wordpress = readFileSync(new URL("./wordpressBlogPublishOrchestrator.js", import.meta.url), "utf8");
const hostinger = readFileSync(new URL("./hostingerSshDeployExecutor.js", import.meta.url), "utf8");

assert.match(helper, /export function extractCapabilityEnvelopeId/);
assert.match(helper, /export async function resolveCapabilityExecutionEnvelope/);
assert.match(helper, /capability_resolution_envelope_ledger/);
assert.match(helper, /ready_for_dispatch/);
assert.match(helper, /dispatch_allowed/);
assert.match(helper, /approval_required/);
assert.match(helper, /blocking_gap_count/);
assert.match(helper, /capability_resolution_envelope_commit_mismatch/);
assert.match(helper, /export async function markCapabilityEnvelopeReferenced/);
assert.match(helper, /secrets_included: false/);
assert.doesNotMatch(helper, /decryptToken|value_ciphertext|encrypted_credentials|oauth_token|private_key/i);
assert.doesNotMatch(helper, /fetch\(|axios|child_process|exec\(|spawn\(/);

assert.match(wordpress, /resolveCapabilityExecutionEnvelope/);
assert.match(wordpress, /acceptedAppKeys: \["wordpress_rest"\]/);
assert.match(wordpress, /acceptedIntents/);
assert.match(wordpress, /markCapabilityEnvelopeReferenced\(\{ pool: deps\.pool/);
assert.doesNotMatch(wordpress, /SELECT envelope_id, tenant_id, user_id, app_key, capability_key, operation_intent,[\s\S]*FROM capability_resolution_envelope_ledger/);

assert.match(hostinger, /resolveCapabilityExecutionEnvelope/);
assert.match(hostinger, /capabilityEnvelopeError/);
assert.match(hostinger, /acceptedAppKeys: \["remote_ssh_runtime", "hostinger"\]/);
assert.match(hostinger, /acceptedIntents: \["deploy", "restart", "write", "remote_runtime_deploy", "hostinger_ssh_deploy", "deploy_release"\]/);
assert.match(hostinger, /expectedCommitSha/);
assert.match(hostinger, /markCapabilityEnvelopeReferenced\(\{ pool, envelopeId: envelope\.envelope_id/);
assert.doesNotMatch(hostinger, /SELECT envelope_id, tenant_id, user_id, app_key, capability_key, operation_intent,[\s\S]*FROM capability_resolution_envelope_ledger/);

console.log("Capability resolution shared envelope guard tests passed");
