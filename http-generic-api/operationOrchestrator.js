import {
  buildRepositoryAutomationPlan,
  readRepositoryAutomationRun,
  runRepositoryAutomation,
} from "./repositoryAutomationControlPlane.js";
import { buildOperationContext } from "./operationContextService.js";
import { getOperationContract, validateOperationInput } from "./operationContractRegistry.js";

const REQUIRED_CHECKS = Object.freeze([
  "Syntax Check",
  "Architecture Drift Detection",
  "Execution Resolver Gate",
  "Unit & Integration Tests",
]);

function operationError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function compact(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function automationInput(input, mode) {
  return {
    ...input,
    automation_key: compact(input.automation_key || input.recipe_key || "pr_delivery", 64),
    mode,
    owner: compact(input.owner || "mad4bdigital-ai", 191),
    repo: compact(input.repo || "multi-business-multi-role-growth-intelligence-os", 191),
    default_branch: compact(input.default_branch || "main", 191),
    branch: compact(input.branch || input.head_ref, 255) || null,
    pull_number: Number(input.pull_number || 0) || null,
    required_checks: input.required_checks || REQUIRED_CHECKS,
  };
}

function summarizeChecks(gate = {}) {
  const checks = Array.isArray(gate.checks) ? gate.checks : [];
  const failed = checks.filter((check) => String(check.conclusion || check.status).toLowerCase() === "failure");
  const pending = checks.filter((check) => !check.conclusion && String(check.status).toLowerCase() !== "completed");
  return {
    status: failed.length ? "failed" : pending.length ? "pending" : gate.gate_status || "unknown",
    failing_checks: failed.map((check) => ({ name: check.name, details_url: check.details_url || null })),
    pending_checks: pending.map((check) => check.name),
    missing_checks: gate.missing_checks || [],
    recommended_action: failed.length ? "inspect_failing_check_annotations" : pending.length ? "wait_for_checks" : null,
  };
}

export async function previewOperation(input = {}, deps = {}) {
  const contract = getOperationContract(input.operation_key || input.operation || input.intent);
  validateOperationInput(contract, input);
  const context = await buildOperationContext({
    auth: deps.auth,
    input: { ...input, operation_key: contract.operation_key, response_mode: input.response_mode || "relevant" },
    pool: deps.pool,
  });
  if (contract.operation_key === "platform.surface.inspect") return { ...context, preview: true };
  if (contract.operation_key === "repo.change.preview" || contract.operation_key === "repo.branch.reconcile") {
    return {
      ok: true,
      operation_key: contract.operation_key,
      context,
      plan: buildRepositoryAutomationPlan(automationInput(input, "dry_run")),
      mutations_executed: false,
      secrets_included: false,
    };
  }
  throw operationError(409, "OPERATION_PREVIEW_NOT_SUPPORTED", "This operation does not support preview.", {
    operation_key: contract.operation_key,
  });
}

export async function executeOperation(input = {}, deps = {}) {
  const contract = getOperationContract(input.operation_key || input.operation || input.intent);
  validateOperationInput(contract, input);
  const context = await buildOperationContext({
    auth: deps.auth,
    input: { ...input, operation_key: contract.operation_key, response_mode: "relevant" },
    pool: deps.pool,
  });

  if (contract.operation_key === "repo.change.execute" || contract.operation_key === "repo.branch.reconcile") {
    const result = await runRepositoryAutomation(automationInput(input, "apply"), deps);
    return {
      ...result,
      operation_key: contract.operation_key,
      context,
      same_cycle_readback_required: true,
      secrets_included: false,
    };
  }
  if (contract.operation_key === "operation.resume") {
    const current = await readRepositoryAutomationRun({ run_id: input.run_id }, { pool: deps.pool });
    if (["completed", "failed", "blocked", "cancelled"].includes(String(current.status || "").toLowerCase())) {
      return { ...current, operation_key: contract.operation_key, resumed: false, terminal: true, secrets_included: false };
    }
    const plan = current.plan || current.run?.plan || {};
    const resumed = await runRepositoryAutomation({
      ...plan,
      ...input,
      mode: "apply",
      run_id: input.run_id,
    }, deps);
    return { ...resumed, operation_key: contract.operation_key, resumed: true, secrets_included: false };
  }
  throw operationError(409, "OPERATION_EXECUTION_NOT_SUPPORTED", "This operation is not executable through the current orchestrator.", {
    operation_key: contract.operation_key,
  });
}

export async function getOperationStatus(input = {}, deps = {}) {
  const contract = getOperationContract(input.operation_key || input.operation || "operation.status.get");
  validateOperationInput(contract, input);
  await buildOperationContext({
    auth: deps.auth,
    input: { ...input, operation_key: contract.operation_key },
    pool: deps.pool,
  });
  const result = await readRepositoryAutomationRun({ run_id: input.run_id }, { pool: deps.pool });
  return { ...result, operation_key: contract.operation_key, secrets_included: false };
}

export async function diagnoseCi(input = {}, deps = {}) {
  const contract = getOperationContract(input.operation_key || input.operation || "repo.ci.diagnose");
  validateOperationInput(contract, input);
  const context = await buildOperationContext({
    auth: deps.auth,
    input: { ...input, operation_key: contract.operation_key, response_mode: "relevant" },
    pool: deps.pool,
  });
  if (typeof deps.dispatch !== "function") {
    throw operationError(500, "OPERATION_DISPATCH_UNAVAILABLE", "CI diagnosis requires the governed tool dispatcher.");
  }
  const response = await deps.dispatch("github_pr_ci_gate", {
    owner: input.owner,
    repo: input.repo,
    pull_number: Number(input.pull_number),
    required_checks: input.required_checks || REQUIRED_CHECKS,
  });
  const gate = response?.result || response?.body?.result || response?.body || response;
  return {
    ok: gate?.gate_status === "pass",
    operation_key: contract.operation_key,
    context,
    diagnosis: summarizeChecks(gate || {}),
    raw_gate_summary: {
      gate_status: gate?.gate_status || null,
      head_sha: gate?.head_sha || null,
      base_sha: gate?.base_sha || null,
    },
    secrets_included: false,
  };
}

export const _testingOperationOrchestrator = { automationInput, summarizeChecks };
