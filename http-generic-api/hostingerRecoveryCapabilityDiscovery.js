// Governed Hostinger capability discovery. Read-only; never opens SSH or reads secret values.
// Registered command rows advertise intent but never authorize a mutating executor.
import { getPool } from "./db.js";
import { HOSTINGER_RECOVERY_PROVIDER_API } from "./hostingerRecoveryProviderContract.js";

const scope = value => String(value ?? "").trim();
const id = value => /^[a-z0-9][a-z0-9_-]{1,127}$/i.test(scope(value));

function deny(code, message, status = 409) {
  const error = new Error(message);
  error.code = code; error.status = status; return error;
}
function jsonArray(value) {
  try { const data = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(data) ? data.filter(item => typeof item === "string") : []; }
  catch { return []; }
}
export function evaluateHostingerRecoveryCapabilities({target, commands, environment, observedAt = new Date().toISOString()} = {}) {
  if (!target || scope(target.provider_family) !== "hostinger" ||
      scope(target.connector_family) !== "hostinger_ssh" ||
      scope(target.plugin_key) !== "remote_ssh_runtime") {
    throw deny("recovery_target_provider_mismatch", "Target must resolve to the governed Hostinger SSH runtime.");
  }
  if (!["production", "development"].includes(environment)) {
    throw deny("recovery_environment_invalid", "Environment must be production or development.", 400);
  }
  if (scope(target.registered_environment) !== environment) {
    throw deny("recovery_environment_mismatch", "Registered Hostinger system environment does not match the requested environment.", 403);
  }
  const systemReady = scope(target.registered_system_status) === "active";
  const targetReady = target.status === "active" && target.validation_status === "valid" && systemReady;
  const targetAllowlist = new Set(jsonArray(target.command_allowlist_json));
  const candidateKeys = new Set();
  const available = [];
  for (const command of commands || []) {
    const key = scope(command.command_key);
    if (!/^hostinger_recovery_[a-z0-9_]{1,100}$/.test(key) || candidateKeys.has(key)) continue;
    candidateKeys.add(key);
    const catalogState = scope(command.status);
    const targetAllowed = targetAllowlist.has(key);
    const catalogEligible = catalogState === "active" || catalogState === "planned";
    const category = /_inspect$|_inventory$|_plan$/.test(key) ? "read_or_plan" : "mutation";
    const prerequisites = [];
    if (!targetReady) prerequisites.push("validated_live_target_and_system");
    // Inventory/capability discovery is safe, but no provider-backed plan executor exists here.
    if (!targetAllowed) prerequisites.push("target_allowlist_binding");
    if (catalogState !== "active") prerequisites.push("catalog_activation_after_certification");
    if (category === "mutation") prerequisites.push("separate_approval_and_exact_host_authority");
    prerequisites.push("provider_executor_certification_and_same_cycle_readback");
    available.push({
      command_key: key, intent: category,
      registry_status: catalogState,
      target_allowlisted: targetAllowed,
      discovery_ready: catalogEligible && targetAllowed,
      plan_candidate: catalogEligible && targetAllowed && category === "read_or_plan",
      plan_allowed: false, // no certified planner in this discovery-only extension
      dispatch_ready: false, execution_allowed: false, // NO executor is registered by this extension.
      requires_approval: Boolean(command.requires_approval),
      prerequisites, secrets_included: false,
    });
  }
  return {
    ok: true, contract: "mad4b.hostinger-recovery-discovery.v1",
    target_id: scope(target.target_id), environment,
    observed_at: observedAt,
    target_status: scope(target.status),
    target_validation_status: scope(target.validation_status),
    registered_system_status: scope(target.registered_system_status),
    commands: available.sort((a,b)=>a.command_key.localeCompare(b.command_key)),
    capability_claim: "catalog_only_not_host_privilege",
    provider_api_documented: true,
    documented_api_reference: HOSTINGER_RECOVERY_PROVIDER_API.documentation,
    account_entitlement_verified: false,
    environment_replace_semantics: HOSTINGER_RECOVERY_PROVIDER_API.node_env_mutation_semantics,
    environment_read_values_masked: true,
    ssh_used: false, provider_call_performed: false, mutation_performed: false,
    secrets_included: false,
  };
}
export async function discoverHostingerRecoveryCapabilities({targetId, environment="production", pool=getPool()} = {}) {
  if (!id(targetId)) throw deny("recovery_target_id_invalid", "An exact target ID is required.", 400);
  const [targetRows] = await pool.query(
    `SELECT t.target_id,t.plugin_key,t.provider_family,t.connector_family,
            t.command_allowlist_json,t.status,t.validation_status,
            cs.status AS registered_system_status,
            JSON_UNQUOTE(JSON_EXTRACT(cs.config_json,'$.environment')) AS registered_environment
       FROM remote_runtime_targets t
       JOIN connected_systems cs ON cs.system_id = t.system_id AND cs.tenant_id = t.tenant_id
      WHERE t.target_id = ? AND t.plugin_key = 'remote_ssh_runtime'
        AND t.target_kind = 'hosting_account' AND t.provider_family = 'hostinger'
        AND t.connector_family = 'hostinger_ssh'
        AND cs.provider_family = 'hostinger' AND cs.connector_family = 'hostinger_ssh'
      LIMIT 2`, [targetId]);
  if (targetRows.length !== 1) throw deny("recovery_target_not_found_or_ambiguous",
    "No single Hostinger target is registered for this identifier.");
  const [commands] = await pool.query(
    `SELECT command_key,status,requires_approval,is_consequential,target_kind
       FROM remote_runtime_command_allowlists
      WHERE plugin_key = 'remote_ssh_runtime'
        AND command_key LIKE 'hostinger_recovery_%' AND target_kind = 'hosting_account'
        AND status IN ('planned','active')
      ORDER BY command_key LIMIT 101`);
  if (commands.length > 100) throw deny("recovery_catalog_unbounded", "Recovery command catalog exceeds supported bounds.");
  return evaluateHostingerRecoveryCapabilities({target: targetRows[0], commands, environment});
}
