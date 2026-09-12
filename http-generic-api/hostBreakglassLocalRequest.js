import { createHash } from "node:crypto";
import { readHostBreakglassCatalog } from "./hostBreakglassCatalog.js";

const SHA40_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9._:-]{1,160}$/u;
const ROLE_KEYS = new Set(["runtime", "governance", "runtime_persistence"]);
const SCOPE_ACTIONS = Object.freeze({
  "database.access_repair": new Set(["plan", "dry_run", "apply_grants"]),
  "database.empty_rebuild": new Set(["plan", "dry_run", "apply_migration"]),
});
const REQUEST_KEYS = Object.freeze([
  "contract",
  "environment_key",
  "operation_key",
  "runbook_key",
  "action",
  "expected_sha",
  "target_source",
  "target_key",
  "migration",
  "confirmation",
  "correlation_id",
  "execution_ticket_id",
  "execution_ticket_hash",
  "grant_binding_hash",
  "authority_plan_hash",
  "role_selection_proof",
  "plan_sha256",
  "secrets_included",
  "request_sha256",
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function fail(code, message) {
  throw Object.assign(new Error(message), { code, status: 409 });
}

function normalizedNullable(value) {
  return value == null || String(value).trim() === "" ? null : String(value).trim();
}

function normalizeRoleSelectionProof(value, { required = false } = {}) {
  if (value == null && !required) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("host_breakglass_local_request_role_proof_invalid", "Verified selective rebuild requires a bounded role-selection proof object.");
  const selectedRoles = Array.isArray(value.selected_roles) ? [...new Set(value.selected_roles.map((role) => String(role).trim()))] : [];
  if (!selectedRoles.length || selectedRoles.some((role) => !ROLE_KEYS.has(role))) fail("host_breakglass_local_request_role_proof_invalid", "Role-selection proof contains an invalid or empty selected role set.");
  const roleFingerprints = value.role_object_count_fingerprints && typeof value.role_object_count_fingerprints === "object" && !Array.isArray(value.role_object_count_fingerprints)
    ? value.role_object_count_fingerprints
    : {};
  if (
    value.source !== "durable_full_inspection"
    || !SAFE_ID_RE.test(String(value.inspection_run_id || ""))
    || !SHA40_RE.test(String(value.expected_sha || ""))
    || !SHA256_RE.test(String(value.inspection_evidence_hash || ""))
    || !SHA256_RE.test(String(value.composite_target_fingerprint || ""))
    || !SHA256_RE.test(String(value.selection_hash || ""))
    || !Array.isArray(value.finding_ids)
    || value.finding_ids.length !== selectedRoles.length
    || selectedRoles.some((role) => !SHA256_RE.test(String(roleFingerprints[role] || "")))
  ) fail("host_breakglass_local_request_role_proof_invalid", "Role-selection proof is incomplete or not derived from durable full inspection.");
  return structuredClone(value);
}

function resolveLocalRequestBoundary() {
  const catalog = readHostBreakglassCatalog();
  const matchingEnvironments = Object.entries(catalog?.environments || {}).filter(([, candidate]) => (
    candidate?.environment === "staging"
    && candidate?.runtime === "docker_compose"
    && candidate?.execution_transport === "local_cli"
    && candidate?.github_workflow_dispatch_allowed === false
    && candidate?.hostinger_access_allowed === false
  ));
  if (matchingEnvironments.length !== 1) {
    fail("host_breakglass_local_request_catalog_scope_invalid", "Canonical Host Breakglass catalog must expose exactly one local Staging environment.");
  }
  const [environmentKey, environment] = matchingEnvironments[0];
  const requiredScopes = [
    { operation_key: "database.repair", runbook_key: "database.access_repair" },
    { operation_key: "database.rebuild_empty", runbook_key: "database.empty_rebuild" },
  ];
  const scopes = {};
  for (const required of requiredScopes) {
    const operation = (catalog?.operations || []).find((candidate) => (
      candidate?.key === required.operation_key
      && Array.isArray(candidate.allowed_runbooks)
      && candidate.allowed_runbooks.includes(required.runbook_key)
      && Array.isArray(candidate.target_sources)
      && candidate.target_sources.includes(environment.role_target_source)
    ));
    if (!operation) fail("host_breakglass_local_request_catalog_runbook_invalid", `Canonical Host Breakglass catalog does not authorize Staging ${required.runbook_key}.`);
    scopes[required.runbook_key] = Object.freeze({ operation_key: operation.key, runbook_key: required.runbook_key, allowed_actions: SCOPE_ACTIONS[required.runbook_key] });
  }
  return Object.freeze({
    contract: "mad4b.host-breakglass-local-request.v2",
    environment_key: environmentKey,
    target_source: environment.role_target_source,
    scopes: Object.freeze(scopes),
  });
}

const LOCAL_REQUEST_BOUNDARY = resolveLocalRequestBoundary();

function scopeFor(plan = {}) {
  const scope = LOCAL_REQUEST_BOUNDARY.scopes[plan.runbook_key];
  if (!scope || plan.operation_key !== scope.operation_key) fail("host_breakglass_local_request_runbook_denied", "Verified local requests are restricted to canonical Staging access-repair or rebuild-empty runbooks.");
  if (!scope.allowed_actions?.has(plan.action)) fail("host_breakglass_local_request_action_denied", "The requested Host Breakglass action is not supported by the verified local handoff.");
  return scope;
}

function baseRequestFromPlan(plan = {}) {
  if (plan.environment_key !== LOCAL_REQUEST_BOUNDARY.environment_key) fail("host_breakglass_local_request_environment_denied", "Verified local requests are restricted to Staging Windows/Docker.");
  const scope = scopeFor(plan);
  if (plan.target_source !== LOCAL_REQUEST_BOUNDARY.target_source) fail("host_breakglass_local_request_target_source_denied", "Verified local execution must use the canonical Staging local role source.");
  if (!SHA40_RE.test(String(plan.expected_sha || ""))) fail("host_breakglass_local_request_sha_invalid", "The verified local request requires a full exact source SHA.");
  if (!SHA256_RE.test(String(plan.plan_sha256 || ""))) fail("host_breakglass_local_request_plan_hash_invalid", "The verified local request requires the canonical transport plan_sha256.");
  if (!SAFE_ID_RE.test(String(plan.correlation_id || ""))) fail("host_breakglass_local_request_correlation_invalid", "The verified local request requires a bounded correlation_id.");
  if (!SAFE_ID_RE.test(String(plan.target_key || ""))) fail("host_breakglass_local_request_target_invalid", "The verified local request requires a bounded Staging target key.");
  const rebuildApply = scope.runbook_key === "database.empty_rebuild" && plan.action === "apply_migration";
  const roleSelectionProof = normalizeRoleSelectionProof(plan.role_selection_proof, { required: rebuildApply });
  if (roleSelectionProof && roleSelectionProof.expected_sha !== plan.expected_sha) fail("host_breakglass_local_request_role_proof_sha_mismatch", "Role-selection proof SHA does not match the verified local plan.");
  const authorityPlanHash = normalizedNullable(plan.authority_plan_hash);
  if (rebuildApply && !SHA256_RE.test(String(authorityPlanHash || ""))) fail("host_breakglass_local_request_authority_plan_hash_invalid", "Selective rebuild handoff requires the server-issued authority_plan_hash separate from transport plan_sha256.");

  return {
    contract: LOCAL_REQUEST_BOUNDARY.contract,
    environment_key: LOCAL_REQUEST_BOUNDARY.environment_key,
    operation_key: scope.operation_key,
    runbook_key: scope.runbook_key,
    action: plan.action,
    expected_sha: plan.expected_sha,
    target_source: LOCAL_REQUEST_BOUNDARY.target_source,
    target_key: plan.target_key,
    migration: normalizedNullable(plan.migration),
    confirmation: normalizedNullable(plan.confirmation),
    correlation_id: plan.correlation_id,
    execution_ticket_id: normalizedNullable(plan.execution_ticket_id),
    execution_ticket_hash: normalizedNullable(plan.execution_ticket_hash),
    grant_binding_hash: normalizedNullable(plan.grant_binding_hash),
    authority_plan_hash: authorityPlanHash,
    role_selection_proof: roleSelectionProof,
    plan_sha256: plan.plan_sha256,
    secrets_included: false,
  };
}

export function buildVerifiedHostBreakglassLocalRequest(plan = {}) {
  const base = baseRequestFromPlan(plan);
  return Object.freeze({ ...base, request_sha256: digest(base) });
}

export function verifyHostBreakglassLocalRequest(request = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    fail("host_breakglass_local_request_invalid", "Verified local request must be a JSON object.");
  }
  const unexpected = Object.keys(request).filter((key) => !REQUEST_KEYS.includes(key));
  const missing = REQUEST_KEYS.filter((key) => !Object.hasOwn(request, key));
  if (unexpected.length || missing.length) {
    fail("host_breakglass_local_request_shape_invalid", `Verified local request has invalid fields; unexpected=${unexpected.join(",") || "none"} missing=${missing.join(",") || "none"}.`);
  }
  if (request.contract !== LOCAL_REQUEST_BOUNDARY.contract || request.secrets_included !== false) {
    fail("host_breakglass_local_request_contract_invalid", "Verified local request contract is invalid.");
  }
  if (request.environment_key !== LOCAL_REQUEST_BOUNDARY.environment_key || request.target_source !== LOCAL_REQUEST_BOUNDARY.target_source) {
    fail("host_breakglass_local_request_scope_invalid", "Verified local request escaped the canonical Staging local scope.");
  }
  const scope = scopeFor(request);
  if (!SHA40_RE.test(String(request.expected_sha || "")) || !SHA256_RE.test(String(request.plan_sha256 || "")) || !SHA256_RE.test(String(request.request_sha256 || ""))) {
    fail("host_breakglass_local_request_hash_invalid", "Verified local request hashes are invalid.");
  }
  if (!SAFE_ID_RE.test(String(request.correlation_id || "")) || !SAFE_ID_RE.test(String(request.target_key || ""))) {
    fail("host_breakglass_local_request_identity_invalid", "Verified local request identity is invalid.");
  }
  const rebuildApply = scope.runbook_key === "database.empty_rebuild" && request.action === "apply_migration";
  const roleSelectionProof = normalizeRoleSelectionProof(request.role_selection_proof, { required: rebuildApply });
  if (roleSelectionProof && roleSelectionProof.expected_sha !== request.expected_sha) fail("host_breakglass_local_request_role_proof_sha_mismatch", "Role-selection proof SHA does not match verified request SHA.");
  if (rebuildApply && !SHA256_RE.test(String(request.authority_plan_hash || ""))) fail("host_breakglass_local_request_authority_plan_hash_invalid", "Selective rebuild request is missing the server-issued authority_plan_hash.");
  const base = Object.fromEntries(Object.entries(request).filter(([key]) => key !== "request_sha256"));
  if (digest(base) !== request.request_sha256) {
    fail("host_breakglass_local_request_digest_mismatch", "Verified local request content does not match request_sha256.");
  }

  return Object.freeze({
    environment_key: request.environment_key,
    operation_key: request.operation_key,
    runbook_key: request.runbook_key,
    action: request.action,
    expected_sha: request.expected_sha,
    target_source: request.target_source,
    target_key: request.target_key,
    migration: request.migration,
    confirmation: request.confirmation,
    correlation_id: request.correlation_id,
    execution_ticket_id: request.execution_ticket_id,
    execution_ticket_hash: request.execution_ticket_hash,
    grant_binding_hash: request.grant_binding_hash,
    authority_plan_hash: request.authority_plan_hash,
    role_selection_proof: roleSelectionProof,
  });
}

export const __hostBreakglassLocalRequestTest = Object.freeze({ digest, resolveLocalRequestBoundary, normalizeRoleSelectionProof });
