import { createHash, randomUUID } from "node:crypto";

import { GITHUB_API_BASE_URL } from "./config.js";
import { getPool } from "./db.js";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import {
  createRepositoryAuthorityBinding,
  normalizeGithubRepoRef,
  revokeRepositoryAuthorityBinding,
  smokeSafeTenantId,
  tenantRepositoryActionPlannerDryRun,
} from "./repositoryTenantIntelligenceV2.js";

export const REPOSITORY_ADVISORY_COMMENT_V5_SCHEMA = "tenant_repository_advisory_comment.v5";
export const REPOSITORY_ADVISORY_COMMENT_V5_GATE = "post_advisory_comment_only";
const FORBIDDEN_MUTATIONS = ["close", "label", "merge", "patch", "force_push", "migration_apply"];

function s(value) { return String(value || "").trim(); }
function sha256(value = "") { return createHash("sha256").update(String(value)).digest("hex"); }
function jsonPreview(value = {}, max = 12000) { const text = JSON.stringify(value || {}, null, 2); return text.length > max ? text.slice(0, max) : text; }
function parseJson(value, fallback = null) { try { return typeof value === "string" ? JSON.parse(value) : (value ?? fallback); } catch { return fallback; } }
function yes(value, fallback = false) { if (typeof value === "boolean") return value; if (value == null || value === "") return fallback; return ["1", "true", "yes", "on"].includes(String(value).toLowerCase()); }
function scopeFrom(args = {}, auth = {}) {
  const options = args.options && typeof args.options === "object" ? args.options : {};
  const isAdmin = auth?.is_admin === true;
  return {
    tenant_id: (isAdmin ? s(args.tenant_id || options.tenant_id) : s(auth.tenant_id || args.tenant_id || options.tenant_id)) || null,
    workspace_id: s(args.workspace_id || options.workspace_id) || null,
    user_id: (isAdmin ? s(args.user_id || options.user_id) : s(auth.user_id || args.user_id || options.user_id)) || null,
  };
}
function requireScope(scope = {}) {
  if (!scope.tenant_id && !scope.workspace_id && !scope.user_id) {
    const err = new Error("Repository advisory comments require tenant_id, workspace_id, or user_id scope.");
    err.status = 400; err.code = "repository_advisory_comment_scope_required"; throw err;
  }
}
function requireGithubToken() {
  if (!GITHUB_TOKEN) { const err = new Error("Missing required environment variable: GITHUB_TOKEN"); err.status = 500; err.code = "missing_github_token"; throw err; }
  return GITHUB_TOKEN;
}
async function githubJson({ method = "GET", pathname, searchParams } = {}) {
  const url = new URL(`${GITHUB_API_BASE_URL}${pathname}`);
  for (const [key, value] of Object.entries(searchParams || {})) if (value !== undefined && value !== null && String(value).trim() !== "") url.searchParams.set(key, String(value));
  const response = await fetch(url, { method, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${requireGithubToken()}`, "X-GitHub-Api-Version": "2022-11-28" } });
  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = { message: raw }; }
  if (!response.ok) { const err = new Error(payload?.message || `GitHub request failed with status ${response.status}.`); err.status = response.status || 502; err.code = "github_advisory_comment_read_failed"; err.details = payload || null; throw err; }
  return payload;
}
async function listPrComments({ owner, repo, pull_number }) {
  const payload = await githubJson({ pathname: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(String(pull_number))}/comments`, searchParams: { per_page: 100 } });
  return Array.isArray(payload) ? payload.map((c) => ({ id: c.id || null, html_url: c.html_url || "", user_login: c.user?.login || null, body: c.body || "" })) : [];
}
async function getIssueComment({ owner, repo, comment_id }) {
  const c = await githubJson({ pathname: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/comments/${encodeURIComponent(String(comment_id))}` });
  return { id: c?.id || Number(comment_id), html_url: c?.html_url || "", user_login: c?.user?.login || null, body: c?.body || "" };
}

export async function ensureRepositoryAdvisoryCommentPlansTable() {
  await getPool().query(`CREATE TABLE IF NOT EXISTS repository_advisory_comment_plans (
    plan_id varchar(36) NOT NULL,
    tenant_id varchar(36) NULL,
    workspace_id varchar(64) NULL,
    user_id varchar(64) NULL,
    resource_uri varchar(255) NOT NULL,
    owner_name varchar(128) NOT NULL,
    repo_name varchar(128) NOT NULL,
    pr_number int NOT NULL,
    classification varchar(96) NOT NULL,
    planned_comment_type varchar(96) NOT NULL,
    comment_preview_sha256 varchar(64) NOT NULL,
    comment_preview_markdown longtext NOT NULL,
    source_report_evidence_id varchar(36) NULL,
    source_planner_evidence_id varchar(36) NULL,
    approval_hold_id varchar(36) NULL,
    status enum('preview_created','approval_required','approved','posted','readback_verified','blocked','failed','retracted_manually') NOT NULL DEFAULT 'approval_required',
    posted_comment_id varchar(64) NULL,
    posted_comment_url varchar(512) NULL,
    readback_status varchar(64) NULL,
    readback_json longtext NULL,
    metadata_json longtext NULL,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (plan_id),
    KEY idx_repo_advisory_comment_plans_repo_pr (owner_name, repo_name, pr_number),
    KEY idx_repo_advisory_comment_plans_status (status),
    KEY idx_repo_advisory_comment_plans_tenant (tenant_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

export function selectRepositoryAdvisoryCommentType(plan = {}) {
  const action = s(plan.planned_action);
  const classification = s(plan.classification);
  if (action === "run_or_wait_for_ci_recommendation" || classification === "clean_but_ci_missing") return "ci_wait_advisory";
  if (action === "migration_conflict_review_plan" || classification.includes("migration") || classification === "duplicate_migration_conflict") return "migration_conflict_advisory";
  if (action === "close_superseded_dry_run" || classification === "stale_docs_agent_only") return "stale_docs_agent_advisory";
  if (action === "block_merge_manual_fix_plan" || classification === "unsafe_to_merge") return "unsafe_to_merge_advisory";
  return "manual_review_advisory";
}
function recommendation(plan = {}) {
  switch (selectRepositoryAdvisoryCommentType(plan)) {
    case "ci_wait_advisory": return "Wait for CI, rerun checks, or inspect missing checks before any merge decision.";
    case "migration_conflict_advisory": return "Run a manual migration conflict review before merge or branch repair.";
    case "stale_docs_agent_advisory": return "Review the docs-agent backlog manually before closing or superseding this PR.";
    case "unsafe_to_merge_advisory": return "Do not merge until failed checks or unsafe repository signals are resolved.";
    default: return "Assign human review because the read-only signal is insufficient for automation.";
  }
}
function marker(planId, bodyHash) { return `<!-- repository-intelligence-advisory:v5 plan_id=${planId} preview_sha256=${bodyHash} -->`; }

export function buildRepositoryAdvisoryCommentPreviewV5({ repoRef = {}, plan = {}, plan_id = randomUUID(), source_report_evidence_id = null, source_planner_evidence_id = null } = {}) {
  const planned_comment_type = selectRepositoryAdvisoryCommentType(plan);
  const classification = s(plan.classification || "manual_review_required");
  const pr_number = Number(plan.pr_number || plan.number || 0);
  const title = s(plan.title || "Untitled PR");
  const evidence = [source_report_evidence_id, source_planner_evidence_id].filter(Boolean).join(" / ") || "bounded-preview";
  const bodyWithoutMarker = [
    "## Repository Intelligence Advisory",
    "",
    `PR: #${pr_number} — ${title}`,
    `Classification: ${classification}`,
    `Advisory type: ${planned_comment_type}`,
    `Recommended manual action: ${recommendation(plan)}`,
    `Evidence: ${evidence}`,
    "",
    "Safety: This is advisory only. No repository mutation was executed by this advisory preview.",
    "Mutation boundary: no close, no label, no merge, no file patch, no force-push, and no migration apply.",
    "",
    `Gate: ${REPOSITORY_ADVISORY_COMMENT_V5_GATE}; approval is required before posting this comment.`,
  ].join("\n");
  const bodyHash = sha256(bodyWithoutMarker);
  const body = `${marker(plan_id, bodyHash)}\n${bodyWithoutMarker}`;
  return { schema_version: REPOSITORY_ADVISORY_COMMENT_V5_SCHEMA, engine_version: "v5_approval_gated_advisory_comment", mode: "approval_gated_comment_preview", plan_id, resource_uri: repoRef.resource_uri || null, owner: repoRef.owner || null, repo: repoRef.repo || null, pr_number, classification, planned_comment_type, comment_preview_markdown: body, comment_preview_sha256: sha256(body), body_without_marker_sha256: bodyHash, source_report_evidence_id, source_planner_evidence_id, requires_approval: true, allowed_action: REPOSITORY_ADVISORY_COMMENT_V5_GATE, forbidden_mutations: FORBIDDEN_MUTATIONS, apply_allowed: false, mutations_executed: false, secrets_included: false };
}

function rowToPlan(row = {}) {
  return { plan_id: row.plan_id, tenant_id: row.tenant_id || null, workspace_id: row.workspace_id || null, user_id: row.user_id || null, resource_uri: row.resource_uri, owner: row.owner_name, repo: row.repo_name, pr_number: Number(row.pr_number || 0), classification: row.classification, planned_comment_type: row.planned_comment_type, comment_preview_sha256: row.comment_preview_sha256, comment_preview_markdown: row.comment_preview_markdown, source_report_evidence_id: row.source_report_evidence_id || null, source_planner_evidence_id: row.source_planner_evidence_id || null, approval_hold_id: row.approval_hold_id || null, status: row.status, posted_comment_id: row.posted_comment_id || null, posted_comment_url: row.posted_comment_url || null, readback_status: row.readback_status || null, readback: parseJson(row.readback_json, null), metadata: parseJson(row.metadata_json, null), secrets_included: false };
}
async function readPlan(planId) { await ensureRepositoryAdvisoryCommentPlansTable(); const [rows] = await getPool().query("SELECT * FROM repository_advisory_comment_plans WHERE plan_id = ? LIMIT 1", [planId]); return rows[0] ? rowToPlan(rows[0]) : null; }
async function recordEvidence({ action, evidenceType, scope = {}, repoRef = {}, preview = {}, response = {} } = {}) {
  const evidenceId = randomUUID();
  const requestPreview = jsonPreview({ plan_id: preview.plan_id, owner: repoRef.owner, repo: repoRef.repo, pr_number: preview.pr_number, action });
  const responsePreview = jsonPreview({ classification: response.classification || preview.classification, status: response.status || preview.status || null, comment_id: response.comment_id || null, mutations_executed: response.mutations_executed === true, secrets_included: false });
  await getPool().query(
    `INSERT INTO audit_payload_evidence (evidence_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, source_table, source_pk, evidence_type, request_preview, request_sha256, response_preview, response_sha256, metadata_json, redaction_status, secrets_included)
     VALUES (?, ?, ?, ?, ?, 'github_pull_request', ?, 'repository_advisory_comment_plans', ?, ?, ?, ?, ?, ?, ?, 'not_required', 0)`,
    [evidenceId, scope.tenant_id, scope.user_id, scope.user_id ? "user" : "tenant_or_workspace", action, `${repoRef.resource_uri}/pull/${preview.pr_number}`, preview.plan_id || null, evidenceType, requestPreview, sha256(requestPreview), responsePreview, sha256(responsePreview), JSON.stringify({ schema_version: evidenceType, advisory_schema_version: REPOSITORY_ADVISORY_COMMENT_V5_SCHEMA, allowed_action: REPOSITORY_ADVISORY_COMMENT_V5_GATE, apply_allowed: response.apply_allowed === true, mutations_executed: response.mutations_executed === true, secrets_included: false })]
  );
  return { evidence_id: evidenceId, secrets_included: false };
}

export async function tenantRepositoryAdvisoryCommentPreview(args = {}, { auth, runGovernedResource } = {}) {
  const repoRef = normalizeGithubRepoRef(args);
  if (!repoRef) { const err = new Error("tenant_repository_advisory_comment_preview requires owner/repo or github://owner/repo."); err.status = 400; err.code = "github_repo_ref_required"; throw err; }
  const scope = scopeFrom(args, auth); requireScope(scope);
  await ensureRepositoryAdvisoryCommentPlansTable();
  const planner = args.plan ? null : await tenantRepositoryActionPlannerDryRun({ ...args, record_evidence: true, include_markdown: false }, { auth, runGovernedResource });
  if (planner && !planner.ok) return { ...planner, tool: "tenant_repository_advisory_comment_preview", classification: "repository_advisory_comment_preview_blocked", apply_allowed: false, mutations_executed: false, secrets_included: false };
  const plans = args.plan ? [args.plan] : (planner?.plan?.plans || []);
  const requestedPr = Number(args.pr_number || args.pull_number || 0);
  const selected = requestedPr ? plans.find((p) => Number(p.pr_number) === requestedPr) : plans[0];
  if (!selected) return { ok: false, tool: "tenant_repository_advisory_comment_preview", classification: "repository_advisory_comment_no_eligible_plan", reason_code: "no_matching_v4_plan", apply_allowed: false, mutations_executed: false, secrets_included: false };
  const preview = buildRepositoryAdvisoryCommentPreviewV5({ repoRef, plan: selected, source_report_evidence_id: args.source_report_evidence_id || null, source_planner_evidence_id: args.source_planner_evidence_id || planner?.evidence?.evidence_id || null });
  await getPool().query(
    `INSERT INTO repository_advisory_comment_plans (plan_id, tenant_id, workspace_id, user_id, resource_uri, owner_name, repo_name, pr_number, classification, planned_comment_type, comment_preview_sha256, comment_preview_markdown, source_report_evidence_id, source_planner_evidence_id, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approval_required', ?)`,
    [preview.plan_id, scope.tenant_id, scope.workspace_id, scope.user_id, repoRef.resource_uri, repoRef.owner, repoRef.repo, preview.pr_number, preview.classification, preview.planned_comment_type, preview.comment_preview_sha256, preview.comment_preview_markdown, preview.source_report_evidence_id, preview.source_planner_evidence_id, JSON.stringify({ selected_plan: selected, planner_classification: planner?.classification || null, forbidden_mutations: FORBIDDEN_MUTATIONS, secrets_included: false })]
  );
  const evidence = await recordEvidence({ action: "tenant_repository_advisory_comment_preview", evidenceType: "repository_advisory_comment_preview_v5", scope, repoRef, preview, response: { classification: "repository_advisory_comment_preview_created", status: "approval_required", mutations_executed: false } });
  return { ok: true, tool: "tenant_repository_advisory_comment_preview", classification: "repository_advisory_comment_preview_created", preview, plan_id: preview.plan_id, evidence, requires_approval: true, apply_allowed: false, mutations_executed: false, secrets_included: false };
}

async function approvalStatus(approvalHoldId = "", plan = {}) {
  const holdId = s(approvalHoldId || plan.approval_hold_id);
  if (!holdId) return { ok: false, reason_code: "approval_hold_required" };
  const [rows] = await getPool().query("SELECT hold_id, status, expires_at FROM approval_holds WHERE hold_id = ? LIMIT 1", [holdId]);
  const hold = rows[0];
  if (!hold) return { ok: false, reason_code: "approval_hold_not_found", approval_hold_id: holdId };
  if (hold.status !== "approved") return { ok: false, reason_code: "approval_hold_not_approved", approval_hold_id: holdId, status: hold.status };
  if (hold.expires_at && new Date(hold.expires_at).getTime() < Date.now()) return { ok: false, reason_code: "approval_hold_expired", approval_hold_id: holdId };
  return { ok: true, approval_hold_id: holdId };
}

export async function tenantRepositoryAdvisoryCommentApply(args = {}, { auth } = {}) {
  const planId = s(args.plan_id);
  if (!planId) { const err = new Error("plan_id is required."); err.status = 400; err.code = "repository_advisory_comment_plan_id_required"; throw err; }
  const plan = await readPlan(planId);
  if (!plan) { const err = new Error(`Repository advisory comment plan not found: ${planId}`); err.status = 404; err.code = "repository_advisory_comment_plan_not_found"; throw err; }
  const repoRef = normalizeGithubRepoRef({ owner: plan.owner, repo: plan.repo });
  const scope = { tenant_id: plan.tenant_id, workspace_id: plan.workspace_id, user_id: plan.user_id || auth?.user_id || null };
  const approval = await approvalStatus(args.approval_hold_id, plan);
  if (!approval.ok) {
    await getPool().query("UPDATE repository_advisory_comment_plans SET status = 'blocked', approval_hold_id = COALESCE(?, approval_hold_id), updated_at = CURRENT_TIMESTAMP WHERE plan_id = ?", [args.approval_hold_id || null, planId]);
    return { ok: false, tool: "tenant_repository_advisory_comment_apply", classification: "repository_advisory_comment_apply_approval_required", reason_code: approval.reason_code, approval, plan_id: planId, apply_allowed: false, mutations_executed: false, secrets_included: false };
  }
  if (sha256(plan.comment_preview_markdown) !== plan.comment_preview_sha256) return { ok: false, tool: "tenant_repository_advisory_comment_apply", classification: "repository_advisory_comment_preview_hash_mismatch", plan_id: planId, apply_allowed: false, mutations_executed: false, secrets_included: false };
  const comments = await listPrComments({ owner: plan.owner, repo: plan.repo, pull_number: plan.pr_number });
  const duplicate = comments.find((c) => String(c.body || "").includes(`repository-intelligence-advisory:v5 plan_id=${planId}`) || String(c.body || "").includes(`preview_sha256=${plan.comment_preview_sha256}`));
  if (duplicate) return { ok: false, tool: "tenant_repository_advisory_comment_apply", classification: "repository_advisory_comment_duplicate_blocked", plan_id: planId, existing_comment_id: duplicate.id || null, apply_allowed: false, mutations_executed: false, secrets_included: false };
  if (yes(args.dry_run, false)) return { ok: true, tool: "tenant_repository_advisory_comment_apply", classification: "repository_advisory_comment_apply_dry_run_ready", plan_id: planId, would_post_comment: true, apply_allowed: false, mutations_executed: false, secrets_included: false };
  const posted = await githubCommentOnPR({ input: { owner: plan.owner, repo: plan.repo, pull_number: plan.pr_number, body: plan.comment_preview_markdown } });
  await getPool().query("UPDATE repository_advisory_comment_plans SET status = 'posted', approval_hold_id = ?, posted_comment_id = ?, posted_comment_url = ?, updated_at = CURRENT_TIMESTAMP WHERE plan_id = ?", [approval.approval_hold_id, String(posted.comment_id || ""), posted.html_url || "", planId]);
  await recordEvidence({ action: "tenant_repository_advisory_comment_apply", evidenceType: "repository_advisory_comment_apply_v5", scope, repoRef, preview: plan, response: { classification: "repository_advisory_comment_posted", comment_id: posted.comment_id, mutations_executed: true, apply_allowed: true } });
  const readback = await tenantRepositoryAdvisoryCommentReadback({ plan_id: planId }, { auth });
  return { ok: readback.ok === true, tool: "tenant_repository_advisory_comment_apply", classification: readback.ok ? "repository_advisory_comment_posted_and_verified" : "repository_advisory_comment_posted_readback_failed", plan_id: planId, posted_comment_id: posted.comment_id || null, posted_comment_url: posted.html_url || "", readback, apply_allowed: true, mutations_executed: true, mutation_type: "github_issue_comment_create", forbidden_mutations: FORBIDDEN_MUTATIONS, secrets_included: false };
}

export async function tenantRepositoryAdvisoryCommentReadback(args = {}, { auth } = {}) {
  const planId = s(args.plan_id);
  const plan = await readPlan(planId);
  if (!plan) { const err = new Error(`Repository advisory comment plan not found: ${planId}`); err.status = 404; err.code = "repository_advisory_comment_plan_not_found"; throw err; }
  if (!plan.posted_comment_id) return { ok: false, tool: "tenant_repository_advisory_comment_readback", classification: "repository_advisory_comment_not_posted", plan_id: planId, apply_allowed: false, mutations_executed: false, secrets_included: false };
  const comment = await getIssueComment({ owner: plan.owner, repo: plan.repo, comment_id: plan.posted_comment_id });
  const body = String(comment.body || "");
  const body_sha256_matches = sha256(body) === plan.comment_preview_sha256;
  const marker_matches = body.includes(`repository-intelligence-advisory:v5 plan_id=${planId}`);
  const verified = body_sha256_matches && marker_matches;
  const readback = { comment_id: comment.id || plan.posted_comment_id, html_url: comment.html_url || plan.posted_comment_url || null, body_sha256_matches, marker_matches, author: comment.user_login || null, secrets_included: false };
  await getPool().query("UPDATE repository_advisory_comment_plans SET status = ?, readback_status = ?, readback_json = ?, updated_at = CURRENT_TIMESTAMP WHERE plan_id = ?", [verified ? "readback_verified" : "failed", verified ? "verified" : "mismatch", JSON.stringify(readback), planId]);
  await recordEvidence({ action: "tenant_repository_advisory_comment_readback", evidenceType: "repository_advisory_comment_readback_v5", scope: { tenant_id: plan.tenant_id, workspace_id: plan.workspace_id, user_id: plan.user_id || auth?.user_id || null }, repoRef: normalizeGithubRepoRef({ owner: plan.owner, repo: plan.repo }), preview: plan, response: { classification: verified ? "repository_advisory_comment_readback_verified" : "repository_advisory_comment_readback_failed", comment_id: comment.id || null, mutations_executed: false } });
  return { ok: verified, tool: "tenant_repository_advisory_comment_readback", classification: verified ? "repository_advisory_comment_readback_verified" : "repository_advisory_comment_readback_failed", plan_id: planId, readback, apply_allowed: false, mutations_executed: false, secrets_included: false };
}

export async function tenantRepositoryAdvisoryCommentV5ReadinessSmoke(args = {}, { auth, runGovernedResource } = {}) {
  const tenantId = smokeSafeTenantId(args.tenant_id || `repository_advisory_comment_v5_${randomUUID()}`);
  const repoRef = normalizeGithubRepoRef(args) || normalizeGithubRepoRef({ owner: "mad4bdigital-ai", repo: "multi-business-multi-role-growth-intelligence-os" });
  const create = await createRepositoryAuthorityBinding({ tenant_id: tenantId, owner: repoRef.owner, repo: repoRef.repo, permission_level: "read_only", allowed_modes: ["read_only"], notes: "temporary repository advisory comment v5 readiness smoke binding", created_by: "system:tenant_repository_advisory_comment_v5_readiness_smoke" }, { auth: { ...(auth || {}), is_admin: true } });
  const preview = await tenantRepositoryAdvisoryCommentPreview({ tenant_id: tenantId, owner: repoRef.owner, repo: repoRef.repo, state: "open", limit: 1, include_changed_files: false, include_check_runs: false }, { auth, runGovernedResource });
  const blockedApply = preview?.plan_id ? await tenantRepositoryAdvisoryCommentApply({ plan_id: preview.plan_id }, { auth }) : null;
  const bindingId = create?.binding?.binding_id;
  const revoke = bindingId ? await revokeRepositoryAuthorityBinding({ binding_id: bindingId, revoked_by: "system:tenant_repository_advisory_comment_v5_readiness_smoke_cleanup" }, { auth: { ...(auth || {}), is_admin: true } }) : null;
  const checks = [
    { name: "binding_created_read_only", pass: create?.ok === true && create?.binding?.permission_level === "read_only" },
    { name: "v5_preview_created", pass: preview?.ok === true && preview?.preview?.schema_version === REPOSITORY_ADVISORY_COMMENT_V5_SCHEMA && preview?.mutations_executed === false },
    { name: "v5_apply_blocks_without_approval", pass: blockedApply?.ok === false && blockedApply?.reason_code === "approval_hold_required" && blockedApply?.mutations_executed === false },
    { name: "cleanup_revoked_binding", pass: revoke?.ok === true },
  ];
  const pass = checks.every((check) => check.pass === true);
  return { ok: pass, tool: "tenant_repository_advisory_comment_v5_readiness_smoke", status: pass ? "pass" : "fail", classification: pass ? "repository_advisory_comment_v5_ready" : "repository_advisory_comment_v5_not_ready", checks, preview: preview?.ok ? { plan_id: preview.plan_id, classification: preview.classification, pr_number: preview.preview?.pr_number || null } : preview, blocked_apply: blockedApply, binding_id: bindingId || null, apply_allowed: false, mutations_executed: false, secrets_included: false };
}

export const TENANT_REPOSITORY_ADVISORY_COMMENT_V5_SYSTEM_TOOLS = [
  { name: "tenant_repository_advisory_comment_preview", description: "Repository Intelligence V5 preview for approval-gated advisory GitHub PR comments. Creates bounded comment preview and internal evidence only; no GitHub write.", requires_admin: true, inputSchema: { type: "object", properties: { tenant_id: { type: "string" }, workspace_id: { type: "string" }, user_id: { type: "string" }, owner: { type: "string" }, repo: { type: "string" }, resource_uri: { type: "string" }, pr_number: { type: "integer" }, state: { type: "string", default: "open" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } }, required: [] } },
  { name: "tenant_repository_advisory_comment_apply", description: "Repository Intelligence V5 approval-gated comment-only apply. Posts exactly one advisory PR comment after approved approval_hold_id; never labels, closes, merges, patches, force-pushes, or applies migrations.", requires_admin: true, inputSchema: { type: "object", properties: { plan_id: { type: "string" }, approval_hold_id: { type: "string" }, dry_run: { type: "boolean", default: false } }, required: ["plan_id"] } },
  { name: "tenant_repository_advisory_comment_readback", description: "Repository Intelligence V5 readback for posted advisory PR comments. Verifies comment id, marker, body hash, and no-secret bounded metadata.", requires_admin: true, inputSchema: { type: "object", properties: { plan_id: { type: "string" } }, required: ["plan_id"] } },
  { name: "tenant_repository_advisory_comment_v5_readiness_smoke", description: "Repository Intelligence V5 smoke. Creates preview and proves apply is blocked without approval; no GitHub comment is posted by default.", requires_admin: true, inputSchema: { type: "object", properties: { tenant_id: { type: "string" }, owner: { type: "string" }, repo: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 5, default: 1 } }, required: [] } },
];
