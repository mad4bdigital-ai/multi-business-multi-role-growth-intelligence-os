const KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,190}$/;

export const CAPABILITY_RISK_LEVELS = Object.freeze(["low", "medium", "high", "critical"]);
export const CAPABILITY_EFFECTS = Object.freeze(["read", "preview", "create", "update", "delete", "execute", "admin"]);
export const CAPABILITY_STATUSES = Object.freeze(["active", "disabled", "deprecated"]);

const RISK_LEVEL_SET = new Set(CAPABILITY_RISK_LEVELS);
const EFFECT_SET = new Set(CAPABILITY_EFFECTS);
const STATUS_SET = new Set(CAPABILITY_STATUSES);

export class CapabilityDomainError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "CapabilityDomainError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeCapabilityKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!KEY_PATTERN.test(normalized)) {
    throw new CapabilityDomainError(
      "INVALID_CAPABILITY_KEY",
      "Capability key must be a stable lowercase key containing only letters, numbers, dot, underscore, colon, or hyphen."
    );
  }
  return normalized;
}

export function capabilityClassificationComplete(input = {}) {
  const stateChanging = input.state_changing === true;
  if (!RISK_LEVEL_SET.has(input.risk_level)) return false;
  if (!EFFECT_SET.has(input.effect)) return false;
  if (!STATUS_SET.has(input.status)) return false;
  if (!String(input.policy_version || "").trim()) return false;
  if (stateChanging && !String(input.approval_policy_id || "").trim()) return false;
  return true;
}

export function createCanonicalCapability(input = {}) {
  const capability = Object.freeze({
    id: String(input.id || "").trim(),
    key: normalizeCapabilityKey(input.key),
    display_name: String(input.display_name || input.key || "").trim(),
    risk_level: String(input.risk_level || "").trim().toLowerCase(),
    effect: String(input.effect || "").trim().toLowerCase(),
    state_changing: input.state_changing === true,
    credential_policy_id: input.credential_policy_id ? String(input.credential_policy_id).trim() : null,
    device_policy_id: input.device_policy_id ? String(input.device_policy_id).trim() : null,
    approval_policy_id: input.approval_policy_id ? String(input.approval_policy_id).trim() : null,
    smoke_policy_id: input.smoke_policy_id ? String(input.smoke_policy_id).trim() : null,
    status: String(input.status || "active").trim().toLowerCase(),
    policy_version: String(input.policy_version || "").trim(),
  });

  if (!capability.id) {
    throw new CapabilityDomainError("MISSING_CAPABILITY_ID", "Canonical capability id is required.");
  }
  if (!capability.display_name) {
    throw new CapabilityDomainError("MISSING_CAPABILITY_DISPLAY_NAME", "Canonical capability display name is required.");
  }
  if (!capabilityClassificationComplete(capability)) {
    throw new CapabilityDomainError(
      "INCOMPLETE_CAPABILITY_CLASSIFICATION",
      "Active executable capabilities must have complete risk, effect, status, policy-version, and approval classification.",
      { key: capability.key, state_changing: capability.state_changing }
    );
  }
  return capability;
}
