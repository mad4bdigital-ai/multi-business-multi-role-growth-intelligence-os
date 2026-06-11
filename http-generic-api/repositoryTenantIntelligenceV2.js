import { createHash, randomUUID } from "node:crypto";

import { getPool } from "./db.js";

export const REPOSITORY_PR_RECONCILE_RECIPE_KEY = "repo.pr.reconciliation_sweep";
export const GITHUB_REPO_RESOURCE_TYPE = "github_repo";

function asString(value) { return String(value || "").trim(); }
function boolOption(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}
function clampLimit(value, fallback = 20, max = 50) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}
function sha256Hex(value = "") { return createHash("sha256").update(String(value)).digest("hex"); }
function safeJson(value, fallback = null) { try { return value && typeof value === "string" ? JSON.parse(value) : (value ?? fallback); } catch { return fallback; } }
function previewJson(value = {}, maxChars = 12000) { const out = JSON.stringify(value || {}, null, 2); return out.length > maxChars ? out.slice(0, maxChars) : out; }

export function normalizeGithubRepoRef(args = {}) {
  const resourceRef = args.resource_ref && typeof args.resource_ref === "object" ? args.resource_ref : {};
  const owner = asString(args.owner || resourceRef.owner);
  const repo = asString(args.repo || resourceRef.repo).replace(/\.git$/i, "");
  if (owner && repo) return { owner, repo, resource_type: GITHUB_REPO_RESOURCE_TYPE, resource_uri: `github://${owner}/${repo}`, resource_ref: { owner, repo } };
  const uri = asString(args.resource_uri || resourceRef.resource_uri || args.input || args.url);
  const urlMatch = uri.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/i, ""), resource_type: GITHUB_REPO_RESOURCE_TYPE, resource_uri: `github://${urlMatch[1]}/${urlMatch[2].replace(/\.git$/i, "")}`, resource_ref: { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/i, "") } };
  const schemeMatch = uri.match(/^github:\/\/([^/]+)\/([^/]+)$/i);
  if (schemeMatch) return { owner: schemeMatch[1], repo: schemeMatch[2], resource_type: GITHUB_REPO_RESOURCE_TYPE, resource_uri: `github://${schemeMatch[1]}/${schemeMatch[2]}`, resource_ref: { owner: schemeMatch[1], repo: schemeMatch[2] } };
  return null;
}

function isAdminPrincipal(auth = {}) { return auth?.is_admin === true; }
function principalScope(args = {}, auth = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  return {
    tenant_id: (isAdminPrincipal(auth) ? asString(args.tenant_id || options.tenant_id) : asString(auth.tenant_id || args.tenant_id || options.tenant_id)) || null,
    workspace_id: asString(args.workspace_id || options.workspace_id) || null,
    user_id: (isAdminPrincipal(auth) ? asString(args.user_id || options.user_id) : asString(auth.user_id || args.user_id || options.user_id)) || null,
  };
}
function requireScope(scope = {}) {
  if (!scope.tenant_id && !scope.workspace_id && !scope.user_id) {
    const err = new Error("Repository authority operations require tenant_id, workspace_id, or user_id scope.");
    err.status = 400; err.code = "repository_authority_scope_required"; throw err;
  }
}
async function assertReadOnlyRepositoryRecipe(recipeKey = REPOSITORY_PR_RECONCILE_RECIPE_KEY) {
  const [rows] = await getPool().query(
    `SELECT recipe_key, status, read_only, risk_class FROM platform_resource_recipes WHERE recipe_key = ? LIMIT 1`,
    [recipeKey]
  );
  const row = rows[0];
  if (!row || row.status !== "active" || Number(row.read_only) !== 1 || String(row.risk_class) !== "diagnostic") {
    const err = new Error(`Repository recipe ${recipeKey} is not an active read-only diagnostic recipe.`);
    err.status = 409; err.code = "repository_recipe_not_read_only_active"; err.details = row || null; throw err;
  }
  return row;
}
function bindingRowToObject(row = {}) {
  return {
    binding_id: row.binding_id,
    tenant_id: row.tenant_id || null,
    workspace_id: row.workspace_id || null,
    user_id: row.user_id || null,
    resource_type: row.resource_type,
    resource_uri: row.resource_uri,
    resource_ref: safeJson(row.resource_ref_json, null),
    recipe_key: row.recipe_key || null,
    permission_level: row.permission_level,
    allowed_modes: safeJson(row.allowed_modes_json, []),
    authority_source: row.authority_source,
    expires_at: row.expires_at || null,
    status: row.status,
    notes: row.notes || null,
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

export async function createRepositoryAuthorityBinding(args = {}, { auth } = {}) {
  const repoRef = normalizeGithubRepoRef(args);
  if (!repoRef) { const err = new Error("A GitHub repository owner/repo or github://owner/repo resource_uri is required."); err.status = 400; err.code = "github_repo_ref_required"; throw err; }
  const recipeKey = asString(args.recipe_key || REPOSITORY_PR_RECONCILE_RECIPE_KEY);
  if (recipeKey !== REPOSITORY_PR_RECONCILE_RECIPE_KEY) { const err = new Error("V2 only supports repo.pr.reconciliation_sweep bindings."); err.status = 400; err.code = "unsupported_repository_recipe_binding"; throw err; }
  await assertReadOnlyRepositoryRecipe(recipeKey);
  const scope = principalScope(args, auth); requireScope(scope);
  if (asString(args.permission_level || "read_only") !== "read_only") { const err = new Error("V2 repository authority bindings only allow read_only permission_level."); err.status = 400; err.code = "repository_binding_read_only_required"; throw err; }
  const allowedModes = Array.isArray(args.allowed_modes) ? args.allowed_modes : ["read_only"];
  if (allowedModes.some((mode) => asString(mode) !== "read_only")) { const err = new Error("V2 repository authority bindings only allow read_only mode."); err.status = 400; err.code = "repository_binding_mode_read_only_required"; throw err; }

  const pool = getPool();
  const [existingRows] = await pool.query(
    `SELECT * FROM platform_resource_authority_bindings
      WHERE status = 'active' AND resource_type = ? AND resource_uri = ? AND recipe_key = ? AND permission_level = 'read_only'
        AND COALESCE(tenant_id, '') = COALESCE(?, '') AND COALESCE(workspace_id, '') = COALESCE(?, '') AND COALESCE(user_id, '') = COALESCE(?, '')
      ORDER BY created_at DESC LIMIT 1`,
    [GITHUB_REPO_RESOURCE_TYPE, repoRef.resource_uri, recipeKey, scope.tenant_id, scope.workspace_id, scope.user_id]
  );
  if (existingRows.length) return { ok: true, tool: "platform_resource_authority_binding_create", classification: "repository_authority_binding_already_active", binding: bindingRowToObject(existingRows[0]), created: false, provider_calls_made: 0, secrets_included: false };

  const bindingId = randomUUID();
  await pool.query(
    `INSERT INTO platform_resource_authority_bindings
       (binding_id, tenant_id, workspace_id, user_id, resource_type, resource_uri, resource_ref_json, recipe_key, permission_level, allowed_modes_json, authority_source, expires_at, status, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'read_only', ?, ?, ?, 'active', ?, ?)`,
    [bindingId, scope.tenant_id, scope.workspace_id, scope.user_id, GITHUB_REPO_RESOURCE_TYPE, repoRef.resource_uri, JSON.stringify(repoRef.resource_ref), recipeKey, JSON.stringify(["read_only"]), asString(args.authority_source || "admin_grant"), args.expires_at || null, asString(args.notes || "tenant_repository_intelligence_v2_read_only_binding"), asString(args.created_by || auth?.user_id || "system:tenant_repository_intelligence_v2")]
  );
  const [readbackRows] = await pool.query(`SELECT * FROM platform_resource_authority_bindings WHERE binding_id = ? LIMIT 1`, [bindingId]);
  return { ok: true, tool: "platform_resource_authority_binding_create", classification: "repository_authority_binding_created", binding: bindingRowToObject(readbackRows[0]), created: true, provider_calls_made: 0, secrets_included: false };
}

export async function listRepositoryAuthorityBindings(args = {}, { auth } = {}) {
  const scope = principalScope(args, auth);
  const repoRef = normalizeGithubRepoRef(args);
  const conditions = ["1=1"];
  const params = [];
  for (const [key, column] of [["status", "status"], ["recipe_key", "recipe_key"]]) {
    if (asString(args[key])) { conditions.push(`${column} = ?`); params.push(asString(args[key])); }
  }
  if (repoRef?.resource_uri) { conditions.push("resource_uri = ?"); params.push(repoRef.resource_uri); }
  if (scope.tenant_id) { conditions.push("tenant_id = ?"); params.push(scope.tenant_id); }
  if (scope.workspace_id) { conditions.push("workspace_id = ?"); params.push(scope.workspace_id); }
  if (scope.user_id) { conditions.push("user_id = ?"); params.push(scope.user_id); }
  const limit = clampLimit(args.limit, 50, 200); params.push(limit);
  const [rows] = await getPool().query(`SELECT * FROM platform_resource_authority_bindings WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC, created_at DESC LIMIT ?`, params);
  return { ok: true, tool: "platform_resource_authority_binding_list", count: rows.length, bindings: rows.map(bindingRowToObject), provider_calls_made: 0, secrets_included: false };
}

export async function revokeRepositoryAuthorityBinding(args = {}, { auth } = {}) {
  const bindingId = asString(args.binding_id);
  if (!bindingId) { const err = new Error("binding_id is required."); err.status = 400; err.code = "binding_id_required"; throw err; }
  const [beforeRows] = await getPool().query(`SELECT * FROM platform_resource_authority_bindings WHERE binding_id = ? LIMIT 1`, [bindingId]);
  if (!beforeRows.length) { const err = new Error(`Binding ${bindingId} not found.`); err.status = 404; err.code = "repository_authority_binding_not_found"; throw err; }
  await getPool().query(`UPDATE platform_resource_authority_bindings SET status = 'revoked', notes = CONCAT(COALESCE(notes, ''), ?), updated_at = CURRENT_TIMESTAMP WHERE binding_id = ?`, [`\nrevoked_by=${asString(args.revoked_by || auth?.user_id || "system:tenant_repository_intelligence_v2")}`, bindingId]);
  const [afterRows] = await getPool().query(`SELECT * FROM platform_resource_authority_bindings WHERE binding_id = ? LIMIT 1`, [bindingId]);
  return { ok: true, tool: "platform_resource_authority_binding_revoke", classification: "repository_authority_binding_revoked", before: bindingRowToObject(beforeRows[0]), binding: bindingRowToObject(afterRows[0]), provider_calls_made: 0, secrets_included: false };
}

function changedFiles(pr = {}) {
  if (Array.isArray(pr.changed_files)) return pr.changed_files;
  if (Array.isArray(pr.evidence?.changed_files)) return pr.evidence.changed_files;
  return [];
}
function checkRuns(pr = {}) {
  if (Array.isArray(pr.check_runs)) return pr.check_runs;
  if (Array.isArray(pr.evidence?.check_runs)) return pr.evidence.check_runs;
  return [];
}
function hasOnlyDocsAgentFiles(files = []) { return files.length > 0 && files.every((file) => String(file.filename || "").startsWith("docs/auto-docs-agent/")); }
function migrationNumbers(files = []) { return files.map((file) => String(file.filename || "").match(/migrations\/(\d+)_.*\.sql$/)?.[1]).filter(Boolean); }
function duplicateValues(values = []) { const seen = new Set(); const dupes = new Set(); for (const value of values) { if (seen.has(value)) dupes.add(value); seen.add(value); } return [...dupes]; }

export function classifyRepositoryPullRequestV2(pr = {}) {
  const files = changedFiles(pr);
  const checks = checkRuns(pr);
  const nums = migrationNumbers(files);
  const duplicateMigrationNumbers = duplicateValues(nums);
  const failedChecks = checks.filter((check) => ["failure", "cancelled", "timed_out", "action_required"].includes(String(check.conclusion || "")));
  const pendingChecks = checks.filter((check) => !check.conclusion || ["queued", "in_progress", "waiting", "pending"].includes(String(check.status || "")));
  const successfulChecks = checks.length > 0 && failedChecks.length === 0 && pendingChecks.length === 0 && checks.every((check) => ["success", "neutral", "skipped"].includes(String(check.conclusion || "")));
  const headRef = asString(pr.head?.ref || pr.head_ref_name || "");
  const mergeStateStatus = asString(pr.merge_state_status || "");
  const classifications = [];
  const reasons = [];
  if (pr.draft) { classifications.push("manual_review_required"); reasons.push("draft_pull_request"); }
  if (headRef.startsWith("docs-agent/") || /^Docs agent:/i.test(asString(pr.title)) || hasOnlyDocsAgentFiles(files)) { classifications.push("stale_docs_agent_only"); reasons.push("docs_agent_signal"); }
  if (duplicateMigrationNumbers.length) { classifications.push("duplicate_migration_conflict"); reasons.push(`duplicate_migration_numbers:${duplicateMigrationNumbers.join(",")}`); }
  if (nums.length && files.some((file) => String(file.filename || "").includes("sprint68"))) { classifications.push("migration_number_conflict"); reasons.push("migration_files_require_number_collision_review"); }
  if (mergeStateStatus === "behind") { classifications.push("behind_only"); reasons.push("github_merge_state_behind"); }
  if (["dirty", "blocked", "unknown"].includes(mergeStateStatus)) { classifications.push("manual_review_required"); reasons.push(`github_merge_state_${mergeStateStatus}`); }
  if (failedChecks.length) { classifications.push("unsafe_to_merge"); reasons.push("failed_or_cancelled_checks"); }
  if (checks.length === 0 || pendingChecks.length) { classifications.push("clean_but_ci_missing"); reasons.push(checks.length === 0 ? "no_status_checks_visible" : "pending_status_checks"); }
  if (successfulChecks && !classifications.includes("manual_review_required") && !classifications.includes("unsafe_to_merge") && !classifications.includes("duplicate_migration_conflict") && mergeStateStatus !== "behind") { classifications.push("merge_ready"); reasons.push("checks_successful_read_only_signal"); }
  if (!classifications.length) { classifications.push("manual_review_required"); reasons.push("insufficient_deep_signal"); }
  const primary = classifications.includes("unsafe_to_merge") ? "unsafe_to_merge" : classifications.includes("duplicate_migration_conflict") ? "duplicate_migration_conflict" : classifications.includes("stale_docs_agent_only") ? "stale_docs_agent_only" : classifications[0];
  return {
    classification_v2: primary,
    classifications_v2: [...new Set(classifications)],
    reasons_v2: [...new Set(reasons)],
    deep_signals: {
      docs_agent_branch: headRef.startsWith("docs-agent/"), docs_agent_only_files: hasOnlyDocsAgentFiles(files), migration_file_count: nums.length,
      duplicate_migration_numbers: duplicateMigrationNumbers, check_run_count: checks.length, failed_check_count: failedChecks.length,
      pending_check_count: pendingChecks.length, merge_state_status: mergeStateStatus || null, branch_reconcile_signal: mergeStateStatus || null,
      admin_branch_reconcile_mode: "not_called_from_tenant_runtime", mutations_allowed: false, secrets_included: false,
    },
    recommended_action_v2: primary === "merge_ready" ? "review_and_merge_manually_if_policy_allows" : primary === "clean_but_ci_missing" ? "run_or_wait_for_ci" : primary === "stale_docs_agent_only" ? "review_docs_agent_backlog_or_close_manually" : primary === "duplicate_migration_conflict" || primary === "migration_number_conflict" ? "manual_migration_conflict_review" : "manual_review_required",
    secrets_included: false,
  };
}
function summarizeClassifications(prs = []) { const counts = {}; for (const pr of prs) { const key = pr.classification_v2 || pr.classification || "unknown"; counts[key] = (counts[key] || 0) + 1; } return counts; }

async function recordTenantRepositoryEvidence({ args = {}, scope = {}, repoRef = {}, runResult = {}, enhancedPullRequests = [] } = {}) {
  const evidenceId = randomUUID();
  const metadata = { schema_version: "tenant_repository_pr_reconciliation_evidence.v2", engine: "governed_repository_intelligence_engine", engine_version: "v2_read_only_tenant_scoped", recipe_key: REPOSITORY_PR_RECONCILE_RECIPE_KEY, resource_uri: repoRef.resource_uri, tenant_scope_present: Boolean(scope.tenant_id), workspace_scope_present: Boolean(scope.workspace_id), user_scope_present: Boolean(scope.user_id), tenant_id_hash: scope.tenant_id ? sha256Hex(scope.tenant_id).slice(0, 24) : null, pr_count: enhancedPullRequests.length, classifications: summarizeClassifications(enhancedPullRequests), provider_calls_made: Number(runResult.provider_calls_made || runResult.result?.provider_calls_made_by_read_only_executor || 0), apply_allowed: false, mutations_executed: false, secrets_included: false };
  const request = { owner: repoRef.owner, repo: repoRef.repo, state: args.state || args.options?.state || "open", limit: args.limit || args.options?.limit || null, include_changed_files: args.include_changed_files ?? args.options?.include_changed_files ?? true, include_check_runs: args.include_check_runs ?? args.options?.include_check_runs ?? true };
  const response = { classification: "tenant_repository_pr_reconciliation_read_only", summary: metadata.classifications, pr_numbers: enhancedPullRequests.map((pr) => pr.number).filter(Boolean).slice(0, 100), secrets_included: false };
  await getPool().query(
    `INSERT INTO audit_payload_evidence (evidence_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, source_table, source_pk, evidence_type, request_preview, request_sha256, response_preview, response_sha256, metadata_json, redaction_status, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_required', 0)`,
    [evidenceId, scope.tenant_id, scope.user_id, scope.user_id ? "user" : "tenant_or_workspace", "tenant_repo_pr_reconciliation_sweep", GITHUB_REPO_RESOURCE_TYPE, repoRef.resource_uri, "platform_resource_authority_bindings", null, "tenant_repository_pr_reconciliation_summary_v2", previewJson(request), sha256Hex(previewJson(request)), previewJson(response), sha256Hex(previewJson(response)), JSON.stringify(metadata)]
  );
  return { evidence_id: evidenceId, metadata, secrets_included: false };
}

export async function tenantRepositoryPrReconciliationSweep(args = {}, { auth, runGovernedResource } = {}) {
  if (typeof runGovernedResource !== "function") { const err = new Error("tenant_repo_pr_reconciliation_sweep requires runGovernedResource dependency."); err.status = 503; err.code = "tenant_repository_runtime_dependency_missing"; throw err; }
  const repoRef = normalizeGithubRepoRef(args);
  if (!repoRef) { const err = new Error("tenant_repo_pr_reconciliation_sweep requires owner/repo or github://owner/repo."); err.status = 400; err.code = "github_repo_ref_required"; throw err; }
  const scope = principalScope(args, auth); requireScope(scope);
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const runOptions = { state: args.state || options.state || "open", limit: clampLimit(args.limit ?? options.limit, 20, 50), include_changed_files: boolOption(args.include_changed_files ?? options.include_changed_files, true), include_check_runs: boolOption(args.include_check_runs ?? options.include_check_runs, true), record_evidence: boolOption(args.record_evidence ?? options.record_evidence, false) };
  const runResult = await runGovernedResource({ recipe_key: REPOSITORY_PR_RECONCILE_RECIPE_KEY, resource_ref: repoRef.resource_ref, mode: "read_only", tenant_id: scope.tenant_id, workspace_id: scope.workspace_id, user_id: scope.user_id, options: runOptions });
  if (!runResult?.ok) return { ...runResult, tool: "tenant_repo_pr_reconciliation_sweep", classification: runResult?.classification || "tenant_repository_pr_reconciliation_blocked", tenant_scope: scope, resource_uri: repoRef.resource_uri, provider_calls_made: Number(runResult?.provider_calls_made || 0), execution_allowed: false, apply_allowed: false, secrets_included: false };
  const basePullRequests = Array.isArray(runResult.result?.pull_requests) ? runResult.result.pull_requests : [];
  const enhancedPullRequests = basePullRequests.map((pr) => ({ ...pr, ...classifyRepositoryPullRequestV2(pr) }));
  const evidence = boolOption(args.record_evidence ?? options.record_evidence, false) ? await recordTenantRepositoryEvidence({ args: { ...args, options: runOptions }, scope, repoRef, runResult, enhancedPullRequests }) : null;
  return { ok: true, tool: "tenant_repo_pr_reconciliation_sweep", classification: "tenant_repository_pr_reconciliation_read_only", engine_version: "v2_read_only_tenant_scoped", recipe_key: REPOSITORY_PR_RECONCILE_RECIPE_KEY, resource_uri: repoRef.resource_uri, tenant_scope: scope, summary: { pr_count: enhancedPullRequests.length, classifications: summarizeClassifications(enhancedPullRequests), provider_calls_made: Number(runResult.provider_calls_made || runResult.result?.provider_calls_made_by_read_only_executor || 0) }, pull_requests: enhancedPullRequests, base_result: { classification: runResult.classification, result_classification: runResult.result?.classification || null, audit_evidence: runResult.result?.audit_evidence || null, provider_calls_made: runResult.provider_calls_made || null }, evidence, apply_requested: false, apply_allowed: false, dispatch_allowed: true, execution_allowed: true, mutations_executed: false, secrets_included: false };
}

export function smokeSafeTenantId(value = "") {
  const raw = asString(value || `smoke_${randomUUID().slice(0, 12)}`);
  if (raw.length <= 36) return raw;
  return `smoke_${sha256Hex(raw).slice(0, 24)}`;
}

export async function tenantRepositoryIntelligenceV2ReadinessSmoke(args = {}, { auth, runGovernedResource } = {}) {
  const tenantId = smokeSafeTenantId(args.tenant_id);
  const repoRef = normalizeGithubRepoRef(args) || normalizeGithubRepoRef({
    owner: "mad4bdigital-ai",
    repo: "multi-business-multi-role-growth-intelligence-os",
  });
  const negativeTenantId = smokeSafeTenantId(`${tenantId}_missing`);
  const negative = await tenantRepositoryPrReconciliationSweep({
    tenant_id: negativeTenantId,
    owner: repoRef.owner,
    repo: repoRef.repo,
    state: "open",
    limit: 1,
    include_changed_files: false,
    include_check_runs: false,
    record_evidence: false,
  }, { auth, runGovernedResource });
  const create = await createRepositoryAuthorityBinding({
    tenant_id: tenantId,
    owner: repoRef.owner,
    repo: repoRef.repo,
    recipe_key: REPOSITORY_PR_RECONCILE_RECIPE_KEY,
    permission_level: "read_only",
    allowed_modes: ["read_only"],
    notes: "temporary repository intelligence v2 readiness smoke binding",
    created_by: "system:tenant_repository_intelligence_v2_readiness_smoke",
  }, { auth: { ...(auth || {}), is_admin: true } });
  const positive = await tenantRepositoryPrReconciliationSweep({
    tenant_id: tenantId,
    owner: repoRef.owner,
    repo: repoRef.repo,
    state: "open",
    limit: clampLimit(args.limit, 1, 5),
    include_changed_files: false,
    include_check_runs: false,
    record_evidence: true,
  }, { auth, runGovernedResource });
  const bindingId = create?.binding?.binding_id;
  const revoke = bindingId
    ? await revokeRepositoryAuthorityBinding({
      binding_id: bindingId,
      revoked_by: "system:tenant_repository_intelligence_v2_readiness_smoke_cleanup",
    }, { auth: { ...(auth || {}), is_admin: true } })
    : null;
  const [cleanupRows] = await getPool().query(
    `SELECT SUM(status = 'active') AS active_smoke_bindings, COUNT(*) AS total_smoke_bindings
       FROM platform_resource_authority_bindings
      WHERE tenant_id IN (?, ?) OR created_by = 'system:tenant_repository_intelligence_v2_readiness_smoke'`,
    [tenantId, negativeTenantId]
  );
  const checks = [
    { name: "negative_blocks_before_provider", pass: negative?.ok === false && Number(negative?.provider_calls_made || 0) === 0 && negative?.reason_code === "blocked_missing_platform_resource_authority_binding" },
    { name: "binding_created_read_only", pass: create?.ok === true && create?.binding?.permission_level === "read_only" && (create?.binding?.allowed_modes || []).includes("read_only") },
    { name: "positive_executes_read_only", pass: positive?.ok === true && positive?.apply_allowed === false && positive?.mutations_executed === false && Number(positive?.summary?.provider_calls_made || 0) > 0 },
    { name: "v2_evidence_written", pass: Boolean(positive?.evidence?.evidence_id) && positive?.evidence?.metadata?.schema_version === "tenant_repository_pr_reconciliation_evidence.v2" },
    { name: "cleanup_revoked_binding", pass: revoke?.ok === true && String(cleanupRows?.[0]?.active_smoke_bindings || "0") === "0" },
  ];
  const pass = checks.every((check) => check.pass === true);
  return {
    ok: pass,
    tool: "tenant_repository_intelligence_v2_readiness_smoke",
    status: pass ? "pass" : "fail",
    classification: pass ? "tenant_repository_intelligence_v2_ready" : "tenant_repository_intelligence_v2_not_ready",
    checks,
    negative: { ok: negative?.ok, classification: negative?.classification, reason_code: negative?.reason_code, provider_calls_made: negative?.provider_calls_made, secrets_included: false },
    positive: { ok: positive?.ok, classification: positive?.classification, summary: positive?.summary, evidence_id: positive?.evidence?.evidence_id || null, apply_allowed: positive?.apply_allowed, mutations_executed: positive?.mutations_executed, secrets_included: false },
    cleanup: cleanupRows?.[0] || null,
    binding_id: bindingId || null,
    apply_allowed: false,
    mutations_executed: false,
    secrets_included: false,
  };
}

export const TENANT_REPOSITORY_INTELLIGENCE_V2_SYSTEM_TOOLS = [
  { name: "platform_resource_authority_binding_create", description: "Admin-only create/idempotent grant for V2 read-only GitHub repository authority bindings used by tenant repository intelligence.", requires_admin: true, inputSchema: { type: "object", properties: { tenant_id: { type: "string" }, workspace_id: { type: "string" }, user_id: { type: "string" }, owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, recipe_key: { type: "string", default: REPOSITORY_PR_RECONCILE_RECIPE_KEY }, permission_level: { type: "string", enum: ["read_only"], default: "read_only" }, allowed_modes: { type: "array", items: { type: "string", enum: ["read_only"] }, default: ["read_only"] }, expires_at: { type: "string" }, notes: { type: "string" } }, required: [] } },
  { name: "platform_resource_authority_binding_list", description: "Admin-only list of platform_resource_authority_bindings, with filters for repository intelligence V2 read-only bindings.", requires_admin: true, inputSchema: { type: "object", properties: { tenant_id: { type: "string" }, workspace_id: { type: "string" }, user_id: { type: "string" }, owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, recipe_key: { type: "string" }, status: { type: "string", enum: ["active", "suspended", "revoked", "expired"] }, limit: { type: "integer", minimum: 1, maximum: 200, default: 50 } }, required: [] } },
  { name: "platform_resource_authority_binding_revoke", description: "Admin-only revoke a platform_resource_authority_bindings row by binding_id with readback.", requires_admin: true, inputSchema: { type: "object", properties: { binding_id: { type: "string" }, revoked_by: { type: "string" } }, required: ["binding_id"] } },
  { name: "tenant_repo_pr_reconciliation_sweep", description: "Tenant-scoped read-only GitHub PR reconciliation sweep. Requires an active platform_resource_authority_bindings row and never comments, labels, closes, merges, patches, force-pushes, or applies migrations.", requires_admin: false, inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, tenant_id: { type: "string", description: "Admin smoke only; tenant callers are forced to their principal tenant." }, workspace_id: { type: "string" }, user_id: { type: "string" }, state: { type: "string", default: "open" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }, include_changed_files: { type: "boolean", default: true }, include_check_runs: { type: "boolean", default: true }, record_evidence: { type: "boolean", default: false } }, required: [] } },
  { name: "tenant_repository_intelligence_v2_readiness_smoke", description: "Admin-only no-secret readiness smoke for tenant repository intelligence V2. Creates a temporary read-only binding, verifies negative/positive behavior, writes bounded V2 evidence, revokes the binding, and confirms cleanup.", requires_admin: true, inputSchema: { type: "object", properties: { tenant_id: { type: "string" }, owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 5, default: 1 } }, required: [] } },
];
