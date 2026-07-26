import crypto from "node:crypto";
import { getPool } from "./db.js";

const SENSITIVE_KEY_PATTERN = /(password|access_token|refresh_token|client_secret|private_key|raw_secret|secret_value|api_key|bearer_token|smtp_password)/i;
const SAFE_SECRET_MARKER_KEYS = new Set(["secrets_included", "secret_value_included"]);

function assertNoRawSecretPayload(value, path = "payload") {
  if (value == null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SAFE_SECRET_MARKER_KEYS.has(String(key))) continue;
    if (SENSITIVE_KEY_PATTERN.test(String(key))) {
      const err = new Error("Raw secret values or secret-bearing fields are not accepted by future PR scopes.");
      err.status = 400;
      err.code = "support_ticket_external_adapter_future_pr_scope_raw_value_rejected";
      err.path = `${path}.${key}`;
      throw err;
    }
    if (nested && typeof nested === "object") assertNoRawSecretPayload(nested, `${path}.${key}`);
  }
}

async function fetchDecisionContext(connection, decision_id) {
  const [rows] = await connection.query(
    `SELECT d.decision_id, d.checklist_id, d.proposal_id, d.adapter_key, d.decision,
            d.registry_mutation_performed, d.adapter_implementation_performed,
            d.dispatch_enabled_changed, d.provider_dispatch_enabled_changed,
            d.external_send_performed,
            p.requested_mode,
            a.family_key, a.channel, a.implementation_status, a.dispatch_enabled,
            a.provider_dispatch_enabled, a.required_credential_type, a.status AS adapter_status
       FROM external_delivery_provider_adapter_readiness_decisions d
       JOIN external_delivery_provider_adapter_enablement_proposals p ON p.proposal_id = d.proposal_id
       JOIN external_delivery_provider_adapter_contract_registry a ON a.adapter_key = d.adapter_key
      WHERE d.decision_id = ?
      LIMIT 1`,
    [decision_id]
  );
  return rows[0] || null;
}

function safeAdapterName(adapterKey) {
  return String(adapterKey || "external_adapter").replace(/[^a-zA-Z0-9_]/g, "_");
}

function buildScope(context, evidence_json = {}) {
  if (!context) {
    const err = new Error("Adapter readiness decision not found.");
    err.status = 404;
    err.code = "support_ticket_external_adapter_readiness_decision_not_found";
    throw err;
  }
  if (context.decision !== "approve_for_future_pr") {
    const err = new Error("Future PR scope requires an approve_for_future_pr decision.");
    err.status = 409;
    err.code = "support_ticket_external_adapter_future_pr_scope_decision_not_approved";
    throw err;
  }
  const unsafe = context.external_send_performed || context.registry_mutation_performed || context.adapter_implementation_performed || context.dispatch_enabled_changed || context.provider_dispatch_enabled_changed;
  if (unsafe) {
    const err = new Error("Future PR scope cannot be generated from a decision that already performed mutation or external send.");
    err.status = 409;
    err.code = "support_ticket_external_adapter_future_pr_scope_decision_not_safe";
    throw err;
  }
  const adapterName = safeAdapterName(context.adapter_key);
  return {
    scope_status: "generated_scope_only",
    decision_id: context.decision_id,
    checklist_id: context.checklist_id,
    proposal_id: context.proposal_id,
    adapter_key: context.adapter_key,
    family_key: context.family_key,
    channel: context.channel,
    requested_mode: context.requested_mode,
    current_adapter_state: {
      implementation_status: context.implementation_status,
      dispatch_enabled: Boolean(context.dispatch_enabled),
      provider_dispatch_enabled: Boolean(context.provider_dispatch_enabled),
      status: context.adapter_status,
      external_send_performed: false,
      secrets_included: false,
    },
    proposed_pr_title: `Implement ${context.adapter_key} external delivery adapter behind gated dispatch`,
    proposed_branch_prefix: `gpt/external-adapter-${String(context.adapter_key).replace(/_/g, "-")}`,
    implementation_files: [
      `http-generic-api/providers/externalDelivery/${adapterName}.js`,
      `http-generic-api/providers/externalDelivery/${adapterName}.test.mjs`,
      "http-generic-api/supportTicketExternalSendProviderGateService.js",
      "http-generic-api/routes/supportTicketRoutes.js",
      "http-generic-api/scripts/test-manifest.mjs",
      `http-generic-api/migrations/<future>_sprint68_${adapterName}_implementation_registry.sql`,
    ],
    required_tests: [
      `node providers/externalDelivery/${adapterName}.test.mjs`,
      "node test-ticket-external-send-provider-gate.mjs",
      "node test-ticket-external-provider-adapter-contracts.mjs",
      "node test-ticket-external-adapter-readiness-decision.mjs",
      "node --check routes/supportTicketRoutes.js",
      "node --check supportTicketExternalSendProviderGateService.js",
    ],
    required_gates: [
      "implementation_pr_required",
      "unit_tests_required",
      "payload_schema_validation_required",
      "credential_ref_only_no_secret_payload_required",
      "idempotency_key_required",
      "rate_limit_and_retry_policy_required",
      "provider_readback_required",
      "audit_and_timeline_record_required",
      "provider_dispatch_policy_required_after_implementation",
      "release_readiness_required",
      "no_external_send_in_scope_generator",
    ],
    out_of_scope: [
      "Enabling provider_dispatch_enabled",
      "Enabling dispatch_enabled for external adapters",
      "Sending any external email/webhook",
      "Reading or returning raw secret values",
      "Bypassing delivery approval or final provider gate",
    ],
    evidence_json: { ...(evidence_json || {}), external_send_performed: false, secrets_included: false },
    registry_mutation_performed: false,
    adapter_implementation_performed: false,
    dispatch_enabled_changed: false,
    provider_dispatch_enabled_changed: false,
    external_send_performed: false,
    secret_value_included: false,
    secrets_included: false,
  };
}

export async function planSupportTicketExternalAdapterFuturePrScope({ decision_id, evidence_json = {} } = {}, options = {}) {
  if (!decision_id) {
    const err = new Error("decision_id is required.");
    err.status = 400;
    err.code = "support_ticket_external_adapter_future_pr_scope_decision_required";
    throw err;
  }
  assertNoRawSecretPayload(evidence_json, "evidence_json");
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    const context = await fetchDecisionContext(connection, decision_id);
    return { ok: true, mode: "dry_run", scope: buildScope(context, evidence_json), external_send_performed: false, secret_value_included: false, secrets_included: false };
  } finally { if (ownsConnection) connection.release(); }
}

export async function recordSupportTicketExternalAdapterFuturePrScope({ decision_id, evidence_json = {}, actor_id = null, actor_type = "admin" } = {}, options = {}) {
  if (!decision_id) {
    const err = new Error("decision_id is required.");
    err.status = 400;
    err.code = "support_ticket_external_adapter_future_pr_scope_decision_required";
    throw err;
  }
  assertNoRawSecretPayload(evidence_json, "evidence_json");
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const context = await fetchDecisionContext(connection, decision_id);
    const scope = buildScope(context, evidence_json);
    const scopeId = crypto.randomUUID();
    await connection.query(
      `INSERT INTO external_delivery_provider_adapter_future_pr_scopes
       (scope_id, decision_id, checklist_id, proposal_id, adapter_key, family_key, channel,
        scope_status, scope_json, evidence_json, recorded_by, actor_type,
        registry_mutation_performed, adapter_implementation_performed,
        dispatch_enabled_changed, provider_dispatch_enabled_changed, external_send_performed)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'generated_scope_only', ?, ?, ?, ?, 0, 0, 0, 0, 0)`,
      [scopeId, decision_id, scope.checklist_id, scope.proposal_id, scope.adapter_key,
       scope.family_key, scope.channel, JSON.stringify(scope), JSON.stringify(scope.evidence_json),
       actor_id || "admin_system", actor_type]
    );
    await connection.query(
      `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
       VALUES (UUID(), '00000000-0000-0000-0000-000000000000', ?, ?, 'support_ticket_external_adapter_future_pr_scope_recorded', 'external_delivery_provider_adapter_readiness_decision', ?, ?, 'managed')`,
      [actor_id || "admin_system", actor_type, decision_id, JSON.stringify({ scope_id: scopeId, ...scope })]
    );
    if (ownsConnection) await connection.commit();
    return { ok: true, mode: "record_scope", scope_id: scopeId, scope, external_send_performed: false, secret_value_included: false, secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}
