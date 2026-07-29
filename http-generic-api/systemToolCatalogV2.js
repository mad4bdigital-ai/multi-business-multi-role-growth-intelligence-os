import crypto from "node:crypto";

export const SYSTEM_TOOL_CATALOG_DEFAULT_LIMIT = 50;
export const SYSTEM_TOOL_CATALOG_MAX_LIMIT = 200;

const OBSERVABILITY_KEYS = Object.freeze([
  "catalog_list_requests",
  "catalog_direct_lookup_requests",
  "catalog_lookup_not_found",
  "legacy_full_catalog_requests",
  "capability_resolution_requests",
  "snapshot_mismatch",
  "descriptor_runtime_mismatch",
]);

const counters = Object.fromEntries(OBSERVABILITY_KEYS.map((key) => [key, 0]));

export class SystemToolCatalogError extends Error {
  constructor(code, message, { status = 400, details = {} } = {}) {
    super(message);
    this.name = "SystemToolCatalogError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function bump(key, amount = 1) {
  if (Object.prototype.hasOwnProperty.call(counters, key)) counters[key] += amount;
}

function text(value = "", max = 4096) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizedText(value = "") {
  return text(value).toLowerCase().replace(/[^a-z0-9._:-]+/g, " ").trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function normalizeTags(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => normalizedText(item))
    .filter(Boolean))].sort();
}

function normalizeAliases(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => text(item, 191))
    .filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function normalizeSystemToolDescriptor(tool = {}) {
  const name = text(tool.name, 191);
  if (!name) {
    throw new SystemToolCatalogError(
      "SYSTEM_TOOL_NAME_REQUIRED",
      "Every system tool descriptor requires a stable name.",
      { status: 500 },
    );
  }
  const sourceKey = text(
    tool.source_key
      || tool.sourceKey
      || tool["x-source-key"]
      || tool.descriptor_source
      || "local_system_layer",
    191,
  );
  const capabilityKey = text(
    tool.capability_key
      || tool.capabilityKey
      || tool["x-capability-key"]
      || "",
    191,
  ) || null;
  const descriptor = {
    name,
    description: text(tool.description, 4000),
    source_key: sourceKey,
    capability_key: capabilityKey,
    tags: normalizeTags(tool.tags),
    aliases: normalizeAliases(tool.aliases),
    requires_admin: tool.requires_admin === true,
    inputSchema: tool.inputSchema && typeof tool.inputSchema === "object"
      ? stableValue(tool.inputSchema)
      : { type: "object", properties: {}, additionalProperties: false },
  };
  return {
    ...descriptor,
    sort_key: `${descriptor.source_key}\u0000${descriptor.name}`,
  };
}

function projectedDescriptor(descriptor) {
  const { sort_key: _sortKey, ...projection } = descriptor;
  return projection;
}

function normalizeVisibleTools(tools = []) {
  const index = new Map();
  for (const tool of Array.isArray(tools) ? tools : []) {
    const descriptor = normalizeSystemToolDescriptor(tool);
    index.set(descriptor.name, descriptor);
  }
  return [...index.values()].sort((a, b) => a.sort_key.localeCompare(b.sort_key));
}

function catalogVersionFor(descriptors) {
  return sha256(stableStringify(descriptors.map(projectedDescriptor)));
}

function queryFilters(query = {}) {
  return {
    q: normalizedText(query.q || query.query),
    tag: normalizedText(query.tag),
    source_key: text(query.source_key || query.sourceKey, 191),
    capability_key: text(query.capability_key || query.capabilityKey, 191),
  };
}

function filterDescriptors(descriptors, filters) {
  return descriptors.filter((descriptor) => {
    if (filters.source_key && descriptor.source_key !== filters.source_key) return false;
    if (filters.capability_key && descriptor.capability_key !== filters.capability_key) return false;
    if (filters.tag && !descriptor.tags.includes(filters.tag)) return false;
    if (!filters.q) return true;
    const haystack = normalizedText([
      descriptor.name,
      descriptor.description,
      descriptor.source_key,
      descriptor.capability_key,
      ...descriptor.tags,
      ...descriptor.aliases,
    ].filter(Boolean).join(" "));
    return haystack.includes(filters.q);
  });
}

function boundedLimit(value, fallback = SYSTEM_TOOL_CATALOG_DEFAULT_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), SYSTEM_TOOL_CATALOG_MAX_LIMIT);
}

function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (parsed?.v !== 1 || !Number.isInteger(parsed?.i) || parsed.i < 0 || !parsed.c || !parsed.s) {
      throw new Error("invalid cursor payload");
    }
    return parsed;
  } catch {
    throw new SystemToolCatalogError(
      "SYSTEM_TOOL_CATALOG_CURSOR_INVALID",
      "The system tool catalog cursor is invalid.",
      { status: 400 },
    );
  }
}

function hasExplicitCatalogWindow(query = {}) {
  return ["limit", "cursor", "offset", "q", "query", "tag", "source_key", "sourceKey", "capability_key", "capabilityKey"]
    .some((key) => Object.prototype.hasOwnProperty.call(query, key)
      && String(query[key] ?? "").trim() !== "");
}

export function listSystemToolCatalog(tools = [], query = {}, {
  legacyCompleteDefault = false,
} = {}) {
  bump("catalog_list_requests");
  const visible = normalizeVisibleTools(tools);
  const catalogVersion = catalogVersionFor(visible);
  const filters = queryFilters(query);
  const filtered = filterDescriptors(visible, filters);
  const snapshotId = sha256(`${catalogVersion}:${stableStringify(filters)}`);
  const cursor = decodeCursor(query.cursor);
  if (cursor && (cursor.c !== catalogVersion || cursor.s !== snapshotId)) {
    bump("snapshot_mismatch");
    throw new SystemToolCatalogError(
      "SYSTEM_TOOL_CATALOG_SNAPSHOT_MISMATCH",
      "The system tool catalog changed after this cursor was issued.",
      {
        status: 409,
        details: { expected_catalog_version: cursor.c, current_catalog_version: catalogVersion },
      },
    );
  }

  const explicitWindow = hasExplicitCatalogWindow(query);
  const legacyMode = legacyCompleteDefault && !explicitWindow;
  if (legacyMode) bump("legacy_full_catalog_requests");
  const start = cursor?.i ?? Math.max(Number.parseInt(query.offset, 10) || 0, 0);
  const limit = legacyMode
    ? Math.min(Math.max(filtered.length, 1), SYSTEM_TOOL_CATALOG_MAX_LIMIT)
    : boundedLimit(query.limit);
  const slice = filtered.slice(start, start + limit);
  const nextIndex = start + slice.length;
  const hasMore = nextIndex < filtered.length;

  return {
    items: slice.map(projectedDescriptor),
    catalog_version: catalogVersion,
    snapshot_id: snapshotId,
    page: {
      limit,
      returned_count: slice.length,
      total_count: filtered.length,
      has_more: hasMore,
      next_cursor: hasMore
        ? encodeCursor({ v: 1, c: catalogVersion, s: snapshotId, i: nextIndex })
        : null,
    },
    compatibility: legacyMode
      ? {
          mode: "legacy-complete-list",
          deprecated: true,
          bounded_max_items: SYSTEM_TOOL_CATALOG_MAX_LIMIT,
          replacement: "cursor-pagination-or-direct-lookup",
        }
      : null,
    secrets_included: false,
  };
}

export function getSystemToolDescriptorByName(tools = [], toolName = "") {
  bump("catalog_direct_lookup_requests");
  const requested = text(toolName, 191);
  const visible = normalizeVisibleTools(tools);
  const descriptor = visible.find((item) => item.name === requested);
  if (!descriptor) {
    bump("catalog_lookup_not_found");
    throw new SystemToolCatalogError(
      "SYSTEM_TOOL_NOT_FOUND",
      "The requested system tool is not available to this principal.",
      { status: 404, details: { tool_name: requested } },
    );
  }
  const catalogVersion = catalogVersionFor(visible);
  return {
    tool: projectedDescriptor(descriptor),
    catalog_version: catalogVersion,
    snapshot_id: sha256(`${catalogVersion}:lookup:${descriptor.name}`),
    secrets_included: false,
  };
}

function tokenSet(value) {
  return new Set(normalizedText(value).split(/\s+/).filter((token) => token.length > 1));
}

function intersectionCount(a, b) {
  let count = 0;
  for (const value of a) if (b.has(value)) count += 1;
  return count;
}

function candidateScore(descriptor, { intent, toolName, capabilityKey }) {
  const reasons = [];
  let score = 0;
  if (toolName && descriptor.name === toolName) {
    score += 1000;
    reasons.push("exact_tool_name");
  }
  if (capabilityKey && descriptor.capability_key === capabilityKey) {
    score += 900;
    reasons.push("exact_capability_key");
  }
  if (descriptor.aliases.some((alias) => normalizedText(alias) === intent)) {
    score += 800;
    reasons.push("exact_alias");
  }
  const intentTokens = tokenSet(intent);
  const nameTokens = tokenSet(descriptor.name);
  const tagTokens = new Set(descriptor.tags.flatMap((tag) => [...tokenSet(tag)]));
  const descriptionTokens = tokenSet(descriptor.description);
  const nameMatches = intersectionCount(intentTokens, nameTokens);
  const tagMatches = intersectionCount(intentTokens, tagTokens);
  const descriptionMatches = intersectionCount(intentTokens, descriptionTokens);
  if (nameMatches) {
    score += nameMatches * 120;
    reasons.push("tool_name_tokens");
  }
  if (tagMatches) {
    score += tagMatches * 80;
    reasons.push("tag_tokens");
  }
  if (descriptionMatches) {
    score += descriptionMatches * 10;
    reasons.push("description_tokens");
  }
  return { score, reasons };
}

export function resolveSystemCapabilityIntent(tools = [], request = {}) {
  bump("capability_resolution_requests");
  const intent = normalizedText(request.intent);
  const toolName = text(request.tool_name || request.toolName, 191);
  const capabilityKey = text(request.capability_key || request.capabilityKey, 191);
  if (!intent && !toolName && !capabilityKey) {
    throw new SystemToolCatalogError(
      "SYSTEM_CAPABILITY_INTENT_REQUIRED",
      "intent, tool_name, or capability_key is required.",
      { status: 400 },
    );
  }
  const descriptors = normalizeVisibleTools(tools);
  const catalogVersion = catalogVersionFor(descriptors);
  const ranked = descriptors
    .map((descriptor) => ({ descriptor, ...candidateScore(descriptor, { intent, toolName, capabilityKey }) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.descriptor.sort_key.localeCompare(b.descriptor.sort_key))
    .slice(0, boundedLimit(request.max_candidates, 10));
  const topScore = ranked[0]?.score || 0;
  const topTies = ranked.filter((candidate) => candidate.score === topScore);
  const status = ranked.length === 0
    ? "not_found"
    : topTies.length > 1
      ? "clarification_required"
      : "resolved";
  return {
    status,
    catalog_version: catalogVersion,
    snapshot_id: sha256(`${catalogVersion}:intent:${stableStringify({ intent, toolName, capabilityKey })}`),
    candidates: ranked.map((candidate) => ({
      tool: projectedDescriptor(candidate.descriptor),
      score: candidate.score,
      match_reasons: candidate.reasons,
      execution_allowed: false,
    })),
    selected_tool: status === "resolved" ? projectedDescriptor(ranked[0].descriptor) : null,
    execution_allowed: false,
    next_step: status === "resolved" ? "capability_preview" : status,
    secrets_included: false,
  };
}

export function auditSystemToolDescriptorRuntimeParity(tools = [], handlerRegistry = new Map()) {
  const descriptors = normalizeVisibleTools(tools);
  const hasHandler = (name) => handlerRegistry instanceof Map
    ? typeof handlerRegistry.get(name) === "function" || handlerRegistry.get(name)?.handler_present === true
    : typeof handlerRegistry?.[name] === "function" || handlerRegistry?.[name]?.handler_present === true;
  const missing = descriptors.filter((descriptor) => !hasHandler(descriptor.name)).map((descriptor) => descriptor.name);
  if (missing.length) bump("descriptor_runtime_mismatch", missing.length);
  return {
    ok: missing.length === 0,
    descriptor_count: descriptors.length,
    missing_handler_count: missing.length,
    missing_handlers: missing,
    secrets_included: false,
  };
}

export function getSystemToolCatalogObservability() {
  return {
    counters: { ...counters },
    observed_at: new Date().toISOString(),
    secrets_included: false,
  };
}

export function resetSystemToolCatalogObservabilityForTests() {
  for (const key of OBSERVABILITY_KEYS) counters[key] = 0;
}
