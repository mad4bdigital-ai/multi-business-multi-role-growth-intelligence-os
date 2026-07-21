import crypto from "node:crypto";
import { validateExecutionConcurrencyControl } from "./platformExecutionConcurrencyKernel.js";

function safeText(value = "", max = 255) { return String(value ?? "").trim().slice(0, max); }
function bool(value) { return value === true || Number(value || 0) === 1; }
function failure(status, details = {}) { return { ok: false, status, ...details, provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false }; }
export function stableAdapterJson(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map((item) => stableAdapterJson(item)).join(",")}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableAdapterJson(value[key])}`).join(",")}}`; }
export function adapterHash(value) { return crypto.createHash("sha256").update(stableAdapterJson(value)).digest("hex"); }
function normalizeList(value = []) { const source = Array.isArray(value) ? value : String(value || "").split(","); return [...new Set(source.map((item) => safeText(item, 128)).filter(Boolean))].sort(); }
function adapterManifest(binding = {}) { return { binding_version: binding.binding_version, adapter_binding_id: binding.adapter_binding_id, adapter_key: binding.adapter_key, provider_key: binding.provider_key, capability_key: binding.capability_key, boundary_key: binding.boundary_key, resource_type: binding.resource_type, operations: binding.operations, certification_requirements: binding.certification_requirements, readback_contract_hash: binding.readback_contract_hash, drift_policy_hash: binding.drift_policy_hash, priority: binding.priority, provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false }; }
function certificationManifest(certification = {}) { return { certification_version: certification.certification_version, adapter_binding_id: certification.adapter_binding_id, execution_control_hash: certification.execution_control_hash, binding_hash: certification.binding_hash, certification_status: certification.certification_status, checks_hash: certification.checks_hash, provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false }; }

export function buildAdapterBinding({ adapter_key = "", provider_key = "", capability_key = "", boundary_key = "", resource_type = "", operations = [], certification_requirements = [], readback_contract = {}, drift_policy = {}, priority = 100 } = {}) {
  const binding = { ok: true, binding_version: "platform_adapter_binding_contract_v1", adapter_binding_id: crypto.randomUUID(), adapter_key: safeText(adapter_key, 191), provider_key: safeText(provider_key, 191), capability_key: safeText(capability_key, 191), boundary_key: safeText(boundary_key, 191), resource_type: safeText(resource_type, 191), operations: normalizeList(operations), certification_requirements: normalizeList(certification_requirements), readback_contract, readback_contract_hash: adapterHash(readback_contract || {}), drift_policy, drift_policy_hash: adapterHash(drift_policy || {}), priority: Number.isFinite(Number(priority)) ? Number(priority) : 100, execution_mode: "contract_only", provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
  binding.binding_hash = adapterHash(adapterManifest(binding));
  return binding;
}

export function certifyAdapterBinding({ binding = {}, execution_control = {}, execution_envelope = {}, approval_request = {}, decision_log = [], current_enforcement = {}, now = new Date() } = {}) {
  if (binding?.ok !== true || binding.binding_version !== "platform_adapter_binding_contract_v1") return failure("adapter_binding_invalid");
  if (bool(binding.provider_apply_allowed) || bool(binding.mutation_allowed) || bool(binding.enforcement_cutover)) return failure("adapter_binding_apply_boundary_failed");
  if (adapterHash(adapterManifest(binding)) !== binding.binding_hash) return failure("adapter_binding_hash_mismatch");
  const controlCheck = validateExecutionConcurrencyControl(execution_control, { execution_envelope, approval_request, decision_log, current_enforcement, now });
  if (controlCheck.ok !== true) return failure("adapter_binding_concurrency_not_ready", { concurrency_status: controlCheck.status });
  const checks = [ { name: "binding_hash_verified", pass: true }, { name: "execution_concurrency_ready", pass: true }, { name: "readback_contract_present", pass: Boolean(binding.readback_contract_hash) }, { name: "drift_policy_present", pass: Boolean(binding.drift_policy_hash) }, { name: "provider_apply_forbidden", pass: true }, { name: "no_mutation", pass: true }, { name: "no_enforcement_cutover", pass: true }, { name: "no_secrets", pass: true } ];
  const certification = { ok: true, certification_version: "platform_adapter_certification_v1", adapter_binding_id: binding.adapter_binding_id, adapter_key: binding.adapter_key, execution_control_hash: execution_control.control_hash, binding_hash: binding.binding_hash, certification_status: checks.every((check) => check.pass) ? "certified_contract_only" : "certification_failed", checks, checks_hash: adapterHash(checks), provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
  certification.certification_hash = adapterHash(certificationManifest(certification));
  return certification;
}

export function selectDeterministicAdapterBinding(bindings = [], { capability_key = "", boundary_key = "", resource_type = "" } = {}) {
  const filtered = (Array.isArray(bindings) ? bindings : []).filter((binding) => binding?.ok === true).filter((binding) => !capability_key || binding.capability_key === capability_key).filter((binding) => !boundary_key || binding.boundary_key === boundary_key).filter((binding) => !resource_type || binding.resource_type === resource_type).filter((binding) => bool(binding.provider_apply_allowed) === false && bool(binding.mutation_allowed) === false).sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100) || String(a.adapter_key).localeCompare(String(b.adapter_key)) || String(a.binding_hash).localeCompare(String(b.binding_hash)));
  if (filtered.length === 0) return failure("adapter_selection_no_candidate");
  const selected = filtered[0];
  return { ok: true, status: "adapter_binding_selected", selected_adapter_binding_id: selected.adapter_binding_id, selected_adapter_key: selected.adapter_key, selection_hash: adapterHash(filtered.map((binding) => ({ id: binding.adapter_binding_id, hash: binding.binding_hash, priority: binding.priority }))), candidate_count: filtered.length, provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
}

export function buildReadbackContract({ binding = {}, resource_ref = "", expected_state = {}, readback_fields = [] } = {}) {
  if (binding?.ok !== true) return failure("readback_contract_binding_invalid");
  const contract = { ok: true, contract_version: "platform_adapter_readback_contract_v1", adapter_binding_id: binding.adapter_binding_id, resource_ref: safeText(resource_ref, 500), expected_state, readback_fields: normalizeList(readback_fields), provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
  contract.contract_hash = adapterHash({ contract_version: contract.contract_version, adapter_binding_id: contract.adapter_binding_id, resource_ref: contract.resource_ref, expected_state: contract.expected_state, readback_fields: contract.readback_fields, provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false });
  return contract;
}

export function validateReadbackEvidence({ contract = {}, evidence = {} } = {}) {
  if (contract?.ok !== true || contract.contract_version !== "platform_adapter_readback_contract_v1") return failure("readback_contract_invalid");
  if (bool(evidence.secrets_included) || bool(evidence.provider_apply_allowed) || bool(evidence.mutation_executed) || bool(evidence.enforcement_cutover)) return failure("readback_evidence_apply_boundary_failed");
  if (evidence.contract_hash !== contract.contract_hash) return failure("readback_evidence_contract_hash_mismatch");
  const observed = evidence.observed_state || {};
  const expected = contract.expected_state || {};
  const mismatches = Object.keys(expected).filter((key) => stableAdapterJson(observed[key]) !== stableAdapterJson(expected[key]));
  return { ok: mismatches.length === 0, status: mismatches.length === 0 ? "readback_evidence_valid" : "readback_evidence_mismatch", mismatches, contract_hash: contract.contract_hash, evidence_hash: adapterHash({ contract_hash: evidence.contract_hash, observed_state: observed, mismatches }), provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
}

export function classifyAdapterDrift({ contract = {}, evidence = {} } = {}) {
  const readback = validateReadbackEvidence({ contract, evidence });
  if (readback.ok === true) return { ok: true, status: "adapter_drift_none", readback, drift_detected: false, provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
  return { ok: true, status: "adapter_drift_detected", readback, drift_detected: true, provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
}
