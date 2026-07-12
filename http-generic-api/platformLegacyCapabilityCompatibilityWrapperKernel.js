import { normalizeSelectorValue } from "./src/domain/capability/capabilityAlias.js";
import { classifyShadowPilotMismatch } from "./platformShadowPilotParityKernel.js";

export const LEGACY_COMPATIBILITY_WRAPPER_VERSION =
  "platform-legacy-capability-compatibility-wrapper-v1";

const ROUTABLE_ALIAS_STATUSES = new Set(["active", "deprecated"]);
const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|credential|password|prompt|raw[_-]?payload|secret|token)/i;

function requiredText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw Object.assign(new TypeError(`${field} is required.`), {
      code: "legacy_compatibility_field_required",
      status: 422,
      field,
    });
  }
  return normalized;
}

function finiteNonNegative(value, field) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw Object.assign(new TypeError(`${field} must be a finite non-negative number.`), {
      code: "legacy_compatibility_number_invalid",
      status: 422,
      field,
    });
  }
  return normalized;
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw Object.assign(new TypeError(`${field} must be a positive integer.`), {
      code: "legacy_compatibility_integer_invalid",
      status: 422,
      field,
    });
  }
  return normalized;
}

function sha256(value, field) {
  const normalized = requiredText(value, field).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw Object.assign(new TypeError(`${field} must be a SHA-256 hex digest.`), {
      code: "legacy_compatibility_hash_invalid",
      status: 422,
      field,
    });
  }
  return normalized;
}

function isoInstant(value, field) {
  const normalized = requiredText(value, field);
  if (Number.isNaN(Date.parse(normalized))) {
    throw Object.assign(new TypeError(`${field} must be an ISO-8601 timestamp.`), {
      code: "legacy_compatibility_timestamp_invalid",
      status: 422,
      field,
    });
  }
  return normalized;
}

function assertNoSensitiveKeys(value, path = "decisionInput", seen = new Set()) {
  if (value === null || value === undefined || typeof value !== "object") return;
  if (seen.has(value)) {
    throw Object.assign(new TypeError(`${path} must not contain circular references.`), {
      code: "legacy_compatibility_decision_input_circular",
      status: 422,
    });
  }
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw Object.assign(
        new TypeError(`${path}.${key} is not allowed in compatibility shadow input.`),
        {
          code: "legacy_compatibility_sensitive_field_forbidden",
          status: 422,
          field: `${path}.${key}`,
        },
      );
    }
    assertNoSensitiveKeys(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function normalizeAliasResolution(input = {}) {
  const selectorType = requiredText(
    input.selector_type,
    "aliasResolution.selector_type",
  ).toLowerCase();
  const selectorValue = normalizeSelectorValue(selectorType, input.selector_value);
  const surface = requiredText(input.surface, "aliasResolution.surface").toLowerCase();
  const status = requiredText(input.status, "aliasResolution.status").toLowerCase();

  if (!ROUTABLE_ALIAS_STATUSES.has(status)) {
    throw Object.assign(
      new TypeError("Compatibility wrappers require an active or deprecated alias."),
      {
        code: "legacy_compatibility_alias_not_routable",
        status: 409,
        alias_status: status,
      },
    );
  }

  return Object.freeze({
    id: requiredText(input.id, "aliasResolution.id"),
    selector_type: selectorType,
    selector_value: selectorValue,
    surface,
    status,
    canonical_capability_id: requiredText(
      input.canonical_capability_id,
      "aliasResolution.canonical_capability_id",
    ),
    capability_key: requiredText(
      input.capability_key,
      "aliasResolution.capability_key",
    ),
    registry_version: requiredText(
      input.registry_version,
      "aliasResolution.registry_version",
    ),
  });
}

function normalizeDeprecationPolicy(policy = {}, aliasStatus) {
  if (aliasStatus !== "deprecated") {
    return Object.freeze({
      announcedAt: null,
      removalNotBefore: null,
      policyHash: null,
      minimumObservationCount: null,
      minimumParityRate: null,
      state: "not_announced",
    });
  }

  const minimumParityRate = finiteNonNegative(
    policy.minimumParityRate,
    "deprecationPolicy.minimumParityRate",
  );
  if (minimumParityRate > 1) {
    throw Object.assign(
      new TypeError("deprecationPolicy.minimumParityRate must be between 0 and 1."),
      {
        code: "legacy_compatibility_parity_rate_invalid",
        status: 422,
      },
    );
  }

  const announcedAt = isoInstant(
    policy.announcedAt,
    "deprecationPolicy.announcedAt",
  );
  const removalNotBefore = isoInstant(
    policy.removalNotBefore,
    "deprecationPolicy.removalNotBefore",
  );
  if (Date.parse(removalNotBefore) <= Date.parse(announcedAt)) {
    throw Object.assign(
      new TypeError(
        "deprecationPolicy.removalNotBefore must be later than announcedAt.",
      ),
      {
        code: "legacy_compatibility_deprecation_window_invalid",
        status: 422,
      },
    );
  }

  return Object.freeze({
    announcedAt,
    removalNotBefore,
    policyHash: sha256(policy.policyHash, "deprecationPolicy.policyHash"),
    minimumObservationCount: positiveInteger(
      policy.minimumObservationCount,
      "deprecationPolicy.minimumObservationCount",
    ),
    minimumParityRate,
    state: "announced",
  });
}

function buildDeprecationEvidence({
  aliasStatus,
  policy,
  measurements = {},
  evaluatedAt,
}) {
  const observedCallCount = finiteNonNegative(
    measurements.observedCallCount,
    "measurements.observedCallCount",
  );
  const parityMatchCount = finiteNonNegative(
    measurements.parityMatchCount,
    "measurements.parityMatchCount",
  );
  const criticalMismatchCount = finiteNonNegative(
    measurements.criticalMismatchCount,
    "measurements.criticalMismatchCount",
  );
  const adaptiveErrorCount = finiteNonNegative(
    measurements.adaptiveErrorCount,
    "measurements.adaptiveErrorCount",
  );
  const activeLegacyConsumerCount = finiteNonNegative(
    measurements.activeLegacyConsumerCount,
    "measurements.activeLegacyConsumerCount",
  );

  if (parityMatchCount > observedCallCount) {
    throw Object.assign(
      new TypeError(
        "measurements.parityMatchCount cannot exceed observedCallCount.",
      ),
      {
        code: "legacy_compatibility_measurement_inconsistent",
        status: 422,
      },
    );
  }

  const parityRate =
    observedCallCount === 0 ? 0 : parityMatchCount / observedCallCount;
  const rollbackReadbackApproved =
    measurements.rollbackReadbackApproved === true;

  const checks =
    aliasStatus === "deprecated"
      ? Object.freeze({
          windowElapsed:
            Date.parse(evaluatedAt) >= Date.parse(policy.removalNotBefore),
          observationCountMet:
            observedCallCount >= policy.minimumObservationCount,
          parityRateMet: parityRate >= policy.minimumParityRate,
          criticalMismatchFree: criticalMismatchCount === 0,
          adaptiveErrorFree: adaptiveErrorCount === 0,
          noActiveLegacyConsumers: activeLegacyConsumerCount === 0,
          rollbackReadbackApproved,
        })
      : Object.freeze({
          windowElapsed: false,
          observationCountMet: false,
          parityRateMet: false,
          criticalMismatchFree: false,
          adaptiveErrorFree: false,
          noActiveLegacyConsumers: false,
          rollbackReadbackApproved: false,
        });

  const deprecationEvidenceComplete =
    aliasStatus === "deprecated" && Object.values(checks).every(Boolean);

  return Object.freeze({
    state: aliasStatus === "deprecated" ? "measuring" : "not_announced",
    policyHash: policy.policyHash,
    announcedAt: policy.announcedAt,
    removalNotBefore: policy.removalNotBefore,
    observedCallCount,
    parityMatchCount,
    parityRate,
    criticalMismatchCount,
    adaptiveErrorCount,
    activeLegacyConsumerCount,
    rollbackReadbackApproved,
    checks,
    deprecationEvidenceComplete,
    routeRemovalAllowed: false,
    nextRequiredAction: deprecationEvidenceComplete
      ? "separate_explicit_route_removal_authority_required"
      : "continue_measured_legacy_usage_and_parity_observation",
  });
}

export async function runLegacyCapabilityCompatibilityWrapper(
  input = {},
  deps = {},
) {
  if (typeof deps.resolveAdaptiveDecision !== "function") {
    throw Object.assign(
      new TypeError("deps.resolveAdaptiveDecision is required."),
      {
        code: "legacy_compatibility_adaptive_resolver_required",
        status: 500,
      },
    );
  }

  const selectorType = requiredText(
    input.selectorType,
    "selectorType",
  ).toLowerCase();
  const selectorValue = normalizeSelectorValue(
    selectorType,
    input.selectorValue,
  );
  const surface = requiredText(input.surface, "surface").toLowerCase();
  const aliasResolution = normalizeAliasResolution(input.aliasResolution);

  if (
    aliasResolution.selector_type !== selectorType ||
    aliasResolution.selector_value !== selectorValue ||
    aliasResolution.surface !== surface
  ) {
    throw Object.assign(
      new TypeError(
        "Alias resolution does not match the requested legacy selector.",
      ),
      {
        code: "legacy_compatibility_alias_binding_mismatch",
        status: 409,
      },
    );
  }

  const observedAt = isoInstant(input.observedAt, "observedAt");
  const requestShapeHash = sha256(
    input.requestShapeHash,
    "requestShapeHash",
  );
  const revisionVectorHash = sha256(
    input.revisionVectorHash,
    "revisionVectorHash",
  );
  const legacyDecision = requiredText(
    input.legacyDecision,
    "legacyDecision",
  ).toLowerCase();
  const decisionInput =
    input.decisionInput && typeof input.decisionInput === "object"
      ? input.decisionInput
      : {};
  assertNoSensitiveKeys(decisionInput);

  const adaptive = await deps.resolveAdaptiveDecision({
    canonicalCapabilityId: aliasResolution.canonical_capability_id,
    capabilityKey: aliasResolution.capability_key,
    selectorType,
    selectorValue,
    surface,
    decisionInput,
  });
  const adaptiveDecision = requiredText(
    adaptive?.decision,
    "adaptiveDecision.decision",
  ).toLowerCase();
  const adaptiveReasonCodes = Object.freeze(
    (Array.isArray(adaptive?.reasonCodes) ? adaptive.reasonCodes : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .slice(0, 20),
  );

  const mismatch = classifyShadowPilotMismatch({
    legacyDecision,
    adaptiveDecision,
  });
  const deprecationPolicy = normalizeDeprecationPolicy(
    input.deprecationPolicy ?? {},
    aliasResolution.status,
  );
  const deprecation = buildDeprecationEvidence({
    aliasStatus: aliasResolution.status,
    policy: deprecationPolicy,
    measurements: input.measurements ?? {},
    evaluatedAt: observedAt,
  });
  const parityMatch = mismatch.category === "match";

  const compatibilityMetadata = Object.freeze({
    schema_version: LEGACY_COMPATIBILITY_WRAPPER_VERSION,
    mode: "legacy_response_passthrough_adaptive_shadow",
    observedAt,
    alias: Object.freeze({
      id: aliasResolution.id,
      selectorType,
      selectorValue,
      surface,
      status: aliasResolution.status,
      canonicalCapabilityId:
        aliasResolution.canonical_capability_id,
      capabilityKey: aliasResolution.capability_key,
      registryVersion: aliasResolution.registry_version,
    }),
    parity: Object.freeze({
      legacyDecision,
      adaptiveDecision,
      adaptiveReasonCodes,
      mismatchCategory: mismatch.category,
      requestShapeHash,
      revisionVectorHash,
    }),
    usageMeasurement: Object.freeze({
      legacyCallCountIncrement: 1,
      adaptiveShadowEvaluationCountIncrement: 1,
      parityMatchCountIncrement: parityMatch ? 1 : 0,
      mismatchCountIncrement: parityMatch ? 0 : 1,
    }),
    deprecation,
    providerApplyAllowed: false,
    externalWriteAllowed: false,
    mutationAllowed: false,
    canaryActivationAllowed: false,
    enforcementCutover: false,
    migrationExecutionAuthorized: false,
    routeRemovalAllowed: false,
    secretsIncluded: false,
    rawPayloadIncluded: false,
    promptIncluded: false,
  });

  return Object.freeze({
    legacyResponse: input.legacyResponse,
    compatibilityMetadata,
  });
}
