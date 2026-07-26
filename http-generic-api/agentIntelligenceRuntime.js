import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const SENSITIVE_KEY_PATTERN = /(secret|password|token|api[_-]?key|authorization|credential|private[_-]?key)/i;
const ALLOWED_CONTENT_BLOCKS = new Set(["text", "tool_use", "tool_result", "thinking_metadata"]);
const RISK_CLASSES = [
  "read_only",
  "workspace_write",
  "brand_external_write",
  "tenant_external_write",
  "admin_registry_write",
  "provider_privileged",
  "local_device",
  "destructive",
  "credential_touching",
  "deployment_affecting",
];

function text(value = "") {
  return String(value || "").trim();
}

function safeJsonParse(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactLower(value = "") {
  return text(value).toLowerCase();
}

function redact(value, depth = 0) {
  if (depth > 8) return "[max_depth]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redact(child, depth + 1);
  }
  return out;
}

function normalizeContentBlocks(message = {}) {
  const rawContent = Array.isArray(message.content)
    ? message.content
    : typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : [];
  return rawContent.map((block) => {
    const type = ALLOWED_CONTENT_BLOCKS.has(block?.type) ? block.type : "text";
    if (type === "thinking_metadata") {
      return { type, stored_raw_thinking: false, metadata: redact(block.metadata || {}) };
    }
    return { ...redact(block), type };
  });
}

function summarizeMessages(messages = []) {
  return asArray(messages).map((message, index) => {
    const contentBlocks = normalizeContentBlocks(message);
    return {
      index,
      role: text(message.role || "user"),
      content_block_types: contentBlocks.map((block) => block.type),
      content_block_count: contentBlocks.length,
      sanitized_content_preview: contentBlocks.slice(0, 5),
      raw_thinking_stored: false,
    };
  });
}

export function buildCanonicalModelRunPlan(input = {}) {
  const messages = asArray(input.messages);
  const modelKey = text(input.model_key || input.model || "default_model");
  const providerKey = text(input.provider_key || input.provider || "default_provider");
  const requestedTools = asArray(input.requested_tools || input.tools);
  const mode = text(input.mode || "dry_run") === "apply" ? "dry_run" : text(input.mode || "dry_run");
  const modelRunId = input.model_run_id || randomUUID();
  const messageSummary = summarizeMessages(messages);
  const contentBlockCounts = {};
  for (const message of messageSummary) {
    for (const blockType of message.content_block_types) {
      contentBlockCounts[blockType] = (contentBlockCounts[blockType] || 0) + 1;
    }
  }

  return {
    ok: true,
    model_run_id: modelRunId,
    runtime_contract: "canonical_governed_agent_runtime_v1",
    mode: mode || "dry_run",
    will_call_model: false,
    model_executes_tools: false,
    tool_execution_runtime_separate: true,
    deferred_tool_search_required: requestedTools.length === 0,
    raw_tool_catalog_exposed: false,
    no_raw_thinking_stored: true,
    provider_key: providerKey,
    model_key: modelKey,
    allowed_content_blocks: [...ALLOWED_CONTENT_BLOCKS],
    input_message_summary: messageSummary,
    content_block_counts: contentBlockCounts,
    requested_tools: requestedTools.map((tool) => text(tool)).filter(Boolean),
    required_events: [
      "decision.started",
      "policy.loaded",
      "skill.bound",
      "model.started",
      "tool.authorized",
      "tool.denied",
      "tool.result",
      "readback.validated",
      "memory.writeback.completed",
    ],
    hard_gates: {
      policy_required: true,
      scope_guard_required: true,
      approval_required_for_high_risk: true,
      validators_required: true,
      readback_required_for_side_effects: true,
      model_may_override: false,
    },
    next_step: "authorize_separate_model_runtime_after_policy_and_skill_binding",
  };
}

export function buildCanonicalModelRunEvents(plan = {}) {
  const runId = plan.model_run_id || randomUUID();
  return {
    ok: true,
    model_run_id: runId,
    event_stream_type: "canonical_agent_runtime_events_v1",
    events: [
      { event: "decision.started", model_run_id: runId, status: "planned" },
      { event: "policy.loaded", model_run_id: runId, status: "required" },
      { event: "skill.bound", model_run_id: runId, status: "required" },
      { event: "model.started", model_run_id: runId, status: "not_started_dry_run" },
      { event: "memory.writeback.completed", model_run_id: runId, status: "not_required_dry_run" },
    ],
  };
}

function inferRiskClass(row = {}) {
  const haystack = [
    row.risk_class,
    row.tags,
    row.tool_key,
    row.http_method,
    row.http_path,
    row.description,
  ].map(compactLower).join(" ");
  if (/delete|drop|truncate|destructive/.test(haystack)) return "destructive";
  if (/credential|secret|token|api[_-]?key|authorization/.test(haystack)) return "credential_touching";
  if (/deploy|release|promotion|production/.test(haystack)) return "deployment_affecting";
  if (/connector|device|local/.test(haystack)) return "local_device";
  if (/post|put|patch|write|mutation|apply/.test(haystack)) return "workspace_write";
  return "read_only";
}

function normalizeToolRow(row = {}) {
  const tags = Array.isArray(row.tags)
    ? row.tags
    : text(row.tags).split(",").map((tag) => tag.trim()).filter(Boolean);
  const riskClass = RISK_CLASSES.includes(row.risk_class) ? row.risk_class : inferRiskClass(row);
  return {
    tool_key: text(row.tool_key || row.name),
    display_name: text(row.display_name || row.displayName || row.tool_key || row.name),
    description: text(row.description).slice(0, 400),
    source_truth_resource_type: text(row.source_truth_resource_type || "endpoint"),
    source_truth_resource_key: text(row.source_truth_resource_key || row.tool_key || row.name),
    http_method: text(row.http_method || row.method),
    http_path: text(row.http_path || row.path),
    risk_class: riskClass,
    tags,
    raw_manifest_exposed: false,
  };
}

function matchesTool(row, query, tags, riskClass) {
  const normalized = normalizeToolRow(row);
  if (riskClass && normalized.risk_class !== riskClass) return false;
  if (tags.length > 0 && !tags.every((tag) => normalized.tags.map(compactLower).includes(compactLower(tag)))) return false;
  if (!query) return true;
  const haystack = [
    normalized.tool_key,
    normalized.display_name,
    normalized.description,
    normalized.http_method,
    normalized.http_path,
    normalized.risk_class,
    ...normalized.tags,
  ].map(compactLower).join(" ");
  return haystack.includes(compactLower(query));
}

async function loadDbToolRows(pool) {
  const [indexed] = await pool.query(
    `SELECT tool_key, display_name, source_truth_resource_type, source_truth_resource_key,
            tool_manifest_json, risk_class, deferred_search_tags_json AS tags, status
       FROM agent_tool_index
      WHERE status = 'active'
      ORDER BY tool_key ASC
      LIMIT 500`
  ).catch(() => [[]]);
  if (indexed.length > 0) return indexed.map((row) => {
    const manifest = safeJsonParse(row.tool_manifest_json, {});
    return {
      ...row,
      display_name: row.display_name || manifest.display_name,
      description: manifest.description || row.description || "",
      http_method: manifest.http_method || row.http_method || "",
      http_path: manifest.http_path || row.http_path || "",
      tags: typeof row.tags === "string" ? JSON.parse(row.tags || "[]") : row.tags,
    };
  });

  const [adminTools] = await pool.query(
    `SELECT tool_key, display_name, description, http_method, http_path, tags
       FROM admin_platform_endpoint_tools
      WHERE is_enabled = 1
      ORDER BY sort_order ASC, tool_key ASC
      LIMIT 500`
  );
  return adminTools;
}

export async function searchAgentTools(input = {}, deps = {}) {
  const query = text(input.query || input.q);
  const tags = asArray(input.tags).map(text).filter(Boolean);
  const riskClass = RISK_CLASSES.includes(input.risk_class) ? input.risk_class : "";
  const limit = Math.max(1, Math.min(Number(input.limit) || 25, 100));
  const rows = Array.isArray(input.tools)
    ? input.tools
    : deps.tools || await loadDbToolRows(deps.pool || getPool());
  const matches = rows
    .filter((row) => matchesTool(row, query, tags, riskClass))
    .slice(0, limit)
    .map(normalizeToolRow);
  return {
    ok: true,
    search_type: "deferred_governed_tool_search_v1",
    query,
    tags,
    risk_class: riskClass || null,
    raw_catalog_exposed: false,
    source_truth_note: "agent_tool_index is a derived index; actions/endpoints/workflows/connected_systems remain source of truth.",
    count: matches.length,
    tools: matches,
  };
}
