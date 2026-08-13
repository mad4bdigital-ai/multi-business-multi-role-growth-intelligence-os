import { createHash } from "node:crypto";
import { posix as pathPosix } from "node:path";
import { assertNoSecretBearingFields } from "./capabilityEnvelopeSecretPolicy.js";
import { getPool } from "./db.js";
import { getRuntimeVerificationRun, listRuntimeVerificationEvidence } from "./runtimeVerificationService.js";

export const RUNTIME_BREAK_GLASS_CONTRACT = "mad4b.runtime-break-glass.v1";
export const RUNTIME_BREAK_GLASS_OPERATION_INTENT = "runtime_break_glass_bounded_file_patch";

export const RUNTIME_BREAK_GLASS_STATES = Object.freeze([
  "OPEN", "APPROVED", "LOCAL_PATCH_APPLIED", "RUNTIME_VERIFIED", "RECONCILING",
  "MAIN_COMMITTED", "STAGING_VERIFIED", "PRODUCTION_PROMOTED", "REDEPLOYED",
  "CLEAN_READBACK", "CLOSED", "ROLLED_BACK",
]);

export const RUNTIME_BREAK_GLASS_TRANSITIONS = Object.freeze({
  OPEN: ["APPROVED"],
  APPROVED: ["LOCAL_PATCH_APPLIED"],
  LOCAL_PATCH_APPLIED: ["RUNTIME_VERIFIED", "ROLLED_BACK"],
  RUNTIME_VERIFIED: ["RECONCILING", "ROLLED_BACK"],
  RECONCILING: ["MAIN_COMMITTED"],
  MAIN_COMMITTED: ["STAGING_VERIFIED"],
  STAGING_VERIFIED: ["PRODUCTION_PROMOTED"],
  PRODUCTION_PROMOTED: ["REDEPLOYED"],
  REDEPLOYED: ["CLEAN_READBACK"],
  CLEAN_READBACK: ["CLOSED"],
  CLOSED: [],
  ROLLED_BACK: [],
});

const IMPLEMENTED_TARGET_STATES_D01_D06 = new Set(["APPROVED", "LOCAL_PATCH_APPLIED", "RUNTIME_VERIFIED", "RECONCILING", "ROLLED_BACK"]);
const FORWARD_RUNTIME_POLICY_STATES = new Set(["LOCAL_PATCH_APPLIED", "RUNTIME_VERIFIED", "RECONCILING"]);
const RUNTIME_BREAK_GLASS_READBACK_SURFACE = "runtime_break_glass_file_readback";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA40_PATTERN = /^[0-9a-f]{40}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const HOSTINGER_NODE_ROOT_PATTERN = /^\/home\/[^/]+\/domains\/[^/]+\/nodejs$/i;

function compact(value, max = 1000) { return String(value ?? "").trim().slice(0, max); }
function fail(code, message, details = {}) {
  const error = new Error(message); error.code = code; error.status = 400; error.details = { ...details, secrets_included: false }; throw error;
}
function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}
function boolValue(value) { return value === true || Number(value || 0) === 1; }

async function loadRuntimeBreakGlassEnvelopeAuthority(envelopeId) {
  const id = compact(envelopeId, 36).toLowerCase();
  if (!id) return null;
  const [rows] = await getPool().query(
    `SELECT envelope_id, operation_intent, envelope_status, dispatch_allowed, apply_allowed,
            approval_required, blocking_gap_count, execution_status, expires_at, secrets_included,
            envelope_json
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id = ?
      LIMIT 1`,
    [id],
  );
  const row = rows?.[0];
  if (!row) return null;
  const envelope = parseJson(row.envelope_json, {});
  const requestContext = envelope?.request_context && typeof envelope.request_context === "object" && !Array.isArray(envelope.request_context) ? envelope.request_context : {};
  const scopeSha256 = compact(requestContext.break_glass_scope_sha256 || requestContext.runtime_break_glass_scope_sha256 || envelope?.authority?.break_glass_scope_sha256 || envelope?.authority?.runtime_break_glass_scope_sha256, 64).toLowerCase();
  const expectedCommitSha = compact(requestContext.expected_commit_sha || envelope?.capability?.expected_commit_sha || envelope?.selected_source?.expected_commit_sha, 40).toLowerCase();
  return {
    envelope_id: compact(row.envelope_id, 36).toLowerCase(), operation_intent: compact(row.operation_intent || requestContext.operation_intent, 191),
    envelope_status: compact(row.envelope_status, 64), dispatch_allowed: boolValue(row.dispatch_allowed), apply_allowed: boolValue(row.apply_allowed),
    approval_required: boolValue(row.approval_required), blocking_gap_count: Number(row.blocking_gap_count || 0), execution_status: compact(row.execution_status || "not_executed", 64),
    expires_at: row.expires_at || null, expected_commit_sha: expectedCommitSha || null, scope_sha256: scopeSha256 || null, secrets_included: boolValue(row.secrets_included),
  };
}

async function loadRuntimeBreakGlassVerificationReadback(runId) {
  const id = compact(runId, 36).toLowerCase();
  if (!id) return null;
  const page = await listRuntimeVerificationEvidence(id, { surface: RUNTIME_BREAK_GLASS_READBACK_SURFACE, limit: 100 });
  const items = Array.isArray(page?.items) ? page.items : [];
  if (!items.length) return null;
  const readbackHashes = []; let secretsIncluded = false; let invalidRunBinding = false;
  for (const item of items) {
    const payload = parseJson(item?.payload_json, {});
    if (compact(payload.run_id || id, 36).toLowerCase() !== id) invalidRunBinding = true;
    if (payload.secrets_included !== false) secretsIncluded = true;
    if (Array.isArray(payload.readback_hashes)) readbackHashes.push(...payload.readback_hashes);
  }
  return { run_id: id, surface_key: RUNTIME_BREAK_GLASS_READBACK_SURFACE, readback_hashes: readbackHashes, chunk_count: items.length, incomplete: page?.page?.hasMore === true, invalid_run_binding: invalidRunBinding, secrets_included: secretsIncluded };
}
function normalizeUuid(value, field) {
  const x = compact(value, 36).toLowerCase();
  if (!UUID_PATTERN.test(x)) fail("BREAK_GLASS_UUID_INVALID", `${field} must be a UUID.`, { field });
  return x;
}
function normalizeOptionalUuid(value, field) {
  const x = compact(value, 36).toLowerCase(); if (!x) return null;
  if (!UUID_PATTERN.test(x)) fail("BREAK_GLASS_UUID_INVALID", `${field} must be a UUID.`, { field }); return x;
}
function normalizeSha40(value, field) {
  const x = compact(value, 40).toLowerCase();
  if (!SHA40_PATTERN.test(x)) fail("BREAK_GLASS_COMMIT_SHA_INVALID", `${field} must be a 40-character Git SHA.`, { field }); return x;
}
function normalizeOptionalSha256(value, field) {
  const x = compact(value, 64).toLowerCase(); if (!x) return null;
  if (!SHA256_PATTERN.test(x)) fail("BREAK_GLASS_SHA256_INVALID", `${field} must be a SHA-256 hash.`, { field }); return x;
}
function normalizeDate(value, field) {
  const ts = new Date(value).getTime(); if (!Number.isFinite(ts)) fail("BREAK_GLASS_DATE_INVALID", `${field} must be an ISO date-time.`, { field });
  return new Date(ts).toISOString();
}
function normalizeOptionalDate(value, field) { return value === null || value === undefined || value === "" ? null : normalizeDate(value, field); }
function normalizeState(value, field = "lifecycle_state") {
  const state = compact(value, 32).toUpperCase();
  if (!RUNTIME_BREAK_GLASS_STATES.includes(state)) fail("BREAK_GLASS_STATE_INVALID", `${field} is not a canonical break-glass state.`, { field, state });
  return state;
}
function normalizeApplicationRoot(value, field = "target_application_root") {
  const raw = compact(value, 1024);
  if (!raw.startsWith("/home/") || !raw.includes("/domains/") || raw.includes("..") || raw.includes("\0") || /[\r\n;&|`$<>*?{}[\]]/.test(raw)) {
    fail("BREAK_GLASS_APPLICATION_ROOT_UNSAFE", `${field} must be an exact Hostinger Node application root without traversal, control, glob, or shell syntax.`, { field });
  }
  const normalized = pathPosix.normalize(raw).replace(/\/+$/, "");
  if (!HOSTINGER_NODE_ROOT_PATTERN.test(normalized)) fail("BREAK_GLASS_APPLICATION_ROOT_INVALID", `${field} must identify the exact /home/<account>/domains/<domain>/nodejs application root.`, { field });
  return normalized;
}
function normalizePath(value, field, applicationRoot = null) {
  const raw = compact(value, 1024);
  if (!raw.startsWith("/home/") || !raw.includes("/domains/") || raw.includes("..") || raw.includes("\0") || /[\r\n;&|`$<>*?{}[\]]/.test(raw)) {
    fail("BREAK_GLASS_PATH_UNSAFE", `${field} must be an exact, bounded Hostinger application path without glob, traversal, control, or shell syntax.`, { field });
  }
  const normalized = pathPosix.normalize(raw).replace(/\/+$/, "");
  if (!normalized.startsWith("/home/") || !normalized.includes("/domains/")) fail("BREAK_GLASS_PATH_UNSAFE", `${field} must remain inside the bounded Hostinger domain path after canonicalization.`, { field });
  if (/\/nodejs$/i.test(normalized) || /\/domains\/[^/]+$/i.test(normalized)) fail("BREAK_GLASS_PATH_TOO_BROAD", `${field} must identify a path below the application root, not the whole application/domain.`, { field });
  if (applicationRoot && !normalized.startsWith(`${applicationRoot}/`)) fail("BREAK_GLASS_PATH_OUTSIDE_TARGET_APPLICATION_ROOT", `${field} must be a descendant of target_application_root.`, { field });
  return normalized;
}
function normalizePaths(value, applicationRoot = null) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 25) fail("BREAK_GLASS_PATH_SCOPE_INVALID", "allowed_paths must contain 1 to 25 exact paths.");
  const paths = [...new Set(value.map((item, i) => normalizePath(item, `allowed_paths[${i}]`, applicationRoot)))].sort();
  if (paths.length !== value.length) fail("BREAK_GLASS_PATH_SCOPE_DUPLICATE", "allowed_paths must not contain duplicates.");
  return paths;
}
function normalizeHashes(value, field, allowedPaths, { required = true, applicationRoot = null } = {}) {
  const parsed = parseJson(value, null);
  if (!Array.isArray(parsed)) {
    if (!required && (value === null || value === undefined || value === "")) return [];
    fail("BREAK_GLASS_HASH_EVIDENCE_INVALID", `${field} must be an array.`);
  }
  const seen = new Set();
  const out = parsed.map((entry, i) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("BREAK_GLASS_HASH_EVIDENCE_INVALID", `${field}[${i}] must be an object.`);
    const path = normalizePath(entry.path, `${field}[${i}].path`, applicationRoot);
    const sha256 = compact(entry.sha256, 64).toLowerCase();
    if (!SHA256_PATTERN.test(sha256)) fail("BREAK_GLASS_HASH_INVALID", `${field}[${i}].sha256 must be a SHA-256 hash.`);
    if (!allowedPaths.includes(path)) fail("BREAK_GLASS_HASH_PATH_OUTSIDE_SCOPE", `${field}[${i}].path is outside allowed_paths.`, { path });
    if (seen.has(path)) fail("BREAK_GLASS_HASH_PATH_DUPLICATE", `${field} contains a duplicate path.`, { path });
    seen.add(path); return { path, sha256 };
  }).sort((a, b) => a.path.localeCompare(b.path));
  if (required && (out.length !== allowedPaths.length || allowedPaths.some((path) => !seen.has(path)))) fail("BREAK_GLASS_HASH_COVERAGE_INCOMPLETE", `${field} must bind every allowed path exactly once.`);
  return out;
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function fingerprint(value) { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function sameHashes(a, b) { return Array.isArray(a) && Array.isArray(b) && stableJson(a) === stableJson(b); }
function normalizeProjectedHashes(value, allowedPaths, root) { try { return normalizeHashes(value, "event_evidence_hashes", allowedPaths, { applicationRoot: root }); } catch { return []; } }

function approvalScopeForIncident(incident) {
  return {
    contract: RUNTIME_BREAK_GLASS_CONTRACT,
    operation_intent: RUNTIME_BREAK_GLASS_OPERATION_INTENT,
    break_glass_id: incident.break_glass_id,
    incident_id: incident.incident_id,
    target_id: incident.target_id,
    target_application_root: incident.target_application_root,
    environment_key: incident.environment_key,
    approving_principal: incident.approving_principal,
    executing_principal: incident.executing_principal,
    release_gate_id: incident.release_gate_id,
    release_operation_id: incident.release_operation_id,
    expected_commit_sha: incident.expected_commit_sha,
    reason: incident.reason,
    allowed_paths: incident.allowed_paths,
    pre_change_hashes: incident.pre_change_hashes,
    rollback_plan: incident.rollback_plan,
    audit_correlation: incident.audit_correlation,
    authorization_expires_at: incident.authorization_expires_at,
  };
}
function validateEvidenceSecretBoundary(evidence) { try { assertNoSecretBearingFields(evidence); return []; } catch { return ["BREAK_GLASS_SECRET_BEARING_EVIDENCE_REJECTED"]; } }
function normalizeAuditCorrelation(value) {
  const x = parseJson(value, null);
  if (!x || typeof x !== "object" || Array.isArray(x) || !compact(x.correlation_id, 191)) fail("BREAK_GLASS_AUDIT_CORRELATION_REQUIRED", "audit_correlation.correlation_id is required.");
  try { assertNoSecretBearingFields(x); } catch { fail("BREAK_GLASS_AUDIT_CORRELATION_SECRET_REJECTED", "audit_correlation must not contain secret-bearing fields."); }
  const incidentRef = compact(x.incident_ref, 191);
  return { correlation_id: compact(x.correlation_id, 191), ...(incidentRef ? { incident_ref: incidentRef } : {}) };
}
function normalizeRuntimeVerificationRecord(value) {
  const x = parseJson(value, null); if (x === null) return null;
  if (typeof x !== "object" || Array.isArray(x)) fail("BREAK_GLASS_RUNTIME_VERIFICATION_INVALID", "runtime_verification must be an object when present.");
  try { assertNoSecretBearingFields(x); } catch { fail("BREAK_GLASS_RUNTIME_VERIFICATION_SECRET_REJECTED", "runtime_verification must not contain secret-bearing fields."); }
  return x;
}

export function normalizeRuntimeBreakGlassIncident(input = {}) {
  const root = normalizeApplicationRoot(input.target_application_root);
  const allowedPaths = normalizePaths(parseJson(input.allowed_paths_json ?? input.allowed_paths, []), root);
  const pre = normalizeHashes(input.pre_change_hashes_json ?? input.pre_change_hashes, "pre_change_hashes", allowedPaths, { applicationRoot: root });
  const post = normalizeHashes(input.post_change_hashes_json ?? input.post_change_hashes, "post_change_hashes", allowedPaths, { required: false, applicationRoot: root });
  const postReadback = normalizeHashes(input.post_change_readback_json ?? input.post_change_readback_hashes, "post_change_readback_hashes", allowedPaths, { required: false, applicationRoot: root });
  const rollbackPlan = parseJson(input.rollback_plan_json ?? input.rollback_plan, null);
  const auditCorrelation = normalizeAuditCorrelation(input.audit_correlation_json ?? input.audit_correlation);
  if (!rollbackPlan || typeof rollbackPlan !== "object" || Array.isArray(rollbackPlan) || compact(rollbackPlan.strategy, 191).length < 3) fail("BREAK_GLASS_ROLLBACK_PLAN_REQUIRED", "rollback_plan.strategy is required.");
  try { assertNoSecretBearingFields(rollbackPlan); } catch { fail("BREAK_GLASS_ROLLBACK_PLAN_SECRET_REJECTED", "rollback_plan must not contain secret-bearing fields."); }
  const reason = compact(input.reason, 1000); if (reason.length < 20) fail("BREAK_GLASS_REASON_REQUIRED", "reason must contain at least 20 characters.");
  const approvingPrincipal = compact(input.approving_principal, 191); const executingPrincipal = compact(input.executing_principal, 191);
  if (!approvingPrincipal || !executingPrincipal) fail("BREAK_GLASS_PRINCIPAL_REQUIRED", "approving_principal and executing_principal are required.");
  return {
    contract: RUNTIME_BREAK_GLASS_CONTRACT,
    break_glass_id: normalizeUuid(input.break_glass_id, "break_glass_id"), incident_id: compact(input.incident_id, 191) || fail("BREAK_GLASS_INCIDENT_REQUIRED", "incident_id is required."),
    target_id: normalizeUuid(input.target_id, "target_id"), target_application_root: root, environment_key: compact(input.environment_key || "production", 64),
    lifecycle_state: normalizeState(input.lifecycle_state || "OPEN"), approving_principal: approvingPrincipal, executing_principal: executingPrincipal,
    capability_envelope_id: normalizeUuid(input.capability_envelope_id, "capability_envelope_id"),
    release_gate_id: normalizeOptionalUuid(input.release_gate_id, "release_gate_id"), release_operation_id: normalizeOptionalUuid(input.release_operation_id, "release_operation_id"),
    expected_commit_sha: normalizeSha40(input.expected_commit_sha, "expected_commit_sha"), reason, allowed_paths: allowedPaths, pre_change_hashes: pre,
    rollback_plan: rollbackPlan, audit_correlation: auditCorrelation,
    approved_scope_sha256: normalizeOptionalSha256(input.approved_scope_sha256, "approved_scope_sha256"),
    post_change_hashes: post, post_change_readback_hashes: postReadback,
    runtime_verification_run_id: normalizeOptionalUuid(input.runtime_verification_run_id, "runtime_verification_run_id"),
    runtime_verification: normalizeRuntimeVerificationRecord(input.runtime_verification_json ?? input.runtime_verification),
    runtime_policy_ready: input.runtime_policy_ready === true || Number(input.runtime_policy_ready) === 1,
    authorization_expires_at: normalizeDate(input.authorization_expires_at, "authorization_expires_at"),
    approved_at: normalizeOptionalDate(input.approved_at, "approved_at"), local_patch_applied_at: normalizeOptionalDate(input.local_patch_applied_at, "local_patch_applied_at"),
    runtime_verified_at: normalizeOptionalDate(input.runtime_verified_at, "runtime_verified_at"), reconciliation_started_at: normalizeOptionalDate(input.reconciliation_started_at, "reconciliation_started_at"),
    rolled_back_at: normalizeOptionalDate(input.rolled_back_at, "rolled_back_at"), secrets_included: false,
  };
}

function validateApprovalAuthority(incident, now, authority, lookupAttempted, lookupFailed) {
  const reasons = [];
  const expectedScopeSha = fingerprint(approvalScopeForIncident(incident));
  if (!incident.runtime_policy_ready) reasons.push("BREAK_GLASS_RUNTIME_POLICY_NOT_READY");
  if (!lookupAttempted) return [...reasons, "BREAK_GLASS_ENVELOPE_LEDGER_LOOKUP_REQUIRED"];
  if (lookupFailed) return [...reasons, "BREAK_GLASS_ENVELOPE_LEDGER_LOOKUP_FAILED"];
  if (!authority) return [...reasons, "BREAK_GLASS_ENVELOPE_LEDGER_NOT_FOUND"];
  if (compact(authority.envelope_id, 36).toLowerCase() !== incident.capability_envelope_id) reasons.push("BREAK_GLASS_ENVELOPE_MISMATCH");
  if (compact(authority.envelope_status, 64) !== "ready_for_dispatch") reasons.push("BREAK_GLASS_ENVELOPE_NOT_READY");
  if (authority.dispatch_allowed !== true) reasons.push("BREAK_GLASS_DISPATCH_NOT_ALLOWED");
  if (authority.apply_allowed !== true) reasons.push("BREAK_GLASS_APPLY_NOT_ALLOWED");
  if (authority.approval_required === true) reasons.push("BREAK_GLASS_APPROVAL_NOT_ACTIVE");
  if (Number(authority.blocking_gap_count || 0) > 0) reasons.push("BREAK_GLASS_ENVELOPE_BLOCKING_GAP");
  if (!["not_executed", "referenced"].includes(compact(authority.execution_status || "not_executed", 64))) reasons.push("BREAK_GLASS_ENVELOPE_ALREADY_CONSUMED");
  if (authority.secrets_included !== false) reasons.push("BREAK_GLASS_ENVELOPE_SECRETS_FLAG_INVALID");
  if (compact(authority.operation_intent, 191) !== RUNTIME_BREAK_GLASS_OPERATION_INTENT) reasons.push("BREAK_GLASS_ENVELOPE_OPERATION_MISMATCH");
  if (compact(authority.expected_commit_sha, 40).toLowerCase() !== incident.expected_commit_sha) reasons.push("BREAK_GLASS_ENVELOPE_COMMIT_MISMATCH");
  if (compact(authority.scope_sha256, 64).toLowerCase() !== expectedScopeSha) reasons.push("BREAK_GLASS_ENVELOPE_SCOPE_FINGERPRINT_MISMATCH");
  const envelopeExpiry = new Date(authority.expires_at).getTime(); const incidentExpiry = new Date(incident.authorization_expires_at).getTime();
  if (!Number.isFinite(envelopeExpiry)) reasons.push("BREAK_GLASS_ENVELOPE_EXPIRY_REQUIRED");
  else { if (envelopeExpiry <= now.getTime()) reasons.push("BREAK_GLASS_ENVELOPE_EXPIRED"); if (incidentExpiry > envelopeExpiry) reasons.push("BREAK_GLASS_AUTHORIZATION_EXCEEDS_ENVELOPE_EXPIRY"); }
  return reasons;
}
function validateApprovedScopeBinding(incident) {
  const approved = compact(incident.approved_scope_sha256, 64).toLowerCase();
  if (!SHA256_PATTERN.test(approved)) return ["BREAK_GLASS_APPROVED_SCOPE_BINDING_REQUIRED"];
  return approved === fingerprint(approvalScopeForIncident(incident)) ? [] : ["BREAK_GLASS_APPROVED_SCOPE_MISMATCH"];
}
function validatePatchEvidence(incident, evidence) {
  const reasons = []; let pre = null; let post = null; let readback = null;
  if (evidence?.mutation_method !== "bounded_file_patch") reasons.push("BREAK_GLASS_BOUNDED_PATCH_METHOD_REQUIRED");
  if (evidence?.freeform_shell !== false) reasons.push("BREAK_GLASS_FREEFORM_SHELL_FORBIDDEN");
  if (evidence?.filesystem_scope_exact !== true) reasons.push("BREAK_GLASS_EXACT_FILESYSTEM_SCOPE_REQUIRED");
  try { pre = normalizeHashes(evidence?.pre_change_readback_hashes, "pre_change_readback_hashes", incident.allowed_paths, { applicationRoot: incident.target_application_root }); } catch { reasons.push("BREAK_GLASS_PRE_CHANGE_READBACK_REQUIRED"); }
  if (pre && !sameHashes(pre, incident.pre_change_hashes)) reasons.push("BREAK_GLASS_PRE_CHANGE_READBACK_MISMATCH");
  try { post = normalizeHashes(evidence?.post_change_hashes, "post_change_hashes", incident.allowed_paths, { applicationRoot: incident.target_application_root }); } catch (e) { reasons.push(e.code || "BREAK_GLASS_POST_CHANGE_HASHES_INVALID"); }
  try { readback = normalizeHashes(evidence?.post_change_readback_hashes, "post_change_readback_hashes", incident.allowed_paths, { applicationRoot: incident.target_application_root }); } catch { reasons.push("BREAK_GLASS_POST_CHANGE_READBACK_REQUIRED"); }
  if (post && sameHashes(post, incident.pre_change_hashes)) reasons.push("BREAK_GLASS_NO_OP_PATCH_FORBIDDEN");
  if (post && readback && !sameHashes(post, readback)) reasons.push("BREAK_GLASS_POST_CHANGE_READBACK_MISMATCH");
  return reasons;
}
function validateRuntimeVerification(incident, evidence, { persistedOnly = false, suppliedOnly = false } = {}) {
  const persisted = incident.runtime_verification || {}; const persistedRunId = compact(incident.runtime_verification_run_id, 36).toLowerCase();
  const supplied = evidence?.runtime_verification; const suppliedRunId = compact(evidence?.runtime_verification_run_id, 36).toLowerCase();
  const verification = persistedOnly ? persisted : (suppliedOnly ? (supplied || {}) : (supplied || persisted));
  const runId = persistedOnly ? persistedRunId : (suppliedOnly ? suppliedRunId : (suppliedRunId || persistedRunId));
  const reasons = []; let expected = null; let persistedReadback = null;
  if (suppliedOnly && (!supplied || typeof supplied !== "object")) reasons.push("BREAK_GLASS_RUNTIME_VERIFICATION_EVIDENCE_REQUIRED");
  if (persistedOnly) {
    if (evidence && Object.hasOwn(evidence, "runtime_verification_run_id") && suppliedRunId !== persistedRunId) reasons.push("BREAK_GLASS_RUNTIME_VERIFICATION_RUN_REBIND_FORBIDDEN");
    if (evidence && Object.hasOwn(evidence, "runtime_verification") && stableJson(supplied) !== stableJson(persisted)) reasons.push("BREAK_GLASS_RUNTIME_VERIFICATION_EVIDENCE_REBIND_FORBIDDEN");
  }
  if (!UUID_PATTERN.test(runId)) reasons.push("BREAK_GLASS_RUNTIME_VERIFICATION_RUN_REQUIRED");
  if (verification.status !== "verified") reasons.push("BREAK_GLASS_RUNTIME_VERIFICATION_NOT_VERIFIED");
  if (verification.post_change_hashes_verified !== true) reasons.push("BREAK_GLASS_POST_CHANGE_HASH_READBACK_REQUIRED");
  if (verification.secrets_included !== false) reasons.push("BREAK_GLASS_VERIFICATION_SECRETS_FLAG_INVALID");
  try { expected = normalizeHashes(incident.post_change_hashes, "persisted_post_change_hashes", incident.allowed_paths, { applicationRoot: incident.target_application_root }); } catch { reasons.push("BREAK_GLASS_PERSISTED_POST_CHANGE_HASHES_REQUIRED"); }
  try { persistedReadback = normalizeHashes(incident.post_change_readback_hashes, "persisted_post_change_readback_hashes", incident.allowed_paths, { applicationRoot: incident.target_application_root }); } catch { reasons.push("BREAK_GLASS_PERSISTED_POST_CHANGE_READBACK_REQUIRED"); }
  if (expected && persistedReadback && !sameHashes(expected, persistedReadback)) reasons.push("BREAK_GLASS_PERSISTED_POST_CHANGE_READBACK_MISMATCH");
  return reasons;
}
function validateRuntimeControlPlaneRun(incident, runId, run, attempted, failed = false) {
  if (!UUID_PATTERN.test(runId)) return [];
  if (!attempted) return ["BREAK_GLASS_RUNTIME_CONTROL_PLANE_LOOKUP_REQUIRED"];
  if (failed) return ["BREAK_GLASS_RUNTIME_CONTROL_PLANE_LOOKUP_FAILED"];
  if (!run) return ["BREAK_GLASS_RUNTIME_CONTROL_PLANE_RUN_NOT_FOUND"];
  const reasons = [];
  if (compact(run.run_id, 36).toLowerCase() !== runId) reasons.push("BREAK_GLASS_RUNTIME_CONTROL_PLANE_RUN_ID_MISMATCH");
  if (compact(run.run_status, 64).toLowerCase() !== "verified") reasons.push("BREAK_GLASS_RUNTIME_CONTROL_PLANE_RUN_NOT_VERIFIED");
  if (compact(run.production_parity, 64).toLowerCase() !== "verified") reasons.push("BREAK_GLASS_RUNTIME_CONTROL_PLANE_PARITY_NOT_VERIFIED");
  if (compact(run.environment_key, 64) !== incident.environment_key) reasons.push("BREAK_GLASS_RUNTIME_CONTROL_PLANE_ENVIRONMENT_MISMATCH");
  if (compact(run.expected_commit_sha, 40).toLowerCase() !== incident.expected_commit_sha) reasons.push("BREAK_GLASS_RUNTIME_CONTROL_PLANE_EXPECTED_COMMIT_MISMATCH");
  if (compact(run.deployed_commit_sha, 40).toLowerCase() !== incident.expected_commit_sha) reasons.push("BREAK_GLASS_RUNTIME_CONTROL_PLANE_DEPLOYED_COMMIT_MISMATCH");
  const patchAt = incident.local_patch_applied_at ? new Date(incident.local_patch_applied_at).getTime() : NaN; const startedAt = run.started_at ? new Date(run.started_at).getTime() : NaN;
  const patchSecond = Number.isFinite(patchAt) ? Math.floor(patchAt / 1000) : NaN; const startedSecond = Number.isFinite(startedAt) ? Math.floor(startedAt / 1000) : NaN;
  if (!Number.isFinite(patchAt)) reasons.push("BREAK_GLASS_LOCAL_PATCH_APPLIED_AT_REQUIRED");
  if (!Number.isFinite(startedAt)) reasons.push("BREAK_GLASS_RUNTIME_CONTROL_PLANE_STARTED_AT_REQUIRED");
  else if (Number.isFinite(patchSecond) && startedSecond < patchSecond) reasons.push("BREAK_GLASS_RUNTIME_CONTROL_PLANE_RUN_PREDATES_PATCH");
  else if (Number.isFinite(patchSecond) && startedSecond === patchSecond) reasons.push("BREAK_GLASS_RUNTIME_CONTROL_PLANE_RUN_ORDER_AMBIGUOUS");
  if (!run.completed_at) reasons.push("BREAK_GLASS_RUNTIME_CONTROL_PLANE_INCOMPLETE");
  if (run.secrets_included !== false) reasons.push("BREAK_GLASS_RUNTIME_CONTROL_PLANE_SECRETS_FLAG_INVALID");
  if ((Array.isArray(run.gaps) && run.gaps.some((gap) => Number(gap?.blocks_production_parity) === 1)) || Number(run.summary?.blocking_gap_count || 0) > 0) reasons.push("BREAK_GLASS_RUNTIME_CONTROL_PLANE_BLOCKING_GAP");
  return reasons;
}
function validateRuntimeReadbackAuthority(incident, runId, readback, attempted, failed = false) {
  if (!UUID_PATTERN.test(runId)) return [];
  if (!attempted) return ["BREAK_GLASS_RUNTIME_READBACK_AUTHORITY_LOOKUP_REQUIRED"];
  if (failed) return ["BREAK_GLASS_RUNTIME_READBACK_AUTHORITY_LOOKUP_FAILED"];
  if (!readback) return ["BREAK_GLASS_RUNTIME_READBACK_AUTHORITY_NOT_FOUND"];
  const reasons = []; let hashes = null; let expected = null;
  if (compact(readback.run_id, 36).toLowerCase() !== runId || readback.invalid_run_binding === true) reasons.push("BREAK_GLASS_RUNTIME_READBACK_RUN_BINDING_MISMATCH");
  if (compact(readback.surface_key, 128) !== RUNTIME_BREAK_GLASS_READBACK_SURFACE) reasons.push("BREAK_GLASS_RUNTIME_READBACK_SURFACE_MISMATCH");
  if (readback.incomplete === true) reasons.push("BREAK_GLASS_RUNTIME_READBACK_EVIDENCE_INCOMPLETE");
  if (readback.secrets_included !== false) reasons.push("BREAK_GLASS_RUNTIME_READBACK_SECRETS_FLAG_INVALID");
  try { hashes = normalizeHashes(readback.readback_hashes, "run_bound_runtime_readback_hashes", incident.allowed_paths, { applicationRoot: incident.target_application_root }); } catch { reasons.push("BREAK_GLASS_RUNTIME_READBACK_HASHES_REQUIRED"); }
  try { expected = normalizeHashes(incident.post_change_hashes, "persisted_post_change_hashes", incident.allowed_paths, { applicationRoot: incident.target_application_root }); } catch { /* already reported elsewhere */ }
  if (hashes && expected && !sameHashes(hashes, expected)) reasons.push("BREAK_GLASS_RUNTIME_READBACK_HASH_MISMATCH");
  return reasons;
}
function validateRollbackEvidence(incident, evidence) {
  const reasons = []; let hashes = null;
  if (evidence?.rollback_applied !== true) reasons.push("BREAK_GLASS_ROLLBACK_APPLY_EVIDENCE_REQUIRED");
  if (evidence?.rollback_readback_verified !== true) reasons.push("BREAK_GLASS_ROLLBACK_READBACK_REQUIRED");
  if (evidence?.secrets_included !== false) reasons.push("BREAK_GLASS_ROLLBACK_SECRETS_FLAG_INVALID");
  try { hashes = normalizeHashes(evidence?.rollback_readback_hashes, "rollback_readback_hashes", incident.allowed_paths, { applicationRoot: incident.target_application_root }); } catch { reasons.push("BREAK_GLASS_ROLLBACK_READBACK_HASHES_REQUIRED"); }
  if (hashes && !sameHashes(hashes, incident.pre_change_hashes)) reasons.push("BREAK_GLASS_ROLLBACK_READBACK_HASH_MISMATCH");
  return reasons;
}
function projectControlPlaneRun(run) {
  if (!run) return null;
  return { run_id: compact(run.run_id,36).toLowerCase(), environment_key: compact(run.environment_key,64), expected_commit_sha: compact(run.expected_commit_sha,40).toLowerCase(), deployed_commit_sha: compact(run.deployed_commit_sha,40).toLowerCase(), run_status: compact(run.run_status,64).toLowerCase(), production_parity: compact(run.production_parity,64).toLowerCase(), started_at: run.started_at || null, completed_at: run.completed_at || null, secrets_included: false };
}
function projectEnvelopeAuthority(authority) {
  if (!authority) return null;
  return { authority_source: "capability_resolution_envelope_ledger", capability_envelope_id: compact(authority.envelope_id,36).toLowerCase(), envelope_status: compact(authority.envelope_status,64), dispatch_allowed: authority.dispatch_allowed === true, apply_allowed: authority.apply_allowed === true, approval_required: authority.approval_required === true, blocking_gap_count: Number(authority.blocking_gap_count || 0), execution_status: compact(authority.execution_status || "not_executed",64), expires_at: authority.expires_at || null, operation_intent: compact(authority.operation_intent,191), expected_commit_sha: compact(authority.expected_commit_sha,40).toLowerCase(), scope_sha256: compact(authority.scope_sha256,64).toLowerCase(), secrets_included: false };
}
function projectRuntimeReadback(incident, readback) {
  if (!readback) return null;
  return { run_id: compact(readback.run_id,36).toLowerCase(), surface_key: compact(readback.surface_key,128), readback_hashes: normalizeProjectedHashes(readback.readback_hashes, incident.allowed_paths, incident.target_application_root), chunk_count: Number(readback.chunk_count || 0), secrets_included: false };
}
function projectSafeEvidence(incident, toState, evidence, { envelopeAuthority = null, controlPlaneRun = null, runtimeReadback = null } = {}) {
  if (toState === "APPROVED") return { authority: projectEnvelopeAuthority(envelopeAuthority), secrets_included: false };
  if (toState === "LOCAL_PATCH_APPLIED") return { mutation_method: evidence?.mutation_method === "bounded_file_patch" ? "bounded_file_patch" : compact(evidence?.mutation_method,64), freeform_shell: evidence?.freeform_shell === true, filesystem_scope_exact: evidence?.filesystem_scope_exact === true, pre_change_readback_hashes: normalizeProjectedHashes(evidence?.pre_change_readback_hashes, incident.allowed_paths, incident.target_application_root), post_change_hashes: normalizeProjectedHashes(evidence?.post_change_hashes, incident.allowed_paths, incident.target_application_root), post_change_readback_hashes: normalizeProjectedHashes(evidence?.post_change_readback_hashes, incident.allowed_paths, incident.target_application_root), secrets_included: false };
  if (toState === "RUNTIME_VERIFIED" || toState === "RECONCILING") {
    const persistedOnly = toState === "RECONCILING"; const runId = persistedOnly ? incident.runtime_verification_run_id : evidence?.runtime_verification_run_id;
    const authoritativeHashes = normalizeProjectedHashes(runtimeReadback?.readback_hashes, incident.allowed_paths, incident.target_application_root);
    return { runtime_verification_run_id: compact(runId,36).toLowerCase(), runtime_verification: { status: controlPlaneRun?.run_status === "verified" ? "verified" : compact(controlPlaneRun?.run_status,64), post_change_hashes_verified: authoritativeHashes.length === incident.allowed_paths.length, readback_hashes: authoritativeHashes, readback_surface_key: compact(runtimeReadback?.surface_key,128), secrets_included: false }, control_plane_run: projectControlPlaneRun(controlPlaneRun), run_bound_readback: projectRuntimeReadback(incident, runtimeReadback), secrets_included: false };
  }
  if (toState === "ROLLED_BACK") return { rollback_applied: evidence?.rollback_applied === true, rollback_readback_verified: evidence?.rollback_readback_verified === true, rollback_readback_hashes: normalizeProjectedHashes(evidence?.rollback_readback_hashes, incident.allowed_paths, incident.target_application_root), secrets_included: false };
  return { secrets_included: false };
}
function buildIncidentUpdatePreview(incident, toState, normalizedEvidence, approvedScopeSha256, now) {
  const at = now.toISOString(); const preview = { lifecycle_state: toState, secrets_included: false };
  if (toState === "APPROVED") { preview.approved_scope_sha256 = approvedScopeSha256; preview.approved_at = at; }
  if (toState === "LOCAL_PATCH_APPLIED") { preview.post_change_hashes = normalizedEvidence.post_change_hashes; preview.post_change_readback_hashes = normalizedEvidence.post_change_readback_hashes; preview.local_patch_applied_at = at; }
  if (toState === "RUNTIME_VERIFIED") { preview.runtime_verification_run_id = normalizedEvidence.runtime_verification_run_id; preview.runtime_verification = normalizedEvidence.runtime_verification; preview.runtime_verified_at = at; }
  if (toState === "RECONCILING") preview.reconciliation_started_at = at;
  if (toState === "ROLLED_BACK") preview.rolled_back_at = at;
  return preview;
}
function resolveRuntimeVerificationRunId(incident, toState, evidence) {
  if (toState === "RUNTIME_VERIFIED") return compact(evidence?.runtime_verification_run_id,36).toLowerCase();
  if (toState === "RECONCILING") return compact(incident.runtime_verification_run_id,36).toLowerCase();
  return "";
}

function planRuntimeBreakGlassTransitionCore(
  { incident: rawIncident, to_state, evidence = {}, now = new Date() } = {},
  { envelopeAuthority = null, envelopeLookupAttempted = false, envelopeLookupFailed = false, controlPlaneRun = null, controlPlaneLookupAttempted = false, controlPlaneLookupFailed = false, runtimeReadback = null, runtimeReadbackLookupAttempted = false, runtimeReadbackLookupFailed = false } = {},
) {
  const incident = normalizeRuntimeBreakGlassIncident(rawIncident); const fromState = incident.lifecycle_state; const toState = normalizeState(to_state, "to_state");
  const reasons = [...validateEvidenceSecretBoundary(evidence)];
  if (!RUNTIME_BREAK_GLASS_TRANSITIONS[fromState].includes(toState)) reasons.push("BREAK_GLASS_TRANSITION_NOT_ALLOWED");
  if (!IMPLEMENTED_TARGET_STATES_D01_D06.has(toState)) reasons.push("BREAK_GLASS_FOLLOWUP_PHASE_REQUIRED");
  if (new Date(incident.authorization_expires_at).getTime() <= now.getTime() && toState !== "ROLLED_BACK") reasons.push("BREAK_GLASS_AUTHORIZATION_EXPIRED");
  if (FORWARD_RUNTIME_POLICY_STATES.has(toState) && !incident.runtime_policy_ready) reasons.push("BREAK_GLASS_RUNTIME_POLICY_NOT_READY");
  if (fromState === "OPEN" && toState === "APPROVED") reasons.push(...validateApprovalAuthority(incident, now, envelopeAuthority, envelopeLookupAttempted, envelopeLookupFailed));
  if (fromState === "APPROVED" && toState === "LOCAL_PATCH_APPLIED") { reasons.push(...validateApprovedScopeBinding(incident)); reasons.push(...validatePatchEvidence(incident, evidence)); }
  if (fromState === "LOCAL_PATCH_APPLIED" && toState === "RUNTIME_VERIFIED") {
    reasons.push(...validateApprovedScopeBinding(incident)); reasons.push(...validateRuntimeVerification(incident, evidence, { suppliedOnly: true }));
    const runId = resolveRuntimeVerificationRunId(incident, toState, evidence);
    reasons.push(...validateRuntimeControlPlaneRun(incident, runId, controlPlaneRun, controlPlaneLookupAttempted, controlPlaneLookupFailed));
    reasons.push(...validateRuntimeReadbackAuthority(incident, runId, runtimeReadback, runtimeReadbackLookupAttempted, runtimeReadbackLookupFailed));
  }
  if (fromState === "RUNTIME_VERIFIED" && toState === "RECONCILING") {
    reasons.push(...validateApprovedScopeBinding(incident)); reasons.push(...validateRuntimeVerification(incident, evidence, { persistedOnly: true }));
    const runId = resolveRuntimeVerificationRunId(incident, toState, evidence);
    reasons.push(...validateRuntimeControlPlaneRun(incident, runId, controlPlaneRun, controlPlaneLookupAttempted, controlPlaneLookupFailed));
    reasons.push(...validateRuntimeReadbackAuthority(incident, runId, runtimeReadback, runtimeReadbackLookupAttempted, runtimeReadbackLookupFailed));
  }
  if (toState === "ROLLED_BACK") { reasons.push(...validateApprovedScopeBinding(incident)); reasons.push(...validateRollbackEvidence(incident, evidence)); }
  const blockers = [...new Set(reasons)]; const eligible = blockers.length === 0; const approvedScopeSha256 = fingerprint(approvalScopeForIncident(incident));
  const normalizedEvidence = projectSafeEvidence(incident, toState, evidence, { envelopeAuthority, controlPlaneRun, runtimeReadback });
  return { ok: true, contract: RUNTIME_BREAK_GLASS_CONTRACT, decision: eligible ? "eligible_shadow" : "blocked", from_state: fromState, to_state: toState, blockers, incident_fingerprint: fingerprint(incident), evidence_fingerprint: fingerprint(normalizedEvidence), incident_update_preview: eligible ? buildIncidentUpdatePreview(incident, toState, normalizedEvidence, approvedScopeSha256, now) : null,
    event_preview: eligible ? { break_glass_id: incident.break_glass_id, incident_id: incident.incident_id, event_type: `${fromState.toLowerCase()}_to_${toState.toLowerCase()}`, from_state: fromState, to_state: toState, actor: toState === "APPROVED" ? incident.approving_principal : incident.executing_principal, approved_scope_sha256: toState === "APPROVED" ? approvedScopeSha256 : incident.approved_scope_sha256, audit_correlation: incident.audit_correlation, evidence: normalizedEvidence, secrets_included: false } : null,
    execution_performed: false, database_write_performed: false, provider_call_performed: false, hostinger_mutation_performed: false, protected_branch_write_performed: false, unrestricted_shell_allowed: false, secrets_included: false };
}

export function planRuntimeBreakGlassTransition(args = {}) { return planRuntimeBreakGlassTransitionCore(args); }

export async function planRuntimeBreakGlassTransitionWithControlPlane(
  args = {},
  { loadRuntimeVerificationRun = getRuntimeVerificationRun, loadCapabilityEnvelopeAuthority = loadRuntimeBreakGlassEnvelopeAuthority, loadRuntimeVerificationReadback = loadRuntimeBreakGlassVerificationReadback } = {},
) {
  const incident = normalizeRuntimeBreakGlassIncident(args.incident); const toState = normalizeState(args.to_state, "to_state");
  if (toState === "APPROVED") {
    let envelopeAuthority = null;
    try { envelopeAuthority = await loadCapabilityEnvelopeAuthority(incident.capability_envelope_id); }
    catch { return planRuntimeBreakGlassTransitionCore(args, { envelopeLookupAttempted: true, envelopeLookupFailed: true }); }
    return planRuntimeBreakGlassTransitionCore(args, { envelopeAuthority, envelopeLookupAttempted: true });
  }
  if (toState !== "RUNTIME_VERIFIED" && toState !== "RECONCILING") return planRuntimeBreakGlassTransitionCore(args);
  const runId = resolveRuntimeVerificationRunId(incident, toState, args.evidence || {});
  let controlPlaneRun = null; let runtimeReadback = null; let runFailed = false; let readbackFailed = false;
  if (UUID_PATTERN.test(runId)) {
    try { controlPlaneRun = await loadRuntimeVerificationRun(runId); } catch { runFailed = true; }
    if (!runFailed && controlPlaneRun?.runtime_break_glass_readback) runtimeReadback = controlPlaneRun.runtime_break_glass_readback;
    else {
      try { runtimeReadback = await loadRuntimeVerificationReadback(runId); } catch { readbackFailed = true; }
    }
  }
  return planRuntimeBreakGlassTransitionCore(args, { controlPlaneRun, controlPlaneLookupAttempted: true, controlPlaneLookupFailed: runFailed, runtimeReadback, runtimeReadbackLookupAttempted: true, runtimeReadbackLookupFailed: readbackFailed });
}
