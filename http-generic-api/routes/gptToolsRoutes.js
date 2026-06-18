import { Router } from "express";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getPool } from "../db.js";
import { getGitHubAppInstallationToken } from "../githubAppAuth.js";
import { resolveActivationBootstrapConfig } from "../activationBootstrapConfig.js";
import { writeAuditLogAsync } from "../auditLogger.js";
import { recordGptSessionTurn } from "../sessionArchiveService.js";
import {
  findActiveGrantForTool,
  validateArgsAgainstGrant,
  recordGrantUse,
} from "../scopeGrantsService.js";
import { cachedSqlRead, sqlCacheKey, toolCacheTtl } from "../sqlCache.js";
import {
  GOVERNED_RESPONSE_CHUNK_CURSOR_POLICY,
  extendGovernedToolResponseChunkExpiry,
  loadGovernedToolResponseChunk,
  persistGovernedToolResponseChunk,
} from "../governedToolResponseChunkStore.js";
import { evaluateRepoPatchApplyPreflight, evaluateGptToolDispatchPreflight, assertPreflightAllowed } from "../governedExecutionPreflight.js";
import {
  capabilityEnvelopeError,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "../capabilityResolutionEnvelopeGuard.js";
import { runAdminBranchReconcile, runGithubBranchFastForwardSmoke, runGithubBranchFastForwardToBase } from "../adminBranchReconciliationAdapter.js";
import { applyGithubExistingBlobChangeSet, applyGithubRepositoryChangeSet, deleteGithubBranchRef, finalizeGithubPullRequest, getGithubPullRequestCiGate } from "../githubRepositoryLifecycle.js";
import { runGithubSupersededBranchCleanup } from "../githubSupersededBranchCleanup.js";
import { buildPlatformCapabilityContractReport, buildPlatformCapabilityLiveReport } from "../platformCapabilityReports.js";
import { runGrowthIntelligencePilotAdmin } from "../growthIntelligenceAdminTool.js";
import {
  approveRepositoryAdvisoryCommentApprovalHoldAdmin,
  createRepositoryAdvisoryCommentApprovalHoldAdmin,
  decideGrowthIntelligenceActionAdmin,
  decideGrowthIntelligenceInsightAdmin,
  refreshGrowthIntelligenceReadinessAdmin,
} from "../growthIntelligenceAdminDecisions.js";

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
const DEFAULT_TOOL_RESPONSE_CHUNK_TTL_MS = 15 * 60 * 1000;
const MAX_TOOL_RESPONSE_CHUNK_TTL_MS = 2 * 60 * 60 * 1000;
const MIN_TOOL_RESPONSE_CHUNK_TTL_MS = 5 * 60 * 1000;
const TOOL_RESPONSE_CHUNK_CACHE = new Map();

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
    "connector_dispatch",
    "any_governed_tool_response",
  ]),
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

async function findActiveSessionForCaller(pool, req, args = {}) {
  const tenantId = String(req?.auth?.tenant_id || PLATFORM_TENANT_ID);
  const userId = req?.auth?.user_id || null;
  const pinnedSessionId = resolveGptSessionPin(req, args);
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
    return rows[0] ? { ...rows[0], archive_binding: "explicit_session_pin" } : null;
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
  return null;
}

async function recordToolDispatchTurn(req, toolKey, args, result) {
  try {
    const pool = getPool();
    const session = await findActiveSessionForCaller(pool, req, args);
    if (!session) {
      console.warn(`[gpt-tools] skipped auto-record turn for ${toolKey}: no explicit GPT session pin and no active session with user/assistant turns`);
      return null;
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

    return await recordGptSessionTurn({
      pool,
      session,
      role: "tool",
      content,
      action_key: toolKey,
      turnIndex,
    });
  } catch (err) {
    console.warn(`[gpt-tools] auto-record turn failed for ${toolKey}: ${err.message}`);
    return null;
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
    name: "repo_inspect",
    displayName: "Repository Inspect",
    description: "Read-only repository inspection. Actions: list, read, search, git_status, git_log, git_show, git_diff_name_status. Paths are repo-confined; secrets/build folders are blocked. Git helpers return metadata only and never expose .git internals.",
    method: "VIRTUAL",
    path: "internal://repo-inspect",
    tags: ["repo", "read_only", "diagnostics"],
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
    name: "response_chunk_read",
    displayName: "Read Tool Response Chunk",
    description: "Read the next chunk of a cached oversized tool response. Use when any governed tool returns response_chunked=true.",
    method: "VIRTUAL",
    path: "internal://response-chunk-read",
    tags: ["tooling", "pagination", "read_only"],
    inputSchema: {
      type: "object",
      required: ["chunk_id"],
      properties: {
        chunk_id: { type: "string" },
        cursor: { type: "integer", minimum: 0, default: 0 },
        max_chars: { type: "integer", minimum: 5000, maximum: 150000, default: 45000 },
      },
    },
  },
  {
    name: "admin_tool_catalog_search",
    displayName: "Search Admin Tool Catalog",
    description: "Search and paginate the full governed admin tool catalog through callAdminTool when the direct list surface cannot pass cursor/query parameters.",
    method: "VIRTUAL",
    path: "internal://admin-tool-catalog-search",
    tags: ["tooling", "catalog", "pagination", "read_only"],
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        tag: { type: "string" },
        cursor: { type: "integer", minimum: 0, default: 0 },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
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
    name: "repo_patch_batch_apply",
    displayName: "Repository Batch Patch Apply",
    description: "Create one atomic multi-file Git commit against an expected base SHA using Git trees, then update one non-protected work branch once and verify branch-head readback.",
    method: "VIRTUAL",
    path: "internal://repo-patch-batch-apply",
    tags: ["repo", "mutation", "batch", "atomic", "capability_envelope", "readback"],
    inputSchema: {
      type: "object",
      required: ["branch", "expected_base_sha", "commit_message", "changes", "capability_envelope_id"],
      properties: {
        branch: { type: "string" },
        expected_base_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
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
              action: { type: "string", enum: ["write_file", "delete_file"] },
              content: { type: "string" },
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
    tags: ["growth_intelligence", "decision", "internal_registry", "no_execution", "no_provider_write", "no_secrets"],
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
    tags: ["growth_intelligence", "approval", "internal_registry", "no_execution", "no_provider_write", "no_secrets"],
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
    tags: ["growth_intelligence", "readiness", "internal_registry", "no_execution", "no_provider_write", "no_secrets"],
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
    name: "repo_patch_apply",
    displayName: "Repository Patch Apply",
    description: "Apply a patch to the repository via the GitHub App, sidestepping the local connector. Actions: write_file, replace_block, apply_unified_diff, delete_file, dedupe_openapi_paths. Path is repo-confined; secrets/build folders are blocked. Runtime defaults to a generated non-protected work branch. Protected branches are blocked unless explicit break-glass policy is enabled and justified.",
    method: "VIRTUAL",
    path: "internal://repo-patch-apply",
    tags: ["repo", "mutation", "self_repair"],
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
    maxChars: clampNumber(options.max_chars ?? options.max_response_chars, DEFAULT_TOOL_RESPONSE_MAX_CHARS, 5000, MAX_TOOL_RESPONSE_MAX_CHARS),
    cursor: clampNumber(options.cursor ?? options.response_cursor, 0, 0, Number.MAX_SAFE_INTEGER),
    chunkTtlMs: Number(options.chunk_ttl_ms ?? options.response_chunk_ttl_ms ?? 0) || null,
    chunkTtlMinutes: Number(options.chunk_ttl_minutes ?? options.response_chunk_ttl_minutes ?? 0) || null,
  };
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

export async function maybeChunkToolResponseBody(body, optionsSource = {}, deps = {}) {
  const options = normalizeResponseOptions(optionsSource?.response_options || optionsSource?._response || {});
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
    sqlCacheKey("tools", callerType, "list", "v1"),
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
  const visibleRows = callerType === "tenant"
    ? rows.filter((r) => !isTenantBlockedToolPath(r.http_path) && !isTenantBlockedToolName(r.tool_key))
    : rows;
  const dbTools = visibleRows.map((r) => ({
    name: r.tool_key,
    displayName: r.display_name,
    description: r.description,
    method: r.http_method,
    path: r.http_path,
    tags: r.tags ? r.tags.split(",").map((t) => t.trim()) : [],
    inputSchema: parseJson(r.input_schema),
  }));
  return callerType === "admin" ? [...VIRTUAL_ADMIN_TOOLS, ...dbTools] : dbTools;
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
  assertPreflightAllowed(await evaluateGptToolDispatchPreflight({ callerType, toolKey, args }));
  const result = await dispatchToolImpl(callerType, toolKey, args, req);
  const responseOptions = args && typeof args === "object" ? args : {};
  const resultForClient = {
    ...result,
    body: await maybeChunkToolResponseBody(result?.body, {
      ...responseOptions,
      source_tool_key: toolKey,
    }),
  };
  // Best-effort: archive the dispatch as a tool turn so admin GPT sessions get a
  // complete transcript without depending on the GPT calling writeSessionTurn.
  // Errors are logged and swallowed so the tool result still flows through.
  await recordToolDispatchTurn(req, toolKey, args, resultForClient);
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

  if (callerType === "admin" && toolKey === "response_chunk_read") {
    return { status: 200, body: await readCachedToolResponseChunk(args) };
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

export function applyUnifiedDiffToText(originalText, diffBody) {
  const lines = String(diffBody || "").split(/\r?\n/);
  // Strip optional headers — diff --git, ---, +++, index
  let i = 0;
  while (i < lines.length && !/^@@/.test(lines[i])) i += 1;
  if (i >= lines.length) {
    const err = new Error("unified diff has no hunks (lines starting with @@).");
    err.status = 400;
    err.code = "repo_patch_no_hunks";
    throw err;
  }

  const originalLines = originalText.split(/\r?\n/);
  const result = [];
  let originalCursor = 0;

  while (i < lines.length) {
    const header = lines[i];
    const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(header);
    if (!match) {
      i += 1;
      continue;
    }
    const oldStart = parseInt(match[1], 10);
    const oldStartIdx = Math.max(0, oldStart - 1);

    while (originalCursor < oldStartIdx && originalCursor < originalLines.length) {
      result.push(originalLines[originalCursor]);
      originalCursor += 1;
    }

    i += 1;
    while (i < lines.length && !/^@@/.test(lines[i])) {
      const hunkLine = lines[i];
      if (hunkLine.startsWith("---") || hunkLine.startsWith("+++") || hunkLine.startsWith("diff --git") || hunkLine.startsWith("index ")) {
        i += 1;
        continue;
      }
      const prefix = hunkLine[0];
      const body = hunkLine.slice(1);
      if (prefix === " ") {
        if (originalLines[originalCursor] !== body) {
          const err = new Error(`unified diff context mismatch at original line ${originalCursor + 1}.`);
          err.status = 409;
          err.code = "repo_patch_context_mismatch";
          err.details = { expected: body, found: originalLines[originalCursor] };
          throw err;
        }
        result.push(originalLines[originalCursor]);
        originalCursor += 1;
      } else if (prefix === "-") {
        if (originalLines[originalCursor] !== body) {
          const err = new Error(`unified diff removal mismatch at original line ${originalCursor + 1}.`);
          err.status = 409;
          err.code = "repo_patch_removal_mismatch";
          err.details = { expected: body, found: originalLines[originalCursor] };
          throw err;
        }
        originalCursor += 1;
      } else if (prefix === "+") {
        result.push(body);
      } else if (hunkLine === "" || hunkLine === "\\ No newline at end of file") {
        // tolerate
      } else {
        // Unknown line — skip defensively
      }
      i += 1;
    }
  }

  while (originalCursor < originalLines.length) {
    result.push(originalLines[originalCursor]);
    originalCursor += 1;
  }

  return result.join("\n");
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
        error: { code: err.code || "tool_call_failed", message: err.message }
      });
    }
  });

  return router;
}
