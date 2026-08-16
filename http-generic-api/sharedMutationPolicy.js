const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const WRITE_EFFECT_CLASSES = new Set(["internal_write", "external_write", "destructive"]);

function normalizeScopes(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/\s+/u);
  return [...new Set(raw.map((scope) => String(scope || "").trim()).filter(Boolean))];
}

function operationKey({ method, path, operationId } = {}) {
  return String(operationId || `${String(method || "").toUpperCase()} ${path || ""}`).trim().slice(0, 256);
}

export function isMutationMethod(method) {
  return MUTATION_METHODS.has(String(method || "").toUpperCase());
}

export function classifySharedMutationEffect(method, path) {
  const normalizedMethod = String(method || "").toUpperCase();
  if (!isMutationMethod(normalizedMethod)) return "read_only";
  if (normalizedMethod === "DELETE" || /(?:restore|transition|decide|apply|install|rotate|revoke|destroy|remove)/iu.test(String(path || ""))) return "destructive";
  return "internal_write";
}

export function evaluateSharedMutationPolicyDecision({
  transport,
  method,
  path,
  operationId,
  effectClass = classifySharedMutationEffect(method, path),
  requiredScope = null,
  tokenScopes = [],
  resourceAuthority = false,
  operationEligible = false,
  approvalSatisfied = false,
  capabilitySatisfied = false,
  leaseActive = false,
  environment = "staging",
  governance = null,
  operationPolicy = null,
} = {}) {
  const scopeKey = String(requiredScope || "").trim() || null;
  const scope = scopeKey ? (governance?.write_scopes || []).find((candidate) => candidate.scope_key === scopeKey) : null;
  const tokenScopeSet = new Set(normalizeScopes(tokenScopes));
  const checks = [
    { key: "operation_registry", ok: Boolean(operationPolicy), detail: operationPolicy?.policy_status || "unregistered_operation" },
    { key: "shared_policy_registered", ok: Boolean(scopeKey && scope && WRITE_EFFECT_CLASSES.has(String(scope.effect_class || ""))), detail: scopeKey || "unbound_operation" },
    { key: "inventory", ok: governance?.inventory_ready === true, detail: governance?.inventory_ready === true ? "ready" : "blocked" },
    { key: "write_scope_enabled", ok: governance?.activation_ready === true && String(scope?.status || "") !== "shadow", detail: scope?.status || "shadow" },
    { key: "token_scope", ok: Boolean(scopeKey && tokenScopeSet.has(scopeKey)), detail: scopeKey || "unregistered_operation" },
    { key: "resource_authority", ok: resourceAuthority === true, detail: resourceAuthority ? "bound" : "unbound" },
    { key: "operation_eligibility", ok: operationEligible === true, detail: operationEligible ? "eligible" : "unresolved" },
    { key: "approval", ok: approvalSatisfied === true, detail: approvalSatisfied ? "satisfied" : "required" },
    { key: "capability", ok: capabilitySatisfied === true, detail: capabilitySatisfied ? "satisfied" : "missing" },
    { key: "lease", ok: leaseActive === true, detail: leaseActive ? "active" : "expired" },
    { key: "environment", ok: environment === "staging" && governance?.environment === "staging", detail: environment },
  ];
  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    code: failed.length ? "SHARED_MUTATION_AUTHORIZATION_DENIED" : "SHARED_MUTATION_AUTHORIZATION_ALLOWED",
    transport: String(transport || "unknown"),
    operation_key: operationKey({ method, path, operationId }),
    method: String(method || "").toUpperCase(),
    path: String(path || ""),
    effect_class: effectClass,
    required_scope: scopeKey,
    operation_policy: operationPolicy || null,
    decision_path: checks,
    failed_checks: failed.map((check) => check.key),
    governance: governance || null,
    provider_mutation_allowed: false,
    production_allowed: false,
    readback_required: true,
    secrets_included: false,
  };
}

export function buildOpenApiMutationGovernanceDecision(input = {}) {
  const governance = input.governance || null;
  return evaluateSharedMutationPolicyDecision({
    ...input,
    transport: "openapi",
    governance,
  });
}

export { operationKey };
