import crypto from "node:crypto";
import { getPool } from "./db.js";

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

const SENSITIVE_KEY_PATTERN = /(password|access_token|refresh_token|client_secret|private_key|raw_secret|secret_value|api_key|bearer_token|smtp_password)/i;
const SAFE_SECRET_MARKER_KEYS = new Set(["secrets_included", "secret_value_included"]);

function assertNoRawSecretPayload(value, path = "payload") {
  if (value == null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SAFE_SECRET_MARKER_KEYS.has(String(key))) continue;
    if (SENSITIVE_KEY_PATTERN.test(String(key))) {
      const err = new Error("Raw secret values or secret-bearing fields are not accepted by adapter readiness checklists.");
      err.status = 400;
      err.code = "support_ticket_external_adapter_readiness_raw_value_rejected";
      err.path = `${path}.${key}`;
      throw err;
    }
    if (nested && typeof nested === "object") assertNoRawSecretPayload(nested, `${path}.${key}`);
  }
}

function checklistItemsForProposal(proposal = {}, adapter = {}) {
  const external = adapter.channel !== "internal";
  const common = [
    { item_key: "adapter_contract_registered", category: "contract", required: true, status: "passed", evidence: { adapter_key: adapter.adapter_key, family_key: adapter.family_key } },
    { item_key: "proposal_recorded", category: "governance", required: true, status: "passed", evidence: { proposal_id: proposal.proposal_id, proposal_status: proposal.proposal_status } },
    { item_key: "no_registry_mutation", category: "safety", required: true, status: proposal.registry_mutation_performed ? "failed" : "passed", evidence: { registry_mutation_performed: Boolean(proposal.registry_mutation_performed) } },
    { item_key: "no_external_send", category: "safety", required: true, status: proposal.external_send_performed ? "failed" : "passed", evidence: { external_send_performed: Boolean(proposal.external_send_performed) } },
    { item_key: "raw_secret_payload_blocked", category: "security", required: true, status: "passed", evidence: { raw_secret_payload_allowed: false } },
    { item_key: "idempotency_policy_defined", category: "dispatch_contract", required: true, status: adapter.idempotency_policy_json ? "passed" : "missing", evidence: parseJsonObject(adapter.idempotency_policy_json, {}) },
    { item_key: "rate_limit_policy_defined", category: "dispatch_contract", required: true, status: adapter.rate_limit_json ? "passed" : "missing", evidence: parseJsonObject(adapter.rate_limit_json, {}) },
    { item_key: "retry_policy_defined", category: "dispatch_contract", required: true, status: adapter.retry_policy_json ? "passed" : "missing", evidence: parseJsonObject(adapter.retry_policy_json, {}) },
    { item_key: "readback_policy_defined", category: "dispatch_contract", required: true, status: adapter.readback_policy_json ? "passed" : "missing", evidence: parseJsonObject(adapter.readback_policy_json, {}) },
    { item_key: "audit_policy_defined", category: "dispatch_contract", required: true, status: adapter.audit_policy_json ? "passed" : "missing", evidence: parseJsonObject(adapter.audit_policy_json, {}) },
  ];
  const externalItems = external ? [
    { item_key: "adapter_implementation_pr_required", category: "implementation", required: true, status: "blocked_until_future_pr", evidence: { implementation_status: adapter.implementation_status } },
    { item_key: "provider_dispatch_policy_required", category: "governance", required: true, status: "blocked_until_future_policy", evidence: { provider_dispatch_enabled: Boolean(adapter.provider_dispatch_enabled) } },
    { item_key: "adapter_dispatch_policy_required", category: "governance", required: true, status: "blocked_until_future_policy", evidence: { dispatch_enabled: Boolean(adapter.dispatch_enabled) } },
    { item_key: "credential_validation_gate_required", category: "credential", required: Boolean(adapter.required_credential_type), status: adapter.required_credential_type ? "required_before_dispatch" : "not_required", evidence: { required_credential_type: adapter.required_credential_type || null } },
    { item_key: "delivery_approval_required", category: "approval", required: true, status: "required_before_dispatch", evidence: { approval_type: "external_notification_delivery" } },
    { item_key: "final_provider_gate_required", category: "approval", required: true, status: "required_before_dispatch", evidence: { provider_gate: "support_ticket_external_send_provider_gate_plan" } },
    { item_key: "provider_send_mode_remains_blocked", category: "safety", required: true, status: "passed", evidence: { requested_mode: proposal.requested_mode, provider_send_blocked: true } },
  ] : [
    { item_key: "internal_record_only_adapter", category: "implementation", required: true, status: "passed", evidence: { implementation_status: adapter.implementation_status, external_send_supported: false } },
  ];
  return [...common, ...externalItems];
}

function summarizeChecklist(items = []) {
  const failed = items.filter((item) => item.status === "failed");
  const missing = items.filter((item) => item.status === "missing");
  const blocked = items.filter((item) => String(item.status || "").startsWith("blocked_") || String(item.status || "").startsWith("required_"));
  return {
    item_count: items.length,
    failed_count: failed.length,
    missing_count: missing.length,
    blocked_count: blocked.length,
    readiness_status: failed.length ? "failed_safety_violation" : missing.length ? "incomplete_contract" : blocked.length ? "blocked_until_future_implementation_and_policy" : "ready_internal_record_only",
    external_send_performed: false,
    secrets_included: false,
  };
}

async function fetchProposalAndAdapter(connection, proposal_id) {
  const [rows] = await connection.query(
    `SELECT p.*, a.implementation_status, a.dispatch_enabled, a.provider_dispatch_enabled,
            a.required_credential_type, a.supported_audiences_json, a.send_modes_json,
            a.payload_schema_json, a.preflight_schema_json, a.rate_limit_json,
            a.retry_policy_json, a.idempotency_policy_json, a.readback_policy_json,
            a.audit_policy_json, a.safety_json, a.status AS adapter_status
       FROM external_delivery_provider_adapter_enablement_proposals p
       JOIN external_delivery_provider_adapter_contract_registry a ON a.adapter_key = p.adapter_key
      WHERE p.proposal_id = ?
      LIMIT 1`,
    [proposal_id]
  );
  return rows[0] || null;
}

export async function planSupportTicketExternalAdapterReadinessChecklist({ proposal_id, evidence_json = {} } = {}, options = {}) {
  if (!proposal_id) {
    const err = new Error("proposal_id is required.");
    err.status = 400;
    err.code = "support_ticket_external_adapter_readiness_proposal_required";
    throw err;
  }
  assertNoRawSecretPayload(evidence_json, "evidence_json");
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    const row = await fetchProposalAndAdapter(connection, proposal_id);
    if (!row) {
      const err = new Error("External provider enablement proposal not found.");
      err.status = 404;
      err.code = "support_ticket_external_provider_enablement_proposal_not_found";
      throw err;
    }
    const adapter = {
      adapter_key: row.adapter_key,
      family_key: row.family_key,
      channel: row.channel,
      implementation_status: row.implementation_status,
      dispatch_enabled: Boolean(row.dispatch_enabled),
      provider_dispatch_enabled: Boolean(row.provider_dispatch_enabled),
      required_credential_type: row.required_credential_type || null,
      status: row.adapter_status,
      idempotency_policy_json: row.idempotency_policy_json,
      rate_limit_json: row.rate_limit_json,
      retry_policy_json: row.retry_policy_json,
      readback_policy_json: row.readback_policy_json,
      audit_policy_json: row.audit_policy_json,
      external_send_performed: false,
      secrets_included: false,
    };
    const proposal = {
      proposal_id: row.proposal_id,
      adapter_key: row.adapter_key,
      requested_mode: row.requested_mode,
      proposal_status: row.proposal_status,
      registry_mutation_performed: Boolean(row.registry_mutation_performed),
      external_send_performed: Boolean(row.external_send_performed),
      evidence_json: parseJsonObject(row.evidence_json, {}),
      secrets_included: false,
    };
    const items = checklistItemsForProposal(proposal, adapter);
    const summary = summarizeChecklist(items);
    return { ok: true, mode: "dry_run", proposal, adapter, checklist: { summary, items }, evidence_json: { ...(evidence_json || {}), external_send_performed: false, secrets_included: false }, external_send_performed: false, secret_value_included: false, secrets_included: false };
  } finally { if (ownsConnection) connection.release(); }
}

export async function recordSupportTicketExternalAdapterReadinessChecklist({ proposal_id, evidence_json = {}, actor_id = null, actor_type = "admin" } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const planned = await planSupportTicketExternalAdapterReadinessChecklist({ proposal_id, evidence_json }, { connection });
    const checklistId = crypto.randomUUID();
    await connection.query(
      `INSERT INTO external_delivery_provider_adapter_readiness_checklists
       (checklist_id, proposal_id, adapter_key, readiness_status, summary_json, checklist_json,
        evidence_json, recorded_by, registry_mutation_performed, external_send_performed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [checklistId, proposal_id, planned.adapter.adapter_key, planned.checklist.summary.readiness_status,
       JSON.stringify(planned.checklist.summary), JSON.stringify(planned.checklist.items),
       JSON.stringify({ ...(evidence_json || {}), external_send_performed: false, secrets_included: false }), actor_id]
    );
    await connection.query(
      `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
       VALUES (UUID(), '00000000-0000-0000-0000-000000000000', ?, ?, 'support_ticket_external_adapter_readiness_checklist_recorded', 'external_delivery_provider_adapter_enablement_proposal', ?, ?, 'managed')`,
      [actor_id || "admin_system", actor_type, proposal_id, JSON.stringify({ checklist_id: checklistId, readiness_status: planned.checklist.summary.readiness_status, registry_mutation_performed: false, external_send_performed: false, secrets_included: false })]
    );
    if (ownsConnection) await connection.commit();
    return { ok: true, mode: "record_checklist", checklist_id: checklistId, ...planned, external_send_performed: false, secret_value_included: false, secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}
