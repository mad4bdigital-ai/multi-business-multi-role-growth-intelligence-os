import crypto from "node:crypto";
import { getPool } from "./db.js";
import {
  capabilityEnvelopeError,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";
import {
  REPOSITORY_PATCH_MUTATION_INTENTS,
  finalizeGithubPullRequest,
  getGithubPullRequestCiGate,
  githubPullRequestFinalizeConfirmation,
} from "./githubRepositoryLifecycle.js";
import {
  branchMergeCommitConfirmation,
  runAdminBranchReconcile,
  runGithubBranchMergeCommitCreate,
} from "./adminBranchReconciliationAdapter.js";
import {
  branchDetachedResolutionCommitConfirmation,
  runGithubDetachedResolutionCommitCreate,
} from "./repositoryDetachedResolutionBuilder.js";
import { runRepositoryReconciliationOrchestrator } from "./repositoryReconciliationOrchestrator.js";

export const REPOSITORY_RECONCILIATION_ADMIN_SURFACE_CONTRACT = "mad4b.repository-reconciliation-admin-surface.v1";

function text(value = "", max = 512) { return String(value ?? "").trim().slice(0, max); }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (!value || typeof value !== "object") return value; return Object.keys(value).sort().reduce((out, key) => ({ ...out, [key]: stable(value[key]) }), {}); }
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function safeJson(value, fallback = {}) { if (value && typeof value === "object") return value; try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; } }
function fail(code, message, status = 409, details = {}) { const error = new Error(message); error.code = code; error.status = status; error.details = { ...details, secrets_included: false }; throw error; }

function normalizeResolutionEntries(entries = []) {
  if (!Array.isArray(entries)) fail("repository_reconciliation_resolution_entries_invalid", "resolution_entries must be an array.", 400);
  return entries.map((entry) => ({
    path: text(entry?.path, 1024),
    mode: text(entry?.mode, 16),
    type: text(entry?.type || "blob", 16),
    sha: text(entry?.sha, 40).toLowerCase(),
  })).sort((a, b) => a.path.localeCompare(b.path));
}

function adminPlanBinding({ orchestratorPlan, args }) {
  const resolutionEntries = normalizeResolutionEntries(args.resolution_entries || []);
  const scope = {
    orchestrator_plan_sha256: orchestratorPlan.plan_sha256,
    plan_id: orchestratorPlan.plan_id,
    resource: orchestratorPlan.plan?.resource || null,
    resolution_entries_sha256: hash(resolutionEntries),
    resolution_entry_count: resolutionEntries.length,
    commit_message_sha256: hash(text(args.commit_message || `Reconcile ${orchestratorPlan.plan?.resource?.branch || "repository branch"}`, 5000)),
    merge_method: text(args.merge_method || "merge", 16),
    delete_branch: args.delete_branch !== false,
  };
  return {
    ...scope,
    plan_sha256: hash(scope),
    resolution_entries: resolutionEntries,
    secrets_included: false,
  };
}

export function repositoryReconciliationApplyConfirmation(planId = "") {
  return `APPLY_REPOSITORY_RECONCILIATION_${String(planId || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()}`;
}

async function validatePlanAuthority({ args, adminPlan, pool }) {
  const resolved = await resolveCapabilityExecutionEnvelope({
    pool,
    envelopeId: text(args.capability_envelope_id, 64),
    source: {
      owner: adminPlan.resource?.owner || "",
      repo: adminPlan.resource?.repo || "",
      branch: adminPlan.resource?.branch || "",
      expected_branch_sha: adminPlan.resource?.expected_branch_sha || "",
      expected_base_sha: adminPlan.resource?.expected_base_sha || "",
      plan_sha256: adminPlan.plan_sha256,
    },
    acceptedAppKeys: ["github", "platform_orchestration"],
    acceptedCapabilityKeys: ["repo_patch_apply"],
    acceptedIntents: REPOSITORY_PATCH_MUTATION_INTENTS,
    allowReferenced: true,
    requireReadyForDispatch: true,
    requireDispatchAllowed: true,
    requireNoApprovalRequired: false,
    requireNoBlockingGaps: true,
  });
  if (!resolved?.ok) throw capabilityEnvelopeError(resolved, "Repository reconciliation plan authority is not ready.");

  const [[hold]] = await pool.query(
    `SELECT hold_id, run_id, tenant_id, workspace_id, user_id, hold_type, request_id, correlation_id,
            status, expires_at, execution_context_json
       FROM approval_holds WHERE hold_id=? LIMIT 1`,
    [text(args.approval_hold_id, 64)],
  );
  const context = safeJson(hold?.execution_context_json, {});
  const contextPlanSha = text(context.plan_sha256 || context.repository_reconciliation_plan_sha256, 64).toLowerCase();
  const holdOk = hold
    && hold.status === "approved"
    && hold.hold_type === "supervisor_approval"
    && (!hold.expires_at || new Date(hold.expires_at).getTime() > Date.now())
    && hold.run_id === resolved.envelope_id
    && context.envelope_id === resolved.envelope_id
    && context.apply_authorization_source === "dynamic_capability_apply_authorization_policy"
    && context.allow_external_write === true
    && contextPlanSha === adminPlan.plan_sha256;
  if (!holdOk) {
    fail("repository_reconciliation_approval_hold_invalid", "Approval hold must be approved, unexpired, external-write authorized, and bound to the exact reconciliation plan SHA.", 403, {
      hold_id: hold?.hold_id || null,
      plan_sha256: adminPlan.plan_sha256,
    });
  }
  return { envelope: resolved, hold: { hold_id: hold.hold_id, status: hold.status, expires_at: hold.expires_at, secrets_included: false } };
}

async function bindStepRunAuthority({ pool, runId, authorization }) {
  await pool.query(
    `UPDATE repository_mutation_runs_v6
        SET capability_envelope_id=?, approval_hold_id=?, updated_at=NOW()
      WHERE run_id=? AND status='dispatching'`,
    [authorization.capability_envelope_id, authorization.approval_hold_id, runId],
  );
  await markCapabilityEnvelopeReferenced({
    pool,
    envelopeId: authorization.capability_envelope_id,
    executionRef: runId,
  });
}

function wrappedReadback(raw, { providerObjectId = null, expectedReadback = null } = {}) {
  const verified = raw?.ok !== false && raw?.verification?.ok !== false && raw?.gate_status !== "blocked";
  return {
    readback_verified: verified,
    provider_object_id: providerObjectId,
    write: raw?.update || raw?.resolution || raw?.commit || null,
    expected_readback: expectedReadback,
    readback: raw,
    raw_result: raw,
    secrets_included: false,
  };
}

function executorArgs(context, extra = {}) {
  const { input, authorization, lease, plan } = context;
  return {
    owner: input.owner,
    repo: input.repo,
    branch: input.branch,
    default_branch: input.defaultBranch,
    pull_number: input.pullNumber,
    expected_base_sha: input.expectedBaseSha,
    expected_branch_sha: input.expectedBranchSha,
    recipe_key: input.recipeKey,
    operation_id: input.operationId,
    repository_reconciliation_operation_id: input.operationId,
    repository_holder_run_id: lease.holder_run_id,
    repository_lease_id: lease.lease_id,
    repository_resource_fingerprint: lease.resource_fingerprint,
    capability_envelope_id: authorization?.capability_envelope_id || null,
    approval_hold_id: authorization?.approval_hold_id || null,
    confirm: authorization?.confirm || "",
    plan_id: plan.plan_id,
    plan_sha256: plan.plan_sha256,
    force: false,
    force_push: false,
    ...extra,
  };
}

export async function runRepositoryReconciliationAdminSurface(args = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const mode = text(args.mode || "dry_run", 16);
  if (!["dry_run", "apply"].includes(mode)) fail("repository_reconciliation_mode_invalid", "mode must be dry_run or apply.", 400);
  const operationId = text(args.plan_id || args.operation_id, 64) || (deps.randomUUID || crypto.randomUUID)();
  const normalized = { ...args, plan_id: operationId, operation_id: operationId, mode: "dry_run" };
  const dryRun = await runRepositoryReconciliationOrchestrator(normalized, {
    pool,
    randomUUID: deps.randomUUID,
    reconcileBranch: (input) => runAdminBranchReconcile(input, deps),
  });
  const binding = adminPlanBinding({ orchestratorPlan: dryRun.plan, args });
  const requiredConfirmation = repositoryReconciliationApplyConfirmation(binding.plan_id);
  const publicPlan = {
    ...dryRun.plan,
    orchestrator_plan_sha256: dryRun.plan.plan_sha256,
    plan_sha256: binding.plan_sha256,
    resolution_entries_sha256: binding.resolution_entries_sha256,
    resolution_entry_count: binding.resolution_entry_count,
    apply_confirmation: requiredConfirmation,
  };

  if (mode === "dry_run") {
    return {
      ...dryRun,
      contract: REPOSITORY_RECONCILIATION_ADMIN_SURFACE_CONTRACT,
      plan: publicPlan,
      apply_allowed: dryRun.plan?.plan?.recipe_status === "active",
      apply_readiness: {
        recipe_active: dryRun.plan?.plan?.recipe_status === "active",
        admin_apply_surface_exposed: true,
        provider_executor_implemented: true,
        engine_executor_implemented: true,
        plan_authority_required: true,
        per_step_authority_required: true,
        exact_resolution_scope_bound: true,
        blockers: dryRun.plan?.plan?.recipe_status === "active" ? [] : ["repository_reconciliation_recipe_not_active"],
      },
      secrets_included: false,
    };
  }

  if (text(args.plan_id, 64) !== binding.plan_id || text(args.plan_sha256, 64).toLowerCase() !== binding.plan_sha256) {
    fail("repository_reconciliation_plan_hash_mismatch", "Apply requires the exact admin plan_id and plan_sha256 returned by dry-run.", 409, { plan_id: binding.plan_id });
  }
  if (text(args.confirm, 256) !== requiredConfirmation) {
    fail("repository_reconciliation_apply_confirmation_required", `Apply requires confirm=${requiredConfirmation}.`, 400, { expected_confirm: requiredConfirmation });
  }
  const authority = await validatePlanAuthority({ args, adminPlan: { ...binding, resource: dryRun.plan.plan.resource }, pool });
  await markCapabilityEnvelopeReferenced({ pool, envelopeId: authority.envelope.envelope_id, executionRef: `repository_reconciliation_plan:${binding.plan_id}` });

  const engineState = { resolutionCommitSha: null, mergeCommitSha: null };
  const executeEngineStep = async (context) => {
    await bindStepRunAuthority({ pool, runId: context.run_id, authorization: context.authorization });
    if (context.step.step_key === "build_resolution_commit") {
      const raw = await runGithubDetachedResolutionCommitCreate(executorArgs(context, {
        entries: binding.resolution_entries,
        commit_message: text(args.commit_message || `Build detached reconciliation resolution for ${context.input.branch}`, 5000),
        confirm: context.authorization?.confirm || branchDetachedResolutionCommitConfirmation(context.input.branch),
      }), deps);
      engineState.resolutionCommitSha = raw?.resolution?.commit_sha || null;
      return wrappedReadback(raw, { providerObjectId: engineState.resolutionCommitSha });
    }
    if (context.step.step_key === "create_merge_commit") {
      if (!engineState.resolutionCommitSha) fail("repository_reconciliation_resolution_commit_missing", "Merge composition requires the same-cycle detached resolution commit.", 409);
      const raw = await runGithubBranchMergeCommitCreate(executorArgs(context, {
        resolution_commit_sha: engineState.resolutionCommitSha,
        commit_message: text(args.merge_commit_message || `Merge reconciled ${context.input.branch} with ${context.input.defaultBranch}`, 5000),
        confirm: context.authorization?.confirm || branchMergeCommitConfirmation(context.input.branch),
      }), deps);
      engineState.mergeCommitSha = raw?.commit?.sha || raw?.update?.branch_sha || raw?.merge_commit_sha || null;
      return wrappedReadback(raw, { providerObjectId: engineState.mergeCommitSha });
    }
    fail("repository_reconciliation_engine_step_unimplemented", `No engine executor is registered for ${context.step.step_key}.`, 501);
  };

  const executeStep = async (context) => {
    const stepKey = context.step.step_key;
    const mutating = stepKey === "finalize_pr";
    if (mutating) await bindStepRunAuthority({ pool, runId: context.run_id, authorization: context.authorization });
    if (stepKey === "reconcile_branch" || stepKey === "verify_branch") {
      const raw = await runAdminBranchReconcile({
        owner: context.input.owner,
        repo: context.input.repo,
        branch: context.input.branch,
        default_branch: context.input.defaultBranch,
        mode: "dry_run",
      }, deps);
      if (stepKey === "verify_branch" && raw?.classification?.behind_by > 0) {
        fail("repository_reconciliation_branch_not_fresh", "Reconciled branch remains behind the base branch.", 409, { classification: raw.classification });
      }
      return wrappedReadback(raw);
    }
    if (stepKey === "evaluate_ci") {
      const raw = await getGithubPullRequestCiGate({
        owner: context.input.owner,
        repo: context.input.repo,
        pull_number: context.input.pullNumber,
        expected_head_sha: engineState.mergeCommitSha || undefined,
      });
      if (raw?.gate_status !== "pass") fail("repository_reconciliation_ci_gate_blocked", "Required PR checks are not ready.", 409, raw);
      return wrappedReadback(raw);
    }
    if (stepKey === "finalize_pr") {
      if (!engineState.mergeCommitSha) fail("repository_reconciliation_merge_commit_missing", "PR finalization requires the same-cycle reconciled branch head.", 409);
      const raw = await finalizeGithubPullRequest({
        owner: context.input.owner,
        repo: context.input.repo,
        pull_number: context.input.pullNumber,
        expected_head_sha: engineState.mergeCommitSha,
        expected_base_sha: context.input.expectedBaseSha,
        merge_method: text(args.merge_method || "merge", 16),
        delete_branch: args.delete_branch !== false,
        capability_envelope_id: context.authorization?.capability_envelope_id,
        approval_hold_id: context.authorization?.approval_hold_id,
        confirm: context.authorization?.confirm || githubPullRequestFinalizeConfirmation(context.input.pullNumber, engineState.mergeCommitSha),
      });
      return wrappedReadback(raw, { providerObjectId: raw?.merge_sha || null });
    }
    fail("repository_reconciliation_provider_step_unimplemented", `No provider executor is registered for ${stepKey}.`, 501);
  };

  const applied = await runRepositoryReconciliationOrchestrator({
    ...args,
    mode: "apply",
    plan_id: binding.plan_id,
    operation_id: binding.plan_id,
    plan_sha256: dryRun.plan.plan_sha256,
  }, {
    pool,
    randomUUID: deps.randomUUID,
    reconcileBranch: (input) => runAdminBranchReconcile(input, deps),
    authorizePlan: async () => ({ ok: true, envelope_id: authority.envelope.envelope_id, hold_id: authority.hold.hold_id, plan_sha256: binding.plan_sha256, secrets_included: false }),
    executeStep,
    executeEngineStep,
  });
  return {
    ...applied,
    contract: REPOSITORY_RECONCILIATION_ADMIN_SURFACE_CONTRACT,
    plan: publicPlan,
    admin_plan_sha256: binding.plan_sha256,
    orchestrator_plan_sha256: dryRun.plan.plan_sha256,
    same_cycle_plan_authority_verified: true,
    per_step_authority_verified: true,
    force_push_allowed: false,
    secrets_included: false,
  };
}
