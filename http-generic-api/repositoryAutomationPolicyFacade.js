import { createHash, randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import {
  REPOSITORY_AUTOMATION_CAPABILITIES as BASE_CAPABILITIES,
  buildRepositoryAutomationPlan as buildBasePlan,
  readRepositoryAutomationRun as readBaseRun,
  runRepositoryAutomation as runBaseAutomation,
  scanRepositoryAutomationHygiene as scanBaseHygiene,
} from "./repositoryAutomationControlPlane.js";
import {
  GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS,
  buildGithubRepositoryPolicyPlan,
  readGithubRepositoryPolicy,
  runGithubRepositoryPolicyController as runBaseGithubRepositoryPolicyController,
} from "./githubRepositoryPolicyController.js";

export * from "./repositoryAutomationControlPlane.js";
export {
  GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS,
  buildGithubRepositoryPolicyPlan,
  readGithubRepositoryPolicy,
};

export const REPOSITORY_AUTOMATION_CAPABILITIES = Object.freeze([
  ...BASE_CAPABILITIES,
  "repository_policy_controller",
]);

export const REPOSITORY_POLICY_STEPS = Object.freeze([
  Object.freeze({
    step_key: "policy_readback",
    display_name: "GitHub main policy readback",
    capability: "repository_policy_controller",
    tool_key: "github_repository_policy_controller",
    mutation_required: false,
  }),
  Object.freeze({
    step_key: "policy_plan",
    display_name: "GitHub main policy plan",
    capability: "repository_policy_controller",
    tool_key: "github_repository_policy_controller",
    mutation_required: false,
  }),
  Object.freeze({
    step_key: "policy_apply",
    display_name: "GitHub main policy apply",
    capability: "repository_policy_controller",
    tool_key: "github_repository_policy_controller",
    mutation_required: true,
    required_step_fields: Object.freeze([
      "expected_main_sha",
      "expected_policy_fingerprint",
      "confirm",
      "capability_envelope_id",
    ]),
  }),
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;
const SECRET_KEY_PATTERN = /(?:^|_)(?:password|passwd|secret|token|api_key|private_key|authorization|credential)(?:$|_)/i;
const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\-/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:ghp_|github_pat_|ghs_)[A-Za-z0-9_.\-]+\b/,
];

function facadeError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stable(value[key]);
    return result;
  }, {});
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(stable(value ?? null)), "utf8").digest("hex");
}

function compact(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function assertSecretFree(value, path = "input", depth = 0) {
  if (value === null || value === undefined || depth > 12) return;
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw facadeError(400, "repository_policy_automation_secret_value_rejected", `Secret-like value is not allowed at ${path}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw facadeError(400, "repository_policy_automation_secret_field_rejected", `Secret-like field is not allowed at ${path}.${key}.`);
    }
    assertSecretFree(child, `${path}.${key}`, depth + 1);
  }
}

function safeSummary(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (depth > 8) return "[max-depth]";
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) return "[redacted]";
    return value.length > 4000 ? `${value.slice(0, 4000)}...[truncated]` : value;
  }
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => safeSummary(item, depth + 1, seen));
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : safeSummary(child, depth + 1, seen);
  }
  return output;
}

function isRepositoryPolicy(input = {}) {
  return compact(input.automation_key || input.workflow || "", 64) === "repository_policy";
}

function normalizeMode(value) {
  const mode = compact(value || "dry_run", 32).toLowerCase();
  if (!["dry_run", "apply"].includes(mode)) {
    throw facadeError(400, "repository_policy_automation_mode_invalid", "mode must be dry_run or apply.");
  }
  return mode;
}

function authorityInput(input = {}) {
  return {
    expected_main_sha: String(input.expected_main_sha ?? "").trim().toLowerCase(),
    expected_policy_fingerprint: String(input.expected_policy_fingerprint ?? input.policy_fingerprint ?? "").trim().toLowerCase(),
    confirm: String(input.confirm ?? "").trim(),
    capability_envelope_id: String(input.capability_envelope_id ?? "").trim(),
  };
}

function assertAdminApplyCaller(input = {}, deps = {}) {
  const mode = compact(input.mode || "", 32).toLowerCase();
  if (mode !== "apply") return;
  const auth = deps.auth || {};
  const callerType = compact(auth.caller_type || auth.callerType || "", 64).toLowerCase();
  const role = compact(auth.role || auth.admin_role || "", 64).toLowerCase();
  if (callerType !== "admin" && !["admin", "platform_admin", "super_admin"].includes(role) && auth.is_admin !== true) {
    throw facadeError(403, "github_repository_policy_admin_required", "Policy apply requires an authenticated Admin caller.");
  }
}

function assertStrictApplyAuthority(input = {}) {
  const mode = compact(input.mode || "", 32).toLowerCase();
  if (mode !== "apply") return;
  const authority = authorityInput(input);
  if (!SHA_PATTERN.test(authority.expected_main_sha)) {
    throw facadeError(400, "github_repository_policy_expected_main_sha_required", "expected_main_sha must be a full commit SHA.");
  }
  if (!FINGERPRINT_PATTERN.test(authority.expected_policy_fingerprint)) {
    throw facadeError(400, "github_repository_policy_fingerprint_required", "expected_policy_fingerprint must be a 64-character SHA-256 fingerprint.");
  }
  if (authority.confirm !== GITHUB_REPOSITORY_POLICY_CONFIRMATION) {
    throw facadeError(400, "github_repository_policy_confirmation_invalid", `confirm must equal ${GITHUB_REPOSITORY_POLICY_CONFIRMATION}.`);
  }
  if (!authority.capability_envelope_id) {
    throw facadeError(403, "github_repository_policy_capability_envelope_invalid", "Policy apply requires a capability resolution envelope.");
  }
}

export async function runGithubRepositoryPolicyController(input = {}, deps = {}) {
  assertSecretFree(input);
  assertAdminApplyCaller(input, deps);
  assertStrictApplyAuthority(input);
  return runBaseGithubRepositoryPolicyController(input, deps);
}

export function buildRepositoryAutomationPlan(input = {}) {
  if (!isRepositoryPolicy(input)) return buildBasePlan(input);
  assertSecretFree(input);
  const mode = normalizeMode(input.mode);
  const owner = compact(input.owner || "mad4bdigital-ai", 191);
  const repo = compact(input.repo || "multi-business-multi-role-growth-intelligence-os", 191);
  const defaultBranch = compact(input.default_branch || "main", 191) || "main";
  if (defaultBranch !== "main") {
    throw facadeError(400, "repository_policy_automation_main_only", "repository_policy is restricted to main.");
  }
  const authority = authorityInput(input);
  const applyBinding = mode === "apply" ? {
    expected_main_sha: SHA_PATTERN.test(authority.expected_main_sha) ? authority.expected_main_sha : null,
    expected_main_sha_input_sha256: sha256(authority.expected_main_sha),
    expected_main_sha_valid: SHA_PATTERN.test(authority.expected_main_sha),
    expected_policy_fingerprint: FINGERPRINT_PATTERN.test(authority.expected_policy_fingerprint) ? authority.expected_policy_fingerprint : null,
    expected_policy_fingerprint_input_sha256: sha256(authority.expected_policy_fingerprint),
    expected_policy_fingerprint_valid: FINGERPRINT_PATTERN.test(authority.expected_policy_fingerprint),
    capability_envelope_ref_sha256: authority.capability_envelope_id ? sha256(authority.capability_envelope_id) : null,
    capability_envelope_present: authority.capability_envelope_id.length > 0,
    typed_confirmation_sha256: sha256(authority.confirm),
    typed_confirmation_matches: authority.confirm === GITHUB_REPOSITORY_POLICY_CONFIRMATION,
    secrets_included: false,
  } : null;
  const steps = REPOSITORY_POLICY_STEPS.map((step, index) => ({
    ...step,
    step_order: index + 1,
    status: "planned",
    default_args: {
      owner,
      repo,
      default_branch: defaultBranch,
      required_checks: input.required_checks || GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS,
      ...(step.step_key === "policy_readback" ? { mode: "readback" } : {}),
      ...(step.step_key === "policy_plan" ? { mode: "plan" } : {}),
      ...(step.step_key === "policy_apply" ? { mode: "apply" } : {}),
    },
  }));
  const planCore = {
    automation_key: "repository_policy",
    mode,
    owner,
    repo,
    default_branch: defaultBranch,
    capabilities: ["repository_policy_controller"],
    steps,
    ...(applyBinding ? { apply_binding: applyBinding } : {}),
    live_apply_authorized: false,
    force_push_allowed: false,
    repository_content_mutation_allowed: false,
    secrets_included: false,
  };
  return {
    contract: "mad4b.repository-automation-policy-plan.v1",
    ...planCore,
    plan_sha256: sha256(planCore),
  };
}

async function query(pool, sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function persistRunStart(pool, runId, plan, input, idempotencyKey) {
  await query(pool,
    `INSERT INTO repository_automation_runs
      (run_id,automation_key,mode,status,stage,owner,repo,default_branch,idempotency_key,input_sha256,plan_sha256,plan_json,capability_envelope_id,started_at,secrets_included)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(6),0)`,
    [
      runId,
      plan.automation_key,
      plan.mode,
      "running",
      "policy_readback",
      plan.owner,
      plan.repo,
      plan.default_branch,
      idempotencyKey,
      sha256(input),
      plan.plan_sha256,
      JSON.stringify(plan),
      compact(input.capability_envelope_id || "", 64) || null,
    ]
  );
  for (const step of plan.steps) {
    await query(pool,
      `INSERT INTO repository_automation_step_runs
        (step_run_id,run_id,step_key,step_order,capability_key,tool_key,mutation_required,status,request_sha256,secrets_included)
       VALUES (?,?,?,?,?,?,?,?,?,0)`,
      [
        randomUUID(),
        runId,
        step.step_key,
        step.step_order,
        step.capability,
        step.tool_key,
        step.mutation_required ? 1 : 0,
        "planned",
        sha256(step.default_args || {}),
      ]
    );
  }
}

async function persistStep(pool, runId, stepKey, status, output = null, error = null) {
  await query(pool,
    `UPDATE repository_automation_step_runs
        SET status=?, attempt_count=attempt_count+1,
            output_json=?, error_json=?,
            started_at=COALESCE(started_at,CURRENT_TIMESTAMP(6)),
            completed_at=CASE WHEN ? IN ('completed','failed','blocked') THEN CURRENT_TIMESTAMP(6) ELSE completed_at END
      WHERE run_id=? AND step_key=?`,
    [status, output ? JSON.stringify(safeSummary(output)) : null, error ? JSON.stringify(safeSummary(error)) : null, status, runId, stepKey]
  );
}

async function persistRunComplete(pool, runId, status, stage, summary = null, error = null) {
  await query(pool,
    `UPDATE repository_automation_runs
        SET status=?, stage=?, summary_json=?, error_json=?, completed_at=CURRENT_TIMESTAMP(6)
      WHERE run_id=?`,
    [status, stage, summary ? JSON.stringify(safeSummary(summary)) : null, error ? JSON.stringify(safeSummary(error)) : null, runId]
  );
}

async function persistReceipt(pool, runId, output, status = "completed") {
  await query(pool,
    `INSERT INTO repository_automation_receipts
      (receipt_id,run_id,step_key,operation_key,idempotency_key,request_sha256,dispatch_status,provider_status,provider_receipt_json,readback_json,secrets_included)
     VALUES (?,?,?,?,?,?,?,?,?,?,0)`,
    [
      randomUUID(),
      runId,
      "policy_apply",
      "github_repository_policy_controller",
      `${runId}:policy_apply`,
      sha256(output?.policy_fingerprint || output),
      status,
      output?.mutation_executed ? 200 : null,
      JSON.stringify(safeSummary(output?.mutation || output || {})),
      JSON.stringify(safeSummary(output?.readback || {})),
    ]
  );
}

export async function runRepositoryAutomation(input = {}, deps = {}) {
  if (!isRepositoryPolicy(input)) return runBaseAutomation(input, deps);
  assertSecretFree(input);
  assertAdminApplyCaller(input, deps);
  assertStrictApplyAuthority(input);
  const plan = buildRepositoryAutomationPlan(input);
  if (plan.mode !== "apply") {
    return {
      ...plan,
      status: "dry_run_complete",
      mutations_executed: false,
      provider_writes_executed: false,
      secrets_included: false,
    };
  }

  const runId = compact(input.run_id || "", 64) || randomUUID();
  const requestedIdempotencyKey = String(input.idempotency_key ?? "").trim();
  const idempotencyKey = requestedIdempotencyKey
    ? `repository-policy:${sha256({ requested_idempotency_key: requestedIdempotencyKey, plan_sha256: plan.plan_sha256 })}`
    : `repository-policy:${plan.plan_sha256}`;
  const persist = deps.persist !== false;
  const pool = deps.pool || (persist ? getPool() : null);
  const controller = deps.policyController || runGithubRepositoryPolicyController;

  if (persist) {
    const existing = await query(pool,
      `SELECT run_id FROM repository_automation_runs WHERE automation_key='repository_policy' AND idempotency_key=? LIMIT 1`,
      [idempotencyKey]
    );
    if (existing?.[0]?.run_id) return readBaseRun({ run_id: existing[0].run_id }, { pool });
    await persistRunStart(pool, runId, plan, input, idempotencyKey);
  }

  const results = [];
  try {
    if (persist) await persistStep(pool, runId, "policy_readback", "running");
    const readback = await controller({ ...input, mode: "readback" }, deps);
    results.push({ step_key: "policy_readback", status: "completed", output: safeSummary(readback) });
    if (persist) {
      await persistStep(pool, runId, "policy_readback", "completed", readback);
      await query(pool, "UPDATE repository_automation_runs SET stage='policy_plan' WHERE run_id=?", [runId]);
      await persistStep(pool, runId, "policy_plan", "running");
    }

    const policyPlan = buildGithubRepositoryPolicyPlan(input, readback);
    results.push({ step_key: "policy_plan", status: "completed", output: safeSummary(policyPlan) });
    if (persist) {
      await persistStep(pool, runId, "policy_plan", "completed", policyPlan);
      await query(pool, "UPDATE repository_automation_runs SET stage='policy_apply' WHERE run_id=?", [runId]);
      await persistStep(pool, runId, "policy_apply", "running");
    }

    const applyArgs = {
      ...input,
      mode: "apply",
    };
    const applied = await controller(applyArgs, deps);
    results.push({ step_key: "policy_apply", status: "completed", output: safeSummary(applied) });
    const summary = {
      completed_step_count: results.length,
      mutation_step_count: applied?.mutation_executed ? 1 : 0,
      plan_sha256: plan.plan_sha256,
      policy_fingerprint: applied?.policy_fingerprint || policyPlan.policy_fingerprint,
      server_policy_gate_complete: applied?.readback?.proof?.server_policy_gate_complete === true,
      secrets_included: false,
    };
    if (persist) {
      await persistStep(pool, runId, "policy_apply", "completed", applied);
      await persistReceipt(pool, runId, applied);
      await persistRunComplete(pool, runId, "completed", "complete", summary);
    }
    return {
      ok: true,
      run_id: runId,
      status: "completed",
      automation_key: "repository_policy",
      results,
      summary,
      mutations_executed: applied?.mutation_executed === true,
      force_push_executed: false,
      repository_content_mutation_executed: false,
      secrets_included: false,
    };
  } catch (error) {
    const failure = {
      code: error?.code || "repository_policy_automation_failed",
      message: error?.message || String(error),
      details: safeSummary(error?.details || null),
      secrets_included: false,
    };
    const failedStep = results.length === 0 ? "policy_readback" : results.length === 1 ? "policy_plan" : "policy_apply";
    if (persist) {
      await persistStep(pool, runId, failedStep, "failed", null, failure);
      await persistRunComplete(pool, runId, "failed", failedStep, { completed_step_count: results.length, secrets_included: false }, failure);
    }
    throw Object.assign(error instanceof Error ? error : new Error(failure.message), failure);
  }
}

export async function readRepositoryAutomationRun(input = {}, deps = {}) {
  return readBaseRun(input, deps);
}

export async function scanRepositoryAutomationHygiene(input = {}, deps = {}) {
  return scanBaseHygiene(input, deps);
}
