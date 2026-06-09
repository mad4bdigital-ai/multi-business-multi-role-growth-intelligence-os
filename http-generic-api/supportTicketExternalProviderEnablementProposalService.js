import crypto from "node:crypto";
import { getPool } from "./db.js";

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeLimit(limit = 50) {
  return Math.min(Math.max(Number(limit) || 50, 1), 200);
}

const SENSITIVE_KEY_PATTERN = /(password|access_token|refresh_token|client_secret|private_key|raw_secret|secret_value|api_key|bearer_token|smtp_password)/i;
const SAFE_SECRET_MARKER_KEYS = new Set(["secrets_included", "secret_value_included"]);

function assertNoRawSecretPayload(value, path = "payload") {
  if (value == null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SAFE_SECRET_MARKER_KEYS.has(String(key))) continue;
    if (SENSITIVE_KEY_PATTERN.test(String(key))) {
      const err = new Error("Raw secret values or secret-bearing fields are not accepted by provider enablement proposals.");
      err.status = 400;
      err.code = "support_ticket_external_provider_enablement_raw_value_rejected";
      err.path = `${path}.${key}`;
      throw err;
    }
    if (nested && typeof nested === "object") assertNoRawSecretPayload(nested, `${path}.${key}`);
  }
}

function sanitizeAdapter(row = {}) {
  return {
    adapter_key: row.adapter_key,
    family_key: row.family_key,
    family_status: row.family_status,
    channel: row.channel,
    implementation_status: row.implementation_status,
    dispatch_enabled: Boolean(row.dispatch_enabled),
    provider_dispatch_enabled: Boolean(row.provider_dispatch_enabled),
    required_credential_type: row.required_credential_type || null,
    supported_audiences: parseJsonObject(row.supported_audiences_json, []),
    send_modes: parseJsonObject(row.send_modes_json, []),
    preflight_schema: parseJsonObject(row.preflight_schema_json, {}),
    rate_limit: parseJsonObject(row.rate_limit_json, {}),
    retry_policy: parseJsonObject(row.retry_policy_json, {}),
    idempotency_policy: parseJsonObject(row.idempotency_policy_json, {}),
    readback_policy: parseJsonObject(row.readback_policy_json, {}),
    audit_policy: parseJsonObject(row.audit_policy_json, {}),
    safety: parseJsonObject(row.safety_json, {}),
    status: row.status,
    external_send_performed: false,
    secret_value_included: false,
    secrets_included: false,
  };
}

function enablementGateChecklist(adapter) {
  const external = adapter.channel !== "internal";
  return [
    { gate_key: "adapter_implementation_pr", required: external, status: external ? "required_future_pr" : "not_required_internal_record_only" },
    { gate_key: "provider_dispatch_policy", required: external, status: external ? "requires_separate_approval_and_migration" : "not_required" },
    { gate_key: "credential_reference_active_validated", required: Boolean(adapter.required_credential_type), status: adapter.required_credential_type ? "required_before_dispatch" : "not_required" },
    { gate_key: "delivery_approval_hold", required: external, status: external ? "required_before_dispatch" : "not_required" },
    { gate_key: "final_provider_gate", required: external, status: external ? "required_before_dispatch" : "not_required" },
    { gate_key: "rate_limit_policy", required: true, status: "defined_in_contract" },
    { gate_key: "idempotency_policy", required: true, status: "defined_in_contract" },
    { gate_key: "readback_policy", required: true, status: "defined_in_contract" },
    { gate_key: "audit_policy", required: true, status: "defined_in_contract" },
    { gate_key: "no_raw_secret_payload", required: true, status: "enforced" },
  ];
}

function buildEnablementCandidate(row = {}) {
  const adapter = sanitizeAdapter(row);
  const external = adapter.channel !== "internal";
  const currentState = {
    implementation_status: adapter.implementation_status,
    dispatch_enabled: adapter.dispatch_enabled,
    provider_dispatch_enabled: adapter.provider_dispatch_enabled,
    status: adapter.status,
    external_send_performed: false,
    secrets_included: false,
  };
  const proposedTarget = external
    ? { implementation_status: "future_implemented_after_pr", dispatch_enabled: false, provider_dispatch_enabled: false, external_send_performed: false }
    : { implementation_status: adapter.implementation_status, dispatch_enabled: adapter.dispatch_enabled, provider_dispatch_enabled: false, external_send_performed: false };
  const blockers_to_actual_enablement = [];
  if (external && adapter.implementation_status !== "implemented") blockers_to_actual_enablement.push("adapter_implementation_missing");
  if (external && !adapter.provider_dispatch_enabled) blockers_to_actual_enablement.push("provider_dispatch_disabled_by_policy");
  if (external && !adapter.dispatch_enabled) blockers_to_actual_enablement.push("adapter_dispatch_disabled_by_policy");
  if (external && adapter.safety?.external_send_supported !== true) blockers_to_actual_enablement.push("external_send_supported_false_by_contract");
  return {
    adapter,
    proposal_allowed: true,
    proposal_only: true,
    current_state: currentState,
    proposed_target: proposedTarget,
    gates_required_before_any_future_enablement: enablementGateChecklist(adapter),
    blockers_to_actual_enablement,
    external_send_performed: false,
    secret_value_included: false,
    secrets_included: false,
  };
}

async function fetchAdapter(connection, adapter_key) {
  const [rows] = await connection.query(
    `SELECT a.*, f.status AS family_status
       FROM external_delivery_provider_adapter_contract_registry a
       JOIN external_delivery_provider_family_registry f ON f.family_key = a.family_key
      WHERE a.adapter_key = ?
      LIMIT 1`,
    [adapter_key]
  );
  return rows[0] || null;
}

export async function listSupportTicketExternalProviderEnablementCandidates({ family_key = null, channel = null, adapter_key = null, include_internal = false, limit = 50 } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    const filters = [];
    const params = [];
    if (family_key) { filters.push("a.family_key = ?"); params.push(family_key); }
    if (channel) { filters.push("a.channel = ?"); params.push(channel); }
    if (adapter_key) { filters.push("a.adapter_key = ?"); params.push(adapter_key); }
    if (!include_internal) filters.push("a.channel <> 'internal'");
    const [rows] = await connection.query(
      `SELECT a.*, f.status AS family_status
         FROM external_delivery_provider_adapter_contract_registry a
         JOIN external_delivery_provider_family_registry f ON f.family_key = a.family_key
        ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY a.family_key ASC, a.adapter_key ASC
        LIMIT ?`,
      [...params, normalizeLimit(limit)]
    );
    const candidates = rows.map(buildEnablementCandidate);
    return {
      ok: true,
      mode: "read_only",
      proposal_only: true,
      count: candidates.length,
      candidates,
      external_send_performed: false,
      secret_value_included: false,
      secrets_included: false,
    };
  } finally { if (ownsConnection) connection.release(); }
}

export async function proposeSupportTicketExternalProviderAdapterEnablement({ adapter_key, requested_mode = "provider_send_blocked", requested_by = null, reason = null, evidence_json = {}, proposed_target_json = {} } = {}, options = {}) {
  if (!adapter_key) {
    const err = new Error("adapter_key is required.");
    err.status = 400;
    err.code = "support_ticket_external_provider_adapter_key_required";
    throw err;
  }
  assertNoRawSecretPayload(evidence_json, "evidence_json");
  assertNoRawSecretPayload(proposed_target_json, "proposed_target_json");
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const row = await fetchAdapter(connection, adapter_key);
    if (!row) {
      const err = new Error("External provider adapter contract not found.");
      err.status = 404;
      err.code = "support_ticket_external_provider_adapter_not_found";
      throw err;
    }
    const candidate = buildEnablementCandidate(row);
    const proposalId = crypto.randomUUID();
    const proposal = {
      proposal_id: proposalId,
      adapter_key,
      family_key: row.family_key,
      channel: row.channel,
      requested_mode,
      proposal_status: "proposed",
      proposal_only: true,
      current_state: candidate.current_state,
      proposed_target: {
        ...candidate.proposed_target,
        ...(proposed_target_json && typeof proposed_target_json === "object" ? proposed_target_json : {}),
        external_send_performed: false,
        secrets_included: false,
      },
      required_gates: candidate.gates_required_before_any_future_enablement,
      blockers_to_actual_enablement: candidate.blockers_to_actual_enablement,
      reason,
      evidence_json: { ...(evidence_json || {}), external_send_performed: false, secrets_included: false },
      registry_mutation_performed: false,
      external_send_performed: false,
      secret_value_included: false,
      secrets_included: false,
    };
    await connection.query(
      `INSERT INTO external_delivery_provider_adapter_enablement_proposals
       (proposal_id, adapter_key, family_key, channel, requested_mode, proposal_status,
        requested_by, reason, current_state_json, proposed_target_json, required_gates_json,
        blockers_json, evidence_json, registry_mutation_performed, external_send_performed)
       VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [proposalId, adapter_key, row.family_key, row.channel, requested_mode, requested_by, reason,
       JSON.stringify(proposal.current_state), JSON.stringify(proposal.proposed_target),
       JSON.stringify(proposal.required_gates), JSON.stringify(proposal.blockers_to_actual_enablement),
       JSON.stringify(proposal.evidence_json)]
    );
    await connection.query(
      `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
       VALUES (UUID(), '00000000-0000-0000-0000-000000000000', ?, 'admin', 'support_ticket_external_provider_adapter_enablement_proposed', 'external_delivery_provider_adapter_contract', ?, ?, 'managed')`,
      [requested_by || "admin_system", adapter_key, JSON.stringify(proposal)]
    );
    if (ownsConnection) await connection.commit();
    return { ok: true, mode: "proposal_only", proposal, adapter_after: sanitizeAdapter(row), external_send_performed: false, secret_value_included: false, secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}
