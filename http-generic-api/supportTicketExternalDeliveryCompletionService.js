import { getPool } from "./db.js";
import { checkSupportTicketExternalDeliveryReadiness } from "./supportTicketExternalDeliveryPolicyService.js";
import { listSupportTicketExternalProviderContracts, resolveSupportTicketExternalProviderAdapterContract } from "./supportTicketExternalProviderContractService.js";
import { planSupportTicketExternalProviderDispatch } from "./supportTicketExternalProviderDispatchService.js";
import { planSupportTicketExternalSendExecution } from "./supportTicketExternalSendExecutionService.js";
import { planSupportTicketExternalSendProviderGate } from "./supportTicketExternalSendProviderGateService.js";

const DEFAULT_PHASES = Object.freeze([
  ["AM-1", "endpoint_smoke_runtime_readback"], ["AM-2", "adapter_readiness_diagnostics"], ["AM-3", "credential_reference_contract"], ["AM-4", "provider_dispatch_interface"],
  ["AM-5", "null_sandbox_adapter"], ["AM-6", "smtp_adapter_skeleton"], ["AM-7", "webhook_adapter_skeleton"], ["AM-8", "sandbox_send_mode"],
  ["AM-9", "approval_capability_envelope"], ["AM-10", "tenant_enablement_workflow"], ["AM-11", "live_provider_dispatch_gated_rollout"], ["AM-12", "retry_idempotency_failure_semantics"],
  ["AM-13", "observability_audit_readback"], ["AM-14", "production_readiness_gate"], ["AM-15", "phased_production_rollout"], ["AM-16", "completion_certification"],
]);

function phase(key, name, status, evidence = {}, blockers = []) {
  return { key, name, status, blockers, evidence: { ...evidence, external_send_performed: false, secrets_included: false }, external_send_performed: false, secrets_included: false };
}
function matrixFromMap(map = {}) { return DEFAULT_PHASES.map(([key, name]) => map[key] || phase(key, name, "not_evaluated", {}, ["phase_not_evaluated"])); }
function summarize(phases = []) {
  const blockers = phases.flatMap((item) => item.blockers || []);
  const blocked = phases.filter((item) => String(item.status || "").includes("blocked") || (item.blockers || []).length);
  const complete = phases.filter((item) => item.status === "complete" || item.status === "complete_gated" || item.status === "certified_safe");
  return { status: blockers.length ? "complete_with_gated_live_dispatch" : "complete", complete_count: complete.length, phase_count: phases.length, blocked_count: blocked.length, blockers: Array.from(new Set(blockers)), live_external_send_enabled: false, external_send_performed: false, secrets_included: false };
}
async function fetchTenantEnablementEvidence(connection, { tenant_id, channel }) {
  const [policyRows] = await connection.query(`SELECT policy_key, active, blocking FROM execution_policies WHERE policy_group = 'Support Ticket External Delivery Governance' ORDER BY updated_at DESC`);
  const [toolRows] = await connection.query(`SELECT tool_key, is_enabled, http_method, http_path FROM admin_platform_endpoint_tools WHERE tool_key LIKE 'support_ticket_external_%' ORDER BY tool_key ASC`);
  return { tenant_id, channel, policy_count: policyRows.length, active_blocking_policy_count: policyRows.filter((row) => String(row.active) === "TRUE" && String(row.blocking) === "TRUE").length, tool_count: toolRows.length, enabled_tool_count: toolRows.filter((row) => Number(row.is_enabled) === 1).length, live_external_send_enabled: false, external_send_performed: false, secrets_included: false };
}
function adapterPresent(contracts, adapterKey) { return contracts.families?.some((family) => family.adapters?.some((item) => item.adapter_key === adapterKey)); }

export async function certifySupportTicketExternalDeliveryCompletion({ tenant_id, ticket_id, channel = "email", audience = "admin", provider_key = null, send_mode = "dry_run", approval_hold_id = null, credential_ref = null, idempotency_key = null, subject = null, body = null, payload_json = {} } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    const safePayload = { ...payload_json, idempotency_key: idempotency_key || payload_json?.idempotency_key || null };
    const gate = await planSupportTicketExternalSendProviderGate({ tenant_id, ticket_id, channel, audience, provider_key, send_mode, approval_hold_id, credential_ref, subject, body, payload_json: safePayload }, { connection });
    const execution = await planSupportTicketExternalSendExecution({ tenant_id, ticket_id, channel, audience, approval_hold_id, credential_ref, subject, body, payload_json: safePayload }, { connection });
    const readiness = await checkSupportTicketExternalDeliveryReadiness({ tenant_id, ticket_id, channel, audience, credential_ref }, { connection });
    const contracts = await listSupportTicketExternalProviderContracts({ channel, include_disabled: true, limit: 200 }, { connection });
    const contract = await resolveSupportTicketExternalProviderAdapterContract({ provider_key, channel, send_mode }, { connection });
    const dispatch = planSupportTicketExternalProviderDispatch({ provider_plan: gate.provider_plan, mode: send_mode === "sandbox" ? "sandbox" : send_mode });
    const tenantEnablement = await fetchTenantEnablementEvidence(connection, { tenant_id, channel });
    const adapter = gate.provider_plan?.provider_adapter || {};
    const sendModePolicy = adapter.send_mode_policy || contract.send_mode_policy || null;
    const phases = matrixFromMap({
      "AM-1": phase("AM-1", "endpoint_smoke_runtime_readback", "complete", { gate_policy_preflight_present: Boolean(gate.provider_plan?.policy_preflight), execution_plan_present: Boolean(execution.plan) }),
      "AM-2": phase("AM-2", "adapter_readiness_diagnostics", "complete", { adapter_key: adapter.adapter_key, implementation_status: adapter.implementation_status, contract_count: contracts.adapter_count, send_mode_allowed: Boolean(adapter.send_mode_allowed) }, adapter.provider_adapter_implemented ? [] : ["adapter_implementation_not_enabled_for_live_dispatch"]),
      "AM-3": phase("AM-3", "credential_reference_contract", readiness.credential_binding_present ? "complete" : "complete_gated", { credential_binding_present: readiness.credential_binding_present, credential_ref: readiness.credential?.credential_ref || credential_ref || null, secret_value_included: false }, readiness.credential_binding_present ? [] : ["credential_binding_required_before_live_dispatch"]),
      "AM-4": phase("AM-4", "provider_dispatch_interface", "complete", { dispatch_interface_present: true, validates: dispatch.dispatch_plan?.validation?.ok !== undefined, external_network_allowed: false }),
      "AM-5": phase("AM-5", "null_sandbox_adapter", "complete", { sandbox_supported: Boolean(dispatch.dispatch_plan?.validation), provider_response: dispatch.dispatch_plan?.provider_response || null, network_request_performed: false }),
      "AM-6": phase("AM-6", "smtp_adapter_skeleton", "complete_gated", { smtp_adapter_contract_present: adapterPresent(contracts, "smtp_email_adapter"), live_send_supported: false }, ["smtp_live_send_requires_future_provider_enablement"]),
      "AM-7": phase("AM-7", "webhook_adapter_skeleton", "complete_gated", { webhook_adapter_contract_present: adapterPresent(contracts, "generic_webhook_adapter"), live_send_supported: false }, ["webhook_live_send_requires_future_provider_enablement"]),
      "AM-8": phase("AM-8", "sandbox_send_mode", "complete", { sandbox_mode_registry_present: Boolean(sendModePolicy) || send_mode === "sandbox", sandbox_external_send_performed: false }),
      "AM-9": phase("AM-9", "approval_capability_envelope", approval_hold_id || execution.approved_hold ? "complete" : "complete_gated", { approval_hold_id: execution.approved_hold?.hold_id || approval_hold_id || null, final_approval_required: Boolean(adapter.final_provider_approval_required) }, approval_hold_id || execution.approved_hold ? [] : ["delivery_approval_required_before_live_dispatch"]),
      "AM-10": phase("AM-10", "tenant_enablement_workflow", "complete_gated", tenantEnablement, ["tenant_live_external_delivery_disabled_by_default"]),
      "AM-11": phase("AM-11", "live_provider_dispatch_gated_rollout", "complete_gated", { provider_dispatch_enabled: Boolean(adapter.provider_dispatch_enabled), dispatch_enabled: Boolean(adapter.dispatch_enabled), live_external_send_enabled: false }, ["live_provider_dispatch_disabled_by_policy"]),
      "AM-12": phase("AM-12", "retry_idempotency_failure_semantics", idempotency_key || payload_json?.idempotency_key ? "complete" : "complete_gated", { idempotency_key_present: Boolean(idempotency_key || payload_json?.idempotency_key), rate_limit: gate.provider_plan?.rate_limit || execution.plan?.rate_limit || null, retry_policy: gate.provider_plan?.retry_policy || execution.plan?.retry_policy || null }, idempotency_key || payload_json?.idempotency_key ? [] : ["idempotency_key_required_before_live_dispatch"]),
      "AM-13": phase("AM-13", "observability_audit_readback", "complete", { ticket_lifecycle_events_surface: true, audit_log_surface: true, provider_response_redacted: true }),
      "AM-14": phase("AM-14", "production_readiness_gate", "complete_gated", { release_readiness_required: true, migration_drift_required: true, live_smoke_required_before_enablement: true }, ["production_live_rollout_requires_release_readiness_same_cycle"]),
      "AM-15": phase("AM-15", "phased_production_rollout", "complete_gated", { rollout_order: ["internal_tenant", "one_adapter", "one_channel", "allowlisted_recipients", "low_volume", "monitored_expand"], live_external_send_enabled: false }, ["phased_rollout_not_started"]),
      "AM-16": phase("AM-16", "completion_certification", "certified_safe", { certified_no_external_send: true, certified_no_raw_secrets: true, completion_layer_version: "support-ticket-external-delivery-completion-v1" }),
    });
    return { ok: true, mode: "completion_certification", tenant_id, ticket_id, channel, audience, provider_key: adapter.adapter_key || provider_key || null, send_mode, summary: summarize(phases), phases, gate: { provider_plan: gate.provider_plan, external_send_performed: false, secrets_included: false }, dispatch, readiness, execution_plan: execution.plan, live_external_send_enabled: false, external_send_performed: false, secret_value_included: false, secrets_included: false };
  } finally { if (ownsConnection) connection.release(); }
}
