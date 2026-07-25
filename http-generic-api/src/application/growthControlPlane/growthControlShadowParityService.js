import { randomUUID } from "node:crypto";
import { compareGrowthControlShadowParity } from "../../domain/growthControlPlane/growthControlShadowParity.js";

function boundedText(value, maxLength = 191) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeScope(context = {}) {
  return Object.freeze({
    tenantId: boundedText(context.tenantId || context.tenant_id, 36),
    workspaceId: boundedText(context.workspaceId || context.workspace_id, 36),
    brandKey: boundedText(context.brandKey || context.brand_key, 128)
  });
}

function observerSafetyEnvelope(overrides = {}) {
  return Object.freeze({
    providerApplyAllowed: false,
    externalWriteAllowed: false,
    mutationAllowed: false,
    enforcementCutover: false,
    secretsIncluded: false,
    rawPayloadIncluded: false,
    promptIncluded: false,
    authoritativeResultUnchanged: true,
    ...overrides
  });
}

export function createGrowthControlShadowParityService({
  repository,
  comparator = compareGrowthControlShadowParity,
  uuid = randomUUID,
  now = () => new Date()
} = {}) {
  if (!repository) throw new TypeError("Growth Control shadow parity repository is required.");

  async function observe({ configKey, resolutionId = null, context = {}, growthValue } = {}) {
    const startedAt = Date.now();
    const normalizedConfigKey = boundedText(configKey, 128);
    if (!normalizedConfigKey) throw new TypeError("configKey is required for Growth Control shadow parity.");

    const mapping = await repository.getMapping(normalizedConfigKey);
    const legacyRecord = mapping
      ? await repository.readLegacyRuntimeConfig(mapping.legacyConfigKey)
      : null;
    const comparison = comparator({
      mapping,
      growthValue,
      legacyValue: legacyRecord?.value,
      growthPresent: growthValue !== undefined,
      legacyPresent: Boolean(legacyRecord)
    });
    const scope = normalizeScope(context);
    const observedAt = now();
    const evidence = Object.freeze({
      evidenceId: uuid(),
      resolutionId: boundedText(resolutionId, 36),
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      brandKey: scope.brandKey,
      growthConfigKey: normalizedConfigKey,
      legacyConfigKey: mapping?.legacyConfigKey || null,
      growthHash: comparison.growthHash,
      legacyHash: comparison.legacyHash,
      normalizedGrowthHash: comparison.normalizedGrowthHash,
      normalizedLegacyHash: comparison.normalizedLegacyHash,
      classification: comparison.classification,
      severity: comparison.severity,
      action: comparison.action,
      explanationCode: comparison.explanationCode,
      comparedPaths: comparison.comparedPaths,
      blocksCutover: comparison.blocksCutover,
      latencyMs: Math.max(0, Date.now() - startedAt),
      observedAt,
      providerApplyAllowed: false,
      externalWriteAllowed: false,
      mutationAllowed: false,
      enforcementCutover: false,
      secretsIncluded: false,
      rawPayloadIncluded: false,
      promptIncluded: false
    });
    await repository.recordEvidence(evidence);
    return observerSafetyEnvelope({
      observed: true,
      evidenceId: evidence.evidenceId,
      classification: comparison.classification,
      severity: comparison.severity,
      action: comparison.action,
      blocksCutover: comparison.blocksCutover,
      explanationCode: comparison.explanationCode
    });
  }

  async function observeSafely(input = {}) {
    try {
      return await observe(input);
    } catch (error) {
      return observerSafetyEnvelope({
        observed: false,
        classification: "adaptive_error",
        severity: "high",
        action: "block_rollout",
        blocksCutover: true,
        explanationCode: "shadow_observer_failed",
        observerErrorCode: boundedText(error?.code || error?.name || "SHADOW_OBSERVER_ERROR", 128)
      });
    }
  }

  return Object.freeze({ observe, observeSafely });
}

export const _testingGrowthControlShadowParityService = Object.freeze({
  boundedText,
  normalizeScope,
  observerSafetyEnvelope
});
