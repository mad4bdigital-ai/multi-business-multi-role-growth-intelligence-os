import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const GENERATED_CATALOG = JSON.parse(
  readFileSync(new URL("./remote-mcp-scope-catalog.generated.json", import.meta.url), "utf8"),
);

const FORBIDDEN_SCOPES = new Set(["admin", "full_access", "tools.execute"]);
const FORBIDDEN_BARE_SCOPES = new Set(["write"]);
const WRITE_EFFECT_CLASSES = new Set(["internal_write", "external_write", "destructive"]);
export const REMOTE_MCP_PER_SCOPE_PROMOTION_MARKER = "per_scope_promotion_v1";
const PER_SCOPE_PROMOTION_MARKER = REMOTE_MCP_PER_SCOPE_PROMOTION_MARKER;
const SCOPE_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/u;

function clone(value) {
  return structuredClone(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function validateScopeKey(scopeKey) {
  const normalized = String(scopeKey || "").trim();
  if (!SCOPE_PATTERN.test(normalized) || FORBIDDEN_SCOPES.has(normalized) || FORBIDDEN_BARE_SCOPES.has(normalized)) return false;
  return !normalized.split(".").some((segment) => FORBIDDEN_SCOPES.has(segment));
}

export function detectRemoteMcpScopeImplicationCycle(implications = []) {
  const graph = new Map();
  for (const implication of implications) {
    const from = String(implication?.scope_key || "").trim();
    const to = String(implication?.implies_scope_key || "").trim();
    if (!from || !to) continue;
    if (!graph.has(from)) graph.set(from, new Set());
    graph.get(from).add(to);
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of graph.get(node) || []) if (visit(next)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  }
  return [...graph.keys()].some(visit);
}

export function validateRemoteMcpScopeCatalog(catalog = GENERATED_CATALOG) {
  const scopes = Array.isArray(catalog?.scopes) ? catalog.scopes : [];
  const seenScopes = new Set();
  const errors = [];
  for (const scope of scopes) {
    const key = String(scope?.scope_key || "").trim();
    if (!validateScopeKey(key)) errors.push(`invalid_scope:${key || "missing"}`);
    if (seenScopes.has(key)) errors.push(`duplicate_scope:${key}`);
    seenScopes.add(key);
    const isWriteScope = WRITE_EFFECT_CLASSES.has(String(scope?.effect_class || ""));
    if (isWriteScope && scope?.default_request === true) errors.push(`write_scope_default_request_forbidden:${key}`);
    if (isWriteScope && ["active", "staging_active"].includes(String(scope?.status || ""))
      && String(scope?.promotion_marker || "") !== PER_SCOPE_PROMOTION_MARKER) {
      errors.push(`write_scope_promotion_marker_required:${key}`);
    }
  }

  const scopeSet = new Set(seenScopes);
  for (const implication of catalog?.implications || []) {
    const from = String(implication?.scope_key || "").trim();
    const to = String(implication?.implies_scope_key || "").trim();
    if (!scopeSet.has(from) || !scopeSet.has(to)) errors.push(`unknown_implication:${from}->${to}`);
    if (from === to) errors.push(`self_implication:${from}`);
  }
  if (detectRemoteMcpScopeImplicationCycle(catalog?.implications)) errors.push("scope_implication_cycle");

  const toolKeys = new Set();
  for (const binding of catalog?.tool_bindings || []) {
    const toolKey = String(binding?.tool_key || "").trim();
    if (!toolKey || toolKeys.has(toolKey)) errors.push(`duplicate_tool_binding:${toolKey || "missing"}`);
    toolKeys.add(toolKey);
    const bindingScopes = Array.isArray(binding?.scope_keys) ? binding.scope_keys : [];
    if (!bindingScopes.length) errors.push(`tool_binding_without_scope:${toolKey || "missing"}`);
    for (const scopeKey of bindingScopes) if (!scopeSet.has(scopeKey)) errors.push(`tool_binding_unknown_scope:${toolKey}:${scopeKey}`);
  }

  return { ok: errors.length === 0, errors, scope_count: scopes.length, tool_binding_count: toolKeys.size };
}

const validation = validateRemoteMcpScopeCatalog(GENERATED_CATALOG);
if (!validation.ok) throw new Error(`Invalid generated Remote MCP scope catalog: ${validation.errors.join(",")}`);

export const REMOTE_MCP_SCOPE_CATALOG = Object.freeze(clone(GENERATED_CATALOG));
export const REMOTE_MCP_SCOPES = Object.freeze(
  GENERATED_CATALOG.scopes.filter((scope) => scope.default_request === true).map((scope) => scope.scope_key),
);
export const REMOTE_MCP_SUPPORTED_SCOPES = Object.freeze(
  GENERATED_CATALOG.scopes
    .filter((scope) => scope.status === "active" && scope.effect_class === "read_only")
    .map((scope) => scope.scope_key),
);

export function getRemoteMcpScopeCatalog() {
  return clone(REMOTE_MCP_SCOPE_CATALOG);
}

export function getRemoteMcpCatalogFingerprint(catalog = REMOTE_MCP_SCOPE_CATALOG) {
  return fingerprint(catalog);
}

export function resolveRemoteMcpToolScopeBinding(toolKey, catalog = REMOTE_MCP_SCOPE_CATALOG) {
  const normalizedToolKey = String(toolKey || "").trim();
  const binding = (catalog.tool_bindings || []).find((candidate) => candidate.tool_key === normalizedToolKey);
  return binding ? clone(binding) : null;
}

export function normalizeRemoteMcpCatalogScopes(value, allowedScopes) {
  const requested = Array.isArray(value) ? value : String(value || "").split(/\s+/u);
  const allowed = new Set((allowedScopes || REMOTE_MCP_SCOPE_CATALOG.scopes.map((scope) => scope.scope_key))
    .map((scope) => String(scope || "").trim()).filter(Boolean));
  const normalized = [...new Set(requested.map((scope) => String(scope || "").trim()).filter(Boolean))];
  if (!normalized.length) return { ok: true, scopes: [...allowed] };
  const rejected = normalized.filter((scope) => !allowed.has(scope));
  return rejected.length ? { ok: false, scopes: [], rejected } : { ok: true, scopes: normalized };
}

export function getRemoteMcpCatalogReadback(catalog = REMOTE_MCP_SCOPE_CATALOG) {
  const validationResult = validateRemoteMcpScopeCatalog(catalog);
  const allToolKeys = new Set((catalog.tool_bindings || []).map((binding) => binding.tool_key));
  const boundOperationKeys = new Set((catalog.resource_operation_bindings || [])
    .filter((binding) => binding.scope_key)
    .map((binding) => `${binding.resource_key}:${binding.operation_key}`));
  return {
    catalog_ready: validationResult.ok,
    revision: catalog.revision || null,
    fingerprint: getRemoteMcpCatalogFingerprint(catalog),
    scope_count: (catalog.scopes || []).length,
    tool_binding_count: allToolKeys.size,
    unbound_tool_count: (catalog.exported_tool_keys || []).filter((key) => !allToolKeys.has(key)).length,
    unbound_operation_count: (catalog.eligible_operation_keys || []).filter((key) => !boundOperationKeys.has(key)).length,
    validation_errors: validationResult.errors,
    write_scope_default_request_count: (catalog.scopes || []).filter((scope) => (
      WRITE_EFFECT_CLASSES.has(String(scope?.effect_class || "")) && scope.default_request === true
    )).length,
    active_write_scope_count: (catalog.scopes || []).filter((scope) => (
      WRITE_EFFECT_CLASSES.has(String(scope?.effect_class || "")) && ["active", "staging_active"].includes(String(scope?.status || ""))
    )).length,
    secrets_included: false,
  };
}
