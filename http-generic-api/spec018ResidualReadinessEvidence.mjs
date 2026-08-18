import crypto from "node:crypto";

export const SPEC018_RESIDUAL_READINESS_EVIDENCE_CONTRACT =
  "mad4b.spec018-residual-readiness-evidence.v1";

export const REQUIRED_SECURITY_REVIEW_CONTROLS = Object.freeze([
  "authentication",
  "authorization",
  "object_scope",
  "replay",
  "injection",
  "path_traversal",
  "secret_exposure",
]);

const HEX_SHA1 = /^[a-f0-9]{40}$/u;
const FORBIDDEN_KEYS = /(?:password|passwd|client[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key|credential|cookie)/iu;

function text(value) {
  return String(value ?? "").trim();
}

function bool(value) {
  return value === true;
}

function safeSha(value) {
  const normalized = text(value).toLowerCase();
  return HEX_SHA1.test(normalized) ? normalized : null;
}

function hasForbiddenKeys(value, path = "evidence") {
  if (Array.isArray(value)) return value.flatMap((item, index) => hasForbiddenKeys(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  const findings = [];
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) findings.push(`${path}.${key}`);
    findings.push(...hasForbiddenKeys(child, `${path}.${key}`));
  }
  return findings;
}

function exactShaPair(expected, observed) {
  const expectedSha = safeSha(expected);
  const observedSha = safeSha(observed);
  return {
    expected_sha: expectedSha,
    observed_sha: observedSha,
    exact_sha_bound: Boolean(expectedSha && observedSha && expectedSha === observedSha),
  };
}

function normalizeF09(input = {}) {
  const source = exactShaPair(input.expected_sha, input.observed_sha);
  const generated = bool(input.attestation_generated);
  const registryRevision = text(input.registry_revision);
  const runtimeReadback = bool(input.runtime_readback_complete);
  const parityReadback = bool(input.parity_readback_complete);
  const enforcementMode = text(input.enforcement_mode).toLowerCase() || "shadow";
  const ready = source.exact_sha_bound && generated && Boolean(registryRevision)
    && runtimeReadback && parityReadback && enforcementMode === "shadow";
  return {
    ...source,
    attestation_generated: generated,
    registry_revision: registryRevision || null,
    runtime_readback_complete: runtimeReadback,
    parity_readback_complete: parityReadback,
    enforcement_mode: enforcementMode,
    enforcement_promotion_allowed: false,
    status: ready ? "shadow_parity_ready" : "blocked_pending_parity",
  };
}

function normalizeH06(input = {}) {
  const controls = Object.fromEntries(REQUIRED_SECURITY_REVIEW_CONTROLS.map((control) => {
    const item = input.controls?.[control] || {};
    const reviewed = bool(item.reviewed);
    const evidenceRef = text(item.evidence_ref);
    const findingsCount = Number.isInteger(item.findings_count) && item.findings_count >= 0
      ? item.findings_count
      : null;
    const ready = reviewed && Boolean(evidenceRef) && findingsCount === 0;
    return [control, {
      reviewed,
      evidence_ref: evidenceRef || null,
      findings_count: findingsCount,
      status: ready ? "ready" : "blocked",
    }];
  }));
  const complete = Object.values(controls).every((item) => item.status === "ready");
  return {
    controls,
    security_review_complete: complete,
    status: complete ? "security_review_ready" : "blocked_pending_security_review",
  };
}

function normalizeH10(input = {}) {
  const source = exactShaPair(input.expected_main_sha, input.observed_main_sha);
  const ciPassed = bool(input.all_required_checks_passed);
  const stagingReachable = bool(input.staging_reachable);
  const cleanReadback = bool(input.staging_clean_readback);
  const runtimeIntegrity = bool(input.runtime_integrity_readback);
  const noMutation = input.provider_called === false
    && input.database_mutated === false
    && input.migration_apply_performed === false;
  const ready = source.exact_sha_bound && ciPassed && stagingReachable && cleanReadback && runtimeIntegrity && noMutation;
  return {
    ...source,
    all_required_checks_passed: ciPassed,
    staging_reachable: stagingReachable,
    staging_clean_readback: cleanReadback,
    runtime_integrity_readback: runtimeIntegrity,
    provider_called: false,
    database_mutated: false,
    migration_apply_performed: false,
    status: ready ? "staging_verification_ready" : "blocked_pending_staging_verification",
  };
}

function normalizeH11(input = {}) {
  const source = exactShaPair(input.expected_main_sha, input.observed_main_sha);
  const releaseChecksPassed = bool(input.release_readiness_checks_passed);
  const rollbackReady = bool(input.rollback_readiness_complete);
  const stagingEvidenceReady = bool(input.staging_evidence_ready);
  const blockedByPromotionBoundary = input.production_promotion_authorized === false
    && input.production_deployed === false;
  const ready = source.exact_sha_bound && releaseChecksPassed && rollbackReady
    && stagingEvidenceReady && blockedByPromotionBoundary;
  return {
    ...source,
    release_readiness_checks_passed: releaseChecksPassed,
    rollback_readiness_complete: rollbackReady,
    staging_evidence_ready: stagingEvidenceReady,
    production_promotion_authorized: false,
    production_deployed: false,
    status: ready ? "release_readiness_ready_for_review" : "blocked_pending_release_readiness",
  };
}

export function stableResidualEvidenceDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function buildSpec018ResidualReadinessEvidence({
  generated_at = "",
  f09_attestation_parity = {},
  h06_security_review = {},
  h10_staging_verification = {},
  h11_release_readiness = {},
} = {}) {
  const forbiddenFindings = hasForbiddenKeys({
    f09_attestation_parity,
    h06_security_review,
    h10_staging_verification,
    h11_release_readiness,
  });
  if (forbiddenFindings.length > 0) {
    throw new Error(`Evidence contains forbidden credential-bearing keys: ${forbiddenFindings.join(", ")}`);
  }

  const evidence = {
    contract: SPEC018_RESIDUAL_READINESS_EVIDENCE_CONTRACT,
    schema_version: 1,
    generated_at: text(generated_at) || null,
    requirements: {
      F09: normalizeF09(f09_attestation_parity),
      H06: normalizeH06(h06_security_review),
      H10: normalizeH10(h10_staging_verification),
      H11: normalizeH11(h11_release_readiness),
    },
    production_promotion_authorized: false,
    production_deployed: false,
    runtime_transition_activated: false,
    migration_apply_performed: false,
    database_mutated: false,
    provider_called: false,
    secrets_included: false,
  };
  const statuses = Object.values(evidence.requirements).map((item) => item.status);
  const allReady = statuses.every((status) => status.endsWith("ready") || status === "release_readiness_ready_for_review");
  const report = {
    ...evidence,
    status: allReady ? "ready_for_review_not_authorized" : "blocked_pending_residual_evidence",
    evidence_digest_sha256: stableResidualEvidenceDigest(evidence),
  };
  return Object.freeze(report);
}

export function validateSpec018ResidualReadinessEvidence(report = {}) {
  const errors = [];
  if (report.contract !== SPEC018_RESIDUAL_READINESS_EVIDENCE_CONTRACT) errors.push("contract_mismatch");
  if (report.schema_version !== 1) errors.push("schema_version_mismatch");
  if (report.production_promotion_authorized !== false) errors.push("production_promotion_authorized");
  if (report.production_deployed !== false) errors.push("production_deployed");
  if (report.runtime_transition_activated !== false) errors.push("runtime_transition_activated");
  if (report.migration_apply_performed !== false) errors.push("migration_apply_performed");
  if (report.database_mutated !== false) errors.push("database_mutated");
  if (report.provider_called !== false) errors.push("provider_called");
  if (report.secrets_included !== false) errors.push("secrets_included");
  return Object.freeze({ valid: errors.length === 0, errors, secrets_included: false });
}
