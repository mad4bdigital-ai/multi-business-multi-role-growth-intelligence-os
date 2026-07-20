import { classifyShadowPilotMismatch } from "./platformShadowPilotParityKernel.js";

export const SHADOW_MISMATCH_CLASSIFICATION_VERSION = "platform-shadow-mismatch-classification-v1";

export const SHADOW_MISMATCH_ROLLOUT_ACTIONS = Object.freeze({
  ACCEPT: "accept_shadow_match",
  REVIEW: "require_human_review",
  BLOCK: "block_rollout",
});

const CATEGORY_POLICY = Object.freeze({
  match: {
    severity: "low",
    rolloutAction: SHADOW_MISMATCH_ROLLOUT_ACTIONS.ACCEPT,
    requiresApproval: false,
    blocksCanary: false,
  },
  expected_semantic_translation: {
    severity: "low",
    rolloutAction: SHADOW_MISMATCH_ROLLOUT_ACTIONS.ACCEPT,
    requiresApproval: false,
    blocksCanary: false,
  },
  policy_difference: {
    severity: "medium",
    rolloutAction: SHADOW_MISMATCH_ROLLOUT_ACTIONS.REVIEW,
    requiresApproval: true,
    blocksCanary: true,
  },
  privilege_expansion: {
    severity: "critical",
    rolloutAction: SHADOW_MISMATCH_ROLLOUT_ACTIONS.BLOCK,
    requiresApproval: true,
    blocksCanary: true,
  },
  adaptive_error: {
    severity: "high",
    rolloutAction: SHADOW_MISMATCH_ROLLOUT_ACTIONS.BLOCK,
    requiresApproval: true,
    blocksCanary: true,
  },
  missing_evidence: {
    severity: "high",
    rolloutAction: SHADOW_MISMATCH_ROLLOUT_ACTIONS.BLOCK,
    requiresApproval: true,
    blocksCanary: true,
  },
  unclassified_mismatch: {
    severity: "medium",
    rolloutAction: SHADOW_MISMATCH_ROLLOUT_ACTIONS.REVIEW,
    requiresApproval: true,
    blocksCanary: true,
  },
});

function text(value, name) {
  const out = String(value ?? "").trim();
  if (!out) {
    throw Object.assign(new TypeError(`${name} is required.`), {
      code: "shadow_mismatch_field_required",
      status: 422,
      field: name,
    });
  }
  return out;
}

function baseCategory(record) {
  const mismatch = record?.mismatch || classifyShadowPilotMismatch({
    legacyDecision: record?.legacyDecision,
    adaptiveDecision: record?.adaptiveDecision,
  });
  if (record?.adaptiveError === true || mismatch.category === "adaptive_error") return "adaptive_error";
  if (!record?.requestShapeHash || !record?.revisionVectorHash) return "missing_evidence";
  return mismatch.category || "unclassified_mismatch";
}

export function classifyShadowMismatchRecord(record = {}) {
  const capabilityKey = text(record.capabilityKey, "capabilityKey");
  const legacyDecision = text(record.legacyDecision, "legacyDecision");
  const adaptiveDecision = text(record.adaptiveDecision, "adaptiveDecision");
  const category = baseCategory({ ...record, legacyDecision, adaptiveDecision });
  const policy = CATEGORY_POLICY[category] || CATEGORY_POLICY.unclassified_mismatch;

  return Object.freeze({
    schema_version: SHADOW_MISMATCH_CLASSIFICATION_VERSION,
    capabilityKey,
    resourceClass: record.resourceClass || "unknown",
    effectClass: record.effectClass || "unknown",
    legacyDecision,
    adaptiveDecision,
    mismatchCategory: category,
    mismatchRisk: policy.severity,
    rolloutAction: policy.rolloutAction,
    requiresApproval: policy.requiresApproval,
    blocksCanary: policy.blocksCanary,
    requestShapeHash: record.requestShapeHash || null,
    revisionVectorHash: record.revisionVectorHash || null,
    providerApplyAllowed: false,
    externalWriteAllowed: false,
    mutationAllowed: false,
    enforcementCutover: false,
    migrationExecutionAuthorized: false,
    secretsIncluded: false,
    rawPayloadIncluded: false,
    promptIncluded: false,
  });
}

export function classifyShadowMismatchRun(records = [], options = {}) {
  if (!Array.isArray(records)) {
    throw Object.assign(new TypeError("records must be an array."), {
      code: "shadow_mismatch_records_invalid",
      status: 422,
    });
  }
  const classifications = records.map(classifyShadowMismatchRecord);
  const countsByCategory = classifications.reduce((acc, item) => {
    acc[item.mismatchCategory] = (acc[item.mismatchCategory] || 0) + 1;
    return acc;
  }, {});
  const blockers = classifications.filter((item) => item.blocksCanary);
  const reviewRequired = classifications.filter((item) => item.requiresApproval);
  const approvedCategoryAllowlist = new Set(options.approvedCategoryAllowlist || [
    "match",
    "expected_semantic_translation",
  ]);

  const unapprovedCategories = Object.keys(countsByCategory)
    .filter((category) => !approvedCategoryAllowlist.has(category))
    .sort();

  return Object.freeze({
    ok: blockers.length === 0 && unapprovedCategories.length === 0,
    schema_version: SHADOW_MISMATCH_CLASSIFICATION_VERSION,
    mode: "shadow_classification_only",
    recordCount: classifications.length,
    countsByCategory: Object.freeze({ ...countsByCategory }),
    blockerCount: blockers.length,
    reviewRequiredCount: reviewRequired.length,
    unapprovedCategories,
    providerApplyAllowed: false,
    externalWriteAllowed: false,
    mutationAllowed: false,
    enforcementCutover: false,
    migrationExecutionAuthorized: false,
    secretsIncluded: false,
    rawPayloadIncluded: false,
    promptIncluded: false,
    classifications: Object.freeze(classifications),
  });
}
