export const GOVERNED_EXECUTION_RUNTIME_COMPOSITION_VERSION = "governed-execution-runtime-composition-v1";

export const GOVERNED_EXECUTION_RUNTIME_CONTRACT_CHAIN = Object.freeze([
  "context_kernel",
  "capability_manifest",
  "authority_preflight",
  "plan",
  "approval_or_delegation",
  "final_authority",
  "durable_execution",
  "adapter",
  "readback",
  "surface_projection",
]);

const SECRET_KEY_PATTERN = /^(?:authorization|proxy_authorization|cookie|set_cookie|password|passwd|secret|client_secret|api_key|access_key|private_key|token|access_token|refresh_token|id_token|credential|credentials|raw_row|raw_rows)$/iu;
const SECRET_KEY_FRAGMENT_PATTERN = /(?:^|_)(?:password|passwd|secret|client_secret|api_key|access_key|private_key|access_token|refresh_token|id_token|credential|credentials|authorization|cookie|raw_row|raw_rows)(?:_|$)/iu;
const MUTATION_EFFECTS = new Set(["mutation", "write", "apply", "create", "update", "delete", "execute"]);
const BLOCKED_DECISIONS = new Set(["deny", "denied", "block", "blocked", "reject", "rejected", "failed", "forbidden"]);
const READY_STATES = new Set(["ready", "available", "verified", "validated", "approved", "pass", "passed", "not_required", "ready_for_review"]);
const BLOCKED_STATES = new Set(["blocked", "failed", "denied", "rejected", "stale", "expired", "invalid", "cancelled"]);

const REQUIRED_DEPENDENCIES = Object.freeze([
  "resolveContext",
  "compileCapabilityManifest",
  "resolveAuthorityPreflight",
  "compilePlan",
  "resolveApprovalOrDelegation",
  "resolveFinalAuthority",
  "resolveLifecycleReadiness",
  "resolveDurableExecutionReadiness",
  "resolveAdapterReadiness",
  "resolveReadbackReadiness",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function lower(value) {
  return String(value ?? "").trim().toLowerCase();
}

function secretKey(key) {
  const normalized = String(key || "").trim();
  return SECRET_KEY_PATTERN.test(normalized) || SECRET_KEY_FRAGMENT_PATTERN.test(normalized);
}

function sanitizeString(value) {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value)) return "[redacted]";
  if (/^\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+\s*$/iu.test(value)) return "[redacted]";
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (secretKey(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return value;
  }
}

function sanitizePublicValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (["number", "boolean"].includes(typeof value)) return value;
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePublicValue(entry, seen)).filter((entry) => entry !== undefined);
  }

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (secretKey(key)) continue;
    const sanitized = sanitizePublicValue(entry, seen);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

function blocker(source, code, details = {}) {
  return sanitizePublicValue({ source, code, ...details });
}

function appendStageBlockers(target, source, stage) {
  const entries = Array.isArray(stage?.blockers)
    ? stage.blockers
    : Array.isArray(stage?.blocking_reasons)
      ? stage.blocking_reasons
      : [];
  for (const entry of entries) {
    if (typeof entry === "string" && entry.trim()) {
      target.push(blocker(source, entry.trim()));
    } else if (isPlainObject(entry)) {
      target.push(blocker(source, entry.code || entry.reason_code || entry.key || "BLOCKED", {
        category: entry.category,
        public_message: entry.public_message,
      }));
    }
  }
}

function normalizeRequestedEffect(request = {}) {
  const raw = lower(request.requested_effect || request.effect || request.requested_mode || "read_only");
  if (["read", "readonly", "read-only", "preview", "query"].includes(raw)) return "read_only";
  if (MUTATION_EFFECTS.has(raw)) return "mutation";
  return raw || "read_only";
}

function publicOperationRequest(request = {}, requestedEffect) {
  return sanitizePublicValue({
    operation: request.operation,
    operation_id: request.operation_id,
    tool: request.tool,
    tool_key: request.tool_key,
    action_key: request.action_key,
    intent_key: request.intent_key,
    capability_key: request.capability_key,
    resource_type: request.resource_type,
    resource_id: request.resource_id,
    runtime_surface: request.runtime_surface,
    requested_effect: requestedEffect,
  });
}

function stageStatus(stage) {
  return lower(stage?.status || stage?.readiness_status || stage?.decision || stage?.state);
}

function explicitlyBlocked(stage) {
  if (!stage) return true;
  if (stage.allowed === false || stage.ready === false || stage.available === false || stage.valid === false) return true;
  const status = stageStatus(stage);
  return BLOCKED_STATES.has(status) || BLOCKED_DECISIONS.has(status);
}

function explicitlyReady(stage) {
  if (!stage) return false;
  if (stage.allowed === true || stage.ready === true || stage.available === true || stage.valid === true || stage.verified === true) return true;
  return READY_STATES.has(stageStatus(stage));
}

function unsafeEvidence(stage) {
  if (!stage) return [];
  const checks = [
    ["provider_called", "PROVIDER_CALL_OBSERVED"],
    ["provider_calls", "PROVIDER_CALL_OBSERVED"],
    ["external_write", "EXTERNAL_WRITE_OBSERVED"],
    ["external_writes", "EXTERNAL_WRITE_OBSERVED"],
    ["database_mutated", "DATABASE_MUTATION_OBSERVED"],
    ["execution_performed", "EXECUTION_SIDE_EFFECT_OBSERVED"],
    ["credential_payload_read", "CREDENTIAL_PAYLOAD_READ_OBSERVED"],
    ["credential_payload_reads", "CREDENTIAL_PAYLOAD_READ_OBSERVED"],
    ["secrets_included", "SECRET_INCLUSION_OBSERVED"],
  ];
  return [...new Set(checks.filter(([key]) => stage[key] === true).map(([, code]) => code))];
}

function contextHash(stage) {
  return String(stage?.context_hash || stage?.contextHash || "").trim() || null;
}

function assertContextHashBinding(blockers, source, context, stage) {
  const expected = contextHash(context);
  const observed = contextHash(stage);
  if (expected && observed && expected !== observed) {
    blockers.push(blocker(source, "CONTEXT_HASH_MISMATCH", {
      expected_context_hash: expected,
      observed_context_hash: observed,
    }));
  }
}

function stageSafe(blockers, source, stage) {
  appendStageBlockers(blockers, source, stage);
  for (const code of unsafeEvidence(stage)) blockers.push(blocker(source, code));
}

async function invokeStage({ dependencies, dependencyName, source, payload, blockers, trace }) {
  const fn = dependencies?.[dependencyName];
  if (typeof fn !== "function") {
    blockers.push(blocker(source, "COMPOSITION_DEPENDENCY_MISSING", { dependency: dependencyName }));
    return null;
  }
  try {
    const value = await fn(payload);
    trace.push(source);
    if (!value || typeof value !== "object") {
      blockers.push(blocker(source, "COMPOSITION_STAGE_RESULT_MISSING"));
      return null;
    }
    const projected = sanitizePublicValue(value);
    stageSafe(blockers, source, value);
    return projected;
  } catch (error) {
    trace.push(source);
    blockers.push(blocker(source, "COMPOSITION_STAGE_RESOLUTION_FAILED", {
      reason_code: String(error?.code || "STAGE_ERROR").slice(0, 96),
    }));
    return null;
  }
}

function dependencyInventory(dependencies) {
  return Object.fromEntries(REQUIRED_DEPENDENCIES.map((name) => [name, typeof dependencies?.[name] === "function"]));
}

export async function resolveGovernedExecutionRuntimeComposition({ request = {}, dependencies = {} } = {}) {
  const requestedEffect = normalizeRequestedEffect(request);
  const operationRequest = publicOperationRequest(request, requestedEffect);
  const blockers = [];
  const trace = [];
  const dependencyChecks = dependencyInventory(dependencies);

  for (const [name, present] of Object.entries(dependencyChecks)) {
    if (!present) blockers.push(blocker("composition", "COMPOSITION_DEPENDENCY_MISSING", { dependency: name }));
  }

  const context = await invokeStage({
    dependencies,
    dependencyName: "resolveContext",
    source: "context_kernel",
    payload: { request },
    blockers,
    trace,
  });

  const capabilityManifest = context ? await invokeStage({
    dependencies,
    dependencyName: "compileCapabilityManifest",
    source: "capability_manifest",
    payload: { request: operationRequest, context },
    blockers,
    trace,
  }) : null;
  if (context && capabilityManifest) assertContextHashBinding(blockers, "capability_manifest", context, capabilityManifest);

  const authorityPreflight = context && capabilityManifest ? await invokeStage({
    dependencies,
    dependencyName: "resolveAuthorityPreflight",
    source: "authority_preflight",
    payload: { request: operationRequest, context, capability_manifest: capabilityManifest },
    blockers,
    trace,
  }) : null;
  if (context && authorityPreflight) assertContextHashBinding(blockers, "authority_preflight", context, authorityPreflight);
  if (authorityPreflight && authorityPreflight.allowed !== true) {
    blockers.push(blocker("authority_preflight", explicitlyBlocked(authorityPreflight)
      ? "AUTHORITY_PREFLIGHT_DENIED"
      : "AUTHORITY_PREFLIGHT_NOT_EXPLICITLY_ALLOWED"));
  }

  const plan = context && capabilityManifest && authorityPreflight?.allowed === true ? await invokeStage({
    dependencies,
    dependencyName: "compilePlan",
    source: "plan",
    payload: {
      request: operationRequest,
      context,
      capability_manifest: capabilityManifest,
      authority_preflight: authorityPreflight,
    },
    blockers,
    trace,
  }) : null;
  if (context && plan) assertContextHashBinding(blockers, "plan", context, plan);
  if (plan && explicitlyBlocked(plan)) blockers.push(blocker("plan", "PLAN_NOT_READY"));

  const approvalOrDelegation = plan ? await invokeStage({
    dependencies,
    dependencyName: "resolveApprovalOrDelegation",
    source: "approval_or_delegation",
    payload: {
      request: operationRequest,
      context,
      capability_manifest: capabilityManifest,
      authority_preflight: authorityPreflight,
      plan,
    },
    blockers,
    trace,
  }) : null;
  if (context && approvalOrDelegation) assertContextHashBinding(blockers, "approval_or_delegation", context, approvalOrDelegation);

  if (requestedEffect === "mutation") {
    blockers.push(blocker("composition", "TRACK_A_MUTATION_CUTOVER_NOT_AUTHORIZED"));
    if (!approvalOrDelegation || !explicitlyReady(approvalOrDelegation)) {
      blockers.push(blocker("approval_or_delegation", "APPROVAL_OR_DELEGATION_NOT_READY"));
    }
  } else if (approvalOrDelegation && explicitlyBlocked(approvalOrDelegation)) {
    blockers.push(blocker("approval_or_delegation", "APPROVAL_OR_DELEGATION_BLOCKED"));
  }

  const finalAuthority = plan && approvalOrDelegation ? await invokeStage({
    dependencies,
    dependencyName: "resolveFinalAuthority",
    source: "final_authority",
    payload: {
      request: operationRequest,
      context,
      capability_manifest: capabilityManifest,
      authority_preflight: authorityPreflight,
      plan,
      approval_or_delegation: approvalOrDelegation,
    },
    blockers,
    trace,
  }) : null;
  if (context && finalAuthority) assertContextHashBinding(blockers, "final_authority", context, finalAuthority);
  if (finalAuthority) {
    const shadowAuthority = finalAuthority.authoritative !== true
      || lower(finalAuthority.enforcement_mode) === "shadow_only"
      || finalAuthority.legacy_runtime_authoritative === true;
    if (shadowAuthority) blockers.push(blocker("final_authority", "FINAL_AUTHORITY_NOT_AUTHORITATIVE"));
    if (finalAuthority.allowed !== true) blockers.push(blocker("final_authority", "FINAL_AUTHORITY_DENIED"));
  }

  const lifecycleReadiness = finalAuthority ? await invokeStage({
    dependencies,
    dependencyName: "resolveLifecycleReadiness",
    source: "track_b_readiness",
    payload: {
      request: operationRequest,
      context,
      plan,
      final_authority: finalAuthority,
    },
    blockers,
    trace,
  }) : null;
  if (lifecycleReadiness && !explicitlyReady(lifecycleReadiness)) {
    blockers.push(blocker("track_b_readiness", "TRACK_B_READINESS_BLOCKED"));
  }
  if (requestedEffect === "mutation" && lifecycleReadiness?.runtime_consumer_enabled !== true) {
    blockers.push(blocker("track_b_readiness", "TRACK_B_RUNTIME_CONSUMER_DISABLED"));
  }

  const authorityReady = finalAuthority?.authoritative === true
    && finalAuthority?.allowed === true
    && lower(finalAuthority?.enforcement_mode) !== "shadow_only"
    && finalAuthority?.legacy_runtime_authoritative !== true;
  const preExecutionReady = requestedEffect === "read_only"
    && authorityPreflight?.allowed === true
    && plan
    && !explicitlyBlocked(plan)
    && authorityReady
    && explicitlyReady(lifecycleReadiness);

  const durableExecution = preExecutionReady ? await invokeStage({
    dependencies,
    dependencyName: "resolveDurableExecutionReadiness",
    source: "durable_execution",
    payload: {
      request: operationRequest,
      context,
      capability_manifest: capabilityManifest,
      authority_preflight: authorityPreflight,
      plan,
      approval_or_delegation: approvalOrDelegation,
      final_authority: finalAuthority,
      lifecycle_readiness: lifecycleReadiness,
    },
    blockers,
    trace,
  }) : null;
  if (durableExecution && !explicitlyReady(durableExecution)) {
    blockers.push(blocker("durable_execution", "DURABLE_EXECUTION_NOT_READY"));
  }

  const adapter = durableExecution && explicitlyReady(durableExecution) ? await invokeStage({
    dependencies,
    dependencyName: "resolveAdapterReadiness",
    source: "adapter",
    payload: {
      request: operationRequest,
      context,
      plan,
      final_authority: finalAuthority,
      durable_execution: durableExecution,
    },
    blockers,
    trace,
  }) : null;
  if (adapter && !explicitlyReady(adapter)) blockers.push(blocker("adapter", "ADAPTER_NOT_READY"));

  const readback = adapter && explicitlyReady(adapter) ? await invokeStage({
    dependencies,
    dependencyName: "resolveReadbackReadiness",
    source: "readback",
    payload: {
      request: operationRequest,
      context,
      plan,
      final_authority: finalAuthority,
      durable_execution: durableExecution,
      adapter,
    },
    blockers,
    trace,
  }) : null;
  if (readback && !explicitlyReady(readback)) blockers.push(blocker("readback", "READBACK_NOT_READY"));

  const uniqueBlockers = [];
  const seenBlockers = new Set();
  for (const item of blockers) {
    const key = `${item?.source || "unknown"}:${item?.code || "BLOCKED"}:${item?.dependency || ""}`;
    if (!seenBlockers.has(key)) {
      seenBlockers.add(key);
      uniqueBlockers.push(item);
    }
  }

  const surfaceReady = requestedEffect === "read_only"
    && uniqueBlockers.length === 0
    && explicitlyReady(durableExecution)
    && explicitlyReady(adapter)
    && explicitlyReady(readback);

  return Object.freeze({
    schema_version: 1,
    contract: GOVERNED_EXECUTION_RUNTIME_COMPOSITION_VERSION,
    contract_chain: [...GOVERNED_EXECUTION_RUNTIME_CONTRACT_CHAIN],
    requested_effect: requestedEffect,
    composition_mode: "read_only_authoritative_resolution",
    creates_authority: false,
    selects_connection: false,
    executes_provider: false,
    execution_performed: false,
    mutation_cutover_authorized: false,
    caller_identity_used_for_authority: false,
    dependency_checks: dependencyChecks,
    stage_trace: trace,
    context,
    capability_manifest: capabilityManifest,
    authority_preflight: authorityPreflight,
    plan,
    approval_or_delegation: approvalOrDelegation,
    final_authority: finalAuthority,
    lifecycle_readiness: lifecycleReadiness,
    durable_execution: durableExecution,
    adapter,
    readback,
    readiness: {
      ready: surfaceReady,
      checks: {
        context: Boolean(context),
        capability_manifest: Boolean(capabilityManifest),
        authority_preflight: authorityPreflight?.allowed === true,
        plan: Boolean(plan) && !explicitlyBlocked(plan),
        approval_or_delegation: Boolean(approvalOrDelegation) && !explicitlyBlocked(approvalOrDelegation),
        final_authority: authorityReady,
        track_b_readiness: explicitlyReady(lifecycleReadiness),
        durable_execution: explicitlyReady(durableExecution),
        adapter: explicitlyReady(adapter),
        readback: explicitlyReady(readback),
      },
      blocking_checks: uniqueBlockers,
      track_b: lifecycleReadiness,
      runtime_mutation_enabled: false,
      provider_execution_enabled: false,
      secrets_included: false,
    },
    blockers: uniqueBlockers,
    surface_ready: surfaceReady,
    secrets_included: false,
  });
}

export function createGovernedExecutionRuntimeResolver(dependencies = {}) {
  return async function resolveGovernedExecutionRuntime(request = {}) {
    return resolveGovernedExecutionRuntimeComposition({ request, dependencies });
  };
}
