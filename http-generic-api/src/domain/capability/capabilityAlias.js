import { CapabilityDomainError, normalizeCapabilityKey } from "./canonicalCapability.js";

export const CAPABILITY_SELECTOR_TYPES = Object.freeze(["action_key", "tool_key", "intent_key", "route_key"]);
export const CAPABILITY_SURFACES = Object.freeze(["tenant", "admin", "device", "system"]);
export const CAPABILITY_ALIAS_STATUSES = Object.freeze(["active", "disabled", "deprecated"]);

const SELECTOR_TYPES = new Set(CAPABILITY_SELECTOR_TYPES);
const SURFACES = new Set(CAPABILITY_SURFACES);
const STATUSES = new Set(CAPABILITY_ALIAS_STATUSES);

export function normalizeSelectorValue(selectorType, value) {
  const type = String(selectorType || "").trim().toLowerCase();
  if (!SELECTOR_TYPES.has(type)) {
    throw new CapabilityDomainError("INVALID_SELECTOR_TYPE", "Unsupported capability selector type.", { selector_type: type });
  }
  const raw = String(value || "").trim();
  if (!raw) throw new CapabilityDomainError("MISSING_SELECTOR_VALUE", "Capability selector value is required.");
  if (type === "route_key") {
    const match = raw.match(/^([A-Za-z]+)\s+(.+)$/);
    if (!match) throw new CapabilityDomainError("INVALID_ROUTE_SELECTOR", "Route selectors must use METHOD /path format.");
    return `${match[1].toUpperCase()} ${match[2].trim()}`;
  }
  return normalizeCapabilityKey(raw);
}

export function capabilityAliasIdentity(alias = {}) {
  return `${alias.selector_type}:${alias.selector_value}`;
}

export function createCapabilityAlias(input = {}) {
  const selectorType = String(input.selector_type || "").trim().toLowerCase();
  const surface = String(input.surface || "").trim().toLowerCase();
  const status = String(input.status || "active").trim().toLowerCase();
  const alias = Object.freeze({
    id: String(input.id || "").trim(),
    selector_type: selectorType,
    selector_value: normalizeSelectorValue(selectorType, input.selector_value),
    canonical_capability_id: String(input.canonical_capability_id || "").trim(),
    surface,
    surface_restriction_policy_id: input.surface_restriction_policy_id ? String(input.surface_restriction_policy_id).trim() : null,
    status,
    registry_version: String(input.registry_version || "").trim(),
  });
  if (!alias.id) throw new CapabilityDomainError("MISSING_ALIAS_ID", "Capability alias id is required.");
  if (!alias.canonical_capability_id) throw new CapabilityDomainError("MISSING_ALIAS_CAPABILITY", "Capability alias must map to a canonical capability.");
  if (!SURFACES.has(surface)) throw new CapabilityDomainError("INVALID_ALIAS_SURFACE", "Unsupported capability alias surface.");
  if (!STATUSES.has(status)) throw new CapabilityDomainError("INVALID_ALIAS_STATUS", "Unsupported capability alias status.");
  if (!alias.registry_version) throw new CapabilityDomainError("MISSING_ALIAS_REGISTRY_VERSION", "Capability alias registry version is required.");
  return alias;
}

export function assertOneActiveAliasToOneCapability(aliases = []) {
  const mapping = new Map();
  for (const alias of aliases) {
    if (alias?.status !== "active") continue;
    const identity = capabilityAliasIdentity(alias);
    const existing = mapping.get(identity);
    if (existing && existing !== alias.canonical_capability_id) {
      throw new CapabilityDomainError(
        "CAPABILITY_ALIAS_CONFLICT",
        "One active alias cannot map to more than one canonical capability.",
        { selector: identity, canonical_capability_ids: [existing, alias.canonical_capability_id] }
      );
    }
    mapping.set(identity, alias.canonical_capability_id);
  }
  return mapping;
}
