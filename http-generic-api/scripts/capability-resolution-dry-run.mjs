#!/usr/bin/env node
import { getPool } from "../db.js";
import { runCapabilityResolutionDryRun as runCapabilityResolutionDryRunCore } from "./capability-resolution-dry-run-core.mjs";

export * from "./capability-resolution-dry-run-core.mjs";

const SHA_RE = /^[0-9a-f]{40}$/i;
const STRONG_WORKSPACE_PERMISSIONS = new Set(["owner", "admin", "manage", "operate", "edit"]);

function text(value = "", max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function safeJson(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    tenantId: "",
    userId: "",
    principalType: "",
    principalId: "",
    workspaceId: "",
    workspaceKey: "",
    workspaceType: "",
    userRole: "",
    brandKey: "",
    businessActivityType: "",
    appKey: "",
    capabilityKey: "",
    operationIntent: "read",
    operationMode: "",
    resourceType: "",
    resourceUri: "",
    resourceBranch: "",
    expectedCommitSha: "",
    recipeKey: "",
    runtimeSurface: "",
    requestedSourceTier: "",
    explain: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const [key, inlineValue] = item.includes("=") ? item.split(/=(.*)/s).filter((_, index) => index < 2) : [item, null];
    const value = inlineValue ?? argv[i + 1];
    const consume = inlineValue === null;
    if (key === "--tenant-id") { args.tenantId = value || ""; if (consume) i += 1; }
    else if (key === "--user-id") { args.userId = value || ""; if (consume) i += 1; }
    else if (key === "--principal-type") { args.principalType = value || ""; if (consume) i += 1; }
    else if (key === "--principal-id") { args.principalId = value || ""; if (consume) i += 1; }
    else if (key === "--workspace-id") { args.workspaceId = value || ""; if (consume) i += 1; }
    else if (key === "--workspace-key") { args.workspaceKey = value || ""; if (consume) i += 1; }
    else if (key === "--workspace-type") { args.workspaceType = value || ""; if (consume) i += 1; }
    else if (key === "--user-role") { args.userRole = value || ""; if (consume) i += 1; }
    else if (key === "--brand-key") { args.brandKey = value || ""; if (consume) i += 1; }
    else if (key === "--business-activity-type") { args.businessActivityType = value || ""; if (consume) i += 1; }
    else if (key === "--app-key") { args.appKey = value || ""; if (consume) i += 1; }
    else if (key === "--capability-key") { args.capabilityKey = value || ""; if (consume) i += 1; }
    else if (key === "--operation-intent") { args.operationIntent = value || "read"; if (consume) i += 1; }
    else if (key === "--operation-mode") { args.operationMode = value || ""; if (consume) i += 1; }
    else if (key === "--resource-type") { args.resourceType = value || ""; if (consume) i += 1; }
    else if (key === "--resource-uri") { args.resourceUri = value || ""; if (consume) i += 1; }
    else if (key === "--resource-branch" || key === "--branch") { args.resourceBranch = value || ""; if (consume) i += 1; }
    else if (key === "--expected-commit-sha") { args.expectedCommitSha = value || ""; if (consume) i += 1; }
    else if (key === "--expected-branch-sha") { args.expectedCommitSha = value || args.expectedCommitSha; if (consume) i += 1; }
    else if (key === "--expected-base-sha" && !args.expectedCommitSha) { args.expectedCommitSha = value || ""; if (consume) i += 1; }
    else if (key === "--recipe-key") { args.recipeKey = value || ""; if (consume) i += 1; }
    else if (key === "--runtime-surface") { args.runtimeSurface = value || ""; if (consume) i += 1; }
    else if (key === "--requested-source-tier") { args.requestedSourceTier = value || ""; if (consume) i += 1; }
    else if (key === "--explain") args.explain = true;
  }
  return args;
}

function hasStrongWorkspaceGrant(dryRun = {}) {
  return (dryRun?.authority?.grants || []).some((grant) => STRONG_WORKSPACE_PERMISSIONS.has(text(grant?.permission, 64).toLowerCase()));
}

function exactBindingIds(dryRun = {}) {
  return unique((dryRun?.authority?.platform_resource_authority_bindings || [])
    .map((binding) => text(binding?.binding_id, 64)));
}

async function loadBindingScopes(pool, bindingIds = []) {
  if (!pool?.query || !bindingIds.length) return [];
  const placeholders = bindingIds.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT binding_id, resource_ref_json
       FROM platform_resource_authority_bindings
      WHERE binding_id IN (${placeholders})
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())`,
    bindingIds,
  );
  return (rows || []).map((row) => {
    const ref = safeJson(row.resource_ref_json, {});
    return {
      binding_id: text(row.binding_id, 64),
      branch: text(ref.branch, 255),
      expected_commit_sha: text(ref.expected_commit_sha || ref.base_sha, 64).toLowerCase(),
    };
  });
}

export function resolveExactPlatformAuthorityExecutionScope({ bindings = [], resourceBranch = "", expectedCommitSha = "" } = {}) {
  const expectedSha = text(expectedCommitSha, 64).toLowerCase();
  const requestedBranch = text(resourceBranch, 255);
  if (!SHA_RE.test(expectedSha)) return { ok: false, reason: "expected_commit_sha_missing_or_invalid" };

  const shaMatches = (bindings || []).filter((binding) => binding.expected_commit_sha === expectedSha && binding.branch);
  if (!shaMatches.length) return { ok: false, reason: "expected_commit_sha_mismatch" };

  if (requestedBranch) {
    const exact = shaMatches.find((binding) => binding.branch === requestedBranch);
    return exact
      ? { ok: true, branch: requestedBranch, expected_commit_sha: expectedSha, binding_id: exact.binding_id }
      : { ok: false, reason: "resource_branch_mismatch" };
  }

  const branches = unique(shaMatches.map((binding) => binding.branch));
  if (branches.length !== 1) {
    return { ok: false, reason: branches.length ? "resource_branch_ambiguous" : "resource_branch_missing" };
  }
  return {
    ok: true,
    branch: branches[0],
    expected_commit_sha: expectedSha,
    binding_id: shaMatches[0].binding_id,
  };
}

function failClosedAuthorityScope(dryRun = {}, reason = "platform_resource_authority_scope_mismatch") {
  const gapA = "workspace_resource_grant_missing_for_high_risk_operation";
  const gapB = "elevated_permission_missing";
  const authorityMissing = unique([...(dryRun?.authority?.missing || []), gapA, gapB]);
  const blockingGaps = unique([...(dryRun?.blocking_gaps || []), gapA, gapB]);
  const passed = (dryRun?.authority?.passed || []).filter((item) => item !== "exact_platform_resource_authority_present");
  return {
    ...dryRun,
    request_context: {
      ...(dryRun.request_context || {}),
      resource_branch: null,
      authority_expected_commit_sha: text(dryRun?.request_context?.expected_commit_sha, 64) || null,
    },
    authority: {
      ...(dryRun.authority || {}),
      status: "incomplete",
      passed,
      missing: authorityMissing,
      exact_platform_resource_authority: false,
      exact_platform_resource_authority_scope: {
        matched: false,
        reason,
        secrets_included: false,
      },
    },
    gates: {
      ...(dryRun.gates || {}),
      dispatch_allowed: false,
      apply_allowed: false,
    },
    blocking_gaps: blockingGaps,
    decision: "blocked_missing_authority_or_binding",
  };
}

export async function runCapabilityResolutionDryRun(args = parseArgs()) {
  const dryRun = await runCapabilityResolutionDryRunCore(args);
  if (dryRun?.authority?.exact_platform_resource_authority !== true || hasStrongWorkspaceGrant(dryRun)) return dryRun;

  const bindingIds = exactBindingIds(dryRun);
  const bindings = await loadBindingScopes(getPool(), bindingIds);
  const scope = resolveExactPlatformAuthorityExecutionScope({
    bindings,
    resourceBranch: args.resourceBranch || args.branch || "",
    expectedCommitSha: args.expectedCommitSha || args.expectedBranchSha || args.expectedBaseSha || "",
  });
  if (!scope.ok) return failClosedAuthorityScope(dryRun, scope.reason);

  return {
    ...dryRun,
    request_context: {
      ...(dryRun.request_context || {}),
      resource_branch: scope.branch,
      expected_commit_sha: scope.expected_commit_sha,
    },
    authority: {
      ...(dryRun.authority || {}),
      exact_platform_resource_authority_scope: {
        matched: true,
        binding_id: scope.binding_id,
        resource_branch: scope.branch,
        expected_commit_sha: scope.expected_commit_sha,
        secrets_included: false,
      },
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCapabilityResolutionDryRun(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (error) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: error.code || "capability_resolution_dry_run_failed", message: error.message }, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
