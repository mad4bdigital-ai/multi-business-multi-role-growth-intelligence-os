import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_MODES = Object.freeze(["sql", "github_snapshot", "repository_snapshot"]);
const DEFAULT_REPOSITORY_SNAPSHOT_PATH = "http-generic-api/config/runtime-recovery-repository-snapshot.json";
const MAX_SNAPSHOT_BYTES = 48 * 1024;
const MAX_TOOL_COUNT = 200;
const MAX_TEXT_LENGTH = 4000;
const SAFE_NAME = /^[A-Za-z0-9_.:-]{1,128}$/u;
const SENSITIVE_KEY = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh|access[_-]?token|raw|transcript|request_json)/iu;
const SAFE_METADATA_KEYS = new Set(["secrets_included"]);

export const RUNTIME_RECOVERY_SNAPSHOT_CONTRACT = "mad4b.runtime-recovery-snapshot.v1";
export const RUNTIME_RECOVERY_SOURCE_MODES = SOURCE_MODES;
export { DEFAULT_REPOSITORY_SNAPSHOT_PATH };

function sourceError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = { ...details, secrets_included: false };
  return error;
}

function text(value, fallback = "") {
  const normalized = String(value ?? fallback).trim();
  return normalized.slice(0, MAX_TEXT_LENGTH);
}

function parseJson(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_INPUT_MISSING", `${label} is required.`, { label });
  if (Buffer.byteLength(raw, "utf8") > MAX_SNAPSHOT_BYTES) {
    throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_TOO_LARGE", `${label} exceeds the bounded snapshot size.`, { label, max_bytes: MAX_SNAPSHOT_BYTES });
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_JSON_INVALID", `${label} is not valid JSON.`, { label });
  }
}

function rejectSensitiveKeys(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => rejectSensitiveKeys(child, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key) && !SAFE_METADATA_KEYS.has(key)) {
      throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_SENSITIVE_FIELD", "Snapshot contains a prohibited sensitive field.", { field: [...path, key].join(".") });
    }
    rejectSensitiveKeys(child, [...path, key]);
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_SHAPE_INVALID", `${label} must be an object.`, { label });
  }
  return value;
}

function normalizedTags(value) {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean).slice(0, 20);
  return text(value).split(/[|,;\n]/u).map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

function normalizeTools(input) {
  const catalog = input?.catalog && typeof input.catalog === "object" ? input.catalog : input;
  const tools = catalog?.tools;
  if (!Array.isArray(tools) || tools.length === 0 || tools.length > MAX_TOOL_COUNT) {
    throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_CATALOG_INVALID", "The snapshot catalog must contain between 1 and 200 tools.", { tool_count: Array.isArray(tools) ? tools.length : 0 });
  }
  return tools.map((tool, index) => {
    const row = assertPlainObject(tool, `catalog.tools[${index}]`);
    const name = text(row.name || row.tool_key);
    if (!SAFE_NAME.test(name)) throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_TOOL_INVALID", "Snapshot tool name is missing or unsafe.", { index });
    const method = text(row.method || "VIRTUAL").toUpperCase();
    const pathValue = text(row.path || `virtual://${name}`);
    const descriptorText = `${name} ${pathValue} ${normalizedTags(row.tags).join(" ")}`.toLowerCase();
    if (!["GET", "HEAD", "VIRTUAL"].includes(method) || /(write|grant|apply|migration|deploy|restart|create|update|delete|insert|alter|drop)/iu.test(descriptorText)) {
      throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_WRITE_DESCRIPTOR", "Snapshot catalog may contain read-only descriptors only.", { index, name });
    }
    return {
      name,
      displayName: text(row.displayName || row.display_name || name),
      description: text(row.description || "Repository-declared read-only recovery descriptor."),
      method,
      path: pathValue,
      tags: normalizedTags(row.tags),
      catalogLevel: text(row.catalogLevel || row.catalog_level || "core"),
      catalog_level: text(row.catalog_level || row.catalogLevel || "core"),
      inputSchema: row.inputSchema || row.input_schema || { type: "object", properties: {}, additionalProperties: false },
      fallback_dispatch: "blocked",
      source: "runtime_recovery_snapshot",
    };
  });
}

function normalizeSubject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = ["tenant_id", "user_id", "workspace_key", "brand_key", "business_type_key", "business_activity_type_key", "activity_key", "knowledge_profile_key"];
  return Object.fromEntries(allowed
    .filter((key) => typeof value[key] === "string" && value[key].trim())
    .map((key) => [key, text(value[key])]));
}

function normalizeSession(input, mode) {
  const source = input?.session_context && typeof input.session_context === "object" ? input.session_context : input;
  assertPlainObject(source, "session_context");
  if (source.read_only === false || source.persistent === true || source.durable === true || source.runtime_authority === true) {
    throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_WRITE_AUTHORITY_FORBIDDEN", "Snapshot session context must remain read-only and non-persistent.");
  }
  if (source.session_id !== undefined && source.session_id !== null && text(source.session_id)) {
    throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_SESSION_ID_FORBIDDEN", "A DB-absent snapshot cannot claim a durable session_id.");
  }
  const sourceLabel = mode === "github_snapshot" ? "github_snapshot" : "repository_snapshot";
  return {
    ok: true,
    activation_layer: "session_context",
    read_only: true,
    session_id: null,
    run_id: null,
    idempotency_key: null,
    session_policy: "read_only_snapshot",
    session_reused: false,
    closed_sessions: 0,
    session_management: {
      mode: "snapshot_read_only",
      persistent: false,
      durable: false,
      status_written: null,
      database_connection_performed: false,
      database_mutation_performed: false,
      new_session_opened: false,
      context_source: sourceLabel,
      note: "This is a bounded read-only snapshot; it does not create or persist a session.",
    },
    subject: normalizeSubject(source.subject),
    pagination: { limit: 0, offset: 0, include_raw: false, has_more_session_history: false },
    last_session: null,
    session_history: [],
    related_scopes: [],
    history: {
      session_envelopes_count: 0,
      audit_events: [],
      transcript_events: [],
      transcript_source_status: { source: sourceLabel, status: "snapshot", tenant_safe: true, event_count: 0 },
      developer_apps: [],
      api_credentials: [],
      installations: [],
    },
    gpt_sessions: [],
    turn_capture_policy: {
      status: "unavailable_without_persistence",
      persistent: false,
      write_blocked: true,
      secrets_included: false,
    },
    conversation_ref_capture_policy: {
      status: "blocked_without_persistence",
      persistent: false,
      write_blocked: true,
      secrets_included: false,
    },
    conversation_memory: {
      status: "snapshot",
      source: sourceLabel,
      durable: false,
      persistence: "unavailable",
      conversation_turns: 0,
      tool_turns: 0,
      total_turns: 0,
      degraded_surfaces: [{ surface: "database_persistence", reason_code: "schema_not_required_for_snapshot" }],
    },
    platform_access: {
      mode: "snapshot_read_only",
      source: sourceLabel,
      ready: false,
      durable: false,
      database_required: false,
      access_scope: "snapshot_read_only",
      degraded_surfaces: [{ surface: "database_backed_platform_inventory", reason_code: "snapshot_source" }],
    },
    authorized_access: {
      mode: "snapshot_read_only",
      source: sourceLabel,
      ready: false,
      durable: false,
      database_required: false,
      scopes: [],
      degraded_surfaces: [{ surface: "database_backed_authorization", reason_code: "snapshot_source" }],
    },
    platform_evolution: { status: "snapshot", source: sourceLabel, durable: false },
    pending_tasks: { summary: { total_visible: 0, blockers: 0, non_blocking: 0, by_status: {}, by_type: {} }, items: [] },
    degraded_surfaces: [
      { surface: "session_persistence", reason_code: "runtime_recovery_snapshot_non_persistent" },
      { surface: "database_schema", reason_code: "runtime_recovery_snapshot_active" },
    ],
    runtime_recovery_source: {
      contract: RUNTIME_RECOVERY_SNAPSHOT_CONTRACT,
      mode,
      database_connection_performed: false,
      database_mutation_performed: false,
      provider_mutation_performed: false,
      runtime_authority: false,
      persistence: "unavailable",
      source: sourceLabel,
      secrets_included: false,
    },
  };
}

function normalizeSnapshot(raw, mode) {
  assertPlainObject(raw, "snapshot");
  rejectSensitiveKeys(raw);
  if (raw.runtime_authority === true || raw.database_mutation_performed === true || raw.provider_mutation_performed === true || raw.persistence === "durable") {
    throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_AUTHORITY_FORBIDDEN", "Snapshot cannot declare runtime authority, mutation, or durable persistence.");
  }
  return {
    contract: RUNTIME_RECOVERY_SNAPSHOT_CONTRACT,
    mode,
    catalog: { ok: true, tools: normalizeTools(raw.catalog || raw) },
    sessionContext: normalizeSession(raw.session_context || raw.sessionContext || {}, mode),
    database_connection_performed: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    runtime_authority: false,
    persistence: "unavailable",
    secrets_included: false,
  };
}

function resolveMode(env = process.env) {
  const mode = text(env.RUNTIME_RECOVERY_SOURCE_MODE || env.RUNTIME_RECOVERY_SOURCE || "sql").toLowerCase();
  if (!SOURCE_MODES.includes(mode)) {
    throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_MODE_INVALID", "RUNTIME_RECOVERY_SOURCE_MODE is not allowlisted.", { mode, allowed_modes: SOURCE_MODES });
  }
  return mode;
}

function resolveRepositoryPath(rawPath, repoRoot) {
  const relative = text(rawPath || DEFAULT_REPOSITORY_SNAPSHOT_PATH).replaceAll("\\", "/");
  if (relative.startsWith("/") || relative.includes("..") || !relative.endsWith(".json")) {
    throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_PATH_INVALID", "Repository snapshot path must be a relative JSON file inside the repository.");
  }
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_PATH_INVALID", "Repository snapshot path escaped the repository root.");
  }
  return absolute;
}

function readRepositorySnapshot(env, repoRoot) {
  const filePath = resolveRepositoryPath(env.RUNTIME_RECOVERY_SNAPSHOT_PATH, repoRoot);
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    throw sourceError("RUNTIME_RECOVERY_SNAPSHOT_FILE_MISSING", "Repository snapshot file could not be read.", { path: text(env.RUNTIME_RECOVERY_SNAPSHOT_PATH || DEFAULT_REPOSITORY_SNAPSHOT_PATH) });
  }
  return parseJson(content, "RUNTIME_RECOVERY_SNAPSHOT_PATH");
}

export function resolveRuntimeRecoverySourceMode(env = process.env) {
  return resolveMode(env);
}

export function isRuntimeRecoverySnapshotEnabled(env = process.env) {
  return resolveMode(env) !== "sql";
}

export function loadRuntimeRecoverySnapshot(env = process.env, { repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") } = {}) {
  const mode = resolveMode(env);
  if (mode === "sql") return { contract: RUNTIME_RECOVERY_SNAPSHOT_CONTRACT, mode, enabled: false, database_required: true, secrets_included: false };
  const raw = mode === "github_snapshot"
    ? (env.RUNTIME_RECOVERY_SNAPSHOT_JSON ? parseJson(env.RUNTIME_RECOVERY_SNAPSHOT_JSON, "RUNTIME_RECOVERY_SNAPSHOT_JSON") : {
        catalog: parseJson(env.RUNTIME_RECOVERY_CATALOG_JSON, "RUNTIME_RECOVERY_CATALOG_JSON"),
        session_context: parseJson(env.RUNTIME_RECOVERY_SESSION_CONTEXT_JSON, "RUNTIME_RECOVERY_SESSION_CONTEXT_JSON"),
      })
    : readRepositorySnapshot(env, repoRoot);
  return { enabled: true, database_required: false, ...normalizeSnapshot(raw, mode) };
}

export function buildRuntimeRecoverySnapshotWriteBlockedError(toolKey = null) {
  return sourceError("RUNTIME_RECOVERY_SNAPSHOT_READ_ONLY", "Runtime recovery snapshot mode exposes read-only evidence only; tool dispatch and persistence writes are blocked.", { tool_key: toolKey || null });
}

export function buildRuntimeRecoverySnapshotUnavailableResponse(error) {
  return {
    code: error?.code || "RUNTIME_RECOVERY_SNAPSHOT_UNAVAILABLE",
    message: error?.message || "Runtime recovery snapshot is unavailable.",
    details: { ...(error?.details || {}), runtime_authority: false, persistence: "unavailable", database_mutation_performed: false, secrets_included: false },
    secrets_included: false,
  };
}
