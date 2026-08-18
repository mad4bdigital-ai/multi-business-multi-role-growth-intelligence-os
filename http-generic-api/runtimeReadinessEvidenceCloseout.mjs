import crypto from "node:crypto";

export const RUNTIME_READINESS_EVIDENCE_CLOSEOUT_CONTRACT =
  "mad4b.spec018-runtime-readiness-evidence-closeout.v1";

export const REQUIRED_DATABASE_ROLES = Object.freeze([
  "runtime",
  "governance",
  "runtime_persistence",
]);

const HEX_SHA256 = /^[a-f0-9]{64}$/u;
const HEX_SHA1 = /^[a-f0-9]{40}$/u;
const FORBIDDEN_KEYS = /(?:password|passwd|client[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key|credential|cookie)/iu;

function text(value) {
  return String(value ?? "").trim();
}

function bool(value) {
  return value === true;
}

function safeSha(value, length) {
  const normalized = text(value).toLowerCase();
  return (length === 40 ? HEX_SHA1 : HEX_SHA256).test(normalized) ? normalized : null;
}

function hasForbiddenKeys(value, path = "evidence") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => hasForbiddenKeys(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];
  const findings = [];
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) findings.push(`${path}.${key}`);
    findings.push(...hasForbiddenKeys(child, `${path}.${key}`));
  }
  return findings;
}

function normalizeRoleEvidence(role, input = {}) {
  const expectedDatabase = text(input.expected_database);
  const observedDatabase = text(input.observed_database);
  const expectedPrincipal = text(input.expected_principal);
  const observedPrincipal = text(input.observed_principal);
  const databaseMatches = Boolean(expectedDatabase && expectedDatabase === observedDatabase);
  const principalMatches = Boolean(expectedPrincipal && expectedPrincipal === observedPrincipal);
  const readbackComplete = bool(input.readback_complete);
  const privilegeMatrixExact = bool(input.privilege_matrix_exact);
  const schemaReadback = bool(input.schema_readback);
  return {
    role,
    expected_database: expectedDatabase || null,
    observed_database: observedDatabase || null,
    expected_principal: expectedPrincipal || null,
    observed_principal: observedPrincipal || null,
    database_matches: databaseMatches,
    principal_matches: principalMatches,
    readback_complete: readbackComplete,
    privilege_matrix_exact: privilegeMatrixExact,
    schema_readback: schemaReadback,
    status: databaseMatches && principalMatches && readbackComplete && privilegeMatrixExact && schemaReadback
      ? "ready"
      : "blocked",
    migration_apply_performed: false,
    database_mutated: false,
  };
}

function normalizeEnvironmentEvidence(environment, input = {}) {
  const expectedSha = safeSha(input.expected_sha, 40);
  const observedSha = safeSha(input.observed_sha, 40);
  const exactShaBound = Boolean(expectedSha && observedSha && expectedSha === observedSha);
  const reachable = bool(input.reachable);
  const cleanReadback = bool(input.clean_readback);
  const rollbackRehearsalReady = bool(input.rollback_rehearsal_ready);
  return {
    environment,
    expected_sha: expectedSha,
    observed_sha: observedSha,
    exact_sha_bound: exactShaBound,
    reachable,
    clean_readback: cleanReadback,
    rollback_rehearsal_ready: rollbackRehearsalReady,
    status: exactShaBound && reachable && cleanReadback && rollbackRehearsalReady ? "ready" : "blocked",
    deployment_performed: false,
    provider_called: false,
  };
}

export function stableEvidenceDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function buildRuntimeReadinessEvidenceCloseout({
  expected_sha,
  observed_sha,
  source_branch = "main",
  generated_at = "",
  database_roles = {},
  staging = {},
  production = {},
  ci = {},
  rollback = {},
} = {}) {
  const forbiddenFindings = hasForbiddenKeys({ database_roles, staging, production, ci, rollback });
  if (forbiddenFindings.length > 0) {
    throw new Error(`Evidence contains forbidden credential-bearing keys: ${forbiddenFindings.join(", ")}`);
  }

  const expectedSha = safeSha(expected_sha, 40);
  const observedSha = safeSha(observed_sha, 40);
  const exactHeadBound = Boolean(expectedSha && observedSha && expectedSha === observedSha);
  const roles = Object.fromEntries(REQUIRED_DATABASE_ROLES.map((role) => [role, normalizeRoleEvidence(role, database_roles?.[role])]));
  const stagingEvidence = normalizeEnvironmentEvidence("staging", staging);
  const productionEvidence = normalizeEnvironmentEvidence("production", production);
  const allRolesReady = Object.values(roles).every((item) => item.status === "ready");
  const stagingReady = stagingEvidence.status === "ready";
  const ciPassed = bool(ci.all_required_checks_passed);
  const rollbackReady = bool(rollback.rehearsal_ready);
  const checks = {
    exact_head_binding: exactHeadBound,
    source_branch_declared: Boolean(text(source_branch)),
    database_roles_complete: allRolesReady,
    staging_readback_ready: stagingReady,
    ci_required_checks_passed: ciPassed,
    rollback_rehearsal_ready: rollbackReady,
  };
  const readyForReview = Object.values(checks).every(Boolean);
  const report = {
    contract: RUNTIME_READINESS_EVIDENCE_CLOSEOUT_CONTRACT,
    schema_version: 1,
    generated_at: text(generated_at) || null,
    source_identity: {
      source_branch: text(source_branch) || null,
      expected_sha: expectedSha,
      observed_sha: observedSha,
      exact_head_bound: exactHeadBound,
    },
    database_roles: roles,
    environments: {
      staging: stagingEvidence,
      production: productionEvidence,
    },
    checks,
    status: readyForReview ? "ready_for_review" : "blocked_pending_evidence",
    release_readiness: readyForReview ? "staging_evidence_ready_production_separate" : "blocked",
    production_promotion_authorized: false,
    production_deployed: false,
    runtime_transition_activated: false,
    migration_apply_performed: false,
    database_mutated: false,
    provider_called: false,
    secrets_included: false,
  };
  return Object.freeze({
    ...report,
    evidence_digest_sha256: stableEvidenceDigest(report),
  });
}

export function buildEmptyRuntimeReadinessEvidenceCloseout(options = {}) {
  return buildRuntimeReadinessEvidenceCloseout(options);
}

export function validateRuntimeReadinessEvidenceCloseout(report = {}) {
  const errors = [];
  if (report.contract !== RUNTIME_READINESS_EVIDENCE_CLOSEOUT_CONTRACT) errors.push("contract_mismatch");
  if (report.schema_version !== 1) errors.push("schema_version_mismatch");
  if (report.secrets_included !== false) errors.push("secrets_included");
  if (report.migration_apply_performed !== false) errors.push("migration_apply_performed");
  if (report.database_mutated !== false) errors.push("database_mutated");
  if (report.provider_called !== false) errors.push("provider_called");
  if (report.production_deployed !== false) errors.push("production_deployed");
  if (report.production_promotion_authorized !== false) errors.push("production_promotion_authorized");
  return Object.freeze({ valid: errors.length === 0, errors, secrets_included: false });
}
