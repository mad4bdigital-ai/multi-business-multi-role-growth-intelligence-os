import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const FORBIDDEN_PROJECTION_KEYS = new Set([
  "execution_context_json",
  "authority_snapshot_json",
  "input_json",
  "output_json",
  "error_json",
  "idempotency_key",
  "credential_ref",
  "credential_id",
  "access_token",
  "refresh_token",
]);

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`missing_required_env:${name}`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function assertSafeBaseUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "auth.mad4b.com" || url.username || url.password || url.search || url.hash) {
    throw new Error("unsafe_runtime_base_url");
  }
  return url.origin;
}

function assertNoForbiddenProjectionKeys(value, path = "projection") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenProjectionKeys(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PROJECTION_KEYS.has(key)) throw new Error(`unsafe_projection_key:${path}.${key}`);
    assertNoForbiddenProjectionKeys(child, `${path}.${key}`);
  }
}

function safeId(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 255 || !/^[A-Za-z0-9._:@/+\-]+$/u.test(normalized)) {
    throw new Error(`invalid_canary_identifier:${label}`);
  }
  return normalized;
}

const runtimeBaseUrl = assertSafeBaseUrl(required("RUNTIME_BASE_URL"));
const backendApiKey = required("BACKEND_API_KEY");
const sourceSha = safeId(required("SOURCE_SHA"), "source_sha");
const expectedProductionSha = safeId(required("EXPECTED_PRODUCTION_SHA"), "expected_production_sha");
const userId = safeId(required("SPEC017_CANARY_USER_ID"), "user_id");
const tenantId = safeId(required("SPEC017_CANARY_TENANT_ID"), "tenant_id");
const parentTicketId = safeId(required("SPEC017_CANARY_PARENT_TICKET_ID"), "parent_ticket_id");
const capabilityKey = safeId(required("SPEC017_CANARY_CAPABILITY_KEY"), "capability_key");
const resourceType = safeId(required("SPEC017_CANARY_RESOURCE_TYPE"), "resource_type");
const resourceRef = safeId(required("SPEC017_CANARY_RESOURCE_REF"), "resource_ref");
const runNonce = safeId(process.env.GITHUB_RUN_ID || `${Date.now()}`, "run_nonce");
const evidencePath = String(process.env.SPEC017_CANARY_EVIDENCE_PATH || "artifacts/spec017-managed-execution-protected-canary.json").trim();

let tenantToken = "";

async function api(path, { method = "GET", auth = "tenant", body = undefined, expected = [200] } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth === "admin") headers["x-api-key"] = backendApiKey;
  if (auth === "tenant") headers.authorization = `Bearer ${tenantToken}`;
  const response = await fetch(`${runtimeBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { parse_error: true }; }
  if (!expected.includes(response.status)) {
    const code = payload?.error?.code || "unknown";
    throw new Error(`unexpected_http:${method}:${path}:${response.status}:${code}`);
  }
  return { status: response.status, payload };
}

const evidence = {
  schema_version: 1,
  report_type: "spec017_managed_execution_protected_canary",
  source_sha: sourceSha,
  expected_production_sha: expectedProductionSha,
  runtime_origin: runtimeBaseUrl,
  status: "failed",
  tenant_identity: {
    user_id_sha256: sha256(userId),
    tenant_id_sha256: sha256(tenantId),
    short_lived_platform_jwt_used: false,
    long_lived_user_jwt_secret_used: false,
  },
  fixture: {
    parent_ticket_id_sha256: sha256(parentTicketId),
    capability_key: capabilityKey,
    resource_type: resourceType,
    resource_ref_sha256: sha256(resourceRef),
  },
  assertions: {},
  runs: {},
  provider_dispatch_executed: false,
  external_business_effect_executed: false,
  migration_apply_executed: false,
  sql_executed_by_canary: false,
  deployment_mutated: false,
  secrets_included: false,
};

try {
  const issued = await api("/auth/platform-jwt/issue", {
    method: "POST",
    auth: "admin",
    body: {
      user_id: userId,
      tenant_id: tenantId,
      ttl_seconds: 600,
      reason: `spec017_protected_canary:${sourceSha.slice(0, 12)}`,
    },
  });
  tenantToken = String(issued.payload?.access_token || "");
  if (!tenantToken || issued.payload?.tenant?.tenant_id !== tenantId || issued.payload?.user?.user_id !== userId) {
    throw new Error("platform_jwt_identity_mismatch");
  }
  evidence.tenant_identity.short_lived_platform_jwt_used = true;
  evidence.assertions.active_user_membership_verified = true;

  const baseEnvelope = {
    tenant_id: tenantId,
    user_id: userId,
    parent_ticket_id: parentTicketId,
    workflow_key: "spec017_protected_canary",
    capability_key: capabilityKey,
    resource_type: resourceType,
    resource_ref: resourceRef,
    service_mode: "managed",
    input_json: {
      canary: true,
      source_sha: sourceSha,
      provider_dispatch: false,
      external_business_effect: false,
    },
  };

  const wrongTenant = `scope-probe-${sha256(`${tenantId}:${sourceSha}`).slice(0, 24)}`;
  const crossTenant = await api("/managed-execution-runs", {
    method: "POST",
    auth: "tenant",
    body: {
      ...baseEnvelope,
      tenant_id: wrongTenant,
      effect_class: "read_only",
      idempotency_key: `spec017-cross-${runNonce}`,
      task_title: "Spec 017 protected canary cross-tenant negative probe",
    },
    expected: [403],
  });
  if (crossTenant.payload?.error?.code !== "managed_execution_principal_scope_mismatch") {
    throw new Error("cross_tenant_probe_did_not_fail_closed");
  }
  evidence.assertions.cross_tenant_scope_rejected = true;

  const readOnlyEnvelope = {
    ...baseEnvelope,
    effect_class: "read_only",
    idempotency_key: `spec017-ro-${sourceSha.slice(0, 10)}-${runNonce}`,
    task_title: "Spec 017 protected canary read-only lifecycle",
  };
  const readOnlyCreate = await api("/managed-execution-runs", {
    method: "POST",
    auth: "tenant",
    body: readOnlyEnvelope,
    expected: [200, 201],
  });
  const readOnlyRunId = String(readOnlyCreate.payload?.binding?.run_id || readOnlyCreate.payload?.run?.run_id || "");
  if (!readOnlyRunId) throw new Error("read_only_run_id_missing");
  if ((readOnlyCreate.payload?.holds || []).length !== 0) throw new Error("read_only_canary_unexpected_approval_hold");
  evidence.runs.read_only_run_id_sha256 = sha256(readOnlyRunId);
  evidence.assertions.read_only_no_approval_path = true;

  const readOnlyReplay = await api("/managed-execution-runs", {
    method: "POST",
    auth: "tenant",
    body: readOnlyEnvelope,
  });
  if (readOnlyReplay.payload?.reused !== true) throw new Error("run_idempotency_reuse_missing");
  evidence.assertions.run_idempotency_verified = true;

  const tenantProjectionBefore = await api(`/managed-execution-runs/${encodeURIComponent(readOnlyRunId)}`, { auth: "tenant" });
  assertNoForbiddenProjectionKeys(tenantProjectionBefore.payload?.projection);
  if (tenantProjectionBefore.payload?.projection?.contract !== "managed_execution_tenant_projection.v1") {
    throw new Error("tenant_projection_contract_mismatch");
  }
  evidence.assertions.tenant_safe_projection_verified = true;

  const adminProjectionBefore = await api(`/managed-execution-runs/${encodeURIComponent(readOnlyRunId)}`, { auth: "admin" });
  if (adminProjectionBefore.payload?.projection?.contract !== "managed_execution_admin_projection.v1") {
    throw new Error("admin_projection_contract_mismatch");
  }
  evidence.assertions.admin_projection_verified = true;

  const healthyDryRun = await api(`/managed-execution-runs/${encodeURIComponent(readOnlyRunId)}/reconcile`, {
    method: "POST",
    auth: "admin",
    body: { mode: "dry_run" },
  });
  if ((healthyDryRun.payload?.contradictions || []).length !== 0 || Number(healthyDryRun.payload?.reconciliation?.action_count || 0) !== 0) {
    throw new Error("healthy_reconciliation_not_clean");
  }
  evidence.assertions.reconciliation_dry_run_verified = true;

  const stepBody = {
    step_key: "canary_local_probe",
    step_type: "action",
    idempotency_key: `spec017-step-${sourceSha.slice(0, 10)}-${runNonce}`,
    assigned_to: userId,
    input_json: { canary: true, provider_dispatch: false },
  };
  const stepCreate = await api(`/managed-execution-runs/${encodeURIComponent(readOnlyRunId)}/steps`, {
    method: "POST",
    auth: "tenant",
    body: stepBody,
    expected: [200, 201],
  });
  const stepRunId = String(stepCreate.payload?.step?.step_run_id || "");
  if (!stepRunId) throw new Error("managed_step_id_missing");

  const stepReplay = await api(`/managed-execution-runs/${encodeURIComponent(readOnlyRunId)}/steps`, {
    method: "POST",
    auth: "tenant",
    body: stepBody,
  });
  if (stepReplay.payload?.reused !== true) throw new Error("step_idempotency_reuse_missing");
  evidence.assertions.step_idempotency_verified = true;

  await api(`/managed-execution-runs/${encodeURIComponent(readOnlyRunId)}/steps/${encodeURIComponent(stepRunId)}/status`, {
    method: "PATCH", auth: "tenant", body: { status: "running" },
  });
  await api(`/managed-execution-runs/${encodeURIComponent(readOnlyRunId)}/steps/${encodeURIComponent(stepRunId)}/status`, {
    method: "PATCH",
    auth: "tenant",
    body: { status: "failed", error_message: "Spec 017 canary provider-independent transient failure." },
  });
  const retry = await api(`/managed-execution-runs/${encodeURIComponent(readOnlyRunId)}/steps/${encodeURIComponent(stepRunId)}/retry`, {
    method: "POST",
    auth: "tenant",
    body: {
      idempotency_key: `spec017-retry-${sourceSha.slice(0, 10)}-${runNonce}`,
      reason: "Spec 017 bounded retry canary.",
    },
    expected: [200, 201],
  });
  if (retry.payload?.attempt !== 2 || retry.payload?.max_attempts !== 3) throw new Error("bounded_retry_contract_mismatch");
  evidence.assertions.bounded_retry_verified = true;

  const reassign = await api(`/managed-execution-runs/${encodeURIComponent(readOnlyRunId)}/steps/${encodeURIComponent(stepRunId)}/assignment`, {
    method: "PATCH",
    auth: "tenant",
    body: { assigned_to: userId, reason: "Spec 017 active-membership reassignment canary." },
  });
  if (reassign.payload?.membership?.status !== "active") throw new Error("reassignment_active_membership_missing");
  evidence.assertions.reassignment_active_membership_verified = true;

  await api(`/managed-execution-runs/${encodeURIComponent(readOnlyRunId)}/steps/${encodeURIComponent(stepRunId)}/status`, {
    method: "PATCH", auth: "tenant", body: { status: "running" },
  });
  await api(`/managed-execution-runs/${encodeURIComponent(readOnlyRunId)}/steps/${encodeURIComponent(stepRunId)}/status`, {
    method: "PATCH", auth: "tenant", body: { status: "completed", output_json: { canary: true, provider_dispatch: false } },
  });
  await api(`/managed-execution-runs/${encodeURIComponent(readOnlyRunId)}/status`, {
    method: "PATCH", auth: "tenant", body: { status: "completed", output_json: { canary: true, readback: "verified" } },
  });

  const readOnlyFinalTenant = await api(`/managed-execution-runs/${encodeURIComponent(readOnlyRunId)}`, { auth: "tenant" });
  assertNoForbiddenProjectionKeys(readOnlyFinalTenant.payload?.projection);
  if (readOnlyFinalTenant.payload?.projection?.status !== "completed") throw new Error("read_only_terminal_projection_mismatch");
  const readOnlyFinalAdmin = await api(`/managed-execution-runs/${encodeURIComponent(readOnlyRunId)}`, { auth: "admin" });
  if ((readOnlyFinalAdmin.payload?.projection?.contradictions || []).length !== 0) {
    throw new Error("read_only_terminal_contradictions_present");
  }
  evidence.assertions.read_only_terminal_zero_contradictions = true;

  const stateChangeEnvelope = {
    ...baseEnvelope,
    effect_class: "state_change",
    idempotency_key: `spec017-sc-${sourceSha.slice(0, 10)}-${runNonce}`,
    task_title: "Spec 017 protected canary approval and rollback lifecycle",
  };
  const stateChangeCreate = await api("/managed-execution-runs", {
    method: "POST",
    auth: "tenant",
    body: stateChangeEnvelope,
    expected: [200, 201],
  });
  const stateChangeRunId = String(stateChangeCreate.payload?.binding?.run_id || stateChangeCreate.payload?.run?.run_id || "");
  const holdId = String(stateChangeCreate.payload?.holds?.[0]?.hold_id || "");
  if (!stateChangeRunId || !holdId) throw new Error("approval_required_fixture_not_created");
  evidence.runs.state_change_run_id_sha256 = sha256(stateChangeRunId);
  evidence.assertions.approval_required_path_created = true;

  const blockedStep = await api(`/managed-execution-runs/${encodeURIComponent(stateChangeRunId)}/steps`, {
    method: "POST",
    auth: "tenant",
    body: {
      step_key: "state_change_probe",
      step_type: "action",
      idempotency_key: `spec017-sc-blocked-${runNonce}`,
      input_json: { canary: true, external_effect: false },
    },
    expected: [409],
  });
  if (blockedStep.payload?.error?.code !== "managed_execution_approval_pending") throw new Error("approval_hold_did_not_block_step");
  evidence.assertions.approval_hold_blocks_execution = true;

  const approved = await api(`/approval-holds/${encodeURIComponent(holdId)}/decide`, {
    method: "POST",
    auth: "admin",
    body: { decision: "approved", decision_note: "Spec 017 protected canary approval; no provider dispatch." },
  });
  if (approved.payload?.decision !== "approved") throw new Error("admin_approval_decision_failed");
  evidence.assertions.admin_approval_path_verified = true;

  const stateStep = await api(`/managed-execution-runs/${encodeURIComponent(stateChangeRunId)}/steps`, {
    method: "POST",
    auth: "tenant",
    body: {
      step_key: "state_change_probe",
      step_type: "action",
      idempotency_key: `spec017-sc-step-${runNonce}`,
      assigned_to: userId,
      input_json: { canary: true, external_effect: false },
    },
    expected: [200, 201],
  });
  const stateStepId = String(stateStep.payload?.step?.step_run_id || "");
  if (!stateStepId) throw new Error("state_change_step_id_missing");
  await api(`/managed-execution-runs/${encodeURIComponent(stateChangeRunId)}/steps/${encodeURIComponent(stateStepId)}/status`, {
    method: "PATCH", auth: "tenant", body: { status: "running" },
  });
  await api(`/managed-execution-runs/${encodeURIComponent(stateChangeRunId)}/steps/${encodeURIComponent(stateStepId)}/status`, {
    method: "PATCH", auth: "tenant", body: { status: "completed", output_json: { canary: true, external_effect: false } },
  });
  await api(`/managed-execution-runs/${encodeURIComponent(stateChangeRunId)}/status`, {
    method: "PATCH", auth: "tenant", body: { status: "completed", output_json: { canary: true, state_change_simulated: true } },
  });

  const rollback = await api(`/managed-execution-runs/${encodeURIComponent(stateChangeRunId)}/rollback`, {
    method: "POST",
    auth: "tenant",
    body: {
      idempotency_key: `spec017-rollback-${runNonce}`,
      assigned_to: userId,
      reason: "Spec 017 local compensation canary; no external effect was executed.",
    },
    expected: [200, 201],
  });
  const rollbackStepId = String(rollback.payload?.step?.step_run_id || "");
  if (!rollbackStepId) throw new Error("rollback_step_id_missing");
  await api(`/managed-execution-runs/${encodeURIComponent(stateChangeRunId)}/steps/${encodeURIComponent(rollbackStepId)}/status`, {
    method: "PATCH", auth: "tenant", body: { status: "running" },
  });
  await api(`/managed-execution-runs/${encodeURIComponent(stateChangeRunId)}/steps/${encodeURIComponent(rollbackStepId)}/status`, {
    method: "PATCH", auth: "tenant", body: { status: "completed", output_json: { canary: true, compensation: "local_only" } },
  });
  const finalizedRollback = await api(`/managed-execution-runs/${encodeURIComponent(stateChangeRunId)}/rollback/finalize`, {
    method: "POST",
    auth: "tenant",
    body: { step_run_id: rollbackStepId, evidence: { canary: true, compensation_verified: true } },
  });
  if (finalizedRollback.payload?.lifecycle_state !== "rolled_back") throw new Error("rollback_finalization_failed");
  evidence.assertions.rollback_lifecycle_verified = true;

  const rollbackAdminProjection = await api(`/managed-execution-runs/${encodeURIComponent(stateChangeRunId)}`, { auth: "admin" });
  if ((rollbackAdminProjection.payload?.projection?.contradictions || []).length !== 0) {
    throw new Error("rollback_terminal_contradictions_present");
  }
  evidence.assertions.rollback_terminal_zero_contradictions = true;

  const finalDryRun = await api(`/managed-execution-runs/${encodeURIComponent(stateChangeRunId)}/reconcile`, {
    method: "POST", auth: "admin", body: { mode: "dry_run" },
  });
  if ((finalDryRun.payload?.contradictions || []).length !== 0 || Number(finalDryRun.payload?.reconciliation?.action_count || 0) !== 0) {
    throw new Error("final_reconciliation_not_clean");
  }
  evidence.assertions.final_zero_action_reconciliation_readback = true;

  evidence.status = "pass";
} finally {
  tenantToken = "";
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8" });
}

console.log(JSON.stringify({
  ok: evidence.status === "pass",
  report_type: evidence.report_type,
  status: evidence.status,
  source_sha: evidence.source_sha,
  expected_production_sha: evidence.expected_production_sha,
  assertions: evidence.assertions,
  provider_dispatch_executed: false,
  external_business_effect_executed: false,
  migration_apply_executed: false,
  secrets_included: false,
}, null, 2));
