import { loadActiveExecutionPolicies, summarizePolicies } from "./runtimePolicyLoader.js";
import { resolveBrandCoreRepairCandidates } from "./repairPolicyRouter.js";

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
      const staleBranchOverride = args.allow_stale_branch_patch === true && String(args.stale_branch_reason || "").trim().length >= 10;
      if (staleBranch && !staleBranchOverride && parseBoolean(cfg.block_stale_branch_patch, true) && blockingAllowed) {
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

export async function evaluateAppActionPreflight({ connection = {}, appKey = "", actionKey = "", args = {} } = {}, deps = {}) {
  const resolvedAppKey = String(appKey || connection?.app_key || "").trim();
  const resolvedActionKey = String(actionKey || "").trim();
  const policies = await loadActiveExecutionPolicies({
    execution_scope: ["app_action", "external_app_action", resolvedAppKey, resolvedActionKey].filter(Boolean),
    affects_layer: ["appAdapters", "appAdapters/index.js", resolvedAppKey].filter(Boolean),
  }, deps);
  if (!policies.length) {
    return makePreflightResult({ evidence: { operation: "app_action", app_key: resolvedAppKey, action_key: resolvedActionKey, reason: "no_matching_active_execution_policy" } });
  }

  const warnings = [];
  const errors = [];
  const enforcedBlockingPolicies = [];
  const genericBlockingPolicies = [];
  const evidence = {
    operation: "app_action",
    app_key: resolvedAppKey,
    action_key: resolvedActionKey,
    connection_id: connection?.connection_id || null,
    matching_policy_count: policies.length,
  };

  for (const policy of policies) {
    if (!policyAllowsBlocking(policy)) continue;
    const group = String(policy.policy_group || "").trim();
    const key = String(policy.policy_key || "").trim();
    const cfg = policyJson(policy);

    if (group === "External App Action Governance" && key === "n8n Workflow Execution Guard") {
      if (resolvedAppKey !== "n8n" || resolvedActionKey !== "execute_workflow") continue;
      const reason = String(args.n8n_execution_reason || args.execution_reason || "").trim();
      const allowed = args.allow_n8n_workflow_execution === true && reason.length >= Number(cfg.min_reason_chars || 10);
      evidence.workflow_id = args.workflow_id || null;
      evidence.reason_supplied = Boolean(reason);
      if (!allowed) {
        errors.push("n8n_workflow_execution_requires_explicit_reason");
        enforcedBlockingPolicies.push(policy);
      }
      continue;
    }

    genericBlockingPolicies.push(policy);
  }

  if (enforcedBlockingPolicies.length) {
    return makePreflightResult({ classification: "blocked", policies, blockingPolicies: enforcedBlockingPolicies, warnings, errors, evidence });
  }

  if (genericBlockingPolicies.length) {
    warnings.push("matching_blocking_app_action_policies_require_specific_evaluator");
  }

  return makePreflightResult({
    classification: warnings.length ? "allow_with_policy_warnings" : "allow_with_policy_advisory",
    policies,
    warnings,
    errors,
    evidence,
  });
}

export async function evaluateConnectorDispatchPreflight({ plan = {}, connectorType = "", workflowDef = null, apply = false } = {}, deps = {}) {
  const resolvedConnectorType = String(connectorType || "").trim();
  const policies = await loadActiveExecutionPolicies({
    execution_scope: [
      "connector_dispatch",
      "workflow_dispatch",
      resolvedConnectorType,
      plan.workflow_key,
      plan.intent_key,
    ].filter(Boolean),
    affects_layer: ["connectorExecutor", "connectorExecutor.js", resolvedConnectorType].filter(Boolean),
  }, deps);
  if (!policies.length) {
    return makePreflightResult({ evidence: { operation: "connector_dispatch", connector_type: resolvedConnectorType, reason: "no_matching_active_execution_policy" } });
  }

  const warnings = [];
  const errors = [];
  const enforcedBlockingPolicies = [];
  const genericBlockingPolicies = [];
  const evidence = {
    operation: "connector_dispatch",
    plan_id: plan.plan_id || null,
    tenant_id: plan.tenant_id || null,
    workflow_key: plan.workflow_key || null,
    intent_key: plan.intent_key || null,
    brand_key: plan.brand_key || null,
    connector_type: resolvedConnectorType,
    workflow_execution_class: workflowDef?.execution_class || null,
    workflow_review_required: workflowDef?.review_required ?? null,
    apply: Boolean(apply),
    matching_policy_count: policies.length,
  };

  for (const policy of policies) {
    if (!policyAllowsBlocking(policy)) continue;
    const group = String(policy.policy_group || "").trim();
    const key = String(policy.policy_key || "").trim();

    if (group === "Connector Dispatch Governance" && key === "WordPress Apply Requires Explicit Reason") {
      if (resolvedConnectorType !== "wordpress" || !apply) continue;
      const reason = String(plan.apply_reason || plan.execution_reason || plan.reason || "").trim();
      evidence.reason_supplied = Boolean(reason);
      if (reason.length < 10) {
        errors.push("wordpress_apply_requires_explicit_reason");
        enforcedBlockingPolicies.push(policy);
      }
      continue;
    }

    genericBlockingPolicies.push(policy);
  }

  if (enforcedBlockingPolicies.length) {
    return makePreflightResult({ classification: "blocked", policies, blockingPolicies: enforcedBlockingPolicies, warnings, errors, evidence });
  }

  if (genericBlockingPolicies.length) {
    warnings.push("matching_blocking_connector_dispatch_policies_require_specific_evaluator");
  }

  return makePreflightResult({
    classification: warnings.length ? "allow_with_policy_warnings" : "allow_with_policy_advisory",
    policies,
    warnings,
    errors,
    evidence,
  });
}

export async function evaluateAgentLoopPreflight({ plan = {}, workflow = null, logicKey = "", executionClass = "standard", toolCount = 0, context = {} } = {}, deps = {}) {
  const policies = await loadActiveExecutionPolicies({
    execution_scope: [
      "agent_loop",
      "model_tool_loop",
      "logic_execution",
      executionClass,
      workflow?.workflow_key,
      plan.workflow_key,
      plan.intent_key,
      logicKey,
    ].filter(Boolean),
    affects_layer: ["agentLoopRunner", "agentLoopRunner.js", executionClass].filter(Boolean),
  }, deps);

  if (!policies.length) {
    return makePreflightResult({ evidence: { operation: "agent_loop", workflow_key: plan.workflow_key || null, reason: "no_matching_active_execution_policy" } });
  }

  const warnings = [];
  const errors = [];
  const enforcedBlockingPolicies = [];
  const genericBlockingPolicies = [];
  const evidence = {
    operation: "agent_loop",
    plan_id: plan.plan_id || null,
    tenant_id: plan.tenant_id || null,
    agent_id: plan.agent_id || null,
    workflow_key: plan.workflow_key || workflow?.workflow_key || null,
    intent_key: plan.intent_key || null,
    brand_key: plan.brand_key || null,
    logic_key: logicKey || null,
    execution_class: executionClass,
    tool_count: Number(toolCount || 0),
    review_required: workflow?.review_required ?? null,
    workspace_app_connection_count: context?.workspace_app_connection_count ?? null,
    matching_policy_count: policies.length,
  };

  for (const policy of policies) {
    if (!policyAllowsBlocking(policy)) continue;
    const group = String(policy.policy_group || "").trim();
    const key = String(policy.policy_key || "").trim();

    if (group === "Agent Loop Governance" && key === "Brand Writing Requires Brand Core") {
      const writingLike = /write|content|seo|publish|strategy/i.test(String(plan.intent_key || plan.workflow_key || ""));
      const hasBrandCoreEvidence = Boolean(context?.brand_core || context?.brand_core_resolved || context?.brandCore);
      evidence.brand_core_evidence = hasBrandCoreEvidence;
      if (writingLike && !hasBrandCoreEvidence) {
        errors.push("brand_writing_requires_brand_core");
        enforcedBlockingPolicies.push(policy);
        const brandKey = plan.brand_key || plan.target_key || context?.brand_key || context?.target_key || "";
        if (brandKey) {
          try {
            evidence.repair_policy = await resolveBrandCoreRepairCandidates(brandKey, ["brand_writing_requires_brand_core"], deps);
          } catch (repairError) {
            evidence.repair_policy = {
              ok: false,
              classification: "repair_policy_lookup_failed",
              error: repairError?.code || "repair_policy_lookup_failed",
              message: repairError?.message || "Unable to resolve Brand Core repair candidates.",
              secrets_included: false,
            };
          }
        }
      }
      continue;
    }

    genericBlockingPolicies.push(policy);
  }

  if (enforcedBlockingPolicies.length) {
    return makePreflightResult({ classification: "blocked", policies, blockingPolicies: enforcedBlockingPolicies, warnings, errors, evidence });
  }

  if (genericBlockingPolicies.length) {
    warnings.push("matching_blocking_agent_loop_policies_require_specific_evaluator");
  }

  return makePreflightResult({
    classification: warnings.length ? "allow_with_policy_warnings" : "allow_with_policy_advisory",
    policies,
    warnings,
    errors,
    evidence,
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
