import { getGovernancePool } from "./governanceDb.js";
import {
  capabilityEnvelopeError,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";
import { REPOSITORY_PATCH_MUTATION_INTENTS } from "./githubRepositoryLifecycle.js";
import * as legacy from "./repositoryReconciliationAdminSurfaceLegacy.js";

export * from "./repositoryReconciliationAdminSurfaceLegacy.js";

const REQUIRED_MUTATION_STEPS = Object.freeze([
  "build_resolution_commit",
  "create_merge_commit",
  "finalize_pr",
]);

function text(value = "", max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function safeJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}

function fail(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  throw error;
}

async function validateStepAuthorization({ stepKey, authorization, args, pool }) {
  if (!authorization?.capability_envelope_id || !authorization?.approval_hold_id || !authorization?.confirm) {
    fail("repository_reconciliation_step_authorization_required", `Step ${stepKey} requires capability_envelope_id, approval_hold_id, and confirm.`, 403, { step_key: stepKey });
  }
  const resolved = await resolveCapabilityExecutionEnvelope({
    pool,
    envelopeId: text(authorization.capability_envelope_id, 64),
    source: {
      owner: text(args.owner, 191),
      repo: text(args.repo, 191),
      branch: text(args.branch, 255),
      expected_base_sha: text(args.expected_base_sha, 40).toLowerCase(),
      expected_branch_sha: text(args.expected_branch_sha, 40).toLowerCase(),
      plan_sha256: text(args.plan_sha256, 64).toLowerCase(),
      step_key: stepKey,
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
  if (!resolved?.ok) {
    throw capabilityEnvelopeError({ ...resolved, step_key: stepKey }, `Repository reconciliation step ${stepKey} authority is not ready.`);
  }

  const [[hold]] = await pool.query(
    `SELECT hold_id, run_id, hold_type, status, expires_at, execution_context_json
       FROM approval_holds WHERE hold_id=? LIMIT 1`,
    [text(authorization.approval_hold_id, 64)],
  );
  const context = safeJson(hold?.execution_context_json, {});
  const contextPlanSha = text(context.plan_sha256 || context.repository_reconciliation_plan_sha256, 64).toLowerCase();
  const contextStepKey = text(context.step_key || context.repository_reconciliation_step_key, 128);
  const holdOk = hold
    && hold.status === "approved"
    && hold.hold_type === "supervisor_approval"
    && (!hold.expires_at || new Date(hold.expires_at).getTime() > Date.now())
    && hold.run_id === resolved.envelope_id
    && context.envelope_id === resolved.envelope_id
    && context.apply_authorization_source === "dynamic_capability_apply_authorization_policy"
    && context.allow_external_write === true
    && contextPlanSha === text(args.plan_sha256, 64).toLowerCase()
    && contextStepKey === stepKey;
  if (!holdOk) {
    fail("repository_reconciliation_step_approval_hold_invalid", `Step ${stepKey} approval hold is not bound to the exact plan and step.`, 403, {
      step_key: stepKey,
      hold_id: hold?.hold_id || null,
      plan_sha256: text(args.plan_sha256, 64).toLowerCase() || null,
    });
  }
  return {
    ok: true,
    step_key: stepKey,
    envelope_id: resolved.envelope_id,
    approval_hold_id: hold.hold_id,
    typed_confirmation_present: Boolean(text(authorization.confirm, 512)),
    secrets_included: false,
  };
}

export async function runRepositoryReconciliationAdminSurface(args = {}, deps = {}) {
  const pool = deps.pool || getGovernancePool();
  const mode = text(args.mode || "dry_run", 16);
  let stepAuthority = [];
  if (mode === "apply") {
    if (!/^[0-9a-f]{64}$/i.test(text(args.plan_sha256, 64))) {
      fail("repository_reconciliation_plan_binding_required", "Apply requires the exact dry-run plan_sha256.", 400);
    }
    const map = args.step_authorizations && typeof args.step_authorizations === "object"
      ? args.step_authorizations
      : {};
    for (const stepKey of REQUIRED_MUTATION_STEPS) {
      stepAuthority.push(await validateStepAuthorization({
        stepKey,
        authorization: map[stepKey],
        args,
        pool,
      }));
    }
  }
  const result = await legacy.runRepositoryReconciliationAdminSurface(args, { ...deps, pool });
  return {
    ...result,
    governance_db_writer_used: true,
    step_authorization_gate: {
      required_steps: [...REQUIRED_MUTATION_STEPS],
      verified_steps: stepAuthority.map((item) => item.step_key),
      exact_plan_and_step_binding_required: true,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
