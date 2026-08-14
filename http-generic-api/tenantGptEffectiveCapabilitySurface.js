const CONTRACT_CHAIN = Object.freeze([
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

const SECRET_KEY_PATTERN = /^(?:authorization|proxy_authorization|cookie|set_cookie|password|passwd|secret|client_secret|api_key|access_key|private_key|token|access_token|refresh_token|id_token|credential|credentials|raw_row|raw_rows)$/i;
const SECRET_KEY_FRAGMENT_PATTERN = /(?:^|_)(?:password|passwd|secret|client_secret|api_key|access_key|private_key|access_token|refresh_token|id_token|credential|credentials|authorization|cookie|raw_row|raw_rows)(?:_|$)/i;
const PUBLIC_IDENTITY_KEYS = Object.freeze([
  "tenant_id",
  "workspace_id",
  "brand_id",
  "business_activity_id",
  "principal_id",
  "principal_type",
  "context_hash",
  "context_revision",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function secretKey(key) {
  const normalized = String(key || "").trim();
  return SECRET_KEY_PATTERN.test(normalized) || SECRET_KEY_FRAGMENT_PATTERN.test(normalized);
}

function sanitizeString(value) {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) return "[redacted]";
  if (/^\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+\s*$/i.test(value)) return "[redacted]";
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
    return value
      .map((entry) => sanitizePublicValue(entry, seen))
      .filter((entry) => entry !== undefined);
  }

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (secretKey(key)) continue;
    const sanitized = sanitizePublicValue(entry, seen);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

function pick(source, keys) {
  if (!isPlainObject(source)) return null;
  const output = {};
  for (const key of keys) {
    if (source[key] !== undefined) output[key] = sanitizePublicValue(source[key]);
  }
  return output;
}

function projectIdentity(context) {
  const identity = {};
  for (const key of PUBLIC_IDENTITY_KEYS) {
    const value = context?.[key];
    if (value !== undefined && value !== null && value !== "") identity[key] = sanitizePublicValue(value);
  }
  return identity;
}

function normalizeBlocker(blocker, source) {
  if (typeof blocker === "string" && blocker.trim()) return { source, code: blocker.trim() };
  if (!isPlainObject(blocker)) return null;
  const projected = sanitizePublicValue({
    source,
    code: blocker.code || blocker.key || blocker.reason_code || "BLOCKED",
    category: blocker.category,
    message: blocker.public_message,
    remediation: blocker.public_remediation,
  });
  return projected.code ? projected : null;
}

function appendBlockers(target, source, values) {
  const entries = Array.isArray(values) ? values : values ? [values] : [];
  for (const entry of entries) {
    const blocker = normalizeBlocker(entry, source);
    if (blocker) target.push(blocker);
  }
}

function projectCapabilities(manifest) {
  const capabilities = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [];
  return capabilities.map((capability) => pick(capability, [
    "key",
    "capability_key",
    "name",
    "state",
    "available",
    "reason_code",
    "resource_type",
    "resource_id",
    "surface",
  ])).filter(Boolean);
}

function projectQuestionnaire(schema) {
  const questions = Array.isArray(schema?.questions) ? schema.questions : Array.isArray(schema) ? schema : [];
  return questions
    .filter((question) => isPlainObject(question))
    .filter((question) => question.public === true && question.sensitive !== true && question.internal !== true)
    .filter((question) => !secretKey(question.key || question.name || ""))
    .map((question) => sanitizePublicValue({
      key: question.key || question.name,
      label: question.label,
      description: question.description,
      type: question.type,
      required: question.required === true,
      options: question.options,
      validation: question.public_validation,
    }))
    .filter((question) => Boolean(question?.key));
}

function projectPlan(plan) {
  if (!plan) return null;
  const result = pick(plan, ["plan_id", "status", "effect", "approval_required", "readback_required", "revision"]);
  if (Array.isArray(plan.steps)) {
    result.steps = plan.steps.map((step) => pick(step, [
      "operation",
      "operation_id",
      "effect",
      "status",
      "requires_approval",
      "readback_required",
    ])).filter(Boolean);
  }
  return result;
}

function projectReadiness(readiness) {
  if (!readiness) return null;
  return sanitizePublicValue({
    ready: readiness.ready === true,
    checks: readiness.checks,
    evidence_revision: readiness.evidence_revision || readiness.revision,
    environment: readiness.environment,
    migrations_applied: readiness.migrations_applied,
    production_allowed: readiness.production_allowed,
  });
}

export function buildTenantGptEffectiveCapabilitySurface({
  context = null,
  capability_manifest = null,
  authority_preflight = null,
  plan = null,
  approval_or_delegation = null,
  final_authority = null,
  durable_execution = null,
  adapter = null,
  readback = null,
  readiness = null,
  questionnaire_schema = null,
  caller_context = null,
} = {}) {
  const blockers = [];

  if (!context) blockers.push({ source: "surface_contract", code: "CONTEXT_CONTRACT_MISSING" });
  if (!capability_manifest) blockers.push({ source: "surface_contract", code: "CAPABILITY_MANIFEST_MISSING" });
  if (!authority_preflight) blockers.push({ source: "surface_contract", code: "AUTHORITY_PREFLIGHT_MISSING" });
  if (!final_authority) blockers.push({ source: "surface_contract", code: "FINAL_AUTHORITY_MISSING" });
  if (!readiness) blockers.push({ source: "surface_contract", code: "READINESS_EVIDENCE_MISSING" });

  appendBlockers(blockers, "capability_manifest", capability_manifest?.blockers);
  appendBlockers(blockers, "authority_preflight", authority_preflight?.blockers || authority_preflight?.blocking_reasons);
  appendBlockers(blockers, "final_authority", final_authority?.blockers || final_authority?.blocking_reasons);
  appendBlockers(blockers, "readiness", readiness?.blocking_checks || readiness?.blockers);

  const preflightDecision = String(authority_preflight?.decision || authority_preflight?.status || "").trim().toLowerCase();
  const preflightDenied = authority_preflight?.allowed === false
    || ["deny", "denied", "blocked", "reject", "rejected"].includes(preflightDecision);
  if (authority_preflight && preflightDenied && !blockers.some((entry) => entry.source === "authority_preflight")) {
    blockers.push({ source: "authority_preflight", code: "AUTHORITY_PREFLIGHT_DENIED" });
  }

  if (final_authority && final_authority.allowed !== true && !blockers.some((entry) => entry.source === "final_authority")) {
    blockers.push({ source: "final_authority", code: "FINAL_AUTHORITY_DENIED" });
  }

  const readinessReady = readiness?.ready === true;
  if (readiness && readinessReady !== true && !blockers.some((entry) => entry.source === "readiness")) {
    blockers.push({ source: "readiness", code: "READINESS_NOT_READY" });
  }

  const projectedAuthorityDecision = final_authority
    ? sanitizePublicValue({
        decision: final_authority.decision,
        allowed: final_authority.allowed === true,
        approval_required: final_authority.approval_required === true,
        authority_revision: final_authority.authority_revision || final_authority.revision,
        expires_at: final_authority.expires_at,
      })
    : null;

  return {
    schema_version: 1,
    projection: "tenant_gpt_effective_capability_envelope",
    contract_chain: [...CONTRACT_CHAIN],
    authority_model: "projection_only",
    creates_authority: false,
    selects_connection: false,
    executes_provider: false,
    caller_identity_used_for_authority: false,
    identity: projectIdentity(context),
    capability_manifest: capability_manifest ? {
      ...pick(capability_manifest, ["revision", "manifest_revision", "generated_at", "expires_at", "context_hash"]),
      capabilities: projectCapabilities(capability_manifest),
    } : null,
    authority_preflight: pick(authority_preflight, [
      "preflight_id",
      "status",
      "decision",
      "allowed",
      "approval_required",
      "revision",
      "authority_revision",
    ]),
    plan: projectPlan(plan),
    approval_or_delegation: pick(approval_or_delegation, [
      "status",
      "approval_id",
      "delegation_id",
      "scope_revision",
      "expires_at",
    ]),
    final_authority: projectedAuthorityDecision,
    durable_execution: pick(durable_execution, [
      "execution_id",
      "status",
      "outcome",
      "unknown_outcome",
      "started_at",
      "completed_at",
    ]),
    adapter: pick(adapter, ["key", "adapter_key", "status", "revision"]),
    readback: pick(readback, [
      "status",
      "verified",
      "receipt_id",
      "evidence_revision",
      "readback_revision",
      "observed_at",
    ]),
    readiness: projectReadiness(readiness),
    questionnaire: {
      questions: projectQuestionnaire(questionnaire_schema),
      answers_persisted_by_surface: false,
    },
    blockers,
    surface_ready: blockers.length === 0,
    execution_grant_emitted: false,
    execution_credentials_emitted: false,
    public_projection_only: true,
    secrets_included: false,
    caller_context_observed: Boolean(caller_context),
  };
}

export const tenantGptEffectiveCapabilitySurfaceContractChain = CONTRACT_CHAIN;
