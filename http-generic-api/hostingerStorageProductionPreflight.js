import { createHash } from 'node:crypto';

export const HOSTINGER_STORAGE_PRODUCTION_PREFLIGHT_VERSION = 'hostinger-storage-production-preflight-v1';

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SHA1_RE = /^[0-9a-f]{40}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const ENDPOINT_KEYS = ['status', 'health', 'version', 'deployment_info'];
const BLOCKING_PRESSURE = new Set(['critical', 'emergency']);
const ALLOWED_PRESSURE = new Set(['healthy', 'warning', 'critical', 'emergency']);
const SECRET_KEY_RE = /(^|_)(authorization|password|passwd|secret|token|api_key|private_key|credential|cookie|connection_string)(_|$)/i;

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function safeId(value, field) {
  const normalized = text(value, 256);
  if (!SAFE_ID_RE.test(normalized)) {
    throw fail(400, 'STORAGE_PRODUCTION_PREFLIGHT_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function sha1(value, field) {
  const normalized = text(value, 40).toLowerCase();
  if (!SHA1_RE.test(normalized)) {
    throw fail(400, 'STORAGE_PRODUCTION_PREFLIGHT_SHA_INVALID', 'A full 40-character commit SHA is required.', { field });
  }
  return normalized;
}

function sha256(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_PRODUCTION_PREFLIGHT_DIGEST_INVALID', 'A SHA-256 evidence digest is required.', { field });
  }
  return normalized;
}

function epoch(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw fail(400, 'STORAGE_PRODUCTION_PREFLIGHT_TIME_INVALID', 'A non-negative epoch timestamp is required.', { field });
  }
  return normalized;
}

function nonNegativeNumber(value, field) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw fail(400, 'STORAGE_PRODUCTION_PREFLIGHT_NUMBER_INVALID', 'A non-negative finite number is required.', { field });
  }
  return normalized;
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw fail(400, 'STORAGE_PRODUCTION_PREFLIGHT_INTEGER_INVALID', 'A positive integer is required.', { field });
  }
  return normalized;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function assertSecretFree(value, path = '$', seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) {
    throw fail(400, 'STORAGE_PRODUCTION_PREFLIGHT_CYCLIC_EVIDENCE', 'Cyclic evidence is not accepted.', { path });
  }
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (SECRET_KEY_RE.test(key) || (key === 'secrets_included' && entry !== false)) {
      throw fail(400, 'STORAGE_PRODUCTION_PREFLIGHT_SECRET_EVIDENCE_REJECTED', 'Preflight evidence must be secret-free.', { path: nextPath });
    }
    assertSecretFree(entry, nextPath, seen);
  }
  seen.delete(value);
}

function normalizeCandidate(input = {}) {
  return {
    release_id: safeId(input.release_id, 'candidate.release_id'),
    environment: safeId(input.environment, 'candidate.environment'),
    candidate_sha: sha1(input.candidate_sha, 'candidate.candidate_sha'),
    source_main_sha: sha1(input.source_main_sha, 'candidate.source_main_sha'),
    production_branch_sha: sha1(input.production_branch_sha, 'candidate.production_branch_sha'),
    secrets_included: false,
  };
}

function normalizeRuntimeEndpoint(input = {}, key) {
  return {
    endpoint: safeId(input.endpoint || key.replace('_', '-'), `runtime_readback.${key}.endpoint`),
    ok: input.ok === true,
    environment: safeId(input.environment, `runtime_readback.${key}.environment`),
    commit_sha: sha1(input.commit_sha, `runtime_readback.${key}.commit_sha`),
    observed_at_epoch: epoch(input.observed_at_epoch, `runtime_readback.${key}.observed_at_epoch`),
    evidence_digest: sha256(input.evidence_digest, `runtime_readback.${key}.evidence_digest`),
    secrets_included: false,
  };
}

function normalizeRuntimeReadback(input = {}) {
  return Object.fromEntries(ENDPOINT_KEYS.map((key) => [key, normalizeRuntimeEndpoint(input[key], key)]));
}

function normalizePressure(input = {}) {
  const status = safeId(input.status, 'storage_pressure.status');
  if (!ALLOWED_PRESSURE.has(status)) {
    throw fail(400, 'STORAGE_PRODUCTION_PREFLIGHT_PRESSURE_STATUS_INVALID', 'Storage pressure status is unsupported.', { status });
  }
  return {
    source: safeId(input.source, 'storage_pressure.source'),
    status,
    bytes_used: nonNegativeNumber(input.bytes_used, 'storage_pressure.bytes_used'),
    bytes_limit: nonNegativeNumber(input.bytes_limit, 'storage_pressure.bytes_limit'),
    inodes_used: nonNegativeNumber(input.inodes_used, 'storage_pressure.inodes_used'),
    inodes_limit: nonNegativeNumber(input.inodes_limit, 'storage_pressure.inodes_limit'),
    observed_at_epoch: epoch(input.observed_at_epoch, 'storage_pressure.observed_at_epoch'),
    evidence_digest: sha256(input.evidence_digest, 'storage_pressure.evidence_digest'),
    secrets_included: false,
  };
}

function normalizeLayout(input = {}) {
  return {
    layout_proof_id: safeId(input.layout_proof_id, 'deployment_layout.layout_proof_id'),
    status: safeId(input.status, 'deployment_layout.status'),
    active_production_sha: sha1(input.active_production_sha, 'deployment_layout.active_production_sha'),
    candidate_sha: sha1(input.candidate_sha, 'deployment_layout.candidate_sha'),
    active_root_excluded: input.active_root_excluded === true,
    rollback_set_retained: input.rollback_set_retained === true,
    rollback_set_count: positiveInteger(input.rollback_set_count, 'deployment_layout.rollback_set_count'),
    candidate_roots_certified: input.candidate_roots_certified === true,
    observed_at_epoch: epoch(input.observed_at_epoch, 'deployment_layout.observed_at_epoch'),
    evidence_digest: sha256(input.evidence_digest, 'deployment_layout.evidence_digest'),
    secrets_included: false,
  };
}

function normalizeCanary(input = {}) {
  const integrityFindings = Number(input.integrity_findings);
  if (!Number.isSafeInteger(integrityFindings) || integrityFindings < 0) {
    throw fail(400, 'STORAGE_PRODUCTION_PREFLIGHT_INTEGRITY_COUNT_INVALID', 'A non-negative integrity finding count is required.');
  }
  return {
    contract: safeId(input.contract, 'canary.contract'),
    feature_key: safeId(input.feature_key, 'canary.feature_key'),
    workstream_id: safeId(input.workstream_id, 'canary.workstream_id'),
    status: safeId(input.status, 'canary.status'),
    candidate_kind: safeId(input.candidate_kind, 'canary.candidate_kind'),
    release_candidate_sha: sha1(input.release_candidate_sha, 'canary.release_candidate_sha'),
    workstream_head_sha: sha1(input.workstream_head_sha, 'canary.workstream_head_sha'),
    integration_merge_sha: sha1(input.integration_merge_sha, 'canary.integration_merge_sha'),
    e2e_run_id: positiveInteger(input.e2e_run_id, 'canary.e2e_run_id'),
    evaluate: safeId(input.evaluate, 'canary.evaluate'),
    execute: safeId(input.execute, 'canary.execute'),
    source_reports_ok: input.source_reports_ok === true,
    source_report_count: positiveInteger(input.source_report_count, 'canary.source_report_count'),
    integrity_findings: integrityFindings,
    observed_at_epoch: epoch(input.observed_at_epoch, 'canary.observed_at_epoch'),
    evidence_digest: sha256(input.evidence_digest, 'canary.evidence_digest'),
    secrets_included: false,
  };
}

function normalizeGovernance(input = {}) {
  return {
    read_only: input.read_only === true,
    auto_cleanup_allowed: input.auto_cleanup_allowed === true,
    mutation_allowed: input.mutation_allowed === true,
    provider_dispatch_allowed: input.provider_dispatch_allowed === true,
    migration_apply_allowed: input.migration_apply_allowed === true,
    deployment_requires_separate_authority: input.deployment_requires_separate_authority === true,
    production_promotion_requires_separate_authority: input.production_promotion_requires_separate_authority === true,
    secrets_included: false,
  };
}

function freshnessBlockers({ observedAt, now, maxAge, prefix }) {
  const blockers = [];
  if (observedAt > now) blockers.push(`${prefix}_FUTURE`);
  if (now - observedAt > maxAge) blockers.push(`${prefix}_STALE`);
  return blockers;
}

function evaluate(normalized, now, maxAge) {
  const blockers = [];
  const warnings = [];
  const { candidate, runtime_readback: runtime, storage_pressure: pressure, deployment_layout: layout, canary_evidence: canary, governance } = normalized;

  if (candidate.environment !== 'production') blockers.push('STORAGE_PRODUCTION_PREFLIGHT_ENVIRONMENT_INVALID');
  if (candidate.candidate_sha !== candidate.source_main_sha) blockers.push('STORAGE_PRODUCTION_PREFLIGHT_SOURCE_SHA_MISMATCH');

  for (const key of ENDPOINT_KEYS) {
    const evidence = runtime[key];
    if (!evidence.ok) blockers.push(`STORAGE_PRODUCTION_PREFLIGHT_${key.toUpperCase()}_READBACK_FAILED`);
    if (evidence.environment !== 'production') blockers.push(`STORAGE_PRODUCTION_PREFLIGHT_${key.toUpperCase()}_ENVIRONMENT_MISMATCH`);
    if (evidence.commit_sha !== candidate.production_branch_sha) blockers.push(`STORAGE_PRODUCTION_PREFLIGHT_${key.toUpperCase()}_SHA_MISMATCH`);
    blockers.push(...freshnessBlockers({ observedAt: evidence.observed_at_epoch, now, maxAge, prefix: `STORAGE_PRODUCTION_PREFLIGHT_${key.toUpperCase()}` }));
  }

  if (pressure.source !== 'hpanel_read_only') blockers.push('STORAGE_PRODUCTION_PREFLIGHT_PRESSURE_SOURCE_INVALID');
  blockers.push(...freshnessBlockers({ observedAt: pressure.observed_at_epoch, now, maxAge, prefix: 'STORAGE_PRODUCTION_PREFLIGHT_PRESSURE' }));
  if (pressure.bytes_limit <= 0 || pressure.inodes_limit <= 0) blockers.push('STORAGE_PRODUCTION_PREFLIGHT_PRESSURE_LIMIT_INVALID');
  if (pressure.bytes_used > pressure.bytes_limit || pressure.inodes_used > pressure.inodes_limit) blockers.push('STORAGE_PRODUCTION_PREFLIGHT_PRESSURE_LIMIT_EXCEEDED');
  if (BLOCKING_PRESSURE.has(pressure.status)) blockers.push('STORAGE_PRODUCTION_PREFLIGHT_PRESSURE_BLOCKING');
  if (pressure.status === 'warning') warnings.push('STORAGE_PRODUCTION_PREFLIGHT_PRESSURE_WARNING');

  if (layout.status !== 'verified') blockers.push('STORAGE_PRODUCTION_PREFLIGHT_LAYOUT_NOT_VERIFIED');
  if (layout.active_production_sha !== candidate.production_branch_sha) blockers.push('STORAGE_PRODUCTION_PREFLIGHT_ACTIVE_SHA_MISMATCH');
  if (layout.candidate_sha !== candidate.candidate_sha) blockers.push('STORAGE_PRODUCTION_PREFLIGHT_CANDIDATE_SHA_MISMATCH');
  if (!layout.active_root_excluded) blockers.push('STORAGE_PRODUCTION_PREFLIGHT_ACTIVE_ROOT_NOT_EXCLUDED');
  if (!layout.rollback_set_retained || layout.rollback_set_count < 1) blockers.push('STORAGE_PRODUCTION_PREFLIGHT_ROLLBACK_SET_REQUIRED');
  if (!layout.candidate_roots_certified) blockers.push('STORAGE_PRODUCTION_PREFLIGHT_CANDIDATE_ROOTS_NOT_CERTIFIED');
  blockers.push(...freshnessBlockers({ observedAt: layout.observed_at_epoch, now, maxAge, prefix: 'STORAGE_PRODUCTION_PREFLIGHT_LAYOUT' }));

  if (canary.contract !== 'mad4b.ci-evidence-summary.v1'
    || canary.feature_key !== '014-governed-hostinger-storage-orchestration'
    || canary.workstream_id !== 'shared-canary'
    || canary.status !== 'passed'
    || canary.candidate_kind !== 'head'
    || canary.release_candidate_sha !== candidate.candidate_sha
    || canary.evaluate !== 'success'
    || canary.execute !== 'success'
    || canary.source_reports_ok !== true
    || canary.source_report_count < 2
    || canary.integrity_findings !== 0) {
    blockers.push('STORAGE_PRODUCTION_PREFLIGHT_SHARED_CANARY_INVALID');
  }
  blockers.push(...freshnessBlockers({ observedAt: canary.observed_at_epoch, now, maxAge, prefix: 'STORAGE_PRODUCTION_PREFLIGHT_CANARY' }));

  if (!governance.read_only
    || governance.auto_cleanup_allowed
    || governance.mutation_allowed
    || governance.provider_dispatch_allowed
    || governance.migration_apply_allowed) {
    blockers.push('STORAGE_PRODUCTION_PREFLIGHT_READ_ONLY_BOUNDARY_VIOLATED');
  }
  if (!governance.deployment_requires_separate_authority
    || !governance.production_promotion_requires_separate_authority) {
    blockers.push('STORAGE_PRODUCTION_PREFLIGHT_SEPARATE_AUTHORITY_REQUIRED');
  }

  return { blockers: unique(blockers), warnings: unique(warnings) };
}

export function buildHostingerStorageProductionPreflight(input = {}) {
  const captured = clone(input);
  assertSecretFree(captured);
  const now = epoch(captured.now_epoch ?? Math.floor(Date.now() / 1000), 'now_epoch');
  const maxAge = positiveInteger(captured.max_evidence_age_seconds ?? 900, 'max_evidence_age_seconds');
  const normalized = {
    contract: HOSTINGER_STORAGE_PRODUCTION_PREFLIGHT_VERSION,
    preflight_id: safeId(captured.preflight_id, 'preflight_id'),
    assessed_at_epoch: now,
    max_evidence_age_seconds: maxAge,
    candidate: normalizeCandidate(captured.candidate),
    runtime_readback: normalizeRuntimeReadback(captured.runtime_readback),
    storage_pressure: normalizePressure(captured.storage_pressure),
    deployment_layout: normalizeLayout(captured.deployment_layout),
    canary_evidence: normalizeCanary(captured.canary_evidence),
    governance: normalizeGovernance(captured.governance),
    secrets_included: false,
  };
  const decision = evaluate(normalized, now, maxAge);
  const result = {
    ...normalized,
    blockers: decision.blockers,
    warnings: decision.warnings,
    preflight_passed: decision.blockers.length === 0,
    promotion_preflight_ready: decision.blockers.length === 0,
    deployment_allowed: false,
    production_promotion_allowed: false,
    mutation_allowed: false,
    auto_cleanup_allowed: false,
    provider_dispatch_allowed: false,
    separate_release_authority_required: true,
    secrets_included: false,
  };
  result.evidence_digest = digest(result);
  return deepFreeze(result);
}

export function verifyHostingerStorageProductionPreflight({ preflight, expected_digest, now_epoch } = {}) {
  const supplied = clone(preflight);
  assertSecretFree(supplied);
  const expected = sha256(expected_digest, 'expected_digest');
  const suppliedDigest = text(supplied?.evidence_digest, 64).toLowerCase();
  delete supplied.evidence_digest;
  const calculatedDigest = digest(supplied);
  const now = epoch(now_epoch ?? supplied?.assessed_at_epoch ?? Math.floor(Date.now() / 1000), 'now_epoch');
  const blockers = [];
  if (suppliedDigest !== expected || calculatedDigest !== expected) blockers.push('STORAGE_PRODUCTION_PREFLIGHT_EVIDENCE_TAMPERED');
  if (supplied?.contract !== HOSTINGER_STORAGE_PRODUCTION_PREFLIGHT_VERSION) blockers.push('STORAGE_PRODUCTION_PREFLIGHT_CONTRACT_INVALID');
  if (supplied?.assessed_at_epoch > now) blockers.push('STORAGE_PRODUCTION_PREFLIGHT_ASSESSMENT_FUTURE');
  if (!supplied?.preflight_passed || !supplied?.promotion_preflight_ready || (supplied?.blockers || []).length) blockers.push('STORAGE_PRODUCTION_PREFLIGHT_NOT_PASSED');
  if (supplied?.deployment_allowed !== false
    || supplied?.production_promotion_allowed !== false
    || supplied?.mutation_allowed !== false
    || supplied?.auto_cleanup_allowed !== false
    || supplied?.provider_dispatch_allowed !== false
    || supplied?.separate_release_authority_required !== true) {
    blockers.push('STORAGE_PRODUCTION_PREFLIGHT_AUTHORITY_BOUNDARY_INVALID');
  }
  return deepFreeze({
    valid: unique(blockers).length === 0,
    blockers: unique(blockers),
    evidence_digest: calculatedDigest,
    deployment_allowed: false,
    production_promotion_allowed: false,
    mutation_allowed: false,
    provider_dispatch_allowed: false,
    secrets_included: false,
  });
}
