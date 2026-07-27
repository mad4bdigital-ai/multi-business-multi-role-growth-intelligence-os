import { parseCapabilityKillSwitchValue } from "./capabilityKillSwitchPolicy.js";
import { stableOperationHash } from "./operationRegistryContracts.js";

const SAFE_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,190}$/;
const MAX_TARGET_KEYS = 500;
const MAX_LIST_LENGTH = 50_000;

export const OPERATION_BINDING_KILL_SWITCH_ENV = Object.freeze({
  all_adapters: "OPERATION_BINDING_KILL_SWITCH_ALL_ADAPTERS",
  all_runtimes: "OPERATION_BINDING_KILL_SWITCH_ALL_RUNTIMES",
  adapter_keys: "OPERATION_BINDING_KILL_SWITCH_ADAPTER_KEYS",
  runtime_keys: "OPERATION_BINDING_KILL_SWITCH_RUNTIME_KEYS",
});

export class OperationBindingKillSwitchError extends Error {
  constructor(code, message, status = 503, details = {}) {
    super(message);
    this.name = "OperationBindingKillSwitchError";
    this.code = code;
    this.status = status;
    this.details = { ...details, retryable: false, secrets_included: false };
  }
}

function fail(code, message, details = {}) {
  throw new OperationBindingKillSwitchError(code, message, 503, details);
}

function normalizeKey(value, field, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || !SAFE_KEY_PATTERN.test(normalized)) {
    fail("operation_binding_kill_switch_key_invalid", `${field} is invalid.`, { field });
  }
  return normalized;
}

function parseExactKeyList(value, field) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  if (raw.length > MAX_LIST_LENGTH) {
    fail("operation_binding_kill_switch_list_too_large", `${field} exceeds the bounded length.`, { field });
  }
  const entries = raw.split(",");
  if (entries.length > MAX_TARGET_KEYS) {
    fail("operation_binding_kill_switch_list_too_large", `${field} contains too many keys.`, { field });
  }
  if (entries.some((entry) => !String(entry).trim())) {
    fail("operation_binding_kill_switch_list_invalid", `${field} contains an empty key.`, { field });
  }
  return [...new Set(entries.map((entry, index) => normalizeKey(entry, `${field}[${index}]`)))].sort();
}

export function resolveOperationBindingKillSwitchPolicy(env = process.env) {
  const adapterKeys = parseExactKeyList(env?.[OPERATION_BINDING_KILL_SWITCH_ENV.adapter_keys], OPERATION_BINDING_KILL_SWITCH_ENV.adapter_keys);
  const runtimeKeys = parseExactKeyList(env?.[OPERATION_BINDING_KILL_SWITCH_ENV.runtime_keys], OPERATION_BINDING_KILL_SWITCH_ENV.runtime_keys);
  const core = {
    schema_version: "operation-binding-kill-switch-policy-v1",
    adapter_global_enabled: parseCapabilityKillSwitchValue(env?.[OPERATION_BINDING_KILL_SWITCH_ENV.all_adapters]),
    runtime_global_enabled: parseCapabilityKillSwitchValue(env?.[OPERATION_BINDING_KILL_SWITCH_ENV.all_runtimes]),
    adapter_keys: adapterKeys,
    runtime_keys: runtimeKeys,
  };
  return {
    ...core,
    policy_hash: stableOperationHash(core),
    secrets_included: false,
  };
}

export function evaluateOperationBindingKillSwitch({ adapter_key, runtime_key } = {}, { policy = null, env = process.env } = {}) {
  const resolved = policy || resolveOperationBindingKillSwitchPolicy(env);
  const adapterKey = normalizeKey(adapter_key, "adapter_key", { optional: true });
  const runtimeKey = normalizeKey(runtime_key, "runtime_key", { optional: true });
  const adapterBlocked = Boolean(resolved.adapter_global_enabled || (adapterKey && resolved.adapter_keys.includes(adapterKey)));
  const runtimeBlocked = Boolean(resolved.runtime_global_enabled || (runtimeKey && resolved.runtime_keys.includes(runtimeKey)));
  const reasonCodes = [];
  if (adapterBlocked) reasonCodes.push("adapter_kill_switch_enabled");
  if (runtimeBlocked) reasonCodes.push("runtime_kill_switch_enabled");
  return {
    blocked: reasonCodes.length > 0,
    adapter_key: adapterKey,
    runtime_key: runtimeKey,
    adapter_switch_enabled: adapterBlocked,
    runtime_switch_enabled: runtimeBlocked,
    reason_codes: reasonCodes.sort(),
    policy_hash: resolved.policy_hash,
    secrets_included: false,
  };
}

export function operationBindingKillSwitchSnapshot(env = process.env) {
  const policy = resolveOperationBindingKillSwitchPolicy(env);
  return {
    schema_version: policy.schema_version,
    policy_hash: policy.policy_hash,
    adapter_global_enabled: policy.adapter_global_enabled,
    runtime_global_enabled: policy.runtime_global_enabled,
    adapter_target_count: policy.adapter_keys.length,
    runtime_target_count: policy.runtime_keys.length,
    adapter_targets_hash: stableOperationHash(policy.adapter_keys),
    runtime_targets_hash: stableOperationHash(policy.runtime_keys),
    env_vars: { ...OPERATION_BINDING_KILL_SWITCH_ENV },
    secrets_included: false,
  };
}
