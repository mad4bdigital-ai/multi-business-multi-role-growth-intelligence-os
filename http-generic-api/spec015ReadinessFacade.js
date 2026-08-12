import {
  validateCandidateConvergence,
  validateDraftAiSafety,
  validateOwnershipManifest,
  validateReadinessPreview,
  validateSpec015Manifest,
} from "./spec015ContractValidators.js";

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function buildSpec015ReadinessPreview({
  manifest = {},
  expected_hash = "",
  observed_hash = "",
  conflicts = [],
  stale = false,
  ambiguity = false,
  ai_draft = null,
  ownership = [],
  candidate = null,
} = {}) {
  const manifestResult = validateSpec015Manifest(manifest);
  const readinessResult = validateReadinessPreview({ manifest, expected_hash, observed_hash, conflicts, stale, ambiguity });
  const aiResult = ai_draft === null ? { valid: true, errors: [] } : validateDraftAiSafety(ai_draft);
  const ownershipResult = validateOwnershipManifest(ownership, { tenantId: manifest.tenant_id });
  const convergenceResult = candidate === null ? { valid: true, errors: [] } : validateCandidateConvergence(candidate);
  const errors = [
    ...manifestResult.errors,
    ...readinessResult.errors,
    ...aiResult.errors,
    ...ownershipResult.errors,
    ...convergenceResult.errors,
  ];
  const blockingGaps = unique(errors.map((error) => error.code));
  return {
    contract: "spec015_readiness_preview.v1",
    status: errors.length === 0 ? "ready" : "blocked",
    ready: errors.length === 0,
    blocking_gaps: blockingGaps,
    deterministic_hash: manifestResult.deterministic_hash,
    evidence: {
      manifest_valid: manifestResult.valid,
      readiness_valid: readinessResult.valid,
      ai_draft_valid: aiResult.valid,
      ownership_valid: ownershipResult.valid,
      candidate_convergence_valid: convergenceResult.valid,
      stale_evidence: Boolean(stale),
      ambiguity: Boolean(ambiguity),
      conflict_count: Array.isArray(conflicts) ? conflicts.length : 0,
    },
    mutation_executed: false,
    provider_call_executed: false,
    database_mutation: false,
    secrets_included: false,
  };
}
