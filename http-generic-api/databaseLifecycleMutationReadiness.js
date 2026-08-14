import { createHash } from "node:crypto";

export const DATABASE_LIFECYCLE_MUTATION_READINESS_CONTRACT = "mad4b.database-lifecycle-mutation-readiness.v1";
export const DATABASE_LIFECYCLE_TTL_PILOT_CONTRACT = "mad4b.database-lifecycle-ttl-pilot.v1";
export const DATABASE_LIFECYCLE_SUPERSESSION_CONTRACT = "mad4b.database-lifecycle-supersession-adapter.v1";

export const DATABASE_LIFECYCLE_REGISTERED_RECIPES = Object.freeze({
  "database.response_chunks.expired_cleanup": Object.freeze({
    resource_table: "governed_tool_response_chunks",
    risk_class: "medium",
    non_production_only: true,
  }),
  "database.repo_audit.superseded_findings_cleanup": Object.freeze({
    resource_table: "repo_file_audit_findings",
    risk_class: "high",
    non_production_only: true,
  }),
});

export const DATABASE_LIFECYCLE_DISABLED_FOLLOWUPS = Object.freeze({
  job_runner: false,
  autopilot: false,
  engine_run_archive_thin: false,
  physical_reclaim_execution: false,
});

const SHA256_FINGERPRINT = /^sha256:[a-f0-9]{64}$/u;
const EXACT_RESOURCE = /^mysql:\/\/[^/]+\/[^*?]+$/u;
const PRODUCTION_KEYS = new Set(["production", "prod"]);

function text(value) { return String(value ?? "").trim(); }
function toMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}
function iso(value) {
  const parsed = toMs(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}
function canonical(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function fingerprint(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function isProductionEnvironment(value) { return PRODUCTION_KEYS.has(text(value).toLowerCase()); }
function same(a, b) { return text(a) === text(b) && text(a) !== ""; }
function validExpiry(value, nowMs) {
  const expires = toMs(value);
  return expires !== null && expires > nowMs;
}
function nonEmpty(value) { return text(value).length > 0; }

function validateAuthorityBinding(binding, plan, nowMs) {
  const blockers = [];
  if (!binding || typeof binding !== "object") return ["DATABASE_AUTHORITY_EVIDENCE_MISSING"];
  if (!nonEmpty(binding.authority_binding_id)) blockers.push("DATABASE_AUTHORITY_BINDING_ID_MISSING");
  if (binding.resource_type !== "database_table") blockers.push("DATABASE_AUTHORITY_RESOURCE_TYPE_MISMATCH");
  if (!EXACT_RESOURCE.test(text(binding.resource_uri))) blockers.push("DATABASE_AUTHORITY_RESOURCE_NOT_EXACT");
  if (!same(binding.resource_uri, plan.resource_uri)) blockers.push("DATABASE_AUTHORITY_RESOURCE_MISMATCH");
  if (!same(binding.recipe_key, plan.recipe_key)) blockers.push("DATABASE_AUTHORITY_RECIPE_MISMATCH");
  if (!nonEmpty(binding.principal_id)) blockers.push("DATABASE_AUTHORITY_PRINCIPAL_MISSING");
  if (!nonEmpty(binding.policy_revision)) blockers.push("DATABASE_AUTHORITY_POLICY_REVISION_MISSING");
  if (!validExpiry(binding.expires_at, nowMs)) blockers.push("DATABASE_AUTHORITY_EVIDENCE_EXPIRED");
  return blockers;
}

function validateApproval(approval, plan, nowMs) {
  const blockers = [];
  if (!approval || typeof approval !== "object") return ["DATABASE_TYPED_APPROVAL_MISSING"];
  if (!nonEmpty(approval.approval_id)) blockers.push("DATABASE_TYPED_APPROVAL_ID_MISSING");
  if (!same(approval.plan_id, plan.plan_id)) blockers.push("DATABASE_APPROVAL_PLAN_ID_MISMATCH");
  if (!same(approval.plan_fingerprint, plan.plan_fingerprint) || !SHA256_FINGERPRINT.test(text(approval.plan_fingerprint))) blockers.push("DATABASE_APPROVAL_PLAN_FINGERPRINT_MISMATCH");
  if (!same(approval.resource_uri, plan.resource_uri)) blockers.push("DATABASE_APPROVAL_RESOURCE_MISMATCH");
  if (!same(approval.recipe_key, plan.recipe_key)) blockers.push("DATABASE_APPROVAL_RECIPE_MISMATCH");
  if (!nonEmpty(approval.approved_by)) blockers.push("DATABASE_APPROVAL_PRINCIPAL_MISSING");
  if (toMs(approval.approved_at) === null) blockers.push("DATABASE_APPROVAL_TIMESTAMP_INVALID");
  if (!validExpiry(approval.expires_at, nowMs)) blockers.push("DATABASE_APPROVAL_EXPIRED");
  return blockers;
}

function validateEnvelope(envelope, plan, nowMs) {
  const blockers = [];
  if (!envelope || typeof envelope !== "object") return ["DATABASE_CAPABILITY_ENVELOPE_MISSING"];
  if (!nonEmpty(envelope.envelope_id)) blockers.push("DATABASE_CAPABILITY_ENVELOPE_ID_MISSING");
  if (!same(envelope.plan_fingerprint, plan.plan_fingerprint)) blockers.push("DATABASE_CAPABILITY_PLAN_FINGERPRINT_MISMATCH");
  if (!same(envelope.resource_uri, plan.resource_uri)) blockers.push("DATABASE_CAPABILITY_RESOURCE_MISMATCH");
  if (!same(envelope.recipe_key, plan.recipe_key)) blockers.push("DATABASE_CAPABILITY_RECIPE_MISMATCH");
  if (!validExpiry(envelope.expires_at, nowMs)) blockers.push("DATABASE_CAPABILITY_ENVELOPE_EXPIRED");
  if (envelope.secrets_included !== false) blockers.push("DATABASE_CAPABILITY_SECRET_BOUNDARY_INVALID");
  return blockers;
}

function validateLease(lease, plan, nowMs) {
  const blockers = [];
  if (!lease || typeof lease !== "object") return ["DATABASE_EXECUTION_LEASE_MISSING"];
  if (!nonEmpty(lease.lease_id)) blockers.push("DATABASE_EXECUTION_LEASE_ID_MISSING");
  if (!same(lease.plan_fingerprint, plan.plan_fingerprint)) blockers.push("DATABASE_LEASE_PLAN_FINGERPRINT_MISMATCH");
  if (!same(lease.resource_uri, plan.resource_uri)) blockers.push("DATABASE_LEASE_RESOURCE_MISMATCH");
  if (!same(lease.recipe_key, plan.recipe_key)) blockers.push("DATABASE_LEASE_RECIPE_MISMATCH");
  if (!validExpiry(lease.expires_at, nowMs)) blockers.push("DATABASE_EXECUTION_LEASE_EXPIRED");
  return blockers;
}

function validateReceiptReadback(receiptReadiness = {}) {
  const blockers = [];
  if (receiptReadiness.persistence_available !== true) blockers.push("DATABASE_RECEIPT_PERSISTENCE_UNAVAILABLE");
  if (receiptReadiness.idempotency_key_supported !== true) blockers.push("DATABASE_RECEIPT_IDEMPOTENCY_UNAVAILABLE");
  if (receiptReadiness.unknown_outcome_reconciliation_available !== true) blockers.push("DATABASE_UNKNOWN_OUTCOME_RECONCILIATION_UNAVAILABLE");
  if (receiptReadiness.same_cycle_readback_available !== true) blockers.push("DATABASE_SAME_CYCLE_READBACK_UNAVAILABLE");
  if (receiptReadiness.readback_source_same_authority !== true) blockers.push("DATABASE_READBACK_AUTHORITY_MISMATCH");
  return blockers;
}

export function assessDatabaseLifecycleMutationReadiness({
  plan = {},
  authority_binding = null,
  capability_envelope = null,
  execution_lease = null,
  typed_approval = null,
  receipt_readiness = {},
  environment_key = "non-production",
  now = new Date(),
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : toMs(now);
  const blockers = [];
  const recipe = DATABASE_LIFECYCLE_REGISTERED_RECIPES[text(plan.recipe_key)];
  if (!nonEmpty(plan.plan_id)) blockers.push("DATABASE_PLAN_ID_MISSING");
  if (!SHA256_FINGERPRINT.test(text(plan.plan_fingerprint))) blockers.push("DATABASE_PLAN_FINGERPRINT_INVALID");
  if (!EXACT_RESOURCE.test(text(plan.resource_uri))) blockers.push("DATABASE_RESOURCE_NOT_EXACT");
  if (!recipe) blockers.push("DATABASE_RECIPE_NOT_REGISTERED");
  if (recipe && !text(plan.resource_uri).endsWith(`/${recipe.resource_table}`)) blockers.push("DATABASE_RECIPE_RESOURCE_MISMATCH");
  if (isProductionEnvironment(environment_key)) blockers.push("DATABASE_TRACK_B_PRODUCTION_MUTATION_FORBIDDEN");
  if (!Number.isFinite(nowMs)) blockers.push("DATABASE_READINESS_CLOCK_INVALID");
  if (Number.isFinite(nowMs)) {
    blockers.push(...validateAuthorityBinding(authority_binding, plan, nowMs));
    blockers.push(...validateEnvelope(capability_envelope, plan, nowMs));
    blockers.push(...validateLease(execution_lease, plan, nowMs));
    blockers.push(...validateApproval(typed_approval, plan, nowMs));
  }
  blockers.push(...validateReceiptReadback(receipt_readiness));
  const deduped = unique(blockers);
  return Object.freeze({
    ok: true,
    contract: DATABASE_LIFECYCLE_MUTATION_READINESS_CONTRACT,
    readiness_status: deduped.length ? "blocked" : "ready_for_final_authority_consumption",
    blockers: Object.freeze(deduped),
    registered_recipe: recipe ? text(plan.recipe_key) : null,
    authority_evidence_consumed: Boolean(authority_binding),
    authority_granted_by_track_b: false,
    final_authority_decision_performed: false,
    durable_execution_started: false,
    runtime_consumer_enabled: false,
    provider_called: false,
    migration_applied: false,
    database_mutated: false,
    production_mutated: false,
    secrets_included: false,
  });
}

function normalizeCandidate(candidate = {}) {
  return {
    candidate_key: text(candidate.candidate_key || candidate.chunk_id || candidate.id),
    expires_at: iso(candidate.expires_at),
    created_at: iso(candidate.created_at),
    payload_bytes: Math.max(0, Math.trunc(Number(candidate.payload_bytes || candidate.size_bytes || 0)) || 0),
  };
}

export function buildResponseChunkTtlPilotPlan({
  resource_uri = "mysql://growthOS/governed_tool_response_chunks",
  cutoff_at,
  plan_created_at,
  candidates = [],
  batch_size = 100,
  max_batches = 20,
  environment_key = "staging",
} = {}) {
  const cutoffMs = toMs(cutoff_at);
  const planMs = toMs(plan_created_at);
  const blockers = [];
  if (!EXACT_RESOURCE.test(text(resource_uri)) || !text(resource_uri).endsWith("/governed_tool_response_chunks")) blockers.push("TTL_RESOURCE_NOT_EXACT");
  if (cutoffMs === null) blockers.push("TTL_CUTOFF_INVALID");
  if (planMs === null) blockers.push("TTL_PLAN_TIMESTAMP_INVALID");
  if (cutoffMs !== null && planMs !== null && cutoffMs > planMs) blockers.push("TTL_CUTOFF_AFTER_PLAN_TIMESTAMP");
  if (isProductionEnvironment(environment_key)) blockers.push("TTL_PILOT_PRODUCTION_FORBIDDEN");
  const boundedBatchSize = Math.min(Math.max(Math.trunc(Number(batch_size)) || 100, 1), 500);
  const boundedMaxBatches = Math.min(Math.max(Math.trunc(Number(max_batches)) || 20, 1), 100);
  const normalized = candidates.map(normalizeCandidate).filter((item) => item.candidate_key).sort((a, b) => a.candidate_key.localeCompare(b.candidate_key));
  const eligible = [];
  const preserved = [];
  for (const candidate of normalized) {
    const expiresMs = toMs(candidate.expires_at);
    const createdMs = toMs(candidate.created_at);
    let reason = null;
    if (expiresMs === null) reason = "expiry_unknown";
    else if (cutoffMs !== null && expiresMs >= cutoffMs) reason = "not_expired_before_cutoff";
    else if (createdMs !== null && planMs !== null && createdMs > planMs) reason = "post_plan_row";
    if (reason) preserved.push({ ...candidate, preservation_reason: reason });
    else eligible.push(candidate);
  }
  const bounded = eligible.slice(0, boundedBatchSize * boundedMaxBatches);
  if (eligible.length > bounded.length) blockers.push("TTL_CANDIDATE_SET_EXCEEDS_BOUNDED_PILOT");
  const planBody = {
    contract: DATABASE_LIFECYCLE_TTL_PILOT_CONTRACT,
    resource_uri: text(resource_uri),
    recipe_key: "database.response_chunks.expired_cleanup",
    environment_key: text(environment_key),
    cutoff_at: iso(cutoff_at),
    plan_created_at: iso(plan_created_at),
    batch_size: boundedBatchSize,
    max_batches: boundedMaxBatches,
    candidates: bounded,
  };
  const planFingerprint = fingerprint(planBody);
  const batches = [];
  for (let offset = 0; offset < bounded.length; offset += boundedBatchSize) {
    const rows = bounded.slice(offset, offset + boundedBatchSize);
    const batchIndex = batches.length + 1;
    batches.push(Object.freeze({
      batch_index: batchIndex,
      batch_id: `ttl_${planFingerprint.slice(7, 19)}_${String(batchIndex).padStart(3, "0")}`,
      candidate_keys: Object.freeze(rows.map((row) => row.candidate_key)),
      candidate_count: rows.length,
      expected_receipt_idempotency_key: `${planFingerprint}:batch:${batchIndex}`,
    }));
  }
  return Object.freeze({
    ok: blockers.length === 0,
    ...planBody,
    plan_id: `dbttl_${planFingerprint.slice(7, 23)}`,
    plan_fingerprint: planFingerprint,
    eligible_candidate_count: bounded.length,
    total_eligible_before_bound: eligible.length,
    preserved_candidate_count: preserved.length,
    preserved_candidates: Object.freeze(preserved),
    batches: Object.freeze(batches),
    blockers: Object.freeze(unique(blockers)),
    receipt_contract: Object.freeze({
      persist_before_next_batch: true,
      bind_plan_fingerprint: true,
      bind_batch_id: true,
      bind_candidate_keys: true,
      unknown_outcome_requires_readback_before_retry: true,
      same_cycle_readback_required: true,
    }),
    physical_reclaim_assessment: Object.freeze({
      allowed: true,
      observation_only: true,
      automatic_compaction: false,
      optimize_table_allowed: false,
      physical_reclaim_execution: false,
    }),
    execution_allowed: false,
    pilot_mode: "non_production_dry_run_rehearsal",
    database_mutated: false,
    provider_called: false,
    runtime_consumer_enabled: false,
    secrets_included: false,
  });
}

export function reconcileResponseChunkTtlPilot({ plan = {}, receipts = [], readback = [] } = {}) {
  const receiptByBatch = new Map(receipts.map((receipt) => [text(receipt.batch_id), receipt]));
  const readbackByBatch = new Map(readback.map((entry) => [text(entry.batch_id), entry]));
  const batches = Array.isArray(plan.batches) ? plan.batches : [];
  const outcomes = batches.map((batch) => {
    const receipt = receiptByBatch.get(text(batch.batch_id));
    const check = readbackByBatch.get(text(batch.batch_id));
    const receiptMatches = Boolean(receipt)
      && same(receipt.plan_fingerprint, plan.plan_fingerprint)
      && same(receipt.idempotency_key, batch.expected_receipt_idempotency_key);
    const readbackMatches = Boolean(check)
      && same(check.plan_fingerprint, plan.plan_fingerprint)
      && check.same_cycle === true
      && check.authoritative_source === true;
    return {
      batch_id: batch.batch_id,
      status: receiptMatches && readbackMatches ? "reconciled" : receipt ? "unknown_outcome_readback_required" : "not_executed",
      receipt_matches: receiptMatches,
      readback_matches: readbackMatches,
      retry_permitted: receiptMatches && readbackMatches && check?.result === "not_applied",
    };
  });
  return Object.freeze({
    contract: DATABASE_LIFECYCLE_TTL_PILOT_CONTRACT,
    plan_fingerprint: text(plan.plan_fingerprint) || null,
    outcomes: Object.freeze(outcomes),
    all_reconciled: outcomes.length > 0 && outcomes.every((entry) => entry.status === "reconciled"),
    blind_retry_allowed: false,
    database_mutated: false,
    reconciliation_only: true,
    secrets_included: false,
  });
}

function normalizeFinding(row = {}) {
  return {
    finding_id: text(row.finding_id || row.id),
    file_key: text(row.file_key || row.path || row.file_path),
    parent_run_id: text(row.parent_run_id || row.run_id),
    observed_at: iso(row.observed_at || row.created_at),
  };
}
function runTerminal(status) { return ["completed", "succeeded", "success"].includes(text(status).toLowerCase()); }

export function assessPolicyBoundAutopilotEligibility({
  recipe_key,
  environment_key = "staging",
  explicit_enablement = false,
  expires_at,
  fallback_readiness = false,
  reconciliation_ready = false,
  now = new Date(),
} = {}) {
  const blockers = [];
  const recipe = DATABASE_LIFECYCLE_REGISTERED_RECIPES[text(recipe_key)];
  const nowMs = now instanceof Date ? now.getTime() : toMs(now);
  const expiryMs = toMs(expires_at);
  if (!recipe) blockers.push("AUTOPILOT_RECIPE_NOT_REGISTERED");
  if (recipe && recipe.risk_class !== "low") blockers.push("AUTOPILOT_RISK_CLASS_NOT_LOW");
  if (/(archive|purge|compaction|rebuild|reclaim)/iu.test(text(recipe_key))) blockers.push("AUTOPILOT_HIGH_RISK_RECIPE_FORBIDDEN");
  if (isProductionEnvironment(environment_key)) blockers.push("AUTOPILOT_PRODUCTION_FORBIDDEN");
  if (explicit_enablement !== true) blockers.push("AUTOPILOT_EXPLICIT_ENABLEMENT_REQUIRED");
  if (!Number.isFinite(nowMs) || expiryMs === null || expiryMs <= nowMs) blockers.push("AUTOPILOT_ENABLEMENT_EXPIRED");
  if (fallback_readiness !== true) blockers.push("AUTOPILOT_FALLBACK_READINESS_REQUIRED");
  if (reconciliation_ready !== true) blockers.push("AUTOPILOT_RECONCILIATION_REQUIRED");
  return Object.freeze({
    contract: "mad4b.database-lifecycle-policy-bound-autopilot.v1",
    recipe_key: text(recipe_key),
    environment_key: text(environment_key),
    policy_status: blockers.length === 0 ? "eligible_for_review_only" : "blocked",
    blockers: Object.freeze(unique(blockers)),
    explicit_enablement_observed: explicit_enablement === true,
    execution_enabled: false,
    autopilot_enabled: false,
    database_mutated: false,
    provider_called: false,
    secrets_included: false,
  });
}

export function buildRepositoryAuditSupersessionPlan({
  findings = [],
  runs = [],
  resource_uri = "mysql://growthOS/repo_file_audit_findings",
  environment_key = "staging",
  max_candidates = 500,
  policy_approval_present = false,
} = {}) {
  const blockers = [];
  if (!EXACT_RESOURCE.test(text(resource_uri)) || !text(resource_uri).endsWith("/repo_file_audit_findings")) blockers.push("SUPERSESSION_RESOURCE_NOT_EXACT");
  if (isProductionEnvironment(environment_key)) blockers.push("SUPERSESSION_PILOT_PRODUCTION_FORBIDDEN");
  const runById = new Map(runs.map((run) => [text(run.run_id || run.id), run]));
  const normalized = findings.map(normalizeFinding).filter((row) => row.finding_id && row.file_key && row.parent_run_id && row.observed_at);
  const byFile = new Map();
  for (const finding of normalized) {
    const group = byFile.get(finding.file_key) || [];
    group.push(finding);
    byFile.set(finding.file_key, group);
  }
  const eligible = [];
  const preserved = [];
  for (const [fileKey, group] of byFile.entries()) {
    const sorted = [...group].sort((a, b) => {
      const delta = (toMs(b.observed_at) || 0) - (toMs(a.observed_at) || 0);
      return delta || b.finding_id.localeCompare(a.finding_id);
    });
    const latest = sorted[0];
    preserved.push({ ...latest, preservation_reason: "latest_observation_per_file" });
    const latestRun = runById.get(latest.parent_run_id);
    for (const finding of sorted.slice(1)) {
      const parentRun = runById.get(finding.parent_run_id);
      if (!runTerminal(parentRun?.status)) {
        preserved.push({ ...finding, preservation_reason: "parent_run_non_terminal" });
        continue;
      }
      if (!runTerminal(latestRun?.status)) {
        preserved.push({ ...finding, preservation_reason: "newer_observation_parent_non_terminal" });
        continue;
      }
      if ((toMs(latest.observed_at) || 0) <= (toMs(finding.observed_at) || 0)) {
        preserved.push({ ...finding, preservation_reason: "no_strictly_newer_observation" });
        continue;
      }
      eligible.push({ ...finding, superseded_by: latest.finding_id, file_key: fileKey });
    }
  }
  const bound = Math.min(Math.max(Math.trunc(Number(max_candidates)) || 500, 1), 5000);
  const bounded = eligible.sort((a, b) => a.file_key.localeCompare(b.file_key) || a.observed_at.localeCompare(b.observed_at) || a.finding_id.localeCompare(b.finding_id)).slice(0, bound);
  if (eligible.length > bounded.length) blockers.push("SUPERSESSION_CANDIDATE_SET_EXCEEDS_BOUND");
  if (!policy_approval_present) blockers.push("SUPERSESSION_POLICY_APPROVAL_REQUIRED_FOR_EXECUTION");
  const body = {
    contract: DATABASE_LIFECYCLE_SUPERSESSION_CONTRACT,
    resource_uri: text(resource_uri),
    recipe_key: "database.repo_audit.superseded_findings_cleanup",
    environment_key: text(environment_key),
    candidates: bounded,
  };
  const planFingerprint = fingerprint(body);
  return Object.freeze({
    ok: blockers.every((code) => code === "SUPERSESSION_POLICY_APPROVAL_REQUIRED_FOR_EXECUTION"),
    ...body,
    plan_id: `dbsup_${planFingerprint.slice(7, 23)}`,
    plan_fingerprint: planFingerprint,
    deterministic_ordering: "observed_at_desc_then_finding_id_desc",
    eligible_candidate_count: bounded.length,
    preserved_findings: Object.freeze(preserved.sort((a, b) => a.file_key.localeCompare(b.file_key) || a.finding_id.localeCompare(b.finding_id))),
    blockers: Object.freeze(unique(blockers)),
    concurrent_newer_row_guard: Object.freeze({
      re_read_latest_before_each_batch: true,
      require_same_plan_fingerprint: true,
      reject_if_newer_observation_appears: true,
    }),
    execution_allowed: false,
    database_mutated: false,
    provider_called: false,
    runtime_consumer_enabled: false,
    secrets_included: false,
  });
}
