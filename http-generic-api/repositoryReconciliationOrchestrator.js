import crypto from "node:crypto";
import { getPool } from "./db.js";
import {
  acquireRepositoryOperationLease,
  assertRepositoryOperationLeaseHolder,
  releaseRepositoryOperationLease,
} from "./repositoryOperationLeaseService.js";

const RECIPE = "repo.pr.reconcile_and_finalize";
const MUTATIONS = new Set(["repo_patch_apply","repo_patch_batch_apply","repo_existing_blob_commit_apply",
  "github_branch_fast_forward_to_base","github_branch_merge_commit_create","github_pr_finalize","github_branch_delete"]);

function value(input, max = 512) {
  const normalized = String(input ?? "").trim();
  return normalized ? normalized.slice(0, max) : null;
}
function stable(input) {
  if (Array.isArray(input)) return input.map(stable);
  if (!input || typeof input !== "object") return input;
  return Object.keys(input).sort().reduce((out, key) => ({ ...out, [key]: stable(input[key]) }), {});
}
function hash(input) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(input))).digest("hex");
}
function json(input, fallback = null) {
  if (input && typeof input === "object") return input;
  try { return input ? JSON.parse(input) : fallback; } catch { return fallback; }
}
function fail(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}
function normalize(args = {}, deps = {}) {
  const input = {
    owner: value(args.owner, 191), repo: value(args.repo, 191), branch: value(args.branch, 255),
    defaultBranch: value(args.default_branch || "main", 255), pullNumber: Number(args.pull_number),
    expectedBaseSha: value(args.expected_base_sha, 40)?.toLowerCase(),
    expectedBranchSha: value(args.expected_branch_sha, 40)?.toLowerCase(),
    mode: value(args.mode || "dry_run", 16), recipeKey: value(args.recipe_key || RECIPE, 191),
    operationId: value(args.operation_id, 64) || (deps.randomUUID || crypto.randomUUID)(),
    capabilityEnvelopeId: value(args.capability_envelope_id, 64),
    approvalHoldId: value(args.approval_hold_id, 64),
    tenantId: value(args.tenant_id, 64), workspaceId: value(args.workspace_id, 64),
    userId: value(args.user_id, 64), actorId: value(args.actor_id, 128),
    raw: args,
  };
  if (!input.owner || !input.repo || !input.branch || !input.pullNumber
      || !/^[0-9a-f]{40}$/.test(input.expectedBaseSha || "")
      || !/^[0-9a-f]{40}$/.test(input.expectedBranchSha || "")) {
    throw fail("repository_reconciliation_input_invalid", "owner, repo, branch, pull_number, and exact base/branch SHAs are required.", 400);
  }
  if (!["dry_run","apply"].includes(input.mode)) throw fail("repository_reconciliation_mode_invalid", "mode must be dry_run or apply.", 400);
  return input;
}
export async function loadRepositoryReconciliationRecipe(recipeKey = RECIPE, deps = {}) {
  const pool = deps.pool || getPool();
  const [recipes] = await pool.query(
    `SELECT recipe_key, resource_type, operation_key, adapter_key, risk_class, mode,
            requires_capability_envelope, requires_typed_confirmation, requires_same_cycle_readback,
            policy_json, engine_key, status
       FROM platform_resource_recipes WHERE recipe_key=? LIMIT 1`, [recipeKey],
  );
  if (!recipes?.[0]) throw fail("repository_reconciliation_recipe_missing", "The reconciliation recipe was not found.", 404);
  const [steps] = await pool.query(
    `SELECT step_order, step_key, step_kind, tool_key, endpoint_key, required, on_error_policy, status
       FROM platform_resource_recipe_steps WHERE recipe_key=? ORDER BY step_order, step_id`, [recipeKey],
  );
  return { ...recipes[0], policy: json(recipes[0].policy_json, {}), steps: steps || [], secrets_included: false };
}
function evidence(result = {}) {
  const classification = result.classification || result;
  const proof = result.evidence || classification.evidence || {};
  return {
    classification: value(classification.classification, 64),
    risk: value(classification.risk, 64),
    ahead_by: Number(classification.ahead_by || 0), behind_by: Number(classification.behind_by || 0),
    overlapping_files: Array.isArray(classification.overlapping_files) ? classification.overlapping_files : [],
    changed_files: Array.isArray(classification.changed_files) ? classification.changed_files : [],
    base_ref_sha: value(proof.base_ref_sha, 40)?.toLowerCase() || null,
    branch_ref_sha: value(proof.branch_ref_sha, 40)?.toLowerCase() || null,
  };
}
export function buildRepositoryReconciliationPlan({ input, recipe, reconciliation, operationId } = {}) {
  const steps = (recipe.steps || []).filter((step) => step.status !== "disabled").map((step) => ({
    ...step,
    plan_item_id: hash([operationId, step.step_order, step.step_key]).slice(0, 36),
  }));
  const plan = {
    version: "repository-reconciliation-orchestrator-v1", operation_id: operationId,
    recipe_key: recipe.recipe_key, recipe_status: recipe.status,
    resource: { owner: input.owner, repo: input.repo, branch: input.branch,
      default_branch: input.defaultBranch, pull_number: input.pullNumber,
      expected_base_sha: input.expectedBaseSha, expected_branch_sha: input.expectedBranchSha },
    reconciliation, policy: recipe.policy || {}, steps,
    force_push_allowed: false, migration_apply_allowed: false, secrets_included: false,
  };
  return { plan_id: value(input.raw?.plan_id, 64) || operationId,
    report_sha256: hash([reconciliation, recipe.policy || {}]), plan_sha256: hash(plan),
    plan, steps, secrets_included: false };
}
function stepAuthorization(input, step) {
  if (step.step_kind !== "installed_tool_call" || !MUTATIONS.has(step.tool_key)) return null;
  const map = input.raw.step_authorizations;
  const auth = map && typeof map === "object" ? (map[step.step_key] || map[step.tool_key]) : null;
  if (!auth?.capability_envelope_id || !auth?.approval_hold_id || !auth?.confirm) {
    throw fail("repository_reconciliation_step_authorization_required",
      `Step ${step.step_key} requires its own envelope, approval hold, and typed confirmation.`, 403);
  }
  return auth;
}
async function reserve(pool, input, plan, step, deps) {
  const runId = (deps.randomUUID || crypto.randomUUID)();
  const key = hash([input.recipeKey, input.owner, input.repo, input.branch,
    input.expectedBaseSha, input.expectedBranchSha, plan.plan_sha256, step.plan_item_id]);
  try {
    await pool.query(
      `INSERT INTO repository_mutation_runs_v6
        (run_id, plan_id, plan_item_id, tenant_id, workspace_id, user_id, resource_uri,
         recipe_key, pr_number, head_sha, branch_name, binding_id, capability_envelope_id,
         approval_hold_id, idempotency_key, status, secrets_included, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'repository_reconciliation_orchestrator',
               ?, ?, ?, 'dispatching', 0, NOW(), NOW())`,
      [runId, plan.plan_id, step.plan_item_id, input.tenantId, input.workspaceId, input.userId,
       `github://${input.owner}/${input.repo}/pull/${input.pullNumber}`, input.recipeKey,
       input.pullNumber, input.expectedBranchSha, input.branch,
       input.capabilityEnvelopeId, input.approvalHoldId, key],
    );
    return { runId, key };
  } catch (error) {
    if (error?.code !== "ER_DUP_ENTRY") throw error;
    const [rows] = await pool.query(
      `SELECT run_id, status FROM repository_mutation_runs_v6
        WHERE plan_id=? AND plan_item_id=? LIMIT 1`, [plan.plan_id, step.plan_item_id],
    );
    if (rows?.[0]?.status === "readback_verified") return { runId: rows[0].run_id, key, reused: true };
    throw fail("repository_reconciliation_step_replay_blocked", "The step is already reserved without verified readback.");
  }
}
async function finish(pool, runId, result) {
  const verified = result?.readback_verified === true;
  await pool.query(
    `UPDATE repository_mutation_runs_v6 SET status=?, provider_object_id=?, write_json=?,
      expected_readback_json=?, readback_json=?, error_json=?, provider_write_completed_at=NOW(),
      readback_completed_at=NOW(), updated_at=NOW() WHERE run_id=?`,
    [verified ? "readback_verified" : "readback_failed", value(result?.provider_object_id, 191),
     JSON.stringify(result?.write || null), JSON.stringify(result?.expected_readback || null),
     JSON.stringify(result?.readback || null),
     verified ? null : JSON.stringify({ code:"readback_failed", secrets_included:false }), runId],
  );
  if (!verified) throw fail("repository_reconciliation_readback_failed", "Same-cycle readback was not verified.");
}
export async function runRepositoryReconciliationOrchestrator(args = {}, deps = {}) {
  const input = normalize(args, deps);
  const pool = deps.pool || getPool();
  const recipe = await loadRepositoryReconciliationRecipe(input.recipeKey, { pool });
  const reconciliation = evidence(await deps.reconcileBranch?.({
    owner: input.owner, repo: input.repo, branch: input.branch,
    default_branch: input.defaultBranch, mode: "dry_run",
  }) || { evidence:{ base_ref_sha:input.expectedBaseSha, branch_ref_sha:input.expectedBranchSha } });
  if (reconciliation.base_ref_sha && reconciliation.base_ref_sha !== input.expectedBaseSha) {
    throw fail("repository_reconciliation_base_drift", "The default branch SHA changed.");
  }
  if (reconciliation.branch_ref_sha && reconciliation.branch_ref_sha !== input.expectedBranchSha) {
    throw fail("repository_reconciliation_branch_drift", "The work branch SHA changed.");
  }
  const plan = buildRepositoryReconciliationPlan({ input, recipe, reconciliation, operationId: input.operationId });
  if (input.mode === "dry_run") return {
    ok: true,
    mode: "dry_run",
    apply_allowed: false,
    apply_readiness: {
      recipe_active: recipe.status === "active",
      admin_apply_surface_exposed: false,
      executor_implemented: false,
      blockers: ["repository_reconciliation_admin_apply_surface_not_exposed"],
    },
    reconciliation,
    plan,
    secrets_included: false,
  };
  if (recipe.status !== "active") throw fail("repository_reconciliation_recipe_not_active", "The recipe is not active for mutation.");
  if (!input.capabilityEnvelopeId || !input.approvalHoldId || !deps.authorizePlan || !deps.executeStep) {
    throw fail("repository_reconciliation_authority_required", "Plan authority and a governed step executor are required.", 403);
  }
  if ((await deps.authorizePlan({ input, recipe, plan }))?.ok !== true) {
    throw fail("repository_reconciliation_plan_authorization_denied", "The plan was not authorized.", 403);
  }
  const fingerprint = hash([input.owner,input.repo,input.branch,input.expectedBaseSha,input.expectedBranchSha,plan.plan_sha256]);
  const lease = await acquireRepositoryOperationLease({
    owner:input.owner, repo:input.repo, branch:input.branch, operation_key:input.recipeKey,
    holder_run_id:input.operationId, holder_actor_id:input.actorId, resource_fingerprint:fingerprint,
    metadata:{ pull_number:input.pullNumber, plan_id:plan.plan_id, secrets_included:false },
  }, { pool, now:deps.now, randomUUID:deps.randomUUID });
  try {
    await pool.query(
      `INSERT INTO repository_mutation_plans_v6
        (plan_id, tenant_id, workspace_id, user_id, resource_uri, report_sha256, plan_sha256,
         plan_json, status, approval_hold_id, capability_envelope_id, expires_at,
         secrets_included, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, DATE_ADD(NOW(), INTERVAL 2 HOUR), 0, NOW(), NOW())
       ON DUPLICATE KEY UPDATE plan_json=VALUES(plan_json), updated_at=NOW()`,
      [plan.plan_id,input.tenantId,input.workspaceId,input.userId,
       `github://${input.owner}/${input.repo}/pull/${input.pullNumber}`,plan.report_sha256,
       plan.plan_sha256,JSON.stringify(plan.plan),input.approvalHoldId,input.capabilityEnvelopeId],
    );
    const results = [];
    for (const step of plan.steps.filter((item) => item.status === "active")) {
      await assertRepositoryOperationLeaseHolder({
        lease_id: lease.lease.lease_id,
        holder_run_id: input.operationId,
        resource_fingerprint: lease.lease.resource_fingerprint,
      }, { pool });
      const auth = stepAuthorization(input, step);
      const reservation = await reserve(pool, input, plan, step, deps);
      if (reservation.reused) { results.push({ step_key:step.step_key, run_id:reservation.runId, reused:true }); continue; }
      let result;
      try { result = await deps.executeStep({ input, recipe, plan, step, authorization:auth,
        lease:lease.lease, run_id:reservation.runId, idempotency_key:reservation.key }); }
      catch (error) {
        await pool.query(`UPDATE repository_mutation_runs_v6 SET status=?, error_json=?, updated_at=NOW() WHERE run_id=?`,
          [error?.unknown_provider_outcome ? "unknown_provider_outcome" : "failed_prewrite",
           JSON.stringify({ code:error?.code || "step_failed", message:error?.message, secrets_included:false }),reservation.runId]);
        throw error;
      }
      if (result?.deferred) throw fail("repository_reconciliation_deferred_step_not_supported", "V1 requires each step to complete with same-cycle readback.");
      await finish(pool, reservation.runId, result);
      results.push({ step_key:step.step_key, run_id:reservation.runId, status:"readback_verified" });
    }
    await pool.query(`UPDATE repository_mutation_plans_v6 SET status='readback_verified', updated_at=NOW() WHERE plan_id=?`, [plan.plan_id]);
    return { ok:true, mode:"apply", status:"readback_verified", plan, step_results:results, secrets_included:false };
  } finally {
    await releaseRepositoryOperationLease({ lease_id:lease.lease.lease_id, holder_run_id:input.operationId,
      release_reason:"repository_reconciliation_cycle_completed" }, { pool, now:deps.now }).catch(() => {});
  }
}
