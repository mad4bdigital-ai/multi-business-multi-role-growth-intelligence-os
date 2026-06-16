import { createHash, randomUUID } from "node:crypto";

import { getPool } from "./db.js";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { markCapabilityEnvelopeReferenced, resolveCapabilityExecutionEnvelope } from "./capabilityResolutionEnvelopeGuard.js";
import {
  REPOSITORY_PR_RECONCILE_RECIPE_KEY,
  normalizeGithubRepoRef,
  tenantRepositoryPrReconciliationSweep,
} from "./repositoryTenantIntelligenceV2.js";

const V6_REPORT_SCHEMA = "tenant_repository_intelligence_report.v6";
const V6_PLAN_SCHEMA = "tenant_repository_mutation_plan.v6";
const READ_ONLY_MODES = new Set(["read_only", "diagnostic", "continue_read_only"]);
const MUTATION_ACTIONS = new Set([
  "repo.pr.comment_advisory",
  "repo.pr.label",
  "repo.pr.close_superseded",
  "repo.branch.fast_forward",
  "repo.branch.rebuild_fresh",
  "repo.file.patch_apply",
  "repo.pr.merge_ready",
]);

function s(value = "") { return String(value ?? "").trim(); }
function safeJson(value, fallback = {}) { if (value && typeof value === "object") return value; try { return JSON.parse(String(value || "")); } catch { return fallback; } }
function hash(value) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function bounded(value, fallback, min, max) { const n = Number(value); return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), min), max) : fallback; }
function isAdmin(auth = {}) { return auth?.is_admin === true; }
function repoPath(file = {}) { return s(file.path || file.filename); }
function checkName(check = {}) { return s(check.name || check.context); }
function checkConclusion(check = {}) { return s(check.conclusion || check.state).toLowerCase(); }

export function resolveRepositoryPrincipalScopeV6(args = {}, auth = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const requestedTenant = s(args.tenant_id || options.tenant_id);
  const requestedUser = s(args.user_id || options.user_id);
  const authenticatedTenant = s(auth?.tenant_id);
  const authenticatedUser = s(auth?.user_id);
  if (!isAdmin(auth) && !authenticatedTenant) {
    const err = new Error("Authenticated tenant scope is required for repository governance."); err.status = 403; err.code = "repository_authenticated_tenant_required"; throw err;
  }
  if (!isAdmin(auth) && requestedTenant && requestedTenant !== authenticatedTenant) {
    const err = new Error("Tenant scope cannot be overridden by a tenant principal."); err.status = 403; err.code = "repository_tenant_scope_override_forbidden"; throw err;
  }
  if (!isAdmin(auth) && requestedUser && (!authenticatedUser || requestedUser !== authenticatedUser)) {
    const err = new Error("User scope cannot be overridden by another user."); err.status = 403; err.code = "repository_user_scope_override_forbidden"; throw err;
  }
  return {
    tenant_id: (isAdmin(auth) ? requestedTenant : authenticatedTenant) || null,
    workspace_id: s(args.workspace_id || options.workspace_id) || null,
    user_id: (isAdmin(auth) ? requestedUser : authenticatedUser) || null,
    principal_type: isAdmin(auth) ? "admin" : authenticatedUser ? "user" : "tenant",
  };
}

export async function validateRepositoryPrincipalScopeV6(args = {}, { auth = {}, pool = getPool() } = {}) {
  const scope = resolveRepositoryPrincipalScopeV6(args, auth);
  if (!scope.tenant_id && !isAdmin(auth)) {
    const err = new Error("Tenant-scoped repository intelligence requires an authenticated tenant."); err.status = 403; err.code = "repository_tenant_scope_required"; throw err;
  }
  if (scope.workspace_id) {
    const [rows] = await pool.query("SELECT workspace_id, tenant_id, bootstrap_status FROM workspace_registry WHERE workspace_id = ? LIMIT 1", [scope.workspace_id]);
    const workspace = rows?.[0];
    if (!workspace || (scope.tenant_id && workspace.tenant_id !== scope.tenant_id)) {
      const err = new Error("Workspace does not belong to the resolved tenant scope."); err.status = 403; err.code = "repository_workspace_tenant_mismatch"; throw err;
    }
  }
  if (scope.user_id && scope.tenant_id) {
    const [rows] = await pool.query("SELECT id FROM memberships WHERE user_id = ? AND tenant_id = ? AND status = 'active' LIMIT 1", [scope.user_id, scope.tenant_id]);
    if (!rows?.length) { const err = new Error("User has no active membership in the resolved tenant."); err.status = 403; err.code = "repository_user_membership_required"; throw err; }
  }
  return { ...scope, validated: true, secrets_included: false };
}

export async function resolveRepositoryAuthorityBindingV6({ scope, repoRef, recipeKey = REPOSITORY_PR_RECONCILE_RECIPE_KEY, mode = "read_only", pool = getPool() } = {}) {
  const clauses = ["status = 'active'", "resource_type = 'github_repo'", "resource_uri = ?", "(recipe_key = ? OR recipe_key IS NULL)", "(expires_at IS NULL OR expires_at > NOW())"];
  const params = [repoRef.resource_uri, recipeKey];
  if (scope?.tenant_id) { clauses.push("tenant_id = ?"); params.push(scope.tenant_id); }
  else clauses.push("tenant_id IS NULL");
  if (scope?.workspace_id) { clauses.push("(workspace_id IS NULL OR workspace_id = ?)"); params.push(scope.workspace_id); }
  else clauses.push("workspace_id IS NULL");
  if (scope?.user_id) { clauses.push("(user_id IS NULL OR user_id = ?)"); params.push(scope.user_id); }
  else clauses.push("user_id IS NULL");
  const [rows] = await pool.query(`SELECT * FROM platform_resource_authority_bindings WHERE ${clauses.join(" AND ")} ORDER BY user_id IS NOT NULL DESC, workspace_id IS NOT NULL DESC, recipe_key IS NOT NULL DESC, created_at DESC LIMIT 1`, params);
  const binding = rows?.[0] || null;
  if (!binding) return { ok: false, reason_code: "blocked_missing_platform_resource_authority_binding", provider_calls_made: 0, secrets_included: false };
  const allowedModes = safeJson(binding.allowed_modes_json, []);
  const permissionRank = { read_only: 1, diagnostic: 2, comment: 3, label: 4, close: 5, patch: 6, merge: 7, admin: 99 };
  const requiredPermission = recipeKey === "repo.pr.comment_advisory" ? "comment"
    : recipeKey === "repo.pr.label" ? "label"
      : recipeKey === "repo.pr.close_superseded" ? "close"
        : ["repo.branch.fast_forward", "repo.branch.rebuild_fresh", "repo.file.patch_apply"].includes(recipeKey) ? "patch"
          : recipeKey === "repo.pr.merge_ready" ? "merge"
            : "read_only";
  const modeAllowed = READ_ONLY_MODES.has(mode)
    ? (allowedModes.includes(mode) || allowedModes.includes("read_only") || allowedModes.includes("*"))
    : mode === "apply" && (allowedModes.includes("apply") || allowedModes.includes(recipeKey) || allowedModes.includes("*"));
  const permissionAllowed = Number(permissionRank[binding.permission_level] || 0) >= Number(permissionRank[requiredPermission] || 99);
  if (!modeAllowed || !permissionAllowed) {
    return { ok: false, reason_code: !modeAllowed ? "blocked_platform_resource_authority_binding_mode" : "blocked_platform_resource_authority_binding_permission", binding_id: binding.binding_id, required_permission: requiredPermission, permission_level: binding.permission_level, provider_calls_made: 0, secrets_included: false };
  }
  return { ok: true, binding, binding_id: binding.binding_id, permission_level: binding.permission_level, required_permission: requiredPermission, allowed_modes: allowedModes, secrets_included: false };
}

export async function validateRepositoryProviderBindingV6({ binding, scope, pool = getPool() } = {}) {
  if (!binding?.source_system_id && !binding?.source_installation_id) {
    const compatible = ["admin_grant", "platform_managed", "system_seed"].includes(s(binding?.authority_source).toLowerCase());
    return { ok: compatible, provider_mode: compatible ? "platform_managed_compat" : "unbound", reason_code: compatible ? null : "repository_provider_binding_required", action: {}, secrets_included: false };
  }
  const [systems] = await pool.query("SELECT system_id, tenant_id, provider_family, connector_family, status, config_json FROM connected_systems WHERE system_id = ? LIMIT 1", [binding.source_system_id]);
  const system = systems?.[0];
  if (!system || system.status !== "active" || s(system.provider_family).toLowerCase() !== "github" || (scope?.tenant_id && system.tenant_id !== scope.tenant_id)) {
    return { ok: false, provider_mode: "tenant_connected_system", reason_code: "repository_connected_system_invalid", secrets_included: false };
  }
  let installation = null;
  if (binding.source_installation_id) {
    const [rows] = await pool.query("SELECT installation_id, system_id, tenant_id, status, expires_at, meta_json FROM installations WHERE installation_id = ? AND system_id = ? LIMIT 1", [binding.source_installation_id, system.system_id]);
    installation = rows?.[0] || null;
    if (!installation || installation.status !== "active" || (installation.expires_at && new Date(installation.expires_at).getTime() <= Date.now()) || (scope?.tenant_id && installation.tenant_id !== scope.tenant_id)) {
      return { ok: false, provider_mode: "tenant_connected_system", reason_code: "repository_provider_installation_invalid", secrets_included: false };
    }
  }
  const config = safeJson(system.config_json, {});
  const meta = safeJson(installation?.meta_json, {});
  const githubInstallationId = s(meta.github_app_installation_id || meta.provider_installation_id || config.github_app_installation_id || config.provider_installation_id);
  return {
    ok: Boolean(githubInstallationId),
    provider_mode: "tenant_connected_system",
    reason_code: githubInstallationId ? null : "github_provider_installation_id_missing",
    connected_system_id: system.system_id,
    installation_id: installation?.installation_id || null,
    action: githubInstallationId ? { github_app_installation_id: githubInstallationId } : {},
    secrets_included: false,
  };
}

async function githubGet(pathname, token, { allowStatuses = [] } = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "growth-intelligence-repository-governance-v6" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok && !allowStatuses.includes(response.status)) { const err = new Error(body?.message || `GitHub request failed with ${response.status}`); err.status = response.status; err.code = "repository_v6_github_request_failed"; err.details = { pathname, status: response.status }; throw err; }
  return { status: response.status, body, link: response.headers.get("link") || "" };
}

async function githubRequestV6(method, pathname, token, body = undefined, { allowStatuses = [] } = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "growth-intelligence-repository-governance-v6" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !allowStatuses.includes(response.status)) {
    const err = new Error(payload?.message || `GitHub ${method} request failed with ${response.status}`);
    err.status = response.status;
    err.code = "repository_v6_github_request_failed";
    err.details = { pathname, method, status: response.status, documentation_url: payload?.documentation_url || null };
    throw err;
  }
  return { status: response.status, body: payload, link: response.headers.get("link") || "" };
}
function migrationIdentity(path = "") {
  const name = s(path).split("/").pop() || "";
  const match = name.match(/^(\d+)_([^/]+)\.sql$/i);
  return match ? { number: match[1], slug: match[2].toLowerCase(), path } : null;
}

function requiredCheckState(required = [], checks = [], statuses = []) {
  const visible = new Map();
  for (const item of [...checks, ...statuses]) visible.set(checkName(item), checkConclusion(item));
  const missing = required.filter((name) => !visible.has(name));
  const failing = required.filter((name) => ["failure", "failed", "error", "cancelled", "timed_out", "action_required"].includes(visible.get(name)));
  const pending = required.filter((name) => visible.has(name) && !["success", "neutral", "skipped"].includes(visible.get(name)) && !failing.includes(name));
  return { required, missing, failing, pending, complete: missing.length === 0 && failing.length === 0 && pending.length === 0 };
}

async function fetchMainTree({ owner, repo, defaultBranch, token }) {
  const branch = await githubGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(defaultBranch)}`, token);
  const sha = branch.body?.commit?.sha;
  if (!sha) return { sha: null, paths: new Set(), sha_by_path: new Map(), migrations: [], truncated: true };
  const tree = await githubGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(sha)}?recursive=1`, token);
  const blobs = (tree.body?.tree || []).filter((item) => item.type === "blob" && item.path);
  const paths = new Set(blobs.map((item) => item.path));
  const shaByPath = new Map(blobs.map((item) => [item.path, s(item.sha) || null]));
  const migrations = [...paths].map(migrationIdentity).filter(Boolean);
  return { sha, paths, sha_by_path: shaByPath, migrations, truncated: tree.body?.truncated === true };
}

async function analyzeOnePrV6({ owner, repo, pr, token, defaultBranch, mainTree, branchProtection, options }) {
  const number = Number(pr.number);
  const detail = await githubGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`, token);
  const filesResult = await githubGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/files?per_page=100`, token);
  const files = Array.isArray(filesResult.body) ? filesResult.body : [];
  const headSha = s(detail.body?.head?.sha || pr.head_ref_oid);
  const baseSha = s(detail.body?.base?.sha || pr.base_ref_oid);
  const checksResult = headSha ? await githubGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${headSha}/check-runs?per_page=100`, token) : { body: { check_runs: [] } };
  const statusResult = headSha ? await githubGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${headSha}/status?per_page=100`, token) : { body: { statuses: [] } };
  const compare = baseSha && headSha ? await githubGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${baseSha}...${headSha}?per_page=100`, token) : { body: {} };
  const mergeBase = s(compare.body?.merge_base_commit?.sha);
  let baseSince = { body: { files: [] } };
  let headSince = { body: { files: [] } };
  if (mergeBase && baseSha && headSha) {
    [baseSince, headSince] = await Promise.all([
      githubGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${mergeBase}...${baseSha}?per_page=100`, token),
      githubGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${mergeBase}...${headSha}?per_page=100`, token),
    ]);
  }
  const baseChanged = new Set((baseSince.body?.files || []).map((file) => file.filename));
  const headChanged = new Set((headSince.body?.files || files).map((file) => file.filename));
  const overlap = [...headChanged].filter((path) => baseChanged.has(path));
  const checks = checksResult.body?.check_runs || [];
  const statuses = statusResult.body?.statuses || [];
  const requiredChecks = branchProtection.required_checks || [];
  const checkState = requiredCheckState(requiredChecks, checks, statuses);
  const changedMigrations = files.map((file) => migrationIdentity(file.filename)).filter(Boolean);
  const duplicateNumbers = [...new Set(changedMigrations.map((item) => item.number).filter((numberValue, index, all) => all.indexOf(numberValue) !== all.lastIndexOf(numberValue)))];
  const canonicalReplacements = changedMigrations.flatMap((item) => mainTree.migrations.filter((mainItem) => mainItem.slug === item.slug && mainItem.number !== item.number).map((mainItem) => ({ pr: item.path, canonical: mainItem.path, pr_number: item.number, canonical_number: mainItem.number })));
  const equivalenceLimit = bounded(options.equivalence_file_limit, 20, 0, 50);
  const parityFiles = files.slice(0, equivalenceLimit);
  const parity = [];
  for (const file of parityFiles) {
    const path = file.filename;
    const headFileSha = s(file.sha) || null;
    const mainFileSha = mainTree.sha_by_path?.get(path) || null;
    const equal = file.status === "removed" ? mainFileSha === null : Boolean(headFileSha && mainFileSha && headFileSha === mainFileSha);
    parity.push({ path, status: file.status, equal, head_sha: headFileSha, main_sha: mainFileSha });
  }
  const filesPageComplete = !s(filesResult.link).includes('rel="next"');
  const checksPageComplete = !s(checksResult.link).includes('rel="next"');
  const statusesPageComplete = !s(statusResult.link).includes('rel="next"');
  const comparePagesComplete = !s(compare.link).includes('rel="next"') && !s(baseSince.link).includes('rel="next"') && !s(headSince.link).includes('rel="next"');
  const compareFilesComplete = [compare, baseSince, headSince].every((result) => (result.body?.files || []).length < 300);
  const exactHeadComplete = Boolean(headSha && baseSha);
  const branchCompareComplete = comparePagesComplete && compareFilesComplete;
  const parityComplete = filesPageComplete && files.length <= equivalenceLimit && mainTree.truncated !== true;
  const deepEvidenceComplete = exactHeadComplete && filesPageComplete && checksPageComplete && statusesPageComplete && branchCompareComplete && mainTree.truncated !== true;
  const exactMainEquivalence = parityComplete && parity.length > 0 && parity.every((item) => item.equal);
  const aheadBy = Number(compare.body?.ahead_by || 0);
  const behindBy = Number(compare.body?.behind_by || 0);
  const failingChecks = checks.filter((item) => ["failure", "cancelled", "timed_out", "action_required"].includes(checkConclusion(item)));
  let classification = "manual_review_required";
  let reasonCode = "insufficient_deep_evidence";
  let recommendedAction = "manual_review";
  if (exactMainEquivalence) { classification = "superseded_by_main"; reasonCode = "exact_changed_file_parity_with_main"; recommendedAction = "repo.pr.close_superseded"; }
  else if (duplicateNumbers.length || canonicalReplacements.length) { classification = "duplicate_migration_conflict"; reasonCode = canonicalReplacements.length ? "canonical_migration_replacement_exists" : "duplicate_migration_number_in_pr"; recommendedAction = "repo.pr.comment_advisory"; }
  else if (detail.body?.mergeable === false || failingChecks.length || checkState.failing.length) { classification = "unsafe_to_merge"; reasonCode = failingChecks.length || checkState.failing.length ? "failing_checks" : "github_mergeability_false"; recommendedAction = "fix_before_merge"; }
  else if (!deepEvidenceComplete) { classification = "manual_review_required"; reasonCode = "incomplete_repository_evidence"; recommendedAction = "rerun_with_complete_evidence_or_review_manually"; }
  else if (aheadBy > 0 && behindBy > 0 && overlap.length) { classification = "diverged_same_files"; reasonCode = "base_and_head_changed_same_files"; recommendedAction = "manual_rebuild_required"; }
  else if (aheadBy > 0 && behindBy > 0) { classification = "diverged_no_overlap"; reasonCode = "diverged_without_file_overlap"; recommendedAction = "repo.branch.rebuild_fresh"; }
  else if (behindBy > 0 && aheadBy === 0) { classification = "behind_only"; reasonCode = "head_has_no_unique_commits"; recommendedAction = "repo.branch.fast_forward"; }
  else if (!checks.length && !statuses.length) { classification = "clean_but_ci_missing"; reasonCode = "no_ci_evidence_for_exact_head"; recommendedAction = "run_or_wait_for_ci"; }
  else if (requiredChecks.length && !checkState.complete) { classification = "clean_but_ci_missing"; reasonCode = "required_checks_incomplete"; recommendedAction = "wait_or_fix_required_checks"; }
  else if (detail.body?.draft) { classification = "manual_review_required"; reasonCode = "draft_pull_request"; recommendedAction = "wait_or_review_manually"; }
  else if (branchProtection.visible !== true) { classification = "manual_review_required"; reasonCode = "branch_protection_not_visible"; recommendedAction = "verify_branch_protection_and_required_checks"; }
  else { classification = "merge_ready"; reasonCode = "deep_readiness_checks_passed"; recommendedAction = "repo.pr.merge_ready"; }
  return {
    number,
    title: detail.body?.title || pr.title || null,
    url: detail.body?.html_url || pr.url || null,
    head_ref_name: detail.body?.head?.ref || pr.head_ref_name || null,
    base_ref_name: detail.body?.base?.ref || defaultBranch,
    head_sha: headSha,
    base_sha: baseSha,
    classification_v6: classification,
    reason_code_v6: reasonCode,
    recommended_action_v6: recommendedAction,
    confidence_v6: exactMainEquivalence ? 0.99 : canonicalReplacements.length ? 0.97 : overlap.length ? 0.94 : classification === "merge_ready" ? 0.92 : 0.88,
    branch_reconciliation: { ahead_by: aheadBy, behind_by: behindBy, merge_base_sha: mergeBase || null, overlapping_files: overlap, classification: aheadBy > 0 && behindBy > 0 ? (overlap.length ? "diverged_same_files" : "diverged_no_overlap") : behindBy > 0 ? "behind_only" : "clean_or_ahead" },
    ci: { exact_head_sha: headSha, check_runs: checks.map((item) => ({ name: item.name, status: item.status, conclusion: item.conclusion })), commit_statuses: statuses.map((item) => ({ context: item.context, state: item.state })), required: checkState },
    migration_analysis: { changed: changedMigrations, duplicate_numbers: duplicateNumbers, canonical_replacements: canonicalReplacements },
    main_equivalence: { evaluated: true, exact: exactMainEquivalence, complete: parityComplete, file_limit: equivalenceLimit, files: parity },
    data_completeness: { exact_head_complete: exactHeadComplete, files_page_complete: filesPageComplete, check_runs_page_complete: checksPageComplete, commit_statuses_page_complete: statusesPageComplete, compare_pages_complete: comparePagesComplete, compare_files_complete: compareFilesComplete, branch_compare_complete: branchCompareComplete, main_tree_truncated: mainTree.truncated, branch_protection_visible: branchProtection.visible, exact_equivalence_complete: parityComplete, deep_evidence_complete: deepEvidenceComplete },
    mutations_allowed: false,
    secrets_included: false,
  };
}

async function writeV6Evidence({ scope, repoRef, report, evidenceType = "tenant_repository_intelligence_report_v6" }) {
  const evidenceId = randomUUID();
  const request = { resource_uri: repoRef.resource_uri, tenant_scope_present: Boolean(scope.tenant_id), workspace_scope_present: Boolean(scope.workspace_id), user_scope_present: Boolean(scope.user_id), secrets_included: false };
  const response = { schema_version: report.schema_version, summary: report.summary, pull_requests: report.pull_requests.map((pr) => ({ number: pr.number, classification_v6: pr.classification_v6, reason_code_v6: pr.reason_code_v6, recommended_action_v6: pr.recommended_action_v6, confidence_v6: pr.confidence_v6 })), secrets_included: false };
  await getPool().query(
    `INSERT INTO audit_payload_evidence
      (evidence_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, source_table, source_pk, evidence_type, request_preview, request_sha256, response_preview, response_sha256, metadata_json, redaction_status, secrets_included)
     VALUES (?, ?, ?, ?, ?, 'github_repo', ?, 'platform_resource_authority_bindings', ?, ?, ?, ?, ?, ?, ?, 'not_required', 0)`,
    [evidenceId, scope.tenant_id, scope.user_id || "tenant_repository_v6", scope.principal_type || "tenant", "tenant_repository_intelligence_v6_report", repoRef.resource_uri, report.authority?.binding_id || null, evidenceType, JSON.stringify(request), hash(request), JSON.stringify(response), hash(response), JSON.stringify({ schema_version: V6_REPORT_SCHEMA, provider_mode: report.provider?.provider_mode || null, pr_count: report.summary.pr_count, classification_counts: report.summary.classifications, mutations_executed: false, secrets_included: false })]
  );
  return { evidence_id: evidenceId, evidence_type: evidenceType, secrets_included: false };
}

export async function tenantRepositoryIntelligenceV6Report(args = {}, { auth = {}, runGovernedResource } = {}) {
  const repoRef = normalizeGithubRepoRef(args);
  if (!repoRef) { const err = new Error("owner/repo or github://owner/repo is required."); err.status = 400; err.code = "github_repo_ref_required"; throw err; }
  const scope = await validateRepositoryPrincipalScopeV6(args, { auth });
  const authority = await resolveRepositoryAuthorityBindingV6({ scope, repoRef, mode: "read_only" });
  if (!authority.ok) return { ok: false, tool: "tenant_repository_intelligence_v6_report", classification: "blocked_repository_authority", reason_code: authority.reason_code, provider_calls_made: 0, mutations_executed: false, secrets_included: false };
  const provider = await validateRepositoryProviderBindingV6({ binding: authority.binding, scope });
  if (!provider.ok) return { ok: false, tool: "tenant_repository_intelligence_v6_report", classification: "blocked_repository_provider_binding", reason_code: provider.reason_code, authority: { binding_id: authority.binding_id }, provider, provider_calls_made: 0, mutations_executed: false, secrets_included: false };
  const sweep = await tenantRepositoryPrReconciliationSweep({ ...args, tenant_id: scope.tenant_id, workspace_id: scope.workspace_id, user_id: scope.user_id, state: args.state || "open", limit: bounded(args.limit, 20, 1, 50), include_changed_files: true, include_check_runs: true, record_evidence: args.record_evidence !== false }, { auth, runGovernedResource });
  if (!sweep?.ok) return { ...sweep, tool: "tenant_repository_intelligence_v6_report", classification: "repository_v6_base_sweep_blocked" };
  const token = await getGitHubAppInstallationToken({ action: provider.action || {} });
  const repoInfo = await githubGet(`/repos/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(repoRef.repo)}`, token);
  const defaultBranch = s(repoInfo.body?.default_branch || "main");
  const protectionResult = await githubGet(`/repos/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(repoRef.repo)}/branches/${encodeURIComponent(defaultBranch)}/protection`, token, { allowStatuses: [403, 404] });
  const requiredChecks = protectionResult.status === 200 ? [...(protectionResult.body?.required_status_checks?.contexts || []), ...(protectionResult.body?.required_status_checks?.checks || []).map((item) => item.context)].filter(Boolean) : [];
  const branchProtection = { visible: protectionResult.status === 200, status: protectionResult.status, required_checks: [...new Set(requiredChecks)] };
  const mainTree = await fetchMainTree({ owner: repoRef.owner, repo: repoRef.repo, defaultBranch, token });
  const options = { equivalence_file_limit: bounded(args.equivalence_file_limit, 20, 0, 50) };
  const pullRequests = [];
  for (const pr of sweep.pull_requests || []) pullRequests.push(await analyzeOnePrV6({ owner: repoRef.owner, repo: repoRef.repo, pr, token, defaultBranch, mainTree, branchProtection, options }));
  const classifications = pullRequests.reduce((acc, pr) => { acc[pr.classification_v6] = (acc[pr.classification_v6] || 0) + 1; return acc; }, {});
  const report = {
    schema_version: V6_REPORT_SCHEMA,
    engine_version: "v6_scope_provider_deep_reconciliation",
    resource_uri: repoRef.resource_uri,
    scope,
    authority: { binding_id: authority.binding_id, permission_level: authority.permission_level, allowed_modes: authority.allowed_modes },
    provider: { ok: provider.ok, provider_mode: provider.provider_mode, connected_system_id: provider.connected_system_id || null, installation_id: provider.installation_id || null, secrets_included: false },
    repository: { owner: repoRef.owner, repo: repoRef.repo, default_branch: defaultBranch, main_sha: mainTree.sha, branch_protection: branchProtection },
    summary: { pr_count: pullRequests.length, classifications, provider_calls_made_minimum: 3 + pullRequests.length * 6, apply_allowed: false, mutations_executed: false, secrets_included: false },
    pull_requests: pullRequests,
    recommended_next_step: "tenant_repository_mutation_plan_v6",
    apply_allowed: false,
    mutations_executed: false,
    secrets_included: false,
  };
  const evidence = args.record_evidence === false ? { recorded: false, secrets_included: false } : await writeV6Evidence({ scope, repoRef, report });
  return { ok: true, tool: "tenant_repository_intelligence_v6_report", classification: "tenant_repository_intelligence_v6_read_only", report, evidence, apply_allowed: false, mutations_executed: false, secrets_included: false };
}

function mutationPlanForPr(pr = {}) {
  let action = MUTATION_ACTIONS.has(pr.recommended_action_v6) ? pr.recommended_action_v6 : "repo.pr.comment_advisory";
  if (pr.classification_v6 === "unsafe_to_merge") action = "repo.pr.label";
  const implementedAdapters = new Set(["repo.pr.comment_advisory", "repo.pr.label", "repo.pr.close_superseded", "repo.branch.fast_forward", "repo.pr.merge_ready"]);
  const planItemId = randomUUID();
  const confirmation = `APPLY_${action.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_PR_${pr.number}_${planItemId.slice(0, 8).toUpperCase()}`;
  const labels = action === "repo.pr.label"
    ? [`governance:${String(pr.classification_v6 || "review-required").replaceAll("_", "-")}`]
    : [];
  return {
    plan_item_id: planItemId,
    pr_number: pr.number,
    head_sha: pr.head_sha,
    head_ref_name: pr.head_ref_name || null,
    base_ref_name: pr.base_ref_name || null,
    classification: pr.classification_v6,
    reason_code: pr.reason_code_v6 || null,
    confidence: pr.confidence_v6,
    action,
    labels,
    adapter_implemented: implementedAdapters.has(action),
    execution_status: action === "repo.pr.comment_advisory" ? "approval_required" : implementedAdapters.has(action) ? "recipe_activation_required" : "adapter_not_enabled",
    requires_capability_envelope: true,
    requires_approval_hold: true,
    requires_typed_confirmation: true,
    typed_confirmation: confirmation,
    requires_same_cycle_readback: true,
    evidence_sha256: hash({ plan_item_id: planItemId, pr_number: pr.number, head_sha: pr.head_sha, head_ref_name: pr.head_ref_name || null, base_ref_name: pr.base_ref_name || null, classification: pr.classification_v6, reason_code: pr.reason_code_v6 || null, action, labels }),
    apply_allowed: false,
    mutations_executed: false,
    secrets_included: false,
  };
}

export function buildRepositoryMutationPlanV6(report = {}) {
  const items = (report.pull_requests || []).map(mutationPlanForPr);
  return {
    schema_version: V6_PLAN_SCHEMA,
    engine_version: "v6_generic_repository_mutation_planner",
    resource_uri: report.resource_uri,
    report_schema_version: report.schema_version,
    report_sha256: hash(report),
    summary: { item_count: items.length, actions: items.reduce((acc, item) => { acc[item.action] = (acc[item.action] || 0) + 1; return acc; }, {}), executable_now: items.filter((item) => item.execution_status === "approval_required").length, adapter_not_enabled: items.filter((item) => item.execution_status === "adapter_not_enabled").length },
    items,
    apply_allowed: false,
    mutations_executed: false,
    secrets_included: false,
  };
}

export async function tenantRepositoryMutationPlanV6(args = {}, deps = {}) {
  const resourceUri = s(args.resource_uri || args.report?.resource_uri);
  const reportArgs = { ...args, resource_uri: resourceUri || args.resource_uri, record_evidence: true };
  delete reportArgs.report;
  const reportResult = await tenantRepositoryIntelligenceV6Report(reportArgs, deps);
  if (!reportResult.ok) return { ...reportResult, tool: "tenant_repository_mutation_plan_v6", classification: "repository_mutation_plan_blocked" };
  const plan = buildRepositoryMutationPlanV6(reportResult.report);
  const planId = randomUUID();
  const planSha256 = hash(plan);
  const ttlMinutes = bounded(args.plan_ttl_minutes, 120, 5, 1440);
  await getPool().query(
    `INSERT INTO repository_mutation_plans_v6
      (plan_id, tenant_id, workspace_id, user_id, resource_uri, report_sha256, plan_sha256, plan_json, status, expires_at, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approval_required', DATE_ADD(NOW(), INTERVAL ? MINUTE), 0)`,
    [planId, reportResult.report.scope?.tenant_id || null, reportResult.report.scope?.workspace_id || null,
      reportResult.report.scope?.user_id || null, reportResult.report.resource_uri, plan.report_sha256, planSha256,
      JSON.stringify(plan), ttlMinutes]
  );
  return { ok: true, tool: "tenant_repository_mutation_plan_v6", classification: "tenant_repository_mutation_plan_v6_created", plan_id: planId, plan_sha256: planSha256, expires_in_minutes: ttlMinutes, plan, apply_allowed: false, mutations_executed: false, secrets_included: false };
}

const REPOSITORY_MUTATION_OPERATION_INTENT_BY_RECIPE = Object.freeze({
  "repo.pr.comment_advisory": "repo.pr.comment_advisory.apply",
  "repo.pr.label": "repo.pr.label.apply",
  "repo.pr.close_superseded": "repo.pr.close_superseded.apply",
  "repo.branch.fast_forward": "repo.branch.fast_forward.apply",
  "repo.branch.rebuild_fresh": "repo.branch.rebuild_fresh.apply",
  "repo.file.patch_apply": "repo.file.patch_apply.apply",
  "repo.pr.merge_ready": "repo.pr.merge_ready.apply",
});

function mutationOperationIntentV6(action = "") {
  return REPOSITORY_MUTATION_OPERATION_INTENT_BY_RECIPE[s(action)] || "";
}

const MUTATION_PERMISSION_BY_RECIPE = {
  "repo.pr.comment_advisory": "comment",
  "repo.pr.label": "label",
  "repo.pr.close_superseded": "close",
  "repo.branch.fast_forward": "patch",
  "repo.branch.rebuild_fresh": "patch",
  "repo.file.patch_apply": "patch",
  "repo.pr.merge_ready": "merge",
};

export async function createRepositoryMutationAuthorityBindingV6(args = {}, { auth = {} } = {}) {
  if (!isAdmin(auth)) { const err = new Error("Repository mutation authority binding creation is admin-only."); err.status = 403; err.code = "repository_mutation_binding_admin_required"; throw err; }
  const repoRef = normalizeGithubRepoRef(args);
  if (!repoRef) { const err = new Error("owner/repo or github://owner/repo is required."); err.status = 400; err.code = "github_repo_ref_required"; throw err; }
  const recipeKey = s(args.recipe_key);
  const requiredPermission = MUTATION_PERMISSION_BY_RECIPE[recipeKey];
  if (!requiredPermission) { const err = new Error("Unsupported repository mutation recipe."); err.status = 400; err.code = "repository_mutation_recipe_unsupported"; throw err; }
  const [[recipe]] = await getPool().query(
    `SELECT recipe_key, status, risk_class, read_only, requires_capability_envelope, requires_typed_confirmation, requires_same_cycle_readback
       FROM platform_resource_recipes WHERE recipe_key = ? LIMIT 1`,
    [recipeKey]
  );
  if (!recipe || recipe.status !== "active" || recipe.risk_class !== "mutation" || Number(recipe.read_only) !== 0 || !Number(recipe.requires_capability_envelope) || !Number(recipe.requires_typed_confirmation) || !Number(recipe.requires_same_cycle_readback)) {
    const err = new Error(`Repository mutation recipe ${recipeKey} is not active with all required gates.`); err.status = 409; err.code = "repository_mutation_recipe_not_active"; err.details = recipe || null; throw err;
  }
  const scope = await validateRepositoryPrincipalScopeV6(args, { auth });
  if (!scope.tenant_id) { const err = new Error("Mutation authority binding requires tenant_id."); err.status = 400; err.code = "repository_mutation_binding_tenant_required"; throw err; }
  const permission = s(args.permission_level || requiredPermission);
  if (![requiredPermission, "admin"].includes(permission)) { const err = new Error(`permission_level must be ${requiredPermission} or admin.`); err.status = 400; err.code = "repository_mutation_binding_permission_mismatch"; throw err; }
  const authoritySource = s(args.authority_source || "tenant_connected_system");
  const sourceSystemId = s(args.source_system_id);
  const sourceInstallationId = s(args.source_installation_id);
  const platformManaged = ["platform_managed", "system_seed", "admin_grant"].includes(authoritySource);
  if (!platformManaged && (!sourceSystemId || !sourceInstallationId)) { const err = new Error("Tenant-owned repository mutation bindings require source_system_id and source_installation_id."); err.status = 400; err.code = "repository_mutation_provider_binding_required"; throw err; }
  const candidate = { authority_source: authoritySource, source_system_id: sourceSystemId || null, source_installation_id: sourceInstallationId || null };
  const provider = await validateRepositoryProviderBindingV6({ binding: candidate, scope });
  if (!provider.ok) { const err = new Error("Repository provider binding validation failed."); err.status = 409; err.code = provider.reason_code || "repository_provider_binding_invalid"; err.details = provider; throw err; }
  const [existing] = await getPool().query(
    `SELECT * FROM platform_resource_authority_bindings
      WHERE status='active' AND tenant_id=? AND COALESCE(workspace_id,'')=COALESCE(?,'') AND COALESCE(user_id,'')=COALESCE(?,'')
        AND resource_type='github_repo' AND resource_uri=? AND recipe_key=? AND permission_level=?
      ORDER BY created_at DESC LIMIT 1`,
    [scope.tenant_id, scope.workspace_id, scope.user_id, repoRef.resource_uri, recipeKey, permission]
  );
  if (existing.length) return { ok: true, tool: "platform_repository_mutation_authority_binding_create_v6", classification: "repository_mutation_authority_binding_already_active", binding: { ...existing[0], resource_ref_json: undefined, allowed_modes_json: safeJson(existing[0].allowed_modes_json, []), secrets_included: false }, created: false, provider, secrets_included: false };
  const bindingId = randomUUID();
  await getPool().query(
    `INSERT INTO platform_resource_authority_bindings
      (binding_id, tenant_id, workspace_id, user_id, resource_type, resource_uri, resource_ref_json, recipe_key, permission_level, allowed_modes_json, authority_source, source_system_id, source_installation_id, expires_at, status, notes, created_by)
     VALUES (?, ?, ?, ?, 'github_repo', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [bindingId, scope.tenant_id, scope.workspace_id, scope.user_id, repoRef.resource_uri, JSON.stringify(repoRef.resource_ref), recipeKey, permission, JSON.stringify(["apply"]), authoritySource, sourceSystemId || null, sourceInstallationId || null, args.expires_at || null, s(args.notes || "repository_mutation_authority_binding_v6"), s(args.created_by || auth.user_id || "system:repository_governance_v6")]
  );
  const [[row]] = await getPool().query(`SELECT * FROM platform_resource_authority_bindings WHERE binding_id=? LIMIT 1`, [bindingId]);
  return { ok: true, tool: "platform_repository_mutation_authority_binding_create_v6", classification: "repository_mutation_authority_binding_created", binding: { ...row, resource_ref_json: safeJson(row.resource_ref_json, null), allowed_modes_json: safeJson(row.allowed_modes_json, []), secrets_included: false }, created: true, provider, secrets_included: false };
}

async function loadMutationPlanV6(planId = "", { allowExpired = false } = {}) {
  const [[row]] = await getPool().query(`SELECT * FROM repository_mutation_plans_v6 WHERE plan_id=? LIMIT 1`, [s(planId)]);
  if (!row) { const err = new Error("Repository mutation plan not found."); err.status = 404; err.code = "repository_mutation_plan_not_found"; throw err; }
  if (!allowExpired && row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) { const err = new Error("Repository mutation plan expired."); err.status = 409; err.code = "repository_mutation_plan_expired"; throw err; }
  const plan = safeJson(row.plan_json, null);
  if (!plan || !row.plan_sha256 || hash(plan) !== s(row.plan_sha256)) { const err = new Error("Repository mutation plan integrity check failed."); err.status = 409; err.code = "repository_mutation_plan_integrity_failed"; throw err; }
  return { row, plan };
}

function mutationItemEvidenceHashV6(item = {}) {
  return hash({
    plan_item_id: item.plan_item_id,
    pr_number: item.pr_number,
    head_sha: item.head_sha,
    head_ref_name: item.head_ref_name || null,
    base_ref_name: item.base_ref_name || null,
    classification: item.classification,
    reason_code: item.reason_code || null,
    action: item.action,
    labels: Array.isArray(item.labels) ? item.labels : [],
  });
}

function assertMutationPlanScopeV6(row = {}, auth = {}) {
  if (isAdmin(auth)) return;
  if (!auth?.tenant_id || row.tenant_id !== auth.tenant_id) { const err = new Error("Mutation plan tenant scope mismatch."); err.status = 403; err.code = "repository_mutation_plan_tenant_mismatch"; throw err; }
  if (row.user_id && auth?.user_id !== row.user_id) { const err = new Error("Mutation plan user scope mismatch."); err.status = 403; err.code = "repository_mutation_plan_user_mismatch"; throw err; }
  if (row.workspace_id && auth?.workspace_id !== row.workspace_id) { const err = new Error("Mutation plan workspace scope mismatch."); err.status = 403; err.code = "repository_mutation_plan_workspace_mismatch"; throw err; }
}

async function validateMutationApprovalV6({ row, item, args, auth }) {
  if (s(args.typed_confirmation) !== s(item.typed_confirmation)) { const err = new Error("Typed confirmation does not match the mutation plan item."); err.status = 409; err.code = "repository_mutation_typed_confirmation_mismatch"; throw err; }
  const envelope = await resolveCapabilityExecutionEnvelope({
    envelopeId: s(args.capability_envelope_id),
    acceptedAppKeys: ["github"],
    acceptedIntents: [mutationOperationIntentV6(item.action)],
    expectedTenantId: row.tenant_id || "",
    expectedUserId: row.user_id || auth?.user_id || "",
    expectedCommitSha: item.head_sha || "",
    requireReadyForDispatch: true,
    requireDispatchAllowed: true,
    requireNoApprovalRequired: false,
    requireNoBlockingGaps: true,
    requireNoSecrets: true,
  });
  if (!envelope.ok) { const err = new Error(envelope.message || "Capability envelope rejected repository mutation."); err.status = 403; err.code = envelope.status; err.details = envelope; throw err; }
  if (envelope.apply_allowed !== true) { const err = new Error("Capability envelope does not grant apply authority."); err.status = 403; err.code = "capability_resolution_envelope_apply_not_allowed"; err.details = envelope; throw err; }
  const [[envelopeRow]] = await getPool().query(
    `SELECT tenant_id, user_id, workspace_id, app_key, capability_key, operation_intent, envelope_json
       FROM capability_resolution_envelope_ledger WHERE envelope_id=? LIMIT 1`,
    [envelope.envelope_id]
  );
  const envelopeJson = safeJson(envelopeRow?.envelope_json, {});
  const contexts = [envelopeJson.request_context, envelopeJson.inputs, envelopeJson.capability, envelopeJson.selected_source]
    .filter((value) => value && typeof value === "object");
  const contextValue = (...keys) => {
    for (const context of contexts) for (const key of keys) if (s(context?.[key])) return s(context[key]);
    return "";
  };
  const allowedIntents = new Set([mutationOperationIntentV6(item.action)]);
  const bindingChecks = {
    tenant: Boolean(envelopeRow?.tenant_id && envelopeRow.tenant_id === row.tenant_id),
    workspace: !row.workspace_id || envelopeRow?.workspace_id === row.workspace_id,
    user: !row.user_id || envelopeRow?.user_id === row.user_id,
    app: s(envelopeRow?.app_key).toLowerCase() === "github",
    intent: allowedIntents.has(s(envelopeRow?.operation_intent).toLowerCase()),
    plan_id: contextValue("plan_id", "planId") === row.plan_id,
    plan_item_id: contextValue("plan_item_id", "planItemId") === item.plan_item_id,
    resource_uri: contextValue("resource_uri", "resourceUri") === row.resource_uri,
    recipe_key: contextValue("recipe_key", "recipeKey", "action") === item.action,
    head_sha: contextValue("expected_commit_sha", "expectedCommitSha", "head_sha", "headSha").toLowerCase() === s(item.head_sha).toLowerCase(),
  };
  if (Object.values(bindingChecks).some((value) => value !== true)) {
    const err = new Error("Capability envelope is not bound to this repository mutation plan item and scope.");
    err.status = 403;
    err.code = "repository_mutation_capability_binding_mismatch";
    err.details = { checks: bindingChecks, envelope_id: envelope.envelope_id, secrets_included: false };
    throw err;
  }
  const [[hold]] = await getPool().query(
    `SELECT hold_id, run_id, tenant_id, workspace_id, user_id, hold_type, request_id, correlation_id,
            status, expires_at, execution_context_json
       FROM approval_holds WHERE hold_id=? LIMIT 1`,
    [s(args.approval_hold_id)]
  );
  const context = safeJson(hold?.execution_context_json, {});
  const holdOk = hold && hold.status === "approved" && hold.hold_type === "supervisor_approval"
    && (!hold.expires_at || new Date(hold.expires_at).getTime() > Date.now())
    && hold.run_id === envelope.envelope_id
    && hold.request_id === "capability_resolution_envelope_apply_authorization"
    && hold.correlation_id === envelope.envelope_id
    && (!row.tenant_id || hold.tenant_id === row.tenant_id)
    && (!row.workspace_id || hold.workspace_id === row.workspace_id)
    && (!row.user_id || hold.user_id === row.user_id)
    && context.envelope_id === envelope.envelope_id
    && context.apply_authorization_source === "dynamic_capability_apply_authorization_policy"
    && context.allow_external_write === true;
  if (!holdOk) { const err = new Error("Approval hold is missing, expired, or not bound to this capability envelope, external-write authority, and scope."); err.status = 403; err.code = "repository_mutation_approval_hold_invalid"; throw err; }
  return { envelope, hold: { hold_id: hold.hold_id, status: hold.status, expires_at: hold.expires_at, secrets_included: false } };
}
async function reanalyzeMutationItemV6({ repoRef, item, token }) {
  const repoInfo = await githubGet(`/repos/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(repoRef.repo)}`, token);
  const defaultBranch = s(repoInfo.body?.default_branch || "main");
  const protectionResult = await githubGet(`/repos/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(repoRef.repo)}/branches/${encodeURIComponent(defaultBranch)}/protection`, token, { allowStatuses: [403, 404] });
  const requiredChecks = protectionResult.status === 200 ? [...(protectionResult.body?.required_status_checks?.contexts || []), ...(protectionResult.body?.required_status_checks?.checks || []).map((check) => check.context)].filter(Boolean) : [];
  const branchProtection = { visible: protectionResult.status === 200, status: protectionResult.status, required_checks: [...new Set(requiredChecks)] };
  const mainTree = await fetchMainTree({ owner: repoRef.owner, repo: repoRef.repo, defaultBranch, token });
  const analysis = await analyzeOnePrV6({ owner: repoRef.owner, repo: repoRef.repo, pr: { number: item.pr_number }, token, defaultBranch, mainTree, branchProtection, options: { equivalence_file_limit: 50 } });
  return { analysis, defaultBranch, branchProtection, mainTree };
}

function assertSameCycleMutationEvidenceV6(item = {}, current = {}) {
  const analysis = current.analysis || {};
  if (!item.head_sha || analysis.head_sha !== item.head_sha) { const err = new Error("PR head SHA changed after the mutation plan was created."); err.status = 409; err.code = "repository_mutation_head_sha_changed"; err.details = { planned_head_sha: item.head_sha || null, current_head_sha: analysis.head_sha || null }; throw err; }
  if (item.action === "repo.pr.close_superseded" && (analysis.classification_v6 !== "superseded_by_main" || analysis.main_equivalence?.exact !== true || analysis.main_equivalence?.complete !== true || Number(analysis.confidence_v6 || 0) < 0.98)) { const err = new Error("Close requires complete exact main equivalence and high-confidence superseded classification."); err.status = 409; err.code = "repository_close_superseded_evidence_failed"; throw err; }
  if (item.action === "repo.branch.fast_forward" && analysis.classification_v6 !== "behind_only") { const err = new Error("Fast-forward requires same-cycle behind_only classification."); err.status = 409; err.code = "repository_fast_forward_evidence_failed"; throw err; }
  if (item.action === "repo.pr.merge_ready" && (analysis.classification_v6 !== "merge_ready" || current.branchProtection?.visible !== true || analysis.ci?.required?.complete !== true)) { const err = new Error("Merge requires same-cycle merge_ready evidence, visible branch protection, and complete required checks."); err.status = 409; err.code = "repository_merge_ready_evidence_failed"; throw err; }
  if (item.action === "repo.pr.label" && !["unsafe_to_merge", "manual_review_required"].includes(analysis.classification_v6)) { const err = new Error("Governance label requires an active unsafe/manual-review classification."); err.status = 409; err.code = "repository_label_evidence_failed"; throw err; }
  return analysis;
}

function advisoryCommentBodyV6({ planId, item, analysis }) {
  return [
    `<!-- mad4b-repository-governance-v6 plan:${planId} item:${item.plan_item_id} -->`,
    "## Governed repository advisory",
    "",
    `Classification: **${analysis.classification_v6}**`,
    `Reason: \`${analysis.reason_code_v6}\``,
    `Head SHA: \`${analysis.head_sha}\``,
    `Recommended action: \`${analysis.recommended_action_v6}\``,
    "",
    "This comment is generated from same-cycle, tenant-scoped, no-secret repository evidence. It does not merge, close, patch, or force-push.",
  ].join("\n");
}
async function dispatchRepositoryMutationV6({ repoRef, planId, item, current, token }) {
  const owner = encodeURIComponent(repoRef.owner);
  const repo = encodeURIComponent(repoRef.repo);
  const prNumber = Number(item.pr_number);
  if (item.action === "repo.pr.comment_advisory") {
    const body = advisoryCommentBodyV6({ planId, item, analysis: current.analysis });
    const result = await githubRequestV6("POST", `/repos/${owner}/${repo}/issues/${prNumber}/comments`, token, { body });
    return { provider_object_id: String(result.body?.id || ""), write: { action: item.action, comment_id: result.body?.id || null, body_sha256: hash(body) }, expected_readback: { comment_id: result.body?.id || null, marker: `plan:${planId} item:${item.plan_item_id}`, body_sha256: hash(body) } };
  }
  if (item.action === "repo.pr.label") {
    const labels = Array.isArray(item.labels) ? item.labels.filter(Boolean).slice(0, 10) : [];
    if (!labels.length) { const err = new Error("Label mutation plan has no governed labels."); err.status = 409; err.code = "repository_label_plan_empty"; throw err; }
    const result = await githubRequestV6("POST", `/repos/${owner}/${repo}/issues/${prNumber}/labels`, token, { labels });
    return { provider_object_id: String(prNumber), write: { action: item.action, labels }, expected_readback: { labels, returned_labels: (result.body || []).map((label) => label.name) } };
  }
  if (item.action === "repo.pr.close_superseded") {
    const result = await githubRequestV6("PATCH", `/repos/${owner}/${repo}/pulls/${prNumber}`, token, { state: "closed" });
    return { provider_object_id: String(prNumber), write: { action: item.action, state: result.body?.state || null }, expected_readback: { state: "closed", head_sha: item.head_sha } };
  }
  if (item.action === "repo.branch.fast_forward") {
    const branch = s(item.head_ref_name);
    const base = s(item.base_ref_name || current.defaultBranch);
    if (!branch || branch === current.defaultBranch || branch === base) { const err = new Error("Fast-forward target branch is missing or protected by default/base identity."); err.status = 409; err.code = "repository_fast_forward_branch_invalid"; throw err; }
    const protection = await githubGet(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`, token, { allowStatuses: [403, 404] });
    if (protection.status !== 404) { const err = new Error("Fast-forward requires a confirmed unprotected branch."); err.status = 409; err.code = protection.status === 200 ? "repository_fast_forward_protected_branch" : "repository_fast_forward_protection_unknown"; throw err; }
    const [headBranch, baseBranch] = await Promise.all([
      githubGet(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, token),
      githubGet(`/repos/${owner}/${repo}/branches/${encodeURIComponent(base)}`, token),
    ]);
    const headSha = s(headBranch.body?.commit?.sha);
    const baseSha = s(baseBranch.body?.commit?.sha);
    if (headSha !== item.head_sha || !baseSha) { const err = new Error("Fast-forward branch SHA changed or base SHA is unavailable."); err.status = 409; err.code = "repository_fast_forward_sha_mismatch"; throw err; }
    await githubRequestV6("PATCH", `/repos/${owner}/${repo}/git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, token, { sha: baseSha, force: false });
    return { provider_object_id: branch, write: { action: item.action, branch, from_sha: headSha, to_sha: baseSha, force: false }, expected_readback: { branch, sha: baseSha } };
  }
  if (item.action === "repo.pr.merge_ready") {
    const result = await githubRequestV6("PUT", `/repos/${owner}/${repo}/pulls/${prNumber}/merge`, token, { sha: item.head_sha, merge_method: "squash" });
    if (result.body?.merged !== true) { const err = new Error(result.body?.message || "GitHub did not confirm merge."); err.status = 409; err.code = "repository_merge_not_confirmed"; throw err; }
    return { provider_object_id: s(result.body?.sha), write: { action: item.action, merge_sha: result.body?.sha || null, merged: true }, expected_readback: { merged: true, merge_sha: result.body?.sha || null } };
  }
  const err = new Error(`Repository mutation adapter ${item.action} is not enabled.`); err.status = 409; err.code = "repository_mutation_adapter_not_enabled"; throw err;
}
async function readbackRepositoryMutationV6({ repoRef, item, expected, token }) {
  const owner = encodeURIComponent(repoRef.owner);
  const repo = encodeURIComponent(repoRef.repo);
  const prNumber = Number(item.pr_number);
  if (item.action === "repo.pr.comment_advisory") {
    const result = await githubGet(`/repos/${owner}/${repo}/issues/comments/${encodeURIComponent(expected.comment_id)}`, token);
    const body = s(result.body?.body);
    return { ok: body.includes(expected.marker) && hash(body) === expected.body_sha256, action: item.action, comment_id: result.body?.id || null, body_sha256: hash(body), marker_present: body.includes(expected.marker), secrets_included: false };
  }
  if (item.action === "repo.pr.label") {
    const result = await githubGet(`/repos/${owner}/${repo}/issues/${prNumber}`, token);
    const labels = (result.body?.labels || []).map((label) => typeof label === "string" ? label : label.name);
    return { ok: expected.labels.every((label) => labels.includes(label)), action: item.action, labels, secrets_included: false };
  }
  if (item.action === "repo.pr.close_superseded") {
    const result = await githubGet(`/repos/${owner}/${repo}/pulls/${prNumber}`, token);
    return { ok: result.body?.state === "closed" && s(result.body?.head?.sha) === expected.head_sha, action: item.action, state: result.body?.state || null, head_sha: result.body?.head?.sha || null, secrets_included: false };
  }
  if (item.action === "repo.branch.fast_forward") {
    const result = await githubGet(`/repos/${owner}/${repo}/branches/${encodeURIComponent(expected.branch)}`, token);
    return { ok: s(result.body?.commit?.sha) === expected.sha, action: item.action, branch: expected.branch, sha: result.body?.commit?.sha || null, force: false, secrets_included: false };
  }
  if (item.action === "repo.pr.merge_ready") {
    const result = await githubGet(`/repos/${owner}/${repo}/pulls/${prNumber}`, token);
    return { ok: result.body?.merged === true && (!expected.merge_sha || s(result.body?.merge_commit_sha) === s(expected.merge_sha)), action: item.action, merged: result.body?.merged === true, merge_sha: result.body?.merge_commit_sha || null, secrets_included: false };
  }
  return { ok: false, action: item.action, reason_code: "repository_mutation_readback_not_supported", secrets_included: false };
}
async function loadActiveMutationRecipeV6(recipeKey = "") {
  const [[recipe]] = await getPool().query(
    `SELECT recipe_key, status, risk_class, mode, read_only, requires_dry_run, requires_capability_envelope,
            requires_typed_confirmation, requires_same_cycle_readback, authority_requirement_key, policy_json
       FROM platform_resource_recipes WHERE recipe_key=? LIMIT 1`,
    [s(recipeKey)]
  );
  const valid = recipe && recipe.status === "active" && recipe.risk_class === "mutation" && recipe.mode === "apply"
    && Number(recipe.read_only) === 0 && Number(recipe.requires_dry_run) === 1
    && Number(recipe.requires_capability_envelope) === 1 && Number(recipe.requires_typed_confirmation) === 1
    && Number(recipe.requires_same_cycle_readback) === 1;
  if (!valid) { const err = new Error(`Repository mutation recipe ${recipeKey} is not active with all governed gates.`); err.status = 409; err.code = "repository_mutation_recipe_not_active"; err.details = recipe || null; throw err; }
  return { ...recipe, policy_json: safeJson(recipe.policy_json, {}) };
}

function mutationRunPublicV6(row = {}) {
  return {
    run_id: row.run_id,
    plan_id: row.plan_id,
    plan_item_id: row.plan_item_id,
    resource_uri: row.resource_uri,
    recipe_key: row.recipe_key,
    pr_number: row.pr_number ?? null,
    head_sha: row.head_sha || null,
    branch_name: row.branch_name || null,
    status: row.status,
    provider_object_id: row.provider_object_id || null,
    capability_envelope_id: row.capability_envelope_id || null,
    approval_hold_id: row.approval_hold_id || null,
    write: safeJson(row.write_json, null),
    expected_readback: safeJson(row.expected_readback_json, null),
    readback: safeJson(row.readback_json, null),
    error: safeJson(row.error_json, null),
    provider_write_started_at: row.provider_write_started_at || null,
    provider_write_completed_at: row.provider_write_completed_at || null,
    readback_completed_at: row.readback_completed_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

async function loadMutationRunV6(runId = "") {
  const [[row]] = await getPool().query(`SELECT * FROM repository_mutation_runs_v6 WHERE run_id=? LIMIT 1`, [s(runId)]);
  if (!row) { const err = new Error("Repository mutation run not found."); err.status = 404; err.code = "repository_mutation_run_not_found"; throw err; }
  return row;
}

async function writeMutationEvidenceV6({ row, runId, item, write = null, readback = null, status, error = null }) {
  const evidenceId = randomUUID();
  const request = { plan_id: row.plan_id, plan_item_id: item.plan_item_id, recipe_key: item.action, pr_number: item.pr_number || null, head_sha: item.head_sha || null, capability_envelope_id: row.capability_envelope_id || null, approval_hold_id: row.approval_hold_id || null, secrets_included: false };
  const response = { run_id: runId, status, provider_object_id: write?.provider_object_id || null, write: write?.write || null, readback, error: error ? { code: error.code || "repository_mutation_failed", message: error.message || String(error) } : null, secrets_included: false };
  await getPool().query(
    `INSERT INTO audit_payload_evidence
      (evidence_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, source_table, source_pk, evidence_type,
       request_preview, request_sha256, response_preview, response_sha256, metadata_json, redaction_status, secrets_included)
     VALUES (?, ?, ?, ?, 'tenant_repository_mutation_apply_v6', 'github_repo', ?, 'repository_mutation_runs_v6', ?,
             'tenant_repository_mutation_run_v6', ?, ?, ?, ?, ?, 'not_required', 0)`,
    [evidenceId, row.tenant_id || null, row.user_id || "tenant_repository_v6", row.user_id ? "user" : "tenant", row.resource_uri, runId,
      JSON.stringify(request), hash(request), JSON.stringify(response), hash(response),
      JSON.stringify({ recipe_key: item.action, plan_id: row.plan_id, plan_item_id: item.plan_item_id, status, readback_verified: readback?.ok === true, mutations_executed: Boolean(write), secrets_included: false })]
  );
  return { evidence_id: evidenceId, evidence_type: "tenant_repository_mutation_run_v6", secrets_included: false };
}
export async function tenantRepositoryMutationApplyV6(args = {}, { auth = {} } = {}) {
  const planId = s(args.plan_id);
  const planItemId = s(args.plan_item_id);
  if (!planId || !planItemId) { const err = new Error("plan_id and plan_item_id are required."); err.status = 400; err.code = "repository_mutation_plan_item_required"; throw err; }
  const { row, plan } = await loadMutationPlanV6(planId);
  assertMutationPlanScopeV6(row, auth);
  const item = (plan.items || []).find((candidate) => s(candidate.plan_item_id) === planItemId);
  if (!item) { const err = new Error("Repository mutation plan item not found."); err.status = 404; err.code = "repository_mutation_plan_item_not_found"; throw err; }
  if (mutationItemEvidenceHashV6(item) !== s(item.evidence_sha256)) { const err = new Error("Repository mutation plan item integrity check failed."); err.status = 409; err.code = "repository_mutation_plan_item_integrity_failed"; throw err; }
  const [[priorRun]] = await getPool().query(`SELECT * FROM repository_mutation_runs_v6 WHERE plan_id=? AND plan_item_id=? LIMIT 1`, [planId, planItemId]);
  if (priorRun) {
    const confirmed = ["write_confirmed", "readback_verified", "readback_failed"].includes(priorRun.status);
    return { ok: priorRun.status === "readback_verified", tool: "tenant_repository_mutation_apply_v6", classification: "repository_mutation_replay_blocked_existing_run", run: mutationRunPublicV6(priorRun), replay_blocked: true, mutations_executed: confirmed, provider_outcome_unknown: priorRun.status === "unknown_provider_outcome" || (priorRun.status === "dispatching" && Boolean(priorRun.provider_write_started_at)), secrets_included: false };
  }
  if (!["approval_required", "approved"].includes(row.status)) { const err = new Error(`Repository mutation plan status ${row.status} is not apply-eligible.`); err.status = 409; err.code = "repository_mutation_plan_status_not_apply_eligible"; throw err; }
  if (!item.adapter_implemented) { const err = new Error(`Repository mutation adapter ${item.action} is not enabled.`); err.status = 409; err.code = "repository_mutation_adapter_not_enabled"; throw err; }
  await loadActiveMutationRecipeV6(item.action);
  const repoRef = normalizeGithubRepoRef({ resource_uri: row.resource_uri });
  if (!repoRef) { const err = new Error("Repository mutation plan has an invalid resource URI."); err.status = 409; err.code = "repository_mutation_resource_invalid"; throw err; }
  const scope = { tenant_id: row.tenant_id || null, workspace_id: row.workspace_id || null, user_id: row.user_id || null, principal_type: row.user_id ? "user" : "tenant", validated: true };
  const authority = await resolveRepositoryAuthorityBindingV6({ scope, repoRef, recipeKey: item.action, mode: "apply" });
  if (!authority.ok) return { ok: false, tool: "tenant_repository_mutation_apply_v6", classification: "blocked_repository_mutation_authority", reason_code: authority.reason_code, required_permission: authority.required_permission || null, mutations_executed: false, secrets_included: false };
  const provider = await validateRepositoryProviderBindingV6({ binding: authority.binding, scope });
  if (!provider.ok) return { ok: false, tool: "tenant_repository_mutation_apply_v6", classification: "blocked_repository_provider_binding", reason_code: provider.reason_code, mutations_executed: false, secrets_included: false };
  const approval = await validateMutationApprovalV6({ row, item, args, auth });
  const [[prior]] = await getPool().query(`SELECT * FROM repository_mutation_runs_v6 WHERE plan_id=? AND plan_item_id=? LIMIT 1`, [planId, planItemId]);
  if (prior) return { ok: prior.status === "readback_verified", tool: "tenant_repository_mutation_apply_v6", classification: "repository_mutation_replay_blocked_existing_run", run: mutationRunPublicV6(prior), replay_blocked: true, mutations_executed: ["write_confirmed", "readback_verified", "readback_failed"].includes(prior.status), provider_outcome_unknown: prior.status === "unknown_provider_outcome" || (prior.status === "dispatching" && Boolean(prior.provider_write_started_at)), secrets_included: false };
  const token = await getGitHubAppInstallationToken({ action: provider.action || {} });
  const current = await reanalyzeMutationItemV6({ repoRef, item, token });
  assertSameCycleMutationEvidenceV6(item, current);
  const runId = randomUUID();
  const planRow = { ...row, capability_envelope_id: approval.envelope.envelope_id, approval_hold_id: approval.hold.hold_id };
  try {
    await getPool().query(
      `INSERT INTO repository_mutation_runs_v6
        (run_id, plan_id, plan_item_id, tenant_id, workspace_id, user_id, resource_uri, recipe_key, pr_number, head_sha,
         branch_name, binding_id, capability_envelope_id, approval_hold_id, status, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dispatching', 0)`,
      [runId, planId, planItemId, row.tenant_id, row.workspace_id, row.user_id, row.resource_uri, item.action, item.pr_number || null,
        item.head_sha || null, item.head_ref_name || null, authority.binding_id, approval.envelope.envelope_id, approval.hold.hold_id]
    );
  } catch (error) {
    if (String(error?.code || "").includes("DUP") || /duplicate/i.test(String(error?.message || ""))) {
      const [[existing]] = await getPool().query(`SELECT * FROM repository_mutation_runs_v6 WHERE plan_id=? AND plan_item_id=? LIMIT 1`, [planId, planItemId]);
      return { ok: existing?.status === "readback_verified", tool: "tenant_repository_mutation_apply_v6", classification: "repository_mutation_replay_blocked_existing_run", run: mutationRunPublicV6(existing || {}), replay_blocked: true, mutations_executed: ["write_confirmed", "readback_verified", "readback_failed"].includes(existing?.status), provider_outcome_unknown: existing?.status === "unknown_provider_outcome" || (existing?.status === "dispatching" && Boolean(existing?.provider_write_started_at)), secrets_included: false };
    }
    throw error;
  }
  let phase = "prewrite";
  let dispatched = null;
  try {
    await markCapabilityEnvelopeReferenced({ envelopeId: approval.envelope.envelope_id, executionRef: runId });
    await getPool().query(`UPDATE repository_mutation_plans_v6 SET status='dispatching', capability_envelope_id=?, approval_hold_id=?, updated_at=NOW() WHERE plan_id=?`, [approval.envelope.envelope_id, approval.hold.hold_id, planId]);
    await getPool().query(`UPDATE repository_mutation_runs_v6 SET provider_write_started_at=NOW(), updated_at=NOW() WHERE run_id=?`, [runId]);
    phase = "provider_write";
    dispatched = await dispatchRepositoryMutationV6({ repoRef, planId, item, current, token });
    await getPool().query(
      `UPDATE repository_mutation_runs_v6 SET status='write_confirmed', provider_object_id=?, write_json=?, expected_readback_json=?, provider_write_completed_at=NOW(), updated_at=NOW() WHERE run_id=?`,
      [dispatched.provider_object_id || null, JSON.stringify(dispatched.write || {}), JSON.stringify(dispatched.expected_readback || {}), runId]
    );
    phase = "readback";
    const readback = await readbackRepositoryMutationV6({ repoRef, item, expected: dispatched.expected_readback || {}, token });
    const finalStatus = readback.ok ? "readback_verified" : "readback_failed";
    await getPool().query(`UPDATE repository_mutation_runs_v6 SET status=?, readback_json=?, readback_completed_at=NOW(), updated_at=NOW() WHERE run_id=?`, [finalStatus, JSON.stringify(readback), runId]);
    await getPool().query(`UPDATE repository_mutation_plans_v6 SET status=?, updated_at=NOW() WHERE plan_id=?`, [finalStatus, planId]);
    if (readback.ok) await getPool().query(`UPDATE capability_resolution_envelope_ledger SET execution_status='executed', execution_ref=?, updated_at=NOW() WHERE envelope_id=? AND execution_status IN ('not_executed','referenced')`, [runId, approval.envelope.envelope_id]);
    const evidence = await writeMutationEvidenceV6({ row: planRow, runId, item, write: dispatched, readback, status: finalStatus });
    const run = await loadMutationRunV6(runId);
    return { ok: readback.ok, tool: "tenant_repository_mutation_apply_v6", classification: readback.ok ? "repository_mutation_applied_and_verified" : "repository_mutation_readback_failed", run: mutationRunPublicV6(run), evidence, replay_blocked: false, mutations_executed: true, secrets_included: false };
  } catch (error) {
    const failureStatus = phase === "prewrite" ? "failed_prewrite" : phase === "provider_write" ? "unknown_provider_outcome" : "readback_failed";
    const errorPayload = { code: error?.code || "repository_mutation_apply_failed", message: error?.message || String(error), phase, secrets_included: false };
    await getPool().query(`UPDATE repository_mutation_runs_v6 SET status=?, error_json=?, updated_at=NOW() WHERE run_id=?`, [failureStatus, JSON.stringify(errorPayload), runId]);
    await getPool().query(`UPDATE repository_mutation_plans_v6 SET status=?, updated_at=NOW() WHERE plan_id=?`, [failureStatus, planId]);
    const evidence = await writeMutationEvidenceV6({ row: planRow, runId, item, write: dispatched, status: failureStatus, error });
    error.details = { ...(error.details || {}), run_id: runId, plan_id: planId, plan_item_id: planItemId, failure_status: failureStatus, evidence, replay_blocked: true, secrets_included: false };
    throw error;
  }
}
async function recoverRepositoryMutationReadbackV6({ repoRef, run, item, token }) {
  const owner = encodeURIComponent(repoRef.owner);
  const repo = encodeURIComponent(repoRef.repo);
  const prNumber = Number(item.pr_number);
  if (item.action === "repo.pr.comment_advisory") {
    const marker = `plan:${run.plan_id} item:${run.plan_item_id}`;
    const result = await githubGet(`/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`, token);
    const comments = Array.isArray(result.body) ? result.body : [];
    const match = comments.find((comment) => s(comment.body).includes(marker));
    return { ok: Boolean(match), action: item.action, comment_id: match?.id || null, marker_present: Boolean(match), search_complete: !result.link.includes('rel="next"'), recovered_from_unknown_outcome: true, secrets_included: false };
  }
  if (item.action === "repo.pr.label") {
    return readbackRepositoryMutationV6({ repoRef, item, expected: { labels: Array.isArray(item.labels) ? item.labels : [] }, token });
  }
  if (item.action === "repo.pr.close_superseded") {
    return readbackRepositoryMutationV6({ repoRef, item, expected: { state: "closed", head_sha: item.head_sha }, token });
  }
  if (item.action === "repo.pr.merge_ready") {
    return readbackRepositoryMutationV6({ repoRef, item, expected: { merged: true, merge_sha: null }, token });
  }
  if (item.action === "repo.branch.fast_forward") {
    const branch = s(item.head_ref_name);
    const base = s(item.base_ref_name);
    if (!branch || !base) return { ok: false, action: item.action, reason_code: "repository_fast_forward_readback_refs_missing", recovered_from_unknown_outcome: false, secrets_included: false };
    const [branchResult, baseResult] = await Promise.all([
      githubGet(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, token),
      githubGet(`/repos/${owner}/${repo}/branches/${encodeURIComponent(base)}`, token),
    ]);
    const branchSha = s(branchResult.body?.commit?.sha);
    const baseSha = s(baseResult.body?.commit?.sha);
    return { ok: Boolean(branchSha && baseSha && branchSha === baseSha && branchSha !== item.head_sha), action: item.action, branch, branch_sha: branchSha, base, base_sha: baseSha, force: false, inferred_from_current_refs: true, recovered_from_unknown_outcome: true, secrets_included: false };
  }
  return { ok: false, action: item.action, reason_code: "repository_mutation_unknown_outcome_readback_not_supported", recovered_from_unknown_outcome: false, secrets_included: false };
}

export async function tenantRepositoryMutationReadbackV6(args = {}, { auth = {} } = {}) {
  const runId = s(args.run_id);
  if (!runId) { const err = new Error("run_id is required."); err.status = 400; err.code = "repository_mutation_run_id_required"; throw err; }
  const run = await loadMutationRunV6(runId);
  const { row, plan } = await loadMutationPlanV6(run.plan_id, { allowExpired: true });
  assertMutationPlanScopeV6(row, auth);
  const item = (plan.items || []).find((candidate) => s(candidate.plan_item_id) === s(run.plan_item_id));
  if (!item) { const err = new Error("Repository mutation plan item is unavailable for readback."); err.status = 409; err.code = "repository_mutation_readback_plan_item_missing"; throw err; }
  if (run.status === "readback_verified") return { ok: true, tool: "tenant_repository_mutation_readback_v6", classification: "repository_mutation_readback_already_verified", run: mutationRunPublicV6(run), provider_calls_made: 0, mutations_executed: false, secrets_included: false };
  if (run.status === "failed_prewrite" || (run.status === "dispatching" && !run.provider_write_started_at)) return { ok: false, tool: "tenant_repository_mutation_readback_v6", classification: "repository_mutation_no_provider_write_to_read_back", run: mutationRunPublicV6(run), provider_calls_made: 0, mutations_executed: false, secrets_included: false };
  const [[binding]] = await getPool().query(`SELECT * FROM platform_resource_authority_bindings WHERE binding_id=? AND status='active' AND (expires_at IS NULL OR expires_at>NOW()) LIMIT 1`, [run.binding_id]);
  if (!binding) { const err = new Error("Repository mutation authority binding is unavailable for readback."); err.status = 409; err.code = "repository_mutation_readback_binding_missing"; throw err; }
  const scope = { tenant_id: row.tenant_id || null, workspace_id: row.workspace_id || null, user_id: row.user_id || null, principal_type: row.user_id ? "user" : "tenant", validated: true };
  if (binding.tenant_id !== scope.tenant_id || s(binding.workspace_id) !== s(scope.workspace_id) || s(binding.user_id) !== s(scope.user_id) || binding.resource_uri !== row.resource_uri || binding.recipe_key !== item.action) { const err = new Error("Repository mutation readback binding no longer matches the plan scope and action."); err.status = 403; err.code = "repository_mutation_readback_binding_mismatch"; throw err; }
  const provider = await validateRepositoryProviderBindingV6({ binding, scope });
  if (!provider.ok) { const err = new Error("Repository provider binding failed readback validation."); err.status = 409; err.code = provider.reason_code || "repository_mutation_readback_provider_invalid"; throw err; }
  const repoRef = normalizeGithubRepoRef({ resource_uri: row.resource_uri });
  const token = await getGitHubAppInstallationToken({ action: provider.action || {} });
  const expected = safeJson(run.expected_readback_json, null);
  const readback = expected && Object.keys(expected).length
    ? await readbackRepositoryMutationV6({ repoRef, item, expected, token })
    : await recoverRepositoryMutationReadbackV6({ repoRef, run, item, token });
  const finalStatus = readback.ok ? "readback_verified" : "readback_failed";
  await getPool().query(`UPDATE repository_mutation_runs_v6 SET status=?, readback_json=?, readback_completed_at=NOW(), updated_at=NOW() WHERE run_id=?`, [finalStatus, JSON.stringify(readback), runId]);
  await getPool().query(`UPDATE repository_mutation_plans_v6 SET status=?, updated_at=NOW() WHERE plan_id=?`, [finalStatus, run.plan_id]);
  if (readback.ok) await getPool().query(`UPDATE capability_resolution_envelope_ledger SET execution_status='executed', execution_ref=?, updated_at=NOW() WHERE envelope_id=? AND execution_status IN ('not_executed','referenced')`, [runId, run.capability_envelope_id]);
  const evidence = await writeMutationEvidenceV6({ row: { ...row, capability_envelope_id: run.capability_envelope_id, approval_hold_id: run.approval_hold_id }, runId, item, write: run.write_json ? { provider_object_id: run.provider_object_id, write: safeJson(run.write_json, {}) } : null, readback, status: finalStatus });
  const updated = await loadMutationRunV6(runId);
  return { ok: readback.ok, tool: "tenant_repository_mutation_readback_v6", classification: readback.ok ? "repository_mutation_readback_verified" : "repository_mutation_readback_unverified", run: mutationRunPublicV6(updated), evidence, provider_calls_made: 1, mutations_executed: false, secrets_included: false };
}
async function findRepositoryGovernanceV6ReadinessBinding(repoRef, { pool = getPool() } = {}) {
  if (!repoRef?.resource_uri) return null;
  const [rows] = await pool.query(
    `SELECT *
       FROM platform_resource_authority_bindings
      WHERE status = 'active'
        AND resource_type = 'github_repo'
        AND BINARY resource_uri = BINARY ?
        AND (recipe_key = ? OR recipe_key IS NULL)
        AND permission_level = 'read_only'
        AND tenant_id IS NOT NULL
        AND user_id IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (
          source_system_id IS NOT NULL
          OR source_installation_id IS NOT NULL
          OR LOWER(authority_source) IN ('admin_grant', 'platform_managed', 'system_seed')
        )
      ORDER BY (created_by NOT LIKE 'system:%readiness_smoke%') DESC,
               (source_system_id IS NOT NULL OR source_installation_id IS NOT NULL) DESC,
               updated_at DESC,
               created_at DESC
      LIMIT 1`,
    [repoRef.resource_uri, REPOSITORY_PR_RECONCILE_RECIPE_KEY]
  );
  return rows?.[0] || null;
}

export async function tenantRepositoryGovernanceV6ReadinessSmoke(args = {}, { auth = {}, runGovernedResource, readinessRunGovernedResource } = {}) {
  const repoRef=normalizeGithubRepoRef(args)||normalizeGithubRepoRef({owner:'mad4bdigital-ai',repo:'multi-business-multi-role-growth-intelligence-os'});
  const providerBinding=await findUsableRepositoryProviderBinding(repoRef);
  if(!providerBinding) return {ok:false,tool:'tenant_repository_governance_v6_readiness_smoke',status:'authorization_gated',classification:'repository_governance_v6_authorization_gated',reason_code:'repository_provider_binding_required',checks:[{name:'provider_binding_required',pass:true},{name:'no_mutation',pass:true},{name:'no_secrets',pass:true}],apply_allowed:false,mutations_executed:false,secrets_included:false};
  const tenantId=providerBinding.tenant_id,workspaceId=providerBinding.workspace_id||null;
  const report=await tenantRepositoryIntelligenceV6Report({tenant_id:tenantId,workspace_id:workspaceId,owner:repoRef.owner,repo:repoRef.repo,limit:1,equivalence_file_limit:1,record_evidence:true},{auth:{...auth,is_admin:true},runGovernedResource});
  const [[commentRecipe]]=await getPool().query(`SELECT status,risk_class,mode,read_only,requires_capability_envelope,requires_typed_confirmation,requires_same_cycle_readback FROM platform_resource_recipes WHERE recipe_key='repo.pr.comment_advisory' LIMIT 1`);let plannedMutationBlocked=false;try{await loadActiveMutationRecipeV6('repo.pr.label')}catch(error){plannedMutationBlocked=error?.code==='repository_mutation_recipe_not_active'}const [[tableCount]]=await getPool().query(`SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('repository_mutation_plans_v6','repository_mutation_runs_v6')`);const descriptorNames=TENANT_REPOSITORY_GOVERNANCE_V6_SYSTEM_TOOLS.map((tool)=>tool.name);const checks=[{name:'scope_hierarchy_validated',pass:report?.report?.scope?.validated===true},{name:'provider_binding_validated',pass:report?.report?.provider?.ok===true},{name:'deep_pr_evidence_present',pass:Array.isArray(report?.report?.pull_requests)},{name:'provider_bound_authority_present',pass:Boolean(providerBinding.source_system_id||providerBinding.source_installation_id)},{name:'comment_recipe_active_and_gated',pass:commentRecipe?.status==='active'&&commentRecipe?.risk_class==='mutation'&&commentRecipe?.mode==='apply'&&Number(commentRecipe?.read_only)===0&&Number(commentRecipe?.requires_capability_envelope)===1&&Number(commentRecipe?.requires_typed_confirmation)===1&&Number(commentRecipe?.requires_same_cycle_readback)===1},{name:'planned_mutation_fails_closed',pass:plannedMutationBlocked},{name:'plan_and_run_ledgers_present',pass:Number(tableCount?.c||0)===2},{name:'six_descriptor_tools_present',pass:descriptorNames.length===6&&descriptorNames.includes('tenant_repository_mutation_apply_v6')&&descriptorNames.includes('tenant_repository_mutation_readback_v6')},{name:'no_mutation',pass:report?.mutations_executed===false},{name:'no_secrets',pass:report?.secrets_included===false}];const ok=checks.every((item)=>item.pass);return {ok,tool:'tenant_repository_governance_v6_readiness_smoke',status:ok?'pass':'fail',classification:ok?'repository_governance_v6_ready':'repository_governance_v6_not_ready',checks,descriptor_tools:descriptorNames,binding_id:providerBinding.binding_id,apply_allowed:false,mutations_executed:false,secrets_included:false};
}

export const TENANT_REPOSITORY_GOVERNANCE_V6_SYSTEM_TOOLS = [
  {
    name: "tenant_repository_intelligence_v6_report",
    handler_name: "tenantRepositoryIntelligenceV6Report",
    description: "Tenant-scoped deep GitHub PR reconciliation with exact-head CI, branch overlap, main parity, migration replacement analysis, provider binding validation, and no mutations.",
    requires_admin: false,
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, tenant_id: { type: "string" }, workspace_id: { type: "string" }, user_id: { type: "string" }, state: { type: "string", default: "open" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }, equivalence_file_limit: { type: "integer", minimum: 0, maximum: 50, default: 20 }, record_evidence: { type: "boolean", default: true } }, required: [] }
  },
  {
    name: "tenant_repository_mutation_plan_v6",
    handler_name: "tenantRepositoryMutationPlanV6",
    description: "Creates governed non-executed repository mutation plans. Every item binds exact target evidence and requires action-specific authority, capability envelope, approval, typed confirmation, and same-cycle readback.",
    requires_admin: false,
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, tenant_id: { type: "string" }, workspace_id: { type: "string" }, user_id: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }, report: { type: "object" } }, required: [] }
  },
  {
    name: "platform_repository_mutation_authority_binding_create_v6",
    handler_name: "createRepositoryMutationAuthorityBindingV6",
    description: "Admin-only action-specific repository mutation authority binding creation with active-recipe and tenant GitHub provider-installation validation.",
    requires_admin: true,
    inputSchema: { type: "object", properties: { tenant_id: { type: "string" }, workspace_id: { type: "string" }, user_id: { type: "string" }, owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, recipe_key: { type: "string", enum: ["repo.pr.comment_advisory", "repo.pr.label", "repo.pr.close_superseded", "repo.branch.fast_forward", "repo.branch.rebuild_fresh", "repo.file.patch_apply", "repo.pr.merge_ready"] }, permission_level: { type: "string", enum: ["comment", "label", "close", "patch", "merge", "admin"] }, authority_source: { type: "string" }, source_system_id: { type: "string" }, source_installation_id: { type: "string" }, expires_at: { type: "string" }, notes: { type: "string" } }, required: ["tenant_id", "recipe_key"] }
  },
  {
    name: "tenant_repository_mutation_apply_v6",
    handler_name: "tenantRepositoryMutationApplyV6",
    description: "Applies exactly one active repository mutation plan item after scope, authority, capability, approval, typed-confirmation, unchanged-SHA, same-cycle evidence, replay, audit, and readback gates.",
    requires_admin: false,
    inputSchema: { type: "object", properties: { plan_id: { type: "string" }, plan_item_id: { type: "string" }, capability_envelope_id: { type: "string" }, approval_hold_id: { type: "string" }, typed_confirmation: { type: "string" } }, required: ["plan_id", "plan_item_id", "capability_envelope_id", "approval_hold_id", "typed_confirmation"] }
  },
  {
    name: "tenant_repository_mutation_readback_v6",
    handler_name: "tenantRepositoryMutationReadbackV6",
    description: "Verifies an existing repository mutation run without replaying the provider write, including unknown-provider-outcome recovery where bounded evidence exists.",
    requires_admin: false,
    inputSchema: { type: "object", properties: { run_id: { type: "string" } }, required: ["run_id"] }
  },
  {
    name: "tenant_repository_governance_v6_readiness_smoke",
    handler_name: "tenantRepositoryGovernanceV6ReadinessSmoke",
    description: "Admin-only no-secret V6 readiness smoke covering scope, provider binding, deep evidence, recipe gates, replay ledger, and no-write defaults.",
    requires_admin: true,
    inputSchema: { type: "object", properties: { tenant_id: { type: "string" }, owner: { type: "string" }, repo: { type: "string" } }, required: [] }
  }
];