import crypto, { randomUUID } from "node:crypto";

const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private[_-]?key|authorization|cookie|api[_-]?key)/i;
const CONFLICT_MARKER_PATTERN = /^(<{7}|={7}|>{7})/m;

export const DEFAULT_REPO_CONFLICT_PATH_POLICIES = [
  { pattern: "docs/auto-docs-agent/**", path_class: "generated_artifact", default_strategy: "drop_generated_artifacts", risk: "low", auto_resolve: true, requires_test: false },
  { pattern: "docs/work-maps/**", path_class: "generated_artifact", default_strategy: "keep_main_for_generated", risk: "low", auto_resolve: true, requires_test: false },
  { pattern: "http-generic-api/routes/index.js", path_class: "route_mount", default_strategy: "semantic_merge", risk: "medium", auto_resolve: true, requires_test: true },
  { pattern: "http-generic-api/routes/*.js", path_class: "api_route", default_strategy: "keep_branch_new_file", risk: "medium", auto_resolve: true, requires_test: true },
  { pattern: "http-generic-api/*Service.js", path_class: "application_service", default_strategy: "keep_branch_new_file", risk: "medium", auto_resolve: true, requires_test: true },
  { pattern: "http-generic-api/migrations/*.sql", path_class: "database_migration", default_strategy: "append_additive_migration", risk: "medium", auto_resolve: true, requires_test: true },
  { pattern: "http-generic-api/scripts/test-manifest.mjs", path_class: "test_manifest", default_strategy: "append_unique_test_manifest_entry", risk: "low", auto_resolve: true, requires_test: true },
  { pattern: "docs/spec-kits/**", path_class: "spec_kit", default_strategy: "keep_branch_new_file", risk: "low", auto_resolve: true, requires_test: false },
  { pattern: "package-lock.json", path_class: "dependency_lockfile", default_strategy: "manual_required", risk: "high", auto_resolve: false, requires_test: true },
  { pattern: "**/auth/**", path_class: "security_sensitive", default_strategy: "manual_required", risk: "critical", auto_resolve: false, requires_test: true },
  { pattern: "**/security/**", path_class: "security_sensitive", default_strategy: "manual_required", risk: "critical", auto_resolve: false, requires_test: true }
];

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key === "secrets_included" || !SENSITIVE_KEY_PATTERN.test(key))
      .map(([key, item]) => [key, sanitize(item)])
  );
}

function safeString(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function globToRegex(pattern) {
  const escaped = safeString(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "::DOUBLE_STAR::").replace(/\*/g, "[^/]*").replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesPolicy(path, policy) {
  return globToRegex(policy.pattern).test(path);
}

function classifyPath(path, policies = DEFAULT_REPO_CONFLICT_PATH_POLICIES) {
  const normalizedPath = safeString(path, 512);
  const policy = policies.find((candidate) => matchesPolicy(normalizedPath, candidate));
  return policy || { pattern: "*", path_class: "unknown", default_strategy: "manual_required", risk: "medium", auto_resolve: false, requires_test: true };
}

function isBotCommit(commit = {}) {
  const actor = `${commit.author?.login || commit.committer?.login || commit.author_name || commit.committer_name || ""} ${commit.message || commit.commit?.message || ""}`.toLowerCase();
  return /bot|docs-agent|auto-docs|generated|work-map/.test(actor);
}

function fileHasConflict(file = {}) {
  return file.conflicted === true || file.status === "conflicting" || CONFLICT_MARKER_PATTERN.test(file.content || file.patch || "");
}

function classifyFiles(files = [], policies = DEFAULT_REPO_CONFLICT_PATH_POLICIES) {
  return files.map((file) => {
    const path = safeString(file.path || file.filename || file.name, 512);
    const policy = classifyPath(path, policies);
    const conflict = fileHasConflict(file);
    const generated = policy.path_class === "generated_artifact" || /generated|auto-docs|work-map/.test(path);
    return sanitize({ path, status: safeString(file.status || (conflict ? "conflicting" : "modified"), 64), conflict, generated, path_class: policy.path_class, strategy: policy.default_strategy, risk: policy.risk, auto_resolve: Boolean(policy.auto_resolve), requires_test: Boolean(policy.requires_test), additions: Number(file.additions || 0), deletions: Number(file.deletions || 0) });
  });
}

function summarizeClassification(fileSummaries, commits = [], compare = {}) {
  const conflicts = fileSummaries.filter((file) => file.conflict || file.status === "conflicting");
  const manual = fileSummaries.filter((file) => file.strategy === "manual_required" || file.auto_resolve === false || file.risk === "critical");
  const generated = fileSummaries.filter((file) => file.generated);
  const botCommits = commits.filter(isBotCommit);
  const dirty = compare.mergeable === false || compare.mergeable_state === "dirty" || conflicts.length > 0;
  if (!dirty) return "clean_or_no_conflict";
  if (manual.length) return "manual_review_required";
  if (generated.length && (botCommits.length || generated.length === fileSummaries.length)) return "dirty_generated_docs_conflict";
  if (fileSummaries.some((file) => ["route_mount", "test_manifest", "database_migration"].includes(file.path_class))) return "semantic_auto_resolution_candidate";
  return "clean_branch_replay_recommended";
}

function unique(values) { return [...new Set(values.filter(Boolean))]; }

export function analyzeRepoConflict(input = {}) {
  const files = classifyFiles(input.files || [], input.path_policies || DEFAULT_REPO_CONFLICT_PATH_POLICIES);
  const commits = Array.isArray(input.commits) ? input.commits : [];
  const classification = summarizeClassification(files, commits, input.compare || {});
  const manualRequired = files.filter((file) => file.strategy === "manual_required" || file.risk === "critical" || file.auto_resolve === false);
  const generatedFiles = files.filter((file) => file.generated);
  const botCommits = commits.filter(isBotCommit).map((commit) => safeString(commit.sha || commit.id || commit.commit?.tree?.sha, 64));
  const safeToAutoResolve = manualRequired.length === 0 && classification !== "manual_review_required";
  return sanitize({ ok: true, analysis_id: randomUUID(), classification, safe_to_auto_resolve: safeToAutoResolve, recommended_path: safeToAutoResolve ? (generatedFiles.length || botCommits.length ? "clean_branch_replay" : "semantic_resolution") : "manual_required", base: safeString(input.base || input.base_branch || "main", 128), head: safeString(input.head || input.head_branch || "", 256), summary: { file_count: files.length, conflict_count: files.filter((file) => file.conflict).length, generated_count: generatedFiles.length, manual_required_count: manualRequired.length, bot_commit_count: botCommits.length, strategies: unique(files.map((file) => file.strategy)) }, files, bot_commits: botCommits, manual_required: manualRequired, secrets_included: false });
}

export function buildRepoConflictPlan(input = {}) {
  const analysis = input.analysis?.classification ? sanitize(input.analysis) : input.classification ? sanitize(input) : analyzeRepoConflict(input);
  const steps = [];
  if (analysis.recommended_path === "clean_branch_replay") steps.push("create_clean_branch_from_latest_main", "replay_user_owned_files_only", "exclude_bot_generated_artifacts", "preview_semantic_patches", "run_tests_and_ci", "open_or_update_replacement_pr");
  else if (analysis.recommended_path === "semantic_resolution") steps.push("preview_semantic_patches", "apply_safe_resolvers_with_capability_envelope", "run_tests_and_ci", "update_pr_branch");
  else steps.push("request_human_review", "document_blocked_paths", "do_not_merge_until_resolved");
  const actions = analysis.files.map((file) => ({ path: file.path, path_class: file.path_class, strategy: file.strategy, risk: file.risk, auto_resolve: file.auto_resolve }));
  return sanitize({ ok: true, plan_id: randomUUID(), classification: analysis.classification, recommended_path: analysis.recommended_path, approval_required: analysis.recommended_path !== "manual_required", risk: analysis.manual_required?.length ? "high" : actions.some((action) => action.risk === "medium") ? "medium" : "low", steps, actions, blocked_paths: analysis.manual_required || [], acceptance_gates: ["syntax_check", "test_manifest_subset", "migration_preflight_if_sql_changed", "ci_required", "mergeable_clean"], secrets_included: false });
}

function insertImportIfMissing(source, namedImport, fromPath) {
  const importLine = `import { ${namedImport} } from "${fromPath}";`;
  if (source.includes(importLine) || source.includes(namedImport)) return { changed: false, content: source, reason: "import_already_present" };
  const lines = source.split("\n");
  const lastImportIndex = lines.reduce((last, line, index) => line.startsWith("import ") ? index : last, -1);
  lines.splice(lastImportIndex >= 0 ? lastImportIndex + 1 : 0, 0, importLine);
  return { changed: true, content: lines.join("\n"), reason: "import_inserted" };
}

function insertAfterAnchorIfMissing(source, anchor, insertion) {
  if (source.includes(insertion)) return { changed: false, content: source, reason: "insertion_already_present" };
  const index = source.indexOf(anchor);
  if (index < 0) return { changed: false, content: source, reason: "anchor_not_found" };
  const lineEnd = source.indexOf("\n", index);
  const insertAt = lineEnd >= 0 ? lineEnd + 1 : source.length;
  return { changed: true, content: `${source.slice(0, insertAt)}${insertion}\n${source.slice(insertAt)}`, reason: "inserted_after_anchor" };
}

function appendUniqueLine(source, line) {
  if (source.includes(line)) return { changed: false, content: source, reason: "line_already_present" };
  return { changed: true, content: `${source.replace(/\s*$/, "")}\n${line}\n`, reason: "line_appended" };
}

export function previewSemanticPatches(input = {}) {
  const operations = Array.isArray(input.operations) ? input.operations : [];
  const previews = operations.map((operation) => {
    const type = safeString(operation.type || operation.operation, 96);
    const source = String(operation.content || "");
    let result = { changed: false, content: source, reason: "unsupported_operation" };
    if (type === "insert_import_if_missing") result = insertImportIfMissing(source, safeString(operation.named_import, 128), safeString(operation.from, 256));
    if (type === "insert_after_anchor_if_missing" || type === "insert_route_mount_if_missing") result = insertAfterAnchorIfMissing(source, String(operation.anchor || ""), String(operation.insertion || ""));
    if (type === "append_unique_line") result = appendUniqueLine(source, String(operation.line || ""));
    return sanitize({ operation: type, path: safeString(operation.path, 512), changed: result.changed, reason: result.reason, preview: result.content.slice(0, Number(input.max_preview_chars || 4000)), secrets_included: false });
  });
  return { ok: true, preview_id: randomUUID(), preview_count: previews.length, previews, secrets_included: false };
}

function resolveAnalysisInput(input = {}) {
  if (input.analysis?.classification) return sanitize(input.analysis);
  if (input.classification) return sanitize(input);
  return analyzeRepoConflict(input);
}

function buildResolverOperations(analysis = {}) {
  const files = Array.isArray(analysis.files) ? analysis.files : [];
  return files.map((file) => {
    if (file.strategy === "manual_required" || file.auto_resolve === false) {
      return { type: "manual_review", path: file.path, path_class: file.path_class, strategy: "manual_required", execution_allowed: false };
    }
    if (file.generated) {
      return { type: "exclude_generated_artifact", path: file.path, path_class: file.path_class, strategy: file.strategy, regenerate_after_merge: true };
    }
    if (["route_mount", "test_manifest"].includes(file.path_class)) {
      return { type: "semantic_patch_preview", path: file.path, path_class: file.path_class, strategy: file.strategy, apply_requires_capability_envelope: true };
    }
    if (file.path_class === "database_migration") {
      return { type: "append_additive_migration", path: file.path, path_class: file.path_class, strategy: file.strategy, migration_preflight_required: true };
    }
    return { type: "replay_file_from_source_branch", path: file.path, path_class: file.path_class, strategy: file.strategy, apply_requires_capability_envelope: true };
  });
}

export function buildRepoConflictResolutionDryRun(input = {}) {
  const analysis = resolveAnalysisInput(input);
  const plan = buildRepoConflictPlan(analysis);
  const manualBlocked = analysis.recommended_path === "manual_required" || (analysis.manual_required || []).length > 0;
  return sanitize({
    ok: true,
    dry_run_id: randomUUID(),
    mode: "dry_run",
    classification: analysis.classification,
    recommended_path: analysis.recommended_path,
    resolution_status: manualBlocked ? "blocked_manual_review" : "ready_for_review",
    execution_allowed: false,
    provider_write: false,
    branch_mutation: false,
    comment_posted: false,
    capability_envelope_required_for_apply: !manualBlocked,
    approval_required_for_apply: !manualBlocked,
    operations: buildResolverOperations(analysis),
    blocked_paths: analysis.manual_required || [],
    acceptance_gates: plan.acceptance_gates,
    continuation: manualBlocked
      ? { action: "request_human_review" }
      : { action: "create_plan_bound_capability_envelope", apply_endpoint_available: false },
    secrets_included: false,
  });
}

function formatPrAdvisoryMarkdown(pullNumber, analysis, plan, dryRun) {
  const prLabel = pullNumber ? `PR #${pullNumber}` : "Pull request";
  const actionLines = dryRun.operations.slice(0, 10).map((operation) => `- \`${operation.type}\`: \`${operation.path}\``);
  return [
    `### Repository Conflict Intelligence — ${prLabel}`,
    "",
    `- Classification: \`${analysis.classification}\``,
    `- Recommended path: \`${analysis.recommended_path}\``,
    `- Files analyzed: ${analysis.summary?.file_count || 0}`,
    `- Generated artifacts: ${analysis.summary?.generated_count || 0}`,
    `- Manual-review paths: ${analysis.summary?.manual_required_count || 0}`,
    "",
    "#### Proposed no-mutation plan",
    ...actionLines,
    "",
    `Acceptance gates: ${(plan.acceptance_gates || []).map((gate) => `\`${gate}\``).join(", ")}`,
    "",
    "> Preview only. No GitHub comment, branch update, merge, or provider write was performed.",
  ].join("\n");
}

export function buildPrAutomationPreview(input = {}) {
  const analysis = resolveAnalysisInput(input);
  const plan = buildRepoConflictPlan(analysis);
  const dryRun = buildRepoConflictResolutionDryRun({ analysis });
  const pullNumber = Number(input.pull_number || input.pullNumber || 0) || null;
  const commentRequired = analysis.classification !== "clean_or_no_conflict";
  return sanitize({
    ok: true,
    automation_preview_id: randomUUID(),
    pull_number: pullNumber,
    decision: commentRequired ? "advisory_comment_recommended" : "no_comment_required",
    comment_required: commentRequired,
    approval_hold_required: commentRequired,
    provider_write: false,
    comment_posted: false,
    plan_binding_required: true,
    classification: analysis.classification,
    recommended_path: analysis.recommended_path,
    comment: {
      format: "markdown",
      markdown: formatPrAdvisoryMarkdown(pullNumber, analysis, plan, dryRun),
      bounded: true,
    },
    dry_run_id: dryRun.dry_run_id,
    safe_next_actions: commentRequired
      ? ["create_repository_advisory_comment_approval_hold", "request_typed_approval"]
      : ["continue_ci_monitoring"],
    secrets_included: false,
  });
}

const BUILT_IN_CONFLICT_CASE_STUDIES = {
  pr_2474_generated_docs_conflict: {
    case_key: "pr_2474_generated_docs_conflict",
    title: "PR 2474 generated documentation conflict",
    pull_number: 2474,
    base: "main",
    head: "gpt/repo-conflict-intelligence-dynamic-20260710",
    compare: { mergeable: false, mergeable_state: "dirty" },
    commits: [{ sha: "6d1f3c56540a74d1f1a7c106d22345d1e85791bf", author: { login: "docs-agent[bot]" }, message: "Docs agent: update generated documentation" }],
    files: [
      { filename: "docs/auto-docs-agent/pr-2470.md", status: "conflicting", conflicted: true },
      { filename: "docs/work-maps/generated.json", status: "modified" },
      { filename: "http-generic-api/routes/index.js", status: "modified" },
      { filename: "http-generic-api/repoConflictIntelligenceService.js", status: "added" },
    ],
  },
};

export function buildConflictCaseStudy(caseKey) {
  const caseInput = BUILT_IN_CONFLICT_CASE_STUDIES[safeString(caseKey, 128)];
  if (!caseInput) {
    const error = new Error("Repository conflict case study was not found.");
    error.status = 404;
    error.code = "repo_conflict_case_study_not_found";
    throw error;
  }
  const analysis = analyzeRepoConflict(caseInput);
  return sanitize({
    ok: true,
    case_key: caseInput.case_key,
    title: caseInput.title,
    analysis,
    plan: buildRepoConflictPlan(analysis),
    dry_run: buildRepoConflictResolutionDryRun({ analysis }),
    automation_preview: buildPrAutomationPreview({ ...caseInput, analysis }),
    secrets_included: false,
  });
}

export function buildTenantConflictResolutionDryRun(input = {}) {
  const dryRun = buildRepoConflictResolutionDryRun(input);
  return sanitize({
    ok: true,
    scope: "tenant",
    classification: dryRun.classification,
    recommended_path: dryRun.recommended_path === "manual_required" ? "request_admin_review" : "request_admin_resolution",
    resolution_status: dryRun.resolution_status,
    execution_allowed: false,
    provider_write: false,
    operations: dryRun.operations.map((operation) => ({ type: operation.type, path: operation.path, path_class: operation.path_class, strategy: operation.strategy })),
    safe_next_actions: ["request_admin_resolution"],
    secrets_included: false,
  });
}

export function buildTenantConflictSummary(input = {}) {
  const analysis = analyzeRepoConflict(input);
  return sanitize({ ok: true, scope: "tenant", classification: analysis.classification, recommended_path: analysis.recommended_path === "manual_required" ? "request_admin_review" : "request_admin_resolution", summary: analysis.summary, tenant_visible_files: analysis.files.map((file) => ({ path: file.path, path_class: file.path_class, strategy: file.strategy, risk: file.risk })), secrets_included: false });
}
