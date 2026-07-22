import { decideRepositoryCoordination, summarizeCoordinationDecision } from "./repositoryCoordinationPlane.js";

const CRITICAL_ACTIONS = new Set(["requires_readback", "reclassify"]);
const TOOL_PATH_FIELDS = ["path", "file_path", "filePath", "target_path", "targetPath"];

function text(value, max = 512) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, max) : "";
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value, 1024)).filter(Boolean))];
}

function collectChangePaths(args = {}) {
  const paths = [];
  for (const field of TOOL_PATH_FIELDS) {
    if (args[field]) paths.push(args[field]);
  }
  for (const item of Array.isArray(args.changes) ? args.changes : []) {
    if (item?.path) paths.push(item.path);
    if (item?.file_path) paths.push(item.file_path);
    if (item?.filePath) paths.push(item.filePath);
  }
  for (const item of Array.isArray(args.files) ? args.files : []) {
    if (item?.path) paths.push(item.path);
    if (item?.filename) paths.push(item.filename);
  }
  return unique(paths);
}

export function buildRepositoryMutationIntent(toolKey = "", args = {}) {
  const paths = collectChangePaths(args);
  return {
    operation_id: text(args.operation_id || args.run_id || args.idempotency_key || args.capability_envelope_id, 128),
    actor_id: text(args.actor_id || args.requested_by || args.approved_by, 128),
    branch: text(args.branch || args.head || args.head_ref, 255),
    base_sha: text(args.expected_base_sha || args.base_sha, 40).toLowerCase(),
    branch_sha: text(args.expected_branch_sha || args.expected_head_sha || args.head_sha, 40).toLowerCase(),
    operation_type: text(toolKey || args.tool_key || args.operation_type, 128),
    risk_class: text(args.risk_class || args.risk, 32),
    paths,
    mode: text(args.repository_coordination_mode || "advisory", 32),
  };
}

export function evaluateRepositoryMutationCoordination(toolKey = "", args = {}, options = {}) {
  const intent = buildRepositoryMutationIntent(toolKey, args);
  const decision = decideRepositoryCoordination({
    mode: options.mode || args.repository_coordination_mode || "advisory",
    intent,
    active_leases: options.active_leases || args.active_repository_leases || [],
    current_state: options.current_state || args.repository_current_state || {},
    now: options.now,
  });
  const criticalGuardEnabled = options.critical_guard === true || args.repository_coordination_critical_guard === true;
  const shouldBlock = criticalGuardEnabled && CRITICAL_ACTIONS.has(decision.action);
  return {
    ok: true,
    mode: criticalGuardEnabled ? "critical_guard" : "advisory",
    tool_key: text(toolKey || args.tool_key, 128),
    intent,
    decision,
    summary: summarizeCoordinationDecision(decision),
    should_block: shouldBlock,
    block_reason_code: shouldBlock ? decision.reason_code : null,
    secrets_included: false,
  };
}

export function attachRepositoryMutationCoordination(result = {}, telemetry = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  return {
    ...result,
    repository_coordination: {
      mode: telemetry.mode || "advisory",
      action: telemetry.summary?.action || telemetry.decision?.action || "unknown",
      reason_code: telemetry.summary?.reason_code || telemetry.decision?.reason_code || "unknown",
      path_count: telemetry.summary?.path_count || 0,
      policy_groups: telemetry.summary?.policy_groups || [],
      should_block: telemetry.should_block === true,
      secrets_included: false,
    },
  };
}
