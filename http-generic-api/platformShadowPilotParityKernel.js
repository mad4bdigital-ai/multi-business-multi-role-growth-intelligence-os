import crypto from "node:crypto";

export const SHADOW_PILOT_PARITY_VERSION = "platform-shadow-pilot-parity-v1";
export const PILOT_CAPABILITIES = Object.freeze([
  "activation.skills.read",
  "platform.output-artifact.write",
  "content.wordpress.publish",
]);

const DEFINITIONS = Object.freeze({
  "activation.skills.read": { resourceClass: "activation_skill", effectClass: "read_only", requiredHashes: [] },
  "platform.output-artifact.write": { resourceClass: "output_artifact", effectClass: "internal_write", requiredHashes: ["idempotencyKeyHash", "readbackContractHash"] },
  "content.wordpress.publish": { resourceClass: "cms_post", effectClass: "external_high_impact", requiredHashes: ["idempotencyKeyHash", "readbackContractHash", "providerBindingHash"] },
});

const MISMATCH = Object.freeze({
  "allow:allow": ["low", "match"],
  "deny:deny": ["low", "match"],
  "approval_required:conditional": ["expected", "expected_semantic_translation"],
  "allow:deny": ["medium", "policy_difference"],
  "deny:allow": ["critical", "privilege_expansion"],
});

function text(value, name) {
  const out = String(value ?? "").trim();
  if (!out) throw Object.assign(new TypeError(`${name} is required.`), { code: "shadow_pilot_field_required", status: 422, field: name });
  return out;
}

function hash(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value ?? null)).digest("hex");
}

export function getShadowPilotDefinitions() {
  return Object.freeze(PILOT_CAPABILITIES.map((capabilityKey) => Object.freeze({
    capabilityKey,
    ...DEFINITIONS[capabilityKey],
    providerApplyAllowed: false,
    externalWriteAllowed: false,
    mutationAllowed: false,
    enforcementCutover: false,
    secretsIncluded: false,
  })));
}

export function classifyShadowPilotMismatch({ legacyDecision, adaptiveDecision } = {}) {
  const legacy = text(legacyDecision, "legacyDecision");
  const adaptive = text(adaptiveDecision, "adaptiveDecision");
  const [risk, category] = MISMATCH[`${legacy}:${adaptive}`] || (legacy === adaptive ? ["low", "match"] : ["medium", "unclassified_mismatch"]);
  return Object.freeze({ risk, category });
}

export function buildShadowPilotEvidence(input = {}) {
  const capabilityKey = text(input.capabilityKey, "capabilityKey");
  const definition = DEFINITIONS[capabilityKey];
  if (!definition) throw Object.assign(new TypeError(`Unsupported pilot capability: ${capabilityKey}`), { code: "shadow_pilot_capability_unsupported", status: 422 });
  if (input.providerMutationPerformed) throw Object.assign(new TypeError("Shadow pilots cannot record provider mutation."), { code: "shadow_pilot_provider_mutation_forbidden", status: 409 });
  for (const field of definition.requiredHashes) if (!input[field]) throw Object.assign(new TypeError(`${field} is required for ${capabilityKey}.`), { code: "shadow_pilot_required_hash_missing", status: 422, field });
  const legacyDecision = text(input.legacyDecision, "legacyDecision");
  const adaptiveDecision = text(input.adaptiveDecision, "adaptiveDecision");
  return Object.freeze({
    schema_version: SHADOW_PILOT_PARITY_VERSION,
    capabilityKey,
    resourceClass: definition.resourceClass,
    effectClass: definition.effectClass,
    legacyDecision,
    adaptiveDecision,
    mismatch: classifyShadowPilotMismatch({ legacyDecision, adaptiveDecision }),
    requestShapeHash: input.requestShapeHash || hash(input.requestShape || {}),
    revisionVectorHash: input.revisionVectorHash || hash(input.revisionVector || {}),
    idempotencyKeyHash: input.idempotencyKeyHash || null,
    readbackContractHash: input.readbackContractHash || null,
    providerBindingHash: input.providerBindingHash || null,
    providerApplyAllowed: false,
    externalWriteAllowed: false,
    mutationAllowed: false,
    enforcementCutover: false,
    secretsIncluded: false,
    rawPayloadIncluded: false,
    promptIncluded: false,
    status: "shadow_recorded",
  });
}

export function runShadowPilotParity(inputs = []) {
  const records = (Array.isArray(inputs) ? inputs : []).map(buildShadowPilotEvidence);
  const observed = new Set(records.map((record) => record.capabilityKey));
  const missingCapabilities = PILOT_CAPABILITIES.filter((capabilityKey) => !observed.has(capabilityKey));
  const criticalMismatchCount = records.filter((record) => record.mismatch.risk === "critical").length;
  return Object.freeze({
    ok: missingCapabilities.length === 0 && criticalMismatchCount === 0,
    schema_version: SHADOW_PILOT_PARITY_VERSION,
    mode: "shadow",
    pilotCount: records.length,
    requiredPilotCount: PILOT_CAPABILITIES.length,
    missingCapabilities,
    criticalMismatchCount,
    providerApplyAllowed: false,
    externalWriteAllowed: false,
    mutationAllowed: false,
    enforcementCutover: false,
    secretsIncluded: false,
    records,
  });
}
