import { createHash } from "node:crypto";

const brokerContractId = "mad4b.unsupported-recovery-broker.v1";
const registeredRuntimeTarget = "production-runtime";

const SHA256_RE = /^[0-9a-f]{64}$/iu;
const INCIDENT_RE = /^incident:[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

export const SSH_CAPABILITY_LEVELS = Object.freeze({
  S0: "connectivity_only",
  S1: "read_only_shell",
  S2: "service_diagnostics",
  S3: "file_or_config_repair",
  S4: "process_or_service_mutation",
  S5: "privileged_root_mutation",
});

export const SQL_CAPABILITY_LEVELS = Object.freeze({
  Q0: "metadata_only",
  Q1: "select",
  Q2: "temporary_session_changes",
  Q3: "dml",
  Q4: "grants",
  Q5: "additive_ddl",
  Q6: "destructive_ddl",
});

export const UNSUPPORTED_RISK_CLASSES = Object.freeze([
  "read_only",
  "reversible",
  "service_impacting",
  "filesystem_mutation",
  "destructive",
  "unknown",
]);

export const SSH_DENYLIST = Object.freeze([
  "rm -rf",
  "mkfs",
  "dd ",
  "shutdown",
  "reboot",
  "iptables flush",
  "userdel",
  "drop database",
  "curl | sh",
  "wget | sh",
  "bash <(curl",
  "history",
  "cat ~/.ssh",
  "cat .env",
  "printenv",
]);

export const SQL_STATEMENT_CLASSES = Object.freeze({
  Q0: ["SHOW", "DESCRIBE", "EXPLAIN"],
  Q1: ["SELECT"],
  Q2: ["SET", "CREATE TEMPORARY"],
  Q3: ["INSERT", "UPDATE", "DELETE"],
  Q4: ["GRANT", "REVOKE"],
  Q5: ["ALTER", "CREATE", "ADD"],
  Q6: ["DROP", "TRUNCATE", "RENAME"],
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function text(value, max = 256) {
  return String(value ?? "").trim().slice(0, max);
}

function error(status, code, message, details = {}) {
  const value = new Error(message);
  value.status = status;
  value.code = code;
  value.details = { ...details, secrets_included: false };
  return value;
}

function exactSha(value, field = "expected_sha") {
  const normalized = text(value, 64).toLowerCase();
  if (!/^[0-9a-f]{40}$/iu.test(normalized)) throw error(400, "UNSUPPORTED_EXPECTED_SHA_INVALID", `${field} must be a full 40-character SHA.`);
  return normalized;
}

function incidentId(value) {
  const normalized = text(value, 160);
  if (!INCIDENT_RE.test(normalized)) throw error(400, "UNSUPPORTED_INCIDENT_ID_INVALID", "incident_id must be a repository-safe incident identifier.");
  return normalized;
}

function targetKey(value) {
  const normalized = text(value, 128) || registeredRuntimeTarget;
  if (normalized !== registeredRuntimeTarget) throw error(403, "UNSUPPORTED_TARGET_INVALID", "Unsupported Recovery is bound to the registered Production runtime target.", { target_key: normalized });
  return normalized;
}

function sha256(value, field) {
  const normalized = text(value, 128).toLowerCase();
  if (!SHA256_RE.test(normalized)) throw error(400, "UNSUPPORTED_ARTIFACT_SHA_INVALID", `${field} must be a 64-character SHA-256 digest.`);
  return normalized;
}

function safeId(value, field) {
  const normalized = text(value, 160);
  if (!SAFE_ID_RE.test(normalized)) throw error(400, "UNSUPPORTED_REFERENCE_INVALID", `${field} must be a bounded repository-safe reference.`);
  return normalized;
}

function exactKeys(input, allowed, required = []) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw error(400, "UNSUPPORTED_INPUT_INVALID", "Unsupported Recovery input must be a JSON object.");
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) throw error(400, "UNSUPPORTED_INPUT_FIELD_FORBIDDEN", "Unsupported Recovery does not accept raw commands, SQL, scripts, credentials, hosts, ports, database names, or arbitrary paths.", { fields: unknown });
  const missing = required.filter((key) => input[key] === undefined || input[key] === null || input[key] === "");
  if (missing.length) throw error(400, "UNSUPPORTED_REQUIRED_FIELD_MISSING", "The Unsupported Recovery contract is missing required fields.", { fields: missing });
  return input;
}

function requireProductionPrincipal(adminPrincipal) {
  if (!adminPrincipal?.verified) throw error(403, "UNSUPPORTED_ADMIN_PRINCIPAL_REQUIRED", "Unsupported Recovery requires a verified administrative principal.", { principal_binding: "verified_admin_guard" });
}

function mutationDisabled(env = process.env) {
  return String(env.RECOVERY_MUTATIONS_ENABLED || "").trim().toLowerCase() !== "true";
}

export function classifySshProfile({ profile = "read_only_shell", command_sha256 = null, risk_class = "read_only" } = {}) {
  const normalizedProfile = text(profile, 64);
  const normalizedRisk = text(risk_class, 64);
  if (!Object.hasOwn(SSH_CAPABILITY_LEVELS, normalizedProfile)) throw error(400, "UNSUPPORTED_SSH_PROFILE_INVALID", "SSH profile must be one of the registered S0-S5 levels.");
  if (!UNSUPPORTED_RISK_CLASSES.includes(normalizedRisk)) throw error(400, "UNSUPPORTED_RISK_CLASS_INVALID", "Unsupported Recovery risk class is not registered.");
  return { transport: "ssh", profile: normalizedProfile, profile_name: SSH_CAPABILITY_LEVELS[normalizedProfile], command_sha256: command_sha256 ? sha256(command_sha256, "command_sha256") : null, risk_class: normalizedRisk, denylist_applied: true, raw_command_received: false, secrets_included: false };
}

export function classifySqlProfile({ profile = "Q0", query_sha256 = null, risk_class = "read_only" } = {}) {
  const normalizedProfile = text(profile, 16);
  const normalizedRisk = text(risk_class, 64);
  if (!Object.hasOwn(SQL_CAPABILITY_LEVELS, normalizedProfile)) throw error(400, "UNSUPPORTED_SQL_PROFILE_INVALID", "SQL profile must be one of the registered Q0-Q6 levels.");
  if (!UNSUPPORTED_RISK_CLASSES.includes(normalizedRisk)) throw error(400, "UNSUPPORTED_RISK_CLASS_INVALID", "Unsupported Recovery risk class is not registered.");
  return { transport: "sql", profile: normalizedProfile, profile_name: SQL_CAPABILITY_LEVELS[normalizedProfile], query_sha256: query_sha256 ? sha256(query_sha256, "query_sha256") : null, risk_class: normalizedRisk, parser_required: true, multi_statement_allowed: false, raw_sql_received: false, secrets_included: false };
}

export async function escalateUnsupportedRecovery(input = {}, { env = process.env, expectedSha, targetFingerprint, adminPrincipal, recoveryStore } = {}) {
  const body = exactKeys(input, ["incident_id", "expected_sha", "target_key", "reason", "finding_ids"], ["incident_id", "expected_sha", "reason"]);
  requireProductionPrincipal(adminPrincipal);
  const sha = exactSha(body.expected_sha || expectedSha);
  const target = targetKey(body.target_key);
  const reason = text(body.reason, 1000);
  if (reason.length < 12) throw error(400, "UNSUPPORTED_REASON_TOO_SHORT", "Unsupported Recovery escalation requires a specific operational reason.");
  const incident = incidentId(body.incident_id);
  const findings = Array.isArray(body.finding_ids) ? [...new Set(body.finding_ids.map((value) => safeId(value, "finding_id")))] : [];
  const record = {
    contract: brokerContractId,
    incident_id: incident,
    status: "awaiting_unsupported_approval",
    environment: "production_hostinger_autodeploy",
    expected_sha: sha,
    target_key: target,
    target_fingerprint: targetFingerprint || null,
    reason,
    finding_ids: findings,
    normal_recovery_required_first: true,
    ssh_sql_execution_enabled: false,
    temporary_authority_required: true,
    second_approval_required_for_destructive: true,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  };
  const result = { ok: true, ...record, incident_hash: hash(record), read_only_probe: true, mutation_attestation: { database_mutation_performed: false, provider_mutation_performed: false, secrets_included: false } };
  if (recoveryStore && typeof recoveryStore.putUnsupportedEscalation === "function") await recoveryStore.putUnsupportedEscalation(result);
  return result;
}

export async function previewSshSession(input = {}, deps = {}) {
  const body = exactKeys(input, ["incident_id", "expected_sha", "target_key", "profile", "command_sha256", "risk_class", "host_fingerprint"], ["incident_id", "expected_sha"]);
  requireProductionPrincipal(deps.adminPrincipal);
  const sha = exactSha(body.expected_sha);
  const target = targetKey(body.target_key);
  const classification = classifySshProfile(body);
  return {
    ok: true,
    contract: "mad4b.unsupported-ssh-preview.v1",
    incident_id: incidentId(body.incident_id),
    expected_sha: sha,
    target_key: target,
    host_fingerprint: body.host_fingerprint ? sha256(body.host_fingerprint, "fingerprint") : null,
    host_identity_pinned: Boolean(body.host_fingerprint),
    session_mode: "read_only",
    ttl_seconds: 1800,
    classification,
    broker_required: true,
    session_opened: false,
    execution_allowed: false,
    pty_allowed: false,
    max_commands: 50,
    egress_policy: "localhost_known_infrastructure_approved_vendor_only",
    reason: "Only a separately injected managed SSH broker may open the session after host identity pinning; local connector and free-form shell are excluded.",
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  };
}

export async function previewSqlSession(input = {}, deps = {}) {
  const body = exactKeys(input, ["incident_id", "expected_sha", "target_key", "target_role", "profile", "query_sha256", "risk_class"], ["incident_id", "expected_sha"]);
  requireProductionPrincipal(deps.adminPrincipal);
  const sha = exactSha(body.expected_sha);
  const target = targetKey(body.target_key);
  const targetRole = body.target_role ? text(body.target_role, 64) : "server_resolved";
  if (targetRole !== "server_resolved" && !["runtime", "governance", "runtime_persistence"].includes(targetRole)) throw error(403, "UNSUPPORTED_SQL_ROLE_INVALID", "SQL Recovery must bind to a registered role, never a caller-supplied DSN.");
  const classification = classifySqlProfile(body);
  return {
    ok: true,
    contract: "mad4b.unsupported-sql-preview.v1",
    incident_id: incidentId(body.incident_id),
    expected_sha: sha,
    target_key: target,
    target_role: targetRole,
    role_resolved: targetRole !== "server_resolved",
    session_mode: "metadata_only",
    ttl_seconds: 1800,
    classification,
    role_bound: true,
    role_values_server_resolved: true,
    session_opened: false,
    execution_allowed: false,
    reason: "Only a separately injected role-bound SQL broker may open the session; raw connection material and multi-statement SQL are excluded.",
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  };
}

export async function createEphemeralCapability(input = {}, deps = {}) {
  const body = exactKeys(input, ["incident_id", "expected_sha", "target_key", "target_role", "host_fingerprint", "transport", "capability_type", "artifact_sha256", "scope_ref", "expires_at", "single_use", "risk_class", "backup_evidence_ref"], ["incident_id", "expected_sha", "transport", "capability_type", "artifact_sha256", "scope_ref", "expires_at"]);
  requireProductionPrincipal(deps.adminPrincipal);
  const sha = exactSha(body.expected_sha);
  const target = targetKey(body.target_key);
  const transport = text(body.transport, 16).toLowerCase();
  if (!["ssh", "sql"].includes(transport)) throw error(400, "UNSUPPORTED_TRANSPORT_INVALID", "Ephemeral capability transport must be ssh or sql.");
  const targetRole = body.target_role ? text(body.target_role, 64) : "server_resolved";
  if (targetRole !== "server_resolved" && !["runtime", "governance", "runtime_persistence"].includes(targetRole)) throw error(403, "UNSUPPORTED_SQL_ROLE_INVALID", "Ephemeral SQL capability must bind to a registered role.");
  const expiresAt = new Date(body.expires_at);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + 30 * 60 * 1000) throw error(400, "UNSUPPORTED_CAPABILITY_TTL_INVALID", "Ephemeral capability expiry must be in the future and no more than thirty minutes away.");
  const record = {
    contract: "mad4b.ephemeral-recovery-capability.v1",
    capability_id: `ephemeral:${hash({ incident_id: body.incident_id, artifact_sha256: body.artifact_sha256, nonce: Date.now() }).slice(0, 32)}`,
    incident_id: incidentId(body.incident_id),
    expected_sha: sha,
    target_key: target,
    target_role: targetRole,
    host_fingerprint: body.host_fingerprint ? sha256(body.host_fingerprint, "fingerprint") : null,
    transport,
    capability_type: safeId(body.capability_type, "capability_type"),
    artifact_sha256: sha256(body.artifact_sha256, "artifact_sha256"),
    scope_ref: safeId(body.scope_ref, "scope_ref"),
    expires_at: expiresAt.toISOString(),
    single_use: body.single_use !== false,
    risk_class: UNSUPPORTED_RISK_CLASSES.includes(text(body.risk_class, 64)) ? text(body.risk_class, 64) : "unknown",
    backup_evidence_ref: body.backup_evidence_ref ? safeId(body.backup_evidence_ref, "backup_evidence_ref") : null,
    content_received: false,
    execution_allowed: false,
    broker_required: true,
    secrets_included: false,
  };
  if (deps.recoveryStore && typeof deps.recoveryStore.putEphemeralCapability === "function") await deps.recoveryStore.putEphemeralCapability(record);
  return { ok: true, ...record, capability_hash: hash(record), mutation_attestation: { database_mutation_performed: false, provider_mutation_performed: false, secrets_included: false } };
}

export async function executeUnsupportedCapability(input = {}, deps = {}) {
  const body = exactKeys(input, ["incident_id", "expected_sha", "target_key", "capability_id", "capability_hash", "approval_id", "idempotency_key"], ["incident_id", "expected_sha", "capability_id", "capability_hash", "approval_id", "idempotency_key"]);
  requireProductionPrincipal(deps.adminPrincipal);
  if (mutationDisabled(deps.env)) throw error(423, "RECOVERY_MUTATIONS_DISABLED", "Recovery mutations are disabled by the server kill-switch.");
  if (!deps.unsupportedBroker || typeof deps.unsupportedBroker.execute !== "function") throw error(503, "UNSUPPORTED_BROKER_UNAVAILABLE", "No managed Unsupported Recovery broker is configured; no SSH or SQL action was attempted.");
  return deps.unsupportedBroker.execute({
    incident_id: incidentId(body.incident_id),
    expected_sha: exactSha(body.expected_sha),
    target_key: targetKey(body.target_key),
    capability_id: safeId(body.capability_id, "capability_id"),
    capability_hash: sha256(body.capability_hash, "capability_hash"),
    approval_id: safeId(body.approval_id, "approval_id"),
    idempotency_key: safeId(body.idempotency_key, "idempotency_key"),
  });
}

export const _testingUnsupportedRecoveryBroker = Object.freeze({
  exactSha,
  incidentId,
  targetKey,
  sha256,
  SSH_DENYLIST,
  SQL_STATEMENT_CLASSES,
  mutationDisabled,
});
