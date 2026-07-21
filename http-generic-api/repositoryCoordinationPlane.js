const FINALIZE_OPERATIONS = new Set([
  "github_pr_finalize",
  "pull_request_finalize",
  "github_branch_delete",
  "branch_delete",
  "migration_apply",
]);
const MUTATION_OPERATIONS = new Set([
  "repo_patch_apply",
  "repo_patch_batch_apply",
  "repo_existing_blob_commit_apply",
  "github_branch_fast_forward_to_base",
  "github_branch_merge_commit_create",
  "github_pr_finalize",
  "github_branch_delete",
  "docs_agent_commit",
  "auto_sync_commit",
]);
function clean(value, max = 512) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : "";
}
function uniq(items = []) {
  return [...new Set((Array.isArray(items) ? items : []).map((item) => clean(item, 1024)).filter(Boolean))];
}
function wildcardToRegExp(pattern) {
  const escaped = clean(pattern, 1024)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*");
  return new RegExp(`^${escaped}$`);
}
export function repositoryPathPolicy(path = "") {
  const normalized = clean(path, 1024);
  if (!normalized) return { group: "unknown", policy: "manual_resolution_required", risk: "medium" };
  if (/^docs\/work-maps\//.test(normalized)) {
    return { group: "generated_docs", policy: "generated_file_regenerate", risk: "low" };
  }
  if (/^docs\/auto-docs-agent\//.test(normalized)) {
    return { group: "generated_docs", policy: "generated_file_regenerate", risk: "low" };
  }
  if (normalized === "http-generic-api/scripts/test-manifest.mjs") {
    return { group: "test_manifest", policy: "ordered_unique_list_merge", risk: "medium" };
  }
  if (/migrations\/.+\.sql$/.test(normalized)) {
    return { group: "migration", policy: "additive_governed_migration", risk: "high" };
  }
  if (/\.(mjs|js|ts|tsx|jsx)$/.test(normalized)) {
    return { group: "runtime_source", policy: "exact_blob_or_section_patch", risk: "medium" };
  }
  if (/\.md$/.test(normalized)) {
    return { group: "documentation", policy: "section_aware_append", risk: "low" };
  }
  return { group: "repository_file", policy: "exact_blob_replace", risk: "medium" };
}
export function overlapPaths(left = [], right = []) {
  const exact = new Set(uniq(right));
  const wildcard = uniq(right).filter((item) => item.includes("*")).map(wildcardToRegExp);
  return uniq(left).filter((path) => exact.has(path) || wildcard.some((rule) => rule.test(path)));
}
function normalizeIntent(input = {}) {
  const paths = uniq(input.paths || input.changed_files || input.path_scope || []);
  const operation = clean(input.operation_type || input.operation || input.tool_key, 128) || "repository_mutation";
  const policies = paths.map((path) => ({ path, ...repositoryPathPolicy(path) }));
  const risk = clean(input.risk_class || input.risk, 32) || (policies.some((item) => item.risk === "high") ? "high" : "medium");
  return {
    operation_id: clean(input.operation_id || input.intent_id, 128),
    actor_id: clean(input.actor_id || input.agent_id || input.requested_by, 128),
    branch: clean(input.branch, 255),
    base_sha: clean(input.base_sha || input.expected_base_sha, 40).toLowerCase(),
    branch_sha: clean(input.branch_sha || input.expected_branch_sha, 40).toLowerCase(),
    operation,
    risk,
    paths,
    policies,
    mode: clean(input.mode || "advisory", 32),
  };
}
function normalizeLease(input = {}) {
  return {
    lease_id: clean(input.lease_id, 64),
    branch: clean(input.branch || input.branch_name, 255),
    holder_run_id: clean(input.holder_run_id || input.operation_id, 128),
    holder_actor_id: clean(input.holder_actor_id || input.actor_id, 128),
    mode: clean(input.lease_mode || input.mode || "path_scoped_write", 64),
    paths: uniq(input.paths || input.path_scope || ["**"]),
    status: clean(input.status || "active", 32),
    expires_at: input.expires_at || null,
  };
}
function isActiveLease(lease, now = new Date()) {
  if (!lease || lease.status !== "active") return false;
  if (!lease.expires_at) return true;
  const expires = new Date(lease.expires_at);
  return Number.isNaN(expires.getTime()) || expires > now;
}
function canShareLease(intent, lease) {
  if (!lease) return true;
  if (intent.operation_id && lease.holder_run_id === intent.operation_id) return true;
  if (intent.actor_id && lease.holder_actor_id === intent.actor_id && lease.mode !== "finalize_exclusive") return true;
  return false;
}
function decision(action, reason_code, details = {}) {
  return { action, reason_code, ...details, secrets_included: false };
}
export function decideRepositoryCoordination(input = {}) {
  const intent = normalizeIntent(input.intent || input);
  const mode = clean(input.mode || intent.mode || "advisory", 32);
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const leases = (Array.isArray(input.active_leases) ? input.active_leases : [])
    .map(normalizeLease)
    .filter((lease) => isActiveLease(lease, now) && (!intent.branch || lease.branch === intent.branch));
  const current = input.current_state || {};
  const activeConflicts = leases.map((lease) => ({ lease, overlap: overlapPaths(intent.paths, lease.paths) }))
    .filter(({ lease, overlap }) => !canShareLease(intent, lease) && (overlap.length || lease.mode === "finalize_exclusive"));
  const policies = intent.policies;
  if (current.unknown_provider_outcome && !current.same_cycle_readback_verified) {
    return decision("requires_readback", "unknown_provider_outcome_requires_readback", { intent, mode, policies });
  }
  if ((current.base_sha && intent.base_sha && current.base_sha !== intent.base_sha)
      || (current.branch_sha && intent.branch_sha && current.branch_sha !== intent.branch_sha)) {
    return decision("reclassify", "repository_sha_drift_detected", { intent, mode, policies, current_state: current });
  }
  if (FINALIZE_OPERATIONS.has(intent.operation)) {
    const ownFinalize = leases.find((lease) => canShareLease(intent, lease) && lease.mode === "finalize_exclusive");
    if (!ownFinalize) return decision(mode === "advisory" ? "requires_exclusive_lease" : "deny_conflict", "finalize_requires_exclusive_lease", { intent, mode, policies });
  }
  if (activeConflicts.length) {
    const generatedOnly = policies.length > 0 && policies.every((policy) => policy.policy === "generated_file_regenerate");
    const manifestOnly = policies.length > 0 && policies.every((policy) => policy.policy === "ordered_unique_list_merge");
    if (generatedOnly) return decision("defer", "generated_docs_deferred_by_active_lease", { intent, mode, policies, conflicts: activeConflicts });
    if (manifestOnly) return decision("merge_with_policy", "manifest_overlap_can_use_ordered_unique_merge", { intent, mode, policies, conflicts: activeConflicts });
    return decision(mode === "advisory" ? "requires_manual_review" : "deny_conflict", "active_lease_path_conflict", { intent, mode, policies, conflicts: activeConflicts });
  }
  if (!MUTATION_OPERATIONS.has(intent.operation)) {
    return decision("allow", "read_or_plan_operation", { intent, mode, policies });
  }
  if (policies.some((policy) => policy.policy === "additive_governed_migration")) {
    return decision("requires_governed_migration_flow", "migration_paths_require_separate_authorization", { intent, mode, policies });
  }
  if (policies.some((policy) => policy.policy === "generated_file_regenerate")) {
    return decision("allow_with_regeneration_claim", "generated_paths_use_regenerate_policy", { intent, mode, policies });
  }
  return decision("allow_with_path_claim", "no_active_path_conflict", { intent, mode, policies });
}
export function summarizeCoordinationDecision(result = {}) {
  return {
    action: result.action || "unknown",
    reason_code: result.reason_code || "unknown",
    path_count: result.intent?.paths?.length || 0,
    policy_groups: uniq((result.policies || []).map((policy) => policy.group)),
    secrets_included: false,
  };
}
