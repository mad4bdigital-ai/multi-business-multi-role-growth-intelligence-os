import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const executor = readFileSync("hostingerSshDeployExecutor.js", "utf8");
const migration = readFileSync("migrations/227_sprint67_hostinger_deploy_capability_envelope_requirement.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

assert.match(executor, /resolveCapabilityEnvelopeForHostingerDeploy/);
assert.match(executor, /resolveCapabilityExecutionEnvelope/);
assert.match(executor, /capabilityEnvelopeError/);
assert.match(executor, /acceptedAppKeys: \["remote_ssh_runtime", "hostinger"\]/);
assert.match(executor, /expectedCommitSha/);
assert.match(executor, /markCapabilityEnvelopeReferenced/);
assert.match(executor, /REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED/);
assert.match(executor, /secrets_included: false/);
assert.doesNotMatch(executor, /decryptToken\(|value_ciphertext|oauth_token|private_key:\s*privateKey/i);
assert.doesNotMatch(executor, /exec\(/);

const deployFunctionIndex = executor.indexOf("export async function executeHostingerSshDeployRelease");
const executorGateIndex = executor.indexOf("const executorGate = await loadHostingerSshExecutorGate", deployFunctionIndex);
const gateRejectIndex = executor.indexOf("if (!executorGate.enabled)", executorGateIndex);
const planReadyIndex = executor.indexOf("if (!plan.dispatch_ready)", deployFunctionIndex);
const envelopeGateIndex = executor.indexOf("const envelope = await resolveCapabilityEnvelopeForHostingerDeploy", deployFunctionIndex);
const credentialIndex = executor.indexOf("const sshConnection = await resolveSshConnectionCredentials", deployFunctionIndex);
const sshCommandIndex = executor.indexOf("const sshResult = await runSshCommand", deployFunctionIndex);
assert.ok(executorGateIndex > -1, "Hostinger deploy execution must remain behind the ENV-or-DB executor gate.");
assert.ok(gateRejectIndex > executorGateIndex, "Disabled executor gates must fail closed before dispatch.");
assert.ok(planReadyIndex > gateRejectIndex, "Dispatch plan readiness must still be checked after the executor gate.");
assert.ok(envelopeGateIndex > planReadyIndex, "Capability envelope must be checked after dispatch dry-run readiness.");
assert.ok(credentialIndex > envelopeGateIndex, "SSH credentials must not resolve before capability envelope validation.");
assert.ok(sshCommandIndex > credentialIndex, "SSH command must run only after credential resolution and envelope validation.");

assert.match(migration, /hostinger_deploy_capability_envelope_requirement_v1/);
assert.match(migration, /capability_resolution_envelope_ledger/);
assert.match(migration, /dry_run_requires_envelope',false/);
assert.match(migration, /ssh_probe_requires_envelope',false/);
assert.match(migration, /execution_requires_envelope',true/);
assert.match(migration, /feature_flag_still_required/);
assert.match(migration, /approval_reason_still_required/);
assert.match(migration, /expected_sha_still_required/);
assert.match(migration, /no_ssh_without_envelope',true/);
assert.match(migration, /capability_envelope_required/);
assert.match(migration, /JSON_SET\(input_schema/);
assert.doesNotMatch(migration, /CAST\(input_schema AS JSON\)/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);
assert.match(runner, /227_sprint67_hostinger_deploy_capability_envelope_requirement\.sql/);

console.log("Hostinger deploy capability envelope requirement guard passed");
