import { loadActiveExecutionPolicies, summarizePolicies } from "./runtimePolicyLoader.js";

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "block", "blocking"].includes(normalized)) return true;
  if (["false", "0", "no", "warn", "advisory", "report_only"].includes(normalized)) return false;
  return fallback;
}

function policyJson(policy) {
  return policy?.policy_value?.json && typeof policy.policy_value.json === "object" && !Array.isArray(policy.policy_value.json)
    ? policy.policy_value.json
    : {};
}

function hasMeaningfulPolicy(policies = []) {
  return Array.isArray(policies) && policies.length > 0;
}

function policyAllowsBlocking(policy) {
  const value = policyJson(policy);
  const mode = String(value.enforcement_mode || value.mode || "").trim().toLowerCase();
  if (["report_only", "advisory", "observe"].includes(mode)) return false;
  return policy.blocking_bool && parseBoolean(value.blocking, policy.blocking_bool);
}

function makePreflightResult({ classification = "allow", policies = [], blockingPolicies = [], warnings = [], errors = [], evidence = {} } = {}) {
  return {
    ok: classification !== "blocked",
    classification,
    policy_source: "execution_policies",
    policies: summarizePolicies(policies),
    blocking_policies: summarizePolicies(blockingPolicies),
    warnings,
    errors,
    evidence,
    secrets_included: false,
  };
}

export async function governedExecutionPreflight(context = {}, deps = {}) {
  const policies = await loadActiveExecutionPolicies(context, deps);
  if (!hasMeaningfulPolicy(policies)) {
    return makePreflightResult({ evidence: { reason: "no_matching_active_execution_policy" } });
  }
  const blockingPolicies = policies.filter(policyAllowsBlocking);
  return makePreflightResult({
    classification: blockingPolicies.length ? "requires_policy_specific_evaluation" : "allow_with_policy_advisory",
    policies,
    warnings: blockingPolicies.length ? ["matching_blocking_policies_require_specific_evaluation"] : [],
    evidence: { matching_policy_count: policies.length },
  });
}

function statusBlocksMerge(status = "") {
  return ["error", "failure", "timed_out", "cancelled"].includes(String(status || "").toLowerCase());
}

async function loadRepositoryMutationPolicies(operation, affectsLayer, deps = {}) {
  return loadActiveExecutionPolicies({
    execution_scope: ["repo_mutation", "github_pr_merge", "branch_delete", "repo_patch_apply", operation].filter(Boolean),
    affects_layer: ["adminCliRoutes", "github_rest_fallback", "gptToolsRoutes", "repo_patch_apply", affectsLayer].filter(Boolean),
    policy_group: "Repository Mutation Governance",
    policy_key: "Stale Duplicate Branch Merge Guard",
  }, deps);
}

export async function evaluateRepositoryMutationPreflight({ operation, args = [], repo = {}, pr = null, compare = null, branch = "" } = {}, deps = {}) {
  const policies = await loadRepositoryMutationPolicies(operation, "adminCliRoutes", deps);

  if (!policies.length) {
    return makePreflightResult({ evidence: { operation, reason: "repository_mutation_policy_not_configured" } });
  }

  const blockingPolicies = [];
  const warnings = [];
  const errors = [];
  const evidence = {
    operation,
    args_preview: args.slice(0, 4).map(String),
    repo: repo.owner && repo.repo ? `${repo.owner}/${repo.repo}` : null,
    pr_number: pr?.number || null,
    pr_head_ref: pr?.head?.ref || branch || null,
    pr_base_ref: pr?.base?.ref || null,
    pr_mergeable: pr?.mergeable ?? null,
    compare_status: compare?.status || null,
    compare_ahead_by: compare?.ahead_by ?? null,
    compare_behind_by: compare?.behind_by ?? null,
    compared_files: Array.isArray(compare?.files) ? compare.files.length : null,
  };

  for (const policy of policies) {
    const cfg = policyJson(policy);
    const blockingAllowed = policyAllowsBlocking(policy);

    if (operation === "github_branch_delete") {
      const protectedNames = new Set(["main", "master", "production", "prod"]);
      if (protectedNames.has(String(branch || "").trim())) {
        errors.push("protected_branch_delete_blocked");
        blockingPolicies.push(policy);
        continue;
      }
      if (compare && Number(compare.ahead_by || 0) > 0 && parseBoolean(cfg.block_unmerged_branch_delete, true) && blockingAllowed) {
        errors.push("branch_has_unmerged_commits");
        blockingPolicies.push(policy);
        continue;
      }
      if (compare && Number(compare.behind_by || 0) > 0) {
        warnings.push("branch_is_behind_base_before_delete");
      }
    }

    if (operation === "github_pr_merge") {
      if (pr?.mergeable === false && blockingAllowed) {
        errors.push("pull_request_not_mergeable");
        blockingPolicies.push(policy);
        continue;
      }
      if (pr?.mergeable === null || pr?.mergeable === undefined) {
        warnings.push("pull_request_mergeability_not_final");
      }
      if (compare && Number(compare.behind_by || 0) > 0) {
        warnings.push("pull_request_head_behind_base");
      }
      const riskyFileStatuses = new Set(String(cfg.risky_file_statuses || "removed").split(/[|,;]/).map((x) => x.trim()).filter(Boolean));
      const riskyFiles = Array.isArray(compare?.files)
        ? compare.files.filter((file) => riskyFileStatuses.has(file.status))
        : [];
      if (riskyFiles.length && parseBoolean(cfg.block_risky_file_statuses, true) && blockingAllowed) {
        errors.push("pull_request_contains_risky_file_statuses");
        evidence.risky_files = riskyFiles.slice(0, 20).map((file) => ({ filename: file.filename, status: file.status, changes: file.changes }));
        blockingPolicies.push(policy);
        continue;
      }
      if (compare && String(compare.status || "").toLowerCase() === "diverged") {
        warnings.push("pull_request_compare_is_diverged");
      }
    }

    if (operation === "github_workflow_status") {
      const conclusion = String(compare?.conclusion || "").toLowerCase();
      if (statusBlocksMerge(conclusion) && blockingAllowed) {
        errors.push("workflow_status_blocks_execution");
        blockingPolicies.push(policy);
      }
    }
  }

  if (blockingPolicies.length) {
    return makePreflightResult({ classification: "blocked", policies, blockingPolicies, warnings, errors, evidence });
  }
  return makePreflightResult({
    classification: warnings.length ? "allow_with_policy_warnings" : "allow",
    policies,
    warnings,
    errors,
    evidence,
  });
}

export async function evaluateRepoPatchApplyPreflight({ args = {}, repo = {}, branch = "", defaultBranch = "main", branchExists = false, compare = null } = {}, deps = {}) {
  const policies = await loadRepositoryMutationPolicies("repo_patch_apply", "gptToolsRoutes", deps);
  if (!policies.length) {
    return makePreflightResult({ evidence: { operation: "repo_patch_apply", reason: "repository_mutation_policy_not_configured" } });
  }

  const blockingPolicies = [];
  const warnings = [];
  const errors = [];
  const evidence = {
    operation: "repo_patch_apply",
    repo: repo.owner && repo.repo ? `${repo.owner}/${repo.repo}` : null,
    branch,
    default_branch: defaultBranch,
    branch_exists: Boolean(branchExists),
    compare_status: compare?.status || null,
    compare_ahead_by: compare?.ahead_by ?? null,
    compare_behind_by: compare?.behind_by ?? null,
  };

  for (const policy of policies) {
    const cfg = policyJson(policy);
    const blockingAllowed = policyAllowsBlocking(policy);
    const protectedNames = new Set(["main", "master", "production", "prod", String(defaultBranch || "main")]);
    if (protectedNames.has(String(branch || "").trim()) && blockingAllowed) {
      errors.push("repo_patch_protected_branch_blocked_by_policy");
      blockingPolicies.push(policy);
      continue;
    }

    if (branchExists && compare) {
      const staleBranch = Number(compare.behind_by || 0) > 0 || String(compare.status || "").toLowerCase() === "diverged";
      if (staleBranch && !args.allow_stale_branch_patch && parseBoolean(cfg.block_stale_branch_patch, true) && blockingAllowed) {
        errors.push("repo_patch_stale_branch_requires_explicit_override");
        blockingPolicies.push(policy);
        continue;
      }
      if (Number(compare.ahead_by || 0) > 0) warnings.push("repo_patch_existing_branch_has_unmerged_commits");
    }
  }

  if (blockingPolicies.length) {
    return makePreflightResult({ classification: "blocked", policies, blockingPolicies, warnings, errors, evidence });
  }
  return makePreflightResult({
    classification: warnings.length ? "allow_with_policy_warnings" : "allow",
    policies,
    warnings,
    errors,
    evidence,
  });
}

export async function evaluateGptToolDispatchPreflight({ callerType = "tenant", toolKey = "", args = {} } = {}, deps = {}) {
  const policies = await loadActiveExecutionPolicies({
    execution_scope: ["gpt_tools_call", "tool_dispatch", toolKey].filter(Boolean),
    affects_layer: ["gptToolsRoutes", callerType].filter(Boolean),
  }, deps);
  if (!policies.length) {
    return makePreflightResult({ evidence: { operation: "gpt_tools_call", tool_key: toolKey, reason: "no_matching_active_execution_policy" } });
  }
  const blockingPolicies = policies.filter(policyAllowsBlocking);
  return makePreflightResult({
    classification: blockingPolicies.length ? "requires_policy_specific_evaluation" : "allow_with_policy_advisory",
    policies,
    warnings: blockingPolicies.length ? ["matching_blocking_tool_dispatch_policies_require_specific_evaluation"] : [],
    evidence: { operation: "gpt_tools_call", caller_type: callerType, tool_key: toolKey, matching_policy_count: policies.length },
  });
}

export function assertPreflightAllowed(preflight) {
  if (preflight?.ok !== false) return preflight;
  const err = new Error(`Governed execution preflight blocked operation: ${(preflight.errors || []).join(", ") || "policy_block"}`);
  err.status = 403;
  err.code = "governed_execution_preflight_blocked";
  err.details = preflight;
  throw err;
}
