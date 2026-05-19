import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
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

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const SENSITIVE_ARG_SUBSTRINGS = [
  "password", "secret", "token", "api_key", "apikey",
  "credential", "private_key", "sa_json", "service_account_json",
  "client_secret", "refresh_token", "access_token", "authorization",
];
const TURN_CONTENT_RESULT_LIMIT = 3000;
const TURN_CONTENT_STRING_LIMIT = 500;

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

async function findActiveSessionForCaller(pool, req) {
  const tenantId = String(req?.auth?.tenant_id || PLATFORM_TENANT_ID);
  const userId = req?.auth?.user_id || null;
  const [rows] = await pool.query(
    `SELECT session_id, tenant_id, user_id, originator, session_status, started_at,
            drive_folder_id, drive_doc_id, drive_doc_url, drive_jsonl_id, drive_jsonl_url
       FROM \`customer_sessions\`
      WHERE originator = 'gpt_action'
        AND tenant_id = ?
        AND (user_id <=> ?)
        AND session_status NOT IN ('completed', 'closed')
      ORDER BY started_at DESC
      LIMIT 1`,
    [tenantId, userId]
  );
  return rows[0] || null;
}

async function recordToolDispatchTurn(req, toolKey, args, result) {
  try {
    const pool = getPool();
    const session = await findActiveSessionForCaller(pool, req);
    if (!session) return null;

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

// Meta-operations that live in the GPT schema itself — never callable via tools/call
const RESERVED_TOOL_KEYS = new Set([
  "activation_session_context",
  "gpt_tools_list",
  "gpt_tools_call",
  "gpt_session_turn",
  "gpt_session_end",
]);

const TOOLS_TABLE = {
  admin: "admin_platform_endpoint_tools",
  tenant: "tenant_platform_endpoint_tools",
};

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
  ".cjs", ".css", ".csv", ".env.example", ".gitignore", ".html", ".js", ".json",
  ".jsx", ".md", ".mjs", ".ps1", ".sql", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);

const VIRTUAL_ADMIN_TOOLS = [
  {
    name: "repo_inspect",
    displayName: "Repository Inspect",
    description: "Read-only repository inspection. Actions: list, read, search. Paths are repo-confined; secrets/build folders are blocked.",
    method: "VIRTUAL",
    path: "internal://repo-inspect",
    tags: ["repo", "read_only", "diagnostics"],
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list", "read", "search"] },
        path: { type: "string" },
        query: { type: "string" },
        recursive: { type: "boolean", default: false },
        max_entries: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        max_chars: { type: "integer", minimum: 1000, maximum: 50000, default: 12000 },
      },
    },
  },
  {
    name: "repo_patch_apply",
    displayName: "Repository Patch Apply",
    description: "Apply a patch to the repository via the GitHub App, sidestepping the local connector. Actions: write_file (replace whole file), replace_block (single old_string to new_string), apply_unified_diff (single-file unified diff string). Path is repo-confined; secrets/build folders are blocked. Commits to the named branch (defaults to main) and returns the new commit SHA. Requires GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY env and an activation_bootstrap_config row with github_owner and github_repo.",
    method: "VIRTUAL",
    path: "internal://repo-patch-apply",
    tags: ["repo", "mutation", "self_repair"],
    inputSchema: {
      type: "object",
      required: ["action", "path", "commit_message"],
      properties: {
        action: { type: "string", enum: ["write_file", "replace_block", "apply_unified_diff"] },
        path: { type: "string", description: "Repository-relative path of the single file to modify, e.g. http-generic-api/pathResolverDbLoader.js." },
        commit_message: { type: "string", minLength: 5, maxLength: 200 },
        branch: { type: "string", description: "Target branch. Defaults to main." },
        content: { type: "string", description: "Full new file content. Required for write_file." },
        old_string: { type: "string", description: "Exact substring to replace. Must occur exactly once. Required for replace_block." },
        new_string: { type: "string", description: "Replacement substring. Required for replace_block." },
        diff: { type: "string", description: "Unified diff body (a single file). Required for apply_unified_diff. Headers like diff --git/--- /+++ are optional; only hunks are required." },
      },
    },
  },
];

const REPO_PATCH_MAX_BYTES = 1_000_000; // 1 MiB upper bound for new content

function resolveCallerType(req) {
  if (req.auth?.mode === "backend_api_key" || req.auth?.is_admin === true) return "admin";
  return "tenant";
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
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
  const [rows] = await getPool().query(
    `SELECT tool_key, display_name, description, http_method, http_path,
            path_param_keys, input_schema, tags
     FROM \`${table}\`
     WHERE is_enabled = 1
     ORDER BY sort_order ASC, tool_key ASC`
  );
  const dbTools = rows.map((r) => ({
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
  const result = await dispatchToolImpl(callerType, toolKey, args, req);
  // Best-effort: archive the dispatch as a tool turn so admin GPT sessions get a
  // complete transcript without depending on the GPT calling writeSessionTurn.
  // Errors are logged and swallowed so the tool result still flows through.
  await recordToolDispatchTurn(req, toolKey, args, result);
  return result;
}

export function buildInternalToolDispatchHeaders(req, env = process.env) {
  const headers = {
    "Content-Type": "application/json",
    "X-Forwarded-For": req?.ip || "",
  };

  if ((req?.auth?.mode === "backend_api_key" || req?.auth?.is_admin === true) && env.BACKEND_API_KEY) {
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
    headers: buildInternalToolDispatchHeaders(req),
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

export async function inspectRepoReadOnly(args = {}) {
  const action = String(args.action || "list").trim().toLowerCase();
  if (action === "list") return listRepoEntries(args.path || ".", args);
  if (action === "read") return readRepoFile(args.path, args);
  if (action === "search") return searchRepoFiles(args);
  const err = new Error("action must be one of: list, read, search.");
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

async function githubContentsRequest({ method, owner, repo, filePath, branch, body, token, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}` +
    (method === "GET" && branch ? `?ref=${encodeURIComponent(branch)}` : "");
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mad4b-growth-os-repo-patch",
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, payload };
}

export async function applyRepoPatch(args = {}, ctx = {}) {
  const action = String(args.action || "").trim().toLowerCase();
  if (!["write_file", "replace_block", "apply_unified_diff"].includes(action)) {
    const err = new Error("action must be one of: write_file, replace_block, apply_unified_diff.");
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
  const branch = String(args.branch || defaultBranch).trim() || defaultBranch;

  const token = await getGitHubAppInstallationToken({});
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
  const currentContent = existing.status === 200 && existing.payload?.content
    ? Buffer.from(existing.payload.content, existing.payload.encoding || "base64").toString("utf8")
    : "";

  let newContent;
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
  if (newBytes > REPO_PATCH_MAX_BYTES) {
    const err = new Error(`new content size ${newBytes} bytes exceeds the ${REPO_PATCH_MAX_BYTES}-byte limit.`);
    err.status = 413;
    err.code = "repo_patch_too_large";
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
      return res.status(200).json({ ok: true, caller_type: callerType, count: tools.length, tools });
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
