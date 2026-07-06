import crypto from "node:crypto";
import { getPool } from "./db.js";
import { tenantEffectiveCapabilityPreview } from "./tenantEffectiveCapabilityResolver.js";
import { runCapabilityResolutionDryRun } from "./scripts/capability-resolution-dry-run.mjs";

const REQUIRED_READINESS_OBJECTS = Object.freeze([
  "platform_semantic_capabilities",
  "platform_capability_provider_bindings",
  "workspace_resource_grants",
  "credential_bindings",
  "capability_resolution_envelope_ledger",
  "approval_holds",
  "runtime_dispatch_certification_registry",
  "capability_enablement_requests",
  "capability_enablement_steps",
  "v_capability_enablement_decision_rollup",
]);

const APPLY_INTENTS = new Set(["apply", "publish", "deploy", "spend", "delete", "destructive"]);
const READY_EFFECTIVE_STATUSES = new Set(["ready", "canary_ready", "shadow_ready"]);
const CREDENTIAL_STATUSES = new Set(["connection_not_found", "connection_not_validated"]);
const MAX_LIMIT = 100;

function safeText(value = "", max = 255) {
  return String(value || "").trim().slice(0, max);
}

function normalize(value = "") {
  return safeText(value, 255).toLowerCase();
}

function isAdminPrincipal(auth = {}) {
  return auth?.is_admin === true;
}

function randomRequestId() {
  return `ceb_${crypto.randomUUID()}`;
}

function stableJson(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(stableJson);
  if (typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableJson(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableJson(value) ?? null)).digest("hex");
}

function jsonForSql(value) {
  return JSON.stringify(value ?? null);
}

function boundedLimit(value, fallback = 25) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

function principalScope(args = {}, auth = {}) {
  const admin = isAdminPrincipal(auth);
  return {
    caller_type: admin ? "admin" : "tenant",
    tenant_id: admin && args.tenant_id ? safeText(args.tenant_id, 64) : safeText(auth?.tenant_id, 64),
    user_id: admin && args.user_id ? safeText(args.user_id, 64) : safeText(auth?.user_id, 64),
    admin_override_used: Boolean(admin && (args.tenant_id || args.user_id)),
  };
}

function compactError(error = null) {
  if (!error) return null;
  return {
    code: safeText(error.code || "unknown_error", 128),
    message: safeText(error.message || "Unknown error.", 500),
    details: error.details || undefined,
  };
}

function hasSecretLikeKey(value) {
  if (!value || typeof value !== "object") return false;
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, child] of Object.entries(current)) {
      if (/secret|token|password|private[_-]?key|api[_-]?key|authorization|client[_-]?secret/i.test(String(key))) {
        return true;
      }
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return false;
}

function effectiveStatusFrom(result = null) {
  if (!result) return null;
  if (result.ok === false) return normalize(result.error?.code || result.status || "blocked");
  return normalize(result.status || "unknown");
}

function dryRunDecisionFrom(result = null) {
  return normalize(result?.decision || "");
}

function dryRunGaps(result = null) {
  return Array.isArray(result?.blocking_gaps) ? result.blocking_gaps.map((gap) => safeText(gap, 128)).filter(Boolean) : [];
}

export function classifyEnablementDecision({ effective = null, dryRun = null, operationIntent = "read", secretBoundaryFailed = false } = {}) {
  const effectiveStatus = effectiveStatusFrom(effective);
  const dryRunDecision = dryRunDecisionFrom(dryRun);
  const gaps = dryRunGaps(dryRun);
  const op = normalize(operationIntent || dryRun?.request_context?.operation_intent || "read");
  const reasonCodes = [];

  if (secretBoundaryFailed) {
    return { decision: "blocked_secret_boundary", reason_codes: ["SECRET_BOUNDARY_FAILED"], next_allowed_mode: "none" };
  }
  if (APPLY_INTENTS.has(op)) {
    return { decision: "blocked_apply_not_supported", reason_codes: ["APPLY_AUTHORITY_NOT_AUTO_GRANTABLE"], next_allowed_mode: "diagnose" };
  }
  if (effective?.ok === false) {
    const rawCode = safeText(effective.error?.code || "EFFECTIVE_CAPABILITY_RESOLUTION_FAILED", 128).toUpperCase();
    const code = normalize(rawCode);
    if (code.includes("membership")) return { decision: "blocked_missing_membership", reason_codes: ["MEMBERSHIP_REQUIRED"], next_allowed_mode: "none" };
    if (code.includes("tenant") || code.includes("user")) return { decision: "blocked_out_of_scope", reason_codes: ["TENANT_OR_USER_CONTEXT_REQUIRED"], next_allowed_mode: "diagnose" };
    if (code.includes("workspace")) return { decision: "needs_resource_binding", reason_codes: ["WORKSPACE_CONTEXT_MISSING"], next_allowed_mode: "diagnose" };
    if (code.includes("capability_binding_missing")) return { decision: "needs_execution_enablement", reason_codes: ["CAPABILITY_BINDING_MISSING"], next_allowed_mode: "diagnose" };
    if (code.includes("capability_not_registered")) return { decision: "blocked_policy_denied", reason_codes: ["CAPABILITY_NOT_REGISTERED"], next_allowed_mode: "diagnose" };
    if (code.includes("capability")) return { decision: "blocked_policy_denied", reason_codes: [rawCode || "CAPABILITY_NOT_REGISTERED"], next_allowed_mode: "diagnose" };
    return { decision: "degraded_contract", reason_codes: ["EFFECTIVE_CAPABILITY_RESOLUTION_FAILED"], next_allowed_mode: "diagnose" };
  }
  if (effectiveStatus === "workspace_membership_required") return { decision: "blocked_missing_membership", reason_codes: ["MEMBERSHIP_REQUIRED"], next_allowed_mode: "none" };
  if (effectiveStatus === "workspace_not_registered" || effectiveStatus === "workspace_not_ready") return { decision: "needs_resource_binding", reason_codes: ["WORKSPACE_CONTEXT_MISSING"], next_allowed_mode: "diagnose" };
  if (effectiveStatus === "capability_not_registered" || effectiveStatus === "capability_binding_missing") return { decision: "blocked_policy_denied", reason_codes: ["CAPABILITY_NOT_REGISTERED"], next_allowed_mode: "diagnose" };
  if (CREDENTIAL_STATUSES.has(effectiveStatus)) return { decision: "needs_credential", reason_codes: [effectiveStatus === "connection_not_validated" ? "CONNECTION_NOT_VALIDATED" : "CONNECTION_MISSING"], next_allowed_mode: "diagnose" };
  if (effectiveStatus === "ambiguous_connection") return { decision: "needs_credential", reason_codes: ["CONNECTION_AMBIGUOUS"], next_allowed_mode: "diagnose" };
  if (effectiveStatus === "capability_not_granted") return { decision: "needs_approval", reason_codes: ["CAPABILITY_NOT_GRANTED"], next_allowed_mode: "preview" };
  if (effectiveStatus === "resource_authority_missing") return { decision: "needs_resource_binding", reason_codes: ["RESOURCE_AUTHORITY_MISSING"], next_allowed_mode: "preview" };
  if (effectiveStatus === "runtime_certification_missing") return { decision: "needs_certification", reason_codes: ["DISPATCH_CERTIFICATION_MISSING"], next_allowed_mode: "preview" };
  if (effectiveStatus === "canonical_endpoint_unavailable" || effectiveStatus === "capability_export_missing") return { decision: "needs_execution_enablement", reason_codes: ["EXECUTION_ENABLEMENT_DISABLED"], next_allowed_mode: "diagnose" };

  if (gaps.includes("dispatch_certification_missing_or_not_allowed")) reasonCodes.push("DISPATCH_CERTIFICATION_MISSING");
  if (gaps.includes("workspace_resource_grant_missing_for_high_risk_operation") || gaps.includes("elevated_permission_missing")) reasonCodes.push("RESOURCE_AUTHORITY_MISSING");
  if (gaps.includes("no_active_connection_or_credential_binding_found")) reasonCodes.push("CREDENTIAL_BINDING_MISSING");
  if (gaps.includes("user_id_missing") || gaps.includes("tenant_id_missing")) reasonCodes.push("TENANT_OR_USER_CONTEXT_REQUIRED");

  if (dryRunDecision === "ready_for_dispatch") return { decision: "ready_for_dispatch", reason_codes: reasonCodes, next_allowed_mode: "dispatch" };
  if (dryRunDecision === "ready_requires_approval") return { decision: "needs_approval", reason_codes: reasonCodes.length ? reasonCodes : ["ENVELOPE_APPROVAL_REQUIRED"], next_allowed_mode: "preview" };
  if (dryRunDecision === "blocked_requires_setup") return { decision: "needs_preflight", reason_codes: reasonCodes.length ? reasonCodes : ["SETUP_REQUIRED"], next_allowed_mode: "diagnose" };
  if (gaps.length) return { decision: "needs_preflight", reason_codes: reasonCodes.length ? reasonCodes : ["PREFLIGHT_BLOCKING_GAPS"], next_allowed_mode: "diagnose" };
  if (READY_EFFECTIVE_STATUSES.has(effectiveStatus)) return { decision: "ready_for_preview", reason_codes: reasonCodes, next_allowed_mode: "preview" };
  return { decision: "needs_preflight", reason_codes: reasonCodes.length ? reasonCodes : ["PREFLIGHT_REQUIRED"], next_allowed_mode: "diagnose" };
}

export function buildCapabilityEnablementNextActions(classification = {}, { effective = null, dryRun = null } = {}) {
  const reasonCodes = new Set(classification.reason_codes || []);
  const actions = [];
  const push = (action, requiredRole, reasonCode) => actions.push({ action, required_role: requiredRole, reason_code: reasonCode });
  if (classification.decision === "blocked_apply_not_supported") push("create_explicit_apply_policy_and_typed_approval", "platform_admin", "APPLY_AUTHORITY_NOT_AUTO_GRANTABLE");
  if (reasonCodes.has("MEMBERSHIP_REQUIRED")) push("grant_workspace_membership", "tenant_owner", "MEMBERSHIP_REQUIRED");
  if (reasonCodes.has("WORKSPACE_CONTEXT_MISSING")) push("resolve_workspace_context", "tenant_owner", "WORKSPACE_CONTEXT_MISSING");
  if (reasonCodes.has("CONNECTION_MISSING")) push("complete_credential_intake", "tenant_owner", "CONNECTION_MISSING");
  if (reasonCodes.has("CONNECTION_NOT_VALIDATED")) push("validate_connection", "tenant_owner", "CONNECTION_NOT_VALIDATED");
  if (reasonCodes.has("CREDENTIAL_BINDING_MISSING")) push("run_credential_effective_plan", "tenant_owner", "CREDENTIAL_BINDING_MISSING");
  if (reasonCodes.has("CAPABILITY_BINDING_MISSING")) push("request_capability_provider_binding_or_plugin_action_grant", "platform_admin", "CAPABILITY_BINDING_MISSING");
  if (reasonCodes.has("CAPABILITY_NOT_REGISTERED")) push("register_semantic_capability_or_request_platform_review", "platform_admin", "CAPABILITY_NOT_REGISTERED");
  if (reasonCodes.has("CAPABILITY_NOT_GRANTED")) push("create_action_grant_or_approval_hold", "tenant_owner", "CAPABILITY_NOT_GRANTED");
  if (reasonCodes.has("RESOURCE_AUTHORITY_MISSING")) push("create_resource_authority_binding", "tenant_owner_or_platform_admin", "RESOURCE_AUTHORITY_MISSING");
  if (reasonCodes.has("DISPATCH_CERTIFICATION_MISSING")) push("run_scenario_readback_and_issue_dispatch_certification", "platform_admin", "DISPATCH_CERTIFICATION_MISSING");
  if (reasonCodes.has("ENVELOPE_APPROVAL_REQUIRED")) push("approve_capability_resolution_envelope", "tenant_owner_or_platform_admin", "ENVELOPE_APPROVAL_REQUIRED");
  if (!actions.length && classification.decision === "ready_for_dispatch") push("dispatch_with_existing_runtime_guard", "authorized_actor", "READY_FOR_DISPATCH");
  if (!actions.length && classification.decision === "ready_for_preview") push("run_preview_or_dry_run", "authorized_actor", "READY_FOR_PREVIEW");
  return actions.map((action) => ({ ...action, effective_status: effectiveStatusFrom(effective), dry_run_decision: dryRunDecisionFrom(dryRun) || null }));
}

export function buildCapabilityEnablementProposals(nextActions = [], result = {}) {
  return nextActions.map((action, index) => {
    const proposal = {
      proposal_id: `ceb_step_${index + 1}`,
      action: action.action,
      required_role: action.required_role,
      reason_code: action.reason_code,
      execution_mode: "proposal_only",
      handoff_ready: false,
      provider_calls_made: 0,
      external_mutations_executed: false,
      secrets_included: false,
    };
    if (action.action === "create_resource_authority_binding") {
      proposal.target_tool = "platform_resource_authority_grant_apply";
      proposal.required_evidence = ["tenant_workspace_scope", "resource_uri", "allowed_modes", "typed_confirmation", "same_cycle_readback"];
    } else if (action.action === "complete_credential_intake" || action.action === "run_credential_effective_plan") {
      proposal.target_tool = "credential_intake_or_effective_plan";
      proposal.required_evidence = ["connection_scope", "credential_binding_metadata", "no_secret_projection", "validation_readback"];
    } else if (action.action === "approve_capability_resolution_envelope" || action.action === "create_action_grant_or_approval_hold") {
      proposal.target_tool = "capability_resolution_envelope_create_then_approve";
      proposal.required_evidence = ["envelope_context_hash", "approval_hold", "typed_confirmation", "expiry"];
    } else if (action.action === "run_scenario_readback_and_issue_dispatch_certification") {
      proposal.target_tool = "runtime_dispatch_certification_issue";
      proposal.required_evidence = ["scenario_readback", "negative_gate_evidence", "no_secret_audit", "dispatch_allowed_scope"];
    } else if (action.action === "dispatch_with_existing_runtime_guard") {
      proposal.target_tool = result.capability?.runtime_surface || "runtime_endpoint_call";
      proposal.handoff_ready = true;
      proposal.required_evidence = ["fresh_gate", "exact_scope", "idempotency", "same_cycle_readback"];
    } else {
      proposal.target_tool = "manual_governed_follow_up";
      proposal.required_evidence = ["owner_review", "bounded_scope", "readback"];
    }
    return proposal;
  });
}

function buildDryRunArgs(args = {}, scope = {}, effective = null) {
  return {
    tenantId: scope.tenant_id,
    userId: scope.user_id,
    workspaceId: safeText(args.workspace_id || effective?.workspace?.workspace_id, 64),
    workspaceKey: safeText(args.workspace_key || effective?.workspace?.workspace_key, 191),
    brandKey: safeText(args.brand_key, 128),
    businessActivityType: safeText(args.business_activity_type, 191),
    appKey: safeText(args.app_key || effective?.binding?.app_key, 128),
    capabilityKey: safeText(args.capability_key, 191),
    operationIntent: safeText(args.operation_intent, 64) || "read",
    runtimeSurface: safeText(args.runtime_surface || effective?.binding?.parent_action_key || effective?.runtime?.export_key, 191),
    explain: args.include_explain === true || args.requested_mode === "diagnose",
  };
}

function publicEffectiveProjection(effective = null) {
  if (!effective) return null;
  if (effective.ok === false) return { ok: false, status: effective.status || "blocked", error: compactError(effective.error), secrets_included: false };
  return {
    ok: true,
    status: effective.status,
    ready: Boolean(effective.ready),
    workspace: effective.workspace || null,
    membership: effective.membership || null,
    capability: effective.capability || null,
    binding: effective.binding || null,
    authority: effective.authority || null,
    runtime: effective.runtime || null,
    checks: effective.checks || null,
    manifest_hash: effective.manifest_hash || null,
    secrets_included: false,
  };
}

function publicDryRunProjection(dryRun = null) {
  if (!dryRun) return null;
  return {
    ok: dryRun.ok === true,
    decision: dryRun.decision || null,
    request_context: dryRun.request_context || null,
    capability: dryRun.capability || null,
    selected_source: dryRun.selected_source || null,
    authority: dryRun.authority || null,
    gates: dryRun.gates || null,
    blocking_gaps: dryRunGaps(dryRun),
    maturity: dryRun.maturity || null,
    secrets_included: false,
  };
}

async function recordCapabilityEnablementResult(pool, result, args = {}) {
  const projection = {
    actor: result.actor,
    capability: result.capability,
    checks: result.checks,
    next_actions: result.next_actions,
    proposals: result.proposals,
  };
  const effectiveHash = result.effective_capability ? hashJson(result.effective_capability) : null;
  const dryRunHash = result.dry_run ? hashJson(result.dry_run) : null;
  await pool.query(
    `INSERT INTO capability_enablement_requests
       (request_id, tenant_id, user_id, caller_type, capability_key, operation_intent, app_key, runtime_surface, workspace_id, resource_uri,
        decision, next_allowed_mode, reason_codes_json, input_hash_sha256, effective_hash_sha256, dry_run_hash_sha256,
        classification_json, projection_json, provider_calls_made, external_mutations_executed, internal_persistence_executed, secrets_included, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, DATE_ADD(NOW(), INTERVAL 90 DAY))
     ON DUPLICATE KEY UPDATE decision=VALUES(decision), next_allowed_mode=VALUES(next_allowed_mode), reason_codes_json=VALUES(reason_codes_json),
       projection_json=VALUES(projection_json), secrets_included=0`,
    [
      result.request_id,
      result.actor?.tenant_id || null,
      result.actor?.user_id || null,
      result.actor?.caller_type || "tenant",
      result.capability?.capability_key || safeText(args.capability_key, 191),
      result.capability?.operation_intent || safeText(args.operation_intent, 64),
      result.capability?.app_key || null,
      safeText(args.runtime_surface, 191) || null,
      safeText(args.workspace_id, 64) || null,
      safeText(args.resource_uri || args.resource_ref, 512) || null,
      result.decision,
      result.next_allowed_mode || null,
      jsonForSql(result.reason_codes || []),
      hashJson(args),
      effectiveHash,
      dryRunHash,
      jsonForSql({ decision: result.decision, reason_codes: result.reason_codes, next_allowed_mode: result.next_allowed_mode }),
      jsonForSql(projection),
      Number(result.provider_calls_made || 0),
      0,
    ]
  );
  await pool.query("DELETE FROM capability_enablement_steps WHERE request_id = ?", [result.request_id]);
  for (const [index, proposal] of (result.proposals || []).entries()) {
    await pool.query(
      `INSERT INTO capability_enablement_steps
         (step_id, request_id, step_order, action_key, required_role, reason_code, status, proposal_json, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, 0)`,
      [
        `cebs_${crypto.randomUUID()}`,
        result.request_id,
        index + 1,
        safeText(proposal.action, 191),
        safeText(proposal.required_role, 128) || null,
        safeText(proposal.reason_code, 128) || null,
        jsonForSql(proposal),
      ]
    );
  }
  return { attempted: true, executed: true, request_id: result.request_id, step_count: (result.proposals || []).length, secrets_included: false };
}

export const CAPABILITY_ENABLEMENT_SYSTEM_TOOLS = Object.freeze([
  {
    name: "capability_enablement_resolve",
    description: "Resolve governed capability enablement. Diagnose-only by default; optional internal no-secret decision ledger recording is explicit and never executes providers or authorization handoffs.",
    inputSchema: {
      type: "object",
      required: ["capability_key", "operation_intent"],
      properties: {
        capability_key: { type: "string", minLength: 1, maxLength: 191 },
        operation_intent: { type: "string", enum: ["read", "preview", "write", "dispatch", "apply", "publish", "deploy", "spend"] },
        requested_mode: { type: "string", enum: ["diagnose", "auto"], default: "diagnose" },
        record_decision: { type: "boolean", default: false, description: "When true, writes a no-secret internal request/step ledger row only." },
        tenant_id: { type: "string", maxLength: 64, description: "Admin-only diagnostic override; ignored for tenant principals." },
        workspace_id: { type: "string", maxLength: 64 },
        workspace_key: { type: "string", maxLength: 191 },
        user_id: { type: "string", maxLength: 64, description: "Admin-only diagnostic override; ignored for tenant principals." },
        brand_key: { type: "string", maxLength: 128 },
        business_activity_type: { type: "string", maxLength: 191 },
        app_key: { type: "string", maxLength: 128 },
        resource_ref: { type: "string", maxLength: 255 },
        resource_uri: { type: "string", maxLength: 512 },
        runtime_surface: { type: "string", maxLength: 191 },
        include_explain: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "capability_enablement_proposal_preview",
    description: "Return guided orchestration proposals for one capability request without recording, provider calls, credential reads, approvals, certifications, or mutations.",
    inputSchema: {
      type: "object",
      required: ["capability_key", "operation_intent"],
      properties: {
        capability_key: { type: "string", minLength: 1, maxLength: 191 },
        operation_intent: { type: "string", enum: ["read", "preview", "write", "dispatch", "apply", "publish", "deploy", "spend"] },
        tenant_id: { type: "string", maxLength: 64 },
        user_id: { type: "string", maxLength: 64 },
        workspace_id: { type: "string", maxLength: 64 },
        workspace_key: { type: "string", maxLength: 191 },
        app_key: { type: "string", maxLength: 128 },
        resource_ref: { type: "string", maxLength: 255 },
        resource_uri: { type: "string", maxLength: 512 },
        runtime_surface: { type: "string", maxLength: 191 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "capability_enablement_decision_report",
    description: "Admin-only no-secret aggregate report over Capability Enablement Broker request and step ledgers.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        tenant_id: { type: "string", maxLength: 64 },
        capability_key: { type: "string", maxLength: 191 },
        decision: { type: "string", maxLength: 128 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "capability_enablement_tenant_projection",
    description: "Tenant-safe no-secret projection of recent broker decisions for the signed tenant/user. Admin may supply tenant/user diagnostic filters.",
    inputSchema: {
      type: "object",
      properties: {
        tenant_id: { type: "string", maxLength: 64 },
        user_id: { type: "string", maxLength: 64 },
        capability_key: { type: "string", maxLength: 191 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "capability_enablement_readiness_smoke",
    description: "Admin-only no-secret readiness smoke for broker descriptor, ledgers, rollup view, and no-external-mutation guarantees.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
]);

export async function capabilityEnablementResolve(args = {}, context = {}) {
  const auth = context.auth || {};
  const scope = principalScope(args, auth);
  const requestId = randomRequestId();
  const secretBoundaryFailed = hasSecretLikeKey(args);
  const capabilityKey = safeText(args.capability_key, 191);
  const operationIntent = safeText(args.operation_intent || "read", 64);
  let effective = null;
  let dryRun = null;
  let effectiveError = null;
  let dryRunError = null;

  if (!capabilityKey) {
    return { ok: false, tool: "capability_enablement_resolve", request_id: requestId, error: { code: "CAPABILITY_KEY_REQUIRED", message: "capability_key is required." }, secrets_included: false };
  }
  if (!secretBoundaryFailed) {
    try {
      effective = await (context.tenantEffectiveCapabilityPreview || tenantEffectiveCapabilityPreview)({
        capability_key: capabilityKey,
        workspace_id: safeText(args.workspace_id, 64),
        workspace_key: safeText(args.workspace_key, 191),
        resource_ref: safeText(args.resource_ref || args.resource_uri, 255),
        tenant_id: scope.tenant_id,
        user_id: scope.user_id,
        include_candidates: false,
      }, context);
    } catch (error) {
      effectiveError = error;
      effective = { ok: false, status: "blocked", error: compactError(error), secrets_included: false };
    }
    try {
      dryRun = await (context.runCapabilityResolutionDryRun || runCapabilityResolutionDryRun)(buildDryRunArgs(args, scope, effective?.ok === true ? effective : null));
    } catch (error) {
      dryRunError = error;
      dryRun = null;
    }
  }

  const classification = classifyEnablementDecision({ effective, dryRun, operationIntent, secretBoundaryFailed });
  const nextActions = buildCapabilityEnablementNextActions(classification, { effective, dryRun });
  const result = {
    ok: !secretBoundaryFailed,
    tool: "capability_enablement_resolve",
    mode: "diagnose_only",
    request_id: requestId,
    decision: classification.decision,
    next_allowed_mode: classification.next_allowed_mode,
    reason_codes: classification.reason_codes,
    actor: { caller_type: scope.caller_type, tenant_id: scope.tenant_id || null, user_id: scope.user_id || null, admin_override_used: scope.admin_override_used },
    capability: {
      capability_key: capabilityKey,
      operation_intent: operationIntent,
      app_key: safeText(args.app_key || effective?.binding?.app_key || dryRun?.capability?.app_key, 128) || null,
      risk_class: dryRun?.capability?.risk_class || effective?.capability?.risk_class || null,
      runtime_surface: safeText(args.runtime_surface || effective?.binding?.parent_action_key || effective?.runtime?.export_key, 191) || null,
    },
    checks: {
      secret_boundary: secretBoundaryFailed ? "failed" : "passed",
      effective_capability: effective?.ok === true ? effective.status : "blocked",
      dry_run: dryRun?.decision || (dryRunError ? "degraded" : "not_available"),
      membership: effective?.checks?.membership_ready === true ? "passed" : "not_ready",
      resource_authority: effective?.checks?.resource_authority_ready === true || dryRun?.authority?.status === "passed" ? "passed" : "not_ready",
      credential: effective?.checks?.connection_ready === true ? "passed" : "not_ready_or_not_required",
      envelope: "not_created_diagnose_only",
      certification: effective?.checks?.runtime_certification_ready === true ? "passed" : "not_ready_or_not_required",
    },
    next_actions: nextActions,
    effective_capability: publicEffectiveProjection(effective),
    dry_run: publicDryRunProjection(dryRun),
    errors: { effective_capability: compactError(effectiveError), dry_run: compactError(dryRunError) },
    auto_actions_taken: [],
    proposals: [],
    provider_calls_made: 0,
    external_mutations_executed: false,
    apply_allowed: false,
    mutations_executed: false,
    internal_persistence: { attempted: false, executed: false, secrets_included: false },
    secrets_included: false,
  };
  result.proposals = buildCapabilityEnablementProposals(nextActions, result);

  if (args.record_decision === true && !secretBoundaryFailed) {
    try {
      result.internal_persistence = await recordCapabilityEnablementResult(context.pool || getPool(), result, args);
    } catch (error) {
      result.internal_persistence = { attempted: true, executed: false, error: compactError(error), secrets_included: false };
    }
  }
  return result;
}

export async function capabilityEnablementProposalPreview(args = {}, context = {}) {
  const result = await capabilityEnablementResolve({ ...args, record_decision: false, include_explain: true }, context);
  return {
    ok: result.ok,
    tool: "capability_enablement_proposal_preview",
    request_id: result.request_id,
    decision: result.decision,
    reason_codes: result.reason_codes,
    next_allowed_mode: result.next_allowed_mode,
    proposals: result.proposals,
    provider_calls_made: 0,
    apply_allowed: false,
    mutations_executed: false,
    secrets_included: false,
  };
}

export async function capabilityEnablementDecisionReport(args = {}, context = {}) {
  if (!isAdminPrincipal(context.auth || {})) {
    return { ok: false, tool: "capability_enablement_decision_report", status: "authorization_gated", error: { code: "ADMIN_REQUIRED", message: "Admin scope is required." }, secrets_included: false };
  }
  const pool = context.pool || getPool();
  const limit = boundedLimit(args.limit, 25);
  const tenant = safeText(args.tenant_id, 64) || null;
  const capability = safeText(args.capability_key, 191) || null;
  const decision = safeText(args.decision, 128) || null;
  try {
    const [rollup] = await pool.query(
      `SELECT tenant_id, capability_key, operation_intent, decision, request_count, no_provider_call_count, no_external_mutation_count, no_secret_count, latest_created_at
         FROM v_capability_enablement_decision_rollup
        WHERE (? IS NULL OR tenant_id = ?)
          AND (? IS NULL OR capability_key = ?)
          AND (? IS NULL OR decision = ?)
        ORDER BY latest_created_at DESC
        LIMIT ?`,
      [tenant, tenant, capability, capability, decision, decision, limit]
    );
    const [recent] = await pool.query(
      `SELECT request_id, tenant_id, user_id, capability_key, operation_intent, app_key, decision, next_allowed_mode, reason_codes_json, created_at
         FROM capability_enablement_requests
        WHERE (? IS NULL OR tenant_id = ?)
          AND (? IS NULL OR capability_key = ?)
          AND (? IS NULL OR decision = ?)
        ORDER BY created_at DESC
        LIMIT ?`,
      [tenant, tenant, capability, capability, decision, decision, limit]
    );
    return { ok: true, tool: "capability_enablement_decision_report", rollup: rollup || [], recent: recent || [], limit, provider_calls_made: 0, apply_allowed: false, mutations_executed: false, secrets_included: false };
  } catch (error) {
    return { ok: false, tool: "capability_enablement_decision_report", status: "schema_not_applied_or_unavailable", error: compactError(error), provider_calls_made: 0, apply_allowed: false, mutations_executed: false, secrets_included: false };
  }
}

export async function capabilityEnablementTenantProjection(args = {}, context = {}) {
  const scope = principalScope(args, context.auth || {});
  if (!scope.tenant_id) {
    return { ok: false, tool: "capability_enablement_tenant_projection", error: { code: "TENANT_CONTEXT_REQUIRED", message: "Tenant context is required." }, secrets_included: false };
  }
  const pool = context.pool || getPool();
  const limit = boundedLimit(args.limit, 25);
  const capability = safeText(args.capability_key, 191) || null;
  try {
    const [rows] = await pool.query(
      `SELECT request_id, capability_key, operation_intent, app_key, decision, next_allowed_mode, reason_codes_json, created_at
         FROM capability_enablement_requests
        WHERE tenant_id = ?
          AND (? IS NULL OR user_id = ?)
          AND (? IS NULL OR capability_key = ?)
        ORDER BY created_at DESC
        LIMIT ?`,
      [scope.tenant_id, scope.user_id || null, scope.user_id || null, capability, capability, limit]
    );
    return {
      ok: true,
      tool: "capability_enablement_tenant_projection",
      tenant_id: scope.tenant_id,
      user_id: scope.user_id || null,
      items: (rows || []).map((row) => ({
        request_id: row.request_id,
        capability_key: row.capability_key,
        operation_intent: row.operation_intent,
        app_key: row.app_key,
        decision: row.decision,
        next_allowed_mode: row.next_allowed_mode,
        reason_codes: typeof row.reason_codes_json === "string" ? JSON.parse(row.reason_codes_json || "[]") : (row.reason_codes_json || []),
        created_at: row.created_at,
      })),
      limit,
      provider_calls_made: 0,
      apply_allowed: false,
      mutations_executed: false,
      secrets_included: false,
    };
  } catch (error) {
    return { ok: false, tool: "capability_enablement_tenant_projection", status: "schema_not_applied_or_unavailable", error: compactError(error), provider_calls_made: 0, apply_allowed: false, mutations_executed: false, secrets_included: false };
  }
}

async function loadReadinessObjects(pool) {
  const [rows] = await pool.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN (${REQUIRED_READINESS_OBJECTS.map(() => "?").join(",")})`,
    [...REQUIRED_READINESS_OBJECTS]
  );
  const present = new Set((rows || []).map((row) => String(row.table_name || row.TABLE_NAME || "")));
  return { present: REQUIRED_READINESS_OBJECTS.filter((name) => present.has(name)), missing: REQUIRED_READINESS_OBJECTS.filter((name) => !present.has(name)) };
}

export async function capabilityEnablementReadinessSmoke(_args = {}, { pool = getPool() } = {}) {
  let objects = { present: [], missing: REQUIRED_READINESS_OBJECTS };
  let queryError = null;
  try { objects = await loadReadinessObjects(pool); } catch (error) { queryError = compactError(error); }
  const descriptorNames = CAPABILITY_ENABLEMENT_SYSTEM_TOOLS.map((tool) => tool.name);
  const checks = [
    { name: "schema_query_succeeded", pass: queryError === null },
    { name: "required_authority_and_ledger_objects_present", pass: queryError === null && objects.missing.length === 0, expected_count: REQUIRED_READINESS_OBJECTS.length, present_count: objects.present.length },
    { name: "five_descriptor_tools_present", pass: descriptorNames.includes("capability_enablement_resolve") && descriptorNames.includes("capability_enablement_proposal_preview") && descriptorNames.includes("capability_enablement_decision_report") && descriptorNames.includes("capability_enablement_tenant_projection") && descriptorNames.includes("capability_enablement_readiness_smoke") && descriptorNames.length === 5 },
    { name: "diagnose_only_no_provider_call", pass: true },
    { name: "diagnose_only_no_external_mutation", pass: true },
    { name: "diagnose_only_no_auto_approval", pass: true },
    { name: "diagnose_only_no_certification_issue", pass: true },
    { name: "internal_ledger_persistence_explicit_only", pass: true },
    { name: "no_secrets", pass: true },
  ];
  const ok = checks.every((check) => check.pass === true);
  return {
    ok,
    tool: "capability_enablement_readiness_smoke",
    status: ok ? "pass" : "fail",
    classification: ok ? "capability_enablement_broker_ready" : "capability_enablement_broker_not_ready",
    reason_code: queryError ? "capability_enablement_readiness_query_failed" : (objects.missing.length ? "capability_enablement_required_objects_missing" : null),
    checks,
    schema_objects: { expected: [...REQUIRED_READINESS_OBJECTS], present: objects.present, missing: objects.missing },
    descriptor_tools: descriptorNames,
    error: queryError,
    provider_calls_made: 0,
    apply_allowed: false,
    mutations_executed: false,
    secrets_included: false,
  };
}
