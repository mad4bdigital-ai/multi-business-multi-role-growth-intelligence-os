import { createHash } from "node:crypto";

const SHA40_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const REQUIRED_ROLES = Object.freeze(["runtime", "governance", "runtime_persistence"]);
export const PRODUCTION_RECOVERY_CLOSURE_CONTRACT = "mad4b.production-recovery-closure.v1";
export const PRODUCTION_RECOVERY_CLOSURE_EVIDENCE_CONTRACT = "mad4b.production-recovery-closure-evidence.v1";
export const PRODUCTION_RECOVERY_BACKUP_EVIDENCE_CONTRACT = "mad4b.production-recovery-backup-evidence.v1";

export const PRODUCTION_RECOVERY_CORE_GATES = Object.freeze([
  "exact_source_sha_verified",
  "durable_inspection_verified",
  "governance_baseline_ready",
  "runtime_persistence_baseline_ready",
  "canonical_grants_ready",
  "bootstrap_ledger_ready",
  "mcp_catalog_schema_ready",
  "admin_catalog_functional_readback",
  "device_catalog_functional_readback",
  "response_chunk_storage_smoke",
  "production_activation_readiness",
  "backup_evidence_verified",
  "production_mutation_audited",
]);

export const PRODUCTION_RECOVERY_NON_DB_GATES = Object.freeze([
  "connector_auth_ready",
  "rate_limit_attribution_ready",
]);

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function stableJson(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function hash(value) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function normalizeGateMap(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.freeze(Object.fromEntries(
    [...PRODUCTION_RECOVERY_CORE_GATES, ...PRODUCTION_RECOVERY_NON_DB_GATES]
      .map((key) => [key, source[key] === true]),
  ));
}

function validateBackupEvidence(backup, expectedSha) {
  const problems = [];
  const value = backup && typeof backup === "object" && !Array.isArray(backup) ? backup : null;
  if (!value) {
    return { ok: false, problems: ["backup_evidence_missing"], evidence: null };
  }
  const sha = text(value.expected_sha, 64).toLowerCase();
  const evidenceHash = text(value.evidence_sha256, 128).toLowerCase();
  const createdAt = text(value.created_at, 80);
  const roles = [...new Set((Array.isArray(value.roles) ? value.roles : []).map((role) => text(role, 64).toLowerCase()))];
  const evidenceRef = text(value.evidence_ref || value.backup_evidence_path, 512);

  if (value.contract !== PRODUCTION_RECOVERY_BACKUP_EVIDENCE_CONTRACT) problems.push("backup_contract_invalid");
  if (sha !== expectedSha) problems.push("backup_sha_mismatch");
  if (!SHA256_RE.test(evidenceHash)) problems.push("backup_hash_invalid");
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) problems.push("backup_created_at_invalid");
  if (!evidenceRef) problems.push("backup_evidence_ref_missing");
  for (const role of REQUIRED_ROLES) if (!roles.includes(role)) problems.push(`backup_role_missing:${role}`);
  if (value.verified !== true) problems.push("backup_not_verified");
  if (value.secrets_included !== false) problems.push("backup_secret_boundary_invalid");

  return {
    ok: problems.length === 0,
    problems,
    evidence: {
      contract: value.contract || null,
      expected_sha: sha || null,
      evidence_sha256: SHA256_RE.test(evidenceHash) ? evidenceHash : null,
      created_at: createdAt || null,
      evidence_ref: evidenceRef || null,
      roles,
      verified: value.verified === true,
      secrets_included: false,
    },
  };
}

export function evaluateProductionRecoveryClosure({ expectedSha = "", evidence = null } = {}) {
  const problems = [];
  const expected = text(expectedSha, 64).toLowerCase();
  const value = evidence && typeof evidence === "object" && !Array.isArray(evidence) ? evidence : {};
  const observedSha = text(value.expected_sha || value.source_sha, 64).toLowerCase();
  const inspectionRunId = text(value.inspection_run_id, 192);
  const inspectionEvidenceHash = text(value.inspection_evidence_hash, 128).toLowerCase();
  const gates = normalizeGateMap(value.gates);
  const backup = validateBackupEvidence(value.backup_evidence, expected);

  if (!SHA40_RE.test(expected)) problems.push("expected_sha_invalid");
  if (value.contract !== PRODUCTION_RECOVERY_CLOSURE_EVIDENCE_CONTRACT) problems.push("closure_evidence_contract_invalid");
  if (observedSha !== expected) problems.push("closure_evidence_sha_mismatch");
  if (value.server_derived !== true) problems.push("closure_evidence_not_server_derived");
  if (value.durable !== true) problems.push("closure_evidence_not_durable");
  if (value.same_cycle !== true) problems.push("closure_evidence_not_same_cycle");
  if (!inspectionRunId) problems.push("inspection_run_id_missing");
  if (!SHA256_RE.test(inspectionEvidenceHash)) problems.push("inspection_evidence_hash_invalid");
  if (value.secrets_included !== false) problems.push("closure_secret_boundary_invalid");
  problems.push(...backup.problems);

  for (const gate of PRODUCTION_RECOVERY_CORE_GATES) {
    if (gate === "backup_evidence_verified") {
      if (!backup.ok || gates[gate] !== true) problems.push("core_gate_not_ready:backup_evidence_verified");
      continue;
    }
    if (gates[gate] !== true) problems.push(`core_gate_not_ready:${gate}`);
  }

  const unknownOutcome = value.unknown_outcome === true;
  if (unknownOutcome) problems.push("unknown_outcome_requires_reconciliation");

  const structuralProblems = problems.filter((problem) =>
    !problem.startsWith("core_gate_not_ready:") && problem !== "unknown_outcome_requires_reconciliation"
  );
  const coreProblems = problems.filter((problem) => problem.startsWith("core_gate_not_ready:"));
  const coreRecovered = structuralProblems.length === 0 && coreProblems.length === 0 && !unknownOutcome;
  const nonDbGaps = PRODUCTION_RECOVERY_NON_DB_GATES.filter((gate) => gates[gate] !== true);

  let status = "blocked";
  if (unknownOutcome) status = "unknown_outcome";
  else if (coreRecovered && nonDbGaps.length > 0) status = "degraded_non_db";
  else if (coreRecovered) status = "recovered";

  const closureBasis = {
    contract: PRODUCTION_RECOVERY_CLOSURE_CONTRACT,
    expected_sha: expected,
    inspection_run_id: inspectionRunId || null,
    inspection_evidence_hash: SHA256_RE.test(inspectionEvidenceHash) ? inspectionEvidenceHash : null,
    gates,
    backup_evidence_sha256: backup.evidence?.evidence_sha256 || null,
    unknown_outcome: unknownOutcome,
    status,
    core_recovered: coreRecovered,
    non_db_gaps: nonDbGaps,
  };

  return Object.freeze({
    ok: status === "recovered",
    contract: PRODUCTION_RECOVERY_CLOSURE_CONTRACT,
    status,
    core_recovered: coreRecovered,
    exact_source_sha_verified: gates.exact_source_sha_verified,
    durable_inspection_verified: gates.durable_inspection_verified,
    governance_baseline_ready: gates.governance_baseline_ready,
    runtime_persistence_baseline_ready: gates.runtime_persistence_baseline_ready,
    canonical_grants_ready: gates.canonical_grants_ready,
    bootstrap_ledger_ready: gates.bootstrap_ledger_ready,
    mcp_catalog_schema_ready: gates.mcp_catalog_schema_ready,
    admin_catalog_functional_readback: gates.admin_catalog_functional_readback,
    device_catalog_functional_readback: gates.device_catalog_functional_readback,
    response_chunk_storage_smoke: gates.response_chunk_storage_smoke,
    production_activation_readiness: gates.production_activation_readiness,
    backup_evidence_verified: backup.ok && gates.backup_evidence_verified,
    production_mutation_audited: gates.production_mutation_audited,
    unknown_outcome: unknownOutcome,
    connector_auth_ready: gates.connector_auth_ready,
    rate_limit_attribution_ready: gates.rate_limit_attribution_ready,
    non_db_gaps: nonDbGaps,
    problems: [...new Set(problems)],
    expected_sha: expected || null,
    inspection_run_id: inspectionRunId || null,
    inspection_evidence_hash: SHA256_RE.test(inspectionEvidenceHash) ? inspectionEvidenceHash : null,
    backup_evidence: backup.evidence,
    closure_sha256: hash(closureBasis),
    recovered_requires_all_core_gates: true,
    automatic_retry_allowed: false,
    reconciliation_required: unknownOutcome,
    read_only_probe: true,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    production_mutation_performed: false,
    secrets_included: false,
  });
}
