import { Router } from "express";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getPool } from "../db.js";
import { getGitHubAppInstallationToken } from "../githubAppAuth.js";
import { resolveActivationBootstrapConfig } from "../activationBootstrapConfig.js";
import { writeAuditLog, writeAuditLogAsync } from "../auditLogger.js";
import { recordGptSessionTurn } from "../sessionArchiveService.js";
import {
  findActiveGrantForTool,
  validateArgsAgainstGrant,
  recordGrantUse,
} from "../scopeGrantsService.js";
import { cachedSqlRead, sqlCacheKey, toolCacheTtl } from "../sqlCache.js";
import {
  assertTenantToolManifestAllows,
  filterTenantToolsByManifest,
  loadTenantToolManifestBlocks,
} from "../tenantToolManifestGuard.js";
import {
  assertTenantToolSchemaAllows,
  filterTenantToolsByStrictSchema,
  loadTenantToolSchemaBlocks,
} from "../tenantToolSchemaGuard.js";
import {
  GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY,
  extendGovernedToolResponseChunkExpiry,
  loadGovernedToolResponseChunk,
  persistGovernedToolResponseChunk,
} from "../governedToolResponseChunkStore.js";
import { runGovernedResponseChunkDurableRecoverySmoke } from "../governedResponseChunkDurableRecoverySmoke.js";
import { bootstrapGovernedMigrationAuthorization } from "../governedMigrationAuthorizationBootstrap.js";
import { bootstrapGovernedMigrationApplyPolicy } from "../governedMigrationApplyPolicyBootstrap.js";
import { authorizeCapabilityResolutionEnvelopeApply } from "../scripts/capability-resolution-envelope-apply-authorize.mjs";
import { runGovernedMigrationExecution } from "../governedMigrationExecutionTool.js";
import { runGovernedMigrationSchemaReadback } from "../governedMigrationSchemaReadbackTool.js";
import { runDynamicContainerProjectionApply } from "../dynamicContainerProjectionApplyTool.js";
import {
  buildSqlCacheOperationalDiagnostics,
  runSqlCacheControlledLoadTest,
} from "../sqlCacheOperationalDiagnostics.js";
import { buildActivationGatewayRolloutPlan, runActivationGatewayDarkDeploy } from "../activationGatewayRolloutTool.js";
import { buildAuthMad4bProxyRolloutPlan, runAuthMad4bProxyRollout } from "../authMad4bProxyRolloutTool.js";
import { evaluateRepoPatchApplyPreflight, evaluateGptToolDispatchPreflight, assertPreflightAllowed } from "../governedExecutionPreflight.js";
import {
  CAPABILITY_ENVELOPE_BATCH_EXPIRE_MODES,
  CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS,
  capabilityEnvelopeError,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
  runCapabilityEnvelopeBatchExpire,
  transitionCapabilityEnvelopeLifecycle,
} from "../capabilityResolutionEnvelopeGuard.js";
import { runAdminBranchReconcile, runGithubBranchFastForwardSmoke, runGithubBranchFastForwardToBase, runGithubBranchMergeCommitCreate } from "../adminBranchReconciliationAdapter.js";
import { runRepositoryReconciliationOrchestrator } from "../repositoryReconciliationOrchestrator.js";
import { applyGithubExistingBlobChangeSet, applyGithubRepositoryChangeSet, deleteGithubBranchRef, finalizeGithubPullRequest, getGithubPullRequestCiGate } from "../githubRepositoryLifecycle.js";
import { runGithubBranchCleanupSweep } from "../githubBranchCleanupSweep.js";
import { runGithubSupersededBranchCleanup } from "../githubSupersededBranchCleanup.js";
import { runRepositoryCloseSupersededPositiveSmokeV6 } from "../repositoryCloseSupersededPositiveSmoke.js";
import { applyUnifiedDiffToText } from "../unifiedDiff.js";
export { applyUnifiedDiffToText };
import { buildPlatformCapabilityContractReport, buildPlatformCapabilityLiveReport } from "../platformCapabilityReports.js";
import { buildDynamicCapabilityGovernancePreview } from "../dynamicCapabilityGovernanceCompiler.js";
import { buildDynamicCapabilityProjectionPreview } from "../dynamicCapabilityProjectionPreview.js";
import { buildDynamicCapabilityEnforcementShadow } from "../dynamicCapabilityEnforcementShadow.js";
import { buildDynamicCapabilityCertificationReadbackPreview } from "../dynamicCapabilityCertificationReadback.js";
import { buildTenantConnectionOperationPreview } from "../tenantConnectionOperationPreview.js";
import {
  CAPABILITY_GOVERNANCE_PERSIST_CONFIRM,
  persistDynamicCapabilityGovernanceCompilation,
} from "../dynamicCapabilityGovernancePersistence.js";
import {
  TENANT_CONNECTION_SHADOW_CONTRACT_BOOTSTRAP_CONFIRM,
  bootstrapTenantConnectionShadowContracts,
} from "../tenantConnectionShadowContractBootstrap.js";
import {
  PLATFORM_CAPABILITY_SHADOW_CERTIFICATION_CONFIRM,
  issuePlatformCapabilityShadowCertification,
} from "../platformCapabilityShadowCertificationIssuer.js";
import {
  GITHUB_FILE_PATCH_SHADOW_CERTIFICATION_CONFIRM,
  issueGithubFilePatchShadowCertification,
} from "../githubFilePatchShadowCertificationIssuer.js";
import { runGrowthIntelligencePilotAdmin } from "../growthIntelligenceAdminTool.js";
import {
  approveRepositoryAdvisoryCommentApprovalHoldAdmin,
  createRepositoryAdvisoryCommentApprovalHoldAdmin,
  decideGrowthIntelligenceActionAdmin,
  decideGrowthIntelligenceInsightAdmin,
  refreshGrowthIntelligenceReadinessAdmin,
} from "../growthIntelligenceAdminDecisions.js";
import { issueRuntimeDispatchCertification } from "../runtimeDispatchCertificationIssuer.js";
import { serializeDbControlQueryResult } from "./adminCliRoutes.js";
import { normalizeRegistryTags } from "../registryTagParser.js";

const execFileAsync = promisify(execFile);

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const SENSITIVE_ARG_SUBSTRINGS = [
  "password", "secret", "token", "api_key", "apikey",
  "credential", "private_key", "sa_json", "service_account_json",
  "client_secret", "refresh_token", "access_token", "authorization",
];
const TURN_CONTENT_RESULT_LIMIT = 3000;
const TURN_CONTENT_STRING_LIMIT = 500;
const DEFAULT_TOOL_LIST_LIMIT = 50;
const MAX_TOOL_LIST_LIMIT = 200;
const DEFAULT_TOOL_RESPONSE_MAX_CHARS = 45000;
const MAX_TOOL_RESPONSE_MAX_CHARS = 150000;
const DEFAULT_TOOL_RESPONSE_CLIENT_BUDGET_CHARS = 57000;
const DEFAULT_TOOL_RESPONSE_ENVELOPE_OVERHEAD_CHARS = 12000;
const MIN_TOOL_RESPONSE_MAX_CHARS = 5000;
const DEFAULT_TOOL_RESPONSE_CHUNK_TTL_MS = 15 * 60 * 1000;
const MAX_TOOL_RESPONSE_CHUNK_TTL_MS = 2 * 60 * 60 * 1000;
const MIN_TOOL_RESPONSE_CHUNK_TTL_MS = 5 * 60 * 1000;
const TOOL_RESPONSE_CHUNK_CACHE = new Map();

const SESSION_ARCHIVE_PRE_FINAL_CAPTURE_GATE = Object.freeze({
  status: "required",
  reason_code: "pre_final_capture_required",
  write_tool: "gpt_session_turns_write_batch",
  required_roles: Object.freeze(["user", "assistant"]),
  readback_required: true,
  archive_policy: "write the user prompt and assistant reply before final response or before archiving tool turns",
  secrets_included: false,
});

export const CHUNKED_TOOL_RESPONSE_CONTINUATION_CONTRACT = Object.freeze({
  policy: "chunk_read_before_alternative_surface",
  required_when: "response_chunked_true_or_page_has_more_true",
  required_tool: "response_chunk_read",
  required_sequence: Object.freeze([
    "read_current_chunk",
    "call_response_chunk_read_with_chunk_id_and_next_cursor",
    "repeat_until_page_has_more_false",
    "only_then_use_secondary_search_slice_or_external_fallback",
  ]),
  applies_to: Object.freeze([
    "admin_tools",
    "tenant_tools",
    "system_tools",
    "device_tools",
    "repo_inspect",
    "repo_automation",
    "connector_dispatch",
    "any_governed_tool_response",
  ]),
  dynamic_ttl: Object.freeze({
    supported: true,
    option_keys: Object.freeze([
      "response_options.chunk_ttl_ms",
      "response_options.chunk_ttl_minutes",
      "chunk_ttl_ms",
      "chunk_ttl_minutes",
      "response_chunk_ttl_ms",
      "response_chunk_ttl_minutes",
    ]),
    default_ttl_ms: DEFAULT_TOOL_RESPONSE_CHUNK_TTL_MS,
    min_ttl_ms: MIN_TOOL_RESPONSE_CHUNK_TTL_MS,
    max_ttl_ms: MAX_TOOL_RESPONSE_CHUNK_TTL_MS,
    extension_policy: "extend_cache_on_each_successful_chunk_read",
  }),
  fallback_allowed_only_after: "all_chunks_read_or_chunk_cache_expired_or_authorized_tool_unavailable",
  secrets_included: false,
});

function redactArgsForArchive(value) {
  if (Array.isArray(value)) return value.map(redactArgsForArchive);
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.length > TURN_CONTENT_STRING_LIMIT) {
      return `${value.slice(0, TURN_CONTENT_STRING_LIMIT)}...[truncated]`;
    }
    return value;
  }
  const redacted = {};
  for (const [key, child] of Object.entries(value)) {
    const lower = String(key).toLowerCase();
    if (SENSITIVE_ARG_SUBSTRINGS.some((p) => lower.includes(p))) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = redactArgsForArchive(child);
    }
  }
  return redacted;
}

export function resolveGptSessionPin(req, args = {}) {
  const body = args && typeof args === "object" ? args : {};
  const candidates = [
    body.gpt_session_id,
    body.gpt_sessionId,
    body.session_id,
    body.sessionId,
    body._gpt_session_id,
    body._session_id,
    req?.headers?.["x-gpt-session-id"],
    req?.headers?.["x-session-id"],
  ];
  const value = candidates.find((candidate) => String(candidate || "").trim());
  return value ? String(value).trim() : null;
}

export function resolveGptSessionContext(req, args = {}) {
  const body = args && typeof args === "object" ? args : {};
  const workspaceCandidates = [
    body.workspace_key,
    body.workspaceKey,
    body._workspace_key,
    req?.headers?.["x-workspace-key"],
  ];
  const brandCandidates = [
    body.brand_key,
    body.brandKey,
    body.target_key,
    body.targetKey,
    body._brand_key,
    req?.headers?.["x-brand-key"],
    req?.headers?.["x-target-key"],
  ];
  const businessTypeCandidates = [body.business_type_key, body.businessTypeKey, req?.headers?.["x-business-type-key"]];
  const businessActivityCandidates = [body.business_activity_type_key, body.businessActivityTypeKey, body.activity_type_key, body.activityTypeKey, req?.headers?.["x-business-activity-type-key"], req?.headers?.["x-activity-type-key"]];
  const activityCandidates = [body.activity_key, body.activityKey, req?.headers?.["x-activity-key"]];
  const knowledgeProfileCandidates = [body.knowledge_profile_key, body.knowledgeProfileKey, req?.headers?.["x-knowledge-profile-key"]];
  const workspace = workspaceCandidates.find((candidate) => String(candidate || "").trim());
  const brand = brandCandidates.find((candidate) => String(candidate || "").trim());
  const businessType = businessTypeCandidates.find((candidate) => String(candidate || "").trim());
  const businessActivity = businessActivityCandidates.find((candidate) => String(candidate || "").trim());
  const activity = activityCandidates.find((candidate) => String(candidate || "").trim());
  const knowledgeProfile = knowledgeProfileCandidates.find((candidate) => String(candidate || "").trim());
  return {
    workspace_key: workspace ? String(workspace).trim() : null,
    brand_key: brand ? String(brand).trim() : null,
    business_type_key: businessType ? String(businessType).trim() : null,
    business_activity_type_key: businessActivity ? String(businessActivity).trim() : null,
    activity_key: activity ? String(activity).trim() : null,
    knowledge_profile_key: knowledgeProfile ? String(knowledgeProfile).trim() : null,
  };
}

async function countConversationTurns(pool, sessionId) {
  const [[row]] = await pool.query(
    `SELECT
        SUM(CASE WHEN role IN ('user', 'assistant') THEN 1 ELSE 0 END) AS conversation_turns,
        SUM(CASE WHEN role = 'tool' THEN 1 ELSE 0 END) AS tool_turns,
        COUNT(*) AS total_turns
       FROM \`gpt_session_turns\`
      WHERE session_id = ?`,
    [sessionId]
  );
  return {
    conversation_turns: Number(row?.conversation_turns || 0),
    tool_turns: Number(row?.tool_turns || 0),
    total_turns: Number(row?.total_turns || 0),
  };
}

function buildPreFinalCaptureGate(session = null, reasonCode = "pre_final_capture_required") {
  return {
    ...SESSION_ARCHIVE_PRE_FINAL_CAPTURE_GATE,
    reason_code: reasonCode,
    session_id: session?.session_id || null,
    archive_binding: session?.archive_binding || null,
    turn_counts: session?.turn_counts || null,
  };
}

function attachSessionArchiveCaptureGate(resultForClient, archiveResult) {
  if (!archiveResult?.capture_gate) return resultForClient;
  if (!resultForClient?.body || typeof resultForClient.body !== "object" || Array.isArray(resultForClient.body)) {
    return resultForClient;
  }
  resultForClient.body.session_archive_capture_gate = archiveResult.capture_gate;
  return resultForClient;
}

async function findActiveSessionForCaller(pool, req, args = {}, options = {}) {
  const tenantId = String(req?.auth?.tenant_id || PLATFORM_TENANT_ID);
  const userId = req?.auth?.user_id || null;
  const pinnedSessionId = resolveGptSessionPin(req, args);
  const allowUncapturedConversation = options.allowUncapturedConversation === true;
  const baseSelect = `SELECT session_id, tenant_id, user_id, originator, session_status, started_at,
            drive_folder_id, drive_doc_id, drive_doc_url, drive_doc_part_index, drive_doc_part_count,
            drive_jsonl_id, drive_jsonl_url
       FROM \`customer_sessions\``;

  if (pinnedSessionId) {
    const [rows] = await pool.query(
      `${baseSelect}
      WHERE session_id = ?
        AND originator = 'gpt_action'
        AND tenant_id = ?
        AND (user_id <=> ?)
        AND session_status NOT IN ('completed', 'closed')
      LIMIT 1`,
      [pinnedSessionId, tenantId, userId]
    );
    if (!rows[0]) return null;
    const counts = await countConversationTurns(pool, rows[0].session_id);
    if (counts.conversation_turns > 0 || allowUncapturedConversation) {
      return { ...rows[0], archive_binding: "explicit_session_pin", turn_counts: counts };
    }
    return {
      ...rows[0],
      archive_binding: "explicit_session_pin_pre_final_capture_required",
      turn_counts: counts,
      pre_final_capture_required: true,
    };
  }

  const [rows] = await pool.query(
    `${baseSelect}
      WHERE originator = 'gpt_action'
        AND tenant_id = ?
        AND (user_id <=> ?)
        AND session_status NOT IN ('completed', 'closed')
      ORDER BY started_at DESC
      LIMIT 5`,
    [tenantId, userId]
  );
  for (const row of rows || []) {
    const counts = await countConversationTurns(pool, row.session_id);
    if (counts.conversation_turns > 0) {
      return { ...row, archive_binding: "latest_active_with_conversation_turn", turn_counts: counts };
    }
  }
  if (rows?.[0]) {
    const counts = await countConversationTurns(pool, rows[0].session_id);
    return {
      ...rows[0],
      archive_binding: "latest_active_session_pre_final_capture_required",
      turn_counts: counts,
      pre_final_capture_required: true,
    };
  }
  return null;
}

async function recordToolDispatchTurn(req, toolKey, args, result) {
  try {
    const pool = getPool();
    const allowUncapturedConversation = toolKey === "gpt_session_turns_write_batch";
    const session = await findActiveSessionForCaller(pool, req, args, { allowUncapturedConversation });
    if (!session) {
      console.warn(`[gpt-tools] skipped auto-record turn for ${toolKey}: no explicit GPT session pin and no active session with user/assistant turns`);
      return {
        ok: false,
        skipped: true,
        reason_code: "no_active_gpt_action_session",
        capture_gate: buildPreFinalCaptureGate(null, "no_active_gpt_action_session"),
      };
    }
    if (session.pre_final_capture_required) {
      console.warn(`[gpt-tools] skipped auto-record turn for ${toolKey}: pre-final user/assistant capture is required before tool turns are archived`);
      return {
        ok: false,
        skipped: true,
        reason_code: "pre_final_capture_required",
        session_id: session.session_id,
        capture_gate: buildPreFinalCaptureGate(session, "pre_final_capture_required"),
      };
    }

    const [[{ max_idx }]] = await pool.query(
      "SELECT COALESCE(MAX(turn_index), -1) AS max_idx FROM `gpt_session_turns` WHERE session_id = ?",
      [session.session_id]
    );
    const turnIndex = Number(max_idx) + 1;

    const resultBodyJson = JSON.stringify(result?.body || {}, null, 2);
    const truncatedResult = resultBodyJson.length > TURN_CONTENT_RESULT_LIMIT
      ? `${resultBodyJson.slice(0, TURN_CONTENT_RESULT_LIMIT)}...[truncated]`
      : resultBodyJson;
    const content = [
      `Tool: ${toolKey}`,
      `Archive binding: ${session.archive_binding || "unknown"}`,
      `Status: HTTP ${result?.status ?? "n/a"} ok=${result?.body?.ok !== false}`,
      "",
      "Args:",
      JSON.stringify(redactArgsForArchive(args || {}), null, 2),
      "",
      "Result:",
      truncatedResult,
    ].join("\n");

    const {
      workspace_key: workspaceKey,
      brand_key: brandKey,
      business_type_key: businessTypeKey,
      business_activity_type_key: businessActivityTypeKey,
      activity_key: activityKey,
      knowledge_profile_key: knowledgeProfileKey,
    } = resolveGptSessionContext(req, args);
    const writeback = await recordGptSessionTurn({
      pool,
      session,
      role: "tool",
      content,
      action_key: toolKey,
      turnIndex,
      workspace_key: workspaceKey,
      brand_key: brandKey,
      business_type_key: businessTypeKey,
      business_activity_type_key: businessActivityTypeKey,
      activity_key: activityKey,
      knowledge_profile_key: knowledgeProfileKey,
    });
    return { ok: true, ...writeback };
  } catch (err) {
    console.warn(`[gpt-tools] auto-record turn failed for ${toolKey}: ${err.message}`);
    return {
      ok: false,
      skipped: true,
      reason_code: "tool_turn_archive_readback_failed",
      error: { code: err.code || "tool_turn_archive_failed", message: err.message },
      capture_gate: buildPreFinalCaptureGate(null, "tool_turn_archive_readback_failed"),
    };
  }
}

// Dispatcher self-operations remain reserved to avoid recursion. Session archive
// operations are registry-dispatchable so tool discovery and execution stay consistent.
const RESERVED_TOOL_KEYS = new Set([
  "activation_session_context",
  "gpt_tools_list",
  "gpt_tools_call",
]);

const TOOLS_TABLE = {
  admin: "admin_platform_endpoint_tools",
  tenant: "tenant_platform_endpoint_tools",
};

const TENANT_BLOCKED_TOOL_PATH_PREFIXES = [
  "/admin/",
  "/admin/system/",
  "/connector/",
  "/system/tools/call",
  "/gpt/tools/call",
];

const TENANT_BLOCKED_TOOL_NAMES = new Set([
  "runtime_endpoint_call",
  "github_api_mcp__create_or_update_file_contents",
  "github_api_mcp__github_create_or_update_file",
  "github_api_mcp__github_put_contents",
  "github_api_mcp__github_delete_file",
]);

function isTenantBlockedToolPath(httpPath = "") {
  const path = String(httpPath || "").trim();
  return TENANT_BLOCKED_TOOL_PATH_PREFIXES.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));
}

function isTenantBlockedToolName(toolName = "") {
  return TENANT_BLOCKED_TOOL_NAMES.has(String(toolName || "").trim());
}

const REPO_INSPECT_DENY_SEGMENTS = new Set([
  ".git",
  ".omx",
  ".codex",
  "node_modules",
  "secrets",
  "tmp",
  "dist",
  "build",
  "coverage",
]);
const REPO_INSPECT_DENY_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /^credentials(?:\..*)?\.json$/i,
  /^token(?:\..*)?\.json$/i,
  /^service[-_]?account.*\.json$/i,
  /^private[-_]?key.*\.(?:json|key|pem)$/i,
  /\.(?:key|p12|pem|pfx)$/i,
];
const REPO_INSPECT_TEXT_EXTENSIONS = new Set([
  ".cjs", ".cs", ".css", ".csv", ".env.example", ".gitignore", ".html", ".js", ".json",
  ".jsx", ".md", ".mjs", ".ps1", ".sql", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);

const VIRTUAL_ADMIN_TOOLS = [
  {
    name: "repository_close_superseded_positive_smoke",
    displayName: "Repository Close Superseded Positive Smoke",
    description: "Admin-only disposable positive smoke for repo.pr.close_superseded. Pins the expected main SHA, creates one disposable PR whose head is exactly main and whose base is main's parent, validates the production superseded predicate, closes through the production write contract, requires state/head readback, audits, and cleans both disposable refs. It does not activate the production recipe or apply authority.",
    method: "VIRTUAL",
    path: "internal://repository-close-superseded-positive-smoke",
    tags: ["repo", "github", "pull_request", "positive_smoke", "mutation", "admin_only", "capability_envelope", "typed_confirmation", "readback", "cleanup_required", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["expected_main_sha", "confirm", "capability_envelope_id"],
      properties: {
        expected_main_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        confirm: { type: "string", pattern: "^RUN_CLOSE_SUPERSEDED_SMOKE_[0-9A-F]{12}$" },
        capability_envelope_id: { type: "string" },
        owner: { type: "string", pattern: "^[A-Za-z0-9_.-]+$" },
        repo: { type: "string", pattern: "^[A-Za-z0-9_.-]+$" },
        default_branch: { type: "string" },
        smoke_id: { type: "string", minLength: 3, maxLength: 80 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "repo_inspect",
    displayName: "Repository Inspect",
    description: "Read-only repository inspection. Actions: list, read, search, git_status, git_log, git_show, git_diff_name_status. Paths are repo-confined; secrets/build folders are blocked. Git helpers return metadata only and never expose .git internals. Large responses must use the governed response chunk contract with dynamic TTL support.",
    method: "VIRTUAL",
    path: "internal://repo-inspect",
    tags: ["repo", "read_only", "diagnostics", "chunk_contract", "dynamic_ttl"],
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "read", "search", "git_status", "git_log", "git_show", "git_diff_name_status"] },
        path: { type: "string" },
        query: { type: "string" },
        ref: { type: "string", description: "Git ref/commit for git_show. Defaults to HEAD." },
        base_ref: { type: "string", description: "Base ref for git_diff_name_status. Defaults to HEAD~1." },
        head_ref: { type: "string", description: "Head ref for git_diff_name_status. Defaults to HEAD." },
        file: { type: "string", description: "Optional repo-relative path filter for git_log." },
        since: { type: "string", description: "Optional git_log --since value." },
        until: { type: "string", description: "Optional git_log --until value." },
        recursive: { type: "boolean", default: false },
        max_entries: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        max_chars: { type: "integer", minimum: 1000, maximum: 50000, default: 12000 },
        response_options: {
          type: "object",
          description: "Optional governed response envelope controls. Use chunk_ttl_ms or chunk_ttl_minutes to extend durable response chunk availability.",
          properties: {
            max_chars: { type: "integer", minimum: 5000, maximum: 150000 },
            chunk_ttl_ms: { type: "integer", minimum: 300000, maximum: 7200000 },
            chunk_ttl_minutes: { type: "integer", minimum: 5, maximum: 120 },
          },
          additionalProperties: true,
        },
      },
    },
  },
  {
    name: "platform_capability_contract_report",
    displayName: "Platform Capability Contract Report",
    description: "Read-only contract report. Classifies declared capability inventory, envelope, authority, evidence, certification, and debt surfaces as implemented, partial, or proposed-not-implemented. It deliberately excludes live capability/gap counts and does not verify historical numeric snapshots.",
    method: "VIRTUAL",
    path: "internal://platform-capability-contract-report",
    tags: ["capability", "contract", "read_only", "no_live_metrics"],
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "platform_capability_live_report",
    displayName: "Platform Capability Live Report",
    description: "Read-only live MySQL-primary snapshot for capability maturity, gaps, envelopes, certifications, and source resolutions. Includes observed/expires timestamps and deliberately excludes contractual or historical conclusions.",
    method: "VIRTUAL",
    path: "internal://platform-capability-live-report",
    tags: ["capability", "live", "read_only", "freshness_bounded"],
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25, description: "Maximum highest-priority gap rows." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "platform_capability_governance_compile_preview",
    displayName: "Platform Capability Governance Compile Preview",
    description: "Compile deterministic read-only governance manifests and typed gaps from the current MySQL capability readiness vector. Shadow diagnostics only: no registry writes, provider calls, callable exports, tenant authority changes, or execution.",
    method: "VIRTUAL",
    path: "internal://platform-capability-governance-compile-preview",
    tags: ["capability", "governance", "compiler", "shadow", "read_only", "no_execution", "no_provider_call", "no_mutation", "no_secrets"],
    inputSchema: {
      type: "object",
      properties: {
        capability_key: { type: "string", maxLength: 191 },
        source_table: { type: "string", maxLength: 191 },
        after_key: { type: "string", maxLength: 191 },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        gap_limit: { type: "integer", minimum: 1, maximum: 500, default: 200 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "platform_capability_enforcement_shadow_preview",
    displayName: "Preview Shared Capability Enforcement Shadow",
    description: "Evaluate one current persisted capability manifest through the shared enforcement decision model, bind the result to manifest revision and request hash, compare adaptive and legacy decisions, and return bounded gate/parity evidence. Shadow only: legacy runtime remains authoritative; no provider call, mutation, envelope consumption, idempotency reservation, Tenant authority change, or secret read.",
    method: "VIRTUAL",
    path: "internal://platform-capability-enforcement-shadow-preview",
    tags: ["capability", "governance", "enforcement", "shadow", "parity", "read_only", "no_execution", "legacy_authority_preserved", "no_provider_call", "no_mutation", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["capability_key"],
      properties: {
        capability_key: { type: "string", minLength: 1, maxLength: 191 },
        requested_mode: { type: "string", enum: ["preview", "apply"], default: "preview" },
        principal_scope: { type: "string", enum: ["admin", "tenant", "internal"], default: "admin" },
        tenant_ref: { type: "string", maxLength: 191 },
        workspace_ref: { type: "string", maxLength: 191 },
        resource_ref: { type: "string", maxLength: 255 },
        runtime_surface: { type: "string", maxLength: 191 },
        capability_envelope_id: { type: "string", maxLength: 64 },
        context_revision: { type: "string", maxLength: 191 },
        input_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        expected_request_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
        expected_manifest_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
        expected_source_revision_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
        legacy_decision: { type: "string", enum: ["allow", "deny", "error", "not_evaluated"], default: "not_evaluated" },
        legacy_reason_codes: { type: "array", maxItems: 20, items: { type: "string", maxLength: 128 } },
        legacy_explanation_ref: { type: "string", maxLength: 512 },
        legacy_exception_approved: { type: "boolean", default: false },
        evidence: {
          type: "object",
          properties: {
            tenant_membership: { type: "boolean" },
            workspace_ready: { type: "boolean" },
            resource_authority: { type: "boolean" },
            capability_grant: { type: "boolean" },
            connection_present: { type: "boolean" },
            connection_validated: { type: "boolean" },
            credential_scope_match: { type: "boolean" },
            approval_present: { type: "boolean" },
            typed_confirmation_match: { type: "boolean" },
            idempotency_key_present: { type: "boolean" },
            quota_authority: { type: "boolean" },
            audit_ready: { type: "boolean" },
            readback_contract: { type: "boolean" },
            rollback_ready: { type: "boolean" },
            compensation_ready: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "platform_capability_certification_readback_preview",
    displayName: "Preview Capability Certification and Readback Readiness",
    description: "Resolve the deterministic adapter candidate, reconcile generic and specialized certification authorities, select a versioned readback contract, and report acknowledgement and verification separately. Shadow only: no dispatch, provider call, mutation, credential payload read, Tenant authority change, or runtime authority cutover.",
    method: "VIRTUAL",
    path: "internal://platform-capability-certification-readback-preview",
    tags: ["capability", "governance", "adapter", "certification", "readback", "shadow", "read_only", "no_execution", "legacy_authority_preserved", "no_provider_call", "no_mutation", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["capability_key"],
      properties: {
        capability_key: { type: "string", minLength: 1, maxLength: 191 },
        operation_mode: { type: "string", enum: ["preview", "apply"], default: "preview" },
        adapter_key: { type: "string", maxLength: 191 },
        resource_type: { type: "string", maxLength: 128 },
        provider_key: { type: "string", maxLength: 128 },
        runtime_surface: { type: "string", maxLength: 191 },
        contract_key: { type: "string", maxLength: 191 },
        environment: { type: "string", maxLength: 64, default: "production" },
        evidence_limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "tenant_connection_operation_preview",
    displayName: "Preview Tenant Connection Operation Callability",
    description: "Resolve one registered Tenant connection self-repair operation against safe connection metadata, the Tenant tool contract, canonical adapter certification, and readback authority. Admin shadow preview only: no provider call, credential payload read, mutation, Tenant authority change, export, or secret return.",
    method: "VIRTUAL",
    path: "internal://tenant-connection-operation-preview",
    tags: ["admin", "tenant_connection", "callability", "shadow", "read_only", "no_execution", "no_provider_call", "no_credential_payload", "no_mutation", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["tenant_id", "connection_id", "tool_key"],
      properties: {
        tenant_id: { type: "string", minLength: 1, maxLength: 64 },
        user_id: { type: "string", minLength: 1, maxLength: 64 },
        connection_id: { type: "string", minLength: 1, maxLength: 191 },
        tool_key: { type: "string", minLength: 1, maxLength: 191 },
        adapter_key: { type: "string", minLength: 1, maxLength: 128 },
        app_key: { type: "string", minLength: 1, maxLength: 128 },
        capability_key: { type: "string", minLength: 1, maxLength: 191 },
        environment: { type: "string", minLength: 1, maxLength: 64, default: "production" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "platform_capability_projection_preview",
    displayName: "Preview Platform Capability Projections",
    description: "Build deterministic Admin and Tenant projection candidates from current persisted governance manifests, compare them with existing tool catalogs and export registries, summarize bounded schemas, and emit typed reconciliation gaps. Preview only: no callable export creation, no registry mutation, no provider call, and no Tenant authority change.",
    method: "VIRTUAL",
    path: "internal://platform-capability-projection-preview",
    tags: ["capability", "governance", "projection", "reconciliation", "admin", "tenant_safe_preview", "read_only", "dry_run", "no_mutation", "no_callable_export", "no_provider_call", "no_tenant_authority_change", "no_secrets"],
    inputSchema: {
      type: "object",
      properties: {
        capability_key: { type: "string", maxLength: 191 },
        after_key: { type: "string", maxLength: 191 },
        target_scope: { type: "string", enum: ["all", "admin", "tenant"], default: "all" },
        include_aligned: { type: "boolean", default: true },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        gap_limit: { type: "integer", minimum: 1, maximum: 500, default: 200 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "platform_capability_governance_compile_persist",
    displayName: "Persist Platform Capability Governance Compilation",
    description: "Persist one bounded shadow compilation batch into immutable internal SQL manifests, source links, and typed gap snapshots with idempotency and same-cycle readback. This does not call providers, create callable exports, change Tenant authority, or enable runtime execution.",
    method: "VIRTUAL",
    path: "internal://platform-capability-governance-compile-persist",
    tags: ["capability", "governance", "compiler", "persistence", "internal_registry", "state_changing", "mutation", "typed_confirmation", "capability_envelope", "same_cycle_readback", "idempotency", "no_provider_call", "no_external_write", "no_tenant_authority_change", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["idempotency_key", "expected_source_revision_hash", "confirm", "capability_envelope_id"],
      properties: {
        idempotency_key: { type: "string", minLength: 8, maxLength: 191 },
        expected_source_revision_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
        confirm: { type: "string", const: CAPABILITY_GOVERNANCE_PERSIST_CONFIRM },
        capability_envelope_id: { type: "string", minLength: 1, maxLength: 64 },
        capability_key: { type: "string", maxLength: 191 },
        source_table: { type: "string", maxLength: 191 },
        after_key: { type: "string", maxLength: 191 },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        gap_limit: { type: "integer", minimum: 1, maximum: 500, default: 200 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "platform_capability_shadow_certification_issue",
    displayName: "Issue Fixed Platform Capability Shadow Certification",
    description: "Dry-run or apply one fixed shadow certification for tenant_connection_effective_credential_plan_view. Apply requires typed confirmation and an apply-authorized platform_orchestration capability envelope. It keeps the Tenant tool disabled, keeps the readback contract status shadow, never writes runtime dispatch certification, creates no active Tenant export, calls no provider, and returns no secrets.",
    method: "VIRTUAL",
    path: "internal://platform-capability-shadow-certification-issue",
    tags: ["admin", "capability", "tenant_connection", "certification", "shadow", "read_only", "state_changing", "dry_run_default", "typed_confirmation", "capability_envelope", "same_cycle_readback", "no_provider_call", "no_external_write", "no_tenant_authority_change", "no_runtime_dispatch_change", "no_secrets"],
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["dry_run", "apply"], default: "dry_run" },
        expected_plan_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
        confirm: { type: "string", const: PLATFORM_CAPABILITY_SHADOW_CERTIFICATION_CONFIRM },
        capability_envelope_id: { type: "string", minLength: 1, maxLength: 64 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "github_file_patch_shadow_certification_issue",
    displayName: "Issue GitHub File Patch Shadow Certification",
    description: "Dry-run or apply one fixed evidence-backed shadow certification for github_file_patch_apply. Apply requires typed confirmation and an apply-authorized platform_orchestration capability envelope. It activates only the canonical readback adapter, certifies the current readback contract, preserves the existing target runtime dispatch and apply snapshot unchanged, keeps target capability exports shadow-only, creates no Tenant authority, calls no provider, performs no external write, and returns no secrets.",
    method: "VIRTUAL",
    path: "internal://github-file-patch-shadow-certification-issue",
    tags: ["capability", "github", "repository", "certification", "shadow", "state_changing", "dry_run_default", "typed_confirmation", "capability_envelope", "same_cycle_readback", "no_provider_call", "no_external_write", "no_runtime_promotion", "no_tenant_authority", "no_secrets"],
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["dry_run", "apply"], default: "dry_run" },
        expected_plan_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
        confirm: { type: "string", const: GITHUB_FILE_PATCH_SHADOW_CERTIFICATION_CONFIRM },
        capability_envelope_id: { type: "string", minLength: 1, maxLength: 64 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "tenant_connection_shadow_contract_bootstrap",
    displayName: "Bootstrap Tenant Connection Shadow Contracts",
    description: "Dry-run or apply one fixed internal bootstrap for a non-write-capable Tenant connection adapter and nine shadow readback contracts. Apply requires typed confirmation and an apply-authorized platform_orchestration capability envelope. It never enables Tenant tools, creates Tenant exports, issues certifications, calls providers, performs external writes, or returns secrets.",
    method: "VIRTUAL",
    path: "internal://tenant-connection-shadow-contract-bootstrap",
    tags: ["admin", "capability", "tenant_connection", "adapter", "readback", "shadow", "state_changing", "dry_run_default", "typed_confirmation", "capability_envelope", "same_cycle_readback", "no_provider_call", "no_external_write", "no_tenant_authority_change", "no_secrets"],
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["dry_run", "apply"], default: "dry_run" },
        expected_plan_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
        confirm: { type: "string", const: TENANT_CONNECTION_SHADOW_CONTRACT_BOOTSTRAP_CONFIRM },
        capability_envelope_id: { type: "string", minLength: 1, maxLength: 64 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "activation_gateway_rollout_plan",
    displayName: "Activation Gateway Rollout Plan",
    description: "Admin-only read-only rollout plan for the Activation Gateway Cloudflare Worker. Validates generated policy hash, signed deployment attestation, workspace and exact Worker resource binding, workers.dev readiness, previous deployment rollback target, and feature-gate state. Never uploads code, writes secrets, enables a subdomain, changes DNS, or binds a custom domain.",
    method: "VIRTUAL",
    path: "internal://activation-gateway-rollout-plan",
    tags: ["activation_gateway", "cloudflare", "rollout", "read_only", "diagnostics", "dry_run", "no_execution", "no_external_write", "no_dns", "no_custom_domain", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["account_id", "expected_source_commit"],
      properties: {
        account_id: { type: "string", pattern: "^[a-f0-9]{32}$" },
        script_name: { type: "string", const: "mad4b-activation-gateway" },
        expected_source_commit: { type: "string", pattern: "^[a-f0-9]{40}$" },
        expected_policy_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        workspace_id: { type: "string" },
        resource_binding_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "activation_gateway_dark_deploy",
    displayName: "Activation Gateway Dark Deploy",
    description: "Admin-only governed workers.dev dark deployment for the Activation Gateway. Defaults to dry-run. Apply requires an exact policy hash and source commit, signed Ed25519 attestation, active exact Worker resource binding, approved single-use capability envelope, execution nonce, typed confirmation derived from the policy hash, enabled feature flag, same-cycle Cloudflare inventory, awaited audit evidence, secret-safe Worker upload, workers.dev health/ready readback, and automatic rollback. DNS and custom-domain binding are forbidden.",
    method: "VIRTUAL",
    path: "internal://activation-gateway-dark-deploy",
    tags: ["activation_gateway", "cloudflare", "rollout", "mutation", "dry_run_default", "dry_run_default_true", "typed_confirmation", "capability_envelope", "same_cycle_readback", "rollback_required", "no_dns", "no_custom_domain", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["mode", "account_id", "expected_source_commit", "expected_policy_hash"],
      properties: {
        mode: { type: "string", enum: ["dry_run", "apply"], default: "dry_run" },
        account_id: { type: "string", pattern: "^[a-f0-9]{32}$" },
        script_name: { type: "string", const: "mad4b-activation-gateway" },
        expected_source_commit: { type: "string", pattern: "^[a-f0-9]{40}$" },
        expected_policy_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        workspace_id: { type: "string" },
        resource_binding_id: { type: "string" },
        capability_envelope_id: { type: "string" },
        execution_nonce: { type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" },
        confirm: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "response_chunk_read",
    displayName: "Read Tool Response Chunk",
    description: "Read the next chunk of an oversized governed tool response. Reads the in-process cache first and recovers from durable MySQL storage after cache loss or process restart. Supports dynamic sliding TTL through chunk_ttl_ms or chunk_ttl_minutes.",
    method: "VIRTUAL",
    path: "internal://response-chunk-read",
    tags: ["tooling", "pagination", "read_only", "dynamic_ttl"],
    inputSchema: {
      type: "object",
      required: ["chunk_id"],
      properties: {
        chunk_id: { type: "string" },
        cursor: { type: "integer", minimum: 0, default: 0 },
        max_chars: { type: "integer", minimum: 5000, maximum: 150000, default: 45000 },
        chunk_ttl_ms: { type: "integer", minimum: 300000, maximum: 7200000 },
        chunk_ttl_minutes: { type: "integer", minimum: 5, maximum: 120 },
        response_options: {
          type: "object",
          properties: {
            chunk_ttl_ms: { type: "integer", minimum: 300000, maximum: 7200000 },
            chunk_ttl_minutes: { type: "integer", minimum: 5, maximum: 120 },
          },
          additionalProperties: true,
        },
      },
    },
  },
  {
    name: "response_chunk_durable_recovery_smoke",
    displayName: "Durable Response Chunk Recovery Smoke",
    description: "Admin-only bounded smoke. Persists a deterministic Arabic and emoji payload, verifies the durable row exists before chunk_id use, evicts process memory, recovers from MySQL, validates SHA-256 and UTF-8 bytes, reconstructs Unicode exactly, and confirms sliding TTL extension. Returns only bounded evidence including memory_cache_evicted; no raw payload, provider call, external write, or secret.",
    method: "VIRTUAL",
    path: "internal://response-chunk-durable-recovery-smoke",
    tags: ["tooling", "smoke", "read_write", "typed_confirmation", "no_provider_call", "no_external_write", "no_secrets", "ttl_cleanup"],
    inputSchema: {
      type: "object",
      required: ["confirm"],
      properties: {
        confirm: { type: "string", const: "RUN_RESPONSE_CHUNK_DURABLE_RECOVERY_SMOKE" },
        repeat_count: { type: "integer", minimum: 40, maximum: 120, default: 48 },
        chunk_ttl_minutes: { type: "integer", minimum: 5, maximum: 30, default: 5 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "governed_migration_apply_policy_bootstrap",
    displayName: "Governed Migration Apply Policy Bootstrap",
    description: "Create or verify the one fixed dynamic apply-authorization policy required by governed_migration_execute. The contract is non-configurable, no-provider, no-external-write, checksum-runner-only, and requires typed confirmation plus same-cycle readback.",
    method: "VIRTUAL",
    path: "internal://governed-migration-apply-policy-bootstrap",
    tags: ["admin", "migration", "capability_resolution", "policy_bootstrap", "state_changing", "typed_confirmation", "capability_envelope", "readback", "no_provider_call", "no_external_write", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["confirm", "decision_note", "capability_envelope_id"],
      properties: {
        confirm: { type: "string", const: "BOOTSTRAP_GOVERNED_MIGRATION_EXECUTE_APPLY_POLICY" },
        decision_note: { type: "string", minLength: 20, maxLength: 1000 },
        capability_envelope_id: { type: "string", minLength: 1, maxLength: 64 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "capability_resolution_envelope_apply_authorize",
    displayName: "Apply-Authorize Capability Resolution Envelope",
    description: "Apply-authorize one ready capability resolution envelope through the dynamic capability apply policy. Creates internal approval evidence only; no provider call, external write, credential payload read, or secret return.",
    method: "VIRTUAL",
    path: "internal://capability-resolution-envelope-apply-authorize",
    tags: ["admin", "capability_resolution", "apply_authorization", "state_changing", "approval_required", "readback", "no_provider_call", "no_external_write", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["envelope_id", "decision_note"],
      properties: {
        envelope_id: { type: "string", minLength: 1, maxLength: 64 },
        authorized_by: { type: "string", minLength: 1, maxLength: 64 },
        decision_note: { type: "string", minLength: 20, maxLength: 512 },
        ttl_minutes: { type: "integer", minimum: 5, maximum: 240, default: 60 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "capability_resolution_envelope_batch_expire",
    displayName: "Expire Capability Resolution Envelopes in a Bounded Batch",
    description: "Dry-run or apply a bounded expiration batch for envelopes that are already past expires_at, were requested by one actor, remain not_executed, have no execution_ref, contain no secrets, and are still in a pre-execution lifecycle state. Apply requires an exact reviewed plan hash, typed confirmation, a dedicated capability envelope, transactional row locking, same-cycle readback, and governance-envelope consumption. No provider call, external write, deploy, restart, gate mutation, or unrelated envelope transition.",
    method: "VIRTUAL",
    path: "internal://capability-resolution-envelope-batch-expire",
    tags: ["admin", "capability_resolution", "lifecycle", "batch", "mutation", "dry_run_default", "typed_confirmation", "capability_envelope", "same_cycle_readback", "internal_sql_only", "no_provider_call", "no_external_write", "no_secrets"],
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: CAPABILITY_ENVELOPE_BATCH_EXPIRE_MODES, default: "dry_run" },
        requested_by: { type: "string", minLength: 1, maxLength: 191, default: "gpt_admin" },
        expired_before: { type: "string", format: "date-time" },
        max_items: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        expected_plan_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        confirm: { type: "string", pattern: "^EXPIRE_CAPABILITY_ENVELOPES_[0-9A-F]{12}$" },
        capability_envelope_id: { type: "string", minLength: 1, maxLength: 64 },
        reason: { type: "string", minLength: 20, maxLength: 512 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "capability_resolution_envelope_lifecycle",
    displayName: "Transition Capability Resolution Envelope Lifecycle",
    description: "Transition one capability resolution envelope lifecycle state by using the governed lifecycle actions consume, cancel, or expire. Internal registry mutation only; no provider call, external write, credential payload read, or secret return.",
    method: "VIRTUAL",
    path: "internal://capability-resolution-envelope-lifecycle",
    tags: ["admin", "capability_resolution", "lifecycle", "state_changing", "readback", "no_provider_call", "no_external_write", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["envelope_id", "action"],
      properties: {
        envelope_id: { type: "string", minLength: 1, maxLength: 64 },
        action: { type: "string", enum: CAPABILITY_ENVELOPE_LIFECYCLE_ACTIONS },
        execution_ref: { type: "string", maxLength: 191 },
        reason: { type: "string", maxLength: 512 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "governed_migration_authorization_bootstrap",
    displayName: "Governed Migration Authorization Bootstrap",
    description: "Authorize one checksum-bound additive migration for the governed runner without executing migration SQL. Requires exact checksum, statement count, merged PR evidence, typed confirmation, a ready capability envelope, zero-risk preflight, and same-cycle authorization readback.",
    method: "VIRTUAL",
    path: "internal://governed-migration-authorization-bootstrap",
    tags: ["admin", "migration", "authorization", "bootstrap", "mutation", "typed_confirmation", "capability_envelope", "no_migration_execution", "no_provider_call", "no_external_write", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["migration", "expected_checksum_sha256", "expected_statement_count", "pull_request", "merge_sha", "confirm", "capability_envelope_id"],
      properties: {
        migration: { type: "string", pattern: "^[A-Za-z0-9._-]+\\.sql$" },
        expected_checksum_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        previous_checksum_sha256: {
          type: "string",
          pattern: "^[0-9a-f]{64}$",
          description: "Required only when rotating an existing unapplied authorization to a reviewed replacement checksum.",
        },
        expected_statement_count: { type: "integer", minimum: 1, maximum: 5000 },
        pull_request: { type: "integer", minimum: 1 },
        merge_sha: { type: "string", pattern: "^[0-9a-f]{40}$" },
        confirm: { type: "string" },
        capability_envelope_id: { type: "string" },
        decision_note: { type: "string", minLength: 20, maxLength: 1000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "admin_control_db_mutation_serialization_smoke",
    displayName: "Admin DB Mutation Serialization Smoke",
    description: "Run one fixed no-op DB UPDATE through the same serializer used by admin_control DB single-statement mutations. No freeform SQL, row data, provider call, external write, or secret return.",
    method: "VIRTUAL",
    path: "internal://admin-control-db-mutation-serialization-smoke",
    tags: ["admin", "db", "serialization", "smoke", "state_changing", "readback", "no_freeform_sql", "no_provider_call", "no_external_write", "no_secrets"],
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "sql_cache_runtime_diagnostics_get",
    displayName: "SQL Cache Runtime Diagnostics Get",
    description: "Read process-lifetime SQL cache counters, derived hit/miss/error metrics, policy freshness, circuit/cooldown state, and threshold-based operational alerts. No cache or policy mutation is performed.",
    method: "VIRTUAL",
    path: "internal://sql-cache-runtime-diagnostics-get",
    tags: ["admin", "cache", "sql_cache", "read_only", "diagnostics", "monitoring", "no_external_write", "no_provider_call", "no_secrets"],
    inputSchema: {
      type: "object",
      properties: {
        minimum_read_samples: { type: "integer", minimum: 1, maximum: 1000000, default: 20 },
        low_hit_ratio: { type: "number", minimum: 0, maximum: 1, default: 0.4 },
        high_error_rate: { type: "number", minimum: 0, maximum: 1, default: 0.05 },
        oversize_cooldown_warning_count: { type: "integer", minimum: 1, maximum: 1000000, default: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "sql_cache_controlled_load_test",
    displayName: "SQL Cache Controlled Load Test",
    description: "Run a bounded isolated in-memory comparison of uncached versus cached reads, verify single-flight behavior, and confirm the endpoints security denylist fallback. Production Redis and MySQL are never touched.",
    method: "VIRTUAL",
    path: "internal://sql-cache-controlled-load-test",
    tags: ["admin", "cache", "sql_cache", "read_only", "diagnostics", "isolated_in_memory", "no_external_write", "no_provider_call", "no_secrets"],
    inputSchema: {
      type: "object",
      properties: {
        iterations: { type: "integer", minimum: 10, maximum: 2000, default: 100 },
        concurrency: { type: "integer", minimum: 1, maximum: 200, default: 20 },
        loader_delay_ms: { type: "integer", minimum: 0, maximum: 100, default: 5 },
        payload_bytes: { type: "integer", minimum: 16, maximum: 262144, default: 1024 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "governed_migration_schema_readback",
    displayName: "Governed Migration Schema Readback",
    description: "Read-only, checksum-bound schema and ledger readback for one governed migration. This tool does not accept freeform SQL, does not read row data, does not call providers, and does not execute migrations.",
    method: "VIRTUAL",
    path: "internal://governed-migration-schema-readback",
    tags: ["admin", "migration", "read_only", "schema_readback", "ledger_readback", "no_freeform_sql", "no_provider_call", "no_external_write", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["migration", "expected_checksum_sha256", "expected_statement_count"],
      properties: {
        migration: { type: "string", pattern: "^[A-Za-z0-9._-]+\\.sql$" },
        expected_checksum_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        expected_statement_count: { type: "integer", minimum: 1, maximum: 5000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "dynamic_container_projection_apply",
    displayName: "Governed Dynamic Container Projection Apply",
    description: "Dry-run or apply the legacy-to-container projection through a pinned source snapshot and exact expected counts. Apply requires typed confirmation derived from the snapshot, an apply-authorized platform_orchestration capability envelope, per-tenant transactional writes, same-cycle projection-run and exact-ID readback, and envelope consumption. No provider call, credential payload read, external write, raw endpoint activation, or secret return.",
    method: "VIRTUAL",
    path: "internal://dynamic-container-projection-apply",
    tags: ["admin", "dynamic_container", "projection", "mutation", "dry_run_default", "typed_confirmation", "capability_envelope", "same_cycle_readback", "internal_sql_only", "no_provider_call", "no_external_write", "no_secrets"],
    inputSchema: {
      type: "object",
      required: [
        "mode",
        "expected_source_snapshot_sha256",
        "expected_projected_container_count",
        "expected_projected_relationship_count",
        "expected_projected_role_assignment_count",
        "expected_projected_resource_binding_count",
        "expected_held_issue_count",
        "expected_high_risk_issue_count",
      ],
      properties: {
        mode: { type: "string", enum: ["dry_run", "apply"], default: "dry_run" },
        expected_source_snapshot_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        expected_projected_container_count: { type: "integer", minimum: 0 },
        expected_projected_relationship_count: { type: "integer", minimum: 0 },
        expected_projected_role_assignment_count: { type: "integer", minimum: 0 },
        expected_projected_resource_binding_count: { type: "integer", minimum: 0 },
        expected_held_issue_count: { type: "integer", minimum: 0 },
        expected_high_risk_issue_count: { type: "integer", minimum: 0 },
        confirm: { type: "string", pattern: "^APPLY_DYNAMIC_CONTAINER_PROJECTION_[0-9A-F]{12}$" },
        capability_envelope_id: { type: "string", minLength: 1, maxLength: 64 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "governed_migration_execute",
    displayName: "Governed Migration Execute",
    description: "Dry-run or apply one checksum-bound authorized migration through the governed runner. Apply requires exact typed confirmation, a ready platform_orchestration capability envelope, ledger persistence, and same-cycle schema readback.",
    method: "VIRTUAL",
    path: "internal://governed-migration-execute",
    tags: ["admin", "migration", "mutation", "dry_run_default", "typed_confirmation", "capability_envelope", "same_cycle_readback", "no_provider_call", "no_external_write", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["migration", "mode", "expected_checksum_sha256", "expected_statement_count"],
      properties: {
        migration: { type: "string", pattern: "^[A-Za-z0-9._-]+\\.sql$" },
        mode: { type: "string", enum: ["dry_run", "apply"], default: "dry_run" },
        expected_checksum_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        expected_statement_count: { type: "integer", minimum: 1, maximum: 5000 },
        confirm: { type: "string" },
        capability_envelope_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "admin_tool_catalog_search",
    displayName: "Search Admin Tool Catalog",
    description: "Search and paginate the full governed admin tool catalog through callAdminTool when the direct list surface cannot pass cursor/query parameters. Large catalog responses must preserve governed chunk continuation and dynamic TTL controls.",
    method: "VIRTUAL",
    path: "internal://admin-tool-catalog-search",
    tags: ["tooling", "catalog", "pagination", "read_only", "chunk_contract", "dynamic_ttl"],
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        tag: { type: "string" },
        cursor: { type: "integer", minimum: 0, default: 0 },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        response_options: {
          type: "object",
          description: "Optional governed response envelope controls. Use chunk_ttl_ms or chunk_ttl_minutes to extend durable response chunk availability.",
          properties: {
            max_chars: { type: "integer", minimum: 5000, maximum: 150000 },
            chunk_ttl_ms: { type: "integer", minimum: 300000, maximum: 7200000 },
            chunk_ttl_minutes: { type: "integer", minimum: 5, maximum: 120 },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "runtime_dispatch_certification_issue",
    displayName: "Issue Runtime Dispatch Certification",
    description: "Issue one bounded runtime dispatch certification into runtime_dispatch_certification_registry. Requires a capability envelope, typed confirmation derived from certification_key, bounded evidence, expiry, same-cycle readback, no provider call, no external write, no secrets, and never grants apply_allowed=true.",
    method: "VIRTUAL",
    path: "internal://runtime-dispatch-certification-issue",
    tags: ["admin", "runtime_dispatch", "certification", "state_changing", "typed_confirmation", "capability_envelope", "same_cycle_readback", "no_provider_call", "no_external_write", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["certification_key", "surface_key", "surface_family", "tool_or_action_key", "risk_class", "last_evidence_ref", "confirm", "capability_envelope_id"],
      properties: {
        certification_key: { type: "string", pattern: "^[A-Za-z0-9_.:-]{3,191}$" },
        surface_key: { type: "string", pattern: "^[A-Za-z0-9_.:-]{3,191}$" },
        surface_family: { type: "string", pattern: "^[A-Za-z0-9_.:-]{3,128}$" },
        tool_or_action_key: { type: "string", pattern: "^[A-Za-z0-9_.:-]{3,191}$" },
        risk_class: { type: "string", pattern: "^[A-Za-z0-9_.:-]{1,64}$" },
        certification_status: { type: "string", maxLength: 128, default: "ci_certified" },
        smoke_strategy: { type: "string", maxLength: 191, default: "bounded_evidence_readback" },
        dispatch_allowed: { type: "boolean", default: true },
        apply_allowed: { type: "boolean", const: false, default: false },
        requires_resource_authority: { type: "boolean", default: true },
        requires_dry_run: { type: "boolean", default: true },
        requires_audit_evidence: { type: "boolean", default: true },
        requires_readback: { type: "boolean", default: true },
        last_evidence_ref: { type: "string", minLength: 20, maxLength: 1000 },
        expires_in_days: { type: "integer", minimum: 1, maximum: 90, default: 30 },
        notes: { type: "string", maxLength: 1000 },
        confirm: { type: "string" },
        capability_envelope_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "github_pr_ci_gate",
    displayName: "GitHub Pull Request CI Gate",
    description: "Read one PR, compare its head with the current base, and aggregate required check-runs into one merge-readiness decision. No mutation or secret return.",
    method: "VIRTUAL",
    path: "internal://github-pr-ci-gate",
    tags: ["repo", "github", "pull_request", "ci", "read_only", "readback"],
    inputSchema: {
      type: "object",
      required: ["pull_number"],
      properties: {
        pull_number: { type: "integer", minimum: 1 },
        required_checks: { type: "array", items: { type: "string" }, maxItems: 20 },
        owner: { type: "string" },
        repo: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "github_pr_finalize",
    displayName: "GitHub Pull Request Finalize",
    description: "Finalize one PR through a single governed flow: required-check gate, expected head/base SHA validation, typed confirmation, merge, ancestry readback, and optional disposable-branch cleanup.",
    method: "VIRTUAL",
    path: "internal://github-pr-finalize",
    tags: ["repo", "github", "pull_request", "mutation", "ci_gate", "capability_envelope", "readback", "cleanup_required"],
    inputSchema: {
      type: "object",
      required: ["pull_number", "expected_head_sha", "expected_base_sha", "confirm", "capability_envelope_id"],
      properties: {
        pull_number: { type: "integer", minimum: 1 },
        expected_head_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        expected_base_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        confirm: { type: "string" },
        capability_envelope_id: { type: "string" },
        merge_method: { type: "string", enum: ["merge", "squash", "rebase"], default: "merge" },
        delete_branch: { type: "boolean", default: true },
        required_checks: { type: "array", items: { type: "string" }, maxItems: 20 },
        commit_title: { type: "string", maxLength: 256 },
        commit_message: { type: "string", maxLength: 10000 },
        owner: { type: "string" },
        repo: { type: "string" },
        default_branch: { type: "string", default: "main" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "github_branch_delete",
    displayName: "GitHub Branch Delete",
    description: "Delete a governed disposable GitHub branch only after capability approval, actual GitHub default-branch protection, expected-head SHA match, typed confirmation, open-PR guard, proof of zero unique commits, pre-delete SHA readback, and same-cycle absence readback.",
    method: "VIRTUAL",
    path: "internal://github-branch-delete",
    tags: ["repo", "github", "branch", "mutation", "capability_envelope", "readback"],
    inputSchema: {
      type: "object",
      required: ["branch", "expected_head_sha", "confirm", "capability_envelope_id"],
      properties: {
        branch: { type: "string" },
        expected_head_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        confirm: { type: "string" },
        capability_envelope_id: { type: "string" },
        owner: { type: "string" },
        repo: { type: "string" },
        default_branch: { type: "string", default: "main" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "github_branch_cleanup_sweep",
    displayName: "GitHub Branch Cleanup Sweep",
    description: "Plan or apply a bounded repository branch cleanup sweep. Dry-run is the default. Apply requires fresh base/fingerprint evidence, typed confirmation, a capability envelope, per-branch open-PR and unique-commit guards, and same-cycle absence readback.",
    method: "VIRTUAL",
    path: "internal://github-branch-cleanup-sweep",
    tags: ["repo", "github", "branch", "cleanup", "dry_run_default", "bounded_batch", "mutation", "capability_envelope", "readback"],
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["dry_run", "apply"], default: "dry_run" },
        page: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
        max_pages: { type: "integer", minimum: 1, maximum: 3, default: 1 },
        scan_limit: { type: "integer", minimum: 1, maximum: 300, default: 100 },
        max_deletes: { type: "integer", minimum: 1, maximum: 25, default: 10 },
        min_age_days: { type: "integer", minimum: 1, maximum: 3650, default: 7 },
        branch_prefixes: { type: "array", items: { type: "string" }, maxItems: 29 },
        expected_base_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        expected_evidence_fingerprint: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
        confirm: { type: "string" },
        capability_envelope_id: { type: "string" },
        owner: { type: "string" },
        repo: { type: "string" },
        default_branch: { type: "string", default: "main" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "repo_patch_batch_apply",
    displayName: "Repository Batch Patch Apply",
    description: "Create one atomic multi-file Git commit using Git trees. Supports write_file, delete_file, and apply_unified_diff. By default the work branch must be pinned to expected_base_sha; same-branch continuation may use expected_branch_sha with default-branch overlap checks and readback.",
    method: "VIRTUAL",
    path: "internal://repo-patch-batch-apply",
    tags: ["repo", "mutation", "batch", "atomic", "capability_envelope", "readback"],
    inputSchema: {
      type: "object",
      required: ["branch", "expected_base_sha", "commit_message", "changes", "capability_envelope_id"],
      properties: {
        branch: { type: "string" },
        expected_base_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        expected_branch_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$", description: "Optional current work-branch head SHA for same-branch continuation when the branch already has prior commits." },
        allow_same_branch_continuation: { type: "boolean", default: false, description: "Allow writing on the same non-protected work branch when expected_branch_sha matches and moved default-branch files do not overlap the requested patch paths." },
        commit_message: { type: "string", minLength: 5, maxLength: 200 },
        capability_envelope_id: { type: "string" },
        changes: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            required: ["path", "action"],
            properties: {
              path: { type: "string" },
              action: { type: "string", enum: ["write_file", "delete_file", "apply_unified_diff"] },
              content: { type: "string", description: "Full new file content for write_file." },
              diff: { type: "string", description: "Single-file unified diff for apply_unified_diff. Hunks are validated against expected_base_sha before any Git write." },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "repo_existing_blob_commit_apply",
    displayName: "Repository Existing Blob Commit Apply",
    description: "Create one commit on an existing non-protected work branch by reusing Git blob SHAs already present in the repository. Requires expected-head validation, capability approval, no-force ref update, and same-cycle path/blob readback without uploading file content.",
    method: "VIRTUAL",
    path: "internal://repo-existing-blob-commit-apply",
    tags: ["repo", "github", "mutation", "existing_blob", "capability_envelope", "no_force", "readback"],
    inputSchema: {
      type: "object",
      required: ["branch", "expected_head_sha", "commit_message", "changes", "capability_envelope_id"],
      properties: {
        branch: { type: "string" },
        expected_head_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        commit_message: { type: "string", minLength: 5, maxLength: 200 },
        capability_envelope_id: { type: "string" },
        changes: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            required: ["path", "blob_sha"],
            properties: {
              path: { type: "string" },
              blob_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
              mode: { type: "string", enum: ["100644", "100755"], default: "100644" },
            },
            additionalProperties: false,
          },
        },
        owner: { type: "string" },
        repo: { type: "string" },
        default_branch: { type: "string", default: "main" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "growth_intelligence_pilot_run",
    displayName: "Run Growth Intelligence Pilot",
    description: "Run the registry-backed Growth Intelligence pilot for one active tenant and Brand Core-ready brand. Resolves Business Activity from SQL, persists the report, insights, actions, approval holds, and readiness assessment to internal registries, and performs same-cycle readback. No provider writes, external sends, live execution, or secrets.",
    method: "VIRTUAL",
    path: "internal://growth-intelligence-pilot-run",
    tags: ["growth_intelligence", "pilot", "internal_registry", "approval_required", "dry_run", "no_provider_write", "no_external_send", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["tenant_id", "brand_key"],
      properties: {
        tenant_id: { type: "string", minLength: 1, maxLength: 64 },
        brand_key: { type: "string", minLength: 1, maxLength: 128 },
        business_activity_type_key: { type: "string", default: "business_and_industrial_products" },
        persistence_mode: { type: "string", enum: ["internal_registry"], default: "internal_registry" },
        outbox_mode: { type: "string", enum: ["disabled", "dev_transactional"], default: "disabled", description: "Optional dev-only transactional outbox producer. dev_transactional is rejected unless the active database name ends in _dev." },
        evidence_limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        report_id: { type: "string", maxLength: 64 },
        requested_by: { type: "string", maxLength: 128 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "growth_intelligence_insight_decide",
    displayName: "Decide Growth Intelligence Insight",
    description: "Accept, reject, or mark stale one persisted Growth Intelligence insight. Records an internal decision only; no provider write, external send, or execution.",
    method: "VIRTUAL",
    path: "internal://growth-intelligence-insight-decide",
    tags: ["growth_intelligence", "decision", "internal_registry", "approval_required", "readback", "same_cycle_readback", "no_execution", "no_provider_write", "no_external_send", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["tenant_id", "report_id", "insight_id", "decision"],
      properties: {
        tenant_id: { type: "string" }, report_id: { type: "string" }, insight_id: { type: "string" },
        decision: { type: "string", enum: ["accepted", "rejected", "stale"] },
        decision_by: { type: "string", maxLength: 36 }, decision_note: { type: "string", maxLength: 512 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "growth_intelligence_action_decide",
    displayName: "Decide Growth Intelligence Action",
    description: "Approve or reject one Growth Intelligence dry-run action and its linked approval hold. Never dispatches the action or performs provider writes.",
    method: "VIRTUAL",
    path: "internal://growth-intelligence-action-decide",
    tags: ["growth_intelligence", "approval", "internal_registry", "approval_required", "readback", "same_cycle_readback", "no_execution", "no_provider_write", "no_external_send", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["tenant_id", "report_id", "action_id", "decision"],
      properties: {
        tenant_id: { type: "string" }, report_id: { type: "string" }, action_id: { type: "string" },
        decision: { type: "string", enum: ["approved", "rejected"] },
        decision_by: { type: "string", maxLength: 36 }, decision_note: { type: "string", maxLength: 512 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "growth_intelligence_readiness_refresh",
    displayName: "Refresh Growth Intelligence Readiness",
    description: "Recompute and persist Growth Intelligence review readiness after insight and action decisions. Does not enable or dispatch execution.",
    method: "VIRTUAL",
    path: "internal://growth-intelligence-readiness-refresh",
    tags: ["growth_intelligence", "readiness", "internal_registry", "approval_required", "readback", "same_cycle_readback", "no_execution", "no_provider_write", "no_external_send", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["tenant_id", "report_id"],
      properties: { tenant_id: { type: "string" }, report_id: { type: "string" }, assessed_by: { type: "string", maxLength: 128 } },
      additionalProperties: false,
    },
  },
  {
    name: "repository_advisory_comment_approval_hold_create",
    displayName: "Create Repository Advisory Comment Approval Hold",
    description: "Create or reuse a dedicated approval hold for one V5 advisory-comment plan. Records internal workflow and approval state only; no GitHub comment is posted.",
    method: "VIRTUAL",
    path: "internal://repository-advisory-comment-approval-hold-create",
    tags: ["repository_intelligence", "v5", "approval_hold", "internal_registry", "no_provider_write", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["plan_id"],
      properties: {
        plan_id: { type: "string" }, requested_by: { type: "string", maxLength: 36 },
        required_role: { type: "string", maxLength: 64 }, ttl_minutes: { type: "integer", minimum: 5, maximum: 1440, default: 60 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "repository_advisory_comment_approval_hold_approve",
    displayName: "Approve Repository Advisory Comment Approval Hold",
    description: "Approve the dedicated hold for exactly one V5 advisory GitHub comment using plan/hold binding and typed confirmation. Approval itself performs no provider write.",
    method: "VIRTUAL",
    path: "internal://repository-advisory-comment-approval-hold-approve",
    tags: ["repository_intelligence", "v5", "approval_hold", "typed_confirmation", "no_provider_write", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["plan_id", "approval_hold_id", "confirm"],
      properties: {
        plan_id: { type: "string" }, approval_hold_id: { type: "string" }, confirm: { type: "string" },
        decision_by: { type: "string", maxLength: 36 }, decision_note: { type: "string", maxLength: 512 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "platform_tool_binding_integrity_audit",
    displayName: "Platform Tool Binding Integrity Audit",
    description: "Audit active ready endpoints, endpoint exports, dispatch bindings, and callable admin tools. Returns bounded relation gaps without mutation or secrets.",
    method: "VIRTUAL",
    path: "internal://platform-tool-binding-integrity-audit",
    tags: ["registry", "tooling", "integrity", "read_only", "diagnostics"],
    inputSchema: {
      type: "object",
      properties: {
        parent_action_key: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 200 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "repository_reconciliation_orchestrator",
    displayName: "Repository Reconciliation Orchestrator",
    description: "Build a governed repository reconciliation plan from the active recipe, exact base and branch SHAs, and live read-only branch evidence. This Admin surface is dry-run only: it does not execute recipe steps, create provider writes, update refs, merge, delete branches, or consume credentials beyond the governed GitHub read transport.",
    method: "VIRTUAL",
    path: "internal://repository-reconciliation-orchestrator",
    tags: ["admin", "repository", "reconciliation", "orchestrator", "dry_run", "read_only", "provider_read_only", "no_provider_write", "no_mutation", "no_force_push", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["owner", "repo", "branch", "pull_number", "expected_base_sha", "expected_branch_sha"],
      properties: {
        owner: { type: "string", minLength: 1, maxLength: 191 },
        repo: { type: "string", minLength: 1, maxLength: 191 },
        branch: { type: "string", minLength: 1, maxLength: 255 },
        default_branch: { type: "string", minLength: 1, maxLength: 255, default: "main" },
        pull_number: { type: "integer", minimum: 1 },
        expected_base_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        expected_branch_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        mode: { type: "string", enum: ["dry_run"], default: "dry_run" },
        recipe_key: { type: "string", maxLength: 191, default: "repo.pr.reconcile_and_finalize" },
        operation_id: { type: "string", maxLength: 64 },
        plan_id: { type: "string", maxLength: 64 },
        tenant_id: { type: "string", maxLength: 64 },
        workspace_id: { type: "string", maxLength: 64 },
        user_id: { type: "string", maxLength: 64 },
        actor_id: { type: "string", maxLength: 128 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "admin_branch_reconcile",
    displayName: "Admin Branch Reconcile",
    description: "Dry-run branch drift reconciliation adapter. Reads GitHub refs/compare through the GitHub App, classifies drift, returns a no-secret continuation checkpoint, and blocks apply until explicit review/confirmation surfaces exist.",
    method: "VIRTUAL",
    path: "internal://admin-branch-reconcile",
    tags: ["repo", "reconciliation", "read_only", "dry_run"],
    inputSchema: {
      type: "object",
      required: ["branch"],
      properties: {
        branch: { type: "string", description: "Governed non-production work branch, e.g. gpt/example." },
        default_branch: { type: "string", default: "main" },
        owner: { type: "string", description: "Optional GitHub owner override; defaults to activation bootstrap." },
        repo: { type: "string", description: "Optional GitHub repo override; defaults to activation bootstrap." },
        mode: { type: "string", enum: ["dry_run", "apply"], default: "dry_run" },
        confirm: { type: "string", description: "Reserved for future apply mode confirmation." },
      },
    },
  },
  {
    name: "github_superseded_branch_cleanup",
    displayName: "GitHub Superseded Branch Cleanup",
    description: "Dry-run or delete a superseded closed-PR branch, or an explicit orphan branch with no matching PR, only when replacement commits are on the default branch and every non-generated file is covered. Orphan mode additionally requires exact Git blob equivalence with the current default branch. Apply requires fresh SHA/fingerprint evidence, typed confirmation, a capability envelope, a reason, and same-cycle missing-ref readback.",
    method: "VIRTUAL",
    path: "internal://github-superseded-branch-cleanup",
    tags: ["repo", "reconciliation", "mutation", "capability_envelope", "closed_pr", "same_cycle_readback"],
    inputSchema: {
      type: "object",
      required: ["branch", "superseding_commits"],
      properties: {
        branch: { type: "string", description: "Governed non-production work branch associated with a closed PR." },
        default_branch: { type: "string", default: "main" },
        owner: { type: "string", description: "Optional GitHub owner override; defaults to activation bootstrap." },
        repo: { type: "string", description: "Optional GitHub repo override; defaults to activation bootstrap." },
        superseding_commits: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", pattern: "^[0-9a-fA-F]{40}$" } },
        coverage_resolutions: {
          type: "array",
          maxItems: 20,
          description: "Explicit reviewed file coverage resolutions for changed files not covered by exact replacement path matching.",
          items: {
            type: "object",
            required: ["file", "resolution_type", "superseded_by_file", "superseded_by_commit", "reason"],
            properties: {
              file: { type: "string" },
              resolution_type: { type: "string", enum: ["migration_superseded_by_applied_migration", "intentional_non_port"] },
              superseded_by_file: { type: "string" },
              superseded_by_commit: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
              expected_migration_checksum_sha256: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
              expected_statement_count: { type: "integer", minimum: 1, maximum: 5000 },
              reason: { type: "string", minLength: 20, maxLength: 1000 },
            },
            additionalProperties: false,
          },
        },
        allow_orphan_branch: { type: "boolean", default: false, description: "Explicit orphan mode. Requires zero matching PRs and exact non-generated file blob equivalence with the current default branch." },
        mode: { type: "string", enum: ["dry_run", "apply"], default: "dry_run" },
        expected_base_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        expected_branch_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
        expected_evidence_fingerprint: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
        confirm: { type: "string" },
        reason: { type: "string", minLength: 20, maxLength: 500 },
        capability_envelope_id: { type: "string" },
      },
    },
  },
  {
    name: "github_branch_fast_forward_smoke",
    displayName: "GitHub Branch Fast Forward Smoke",
    description: "End-to-end positive smoke for the guarded branch fast-forward recipe. Creates a disposable gpt/fast-forward-smoke-* branch at the parent of the default branch, verifies behind_only dry-run, runs github_branch_fast_forward_to_base, requires readback to up_to_date, and deletes the smoke branch in cleanup.",
    method: "VIRTUAL",
    path: "internal://github-branch-fast-forward-smoke",
    tags: ["repo", "reconciliation", "smoke", "mutation", "capability_envelope", "cleanup_required", "no_force"],
    inputSchema: {
      type: "object",
      required: ["capability_envelope_id"],
      properties: {
        capability_envelope_id: { type: "string", description: "Ready capability envelope approved for github_branch_fast_forward_smoke or branch fast-forward mutation." },
        smoke_id: { type: "string", description: "Optional suffix for gpt/fast-forward-smoke-<suffix>. Defaults to current timestamp." },
        default_branch: { type: "string", default: "main" },
        owner: { type: "string", description: "Optional GitHub owner override; defaults to activation bootstrap." },
        repo: { type: "string", description: "Optional GitHub repo override; defaults to activation bootstrap." },
      },
    },
  },
  {
    name: "github_branch_fast_forward_to_base",
    displayName: "GitHub Branch Fast Forward To Base",
    description: "Guarded mutation recipe for behind_only work branches. Requires a prior admin_branch_reconcile dry-run, matching expected base/branch SHAs, capability envelope approval, typed RECONCILE_BRANCH_<BRANCH_SLUG> confirmation, no-force GitHub ref update, and same-cycle readback.",
    method: "VIRTUAL",
    path: "internal://github-branch-fast-forward-to-base",
    tags: ["repo", "reconciliation", "mutation", "capability_envelope", "no_force"],
    inputSchema: {
      type: "object",
      required: ["branch", "expected_base_sha", "expected_branch_sha", "confirm", "capability_envelope_id"],
      properties: {
        branch: { type: "string", description: "Governed non-production work branch previously classified as behind_only." },
        default_branch: { type: "string", default: "main" },
        owner: { type: "string", description: "Optional GitHub owner override; defaults to activation bootstrap." },
        repo: { type: "string", description: "Optional GitHub repo override; defaults to activation bootstrap." },
        expected_base_sha: { type: "string", description: "Base SHA from the same-cycle admin_branch_reconcile dry-run evidence." },
        expected_branch_sha: { type: "string", description: "Branch SHA from the same-cycle admin_branch_reconcile dry-run evidence." },
        confirm: { type: "string", description: "Typed confirmation, e.g. RECONCILE_BRANCH_GPT_EXAMPLE." },
        capability_envelope_id: { type: "string", description: "Ready capability envelope approved for github_branch_fast_forward_to_base or repo mutation." },
      },
    },
  },
  {
    name: "github_branch_merge_commit_create",
    displayName: "GitHub Branch Multi-Parent Merge Commit Create",
    description: "Create one governed merge commit on a non-protected diverged work branch using an explicit resolution commit whose sole parent is the expected base. Requires fresh branch/base SHAs, capability-envelope approval, typed confirmation, no-force ref update, exact scope validation, and same-cycle ancestry/tree/readback verification.",
    method: "VIRTUAL",
    path: "internal://github-branch-merge-commit-create",
    tags: ["repo", "reconciliation", "mutation", "capability_envelope", "merge_commit", "no_force", "same_cycle_readback"],
    inputSchema: {
      type: "object",
      required: ["branch", "expected_base_sha", "expected_branch_sha", "resolution_commit_sha", "confirm", "capability_envelope_id"],
      properties: {
        branch: { type: "string", description: "Governed non-production diverged work branch." },
        default_branch: { type: "string", default: "main" },
        owner: { type: "string", description: "Optional GitHub owner override; defaults to activation bootstrap." },
        repo: { type: "string", description: "Optional GitHub repo override; defaults to activation bootstrap." },
        expected_base_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$", description: "Fresh default-branch SHA from same-cycle reconciliation." },
        expected_branch_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$", description: "Fresh work-branch SHA from same-cycle reconciliation." },
        resolution_commit_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$", description: "Commit whose sole parent is expected_base_sha and whose tree is the reviewed merge result." },
        commit_message: { type: "string", minLength: 5, maxLength: 5000 },
        confirm: { type: "string", description: "Typed CREATE_MERGE_COMMIT_<BRANCH_SLUG> confirmation." },
        capability_envelope_id: { type: "string", description: "Ready capability envelope approved for branch merge-commit creation or repo mutation." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "repo_patch_apply",
    displayName: "Repository Patch Apply",
    description: "Apply a patch to the repository via the GitHub App, sidestepping the local connector. Actions: write_file, replace_block, apply_unified_diff, delete_file, dedupe_openapi_paths. Path is repo-confined; secrets/build folders are blocked. Runtime defaults to a generated non-protected work branch. Protected branches are blocked unless explicit break-glass policy is enabled and justified.",
    method: "VIRTUAL",
    path: "internal://repo-patch-apply",
    tags: ["repo", "mutation", "self_repair", "capability_envelope", "readback", "no_secrets"],
    inputSchema: {
      type: "object",
      required: ["action", "path", "commit_message", "capability_envelope_id"],
      properties: {
        action: { type: "string", enum: ["write_file", "replace_block", "apply_unified_diff", "delete_file", "dedupe_openapi_paths"] },
        capability_envelope_id: { type: "string", description: "Required. Must reference a ready no-secret capability_resolution_envelope_ledger envelope for repo_patch_apply." },
        path: { type: "string", description: "Repository-relative path of the single file to modify, e.g. http-generic-api/pathResolverDbLoader.js." },
        commit_message: { type: "string", minLength: 5, maxLength: 200 },
        branch: { type: "string", description: "Target work branch. If omitted, runtime generates a non-protected gpt/repo-patch/* branch. Protected branches are blocked by default." },
        allow_protected_branch: { type: "boolean", description: "Break-glass only. Requires REPO_PATCH_ALLOW_PROTECTED_BRANCH=true and break_glass_reason." },
        break_glass_reason: { type: "string", description: "Required for protected-branch break-glass mutation." },
        allow_stale_branch_patch: { type: "boolean", description: "Break-glass only. Allows patching an existing branch that is behind/diverged from the default branch." },
        stale_branch_reason: { type: "string", description: "Required explanation when allow_stale_branch_patch is true." },
        content: { type: "string", description: "Full new file content. Required for write_file." },
        old_string: { type: "string", description: "Exact substring to replace. Must occur exactly once. Required for replace_block." },
        new_string: { type: "string", description: "Replacement substring. Required for replace_block." },
        diff: { type: "string", description: "Unified diff body (a single file). Required for apply_unified_diff. Headers like diff --git/--- /+++ are optional; only hunks are required." },
      },
    },
  },
];

const DEFAULT_REPO_PATCH_MAX_BYTES = 1_000_000; // Default 1 MB upper bound for new content.
const LARGE_TEXT_REPO_PATCH_MAX_BYTES = 2_000_000; // Allow large generated text contracts such as OpenAPI.
const LARGE_TEXT_REPO_PATCH_PATHS = new Set([
  "http-generic-api/openapi.yaml",
  "http-generic-api/openapi.yml",
]);

export function repoPatchMaxBytesForPath(filePath = "") {
  const normalized = String(filePath || "").replaceAll("\\", "/").replace(/^\.\//, "");
  return LARGE_TEXT_REPO_PATCH_PATHS.has(normalized)
    ? LARGE_TEXT_REPO_PATCH_MAX_BYTES
    : DEFAULT_REPO_PATCH_MAX_BYTES;
}

const OPENAPI_ORPHAN_SYSTEM_TOOL_SCHEMA_BLOCK = `
                  description: Runtime tool key returned by listTools. The server validates registration, scope, policy, capability envelope, and input schema at execution time.
                arguments:
                  type: object
                  additionalProperties: true
                  deprecated: true
                  description: Legacy tool arguments. Tenant GPT callers should use tool_args.
                tool_args:
                  type: object
                  additionalProperties: true
                  description: Tool arguments. For connector_registry_get, include system_id. For activation bootstrap upsert, include GitHub binding fields. Admin provider tools require admin/service auth.
                  properties:
                    mode:
                      type: string
                      enum: [managed, dedicated, hybrid]
                    integration_modes:
                      type: array
                      items: { type: string }
                    device_id:
                      type: string
                      pattern: "^[a-z0-9-]{2,32}$"
      responses:
        "200":
          description: System tool result
          content:
            application/json:
              schema:
                type: object
                additionalProperties: true
                properties:
                  ok: { type: boolean }
                  name: { type: string }
                  result: { type: object, additionalProperties: true }
        "400": { $ref: "#/components/responses/BadRequest" }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "403": { description: Tenant scope violation, content: { application/json: { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
`;

const OPENAPI_COMPLETION_CERTIFICATION_BLOCK = `  /admin/support/tickets/{ticket_id}/external-delivery/completion-certification:
    post:
      x-openai-isConsequential: false
      tags: [platform-plugins]
      security:
        - backendBearerAuth: []
        - backendApiKeyAuth: []
      operationId: supportTicketExternalDeliveryCompletionCertify
      summary: Certify Support Ticket external delivery completion gates
      description: >
        Admin-only completion certification surface for Support Ticket external delivery.
        It runs AM-1 through AM-16 readback/certification for one ticket and returns
        a no-send/no-secret certification envelope. The route does not perform SMTP,
        webhook, provider network dispatch, live external send, or raw credential readback.
        Sandbox mode returns mock provider evidence only; live_send remains gated.
      parameters:
        - name: ticket_id
          in: path
          required: true
          schema: { type: string, minLength: 1, maxLength: 128 }
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              properties:
                tenant_id: { type: string }
                channel: { type: string, enum: [email, webhook], default: email }
                audience: { type: string, enum: [admin, customer, both], default: admin }
                provider_key: { type: string }
                send_mode: { type: string, enum: [dry_run, record_only, provider_send_blocked, sandbox, live_send], default: dry_run }
                approval_hold_id: { type: string }
                credential_ref: { type: string }
                idempotency_key: { type: string }
                subject: { type: string }
                body: { type: string }
                payload_json: { type: object, additionalProperties: true }
      responses:
        '200':
          description: Completion certification envelope. Live dispatch remains gated and external sends are not performed.
          content:
            application/json:
              schema:
                type: object
                additionalProperties: true
                properties:
                  ok: { type: boolean, enum: [true] }
                  mode: { type: string, enum: [completion_certification] }
                  tenant_id: { type: string }
                  ticket_id: { type: string }
                  channel: { type: string, enum: [email, webhook] }
                  audience: { type: string, enum: [admin, customer, both] }
                  provider_key: { type: string, nullable: true }
                  send_mode: { type: string, enum: [dry_run, record_only, provider_send_blocked, sandbox, live_send] }
                  summary: { $ref: '#/components/schemas/JsonValue' }
                  phases: { type: array, items: { type: object, additionalProperties: true } }
                  live_external_send_enabled: { type: boolean, enum: [false] }
                  external_send_performed: { type: boolean, enum: [false] }
                  secret_value_included: { type: boolean, enum: [false] }
                  secrets_included: { type: boolean, enum: [false] }
        '400': { description: Invalid certification request, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { description: Not authorized for the admin certification route, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        '404': { description: Support Ticket not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        '500': { description: Completion certification failed unexpectedly, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
`;

export function dedupeOpenApiPathsText(content = "") {
  const originalContent = String(content || "").replace(/\r\n/g, "\n");
  let text = originalContent;
  const originalBytes = Buffer.byteLength(text, "utf8");
  let orphan_removed = false;
  if (text.includes(OPENAPI_ORPHAN_SYSTEM_TOOL_SCHEMA_BLOCK)) {
    text = text.replace(OPENAPI_ORPHAN_SYSTEM_TOOL_SCHEMA_BLOCK, "\n");
    orphan_removed = true;
  }

  let completion_route_repaired = false;
  const completionStart = text.indexOf("  /admin/support/tickets/{ticket_id}/external-delivery/completion-certification:\n");
  const lifecycleNeedle = "    post:\n      x-openai-isConsequential: true\n      tags: [platform-plugins]\n      security:\n        - backendBearerAuth: []\n        - backendApiKeyAuth: []\n      operationId: supportTicketLifecycleSnapshotRecord\n";
  if (completionStart !== -1) {
    const lifecyclePost = text.indexOf(lifecycleNeedle, completionStart);
    if (lifecyclePost !== -1) {
      text = `${text.slice(0, completionStart)}${OPENAPI_COMPLETION_CERTIFICATION_BLOCK}\n  /platform/orchestration/support-ticket/snapshot-record:\n${text.slice(lifecyclePost)}`;
      completion_route_repaired = true;
    }
  }

  const lines = text.split("\n").map((line, index, array) => index < array.length - 1 ? `${line}\n` : line);
  const pathsIndex = lines.findIndex((line) => line.trim() === "paths:" && !line.startsWith(" "));
  if (pathsIndex < 0) {
    const err = new Error("OpenAPI paths root was not found.");
    err.status = 422;
    err.code = "repo_patch_openapi_paths_root_missing";
    throw err;
  }
  const pre = lines.slice(0, pathsIndex + 1);
  const pathLines = lines.slice(pathsIndex + 1);
  const blocks = [];
  const synthetic = [];
  let current = null;
  for (const line of pathLines) {
    if (/^  \/.*:\s*$/.test(line)) {
      if (current) blocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    } else {
      synthetic.push(line);
    }
  }
  if (current) blocks.push(current);
  const latest = new Map();
  blocks.forEach((block, index) => {
    latest.set(block[0].trim().slice(0, -1), { index, block });
  });
  const keptBlocks = [...latest.values()].sort((a, b) => a.index - b.index).map((entry) => entry.block);
  const newContent = [...pre, ...synthetic, ...keptBlocks.flat()].join("").trimEnd() + "\n";
  const summary = {
    original_bytes: originalBytes,
    new_bytes: Buffer.byteLength(newContent, "utf8"),
    original_path_blocks: blocks.length,
    unique_paths: latest.size,
    duplicate_paths_removed: blocks.length - latest.size,
    orphan_removed,
    completion_route_repaired,
    secrets_included: false,
  };
  return { content: newContent, summary };
}

async function requireRepoPatchCapabilityEnvelope({ args = {}, ctx = {}, owner = "", repo = "", branch = "", defaultBranch = "", filePath = "", action = "" } = {}) {
  const resolved = await resolveCapabilityExecutionEnvelope({
    pool: getPool(),
    source: args,
    acceptedAppKeys: ["github"],
    acceptedIntents: ["repo_patch_apply", "repo_mutation", "github_repo_patch", "write", "create", "delete", action].filter(Boolean),
    expectedTenantId: ctx?.auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: ctx?.auth?.user_id || "",
  });
  if (!resolved.ok) {
    throw capabilityEnvelopeError(resolved, "Repository patch apply requires a valid capability resolution envelope before GitHub mutation.");
  }
  await markCapabilityEnvelopeReferenced({ pool: getPool(), envelopeId: resolved.envelope_id, executionRef: `repo_patch_apply:${action || "mutation"}` });
  return {
    ...resolved,
    repo_patch_context: {
      owner,
      repo,
      branch,
      default_branch: defaultBranch,
      path: filePath,
      action,
      secrets_included: false,
    },
  };
}

async function requireRepositoryCloseSupersededPositiveSmokeEnvelope({ args = {}, ctx = {} } = {}) {
  const expectedMainSha = String(args?.expected_main_sha || "").trim().toLowerCase();
  const resolved = await resolveCapabilityExecutionEnvelope({
    pool: getPool(),
    source: args,
    acceptedAppKeys: ["github"],
    acceptedIntents: ["repository_close_superseded_positive_smoke", "repo.pr.close_superseded.smoke", "repo_mutation"],
    expectedTenantId: ctx?.auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: ctx?.auth?.user_id || "",
    expectedCommitSha: expectedMainSha,
    requireReadyForDispatch: true,
    requireDispatchAllowed: true,
    requireNoBlockingGaps: true,
    requireNoSecrets: true,
  });
  if (!resolved.ok) {
    throw capabilityEnvelopeError(resolved, "Repository close-superseded positive smoke requires a valid capability resolution envelope bound to expected_main_sha.");
  }
  await markCapabilityEnvelopeReferenced({
    pool: getPool(),
    envelopeId: resolved.envelope_id,
    executionRef: `repository_close_superseded_positive_smoke:${expectedMainSha || "unknown"}`,
  });
  return { ...resolved, secrets_included: false };
}

async function requireGithubBranchFastForwardEnvelope({ args = {}, ctx = {} } = {}) {
  const resolved = await resolveCapabilityExecutionEnvelope({
    pool: getPool(),
    source: args,
    acceptedAppKeys: ["github"],
    acceptedIntents: ["github_branch_fast_forward_smoke", "github_branch_fast_forward_to_base", "admin_branch_fast_forward_to_base", "github_ref_update", "repo_mutation", "branch_fast_forward"],
    expectedTenantId: ctx?.auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: ctx?.auth?.user_id || "",
  });
  if (!resolved.ok) {
    throw capabilityEnvelopeError(resolved, "GitHub branch fast-forward requires a valid capability resolution envelope before ref mutation.");
  }
  await markCapabilityEnvelopeReferenced({ pool: getPool(), envelopeId: resolved.envelope_id, executionRef: `github_branch_fast_forward_to_base:${args?.branch || "unknown"}` });
  return { ...resolved, secrets_included: false };
}

async function requireGithubBranchMergeCommitEnvelope({ args = {}, ctx = {} } = {}) {
  const resolved = await resolveCapabilityExecutionEnvelope({
    pool: getPool(),
    source: args,
    acceptedAppKeys: ["github"],
    acceptedIntents: ["github_branch_merge_commit_create", "github_ref_update", "repo_mutation", "branch_merge_commit"],
    expectedTenantId: ctx?.auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: ctx?.auth?.user_id || "",
  });
  if (!resolved.ok) {
    throw capabilityEnvelopeError(resolved, "GitHub branch merge-commit creation requires a valid capability resolution envelope before GitHub mutation.");
  }
  await markCapabilityEnvelopeReferenced({
    pool: getPool(),
    envelopeId: resolved.envelope_id,
    executionRef: `github_branch_merge_commit_create:${args?.branch || "unknown"}`,
  });
  return { ...resolved, secrets_included: false };
}
async function requireGithubSupersededBranchCleanupEnvelope({ args = {}, ctx = {} } = {}) {
  const resolved = await resolveCapabilityExecutionEnvelope({
    pool: getPool(),
    source: args,
    acceptedAppKeys: ["github"],
    acceptedIntents: ["github_superseded_branch_cleanup", "github_branch_delete", "branch_cleanup", "repo_mutation"],
    expectedTenantId: ctx?.auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: ctx?.auth?.user_id || "",
  });
  if (!resolved.ok) {
    throw capabilityEnvelopeError(resolved, "GitHub superseded branch cleanup requires a valid capability resolution envelope before ref deletion.");
  }
  await markCapabilityEnvelopeReferenced({
    pool: getPool(),
    envelopeId: resolved.envelope_id,
    executionRef: `github_superseded_branch_cleanup:${args?.branch || "unknown"}`,
  });
  return { ...resolved, secrets_included: false };
}

async function requireGithubBranchDeleteEnvelope({ args = {}, ctx = {} } = {}) {
  const resolved = await resolveCapabilityExecutionEnvelope({
    pool: getPool(),
    source: args,
    acceptedAppKeys: ["github"],
    acceptedIntents: ["github_branch_delete", "github_repo_cleanup", "repository_ref_delete", "repo_mutation", "delete"],
    expectedTenantId: ctx?.auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: ctx?.auth?.user_id || "",
  });
  if (!resolved.ok) {
    throw capabilityEnvelopeError(resolved, "GitHub branch deletion requires a valid capability resolution envelope before ref mutation.");
  }
  await markCapabilityEnvelopeReferenced({
    pool: getPool(),
    envelopeId: resolved.envelope_id,
    executionRef: `github_branch_delete:${args?.branch || "unknown"}`,
  });
  return { ...resolved, secrets_included: false };
}

async function requireGithubBranchCleanupSweepEnvelope({ args = {}, ctx = {} } = {}) {
  const resolved = await resolveCapabilityExecutionEnvelope({
    pool: getPool(),
    source: args,
    acceptedAppKeys: ["github"],
    acceptedIntents: ["github_branch_cleanup_sweep", "github_branch_delete", "github_repo_cleanup", "repository_ref_delete", "repo_mutation", "delete"],
    expectedTenantId: ctx?.auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: ctx?.auth?.user_id || "",
  });
  if (!resolved.ok) {
    throw capabilityEnvelopeError(resolved, "GitHub branch cleanup sweep apply requires a valid capability resolution envelope before ref mutation.");
  }
  const evidenceRef = String(args?.expected_evidence_fingerprint || "unknown").slice(0, 12);
  await markCapabilityEnvelopeReferenced({
    pool: getPool(),
    envelopeId: resolved.envelope_id,
    executionRef: `github_branch_cleanup_sweep:${evidenceRef}`,
  });
  return { ...resolved, secrets_included: false };
}
async function requireGithubPrFinalizeEnvelope({ args = {}, ctx = {} } = {}) {
  const resolved = await resolveCapabilityExecutionEnvelope({
    pool: getPool(),
    source: args,
    acceptedAppKeys: ["github"],
    acceptedIntents: ["github_pr_finalize", "github_pr_merge", "github_repo_merge", "repo_mutation", "merge"],
    expectedTenantId: ctx?.auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: ctx?.auth?.user_id || "",
  });
  if (!resolved.ok) {
    throw capabilityEnvelopeError(resolved, "GitHub PR finalization requires a valid capability resolution envelope before merge mutation.");
  }
  await markCapabilityEnvelopeReferenced({
    pool: getPool(),
    envelopeId: resolved.envelope_id,
    executionRef: `github_pr_finalize:${args?.pull_number || "unknown"}`,
  });
  return { ...resolved, secrets_included: false };
}

async function auditPlatformToolBindings(args = {}) {
  const parentActionKey = String(args.parent_action_key || "github_api_mcp").trim();
  const limit = clampNumber(args.limit, 200, 1, 500);
  const virtualNames = new Set(VIRTUAL_ADMIN_TOOLS.map((tool) => tool.name));
  const [rows] = await getPool().query(
    `SELECT b.binding_id, b.parent_action_key, b.endpoint_key, b.source_endpoint_id,
            b.export_key, b.tool_key AS binding_tool_key, b.surface_class,
            b.capability_key, b.operation_intent, b.runtime_surface,
            b.readback_policy_key, b.partial_success_policy_key,
            b.atomicity_mode, b.status AS binding_status,
            e.id AS endpoint_id, e.method, e.endpoint_path_or_function,
            e.status AS endpoint_status, e.execution_readiness,
            x.tool_name AS exported_tool_name, x.status AS export_status,
            apt.tool_key AS admin_tool_key, apt.is_enabled AS admin_tool_enabled
       FROM platform_tool_dispatch_bindings b
       LEFT JOIN endpoints e ON e.id = b.source_endpoint_id
       LEFT JOIN platform_endpoint_tool_exports x ON x.export_key = b.export_key
       LEFT JOIN admin_platform_endpoint_tools apt ON apt.tool_key = b.tool_key
      WHERE b.parent_action_key = ?
        AND b.status = 'active'
      ORDER BY b.tool_key, b.endpoint_key, b.binding_id
      LIMIT ${limit}`,
    [parentActionKey]
  );
  const relations = (rows || []).map((row) => {
    const virtualTool = virtualNames.has(row.binding_tool_key);
    const dbTool = Boolean(row.admin_tool_key && Number(row.admin_tool_enabled) === 1);
    const callable = virtualTool || dbTool;
    const method = String(row.method || "").toUpperCase();
    const gaps = [];
    if (!row.endpoint_id || row.endpoint_status !== "active" || !["", "ready"].includes(String(row.execution_readiness || "").toLowerCase())) {
      gaps.push("endpoint_not_ready");
    }
    if (!row.export_key || row.export_status !== "active") gaps.push("missing_active_export");
    if (!callable) gaps.push("missing_callable_surface");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && !row.capability_key) gaps.push("mutation_missing_capability_key");
    if (!row.readback_policy_key) gaps.push("binding_missing_readback_policy");
    return {
      binding_id: row.binding_id,
      parent_action_key: row.parent_action_key,
      endpoint_id: row.endpoint_id || null,
      endpoint_key: row.endpoint_key,
      method: row.method || null,
      endpoint_path: row.endpoint_path_or_function || null,
      export_key: row.export_key || null,
      tool_key: row.binding_tool_key,
      surface_class: row.surface_class,
      virtual_tool: virtualTool,
      db_tool_enabled: dbTool,
      callable,
      capability_key: row.capability_key || null,
      readback_policy_key: row.readback_policy_key || null,
      partial_success_policy_key: row.partial_success_policy_key || null,
      atomicity_mode: row.atomicity_mode || null,
      gaps,
    };
  });
  const gaps = relations.filter((row) => row.gaps.length);
  return {
    ok: true,
    parent_action_key: parentActionKey,
    authority: "platform_tool_dispatch_bindings",
    binding_count: relations.length,
    gap_count: gaps.length,
    healthy_count: relations.length - gaps.length,
    status: gaps.length ? "degraded" : "pass",
    relations,
    gaps,
    secrets_included: false,
  };
}

function resolveCallerType(req) {
  if (req.auth?.mode === "backend_api_key" || req.auth?.is_admin === true) return "admin";
  return "tenant";
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeResponseOptions(value = {}) {
  const options = value && typeof value === "object" ? value : {};
  return {
    maxChars: resolveAdaptiveToolResponseMaxChars(options),
    cursor: clampNumber(options.cursor ?? options.response_cursor, 0, 0, Number.MAX_SAFE_INTEGER),
    chunkTtlMs: Number(options.chunk_ttl_ms ?? options.response_chunk_ttl_ms ?? 0) || null,
    chunkTtlMinutes: Number(options.chunk_ttl_minutes ?? options.response_chunk_ttl_minutes ?? 0) || null,
  };
}


export function resolveAdaptiveToolResponseMaxChars(value = {}) {
  const options = value && typeof value === "object" ? value : {};
  const clientBudget = clampNumber(
    options.client_response_budget_chars ?? options.response_budget_chars ?? options.max_response_envelope_chars,
    DEFAULT_TOOL_RESPONSE_CLIENT_BUDGET_CHARS,
    MIN_TOOL_RESPONSE_MAX_CHARS * 2,
    MAX_TOOL_RESPONSE_MAX_CHARS,
  );
  const envelopeOverhead = clampNumber(
    options.response_envelope_overhead_chars ?? options.envelope_overhead_chars,
    DEFAULT_TOOL_RESPONSE_ENVELOPE_OVERHEAD_CHARS,
    2000,
    Math.max(2000, clientBudget - MIN_TOOL_RESPONSE_MAX_CHARS),
  );
  const adaptiveMax = Math.max(MIN_TOOL_RESPONSE_MAX_CHARS, Math.min(MAX_TOOL_RESPONSE_MAX_CHARS, clientBudget - envelopeOverhead));
  return clampNumber(options.max_chars ?? options.max_response_chars, Math.min(DEFAULT_TOOL_RESPONSE_MAX_CHARS, adaptiveMax), MIN_TOOL_RESPONSE_MAX_CHARS, adaptiveMax);
}
export function resolveToolResponseChunkTtlMs(options = {}, serializedLength = 0) {
  const normalized = normalizeResponseOptions(options?.response_options || options?._response || options || {});
  const requestedMs = normalized.chunkTtlMs || (normalized.chunkTtlMinutes ? normalized.chunkTtlMinutes * 60 * 1000 : 0);
  const estimatedPageCount = Math.max(1, Math.ceil(Number(serializedLength || 0) / Math.max(1, normalized.maxChars || DEFAULT_TOOL_RESPONSE_MAX_CHARS)));
  const dynamicMs = DEFAULT_TOOL_RESPONSE_CHUNK_TTL_MS + Math.min(estimatedPageCount - 1, 60) * 60 * 1000;
  return clampNumber(requestedMs || dynamicMs, Math.max(DEFAULT_TOOL_RESPONSE_CHUNK_TTL_MS, dynamicMs), MIN_TOOL_RESPONSE_CHUNK_TTL_MS, MAX_TOOL_RESPONSE_CHUNK_TTL_MS);
}

function toolResponseChunkNow(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : (deps.now ?? Date.now());
  return value instanceof Date ? value.getTime() : Number(value);
}

function cleanupToolResponseChunkCache(now = Date.now()) {
  for (const [chunkId, entry] of TOOL_RESPONSE_CHUNK_CACHE.entries()) {
    if (!entry?.expiresAt || entry.expiresAt <= now) TOOL_RESPONSE_CHUNK_CACHE.delete(chunkId);
  }
}

function buildToolResponseChunk({ serialized, chunkId, cursor, maxChars, source = "tool_response_cache" }) {
  const safeCursor = Math.min(Math.max(0, Number(cursor) || 0), serialized.length);
  const end = Math.min(safeCursor + maxChars, serialized.length);
  const cacheEntry = TOOL_RESPONSE_CHUNK_CACHE.get(chunkId) || null;
  return {
    ok: true,
    response_chunked: true,
    chunk_id: chunkId,
    source,
    continuation_required: end < serialized.length,
    continuation: {
      policy: CHUNKED_TOOL_RESPONSE_CONTINUATION_CONTRACT.policy,
      required_tool: CHUNKED_TOOL_RESPONSE_CONTINUATION_CONTRACT.required_tool,
      required_before_fallback: end < serialized.length,
      next_call: end < serialized.length ? {
        name: "response_chunk_read",
        tool_args: { chunk_id: chunkId, cursor: end, max_chars: maxChars },
      } : null,
      fallback_allowed_only_after: CHUNKED_TOOL_RESPONSE_CONTINUATION_CONTRACT.fallback_allowed_only_after,
      secrets_included: false,
    },
    page: {
      cursor: safeCursor,
      next_cursor: end < serialized.length ? end : null,
      has_more: end < serialized.length,
      max_chars: maxChars,
      returned_chars: end - safeCursor,
      total_chars: serialized.length,
    },
    cache: cacheEntry ? {
      ttl_ms: cacheEntry.ttlMs || null,
      expires_at: cacheEntry.expiresAt ? new Date(cacheEntry.expiresAt).toISOString() : null,
      extended_on_read: true,
      read_count: cacheEntry.readCount || 0,
      durable: cacheEntry.durable === true,
      cursor_policy: cacheEntry.cursorPolicy || GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY,
      response_sha256: cacheEntry.responseSha256 || null,
      secrets_included: false,
    } : null,
    chunk: serialized.slice(safeCursor, end),
  };
}

async function storeToolResponseForChunks(body, optionsSource = {}, deps = {}) {
  const now = toolResponseChunkNow(deps);
  cleanupToolResponseChunkCache(now);
  const serialized = JSON.stringify(body ?? {});
  const ttlMs = resolveToolResponseChunkTtlMs(optionsSource, serialized.length);
  const chunkId = crypto.randomUUID();
  const durable = await persistGovernedToolResponseChunk({
    chunk_id: chunkId,
    serialized,
    ttl_ms: ttlMs,
    source_tool_key: optionsSource?.source_tool_key || optionsSource?.tool_key || optionsSource?.name || null,
    cursor_policy: GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY,
    secrets_included: false,
  }, deps);
  TOOL_RESPONSE_CHUNK_CACHE.set(chunkId, {
    serialized,
    createdAt: now,
    lastReadAt: now,
    ttlMs,
    expiresAt: new Date(durable.expires_at).getTime(),
    readCount: 0,
    durable: true,
    cursorPolicy: durable.cursor_policy,
    responseSha256: durable.response_sha256,
  });
  return { chunkId, serialized, ttlMs, expiresAt: new Date(durable.expires_at).getTime() };
}

export function isGovernedToolResponseChunkEnvelope(body = {}) {
  return Boolean(
    body
    && typeof body === "object"
    && body.response_chunked === true
    && typeof body.chunk_id === "string"
    && body.chunk_id.length > 0
    && typeof body.chunk === "string"
    && body.page
    && typeof body.page === "object"
    && body.continuation
    && typeof body.continuation === "object"
  );
}

export function shouldChunkDispatchedToolResponse(toolKey = "", body = null) {
  return String(toolKey || "").trim() !== "response_chunk_read" && !isGovernedToolResponseChunkEnvelope(body);
}

export async function maybeChunkToolResponseBody(body, optionsSource = {}, deps = {}) {
  if (isGovernedToolResponseChunkEnvelope(body)) return body;
  const options = normalizeResponseOptions(
    optionsSource?.response_options || optionsSource?._response || optionsSource || {}
  );
  const serialized = JSON.stringify(body ?? {});
  if (serialized.length <= options.maxChars) return body;
  const { chunkId } = await storeToolResponseForChunks(body, optionsSource, deps);
  return buildToolResponseChunk({
    serialized,
    chunkId,
    cursor: 0,
    maxChars: options.maxChars,
    source: "tool_response_auto_chunk",
  });
}

export function evictToolResponseChunkMemoryCache(chunkId = "") {
  return TOOL_RESPONSE_CHUNK_CACHE.delete(String(chunkId || "").trim());
}

export async function readCachedToolResponseChunk(args = {}, deps = {}) {
  const chunkId = String(args.chunk_id || "").trim();
  if (!chunkId) {
    const err = new Error("chunk_id is required.");
    err.status = 400;
    err.code = "missing_chunk_id";
    throw err;
  }
  const now = toolResponseChunkNow(deps);
  cleanupToolResponseChunkCache(now);
  let entry = TOOL_RESPONSE_CHUNK_CACHE.get(chunkId);
  let source = "tool_response_cache";
  if (!entry) {
    const durable = await loadGovernedToolResponseChunk({ chunk_id: chunkId }, deps);
    if (!durable) {
      const err = new Error("response chunk was not found or has expired.");
      err.status = 404;
      err.code = "response_chunk_not_found";
      throw err;
    }
    entry = {
      serialized: durable.serialized,
      createdAt: durable.created_at ? new Date(durable.created_at).getTime() : now,
      lastReadAt: now,
      ttlMs: Math.max(1, new Date(durable.expires_at).getTime() - now),
      expiresAt: new Date(durable.expires_at).getTime(),
      readCount: 0,
      durable: true,
      cursorPolicy: durable.cursor_policy,
      responseSha256: durable.response_sha256,
    };
    source = "governed_tool_response_chunk_store";
  }
  const options = normalizeResponseOptions(args);
  const ttlMs = resolveToolResponseChunkTtlMs(args, entry.serialized.length);
  entry.ttlMs = Math.max(Number(entry.ttlMs || 0), ttlMs);
  entry.lastReadAt = now;
  entry.readCount = Number(entry.readCount || 0) + 1;
  entry.expiresAt = now + entry.ttlMs;
  await extendGovernedToolResponseChunkExpiry({ chunk_id: chunkId, ttl_ms: entry.ttlMs }, deps);
  TOOL_RESPONSE_CHUNK_CACHE.set(chunkId, entry);
  return buildToolResponseChunk({
    serialized: entry.serialized,
    chunkId,
    cursor: options.cursor,
    maxChars: options.maxChars,
    source,
  });
}

export function paginateItems(items = [], query = {}) {
  const cursor = clampNumber(query.cursor ?? query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = clampNumber(query.limit, DEFAULT_TOOL_LIST_LIMIT, 1, MAX_TOOL_LIST_LIMIT);
  const q = String(query.q || query.query || "").trim().toLowerCase();
  const tag = String(query.tag || "").trim().toLowerCase();
  const filtered = items.filter((item) => {
    const queryTokens = q.split(/\s+/).filter(Boolean);
    const searchableValues = [
      item.name,
      item.displayName,
      item.description,
      item.path,
      ...(Array.isArray(item.tags) ? item.tags : []),
    ].map((value) => String(value || "").toLowerCase());
    const matchesText = queryTokens.length === 0
      || queryTokens.some((token) => searchableValues.some((value) => value.includes(token)));
    const itemTags = Array.isArray(item.tags) ? item.tags.map((t) => String(t || "").toLowerCase()) : [];
    const matchesTag = !tag || itemTags.includes(tag);
    return matchesText && matchesTag;
  });
  const pageItems = filtered.slice(cursor, cursor + limit);
  return {
    items: pageItems,
    page: {
      cursor,
      limit,
      next_cursor: cursor + pageItems.length < filtered.length ? cursor + pageItems.length : null,
      has_more: cursor + pageItems.length < filtered.length,
      total_count: filtered.length,
      returned_count: pageItems.length,
    },
  };
}

export function resolveCallerTypeForRequest(req) {
  return resolveCallerType(req);
}

export async function fetchToolsForCaller(callerType) {
  return fetchTools(callerType);
}

export async function dispatchToolForCaller(callerType, toolKey, args, req) {
  return dispatchTool(callerType, toolKey, args, req);
}

async function fetchTools(callerType) {
  const table = TOOLS_TABLE[callerType] || TOOLS_TABLE.tenant;
  const rows = await cachedSqlRead(
    sqlCacheKey("tools", callerType, "list", "v3"),
    toolCacheTtl(),
    async () => {
      const [toolRows] = await getPool().query(
        `SELECT tool_key, display_name, description, http_method, http_path,
                path_param_keys, input_schema, tags
         FROM \`${table}\`
         WHERE is_enabled = 1
         ORDER BY sort_order ASC, tool_key ASC`
      );
      return toolRows;
    }
  );
  const [blockedTenantManifests, blockedTenantSchemas] = callerType === "tenant"
    ? await Promise.all([
        loadTenantToolManifestBlocks(getPool()),
        loadTenantToolSchemaBlocks(getPool()),
      ])
    : [new Map(), new Map()];
  const visibleRows = callerType === "tenant"
    ? filterTenantToolsByStrictSchema(
        filterTenantToolsByManifest(
          rows.filter((r) => !isTenantBlockedToolPath(r.http_path) && !isTenantBlockedToolName(r.tool_key)),
          blockedTenantManifests
        ),
        blockedTenantSchemas
      )
    : rows;
  const dbTools = visibleRows.map((r) => ({
    name: r.tool_key,
    displayName: r.display_name,
    description: r.description,
    method: r.http_method,
    path: r.http_path,
    tags: normalizeRegistryTags(r.tags),
    inputSchema: parseJson(r.input_schema),
  }));
  return callerType === "admin" ? [...VIRTUAL_ADMIN_TOOLS, ...dbTools] : dbTools;
}

async function resolveToolPreflightDescriptor(callerType, toolKey) {
  const normalizedToolKey = String(toolKey || "").trim();
  if (!normalizedToolKey) return null;
  if (callerType === "admin") {
    const virtualTool = VIRTUAL_ADMIN_TOOLS.find((tool) => tool.name === normalizedToolKey);
    if (virtualTool) {
      return {
        method: virtualTool.method || "VIRTUAL",
        tags: Array.isArray(virtualTool.tags) ? virtualTool.tags : [],
        source: "virtual_admin_tool_catalog",
      };
    }
  }

  const candidateTables = callerType === "tenant"
    ? [TOOLS_TABLE.tenant, TOOLS_TABLE.admin]
    : [TOOLS_TABLE.admin];
  for (const table of candidateTables) {
    const [rows] = await getPool().query(
      `SELECT http_method, tags FROM \`${table}\` WHERE tool_key = ? AND is_enabled = 1 LIMIT 1`,
      [normalizedToolKey]
    );
    if (!rows?.[0]) continue;
    return {
      method: rows[0].http_method || "",
      tags: normalizeRegistryTags(rows[0].tags),
      source: table,
    };
  }
  return null;
}
async function detectMissingRequiredArgs(callerType, toolKey, args) {
  // Virtual admin tools enforce their own schemas inside dispatchToolImpl;
  // skip up-front validation for them.
  if (callerType === "admin" && VIRTUAL_ADMIN_TOOLS.some((t) => t.name === toolKey)) {
    return null;
  }
  const table = TOOLS_TABLE[callerType] || TOOLS_TABLE.tenant;
  try {
    const [rows] = await getPool().query(
      `SELECT input_schema FROM \`${table}\` WHERE tool_key = ? AND is_enabled = 1 LIMIT 1`,
      [toolKey]
    );
    const schema = parseJson(rows?.[0]?.input_schema);
    const required = Array.isArray(schema?.required) ? schema.required : [];
    if (!required.length) return null;
    const provided = args && typeof args === "object" ? args : {};
    const missing = required.filter((key) => {
      const value = provided[key];
      return value === undefined || value === null || value === "";
    });
    if (!missing.length) return null;
    return { tool: toolKey, required, missing };
  } catch {
    // If the lookup fails, fall through to the dispatcher — it will surface
    // a tool_not_found or downstream error instead of a hidden 500 here.
    return null;
  }
}

async function dispatchTool(callerType, toolKey, args, req) {
  if (callerType === "tenant") {
    const [blockedTenantManifests, blockedTenantSchemas] = await Promise.all([
      loadTenantToolManifestBlocks(getPool()),
      loadTenantToolSchemaBlocks(getPool()),
    ]);
    assertTenantToolManifestAllows(callerType, toolKey, blockedTenantManifests);
    assertTenantToolSchemaAllows(callerType, toolKey, blockedTenantSchemas);
  }
  const descriptor = await resolveToolPreflightDescriptor(callerType, toolKey);
  if (descriptor) {
    assertPreflightAllowed(await evaluateGptToolDispatchPreflight({
      callerType,
      toolKey,
      args,
      method: descriptor.method,
      tags: descriptor.tags,
      principal: {
        is_admin: callerType === "admin",
        tenant_id: req?.auth?.tenant_id || req?.user?.tenant_id || null,
        user_id: req?.auth?.user_id || req?.user?.user_id || null,
      },
    }));
  }
  const result = await dispatchToolImpl(callerType, toolKey, args, req);
  const responseOptions = args && typeof args === "object" ? args : {};
  const resultForClient = {
    ...result,
    body: shouldChunkDispatchedToolResponse(toolKey)
      ? await maybeChunkToolResponseBody(result?.body, {
          ...responseOptions,
          source_tool_key: toolKey,
        })
      : result?.body,
  };
  // Best-effort: archive the dispatch as a tool turn only after the exchange has
  // user/assistant capture. Missing capture is surfaced as a pre-final gate so
  // the GPT can call gpt_session_turns_write_batch before the final response.
  const archiveResult = await recordToolDispatchTurn(req, toolKey, args, resultForClient);
  attachSessionArchiveCaptureGate(resultForClient, archiveResult);
  return resultForClient;
}

export function buildInternalToolDispatchHeaders(req, env = process.env, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-Forwarded-For": req?.ip || "",
  };

  const forceBackend = options?.force_backend === true;
  if ((forceBackend || req?.auth?.mode === "backend_api_key" || req?.auth?.is_admin === true) && env.BACKEND_API_KEY) {
    headers.Authorization = `Bearer ${env.BACKEND_API_KEY}`;
    return headers;
  }

  headers.Authorization = req?.headers?.authorization || "";
  return headers;
}

async function dispatchToolImpl(callerType, toolKey, args, req) {
  if (callerType === "admin" && toolKey === "repo_inspect") {
    return { status: 200, body: { ok: true, name: toolKey, result: await inspectRepoReadOnly(args) } };
  }

  if (callerType === "admin" && toolKey === "platform_capability_contract_report") {
    return { status: 200, body: { ok: true, name: toolKey, result: await buildPlatformCapabilityContractReport(args) } };
  }

  if (callerType === "admin" && toolKey === "platform_capability_live_report") {
    return { status: 200, body: { ok: true, name: toolKey, result: await buildPlatformCapabilityLiveReport(args) } };
  }

  if (callerType === "admin" && toolKey === "platform_capability_governance_compile_preview") {
    return { status: 200, body: { ok: true, name: toolKey, result: await buildDynamicCapabilityGovernancePreview(args) } };
  }
  if (callerType === "admin" && toolKey === "platform_capability_projection_preview") {
    return { status: 200, body: { ok: true, name: toolKey, result: await buildDynamicCapabilityProjectionPreview(args) } };
  }
  if (callerType === "admin" && toolKey === "platform_capability_enforcement_shadow_preview") {
    return { status: 200, body: { ok: true, name: toolKey, result: await buildDynamicCapabilityEnforcementShadow(args) } };
  }
  if (callerType === "admin" && toolKey === "platform_capability_certification_readback_preview") {
    return { status: 200, body: { ok: true, name: toolKey, result: await buildDynamicCapabilityCertificationReadbackPreview(args) } };
  }
  if (callerType === "admin" && toolKey === "tenant_connection_operation_preview") {
    return { status: 200, body: { ok: true, name: toolKey, result: await buildTenantConnectionOperationPreview(args) } };
  }
  if (callerType === "admin" && toolKey === "platform_capability_governance_compile_persist") {
    const result = await persistDynamicCapabilityGovernanceCompilation({
      ...(args || {}),
      requested_by: req?.auth?.user_id || req?.auth?.email || "platform_admin",
    }, {
      auth: req?.auth || {},
    });
    return { status: 200, body: { ok: true, name: toolKey, result } };
  }
  if (callerType === "admin" && toolKey === "platform_capability_shadow_certification_issue") {
    const result = await issuePlatformCapabilityShadowCertification(args || {}, {
      auth: req?.auth || {},
    });
    return { status: 200, body: { ok: true, name: toolKey, result } };
  }
  if (callerType === "admin" && toolKey === "github_file_patch_shadow_certification_issue") {
    const result = await issueGithubFilePatchShadowCertification(args || {}, {
      auth: req?.auth || {},
    });
    return { status: 200, body: { ok: true, name: toolKey, result } };
  }
  if (callerType === "admin" && toolKey === "tenant_connection_shadow_contract_bootstrap") {
    const result = await bootstrapTenantConnectionShadowContracts(args || {}, {
      auth: req?.auth || {},
    });
    return { status: 200, body: { ok: true, name: toolKey, result } };
  }
  if (callerType === "admin" && toolKey === "activation_gateway_rollout_plan") {
    try {
      const result = await buildActivationGatewayRolloutPlan(args || {}, {
        pool: getPool(),
        auth: req?.auth || {},
        env: process.env,
      });
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "activation_gateway_rollout_plan_failed", message: err?.message || "Activation Gateway rollout plan failed.", details: err?.details } },
      };
    }
  }

  if (callerType === "admin" && toolKey === "activation_gateway_dark_deploy") {
    try {
      const result = await runActivationGatewayDarkDeploy(args || {}, {
        pool: getPool(),
        auth: req?.auth || {},
        env: process.env,
        audit: async (entry = {}) => writeAuditLog({
          tenant_id: req?.auth?.tenant_id || null,
          workspace_id: args?.workspace_id || null,
          actor_id: req?.auth?.user_id || null,
          actor_type: req?.auth?.mode || "backend_api_key",
          user_id: req?.auth?.user_id || null,
          request_id: req?.requestId || req?.headers?.["x-request-id"] || null,
          action: entry.action || "activation_gateway.dark_deploy",
          resource_type: entry.resource_type || "cloudflare_worker",
          resource_id: entry.resource_id || "mad4b-activation-gateway",
          after_json: entry.payload || { secrets_included: false },
          ip_address: req?.ip || null,
          user_agent: req?.headers?.["user-agent"] || null,
          metadata: { source_tool_key: toolKey, secrets_included: false },
          outcome: String(entry.action || "").endsWith("_failed") ? "failed" : "succeeded",
        }),
      });
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "activation_gateway_dark_deploy_failed", message: err?.message || "Activation Gateway dark deploy failed.", details: err?.details } },
      };
    }
  }

  if (callerType === "admin" && toolKey === "response_chunk_read") {
    return { status: 200, body: await readCachedToolResponseChunk(args) };
  }

  if (callerType === "admin" && toolKey === "response_chunk_durable_recovery_smoke") {
    const body = await runGovernedResponseChunkDurableRecoverySmoke(args, {
      pool: getPool(),
      maybeChunkToolResponseBody,
      evictToolResponseChunkMemoryCache,
      readCachedToolResponseChunk,
    });
    return { status: 200, body };
  }

  if (callerType === "admin" && toolKey === "admin_tool_catalog_search") {
    const tools = await fetchTools("admin");
    const { items, page } = paginateItems(tools, args || {});
    return {
      status: 200,
      body: {
        ok: true,
        name: toolKey,
        result: { items, page, total_catalog_count: tools.length, secrets_included: false },
      },
    };
  }

  if (callerType === "admin" && toolKey === "governed_migration_apply_policy_bootstrap") {
    try {
      const result = await bootstrapGovernedMigrationApplyPolicy(args || {}, {
        pool: getPool(),
        auth: req?.auth || {},
      });
      return {
        status: result.policy_created ? 201 : 200,
        body: { ok: true, name: toolKey, result },
      };
    } catch (err) {
      return {
        status: Number(err?.status || 400),
        body: {
          ok: false,
          error: {
            code: err?.code || "governed_migration_apply_policy_bootstrap_failed",
            message: err?.message || "Governed migration apply policy bootstrap failed.",
            details: err?.details,
          },
        },
      };
    }
  }
  if (callerType === "admin" && toolKey === "admin_control_db_mutation_serialization_smoke") {
      try {
        const [result, fields] = await getPool().query("UPDATE execution_policies SET updated_at = updated_at WHERE 1 = 0");
        const serialized = serializeDbControlQueryResult(result, fields);
        return {
          status: 200,
          body: {
            ok: true,
            smoke_key: "admin_control_db_mutation_serialization_smoke",
            sql_kind: "fixed_noop_update",
            statement_count: 1,
            ...serialized,
            readback_assertions: {
              mutation_serialized: serialized.statement_result_type === "mutation",
              affected_rows_present: Number.isFinite(serialized.result?.affectedRows),
              changed_rows_present: Number.isFinite(serialized.result?.changedRows),
              secrets_included_false: serialized.secrets_included === false,
            },
            secrets_included: false,
          },
        };
      } catch (err) {
        return { status: err?.status || 500, body: { ok: false, error: { code: err?.code || "admin_control_db_mutation_serialization_smoke_failed", message: err?.message }, secrets_included: false } };
      }
    }

    if (callerType === "admin" && toolKey === "capability_resolution_envelope_batch_expire") {
      try {
        const result = await runCapabilityEnvelopeBatchExpire({
          pool: getPool(),
          mode: String(args?.mode || "dry_run").trim(),
          requestedBy: String(args?.requested_by || "gpt_admin").trim(),
          expiredBefore: args?.expired_before || null,
          maxItems: args?.max_items ?? 50,
          expectedPlanSha256: String(args?.expected_plan_sha256 || "").trim(),
          confirm: String(args?.confirm || "").trim(),
          capabilityEnvelopeId: String(args?.capability_envelope_id || "").trim(),
          reason: String(args?.reason || "").trim(),
        });
        return { status: 200, body: result };
      } catch (err) {
        return {
          status: Number(err?.status) || 500,
          body: {
            ok: false,
            error: {
              code: err?.code || "capability_envelope_batch_expire_failed",
              message: err?.message || "Capability envelope batch expiration failed.",
              details: err?.details || undefined,
            },
            execution_allowed: false,
            provider_write: false,
            external_write: false,
            secrets_included: false,
          },
        };
      }
    }

    if (callerType === "admin" && toolKey === "capability_resolution_envelope_lifecycle") {
      try {
        const result = await transitionCapabilityEnvelopeLifecycle({
          pool: getPool(),
          envelopeId: String(args?.envelope_id || "").trim(),
          action: String(args?.action || "").trim(),
          executionRef: String(args?.execution_ref || "").trim(),
          reason: String(args?.reason || "").trim(),
        });
        return { status: 200, body: result };
      } catch (err) {
        return { status: err?.status || 400, body: { ok: false, error: { code: err?.code || "capability_resolution_envelope_lifecycle_failed", message: err?.message }, secrets_included: false } };
      }
    }

    if (callerType === "admin" && toolKey === "capability_resolution_envelope_apply_authorize") {
    try {
      const result = await authorizeCapabilityResolutionEnvelopeApply({
        envelopeId: String(args?.envelope_id || "").trim(),
        authorizedBy: String(args?.authorized_by || req?.auth?.user_id || "platform_admin").trim(),
        decisionNote: String(args?.decision_note || "").trim(),
        ttlMinutes: Number(args?.ttl_minutes || 60),
      });
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: Number(err?.status || 400),
        body: {
          ok: false,
          error: {
            code: err?.code || "capability_envelope_apply_authorization_failed",
            message: err?.message || "Capability envelope apply authorization failed.",
            details: err?.details,
          },
        },
      };
    }
  }
  if (callerType === "admin" && toolKey === "governed_migration_authorization_bootstrap") {
    try {
      const result = await bootstrapGovernedMigrationAuthorization(args || {}, {
        pool: getPool(),
        auth: req?.auth || {},
      });
      return {
        status: result.authorization_created ? 201 : 200,
        body: { ok: true, name: toolKey, result },
      };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: {
          ok: false,
          error: {
            code: err?.code || "governed_migration_authorization_bootstrap_failed",
            message: err?.message || "Governed migration authorization bootstrap failed.",
            details: err?.details,
          },
        },
      };
    }
  }
  if (callerType === "admin" && toolKey === "sql_cache_runtime_diagnostics_get") {
    try {
      const result = buildSqlCacheOperationalDiagnostics(undefined, args || {});
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: Number(err?.status || 500),
        body: {
          ok: false,
          error: {
            code: err?.code || "sql_cache_runtime_diagnostics_failed",
            message: err?.message || "SQL cache runtime diagnostics failed.",
            details: err?.details,
          },
        },
      };
    }
  }
  if (callerType === "admin" && toolKey === "sql_cache_controlled_load_test") {
    try {
      const result = await runSqlCacheControlledLoadTest(args || {});
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: Number(err?.status || 500),
        body: {
          ok: false,
          error: {
            code: err?.code || "sql_cache_controlled_load_test_failed",
            message: err?.message || "SQL cache controlled load test failed.",
            details: err?.details,
          },
        },
      };
    }
  }
  if (callerType === "admin" && toolKey === "governed_migration_schema_readback") {
    try {
      const result = await runGovernedMigrationSchemaReadback(args || {}, { pool: getPool() });
      return { status: result.ok ? 200 : 409, body: result };
    } catch (err) {
      return { status: err?.status || 500, body: { ok: false, error: { code: err?.code || "governed_migration_schema_readback_failed", message: err?.message || "Governed migration schema readback failed.", details: err?.details }, secrets_included: false } };
    }
  }
  if (callerType === "admin" && toolKey === "dynamic_container_projection_apply") {
    try {
      const result = await runDynamicContainerProjectionApply(args || {}, {
        pool: getPool(),
        resolveEnvelope: async ({ envelopeId }) => {
          const resolved = await resolveCapabilityExecutionEnvelope({
            pool: getPool(),
            envelopeId,
            source: args || {},
            acceptedAppKeys: ["platform_orchestration"],
            acceptedIntents: ["dynamic_container_projection_apply"],
            acceptedCapabilityKeys: ["dynamic_container_projection_apply"],
            allowReferenced: true,
            requireReadyForDispatch: true,
            requireDispatchAllowed: true,
            requireNoApprovalRequired: false,
            requireNoBlockingGaps: true,
            requireNoSecrets: true,
          });
          if (!resolved?.ok) {
            throw capabilityEnvelopeError(
              resolved,
              "Projection apply requires a valid ready capability resolution envelope."
            );
          }
          if (resolved.apply_allowed !== true) {
            throw capabilityEnvelopeError(
              {
                status: "dynamic_container_projection_apply_not_authorized",
                envelope_id: envelopeId,
                apply_allowed: false,
                secrets_included: false,
              },
              "Projection apply requires explicit dynamic apply authorization."
            );
          }
          return resolved;
        },
        markReferenced: async ({ envelopeId, executionRef }) => markCapabilityEnvelopeReferenced({
          pool: getPool(),
          envelopeId,
          executionRef,
        }),
        consumeEnvelope: async ({ envelopeId, executionRef, reason }) => transitionCapabilityEnvelopeLifecycle({
          pool: getPool(),
          envelopeId,
          action: "consume",
          executionRef,
          reason,
        }),
      });
      return { status: 200, body: result };
    } catch (err) {
      return {
        status: err?.status || 409,
        body: {
          ok: false,
          error: {
            code: err?.code || "dynamic_container_projection_apply_failed",
            message: err?.message || "Dynamic container projection apply failed.",
            details: err?.details,
          },
          secrets_included: false,
        },
      };
    }
  }
  if (callerType === "admin" && toolKey === "governed_migration_execute") {
    try {
      const result = await runGovernedMigrationExecution(args || {}, {
        authorizeApply: async (inspection) => {
          const resolved = await resolveCapabilityExecutionEnvelope({
            pool: getPool(),
            source: args || {},
            acceptedAppKeys: ["platform_orchestration"],
            acceptedIntents: ["governed_migration_execute", "governed_migration_apply", "migration_apply", "governed_migration_runner"],
            expectedTenantId: req?.auth?.tenant_id || PLATFORM_TENANT_ID,
            expectedUserId: req?.auth?.user_id || "",
            requireReadyForDispatch: true,
            requireDispatchAllowed: true,
            requireNoBlockingGaps: true,
            requireNoSecrets: true,
          });
          if (!resolved.ok) {
            throw capabilityEnvelopeError(resolved, "Governed migration apply requires a ready platform_orchestration capability envelope.");
          }
          await markCapabilityEnvelopeReferenced({
            pool: getPool(),
            envelopeId: resolved.envelope_id,
            executionRef: `governed_migration_execute:${inspection.migration}`,
          });
          return resolved;
        },
      });
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: {
          ok: false,
          error: {
            code: err?.code || "governed_migration_execution_failed",
            message: err?.message || "Governed migration execution failed.",
            details: err?.details,
          },
        },
      };
    }
  }
  if (callerType === "admin" && toolKey === "runtime_dispatch_certification_issue") {
    try {
      const resolved = await resolveCapabilityExecutionEnvelope({
        pool: getPool(),
        source: args || {},
        acceptedAppKeys: ["platform_orchestration", "platform_registry", "github"],
        acceptedIntents: ["runtime.dispatch.certification.issue", "runtime_dispatch_certification_issue", "runtime_certification_issue"],
        acceptedCapabilityKeys: ["runtime_dispatch_certification_issue"],
        expectedTenantId: req?.auth?.tenant_id || PLATFORM_TENANT_ID,
        expectedUserId: req?.auth?.user_id || "",
        requireReadyForDispatch: true,
        requireDispatchAllowed: true,
        requireNoApprovalRequired: false,
        requireNoBlockingGaps: true,
        requireNoSecrets: true,
      });
      if (!resolved.ok) {
        throw capabilityEnvelopeError(resolved, "Runtime dispatch certification issue requires a valid capability resolution envelope.");
      }
      const result = await issueRuntimeDispatchCertification(args || {}, {
        pool: getPool(),
        allowedToolKeys: VIRTUAL_ADMIN_TOOLS.map((tool) => tool.name),
      });
      await markCapabilityEnvelopeReferenced({
        pool: getPool(),
        envelopeId: resolved.envelope_id,
        executionRef: `runtime_dispatch_certification_issue:${result.certification_key}`,
      });
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: {
          ok: false,
          error: {
            code: err?.code || "runtime_dispatch_certification_issue_failed",
            message: err?.message || "Runtime dispatch certification issue failed.",
            details: err?.details,
          },
        },
      };
    }
  }

  if (callerType === "admin" && toolKey === "github_pr_ci_gate") {
    try {
      const result = await getGithubPullRequestCiGate(args || {});
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "github_pr_ci_gate_failed", message: err?.message || "GitHub PR CI gate failed.", details: err?.details } },
      };
    }
  }

  if (callerType === "admin" && toolKey === "github_pr_finalize") {
    try {
      await requireGithubPrFinalizeEnvelope({ args, ctx: { auth: req?.auth } });
      const result = await finalizeGithubPullRequest(args || {});
      return {
        status: result.ok ? 200 : 207,
        body: { ok: result.ok, name: toolKey, result },
      };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "github_pr_finalize_failed", message: err?.message || "GitHub PR finalization failed.", details: err?.details } },
      };
    }
  }

  if (callerType === "admin" && toolKey === "github_branch_cleanup_sweep") {
    try {
      const mode = String(args?.mode || "dry_run").trim().toLowerCase();
      if (mode === "apply") {
        await requireGithubBranchCleanupSweepEnvelope({ args, ctx: { auth: req?.auth } });
      }
      const result = await runGithubBranchCleanupSweep(args || {});
      return { status: result.ok ? 200 : 207, body: { ok: result.ok, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "github_branch_cleanup_sweep_failed", message: err?.message || "GitHub branch cleanup sweep failed.", details: err?.details } },
      };
    }
  }
  if (callerType === "admin" && toolKey === "github_branch_delete") {
    try {
      await requireGithubBranchDeleteEnvelope({ args, ctx: { auth: req?.auth } });
      const result = await deleteGithubBranchRef(args || {});
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "github_branch_delete_failed", message: err?.message || "GitHub branch deletion failed.", details: err?.details } },
      };
    }
  }

  if (callerType === "admin" && toolKey === "repo_patch_batch_apply") {
    try {
      const firstPath = Array.isArray(args?.changes) && args.changes[0]?.path ? args.changes[0].path : "batch";
      await requireRepoPatchCapabilityEnvelope({
        args,
        ctx: { auth: req?.auth },
        owner: args?.owner || "",
        repo: args?.repo || "",
        branch: args?.branch || "",
        defaultBranch: args?.default_branch || "main",
        filePath: firstPath,
        action: "repo_patch_batch_apply",
      });
      const result = await applyGithubRepositoryChangeSet(args || {});
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "repo_patch_batch_apply_failed", message: err?.message || "Repository batch patch failed.", details: err?.details } },
      };
    }
  }

  if (callerType === "admin" && toolKey === "repo_existing_blob_commit_apply") {
    try {
      const firstPath = Array.isArray(args?.changes) && args.changes[0]?.path ? args.changes[0].path : "existing-blob-change-set";
      await requireRepoPatchCapabilityEnvelope({
        args,
        ctx: { auth: req?.auth },
        owner: args?.owner || "",
        repo: args?.repo || "",
        branch: args?.branch || "",
        defaultBranch: args?.default_branch || "main",
        filePath: firstPath,
        action: "repo_existing_blob_commit_apply",
      });
      const result = await applyGithubExistingBlobChangeSet(args || {});
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "repo_existing_blob_commit_apply_failed", message: err?.message || "Repository existing-blob commit failed.", details: err?.details } },
      };
    }
  }

  if (callerType === "admin" && [
    "growth_intelligence_insight_decide",
    "growth_intelligence_action_decide",
    "growth_intelligence_readiness_refresh",
    "repository_advisory_comment_approval_hold_create",
    "repository_advisory_comment_approval_hold_approve",
  ].includes(toolKey)) {
    try {
      const handlers = {
        growth_intelligence_insight_decide: decideGrowthIntelligenceInsightAdmin,
        growth_intelligence_action_decide: decideGrowthIntelligenceActionAdmin,
        growth_intelligence_readiness_refresh: refreshGrowthIntelligenceReadinessAdmin,
        repository_advisory_comment_approval_hold_create: createRepositoryAdvisoryCommentApprovalHoldAdmin,
        repository_advisory_comment_approval_hold_approve: approveRepositoryAdvisoryCommentApprovalHoldAdmin,
      };
      const result = await handlers[toolKey](args || {});
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: {
          ok: false,
          error: {
            code: err?.code || "growth_intelligence_admin_decision_failed",
            message: err?.message || "Growth Intelligence admin decision failed.",
            ...(err?.details ? { details: err.details } : {}),
          },
          secrets_included: false,
        },
      };
    }
  }

  if (callerType === "admin" && toolKey === "growth_intelligence_pilot_run") {
    try {
      const result = await runGrowthIntelligencePilotAdmin(args || {});
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: {
          ok: false,
          error: {
            code: err?.code || "growth_intelligence_pilot_admin_failed",
            message: err?.message || "Growth Intelligence pilot failed.",
          },
          secrets_included: false,
        },
      };
    }
  }

  if (callerType === "admin" && toolKey === "platform_tool_binding_integrity_audit") {
    try {
      const result = await auditPlatformToolBindings(args || {});
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "platform_tool_binding_integrity_audit_failed", message: err?.message || "Platform tool binding integrity audit failed.", details: err?.details } },
      };
    }
  }
  if (callerType === "admin" && toolKey === "repository_reconciliation_orchestrator") {
    try {
      if (String(args?.mode || "dry_run") !== "dry_run") {
        const error = new Error("The Admin repository reconciliation orchestrator surface is dry-run only.");
        error.status = 403;
        error.code = "repository_reconciliation_admin_surface_dry_run_only";
        throw error;
      }
      const result = await runRepositoryReconciliationOrchestrator(
        { ...args, mode: "dry_run" },
        {
          reconcileBranch: (input) => runAdminBranchReconcile(
            { ...input, mode: "dry_run" },
            { auth: req?.auth }
          ),
        }
      );
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: {
          ok: false,
          error: {
            code: err?.code || "repository_reconciliation_orchestrator_failed",
            message: err?.message || "Repository reconciliation orchestrator dry-run failed.",
            details: err?.details || null,
          },
        },
      };
    }
  }
  if (callerType === "admin" && toolKey === "admin_branch_reconcile") {
    try {
      const result = await runAdminBranchReconcile(args, { auth: req?.auth });
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "admin_branch_reconcile_failed", message: err?.message || "Branch reconciliation failed.", details: err?.details } },
      };
    }
  }

  if (callerType === "admin" && toolKey === "github_superseded_branch_cleanup") {
    try {
      if (String(args?.mode || "dry_run").toLowerCase() === "apply") {
        await requireGithubSupersededBranchCleanupEnvelope({ args, ctx: { auth: req?.auth } });
      }
      const result = await runGithubSupersededBranchCleanup(args, { auth: req?.auth });
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "github_superseded_branch_cleanup_failed", message: err?.message || "GitHub superseded branch cleanup failed.", details: err?.details } },
      };
    }
  }

  if (callerType === "admin" && toolKey === "repository_close_superseded_positive_smoke") {
    try {
      await requireRepositoryCloseSupersededPositiveSmokeEnvelope({ args, ctx: { auth: req?.auth } });
      const result = await runRepositoryCloseSupersededPositiveSmokeV6(args, { auth: req?.auth });
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return { status: err?.status || 500, body: { ok: false, name: toolKey, error: { code: err?.code || "repository_close_superseded_positive_smoke_failed", message: err?.message || "Repository close-superseded positive smoke failed.", details: err?.details || null } } };
    }
  }
  if (callerType === "admin" && toolKey === "github_branch_fast_forward_smoke") {
    try {
      await requireGithubBranchFastForwardEnvelope({ args, ctx: { auth: req?.auth } });
      const result = await runGithubBranchFastForwardSmoke(args, { auth: req?.auth });
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "github_branch_fast_forward_smoke_failed", message: err?.message || "GitHub branch fast-forward smoke failed.", details: err?.details } },
      };
    }
  }

  if (callerType === "admin" && toolKey === "github_branch_fast_forward_to_base") {
    try {
      await requireGithubBranchFastForwardEnvelope({ args, ctx: { auth: req?.auth } });
      const result = await runGithubBranchFastForwardToBase(args, { auth: req?.auth });
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "github_branch_fast_forward_failed", message: err?.message || "GitHub branch fast-forward failed.", details: err?.details } },
      };
    }
  }

  if (callerType === "admin" && toolKey === "github_branch_merge_commit_create") {
    try {
      await requireGithubBranchMergeCommitEnvelope({ args, ctx: { auth: req?.auth } });
      const result = await runGithubBranchMergeCommitCreate(args, { auth: req?.auth });
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "github_branch_merge_commit_create_failed", message: err?.message || "GitHub branch merge-commit creation failed.", details: err?.details } },
      };
    }
  }
  if (callerType === "admin" && toolKey === "repo_patch_apply") {
    try {
      const result = await applyRepoPatch(args, { auth: req?.auth });
      return { status: 200, body: { ok: true, name: toolKey, result } };
    } catch (err) {
      return {
        status: err?.status || 500,
        body: { ok: false, error: { code: err?.code || "repo_patch_apply_failed", message: err?.message || "Patch apply failed.", details: err?.details } },
      };
    }
  }

  let effectiveCallerType = callerType;
  let grantContext = null;

  if (callerType === "tenant") {
    const [tenantRowExists] = await getPool().query(
      `SELECT 1 FROM \`${TOOLS_TABLE.tenant}\` WHERE tool_key = ? AND is_enabled = 1 LIMIT 1`,
      [toolKey]
    );
    if (!tenantRowExists.length) {
      const tenantId = req?.auth?.tenant_id || null;
      const userId = req?.auth?.user_id || null;
      const grant = tenantId && userId ? await findActiveGrantForTool(tenantId, userId, toolKey) : null;
      if (grant) {
        const check = validateArgsAgainstGrant(grant, args);
        if (!check.ok) {
          return {
            status: 403,
            body: {
              ok: false,
              error: {
                code: check.reason || "grant_arg_violation",
                message: check.message || `Grant ${grant.grant_id} does not authorise these args.`,
                details: check.details || null,
              },
              grant_id: grant.grant_id,
            },
          };
        }
        effectiveCallerType = "admin";
        grantContext = grant;
      }
    }
  }

  const table = TOOLS_TABLE[effectiveCallerType] || TOOLS_TABLE.tenant;
  const [rows] = await getPool().query(
    `SELECT http_method, http_path, path_param_keys, fixed_body
     FROM \`${table}\`
     WHERE tool_key = ? AND is_enabled = 1
     LIMIT 1`,
    [toolKey]
  );

  if (!rows[0]) {
    return { status: 404, body: { ok: false, error: { code: "tool_not_found", message: `Tool '${toolKey}' not found.` } } };
  }

  const { http_method: method, http_path: pathTemplate } = rows[0];
  if (callerType === "tenant" && (isTenantBlockedToolPath(pathTemplate) || isTenantBlockedToolName(toolKey))) {
    return {
      status: 403,
      body: {
        ok: false,
        error: {
          code: "tenant_tool_route_not_allowed",
          message: "Tenant GPT tools cannot dispatch admin-only or state-changing platform routes. Use tenant-safe local gateway/connect status tools instead.",
          details: { tool_key: toolKey, http_path: pathTemplate },
        },
      },
    };
  }
  const pathParamKeys = parseJson(rows[0].path_param_keys) || [];
  const fixedBody = parseJson(rows[0].fixed_body) || {};
  const remaining = { ...args };

  // Substitute path parameters
  let path = pathTemplate;
  for (const key of pathParamKeys) {
    const val = args[key];
    if (val === undefined || val === null) {
      return { status: 400, body: { ok: false, error: { code: "missing_path_param", message: `Path parameter '${key}' is required for tool '${toolKey}'.` } } };
    }
    path = path.replace(`{${key}}`, encodeURIComponent(String(val)));
    delete remaining[key];
  }

  const internalBase = process.env.INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || 8080}`;
  const httpMethod = method.toUpperCase();
  let url = `${internalBase}${path}`;

  const fetchOpts = {
    method: httpMethod,
    headers: buildInternalToolDispatchHeaders(req, process.env, { force_backend: effectiveCallerType === "admin" }),
    signal: AbortSignal.timeout(300_000),
  };

  if (httpMethod === "GET" || httpMethod === "DELETE") {
    const qs = Object.keys(remaining).length
      ? "?" + new URLSearchParams(
          Object.fromEntries(
            Object.entries(remaining).filter(([, v]) => v !== undefined && v !== null)
          )
        ).toString()
      : "";
    url += qs;
  } else {
    // fixed_body provides defaults (e.g. sub-tool name); caller arguments take priority
    fetchOpts.body = JSON.stringify({ ...fixedBody, ...remaining });
  }

  const response = await fetch(url, fetchOpts);
  const body = await response.json().catch(() => ({}));

  if (grantContext) {
    await recordGrantUse(grantContext.grant_id);
    writeAuditLogAsync({
      tenant_id: grantContext.tenant_id,
      actor_id: req?.auth?.user_id || null,
      actor_type: req?.auth?.mode || "user_jwt",
      action: "admin_scope_grant_dispatch",
      resource_type: "admin_scope_grant",
      resource_id: grantContext.grant_id,
      after_json: {
        source_tool_key: toolKey,
        upstream_status: response.status,
        upstream_ok: body?.ok !== false,
      },
      ip_address: req?.ip || null,
      user_agent: req?.headers?.["user-agent"] || null,
    });
  }

  return { status: response.status, body, grant_id: grantContext?.grant_id };
}

function repoInspectRoot() {
  if (process.env.REPO_INSPECT_ROOT) return path.resolve(process.env.REPO_INSPECT_ROOT);
  const cwd = path.resolve(process.cwd());
  return path.basename(cwd) === "http-generic-api" ? path.dirname(cwd) : cwd;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function hasDeniedSegment(relativePath) {
  return relativePath.split(path.sep).some((segment) => REPO_INSPECT_DENY_SEGMENTS.has(segment.toLowerCase()));
}

function hasDeniedFileName(filePath) {
  const name = path.basename(filePath);
  return REPO_INSPECT_DENY_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

function resolveRepoInspectPath(inputPath = ".") {
  const root = repoInspectRoot();
  const resolved = path.resolve(root, String(inputPath || "."));
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    const err = new Error("path must stay inside the repository root.");
    err.status = 400;
    err.code = "repo_path_outside_root";
    throw err;
  }
  if (relative && hasDeniedSegment(relative)) {
    const err = new Error("path crosses a blocked repository segment.");
    err.status = 403;
    err.code = "repo_path_blocked";
    throw err;
  }
  if (hasDeniedFileName(resolved)) {
    const err = new Error("file name is blocked by repository inspection policy.");
    err.status = 403;
    err.code = "repo_file_blocked";
    throw err;
  }
  return { root, resolved, relative: relative || "." };
}

function isLikelyTextPath(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".env.example")) return true;
  return REPO_INSPECT_TEXT_EXTENSIONS.has(path.extname(lower));
}

async function listRepoEntries(dirPath, options) {
  const { root, resolved, relative } = resolveRepoInspectPath(dirPath);
  const recursive = options.recursive === true;
  const maxEntries = clampNumber(options.max_entries, 100, 1, 500);
  const entries = [];

  async function visit(current) {
    if (entries.length >= maxEntries) return;
    const children = await fs.readdir(current, { withFileTypes: true });
    for (const child of children) {
      const fullPath = path.join(current, child.name);
      const childRelative = path.relative(root, fullPath);
      if (hasDeniedSegment(childRelative) || hasDeniedFileName(fullPath)) continue;
      const stat = await fs.stat(fullPath);
      entries.push({
        path: childRelative.replaceAll(path.sep, "/"),
        type: child.isDirectory() ? "directory" : "file",
        size: child.isFile() ? stat.size : undefined,
      });
      if (entries.length >= maxEntries) break;
      if (recursive && child.isDirectory()) await visit(fullPath);
    }
  }

  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    const err = new Error("path must be a directory for action=list.");
    err.status = 400;
    err.code = "repo_list_requires_directory";
    throw err;
  }
  await visit(resolved);
  return { action: "list", root, path: relative.replaceAll(path.sep, "/"), count: entries.length, truncated: entries.length >= maxEntries, entries };
}

async function readRepoFile(filePath, options) {
  const { root, resolved, relative } = resolveRepoInspectPath(filePath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    const err = new Error("path must be a file for action=read.");
    err.status = 400;
    err.code = "repo_read_requires_file";
    throw err;
  }
  if (!isLikelyTextPath(resolved)) {
    const err = new Error("file extension is not allowlisted for text inspection.");
    err.status = 403;
    err.code = "repo_file_type_blocked";
    throw err;
  }
  const maxChars = clampNumber(options.max_chars, 12000, 1000, 50000);
  const content = await fs.readFile(resolved, "utf8");
  if (content.includes("\u0000")) {
    const err = new Error("binary-looking file content is blocked.");
    err.status = 403;
    err.code = "repo_binary_blocked";
    throw err;
  }
  return {
    action: "read",
    root,
    path: relative.replaceAll(path.sep, "/"),
    size: stat.size,
    truncated: content.length > maxChars,
    content: content.slice(0, maxChars),
  };
}

async function searchRepoFiles(options) {
  const query = String(options.query || "").trim();
  if (!query) {
    const err = new Error("query is required for action=search.");
    err.status = 400;
    err.code = "repo_search_missing_query";
    throw err;
  }
  const { root, resolved, relative } = resolveRepoInspectPath(options.path || ".");
  const maxEntries = clampNumber(options.max_entries, 100, 1, 500);
  const maxChars = clampNumber(options.max_chars, 12000, 1000, 50000);
  const matches = [];
  let scannedFiles = 0;

  async function visit(current) {
    if (matches.length >= maxEntries) return;
    const stat = await fs.stat(current);
    if (stat.isDirectory()) {
      const children = await fs.readdir(current, { withFileTypes: true });
      for (const child of children) {
        const fullPath = path.join(current, child.name);
        const childRelative = path.relative(root, fullPath);
        if (hasDeniedSegment(childRelative) || hasDeniedFileName(fullPath)) continue;
        await visit(fullPath);
        if (matches.length >= maxEntries) break;
      }
      return;
    }
    if (!stat.isFile() || !isLikelyTextPath(current) || stat.size > 1_000_000) return;
    scannedFiles += 1;
    const content = await fs.readFile(current, "utf8");
    const index = content.toLowerCase().indexOf(query.toLowerCase());
    if (index === -1) return;
    const lineNumber = content.slice(0, index).split(/\r?\n/).length;
    const snippetStart = Math.max(0, index - 160);
    const snippet = content.slice(snippetStart, index + Math.min(query.length + 320, maxChars)).replace(/\s+/g, " ").trim();
    matches.push({
      path: path.relative(root, current).replaceAll(path.sep, "/"),
      line: lineNumber,
      snippet,
    });
  }

  await visit(resolved);
  return {
    action: "search",
    root,
    path: relative.replaceAll(path.sep, "/"),
    query,
    scanned_files: scannedFiles,
    count: matches.length,
    truncated: matches.length >= maxEntries,
    matches,
  };
}

function assertSafeGitRef(ref, fallback = "HEAD") {
  const value = String(ref || fallback).trim() || fallback;
  if (value.includes("..") || !/^[A-Za-z0-9._/@:+~-]+$/.test(value)) {
    const err = new Error("git ref contains unsupported characters.");
    err.status = 400;
    err.code = "repo_git_bad_ref";
    throw err;
  }
  return value;
}

async function runGitReadOnly(gitArgs, options = {}) {
  const { root } = resolveRepoInspectPath(".");
  const maxChars = clampNumber(options.max_chars, 12000, 1000, 50000);
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", root, ...gitArgs], {
      timeout: 30_000,
      maxBuffer: Math.max(1024 * 1024, maxChars * 4),
    });
    return {
      stdout: String(stdout || "").slice(0, maxChars),
      stderr: String(stderr || "").slice(0, Math.min(maxChars, 4000)),
      truncated: String(stdout || "").length > maxChars,
    };
  } catch (err) {
    const wrapped = new Error(`git read-only command failed: ${err.message}`);
    wrapped.status = 502;
    wrapped.code = "repo_git_command_failed";
    wrapped.details = {
      exit_code: err.code,
      stderr: String(err.stderr || "").slice(0, 4000),
    };
    throw wrapped;
  }
}

async function gitStatusRepo(args = {}) {
  const [status, head, branch] = await Promise.all([
    runGitReadOnly(["status", "--short", "--branch"], args),
    runGitReadOnly(["rev-parse", "HEAD"], { ...args, max_chars: 2000 }),
    runGitReadOnly(["rev-parse", "--abbrev-ref", "HEAD"], { ...args, max_chars: 2000 }),
  ]);
  return {
    action: "git_status",
    root: repoInspectRoot(),
    head_sha: head.stdout.trim(),
    branch: branch.stdout.trim(),
    truncated: status.truncated,
    status: status.stdout,
  };
}

async function gitLogRepo(args = {}) {
  const limit = clampNumber(args.max_entries ?? args.limit, 20, 1, 100);
  const gitArgs = ["log", `-n${limit}`, "--date=iso-strict", "--pretty=format:%H%x1f%h%x1f%cI%x1f%an%x1f%s"];
  if (args.since) gitArgs.push(`--since=${String(args.since)}`);
  if (args.until) gitArgs.push(`--until=${String(args.until)}`);
  if (args.file) gitArgs.push("--", validatePatchPath(args.file));
  const result = await runGitReadOnly(gitArgs, args);
  const commits = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [sha, short_sha, committed_at, author, subject] = line.split("\x1f");
    return { sha, short_sha, committed_at, author, subject };
  });
  return {
    action: "git_log",
    root: repoInspectRoot(),
    count: commits.length,
    truncated: result.truncated,
    commits,
  };
}

async function gitShowRepo(args = {}) {
  const ref = assertSafeGitRef(args.ref || "HEAD", "HEAD");
  const result = await runGitReadOnly([
    "show",
    "--stat",
    "--patch",
    "--format=fuller",
    "--no-ext-diff",
    ref,
  ], args);
  return {
    action: "git_show",
    root: repoInspectRoot(),
    ref,
    truncated: result.truncated,
    output: result.stdout,
  };
}

function isMissingGitRevisionError(err) {
  const message = `${err?.message || ""}\n${err?.details?.stderr || ""}`.toLowerCase();
  return err?.code === "repo_git_command_failed"
    && (
      message.includes("unknown revision")
      || message.includes("ambiguous argument")
      || message.includes("bad revision")
      || message.includes("needed a single revision")
      || message.includes("not in the working tree")
    );
}

async function gitDiffNameStatusRepo(args = {}) {
  const baseRefWasExplicit = Boolean(args.base_ref);
  const baseRef = assertSafeGitRef(args.base_ref || "HEAD~1", "HEAD~1");
  const headRef = assertSafeGitRef(args.head_ref || "HEAD", "HEAD");
  let result;
  let fallback_strategy = null;
  try {
    result = await runGitReadOnly(["diff", "--name-status", `${baseRef}...${headRef}`], args);
  } catch (err) {
    if (baseRefWasExplicit || !isMissingGitRevisionError(err)) throw err;
    fallback_strategy = "diff_tree_root_for_shallow_checkout";
    result = await runGitReadOnly(["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", headRef], args);
  }
  const files = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [status, ...rest] = line.split(/\s+/);
    return { status, path: rest.join(" ") };
  });
  return {
    action: "git_diff_name_status",
    root: repoInspectRoot(),
    base_ref: baseRef,
    head_ref: headRef,
    fallback_strategy,
    count: files.length,
    truncated: result.truncated,
    files,
  };
}

export async function inspectRepoReadOnly(args = {}) {
  const action = String(args.action || "list").trim().toLowerCase();
  if (action === "list") return listRepoEntries(args.path || ".", args);
  if (action === "read") return readRepoFile(args.path, args);
  if (action === "search") return searchRepoFiles(args);
  if (action === "git_status") return gitStatusRepo(args);
  if (action === "git_log") return gitLogRepo(args);
  if (action === "git_show") return gitShowRepo(args);
  if (action === "git_diff_name_status") return gitDiffNameStatusRepo(args);
  const err = new Error("action must be one of: list, read, search, git_status, git_log, git_show, git_diff_name_status.");
  err.status = 400;
  err.code = "repo_inspect_bad_action";
  throw err;
}

async function resolveRepoTarget() {
  const cfg = await resolveActivationBootstrapConfig({});
  if (!cfg?.ok) {
    const err = new Error("activation_bootstrap_config is unresolved — cannot determine github_owner/github_repo.");
    err.status = 500;
    err.code = "repo_patch_no_bootstrap";
    err.details = { db_error: cfg?.db_error, env_error: cfg?.env_error };
    throw err;
  }
  const owner = String(cfg.config?.github_owner || "").trim();
  const repo = String(cfg.config?.github_repo || "").trim();
  const defaultBranch = String(cfg.config?.github_branch || "main").trim() || "main";
  if (!owner || !repo) {
    const err = new Error("bootstrap config is missing github_owner or github_repo.");
    err.status = 500;
    err.code = "repo_patch_missing_owner_repo";
    throw err;
  }
  return { owner, repo, defaultBranch };
}

const REPO_PATCH_PROTECTED_BRANCHES = new Set(["main", "master", "production", "prod"]);

function isProtectedRepoBranch(branch, defaultBranch) {
  const normalized = String(branch || "").trim();
  return normalized === String(defaultBranch || "").trim() || REPO_PATCH_PROTECTED_BRANCHES.has(normalized);
}

function sanitizeBranchSlug(value) {
  return String(value || "patch")
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "patch";
}

function defaultRepoPatchBranch({ filePath, commitMessage }) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const fileHint = sanitizeBranchSlug(String(filePath || "file").split("/").pop()).slice(0, 24);
  const slug = sanitizeBranchSlug(commitMessage).slice(0, 48);
  return `gpt/repo-patch/${stamp}-${fileHint}-${slug}`;
}

function assertRepoPatchBranchPolicy({ branch, defaultBranch, args }) {
  if (!isProtectedRepoBranch(branch, defaultBranch)) return;
  const breakGlassAllowed =
    process.env.REPO_PATCH_ALLOW_PROTECTED_BRANCH === "true" &&
    args?.allow_protected_branch === true &&
    String(args?.break_glass_reason || "").trim().length >= 10;
  if (breakGlassAllowed) return;
  const err = new Error(`Direct writes to protected branch '${branch}' are blocked. Use a work branch and merge only after CI passes.`);
  err.status = 403;
  err.code = "repo_patch_protected_branch";
  err.details = {
    branch,
    default_branch: defaultBranch,
    required_flow: "commit_to_work_branch_then_merge_after_required_ci",
  };
  throw err;
}

function validatePatchPath(relativePath) {
  if (!relativePath || typeof relativePath !== "string") {
    const err = new Error("path is required.");
    err.status = 400;
    err.code = "repo_patch_missing_path";
    throw err;
  }
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.split("/").some((segment) => REPO_INSPECT_DENY_SEGMENTS.has(segment.toLowerCase()))) {
    const err = new Error("path crosses a blocked repository segment.");
    err.status = 403;
    err.code = "repo_path_blocked";
    throw err;
  }
  if (REPO_INSPECT_DENY_FILE_PATTERNS.some((pattern) => pattern.test(path.basename(normalized)))) {
    const err = new Error("file name is blocked by repository write policy.");
    err.status = 403;
    err.code = "repo_file_blocked";
    throw err;
  }
  if (normalized.includes("..")) {
    const err = new Error("path may not contain parent directory references.");
    err.status = 400;
    err.code = "repo_path_traversal";
    throw err;
  }
  return normalized;
}

function githubApiHeaders(token, method = "GET") {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mad4b-growth-os-repo-patch",
    ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
  };
}

function encodeGitRefBranch(branch) {
  return String(branch || "").split("/").map(encodeURIComponent).join("/");
}

async function githubJsonRequest({ method, owner, repo, apiPath, body, token, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${apiPath}`, {
    method,
    headers: githubApiHeaders(token, method),
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, payload };
}

async function ensureRepoPatchBranch({ owner, repo, branch, defaultBranch, token }) {
  if (branch === defaultBranch) return { created: false, branch };
  const existing = await githubJsonRequest({ method: "GET", owner, repo, apiPath: `/git/ref/heads/${encodeGitRefBranch(branch)}`, token });
  if (existing.ok) return { created: false, branch };
  if (existing.status !== 404) {
    const err = new Error("GitHub branch lookup failed.");
    err.status = 502;
    err.code = "repo_patch_branch_lookup_failed";
    err.details = { upstream_status: existing.status, message: existing.payload?.message };
    throw err;
  }
  const base = await githubJsonRequest({ method: "GET", owner, repo, apiPath: `/git/ref/heads/${encodeGitRefBranch(defaultBranch)}`, token });
  if (!base.ok || !base.payload?.object?.sha) {
    const err = new Error("GitHub default branch lookup failed.");
    err.status = 502;
    err.code = "repo_patch_default_branch_lookup_failed";
    err.details = { upstream_status: base.status, message: base.payload?.message };
    throw err;
  }
  const created = await githubJsonRequest({
    method: "POST",
    owner,
    repo,
    apiPath: "/git/refs",
    token,
    body: { ref: `refs/heads/${branch}`, sha: base.payload.object.sha },
  });
  if (created.status === 422 && String(created.payload?.message || "").toLowerCase().includes("reference already exists")) {
    return { created: false, branch, raced: true };
  }
  if (!created.ok) {
    const err = new Error("GitHub branch creation failed.");
    err.status = 502;
    err.code = "repo_patch_branch_create_failed";
    err.details = { upstream_status: created.status, message: created.payload?.message };
    throw err;
  }
  return { created: true, branch, base_sha: base.payload.object.sha };
}

async function githubContentsRequest({ method, owner, repo, filePath, branch, body, token, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}` +
    (method === "GET" && branch ? `?ref=${encodeURIComponent(branch)}` : "");
  const response = await fetchImpl(url, {
    method,
    headers: githubApiHeaders(token, method),
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, payload };
}

async function loadRepoPatchCurrentContent({ existing, owner, repo, token }) {
  if (existing.status !== 200) return "";
  if (existing.payload?.content) {
    return Buffer.from(existing.payload.content, existing.payload.encoding || "base64").toString("utf8");
  }
  const blobSha = existing.payload?.sha;
  if (!blobSha) return "";
  const blob = await githubJsonRequest({ method: "GET", owner, repo, apiPath: `/git/blobs/${encodeURIComponent(blobSha)}`, token });
  if (!blob.ok) {
    const err = new Error("GitHub blob GET failed for large repository file.");
    err.status = 502;
    err.code = "repo_patch_github_blob_get_failed";
    err.details = { upstream_status: blob.status, message: blob.payload?.message, secrets_included: false };
    throw err;
  }
  if (!blob.payload?.content) return "";
  return Buffer.from(String(blob.payload.content || "").replace(/\n/g, ""), blob.payload.encoding || "base64").toString("utf8");
}

async function loadRepoPatchBranchCompare({ owner, repo, defaultBranch, branch, token }) {
  try {
    const ref = await githubJsonRequest({ method: "GET", owner, repo, apiPath: `/git/ref/heads/${encodeGitRefBranch(branch)}`, token });
    if (ref.status === 404) return { branch_exists: false, compare: null };
    if (!ref.ok) return { branch_exists: null, compare: null, error_code: "repo_patch_branch_lookup_failed" };
    const compare = await githubJsonRequest({ method: "GET", owner, repo, apiPath: `/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branch)}`, token });
    return { branch_exists: true, compare: compare.ok ? compare.payload : null, compare_status: compare.status };
  } catch {
    return { branch_exists: null, compare: null, error_code: "repo_patch_compare_failed" };
  }
}

export async function applyRepoPatch(args = {}, ctx = {}) {
  const action = String(args.action || "").trim().toLowerCase();
  if (!["write_file", "replace_block", "apply_unified_diff", "delete_file", "dedupe_openapi_paths"].includes(action)) {
    const err = new Error("action must be one of: write_file, replace_block, apply_unified_diff, delete_file, dedupe_openapi_paths.");
    err.status = 400;
    err.code = "repo_patch_bad_action";
    throw err;
  }
  const filePath = validatePatchPath(args.path);
  const commitMessage = String(args.commit_message || "").trim();
  if (commitMessage.length < 5) {
    const err = new Error("commit_message is required and must be at least 5 characters.");
    err.status = 400;
    err.code = "repo_patch_missing_message";
    throw err;
  }

  const { owner, repo, defaultBranch } = await resolveRepoTarget();
  const requestedBranch = String(args.branch || "").trim();
  const branch = requestedBranch || defaultRepoPatchBranch({ filePath, commitMessage });
  assertRepoPatchBranchPolicy({ branch, defaultBranch, args });

  const envelope = await requireRepoPatchCapabilityEnvelope({ args, ctx, owner, repo, branch, defaultBranch, filePath, action });
  const token = await getGitHubAppInstallationToken({});
  const branchCompare = await loadRepoPatchBranchCompare({ owner, repo, defaultBranch, branch, token });
  assertPreflightAllowed(await evaluateRepoPatchApplyPreflight({
    args,
    repo: { owner, repo },
    branch,
    defaultBranch,
    branchExists: branchCompare.branch_exists === true,
    compare: branchCompare.compare,
  }));
  const branchState = await ensureRepoPatchBranch({ owner, repo, branch, defaultBranch, token });
  const existing = await githubContentsRequest({ method: "GET", owner, repo, filePath, branch, token });

  if (existing.status === 404 && action !== "write_file") {
    const err = new Error("target file does not exist in the repository; only write_file may create new files.");
    err.status = 404;
    err.code = "repo_patch_file_not_found";
    throw err;
  }
  if (existing.status !== 200 && existing.status !== 404) {
    const err = new Error("GitHub Contents GET failed.");
    err.status = 502;
    err.code = "repo_patch_github_get_failed";
    err.details = { upstream_status: existing.status, message: existing.payload?.message };
    throw err;
  }

  const currentSha = existing.status === 200 ? existing.payload?.sha : undefined;
  const currentContent = await loadRepoPatchCurrentContent({ existing, owner, repo, token });

  if (action === "delete_file") {
    if (!currentSha) {
      const err = new Error("target file does not exist in the repository.");
      err.status = 404;
      err.code = "repo_patch_file_not_found";
      throw err;
    }
    const deleteResult = await githubContentsRequest({
      method: "DELETE",
      owner,
      repo,
      filePath,
      branch,
      body: { message: commitMessage, sha: currentSha, branch },
      token,
    });
    if (!deleteResult.ok) {
      const err = new Error("GitHub Contents DELETE failed.");
      err.status = 502;
      err.code = "repo_patch_github_delete_failed";
      err.details = { upstream_status: deleteResult.status, message: deleteResult.payload?.message };
      throw err;
    }
    const commitSha = deleteResult.payload?.commit?.sha || null;
    const commitUrl = deleteResult.payload?.commit?.html_url || null;
    writeAuditLogAsync({
      action: "repo_patch_apply",
      resource_type: "repo",
      resource_id: `${owner}/${repo}:${filePath}`,
      payload: {
        branch,
        action_type: action,
        commit_message: commitMessage,
        commit_sha: commitSha,
        previous_sha: currentSha || null,
        principal: ctx?.auth?.user_id || ctx?.auth?.mode || "admin",
      },
    });
    return {
      action,
      path: filePath,
      branch,
      owner,
      repo,
      commit_sha: commitSha,
      commit_url: commitUrl,
      previous_sha: currentSha || null,
      deleted: true,
    };
  }

  let newContent;
  let transformSummary = null;
  if (action === "write_file") {
    if (typeof args.content !== "string") {
      const err = new Error("content is required for write_file.");
      err.status = 400;
      err.code = "repo_patch_missing_content";
      throw err;
    }
    newContent = args.content;
  } else if (action === "replace_block") {
    if (typeof args.old_string !== "string" || typeof args.new_string !== "string") {
      const err = new Error("old_string and new_string are required for replace_block.");
      err.status = 400;
      err.code = "repo_patch_missing_strings";
      throw err;
    }
    const occurrences = currentContent.split(args.old_string).length - 1;
    if (occurrences === 0) {
      const err = new Error("old_string was not found in the target file.");
      err.status = 409;
      err.code = "repo_patch_no_match";
      throw err;
    }
    if (occurrences > 1) {
      const err = new Error(`old_string matched ${occurrences} occurrences; replace_block requires exactly one.`);
      err.status = 409;
      err.code = "repo_patch_ambiguous_match";
      err.details = { occurrences };
      throw err;
    }
    newContent = currentContent.replace(args.old_string, args.new_string);
  } else if (action === "dedupe_openapi_paths") {
    const normalizedPatchPath = String(filePath || "").replaceAll("\\", "/").replace(/^\.\//, "");
    if (!LARGE_TEXT_REPO_PATCH_PATHS.has(normalizedPatchPath)) {
      const err = new Error("dedupe_openapi_paths is only allowed for the OpenAPI contract file.");
      err.status = 400;
      err.code = "repo_patch_openapi_dedupe_path_not_allowed";
      err.details = { path: filePath, secrets_included: false };
      throw err;
    }
    const transformed = dedupeOpenApiPathsText(currentContent);
    newContent = transformed.content;
    transformSummary = transformed.summary;
  } else {
    if (typeof args.diff !== "string" || !args.diff.trim()) {
      const err = new Error("diff is required for apply_unified_diff.");
      err.status = 400;
      err.code = "repo_patch_missing_diff";
      throw err;
    }
    newContent = applyUnifiedDiffToText(currentContent, args.diff);
  }

  if (newContent === currentContent) {
    return {
      action,
      path: filePath,
      branch,
      no_change: true,
      message: "computed new content matches current content; no commit created.",
    };
  }

  const newBytes = Buffer.byteLength(newContent, "utf8");
  const maxBytes = repoPatchMaxBytesForPath(filePath);
  if (newBytes > maxBytes) {
    const err = new Error(`new content size ${newBytes} bytes exceeds the ${maxBytes}-byte limit for ${filePath}.`);
    err.status = 413;
    err.code = "repo_patch_too_large";
    err.details = {
      path: filePath,
      new_bytes: newBytes,
      max_bytes: maxBytes,
      default_max_bytes: DEFAULT_REPO_PATCH_MAX_BYTES,
      large_text_max_bytes: LARGE_TEXT_REPO_PATCH_MAX_BYTES,
      large_text_allowlisted: maxBytes > DEFAULT_REPO_PATCH_MAX_BYTES,
      secrets_included: false,
    };
    throw err;
  }

  const putBody = {
    message: commitMessage,
    content: Buffer.from(newContent, "utf8").toString("base64"),
    branch,
  };
  if (currentSha) putBody.sha = currentSha;

  const putResult = await githubContentsRequest({
    method: "PUT",
    owner,
    repo,
    filePath,
    branch,
    body: putBody,
    token,
  });

  if (!putResult.ok) {
    const err = new Error("GitHub Contents PUT failed.");
    err.status = 502;
    err.code = "repo_patch_github_put_failed";
    err.details = { upstream_status: putResult.status, message: putResult.payload?.message };
    throw err;
  }

  const commitSha = putResult.payload?.commit?.sha || null;
  const commitUrl = putResult.payload?.commit?.html_url || null;

  writeAuditLogAsync({
    action: "repo_patch_apply",
    resource_type: "repo",
    resource_id: `${owner}/${repo}:${filePath}`,
    payload: {
      branch,
      action_type: action,
      commit_message: commitMessage,
      commit_sha: commitSha,
      previous_sha: currentSha || null,
      principal: ctx?.auth?.user_id || ctx?.auth?.mode || "admin",
    },
  });

  return {
    action,
    path: filePath,
    branch,
    owner,
    repo,
    commit_sha: commitSha,
    commit_url: commitUrl,
    previous_sha: currentSha || null,
    new_size_bytes: newBytes,
    transform_summary: transformSummary || undefined,
  };
}

export function buildGptToolsRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // GET /gpt/tools
  router.get("/gpt/tools", requireBackendApiKey, async (req, res) => {
    try {
      const callerType = resolveCallerType(req);
      const tools = await fetchTools(callerType);
      const { items, page } = paginateItems(tools, req.query || {});
      const body = {
        ok: true,
        caller_type: callerType,
        count: tools.length,
        returned_count: items.length,
        page,
        tools: items,
      };
      return res.status(200).json(await maybeChunkToolResponseBody(body, {
        response_options: req.query || {},
        source_tool_key: "gpt_tools_list",
      }));
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "tools_list_failed", message: err.message } });
    }
  });

  // POST /gpt/tools/call
  router.post("/gpt/tools/call", requireBackendApiKey, async (req, res) => {
    try {
      const body = req.body || {};
      // Accept both "tool_args" (preferred — avoids OpenAI reserved-keyword conflict) and legacy "arguments"
      const args = body.tool_args ?? body.arguments ?? {};
      const { name } = body;
      if (!name) {
        return res.status(400).json({ ok: false, error: { code: "missing_name", message: "name is required." } });
      }
      if (RESERVED_TOOL_KEYS.has(name)) {
        return res.status(400).json({ ok: false, error: { code: "reserved_tool", message: `'${name}' is a meta-operation; call it directly via its schema path.` } });
      }

      const callerType = resolveCallerType(req);

      // Up-front required-args check so the GPT gets a clear retry signal
      // instead of a downstream HTTP error when its schema cache forgot to
      // attach tool_args/arguments. Skips for virtual tools (their schemas
      // are exposed via VIRTUAL_ADMIN_TOOLS and enforced inline).
      const missingArgs = await detectMissingRequiredArgs(callerType, name, args);
      if (missingArgs) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "missing_required_args",
            message: `Tool '${name}' requires ${missingArgs.required.join(", ")}. Pass them under tool_args or arguments. Missing: ${missingArgs.missing.join(", ")}.`,
            details: missingArgs,
          },
        });
      }

      const result = await dispatchTool(callerType, name, args, req);
      return res.status(result.status).json(result.body);
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: {
        code: err.code || "tool_call_failed",
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
      secrets_included: false
      });
    }
  });

  return router;
}
