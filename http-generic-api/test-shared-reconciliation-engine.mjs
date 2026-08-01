import assert from "node:assert/strict";
import "./test-governed-reconciliation-kernel.mjs";
import {
  GENERALIZED_INTERRUPTION_SIGNALS,
  RECONCILIATION_SEQUENCE,
  assertResourceScopeAllowed,
  classifyResumeRisk,
  createContinuationCheckpoint,
  fingerprintResource,
  planContinuationResume,
  sanitizeContinuationPayload,
} from "./sharedReconciliationEngine.js";

const admin = { actor_type: "admin" };
const tenant = { actor_type: "tenant", tenant_id: "tenant-a" };
const user = { actor_type: "user", tenant_id: "tenant-a", user_id: "user-a" };
const ownTenantScope = { scope_type: "tenant", tenant_id: "tenant-a" };

assert.deepEqual(
  RECONCILIATION_SEQUENCE,
  ["detect_drift", "classify_risk", "dry_run_repair", "apply_repair", "verify", "audit", "resume_original_operation"],
  "shared reconciliation must preserve the full safe resume sequence"
);
assert(GENERALIZED_INTERRUPTION_SIGNALS.includes("tool_time_exhausted"), "tool timeout must be a generalized interruption signal");
assert(GENERALIZED_INTERRUPTION_SIGNALS.includes("connector_tunnel_provisioning_required"), "missing tunnel token must be a resumable connector provisioning signal");
assert(GENERALIZED_INTERRUPTION_SIGNALS.includes("branch_diverged"), "branch drift must be a generalized interruption signal");
assert(GENERALIZED_INTERRUPTION_SIGNALS.includes("deploy_reload_pending"), "deploy reload gaps must be a generalized interruption signal");
assert(GENERALIZED_INTERRUPTION_SIGNALS.includes("fallback_unsupported_command"), "unsupported fallback gaps must be a generalized interruption signal");

const sanitized = sanitizeContinuationPayload({
  status: "pending",
  nested: { api_key: "secret-value", client_secret: "client-secret-value", safe: "ok" },
});
assert.equal(sanitized.nested.api_key, "[redacted]", "API keys must be redacted from continuation metadata");
assert.equal(sanitized.nested.client_secret, "[redacted]", "client secrets must be redacted from continuation metadata");
assert.equal(sanitized.nested.safe, "ok", "non-sensitive values should remain available for resume context");

assert.equal(assertResourceScopeAllowed(admin, { scope_type: "repository" }).allowed, true, "admin may reconcile repository resources");
assert.equal(assertResourceScopeAllowed(tenant, ownTenantScope).allowed, true, "tenant may reconcile own tenant resources");
assert.equal(
  assertResourceScopeAllowed(tenant, { scope_type: "platform" }).reason_code,
  "platform_scope_requires_admin",
  "tenant actors must not reconcile platform resources"
);
assert.equal(
  assertResourceScopeAllowed(tenant, { scope_type: "tenant", tenant_id: "tenant-b" }).reason_code,
  "tenant_scope_mismatch",
  "tenant actors must not reconcile another tenant"
);
assert.equal(
  assertResourceScopeAllowed(user, { scope_type: "user", tenant_id: "tenant-a", user_id: "user-b" }).reason_code,
  "user_scope_mismatch",
  "user actors must not reconcile another user's resources"
);

const resourceState = { branch: "gpt/example", head: "a".repeat(40), base: "main" };
const checkpoint = createContinuationCheckpoint({
  operation_key: "branch-refresh:gpt/example",
  resource_type: "git_branch",
  actor_context: admin,
  resource_scope: { scope_type: "repository", owner: "mad4bdigital-ai", repo: "multi-business-multi-role-growth-intelligence-os" },
  resource_state: resourceState,
  interruption_signal: "tool_time_exhausted",
  metadata: { token: "must-not-leak", note: "resume branch refresh" },
});
assert.equal(checkpoint.requires_reconciliation_before_resume, true, "checkpoint must force reconciliation before resume");
assert.equal(checkpoint.secrets_included, false, "checkpoint must explicitly exclude secrets");
assert.equal(checkpoint.metadata.token, "[redacted]", "checkpoint metadata must be sanitized");
assert.equal(checkpoint.resource_fingerprint, fingerprintResource({ resource_type: "git_branch", resource_scope: checkpoint.resource_scope, resource_state: resourceState }));

const cleanRisk = classifyResumeRisk({
  checkpoint,
  actor_context: admin,
  resource_scope: checkpoint.resource_scope,
  current_resource_state: resourceState,
});
assert.equal(cleanRisk.classification, "clean", "unchanged resource state should be clean");
assert.equal(cleanRisk.resume_allowed, true, "clean state can resume original operation");
assert.equal(cleanRisk.requires_reconciliation_before_resume, false, "clean state does not need repair before resume");

const driftRisk = classifyResumeRisk({
  checkpoint,
  actor_context: admin,
  resource_scope: checkpoint.resource_scope,
  current_resource_state: { ...resourceState, head: "b".repeat(40) },
});
assert.equal(driftRisk.classification, "drift_detected", "changed resource state must be treated as drift");
assert.equal(driftRisk.resume_allowed, false, "drift must block direct resume");
assert.equal(driftRisk.requires_reconciliation_before_resume, true, "drift must require reconciliation before resume");

const driftPlan = planContinuationResume({
  checkpoint,
  actor_context: admin,
  resource_scope: checkpoint.resource_scope,
  current_resource_state: { ...resourceState, head: "b".repeat(40) },
  apply_requested: true,
});
assert.equal(driftPlan.next_required_step, "dry_run_repair", "drift resume must start with a dry-run repair");
assert.equal(driftPlan.apply_allowed, false, "apply is blocked until dry-run and verify succeed");

const verifiedPlan = planContinuationResume({
  checkpoint,
  actor_context: admin,
  resource_scope: checkpoint.resource_scope,
  current_resource_state: { ...resourceState, head: "b".repeat(40) },
  dry_run_result: { ok: true },
  verify_result: { ok: true },
  apply_requested: true,
});
assert.equal(verifiedPlan.next_required_step, "apply_repair", "verified dry-run drift can proceed to apply repair");
assert.equal(verifiedPlan.apply_allowed, true, "apply is allowed only after dry-run and verification evidence");

console.log("shared reconciliation engine tests passed");
