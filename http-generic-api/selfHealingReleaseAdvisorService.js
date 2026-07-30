import { createHash, randomUUID } from "node:crypto";
import { getPool } from "./db.js";

export const RELEASE_ADVISOR_POLICY_VERSION = "self-healing-release-advisor-v1";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SEVERITY_WEIGHT = Object.freeze({ info: 1, low: 2, medium: 3, high: 4, critical: 5 });
const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private[_-]?key|cipher|api[_-]?key|authorization|cookie)/i;
const TERMINAL_OPERATION_STATUSES = new Set(["verified", "rolled_back", "failed_preflight", "failed_execution", "failed_rollback", "cancelled"]);

function fail(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}

function text(value, max = 512, fallback = "") {
  return String(value ?? fallback).trim().slice(0, max);
}

function uuid(value, fieldName, { required = false } = {}) {
  const out = text(value, 36);
  if (!out && !required) return null;
  if (!UUID_PATTERN.test(out)) fail("release_advisor_validation_error", `${fieldName} must be a UUID.`, 400, { field: fieldName });
  return out;
}

function sha(value, fieldName) {
  const out = text(value, 40).toLowerCase();
  if (!out) return null;
  if (!SHA_PATTERN.test(out)) fail("release_advisor_validation_error", `${fieldName} must be a 40-character Git SHA.`, 400, { field: fieldName });
  return out;
}

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function uniqueAdvisorRow(rowset, context) {
  if (!Array.isArray(rowset)) {
    fail("release_advisor_resolution_invalid", "Release advisor resolution returned an invalid rowset.", 500, { context });
  }
  if (rowset.length > 1) {
    fail("release_advisor_resolution_ambiguous", "Release advisor resolution returned multiple candidates.", 409, {
      context,
      candidate_count: rowset.length,
    });
  }
  const [row] = rowset;
  return row || null;
}

export function sanitizeReleaseAdvisorEvidence(value, depth = 0) {
  if (depth > 8) return "[depth_limited]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeReleaseAdvisorEvidence(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 4000) : value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key) || key === "secrets_included")
      .slice(0, 150)
      .map(([key, item]) => [key, sanitizeReleaseAdvisorEvidence(item, depth + 1)]),
  );
}

export function normalizeReleaseAdvisorInput(input = {}) {
  return {
    environment_key: text(input.environment_key || "production", 64),
    runtime_verification_run_id: uuid(input.runtime_verification_run_id || input.runtimeVerificationRunId, "runtime_verification_run_id"),
    release_operation_id: uuid(input.release_operation_id || input.releaseOperationId, "release_operation_id"),
    target_id: uuid(input.target_id || input.targetId, "target_id"),
    expected_commit_sha: sha(input.expected_commit_sha || input.expectedCommitSha, "expected_commit_sha"),
    created_by: text(input.created_by || input.createdBy || "gpt_admin", 191),
    context: sanitizeReleaseAdvisorEvidence(input.context || {}),
  };
}

function maxSeverity(items = []) {
  return items.reduce((current, item) => (
    (SEVERITY_WEIGHT[item.severity] || 0) > (SEVERITY_WEIGHT[current] || 0) ? item.severity : current
  ), "info");
}

function actionForGap(gap = {}, hasTarget = false, evidence = {}) {
  const gapKey = text(gap.gap_key, 180);
  const remediationType = text(gap.remediation_type || "manual_review", 64);
  if (gapKey === "deployed_commit_mismatch" || remediationType === "repo_patch_or_deploy") {
    if (evidence.context?.production_sync_required === true) {
      return {
        action_key: "release.sync_production_from_latest_main",
        template_key: null,
        plan_type: "production_branch_sync_plan",
      };
    }
    return {
      action_key: hasTarget ? "release.prepare_deploy_reconciliation" : "release.collect_target_and_review_deploy",
      template_key: hasTarget ? "hostinger_release_deploy_v1" : null,
      plan_type: "release_operation_plan",
    };
  }
  if (remediationType === "db_migration") {
    return {
      action_key: "release.prepare_governed_migration",
      template_key: "governed_migration_execute_v1",
      plan_type: "governed_migration_plan",
    };
  }
  if (remediationType === "classification_update") {
    return { action_key: "release.reconcile_ci_classification", template_key: null, plan_type: "classification_review" };
  }
  if (remediationType === "contract_split") {
    return { action_key: "release.prepare_contract_adjustment", template_key: null, plan_type: "contract_change_plan" };
  }
  if (remediationType === "retry") {
    return { action_key: "release.prepare_bounded_retry", template_key: null, plan_type: "retry_plan" };
  }
  return { action_key: "release.review_runtime_gap", template_key: null, plan_type: "manual_review" };
}

function releaseOperationSteps({ targetId, expectedCommitSha } = {}) {
  return [
    { order: 10, step_key: "create_or_reuse_release_operation", execution_allowed: false },
    { order: 20, step_key: "run_async_deploy_dry_run", execution_allowed: false },
    { order: 30, step_key: "resolve_hostinger_release_deploy_template", template_key: "hostinger_release_deploy_v1", execution_allowed: false },
    { order: 40, step_key: "obtain_typed_approval", execution_allowed: false },
    { order: 50, step_key: "open_dynamic_release_gate", execution_allowed: false },
    { order: 60, step_key: "submit_async_release_deploy", execution_allowed: false },
    { order: 70, step_key: "verify_runtime_parity", execution_allowed: false },
    { order: 80, step_key: "close_or_hard_disable_gate", execution_allowed: false },
    { order: 90, step_key: "finalize_release_operation", execution_allowed: false },
  ].map((step) => ({ ...step, target_id: targetId || null, expected_commit_sha: expectedCommitSha || null }));
}

function productionBranchSyncSteps({ expectedCommitSha, sourceBranch, deploymentBranch } = {}) {
  return [
    { order: 10, step_key: "read_latest_main_sha", execution_allowed: false },
    { order: 20, step_key: "compare_production_with_latest_main", execution_allowed: false },
    { order: 30, step_key: "create_or_update_main_to_production_pr", execution_allowed: false },
    { order: 40, step_key: "run_ci_gate", execution_allowed: false },
    { order: 50, step_key: "obtain_typed_approval", execution_allowed: false },
    { order: 60, step_key: "merge_latest_main_into_production", execution_allowed: false },
    { order: 70, step_key: "verify_fresh_hostinger_build", execution_allowed: false },
    { order: 80, step_key: "verify_deployment_manifest_sha", execution_allowed: false },
    { order: 90, step_key: "verify_production_health", execution_allowed: false },
  ].map((step) => ({
    ...step,
    source_branch: sourceBranch,
    deployment_branch: deploymentBranch,
    expected_commit_sha: expectedCommitSha || null,
  }));
}

function buildRecommendation(gap, evidence) {
  const runbook = parseJson(gap.runbook_json, {});
  const hasTarget = Boolean(evidence.target_id || evidence.operation?.target_id);
  const action = actionForGap(gap, hasTarget, evidence);
  const severity = text(gap.severity || "medium", 16);
  const approvalRequired = Number(gap.approval_required || 0) === 1
    || ["high", "critical"].includes(severity)
    || ["repo_patch_or_deploy", "db_migration"].includes(text(gap.remediation_type, 64));
  const targetId = evidence.target_id || evidence.operation?.target_id || null;
  const expectedCommitSha = evidence.verification?.expected_commit_sha || evidence.expected_commit_sha || null;
  const sourceBranch = text(evidence.context?.source_branch || "main", 191);
  const deploymentBranch = text(evidence.context?.deployment_branch || "Production", 191);
  const plan = action.plan_type === "production_branch_sync_plan"
    ? {
        status: "proposed",
        source_branch: sourceBranch,
        deployment_branch: deploymentBranch,
        expected_main_commit_sha: expectedCommitSha,
        fresh_hostinger_build_required: true,
        same_cycle_readback_required: true,
        steps: productionBranchSyncSteps({ expectedCommitSha, sourceBranch, deploymentBranch }),
      }
    : action.plan_type === "release_operation_plan"
      ? {
          status: targetId ? "proposed" : "blocked_missing_target",
          target_id: targetId,
          expected_commit_sha: expectedCommitSha,
          operation_id: evidence.operation?.operation_id || null,
          gate_id: evidence.gate?.gate_id || null,
          async_deployment_id: evidence.async_deployment?.async_deployment_id || null,
          steps: releaseOperationSteps({ targetId, expectedCommitSha }),
        }
      : {
          status: "proposed",
          steps: Array.isArray(runbook?.steps)
            ? runbook.steps.slice(0, 20).map((step, index) => ({ order: (index + 1) * 10, description: text(step, 1000), execution_allowed: false }))
            : [],
        };
  const recommendation = {
    recommendation_key: `${gap.gap_key || gap.classification || "runtime_gap"}:${action.action_key}`,
    gap_key: gap.gap_key || null,
    classification: gap.classification || null,
    severity,
    remediation_type: gap.remediation_type || "manual_review",
    action_key: action.action_key,
    template_key: action.template_key,
    owner_key: gap.owner_key || null,
    approval_required: approvalRequired,
    auto_fix_allowed_by_registry: Number(gap.auto_fix_allowed || 0) === 1,
    execution_allowed: false,
    provider_write: false,
    external_write: false,
    operation_created: false,
    gate_opened: false,
    envelope_created: false,
    job_enqueued: false,
    recommended_action: gap.recommended_action || gap.remediation || null,
    success_condition: runbook?.success_condition || null,
    plan,
    evidence_ref: gap.evidence_ref || `runtime-verification-gap://${gap.gap_id || gap.gap_key || "unknown"}`,
    secrets_included: false,
  };
  return {
    ...recommendation,
    fingerprint_sha256: hash(recommendation),
    runbook: sanitizeReleaseAdvisorEvidence(runbook || {}),
  };
}

export function buildReleaseAdvisorPlan(evidence = {}) {
  const verification = evidence.verification || {};
  const gaps = Array.isArray(evidence.gaps) ? evidence.gaps : [];
  const recommendations = gaps.map((gap) => buildRecommendation(gap, evidence));
  const blockingGapCount = gaps.filter((gap) => Number(gap.blocks_production_parity ?? 1) === 1).length;
  const productionParity = text(verification.production_parity || "unknown", 32);
  const noAction = productionParity === "verified" && blockingGapCount === 0 && recommendations.length === 0;
  const requiresApproval = recommendations.some((item) => item.approval_required);
  const advisorStatus = noAction ? "no_action" : requiresApproval ? "review_required" : recommendations.length ? "generated" : "blocked";
  const severity = noAction ? "info" : maxSeverity(recommendations);
  const fingerprintSource = {
    policy_version: RELEASE_ADVISOR_POLICY_VERSION,
    environment_key: evidence.environment_key || verification.environment_key || "production",
    runtime_verification_run_id: verification.run_id || null,
    expected_commit_sha: verification.expected_commit_sha || null,
    deployed_commit_sha: verification.deployed_commit_sha || null,
    release_operation_id: evidence.operation?.operation_id || null,
    gate_id: evidence.gate?.gate_id || null,
    async_deployment_id: evidence.async_deployment?.async_deployment_id || null,
    release_context: {
      source: evidence.context?.source || null,
      production_sync_required: evidence.context?.production_sync_required === true,
      source_branch: evidence.context?.source_branch || null,
      deployment_branch: evidence.context?.deployment_branch || null,
    },
    gaps: gaps.map((gap) => ({ gap_key: gap.gap_key, classification: gap.classification, severity: gap.severity, remediation_type: gap.remediation_type })).sort((a, b) => String(a.gap_key).localeCompare(String(b.gap_key))),
  };
  return {
    policy_version: RELEASE_ADVISOR_POLICY_VERSION,
    advisor_status: advisorStatus,
    severity,
    recommendation_count: recommendations.length,
    blocking_gap_count: blockingGapCount,
    requires_approval: requiresApproval,
    production_parity: productionParity,
    plan_fingerprint_sha256: hash(fingerprintSource),
    recommendations,
    policy: {
      advisory_only: true,
      execution_allowed: false,
      provider_write: false,
      external_write: false,
      approval_granted: false,
      operation_created: false,
      gate_opened: false,
      envelope_created: false,
      job_enqueued: false,
      same_cycle_readback_required_for_future_execution: true,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

async function loadAdvisorEvidence(input, pool) {
  let verificationRows;
  if (input.runtime_verification_run_id) {
    [verificationRows] = await pool.query(`SELECT * FROM runtime_verification_runs WHERE run_id = ? LIMIT 1`, [input.runtime_verification_run_id]);
  } else {
    [verificationRows] = await pool.query(`SELECT * FROM runtime_verification_runs WHERE environment_key = ? ORDER BY completed_at DESC, started_at DESC LIMIT 1`, [input.environment_key]);
  }
  const verification = uniqueAdvisorRow(verificationRows, "runtime_verification");
  if (!verification) fail("release_advisor_verification_not_found", "Runtime verification evidence was not found.", 404);

  const [gaps] = await pool.query(
    `SELECT g.gap_id, g.gap_key, g.severity, g.classification, g.blocks_production_parity,
            g.remediation, g.evidence_ref,
            r.owner_key, r.remediation_type, r.auto_fix_allowed, r.approval_required,
            r.recommended_action, r.runbook_json
       FROM runtime_verification_gaps g
       LEFT JOIN runtime_gap_remediation_registry r ON r.gap_key = g.gap_key AND r.status = 'active'
      WHERE g.run_id = ?
      ORDER BY FIELD(g.severity,'critical','high','medium','low','info'), g.created_at ASC`,
    [verification.run_id],
  );

  let operation = null;
  if (input.release_operation_id) {
    const [rows] = await pool.query(`SELECT * FROM release_operations WHERE operation_id = ? LIMIT 1`, [input.release_operation_id]);
    operation = uniqueAdvisorRow(rows, "release_operation");
    if (!operation) fail("release_advisor_operation_not_found", "Release operation was not found.", 404);
  } else {
    const clauses = ["environment_key = ?", "expected_commit_sha = ?"];
    const params = [input.environment_key, input.expected_commit_sha || verification.expected_commit_sha];
    if (input.target_id) { clauses.push("target_id = ?"); params.push(input.target_id); }
    const [rows] = await pool.query(
      `SELECT * FROM release_operations WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT 1`,
      params,
    );
    operation = uniqueAdvisorRow(rows, "release_operation");
  }

  let gate = null;
  let asyncDeployment = null;
  if (operation) {
    const [gateRows] = await pool.query(`SELECT * FROM release_gates WHERE operation_id = ? ORDER BY created_at DESC LIMIT 1`, [operation.operation_id]);
    gate = uniqueAdvisorRow(gateRows, "release_gate");
    const [deploymentRows] = await pool.query(`SELECT * FROM release_async_deployments WHERE operation_id = ? ORDER BY created_at DESC LIMIT 1`, [operation.operation_id]);
    asyncDeployment = uniqueAdvisorRow(deploymentRows, "release_async_deployment");
  }

  return {
    environment_key: input.environment_key,
    target_id: input.target_id || operation?.target_id || null,
    expected_commit_sha: input.expected_commit_sha || verification.expected_commit_sha || null,
    verification,
    gaps,
    operation,
    gate,
    async_deployment: asyncDeployment,
    context: input.context,
    secrets_included: false,
  };
}

function shapeRun(row) {
  return row ? {
    ...row,
    requires_approval: Number(row.requires_approval || 0) === 1,
    summary_json: parseJson(row.summary_json, {}),
    evidence_json: parseJson(row.evidence_json, {}),
    secrets_included: false,
  } : null;
}

function shapeRecommendation(row) {
  return {
    ...row,
    approval_required: Number(row.approval_required || 0) === 1,
    auto_fix_allowed: Number(row.auto_fix_allowed || 0) === 1,
    recommendation_json: parseJson(row.recommendation_json, {}),
    runbook_json: parseJson(row.runbook_json, {}),
    execution_allowed: false,
    provider_write: false,
    external_write: false,
    secrets_included: false,
  };
}

export async function getReleaseAdvisorRun(advisorRunId, deps = {}) {
  const pool = deps.pool || getPool();
  const id = uuid(advisorRunId, "advisor_run_id", { required: true });
  const [rows] = await pool.query(`SELECT * FROM release_advisor_runs WHERE advisor_run_id = ? LIMIT 1`, [id]);
  const row = uniqueAdvisorRow(rows, "advisor_run_id");
  if (!row) fail("release_advisor_run_not_found", "Release advisor run was not found.", 404);
  const [recommendations] = await pool.query(`SELECT * FROM release_advisor_recommendations WHERE advisor_run_id = ? ORDER BY sequence_no, recommendation_id`, [id]);
  return {
    ok: true,
    advisor_run: shapeRun(row),
    recommendations: recommendations.map(shapeRecommendation),
    execution_allowed: false,
    provider_write: false,
    external_write: false,
    secrets_included: false,
  };
}

export async function createReleaseAdvisorRun(rawInput = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const input = normalizeReleaseAdvisorInput(rawInput);
  const evidence = await (deps.loadAdvisorEvidence || loadAdvisorEvidence)(input, pool);
  if (evidence.operation && TERMINAL_OPERATION_STATUSES.has(evidence.operation.current_status)) {
    evidence.context = { ...evidence.context, terminal_operation_observed: true };
  }
  const plan = buildReleaseAdvisorPlan(evidence);
  const [existingRows] = await pool.query(`SELECT advisor_run_id FROM release_advisor_runs WHERE plan_fingerprint_sha256 = ? LIMIT 1`, [plan.plan_fingerprint_sha256]);
  const existingRun = uniqueAdvisorRow(existingRows, "plan_fingerprint_sha256");
  if (existingRun) {
    return { ...(await getReleaseAdvisorRun(existingRun.advisor_run_id, { pool })), deduplicated: true };
  }

  const advisorRunId = randomUUID();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO release_advisor_runs
       (advisor_run_id, plan_fingerprint_sha256, policy_version, environment_key,
        runtime_verification_run_id, release_operation_id, target_id,
        expected_commit_sha, deployed_commit_sha, advisor_status, severity,
        recommendation_count, blocking_gap_count, requires_approval,
        summary_json, evidence_json, created_by, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [advisorRunId, plan.plan_fingerprint_sha256, plan.policy_version, input.environment_key,
       evidence.verification.run_id, evidence.operation?.operation_id || null,
       evidence.target_id || null, evidence.verification.expected_commit_sha || input.expected_commit_sha,
       evidence.verification.deployed_commit_sha || null, plan.advisor_status, plan.severity,
       plan.recommendation_count, plan.blocking_gap_count, plan.requires_approval ? 1 : 0,
       JSON.stringify(sanitizeReleaseAdvisorEvidence({ ...plan, recommendations: undefined })),
       JSON.stringify(sanitizeReleaseAdvisorEvidence({
         verification: {
           run_id: evidence.verification.run_id,
           production_parity: evidence.verification.production_parity,
           run_status: evidence.verification.run_status,
           expected_commit_sha: evidence.verification.expected_commit_sha,
           deployed_commit_sha: evidence.verification.deployed_commit_sha,
         },
         operation: evidence.operation ? { operation_id: evidence.operation.operation_id, current_status: evidence.operation.current_status, target_id: evidence.operation.target_id } : null,
         gate: evidence.gate ? { gate_id: evidence.gate.gate_id, status: evidence.gate.status, expires_at: evidence.gate.expires_at } : null,
         async_deployment: evidence.async_deployment ? { async_deployment_id: evidence.async_deployment.async_deployment_id, status: evidence.async_deployment.status, job_id: evidence.async_deployment.job_id } : null,
         context: evidence.context,
         secrets_included: false,
       })),
       input.created_by],
    );

    for (let index = 0; index < plan.recommendations.length; index += 1) {
      const recommendation = plan.recommendations[index];
      await connection.query(
        `INSERT INTO release_advisor_recommendations
         (recommendation_id, advisor_run_id, sequence_no, recommendation_fingerprint_sha256,
          recommendation_key, gap_key, classification, severity, remediation_type,
          action_key, template_key, approval_required, auto_fix_allowed,
          execution_allowed, provider_write, external_write,
          recommendation_json, runbook_json, evidence_ref, secrets_included)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, 0)`,
        [randomUUID(), advisorRunId, index + 1, recommendation.fingerprint_sha256,
         recommendation.recommendation_key, recommendation.gap_key, recommendation.classification,
         recommendation.severity, recommendation.remediation_type, recommendation.action_key,
         recommendation.template_key, recommendation.approval_required ? 1 : 0,
         recommendation.auto_fix_allowed_by_registry ? 1 : 0,
         JSON.stringify(sanitizeReleaseAdvisorEvidence(recommendation)),
         JSON.stringify(sanitizeReleaseAdvisorEvidence(recommendation.runbook || {})),
         recommendation.evidence_ref],
      );
    }
    await connection.commit();
    return { ...(await getReleaseAdvisorRun(advisorRunId, { pool })), deduplicated: false };
  } catch (error) {
    await connection.rollback();
    if (error?.code === "ER_DUP_ENTRY") {
      const [rows] = await pool.query(`SELECT advisor_run_id FROM release_advisor_runs WHERE plan_fingerprint_sha256 = ? LIMIT 1`, [plan.plan_fingerprint_sha256]);
      const duplicateRun = uniqueAdvisorRow(rows, "duplicate_plan_fingerprint_sha256");
    if (duplicateRun) return { ...(await getReleaseAdvisorRun(duplicateRun.advisor_run_id, { pool })), deduplicated: true };
    }
    throw error;
  } finally {
    connection.release();
  }
}
