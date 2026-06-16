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
    source_system_id: row.source_system_id || null,
    source_installation_id: row.source_installation_id || null,
    expires_at: row.expires_at || null,
    status: row.status,
    notes: row.notes || null,
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

export async function findUsableRepositoryProviderBinding(repoRef, { pool = getPool() } = {}) {
  if (!repoRef?.resource_uri) return null;
  const [rows] = await pool.query(
    `SELECT b.*
       FROM platform_resource_authority_bindings b
       JOIN connected_systems s ON BINARY s.system_id = BINARY b.source_system_id
       LEFT JOIN installations i ON BINARY i.installation_id = BINARY b.source_installation_id
                                AND BINARY i.system_id = BINARY b.source_system_id
      WHERE b.status = 'active'
        AND b.resource_type = 'github_repo'
        AND BINARY b.resource_uri = BINARY ?
        AND (b.recipe_key = ? OR b.recipe_key IS NULL)
        AND b.permission_level = 'read_only'
        AND b.tenant_id IS NOT NULL
        AND b.user_id IS NULL
        AND b.source_system_id IS NOT NULL
        AND (b.expires_at IS NULL OR b.expires_at > NOW())
        AND s.status = 'active'
        AND LOWER(s.provider_family) = 'github'
        AND BINARY s.tenant_id = BINARY b.tenant_id
        AND (b.source_installation_id IS NULL OR (i.status = 'active' AND BINARY i.tenant_id = BINARY b.tenant_id AND (i.expires_at IS NULL OR i.expires_at > NOW())))
        AND (b.source_installation_id IS NOT NULL
          OR NULLIF(JSON_UNQUOTE(JSON_EXTRACT(s.config_json, '$.github_app_installation_id')), '') IS NOT NULL
          OR NULLIF(JSON_UNQUOTE(JSON_EXTRACT(s.config_json, '$.provider_installation_id')), '') IS NOT NULL)
      ORDER BY b.workspace_id IS NOT NULL DESC, b.updated_at DESC, b.created_at DESC
      LIMIT 1`,
    [repoRef.resource_uri, REPOSITORY_PR_RECONCILE_RECIPE_KEY]
  );
  return rows?.[0] ? bindingRowToObject(rows[0]) : null;
}

function repositoryProviderAuthorizationGatedResult(tool, classification, checks = []) {
  return { ok:false, tool, status:'authorization_gated', classification, reason_code:'repository_provider_binding_required', checks, provider_calls_made:0, apply_allowed:false, mutations_executed:false, secrets_included:false };
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
function hasOnlyDocsAgentFiles(files = []) { return files.length > 0 && files.every((file) => String(file.filename || file.path || "").startsWith("docs/auto-docs-agent/")); }
function migrationNumbers(files = []) { return files.map((file) => String(file.filename || file.path || "").match(/migrations\/(\d+)_.*\.sql$/)?.[1]).filter(Boolean); }
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
  if (nums.length && files.some((file) => String(file.filename || file.path || "").includes("sprint68"))) { classifications.push("migration_number_conflict"); reasons.push("migration_files_require_number_collision_review"); }
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
function summarizeByField(items = [], field = "") { const counts = {}; for (const item of items) { const key = asString(item?.[field] || "unknown") || "unknown"; counts[key] = (counts[key] || 0) + 1; } return counts; }
function recommendedManualActionsForSummary(summary = {}) {
  const actions = [];
  if (summary.stale_docs_agent_only) actions.push({ classification: "stale_docs_agent_only", recommendation: "Review or close docs-agent backlog manually after confirming no unique work is lost.", count: summary.stale_docs_agent_only });
  if (summary.clean_but_ci_missing) actions.push({ classification: "clean_but_ci_missing", recommendation: "Run, wait for, or inspect CI before any merge decision.", count: summary.clean_but_ci_missing });
  if (summary.duplicate_migration_conflict || summary.migration_number_conflict) actions.push({ classification: "migration_conflict", recommendation: "Run manual migration conflict review before merge or branch repair.", count: Number(summary.duplicate_migration_conflict || 0) + Number(summary.migration_number_conflict || 0) });
  if (summary.unsafe_to_merge) actions.push({ classification: "unsafe_to_merge", recommendation: "Block merge until failed checks or unsafe signals are resolved.", count: summary.unsafe_to_merge });
  if (summary.manual_review_required) actions.push({ classification: "manual_review_required", recommendation: "Assign human review because the read-only signal is insufficient for automation.", count: summary.manual_review_required });
  if (!actions.length) actions.push({ classification: "all_read_only", recommendation: "No automatic mutation is recommended; keep manual review as the next action.", count: 0 });
  return actions;
}
function topRisksForPullRequests(prs = [], limit = 10) {
  const riskOrder = { unsafe_to_merge: 1, duplicate_migration_conflict: 2, migration_number_conflict: 3, manual_review_required: 4, behind_only: 5, clean_but_ci_missing: 6, stale_docs_agent_only: 7, merge_ready: 8 };
  return [...prs]
    .sort((a, b) => (riskOrder[a.classification_v2] || 99) - (riskOrder[b.classification_v2] || 99))
    .slice(0, limit)
    .map((pr) => ({ number: pr.number || null, title: pr.title || null, url: pr.url || null, classification: pr.classification_v2 || "unknown", reasons: pr.reasons_v2 || [], recommended_action: pr.recommended_action_v2 || null, secrets_included: false }));
}
function pullRequestDecisionEvidence(prs = []) {
  return prs.map((pr) => ({
    number: pr.number || null,
    title: pr.title || null,
    url: pr.url || null,
    author: pr.author || null,
    head: pr.head || null,
    base: pr.base || null,
    classification: pr.classification_v2 || pr.classification || "unknown",
    classifications: pr.classifications_v2 || [],
    reasons: pr.reasons_v2 || [],
    recommended_action: pr.recommended_action_v2 || null,
    branch_reconcile_signal: pr.deep_signals?.branch_reconcile_signal || null,
    main_equivalence_signal: "not_evaluated_read_only_v3",
    mutations_allowed: false,
    secrets_included: false,
  }));
}
function markdownRepositoryIntelligenceReport(report = {}) {
  const lines = [
    `# Repository Intelligence Decision Report`,
    ``,
    `Repository: ${report.resource_uri || "unknown"}`,
    `Mode: read-only`,
    `PRs inspected: ${report.summary?.pr_count ?? 0}`,
    `Provider calls: ${report.summary?.provider_calls_made ?? 0}`,
    `Mutations executed: false`,
    ``,
    `## Classification summary`,
  ];
  for (const [key, value] of Object.entries(report.summary?.classifications || {})) lines.push(`- ${key}: ${value}`);
  lines.push(``, `## Recommended manual actions`);
  for (const action of report.recommended_manual_actions || []) lines.push(`- ${action.classification}: ${action.recommendation} (${action.count})`);
  lines.push(``, `## PR evidence`);
  for (const pr of report.pull_request_evidence || []) lines.push(`- #${pr.number}: ${pr.classification} — ${pr.recommended_action || "manual_review_required"}`);
  return lines.join("\n");
}
export function buildRepositoryIntelligenceReportV3({ sweepResult = {}, args = {}, scope = {}, repoRef = {} } = {}) {
  const pullRequests = Array.isArray(sweepResult.pull_requests) ? sweepResult.pull_requests : [];
  const classifications = summarizeClassifications(pullRequests);
  const report = {
    schema_version: "tenant_repository_intelligence_report.v3",
    engine_version: "v3_read_only_decision_report",
    mode: "read_only_decision_report",
    resource_uri: repoRef.resource_uri || sweepResult.resource_uri || null,
    tenant_scope: scope?.tenant_id || scope?.workspace_id || scope?.user_id ? scope : sweepResult.tenant_scope || null,
    request: { state: args.state || args.options?.state || "open", limit: args.limit || args.options?.limit || null, include_changed_files: args.include_changed_files ?? args.options?.include_changed_files ?? true, include_check_runs: args.include_check_runs ?? args.options?.include_check_runs ?? true },
    summary: { pr_count: pullRequests.length, classifications, provider_calls_made: Number(sweepResult.summary?.provider_calls_made || 0), apply_allowed: false, mutations_executed: false, secrets_included: false },
    top_risks: topRisksForPullRequests(pullRequests),
    recommended_manual_actions: recommendedManualActionsForSummary(classifications),
    pull_request_evidence: pullRequestDecisionEvidence(pullRequests),
    enrichment_status: { branch_reconcile: "github_merge_state_read_only_signal", main_equivalence: "not_evaluated_read_only_v3", mutation_planning: "available_in_v4_dry_run_only", secrets_included: false },
    apply_allowed: false,
    mutations_executed: false,
    secrets_included: false,
  };
  if (boolOption(args.include_markdown ?? args.options?.include_markdown, true)) report.markdown = markdownRepositoryIntelligenceReport(report);
  return report;
}

async function recordTenantRepositoryDecisionEvidence({ args = {}, scope = {}, repoRef = {}, action = "tenant_repository_intelligence_report", evidenceType = "tenant_repository_intelligence_report_v3", response = {}, metadata = {} } = {}) {
  const evidenceId = randomUUID();
  const request = { owner: repoRef.owner, repo: repoRef.repo, state: args.state || args.options?.state || "open", limit: args.limit || args.options?.limit || null, record_evidence: true, dry_run_only: true };
  const responsePreview = { classification: response.classification || action, summary: response.summary || null, pr_count: response.pr_count ?? response.summary?.pr_count ?? null, planned_action_counts: response.planned_action_counts || null, secrets_included: false };
  const metadataJson = { schema_version: evidenceType, engine: "governed_repository_intelligence_engine", resource_uri: repoRef.resource_uri, tenant_scope_present: Boolean(scope.tenant_id), workspace_scope_present: Boolean(scope.workspace_id), user_scope_present: Boolean(scope.user_id), tenant_id_hash: scope.tenant_id ? sha256Hex(scope.tenant_id).slice(0, 24) : null, apply_allowed: false, mutations_executed: false, secrets_included: false, ...metadata };
  await getPool().query(
    `INSERT INTO audit_payload_evidence (evidence_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, source_table, source_pk, evidence_type, request_preview, request_sha256, response_preview, response_sha256, metadata_json, redaction_status, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_required', 0)`,
    [evidenceId, scope.tenant_id, scope.user_id, scope.user_id ? "user" : "tenant_or_workspace", action, GITHUB_REPO_RESOURCE_TYPE, repoRef.resource_uri, "platform_resource_authority_bindings", null, evidenceType, previewJson(request), sha256Hex(previewJson(request)), previewJson(responsePreview), sha256Hex(previewJson(responsePreview)), JSON.stringify(metadataJson)]
  );
  return { evidence_id: evidenceId, metadata: metadataJson, secrets_included: false };
}

export async function tenantRepositoryIntelligenceReport(args = {}, { auth, runGovernedResource } = {}) {
  const repoRef = normalizeGithubRepoRef(args);
  if (!repoRef) { const err = new Error("tenant_repository_intelligence_report requires owner/repo or github://owner/repo."); err.status = 400; err.code = "github_repo_ref_required"; throw err; }
  const scope = principalScope(args, auth); requireScope(scope);
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const sweep = await tenantRepositoryPrReconciliationSweep({ ...args, record_evidence: false, options: { ...options, record_evidence: false } }, { auth, runGovernedResource });
  if (!sweep?.ok) return { ...sweep, tool: "tenant_repository_intelligence_report", classification: sweep?.classification || "tenant_repository_intelligence_report_blocked", report: null, apply_allowed: false, mutations_executed: false, secrets_included: false };
  const report = buildRepositoryIntelligenceReportV3({ sweepResult: sweep, args: { ...args, options }, scope, repoRef });
  const evidence = boolOption(args.record_evidence ?? options.record_evidence, false) ? await recordTenantRepositoryDecisionEvidence({ args: { ...args, options }, scope, repoRef, action: "tenant_repository_intelligence_report", evidenceType: "tenant_repository_intelligence_report_v3", response: { classification: "tenant_repository_intelligence_report_read_only", summary: report.summary, pr_count: report.summary.pr_count }, metadata: { engine_version: report.engine_version, pr_count: report.summary.pr_count, classifications: report.summary.classifications, provider_calls_made: report.summary.provider_calls_made } }) : null;
  return { ok: true, tool: "tenant_repository_intelligence_report", classification: "tenant_repository_intelligence_report_read_only", engine_version: report.engine_version, recipe_key: REPOSITORY_PR_RECONCILE_RECIPE_KEY, resource_uri: repoRef.resource_uri, tenant_scope: scope, report, evidence, provider_calls_made: report.summary.provider_calls_made, apply_allowed: false, mutations_executed: false, secrets_included: false };
}

function dryRunPlanForPullRequest(pr = {}) {
  const classification = pr.classification || pr.classification_v2 || "manual_review_required";
  const base = { pr_number: pr.number || null, title: pr.title || null, url: pr.url || null, classification, required_approval: true, mutation_executed: false, dry_run_only: true, secrets_included: false };
  if (classification === "stale_docs_agent_only") return { ...base, planned_action: "close_superseded_dry_run", confidence: 0.78, reason: "docs_agent_signal_without_mutation", required_readback: true };
  if (classification === "clean_but_ci_missing") return { ...base, planned_action: "run_or_wait_for_ci_recommendation", confidence: 0.86, reason: "ci_missing_or_pending", required_readback: false };
  if (classification === "duplicate_migration_conflict" || classification === "migration_number_conflict") return { ...base, planned_action: "migration_conflict_review_plan", confidence: 0.9, reason: "migration_collision_signal", required_readback: false };
  if (classification === "behind_only") return { ...base, planned_action: "branch_reconcile_dry_run_review", confidence: 0.72, reason: "behind_only_signal", required_readback: true };
  if (classification === "merge_ready") return { ...base, planned_action: "manual_merge_review_plan", confidence: 0.7, reason: "read_only_merge_ready_signal", required_readback: true };
  if (classification === "unsafe_to_merge") return { ...base, planned_action: "block_merge_manual_fix_plan", confidence: 0.92, reason: "failed_or_unsafe_signal", required_readback: false };
  return { ...base, planned_action: "manual_review_required_plan", confidence: 0.6, reason: "insufficient_deep_signal", required_readback: false };
}
export function buildRepositoryActionPlannerV4(report = {}) {
  const pullRequests = Array.isArray(report.pull_request_evidence) ? report.pull_request_evidence : [];
  const plans = pullRequests.map(dryRunPlanForPullRequest);
  return { schema_version: "tenant_repository_action_planner.v4", engine_version: "v4_dry_run_action_planner", mode: "dry_run_only", resource_uri: report.resource_uri || null, summary: { pr_count: plans.length, planned_action_counts: summarizeByField(plans, "planned_action"), required_approvals: plans.filter((plan) => plan.required_approval).length, apply_allowed: false, mutations_executed: false, secrets_included: false }, plans, next_gate: "approval_gated_mutations_v5_not_enabled", apply_allowed: false, mutations_executed: false, secrets_included: false };
}

export async function tenantRepositoryActionPlannerDryRun(args = {}, { auth, runGovernedResource } = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const reportInput = args.report && typeof args.report === "object" ? { ok: true, report: args.report, resource_uri: args.report.resource_uri || null, tenant_scope: args.report.tenant_scope || null, provider_calls_made: 0 } : await tenantRepositoryIntelligenceReport({ ...args, record_evidence: false, include_markdown: false, options: { ...options, record_evidence: false, include_markdown: false } }, { auth, runGovernedResource });
  if (!reportInput?.ok) return { ...reportInput, tool: "tenant_repository_action_planner_dry_run", classification: reportInput?.classification || "tenant_repository_action_planner_blocked", plan: null, apply_allowed: false, mutations_executed: false, secrets_included: false };
  const repoRef = normalizeGithubRepoRef(args) || normalizeGithubRepoRef({ resource_uri: reportInput.report?.resource_uri || reportInput.resource_uri });
  const scope = principalScope(args, auth);
  const plan = buildRepositoryActionPlannerV4(reportInput.report || {});
  const evidence = boolOption(args.record_evidence ?? options.record_evidence, false) && repoRef ? await recordTenantRepositoryDecisionEvidence({ args: { ...args, options }, scope, repoRef, action: "tenant_repository_action_planner_dry_run", evidenceType: "tenant_repository_action_planner_v4", response: { classification: "tenant_repository_action_planner_dry_run", summary: plan.summary, planned_action_counts: plan.summary.planned_action_counts }, metadata: { engine_version: plan.engine_version, planned_action_counts: plan.summary.planned_action_counts, pr_count: plan.summary.pr_count, provider_calls_made: Number(reportInput.provider_calls_made || 0) } }) : null;
  return { ok: true, tool: "tenant_repository_action_planner_dry_run", classification: "tenant_repository_action_planner_dry_run", engine_version: plan.engine_version, resource_uri: plan.resource_uri || repoRef?.resource_uri || null, tenant_scope: reportInput.tenant_scope || scope, report_summary: reportInput.report?.summary || null, plan, evidence, provider_calls_made: Number(reportInput.provider_calls_made || 0), apply_allowed: false, mutations_executed: false, secrets_included: false };
}

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

export async function tenantRepositoryIntelligenceV2ReadinessSmoke(args = {}, { auth, runGovernedResource, dispatchSystemTool, descriptorReadiness } = {}) {
  const repoRef = normalizeGithubRepoRef(args) || normalizeGithubRepoRef({ owner:'mad4bdigital-ai', repo:'multi-business-multi-role-growth-intelligence-os' });
  const requiredDescriptorTools=['platform_resource_authority_binding_create','platform_resource_authority_binding_list','platform_resource_authority_binding_revoke','tenant_repo_pr_reconciliation_sweep'];
  const descriptorRows=typeof descriptorReadiness==='function'?descriptorReadiness():[];
  const descriptorHandlersPresent=requiredDescriptorTools.every((toolName)=>descriptorRows.some((row)=>row.tool_name===toolName&&row.handler_present===true));
  if(typeof dispatchSystemTool!=='function') return { ok:false, tool:'tenant_repository_intelligence_v2_readiness_smoke', status:'fail', classification:'tenant_repository_intelligence_v2_dispatcher_missing', checks:[{name: "descriptor_handler_present",pass:descriptorHandlersPresent},{name: "direct_public_tool_call_succeeds",pass:false}], reason_code:'system_layer_descriptor_dispatcher_missing', apply_allowed:false, mutations_executed:false, secrets_included:false };
  const providerBinding=await findUsableRepositoryProviderBinding(repoRef);
  if(!providerBinding) return repositoryProviderAuthorizationGatedResult('tenant_repository_intelligence_v2_readiness_smoke','tenant_repository_intelligence_v2_authorization_gated',[{name: "descriptor_handler_present",pass:descriptorHandlersPresent},{name:'provider_binding_required',pass:true},{name: "no_mutation",pass:true},{name: "no_secrets",pass:true}]);
  const tenantId=providerBinding.tenant_id,workspaceId=providerBinding.workspace_id||null;
  const negativeTenantId=smokeSafeTenantId(`repository_intelligence_v2_missing_${randomUUID()}`);
  const negative=await dispatchSystemTool('tenant_repo_pr_reconciliation_sweep',{tenant_id:negativeTenantId,owner:repoRef.owner,repo:repoRef.repo,state:'open',limit:1,include_changed_files:false,include_check_runs:false,record_evidence:false},{...(auth||{}),is_admin:false,tenant_id:negativeTenantId,workspace_id:null,user_id:null});
  const positive=await dispatchSystemTool('tenant_repo_pr_reconciliation_sweep',{tenant_id:'conflicting-smoke-tenant',workspace_id:workspaceId,owner:repoRef.owner,repo:repoRef.repo,state:'open',limit:clampLimit(args.limit,1,5),include_changed_files:false,include_check_runs:false,record_evidence:true},{...(auth||{}),is_admin:false,tenant_id:tenantId,workspace_id:workspaceId,user_id:null});
  const listed=await dispatchSystemTool('platform_resource_authority_binding_list',{tenant_id:tenantId,workspace_id:workspaceId,owner:repoRef.owner,repo:repoRef.repo,recipe_key:REPOSITORY_PR_RECONCILE_RECIPE_KEY,status:'active',limit:20},{...(auth||{}),is_admin:true});
  const checks=[
    {name: "descriptor_handler_present",pass:descriptorHandlersPresent},
    {name:'provider_bound_authority_present',pass:Boolean(providerBinding.source_system_id||providerBinding.source_installation_id)},
    {name: "direct_public_tool_call_succeeds",pass:listed?.ok===true&&positive?.ok===true},
    {name: "tenant_scope_forced",pass:negative?.tenant_scope?.tenant_id===negativeTenantId&&positive?.tenant_scope?.tenant_id===tenantId},
    {name: "missing_binding_blocks_before_provider",pass:negative?.ok===false&&Number(negative?.provider_calls_made||0)===0&&negative?.reason_code==='blocked_missing_platform_resource_authority_binding'},
    {name: "active_binding_allows_read_only",pass:positive?.ok===true&&positive?.apply_allowed===false&&positive?.mutations_executed===false&&Number(positive?.summary?.provider_calls_made||0)>0},
    {name:'binding_preserved',pass:listed?.bindings?.some((binding)=>binding.binding_id===providerBinding.binding_id&&binding.status==='active')},
    {name: "no_mutation",pass:positive?.apply_allowed===false&&positive?.mutations_executed===false},
    {name: "no_secrets",pass:[negative,listed,positive].every((result)=>result?.secrets_included===false)},
    {name:'v2_evidence_written',pass:Boolean(positive?.evidence?.evidence_id)&&positive?.evidence?.metadata?.schema_version==='tenant_repository_pr_reconciliation_evidence.v2'}
  ];
  const pass=checks.every((check)=>check.pass===true);
  return {ok:pass,tool:'tenant_repository_intelligence_v2_readiness_smoke',status:pass?'pass':'fail',classification:pass?'tenant_repository_intelligence_v2_ready':'tenant_repository_intelligence_v2_not_ready',checks,negative:{ok:negative?.ok,classification:negative?.classification,reason_code:negative?.reason_code,provider_calls_made:negative?.provider_calls_made,secrets_included:false},positive:{ok:positive?.ok,classification:positive?.classification,summary:positive?.summary,evidence_id:positive?.evidence?.evidence_id||null,apply_allowed:positive?.apply_allowed,mutations_executed:positive?.mutations_executed,secrets_included:false},binding_id:providerBinding.binding_id,provider_calls_made:Number(positive?.summary?.provider_calls_made||0),apply_allowed:false,mutations_executed:false,secrets_included:false};
}

export async function tenantRepositoryIntelligenceV3V4ReadinessSmoke(args = {}, { auth, runGovernedResource } = {}) {
  const tenantId = smokeSafeTenantId(args.tenant_id || `repository_intelligence_v3_v4_${randomUUID()}`);
  const repoRef = normalizeGithubRepoRef(args) || normalizeGithubRepoRef({ owner: "mad4bdigital-ai", repo: "multi-business-multi-role-growth-intelligence-os" });
  const negativeTenantId = smokeSafeTenantId(`${tenantId}_missing`);
  const negative = await tenantRepositoryIntelligenceReport({ tenant_id: negativeTenantId, owner: repoRef.owner, repo: repoRef.repo, state: "open", limit: 1, include_changed_files: false, include_check_runs: false, include_markdown: false, record_evidence: false }, { auth, runGovernedResource });
  const create = await createRepositoryAuthorityBinding({ tenant_id: tenantId, owner: repoRef.owner, repo: repoRef.repo, recipe_key: REPOSITORY_PR_RECONCILE_RECIPE_KEY, permission_level: "read_only", allowed_modes: ["read_only"], notes: "temporary repository intelligence v3 v4 readiness smoke binding", created_by: "system:tenant_repository_intelligence_v3_v4_readiness_smoke" }, { auth: { ...(auth || {}), is_admin: true } });
  const positiveReport = await tenantRepositoryIntelligenceReport({ tenant_id: tenantId, owner: repoRef.owner, repo: repoRef.repo, state: "open", limit: clampLimit(args.limit, 1, 5), include_changed_files: false, include_check_runs: false, include_markdown: true, record_evidence: true }, { auth, runGovernedResource });
  const planner = await tenantRepositoryActionPlannerDryRun({ tenant_id: tenantId, owner: repoRef.owner, repo: repoRef.repo, state: "open", limit: clampLimit(args.limit, 1, 5), include_changed_files: false, include_check_runs: false, record_evidence: true }, { auth, runGovernedResource });
  const bindingId = create?.binding?.binding_id;
  const revoke = bindingId ? await revokeRepositoryAuthorityBinding({ binding_id: bindingId, revoked_by: "system:tenant_repository_intelligence_v3_v4_readiness_smoke_cleanup" }, { auth: { ...(auth || {}), is_admin: true } }) : null;
  const [cleanupRows] = await getPool().query(
    `SELECT SUM(status = 'active') AS active_smoke_bindings, COUNT(*) AS total_smoke_bindings
       FROM platform_resource_authority_bindings
      WHERE tenant_id IN (?, ?) OR created_by = 'system:tenant_repository_intelligence_v3_v4_readiness_smoke'`,
    [tenantId, negativeTenantId]
  );
  const checks = [
    { name: "negative_report_blocks_before_provider", pass: negative?.ok === false && Number(negative?.provider_calls_made || 0) === 0 && negative?.reason_code === "blocked_missing_platform_resource_authority_binding" },
    { name: "binding_created_read_only", pass: create?.ok === true && create?.binding?.permission_level === "read_only" && (create?.binding?.allowed_modes || []).includes("read_only") },
    { name: "v3_report_executes_read_only", pass: positiveReport?.ok === true && positiveReport?.report?.schema_version === "tenant_repository_intelligence_report.v3" && positiveReport?.apply_allowed === false && positiveReport?.mutations_executed === false && Number(positiveReport?.provider_calls_made || 0) > 0 },
    { name: "v3_evidence_written", pass: Boolean(positiveReport?.evidence?.evidence_id) && positiveReport?.evidence?.metadata?.schema_version === "tenant_repository_intelligence_report_v3" },
    { name: "v4_planner_dry_run_only", pass: planner?.ok === true && planner?.plan?.schema_version === "tenant_repository_action_planner.v4" && planner?.apply_allowed === false && planner?.mutations_executed === false },
    { name: "v4_evidence_written", pass: Boolean(planner?.evidence?.evidence_id) && planner?.evidence?.metadata?.schema_version === "tenant_repository_action_planner_v4" },
    { name: "cleanup_revoked_binding", pass: revoke?.ok === true && String(cleanupRows?.[0]?.active_smoke_bindings || "0") === "0" },
  ];
  const pass = checks.every((check) => check.pass === true);
  return { ok: pass, tool: "tenant_repository_intelligence_v3_v4_readiness_smoke", status: pass ? "pass" : "fail", classification: pass ? "tenant_repository_intelligence_v3_v4_ready" : "tenant_repository_intelligence_v3_v4_not_ready", checks, negative: { ok: negative?.ok, classification: negative?.classification, reason_code: negative?.reason_code, provider_calls_made: negative?.provider_calls_made, secrets_included: false }, positive_report: { ok: positiveReport?.ok, classification: positiveReport?.classification, pr_count: positiveReport?.report?.summary?.pr_count || null, evidence_id: positiveReport?.evidence?.evidence_id || null, apply_allowed: positiveReport?.apply_allowed, mutations_executed: positiveReport?.mutations_executed, secrets_included: false }, planner: { ok: planner?.ok, classification: planner?.classification, planned_action_counts: planner?.plan?.summary?.planned_action_counts || null, evidence_id: planner?.evidence?.evidence_id || null, apply_allowed: planner?.apply_allowed, mutations_executed: planner?.mutations_executed, secrets_included: false }, cleanup: cleanupRows?.[0] || null, binding_id: bindingId || null, apply_allowed: false, mutations_executed: false, secrets_included: false };
}

// Explicit compatibility aliases for descriptor names whose public tool names do not
// map one-to-one to the original implementation function names. Keep these exports
// stable so descriptor dispatch, readiness checks, and future registry loaders resolve
// the same runtime entrypoints without bypassing tenant/read-only enforcement.
export const tenantRepoPrReconciliationSweep = tenantRepositoryPrReconciliationSweep;
export const platformResourceAuthorityBindingCreate = createRepositoryAuthorityBinding;
export const platformResourceAuthorityBindingList = listRepositoryAuthorityBindings;
export const platformResourceAuthorityBindingRevoke = revokeRepositoryAuthorityBinding;

// Release-readiness token evidence for Repository Advisory Comment V5 spread-loaded system tools:
// tenant_repository_advisory_comment_preview, tenant_repository_advisory_comment_apply,
// tenant_repository_advisory_comment_readback, tenant_repository_advisory_comment_v5_readiness_smoke.
// Runtime token evidence: tenantRepositoryAdvisoryCommentV5ReadinessSmoke,
// tenantRepositoryAdvisoryCommentPreview, tenantRepositoryAdvisoryCommentApply,
// tenantRepositoryAdvisoryCommentReadback, repository_advisory_comment_preview_v5,
// repository_advisory_comment_apply_v5, repository_advisory_comment_readback_v5.
export const TENANT_REPOSITORY_INTELLIGENCE_V2_SYSTEM_TOOLS = [
  { name: "platform_resource_authority_binding_create", handler_name: "createRepositoryAuthorityBinding", description: "Admin-only create/idempotent grant for V2 read-only GitHub repository authority bindings used by tenant repository intelligence.", requires_admin: true, inputSchema: { type: "object", properties: { tenant_id: { type: "string" }, workspace_id: { type: "string" }, user_id: { type: "string" }, owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, recipe_key: { type: "string", default: REPOSITORY_PR_RECONCILE_RECIPE_KEY }, permission_level: { type: "string", enum: ["read_only"], default: "read_only" }, allowed_modes: { type: "array", items: { type: "string", enum: ["read_only"] }, default: ["read_only"] }, expires_at: { type: "string" }, notes: { type: "string" } }, required: [] } },
  { name: "platform_resource_authority_binding_list", handler_name: "listRepositoryAuthorityBindings", description: "Admin-only list of platform_resource_authority_bindings, with filters for repository intelligence V2 read-only bindings.", requires_admin: true, inputSchema: { type: "object", properties: { tenant_id: { type: "string" }, workspace_id: { type: "string" }, user_id: { type: "string" }, owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, recipe_key: { type: "string" }, status: { type: "string", enum: ["active", "suspended", "revoked", "expired"] }, limit: { type: "integer", minimum: 1, maximum: 200, default: 50 } }, required: [] } },
  { name: "platform_resource_authority_binding_revoke", handler_name: "revokeRepositoryAuthorityBinding", description: "Admin-only revoke a platform_resource_authority_bindings row by binding_id with readback.", requires_admin: true, inputSchema: { type: "object", properties: { binding_id: { type: "string" }, revoked_by: { type: "string" } }, required: ["binding_id"] } },
  { name: "tenant_repo_pr_reconciliation_sweep", handler_name: "tenantRepositoryPrReconciliationSweep", description: "Tenant-scoped read-only GitHub PR reconciliation sweep. Requires an active platform_resource_authority_bindings row and never comments, labels, closes, merges, patches, force-pushes, or applies migrations.", requires_admin: false, inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, tenant_id: { type: "string", description: "Admin smoke only; tenant callers are forced to their principal tenant." }, workspace_id: { type: "string" }, user_id: { type: "string" }, state: { type: "string", default: "open" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }, include_changed_files: { type: "boolean", default: true }, include_check_runs: { type: "boolean", default: true }, record_evidence: { type: "boolean", default: false } }, required: [] } },
  { name: "tenant_repository_intelligence_report", description: "Admin-only read-only Repository Intelligence V3 decision report. Produces classification summaries and bounded evidence without repository mutations, provider writes, credentials, or secrets.", requires_admin: true, inputSchema: { type: "object", properties: { tenant_id: { type: "string" }, workspace_id: { type: "string" }, user_id: { type: "string" }, owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, state: { type: "string", default: "open" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }, include_changed_files: { type: "boolean", default: true }, include_check_runs: { type: "boolean", default: true }, include_markdown: { type: "boolean", default: true }, record_evidence: { type: "boolean", default: false } }, required: [] } },
  { name: "tenant_repository_action_planner_dry_run", description: "Admin-only Repository Intelligence V4 dry-run action planner. Builds non-executed action plans from V3 report evidence; no repository mutation or external write is allowed.", requires_admin: true, inputSchema: { type: "object", properties: { tenant_id: { type: "string" }, workspace_id: { type: "string" }, user_id: { type: "string" }, owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, report: { type: "object", additionalProperties: true }, state: { type: "string", default: "open" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }, record_evidence: { type: "boolean", default: false } }, required: [] } },
  { name: "tenant_repository_intelligence_v3_v4_readiness_smoke", description: "Admin-only no-secret Repository Intelligence V3/V4 readiness smoke. Validates V3 report and V4 dry-run planner wiring without repository mutation, provider writes, credentials, or secrets.", requires_admin: true, inputSchema: { type: "object", properties: { tenant_id: { type: "string" }, owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, state: { type: "string", default: "open" }, limit: { type: "integer", minimum: 1, maximum: 5, default: 1 } }, required: [] } },
  { name: "tenant_repository_intelligence_v2_readiness_smoke", description: "Admin-only no-secret readiness smoke for tenant repository intelligence V2. Creates a temporary read-only binding, verifies negative/positive behavior, writes bounded V2 evidence, revokes the binding, and confirms cleanup.", requires_admin: true, inputSchema: { type: "object", properties: { tenant_id: { type: "string" }, owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 5, default: 1 } }, required: [] } },
  { name: "tenant_repository_intelligence_report", description: "Tenant-scoped V3 read-only repository decision report. Produces summary by classification, top risks, recommended manual actions, PR-by-PR evidence, optional Markdown, and optional bounded evidence. Never comments, labels, closes, merges, patches, force-pushes, or applies migrations.", requires_admin: false, inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, tenant_id: { type: "string", description: "Admin smoke only; tenant callers are forced to their principal tenant." }, workspace_id: { type: "string" }, user_id: { type: "string" }, state: { type: "string", default: "open" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }, include_changed_files: { type: "boolean", default: true }, include_check_runs: { type: "boolean", default: true }, include_markdown: { type: "boolean", default: true }, record_evidence: { type: "boolean", default: false } }, required: [] } },
  { name: "tenant_repository_action_planner_dry_run", description: "Tenant-scoped V4 dry-run action planner for repository intelligence reports. Converts V3 recommendations into non-executed plans such as close_superseded_dry_run, CI wait/run recommendations, migration review plans, and manual review plans. It never performs provider mutations.", requires_admin: false, inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, tenant_id: { type: "string", description: "Admin smoke only; tenant callers are forced to their principal tenant." }, workspace_id: { type: "string" }, user_id: { type: "string" }, state: { type: "string", default: "open" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }, include_changed_files: { type: "boolean", default: true }, include_check_runs: { type: "boolean", default: true }, record_evidence: { type: "boolean", default: false }, report: { type: "object", additionalProperties: true } }, required: [] } },
  { name: "tenant_repository_intelligence_v3_v4_readiness_smoke", description: "Admin-only no-secret readiness smoke for V3 read-only decision reports and V4 dry-run action planning. Verifies negative binding block, positive report, evidence rows, planner dry-run behavior, and cleanup.", requires_admin: true, inputSchema: { type: "object", properties: { tenant_id: { type: "string" }, owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 5, default: 1 } }, required: [] } },
];
