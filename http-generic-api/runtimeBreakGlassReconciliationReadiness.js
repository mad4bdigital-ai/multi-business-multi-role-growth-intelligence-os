import { createHash } from "node:crypto";

export const BREAK_GLASS_RECONCILIATION_READINESS_CONTRACT = "mad4b.runtime-break-glass-reconciliation-readiness.v1";
export const BREAK_GLASS_ROLLBACK_REHEARSAL_CONTRACT = "mad4b.runtime-break-glass-rollback-rehearsal.v1";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function text(value) { return String(value ?? "").trim(); }
function ms(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? parsed : null; }
function same(a, b) { return text(a).toLowerCase() === text(b).toLowerCase() && text(a) !== ""; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function validFreshEvidence(evidence, nowMs, maxAgeMs) {
  const at = ms(evidence?.verified_at || evidence?.observed_at || evidence?.promoted_at || evidence?.deployed_at);
  return at !== null && at <= nowMs && (nowMs - at) <= maxAgeMs;
}

export function assessRuntimeBreakGlassReconciliationReadiness({
  incident = {},
  evidence = {},
  now = new Date(),
  max_evidence_age_seconds = 3600,
} = {}) {
  const blockers = [];
  const nowMs = now instanceof Date ? now.getTime() : ms(now);
  const expectedCommit = text(incident.expected_commit_sha).toLowerCase();
  if (!SHA40.test(expectedCommit)) blockers.push("BREAK_GLASS_EXPECTED_COMMIT_INVALID");
  const expiresAt = ms(incident.authorization_expires_at);
  if (expiresAt === null || !Number.isFinite(nowMs) || expiresAt <= nowMs) blockers.push("BREAK_GLASS_AUTHORIZATION_EXPIRED");
  const maxAgeMs = Math.max(1, Math.trunc(Number(max_evidence_age_seconds) || 3600)) * 1000;

  const git = evidence.git_representation || {};
  if (git.present !== true || !same(git.commit_sha, expectedCommit) || !text(git.repository_path)) blockers.push("BREAK_GLASS_GIT_REPRESENTATION_INCOMPLETE");
  if (Array.isArray(incident.allowed_paths) && incident.allowed_paths.length && Array.isArray(git.path_hashes)) {
    const covered = new Map(git.path_hashes.map((entry) => [text(entry.path), text(entry.sha256).toLowerCase()]));
    for (const path of incident.allowed_paths) {
      if (!SHA256.test(covered.get(text(path)) || "")) blockers.push("BREAK_GLASS_GIT_PATH_HASH_COVERAGE_INCOMPLETE");
    }
  }

  const main = evidence.main_reachability || {};
  if (main.reachable !== true || !same(main.commit_sha, expectedCommit) || !validFreshEvidence(main, nowMs, maxAgeMs)) blockers.push("BREAK_GLASS_MAIN_REACHABILITY_UNVERIFIED");
  const staging = evidence.staging_verification || {};
  if (staging.verified !== true || !same(staging.commit_sha, expectedCommit) || !validFreshEvidence(staging, nowMs, maxAgeMs)) blockers.push("BREAK_GLASS_STAGING_VERIFICATION_INCOMPLETE");

  const promotion = evidence.production_promotion || {};
  if (promotion.governed_flow !== true || !SHA40.test(text(promotion.production_sha).toLowerCase()) || promotion.contains_expected_commit !== true || !validFreshEvidence(promotion, nowMs, maxAgeMs)) blockers.push("BREAK_GLASS_PRODUCTION_PROMOTION_EVIDENCE_INCOMPLETE");
  const redeploy = evidence.clean_redeploy || {};
  if (redeploy.clean !== true || !same(redeploy.production_sha, promotion.production_sha) || !same(redeploy.deployed_sha, promotion.production_sha) || !validFreshEvidence(redeploy, nowMs, maxAgeMs)) blockers.push("BREAK_GLASS_CLEAN_REDEPLOY_EVIDENCE_INCOMPLETE");
  const readback = evidence.clean_runtime_readback || {};
  if (readback.clean !== true || !same(readback.deployed_sha, promotion.production_sha) || Number(readback.unreconciled_local_difference_count) !== 0 || !validFreshEvidence(readback, nowMs, maxAgeMs)) blockers.push("BREAK_GLASS_CLEAN_READBACK_INCOMPLETE");

  const replay = evidence.replay_guard || {};
  if (!text(replay.event_id)) blockers.push("BREAK_GLASS_REPLAY_ID_MISSING");
  if (Array.isArray(replay.prior_event_ids) && replay.prior_event_ids.map(text).includes(text(replay.event_id))) blockers.push("BREAK_GLASS_REPLAY_DETECTED");
  if (replay.incident_id && incident.incident_id && !same(replay.incident_id, incident.incident_id)) blockers.push("BREAK_GLASS_REPLAY_INCIDENT_MISMATCH");

  const deduped = unique(blockers);
  return Object.freeze({
    ok: true,
    contract: BREAK_GLASS_RECONCILIATION_READINESS_CONTRACT,
    readiness_status: deduped.length ? "blocked" : "ready_for_runtime_authority_consumption",
    blockers: Object.freeze(deduped),
    expected_commit_sha: SHA40.test(expectedCommit) ? expectedCommit : null,
    evidence_fingerprint_sha256: digest(evidence),
    governed_git_representation_ready: !deduped.includes("BREAK_GLASS_GIT_REPRESENTATION_INCOMPLETE"),
    main_reachability_ready: !deduped.includes("BREAK_GLASS_MAIN_REACHABILITY_UNVERIFIED"),
    staging_verification_ready: !deduped.includes("BREAK_GLASS_STAGING_VERIFICATION_INCOMPLETE"),
    production_promotion_evidence_ready: !deduped.includes("BREAK_GLASS_PRODUCTION_PROMOTION_EVIDENCE_INCOMPLETE"),
    clean_redeploy_evidence_ready: !deduped.includes("BREAK_GLASS_CLEAN_REDEPLOY_EVIDENCE_INCOMPLETE"),
    clean_readback_ready: !deduped.includes("BREAK_GLASS_CLEAN_READBACK_INCOMPLETE"),
    runtime_transition_activation: false,
    authority_granted_by_track_b: false,
    provider_called: false,
    database_mutated: false,
    migration_applied: false,
    protected_branch_write_performed: false,
    production_mutated: false,
    secrets_included: false,
  });
}

export function buildRuntimeBreakGlassRollbackRehearsal({
  incident = {},
  rollback_evidence = {},
  now = new Date(),
} = {}) {
  const blockers = [];
  const nowMs = now instanceof Date ? now.getTime() : ms(now);
  if (!text(incident.break_glass_id)) blockers.push("BREAK_GLASS_ID_MISSING");
  if (!text(incident.rollback_plan?.strategy)) blockers.push("BREAK_GLASS_ROLLBACK_STRATEGY_MISSING");
  if (!text(rollback_evidence.rehearsal_id)) blockers.push("BREAK_GLASS_ROLLBACK_REHEARSAL_ID_MISSING");
  if (rollback_evidence.scope_matches_incident !== true) blockers.push("BREAK_GLASS_ROLLBACK_SCOPE_MISMATCH");
  if (rollback_evidence.pre_change_hash_restore_verified !== true) blockers.push("BREAK_GLASS_ROLLBACK_HASH_RESTORE_UNVERIFIED");
  if (rollback_evidence.runtime_readback_clean !== true) blockers.push("BREAK_GLASS_ROLLBACK_READBACK_UNVERIFIED");
  const at = ms(rollback_evidence.verified_at);
  if (at === null || !Number.isFinite(nowMs) || at > nowMs) blockers.push("BREAK_GLASS_ROLLBACK_EVIDENCE_TIMESTAMP_INVALID");
  return Object.freeze({
    contract: BREAK_GLASS_ROLLBACK_REHEARSAL_CONTRACT,
    rehearsal_status: blockers.length ? "blocked" : "pass",
    blockers: Object.freeze(unique(blockers)),
    execution_mode: "evidence_only",
    rollback_executed: false,
    runtime_mutation_performed: false,
    provider_called: false,
    database_mutated: false,
    production_mutated: false,
    secrets_included: false,
  });
}
