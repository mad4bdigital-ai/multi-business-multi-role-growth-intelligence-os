import { createHash } from "node:crypto";
import { executeOperation, previewOperation } from "./operationOrchestrator.js";

export const SPEC011_MANAGED_DELIVERY_VERSION = "spec011-managed-delivery-lifecycle-v1";

export const MANAGED_DELIVERY_STATES = Object.freeze([
  "planned",
  "base_sync_required",
  "ci_pending",
  "repair_pending",
  "approval_pending",
  "merge_pending",
  "merged",
  "branch_cleanup_pending",
  "deployment_pending",
  "production_readback_pending",
  "completed",
  "blocked",
]);

export const LOW_RISK_REPAIR_ALLOWLIST = Object.freeze({
  generated_artifact_drift: Object.freeze({
    allowed_roots: ["generated/", "openapi/generated/", "docs/generated/"],
    max_files: 25,
  }),
  formatting_hygiene: Object.freeze({
    allowed_roots: ["docs/", "specs/", "http-generic-api/test-", "http-generic-api/scripts/test-"],
    max_files: 20,
  }),
  docs_reference_integrity: Object.freeze({
    allowed_roots: ["docs/", "specs/"],
    max_files: 30,
  }),
  test_registration_drift: Object.freeze({
    allowed_roots: ["http-generic-api/scripts/manifests/", "http-generic-api/test-"],
    max_files: 12,
  }),
});

const SECRET_KEY_PATTERN = /(?:^|_)(?:password|passwd|secret|token|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)(?:$|_)/i;
const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\-/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:ghp_|github_pat_|ya29\.)[A-Za-z0-9_.\-]+\b/,
];
const PROTECTED_BRANCHES = new Set(["main", "master", "production", "prod"]);
const PATCH_ACTIONS = new Set(["create_file", "insert_before", "insert_after", "replace", "delete"]);
const ANCHOR_KINDS = new Set(["exact_text", "json_pointer", "yaml_path", "symbol"]);
const DELEGATED_REPAIR_MODES = new Set(["delegated_low_risk", "delegated_plan_bound"]);
const TERMINAL_RUN_STATES = new Set(["completed", "failed", "blocked", "cancelled"]);

function lifecycleError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function compact(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function normalizeGitSha(value, field) {
  const sha = compact(value, 64).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw lifecycleError("MANAGED_DELIVERY_SHA_INVALID", `${field} must be a 40-character Git SHA.`, { field });
  }
  return sha;
}

function normalizeSha256(value, field) {
  const hash = compact(value, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw lifecycleError("MANAGED_DELIVERY_HASH_INVALID", `${field} must be a SHA-256 digest.`, { field });
  }
  return hash;
}

function assertSecretFree(value, path = "input", depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw lifecycleError("MANAGED_DELIVERY_SECRET_VALUE_REJECTED", `Secret-like value is not allowed at ${path}.`, { path });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key) && key !== "secrets_included") {
      throw lifecycleError("MANAGED_DELIVERY_SECRET_FIELD_REJECTED", `Secret-like field is not allowed at ${path}.${key}.`, { path: `${path}.${key}` });
    }
    assertSecretFree(nested, `${path}.${key}`, depth + 1);
  }
}

function normalizeBranch(value, field = "branch") {
  const branch = compact(value, 255).replace(/^refs\/heads\//, "");
  if (!branch) throw lifecycleError("MANAGED_DELIVERY_BRANCH_REQUIRED", `${field} is required.`, { field });
  return branch;
}

function assertNoBypass(input = {}) {
  const forbidden = [
    ["force_push", input.force_push],
    ["force", input.force],
    ["bypass_branch_protection", input.bypass_branch_protection],
    ["admin_override", input.admin_override],
    ["direct_protected_branch_write", input.direct_protected_branch_write],
  ].filter(([, value]) => value === true);
  if (forbidden.length) {
    throw lifecycleError("MANAGED_DELIVERY_BYPASS_FORBIDDEN", "Force push and protected-branch bypass are forbidden.", {
      forbidden_fields: forbidden.map(([field]) => field),
    });
  }
}

function pathWithinRoots(path, roots) {
  return roots.some((root) => path === root.replace(/\/$/, "") || path.startsWith(root));
}

export function normalizeSemanticPatchIntent(input = {}) {
  assertSecretFree(input, "patch_intent");
  const files = Array.isArray(input.files) ? input.files : [];
  if (!files.length || files.length > 50) {
    throw lifecycleError("MANAGED_DELIVERY_PATCH_FILES_INVALID", "Semantic patch intent requires 1 to 50 files.", { file_count: files.length });
  }
  const normalizedFiles = files.map((entry, index) => {
    const path = compact(entry?.path, 500).replace(/^\/+/, "");
    const action = compact(entry?.action, 32).toLowerCase();
    if (!path || path.includes("..") || path.startsWith(".git/")) {
      throw lifecycleError("MANAGED_DELIVERY_PATCH_PATH_INVALID", "Patch path is invalid.", { index, path: path || null });
    }
    if (!PATCH_ACTIONS.has(action)) {
      throw lifecycleError("MANAGED_DELIVERY_PATCH_ACTION_INVALID", "Patch action is not supported.", { index, action });
    }
    const contentSha256 = normalizeSha256(entry.content_sha256, `files[${index}].content_sha256`);
    if (action === "create_file") {
      if (entry.anchor) {
        throw lifecycleError("MANAGED_DELIVERY_CREATE_ANCHOR_FORBIDDEN", "create_file must not depend on a pre-existing anchor.", { index, path });
      }
      return { path, action, content_sha256: contentSha256, anchor: null };
    }
    const anchor = entry.anchor && typeof entry.anchor === "object" ? entry.anchor : null;
    const kind = compact(anchor?.kind, 32).toLowerCase();
    const value = compact(anchor?.value, 4000);
    const occurrence = Number(anchor?.occurrence ?? 1);
    if (!ANCHOR_KINDS.has(kind) || !value || !Number.isInteger(occurrence) || occurrence !== 1) {
      throw lifecycleError("MANAGED_DELIVERY_STABLE_ANCHOR_REQUIRED", "A unique stable semantic anchor is required.", {
        index,
        path,
        allowed_anchor_kinds: [...ANCHOR_KINDS],
      });
    }
    const expectedContextSha256 = normalizeSha256(anchor.expected_context_sha256, `files[${index}].anchor.expected_context_sha256`);
    return {
      path,
      action,
      content_sha256: contentSha256,
      anchor: { kind, value, occurrence: 1, expected_context_sha256: expectedContextSha256 },
    };
  });
  const normalized = {
    intent_key: compact(input.intent_key || "managed_delivery_patch", 120),
    files: normalizedFiles.sort((a, b) => a.path.localeCompare(b.path)),
    semantic_only: true,
    line_number_anchors_allowed: false,
    secrets_included: false,
  };
  return { ...normalized, intent_sha256: sha256(normalized) };
}

export function deriveBaseSynchronizationPlan({
  expected_base_sha,
  expected_head_sha,
  current_base_sha,
  current_head_sha,
  active_runs = [],
  branch,
} = {}) {
  const expectedBaseSha = normalizeGitSha(expected_base_sha, "expected_base_sha");
  const expectedHeadSha = normalizeGitSha(expected_head_sha, "expected_head_sha");
  const currentBaseSha = normalizeGitSha(current_base_sha, "current_base_sha");
  const currentHeadSha = normalizeGitSha(current_head_sha, "current_head_sha");
  const normalizedBranch = normalizeBranch(branch);
  const staleRunIds = (Array.isArray(active_runs) ? active_runs : [])
    .filter((run) => !TERMINAL_RUN_STATES.has(compact(run?.status, 32).toLowerCase()))
    .filter((run) => compact(run?.base_sha, 40).toLowerCase() !== currentBaseSha || compact(run?.head_sha, 40).toLowerCase() !== currentHeadSha)
    .map((run) => compact(run?.run_id, 191))
    .filter(Boolean);
  const required = expectedBaseSha !== currentBaseSha || expectedHeadSha !== currentHeadSha;
  return {
    required,
    branch: normalizedBranch,
    expected_base_sha: expectedBaseSha,
    expected_head_sha: expectedHeadSha,
    current_base_sha: currentBaseSha,
    current_head_sha: currentHeadSha,
    stale_run_ids: [...new Set(staleRunIds)].sort(),
    cancel_stale_runs: staleRunIds.length > 0,
    synchronization_operation: required ? "repo.branch.reconcile" : null,
    synchronization_mode: required ? "fast_forward_or_merge_commit_only" : "not_required",
    force_push_allowed: false,
    exact_readback_required: required,
    secrets_included: false,
  };
}

export function classifyDelegatedCiRepair({
  diagnosis,
  delegation_mode,
  candidate_files = [],
  attempt = 0,
  expected_head_sha,
  expected_base_sha,
  current_head_sha,
  current_base_sha,
} = {}) {
  assertSecretFree(diagnosis, "diagnosis");
  const code = compact(diagnosis?.code, 100).toLowerCase();
  const rule = LOW_RISK_REPAIR_ALLOWLIST[code];
  const files = [...new Set((candidate_files || []).map((path) => compact(path, 500)).filter(Boolean))].sort();
  const reasons = [];
  if (!rule) reasons.push("failure_code_not_allowlisted");
  if (!DELEGATED_REPAIR_MODES.has(compact(delegation_mode, 64))) reasons.push("delegation_mode_not_authorized");
  if (diagnosis?.risk !== "low") reasons.push("diagnosis_risk_not_low");
  if (diagnosis?.structured !== true) reasons.push("structured_diagnosis_required");
  if (Number(attempt) !== 0) reasons.push("repair_attempt_budget_exhausted");
  if (!files.length) reasons.push("candidate_files_required");
  if (rule && files.length > rule.max_files) reasons.push("candidate_file_limit_exceeded");
  if (rule && files.some((path) => !pathWithinRoots(path, rule.allowed_roots))) reasons.push("candidate_path_outside_allowlist");
  const expectedHeadSha = normalizeGitSha(expected_head_sha, "expected_head_sha");
  const expectedBaseSha = normalizeGitSha(expected_base_sha, "expected_base_sha");
  const currentHeadSha = normalizeGitSha(current_head_sha, "current_head_sha");
  const currentBaseSha = normalizeGitSha(current_base_sha, "current_base_sha");
  if (expectedHeadSha !== currentHeadSha) reasons.push("head_sha_drift");
  if (expectedBaseSha !== currentBaseSha) reasons.push("base_sha_drift");
  return {
    allowed: reasons.length === 0,
    code,
    candidate_files: files,
    reasons,
    max_attempts: 1,
    attempt: Number(attempt),
    expected_head_sha: expectedHeadSha,
    expected_base_sha: expectedBaseSha,
    force_push_allowed: false,
    protected_branch_bypass_allowed: false,
    exact_head_readback_required: true,
    secrets_included: false,
  };
}

export function createMergeApprovalBinding({ pull_number, final_head_sha, final_base_sha, approved_by, approved_at, expires_at } = {}) {
  const pullNumber = Number(pull_number);
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw lifecycleError("MANAGED_DELIVERY_PULL_NUMBER_INVALID", "pull_number must be a positive integer.");
  }
  const approvedAt = new Date(approved_at || Date.now());
  const expiresAt = new Date(expires_at || approvedAt.getTime() + 30 * 60 * 1000);
  if (!Number.isFinite(approvedAt.getTime()) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= approvedAt) {
    throw lifecycleError("MANAGED_DELIVERY_APPROVAL_TIME_INVALID", "Approval timestamps are invalid.");
  }
  const binding = {
    binding_version: "managed-delivery-approval-binding-v1",
    pull_number: pullNumber,
    final_head_sha: normalizeGitSha(final_head_sha, "final_head_sha"),
    final_base_sha: normalizeGitSha(final_base_sha, "final_base_sha"),
    approved_by: compact(approved_by, 191),
    approved_at: approvedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    secrets_included: false,
  };
  if (!binding.approved_by) throw lifecycleError("MANAGED_DELIVERY_APPROVER_REQUIRED", "approved_by is required.");
  return { ...binding, binding_sha256: sha256(binding) };
}

export function verifyMergeApprovalBinding(binding, { pull_number, final_head_sha, final_base_sha, now = Date.now() } = {}) {
  assertSecretFree(binding, "approval_binding");
  const expected = createMergeApprovalBinding({
    pull_number: binding?.pull_number,
    final_head_sha: binding?.final_head_sha,
    final_base_sha: binding?.final_base_sha,
    approved_by: binding?.approved_by,
    approved_at: binding?.approved_at,
    expires_at: binding?.expires_at,
  });
  const reasons = [];
  if (binding?.binding_sha256 !== expected.binding_sha256) reasons.push("binding_fingerprint_mismatch");
  if (Number(pull_number) !== expected.pull_number) reasons.push("pull_number_mismatch");
  if (normalizeGitSha(final_head_sha, "final_head_sha") !== expected.final_head_sha) reasons.push("final_head_sha_mismatch");
  if (normalizeGitSha(final_base_sha, "final_base_sha") !== expected.final_base_sha) reasons.push("final_base_sha_mismatch");
  if (new Date(now).getTime() > new Date(expected.expires_at).getTime()) reasons.push("approval_expired");
  return { valid: reasons.length === 0, reasons, binding: expected, secrets_included: false };
}

export function validateManagedDeliveryReceipts(receipts = {}, { final_head_sha, final_base_sha } = {}) {
  assertSecretFree(receipts, "receipts");
  const headSha = normalizeGitSha(final_head_sha, "final_head_sha");
  const baseSha = normalizeGitSha(final_base_sha, "final_base_sha");
  const merge = receipts.merge || {};
  const branchDelete = receipts.branch_delete || {};
  const deployment = receipts.deployment || {};
  const production = receipts.production_readback || {};
  const blockers = [];
  if (merge.merged !== true) blockers.push("merge_not_confirmed");
  if (compact(merge.expected_head_sha, 40).toLowerCase() !== headSha) blockers.push("merge_head_sha_mismatch");
  if (compact(merge.expected_base_sha, 40).toLowerCase() !== baseSha) blockers.push("merge_base_sha_mismatch");
  const mergeSha = /^[0-9a-f]{40}$/.test(compact(merge.merge_sha, 40).toLowerCase()) ? compact(merge.merge_sha, 40).toLowerCase() : null;
  if (!mergeSha) blockers.push("merge_sha_missing");
  if (branchDelete.verified_absent !== true) blockers.push("branch_delete_readback_missing");
  if (compact(branchDelete.expected_head_sha, 40).toLowerCase() !== headSha) blockers.push("branch_delete_head_sha_mismatch");
  if (!compact(deployment.receipt_id, 191)) blockers.push("deployment_receipt_missing");
  if (mergeSha && compact(deployment.deployed_sha, 40).toLowerCase() !== mergeSha) blockers.push("deployment_sha_mismatch");
  if (production.parity !== "verified") blockers.push("production_parity_unverified");
  if (mergeSha && compact(production.deployed_sha, 40).toLowerCase() !== mergeSha) blockers.push("production_readback_sha_mismatch");
  return {
    complete: blockers.length === 0,
    blockers,
    merge_sha: mergeSha,
    receipt_chain_sha256: sha256({ merge, branchDelete, deployment, production }),
    same_cycle_readback_verified: blockers.length === 0,
    secrets_included: false,
  };
}

export function buildManagedDeliveryPlan(input = {}) {
  assertSecretFree(input, "input");
  assertNoBypass(input);
  const branch = normalizeBranch(input.branch || input.head_ref);
  if (PROTECTED_BRANCHES.has(branch.toLowerCase())) {
    throw lifecycleError("MANAGED_DELIVERY_PROTECTED_HEAD_FORBIDDEN", "Managed delivery must use a non-protected feature branch.", { branch });
  }
  const pullNumber = Number(input.pull_number);
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw lifecycleError("MANAGED_DELIVERY_PULL_NUMBER_INVALID", "pull_number must be a positive integer.");
  }
  const patchIntent = normalizeSemanticPatchIntent(input.patch_intent);
  const plan = {
    version: SPEC011_MANAGED_DELIVERY_VERSION,
    operation_key: "repo.change.execute",
    durable_automation_key: "pr_delivery",
    owner: compact(input.owner, 191),
    repo: compact(input.repo, 191),
    pull_number: pullNumber,
    branch,
    default_branch: compact(input.default_branch || "main", 191),
    expected_head_sha: normalizeGitSha(input.expected_head_sha, "expected_head_sha"),
    expected_base_sha: normalizeGitSha(input.expected_base_sha, "expected_base_sha"),
    idempotency_key: compact(input.idempotency_key, 191),
    patch_intent: patchIntent,
    stages: [
      "semantic_patch",
      "base_synchronization",
      "ci_gate",
      "bounded_delegated_repair",
      "final_sha_approval",
      "merge",
      "branch_delete",
      "deployment_receipt",
      "production_readback",
    ],
    safety: {
      no_force_push: true,
      no_protected_branch_bypass: true,
      stale_runs_cancelled_before_new_execution: true,
      repair_attempt_limit: 1,
      approval_bound_to_final_head_and_base: true,
      same_cycle_post_merge_readback_required: true,
      secrets_included: false,
    },
    secrets_included: false,
  };
  if (!plan.owner || !plan.repo || !plan.idempotency_key) {
    throw lifecycleError("MANAGED_DELIVERY_REQUIRED_FIELDS_MISSING", "owner, repo, and idempotency_key are required.");
  }
  return { ...plan, plan_sha256: sha256(plan) };
}

export async function previewManagedDeliveryOperation(input = {}, deps = {}) {
  const plan = buildManagedDeliveryPlan(input);
  const preview = deps.previewOperation || previewOperation;
  const durablePreview = await preview({
    ...input,
    operation_key: "repo.change.preview",
    automation_key: "pr_delivery",
    expected_head_sha: plan.expected_head_sha,
    expected_base_sha: plan.expected_base_sha,
  }, deps.operationDeps || deps);
  return {
    ok: true,
    status: "planned",
    plan,
    durable_preview: durablePreview,
    mutations_executed: false,
    secrets_included: false,
  };
}

export async function executeManagedDeliveryOperation(input = {}, deps = {}) {
  const plan = buildManagedDeliveryPlan(input);
  const readRepositoryState = deps.readRepositoryState;
  const readCiDiagnosis = deps.readCiDiagnosis;
  if (typeof readRepositoryState !== "function" || typeof readCiDiagnosis !== "function") {
    throw lifecycleError("MANAGED_DELIVERY_READBACK_DEPENDENCIES_REQUIRED", "Repository state and CI diagnosis readers are required.");
  }
  const execute = deps.executeOperation || executeOperation;
  let state = await readRepositoryState(plan);
  let syncPlan = deriveBaseSynchronizationPlan({
    expected_base_sha: plan.expected_base_sha,
    expected_head_sha: plan.expected_head_sha,
    current_base_sha: state.base_sha,
    current_head_sha: state.head_sha,
    active_runs: state.active_runs,
    branch: plan.branch,
  });
  if (syncPlan.cancel_stale_runs) {
    if (typeof deps.cancelStaleRun !== "function") {
      return { ok: false, status: "blocked", blocker: "stale_run_cancellation_dependency_required", plan, sync_plan: syncPlan, secrets_included: false };
    }
    for (const runId of syncPlan.stale_run_ids) await deps.cancelStaleRun(runId, { reason: "base_or_head_moved", secrets_included: false });
  }
  if (syncPlan.required) {
    await execute({
      ...input,
      operation_key: "repo.branch.reconcile",
      automation_key: "pr_delivery",
      branch: plan.branch,
      expected_head_sha: state.head_sha,
      expected_base_sha: state.base_sha,
      idempotency_key: `${plan.idempotency_key}:base-sync`,
    }, deps.operationDeps || deps);
    state = await readRepositoryState(plan);
    syncPlan = deriveBaseSynchronizationPlan({
      expected_base_sha: state.base_sha,
      expected_head_sha: state.head_sha,
      current_base_sha: state.base_sha,
      current_head_sha: state.head_sha,
      active_runs: state.active_runs,
      branch: plan.branch,
    });
  }
  let ci = await readCiDiagnosis({ ...plan, head_sha: state.head_sha, base_sha: state.base_sha });
  if (ci.status === "pending" || (ci.missing_checks || []).length) {
    return { ok: true, status: "ci_pending", plan, repository_state: state, ci, secrets_included: false };
  }
  if (ci.status === "failed") {
    const repair = classifyDelegatedCiRepair({
      diagnosis: ci.diagnosis,
      delegation_mode: input.delegation_mode,
      candidate_files: ci.candidate_files,
      attempt: input.repair_attempt || 0,
      expected_head_sha: state.head_sha,
      expected_base_sha: state.base_sha,
      current_head_sha: state.head_sha,
      current_base_sha: state.base_sha,
    });
    if (!repair.allowed || input.repair_authorized !== true || typeof deps.applyDelegatedRepair !== "function") {
      return { ok: true, status: "repair_pending", plan, repository_state: state, ci, repair, secrets_included: false };
    }
    const beforeHead = state.head_sha;
    await deps.applyDelegatedRepair({ ...repair, patch_intent: plan.patch_intent, expected_head_sha: beforeHead, expected_base_sha: state.base_sha });
    state = await readRepositoryState(plan);
    if (state.head_sha === beforeHead || state.base_sha !== repair.expected_base_sha) {
      return { ok: false, status: "blocked", blocker: "delegated_repair_readback_failed", plan, repair, repository_state: state, secrets_included: false };
    }
    ci = await readCiDiagnosis({ ...plan, head_sha: state.head_sha, base_sha: state.base_sha });
    if (ci.status !== "success") return { ok: true, status: "ci_pending", plan, repository_state: state, ci, secrets_included: false };
  }
  const approval = verifyMergeApprovalBinding(input.approval_binding, {
    pull_number: plan.pull_number,
    final_head_sha: state.head_sha,
    final_base_sha: state.base_sha,
    now: deps.now || Date.now(),
  });
  if (!approval.valid) {
    return { ok: true, status: "approval_pending", plan, repository_state: state, approval, secrets_included: false };
  }
  const durableResult = await execute({
    ...input,
    operation_key: "repo.change.execute",
    automation_key: "pr_delivery",
    branch: plan.branch,
    expected_head_sha: state.head_sha,
    expected_base_sha: state.base_sha,
    idempotency_key: `${plan.idempotency_key}:finalize`,
    step_args: {
      ...(input.step_args || {}),
      pr_finalize: {
        ...(input.step_args?.pr_finalize || {}),
        expected_head_sha: state.head_sha,
        expected_base_sha: state.base_sha,
        approval_binding_sha256: approval.binding.binding_sha256,
      },
    },
  }, deps.operationDeps || deps);
  if (typeof deps.readLifecycleReceipts !== "function") {
    return { ok: true, status: "production_readback_pending", plan, repository_state: state, durable_result: durableResult, secrets_included: false };
  }
  const receipts = await deps.readLifecycleReceipts({ ...plan, final_head_sha: state.head_sha, final_base_sha: state.base_sha, durable_result: durableResult });
  const receiptValidation = validateManagedDeliveryReceipts(receipts, { final_head_sha: state.head_sha, final_base_sha: state.base_sha });
  return {
    ok: receiptValidation.complete,
    status: receiptValidation.complete ? "completed" : "production_readback_pending",
    plan,
    repository_state: state,
    approval,
    durable_result: durableResult,
    receipts,
    receipt_validation: receiptValidation,
    secrets_included: false,
  };
}
