import { createHash } from "node:crypto";
import { readHostBreakglassCatalog } from "./hostBreakglassCatalog.js";

const SHA40_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9._:-]{1,160}$/u;
const ALLOWED_ACTIONS = new Set(["plan", "dry_run", "apply_grants"]);
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
  const operation = (catalog?.operations || []).find((candidate) => (
    candidate?.key === "database.repair"
    && Array.isArray(candidate.allowed_runbooks)
    && candidate.allowed_runbooks.includes("database.access_repair")
    && Array.isArray(candidate.target_sources)
    && candidate.target_sources.includes(environment.role_target_source)
  ));
  if (!operation) {
    fail("host_breakglass_local_request_catalog_runbook_invalid", "Canonical Host Breakglass catalog does not authorize Staging database.access_repair.");
  }
  return Object.freeze({
    contract: "mad4b.host-breakglass-local-request.v1",
    environment_key: environmentKey,
    operation_key: operation.key,
    runbook_key: "database.access_repair",
    target_source: environment.role_target_source,
  });
}

const LOCAL_REQUEST_BOUNDARY = resolveLocalRequestBoundary();

function baseRequestFromPlan(plan = {}) {
  if (plan.environment_key !== LOCAL_REQUEST_BOUNDARY.environment_key) fail("host_breakglass_local_request_environment_denied", "Verified local requests are restricted to Staging Windows/Docker.");
  if (plan.operation_key !== LOCAL_REQUEST_BOUNDARY.operation_key || plan.runbook_key !== LOCAL_REQUEST_BOUNDARY.runbook_key) fail("host_breakglass_local_request_runbook_denied", "Verified local requests are restricted to database.access_repair.");
  if (!ALLOWED_ACTIONS.has(plan.action)) fail("host_breakglass_local_request_action_denied", "The requested Host Breakglass action is not supported by the verified local handoff.");
  if (plan.target_source !== LOCAL_REQUEST_BOUNDARY.target_source) fail("host_breakglass_local_request_target_source_denied", "Verified local access repair must use the canonical Staging local role source.");
  if (!SHA40_RE.test(String(plan.expected_sha || ""))) fail("host_breakglass_local_request_sha_invalid", "The verified local request requires a full exact source SHA.");
  if (!SHA256_RE.test(String(plan.plan_sha256 || ""))) fail("host_breakglass_local_request_plan_hash_invalid", "The verified local request requires the canonical plan_sha256.");
  if (!SAFE_ID_RE.test(String(plan.correlation_id || ""))) fail("host_breakglass_local_request_correlation_invalid", "The verified local request requires a bounded correlation_id.");
  if (!SAFE_ID_RE.test(String(plan.target_key || ""))) fail("host_breakglass_local_request_target_invalid", "The verified local request requires a bounded Staging target key.");

  return {
    contract: LOCAL_REQUEST_BOUNDARY.contract,
    environment_key: LOCAL_REQUEST_BOUNDARY.environment_key,
    operation_key: LOCAL_REQUEST_BOUNDARY.operation_key,
    runbook_key: LOCAL_REQUEST_BOUNDARY.runbook_key,
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
  if (
    request.environment_key !== LOCAL_REQUEST_BOUNDARY.environment_key
    || request.operation_key !== LOCAL_REQUEST_BOUNDARY.operation_key
    || request.runbook_key !== LOCAL_REQUEST_BOUNDARY.runbook_key
    || request.target_source !== LOCAL_REQUEST_BOUNDARY.target_source
  ) {
    fail("host_breakglass_local_request_scope_invalid", "Verified local request escaped the canonical Staging access-repair scope.");
  }
  if (!ALLOWED_ACTIONS.has(request.action)) fail("host_breakglass_local_request_action_denied", "Verified local request action is denied.");
  if (!SHA40_RE.test(String(request.expected_sha || "")) || !SHA256_RE.test(String(request.plan_sha256 || "")) || !SHA256_RE.test(String(request.request_sha256 || ""))) {
    fail("host_breakglass_local_request_hash_invalid", "Verified local request hashes are invalid.");
  }
  if (!SAFE_ID_RE.test(String(request.correlation_id || "")) || !SAFE_ID_RE.test(String(request.target_key || ""))) {
    fail("host_breakglass_local_request_identity_invalid", "Verified local request identity is invalid.");
  }
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
  });
}

export const __hostBreakglassLocalRequestTest = Object.freeze({ digest, resolveLocalRequestBoundary });
