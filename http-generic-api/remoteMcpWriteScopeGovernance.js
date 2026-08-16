import { readFileSync } from "node:fs";
import {
  getRemoteMcpScopeCatalog,
  REMOTE_MCP_PER_SCOPE_PROMOTION_MARKER,
} from "./remoteMcpScopeCatalog.js";
import { evaluateSharedMutationPolicyDecision } from "./sharedMutationPolicy.js";

const WRITE_EFFECT_CLASSES = new Set(["internal_write", "external_write", "destructive"]);
const WRITE_SCOPE_ACTIVATION_STATUS = new Set(["staging_active", "active"]);

function isPerScopePromoted(scope) {
  return Boolean(
    scope
    && WRITE_SCOPE_ACTIVATION_STATUS.has(String(scope.status || ""))
    && String(scope.promotion_marker || "") === REMOTE_MCP_PER_SCOPE_PROMOTION_MARKER,
  );
}

function readSmartInventory() {
  try {
    return JSON.parse(readFileSync(new URL("./remote-mcp-write-scope-inventory.generated.json", import.meta.url), "utf8"));
  } catch {
    return null;
  }
}

function clone(value) {
  return structuredClone(value);
}

function normalizeScopes(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/\s+/u);
  return [...new Set(raw.map((scope) => String(scope || "").trim()).filter(Boolean))];
}

function isWriteScope(scope) {
  return WRITE_EFFECT_CLASSES.has(String(scope?.effect_class || ""));
}

function scopeCatalog(catalog) {
  return Array.isArray(catalog?.scopes) ? catalog.scopes : [];
}

export function listRemoteMcpWriteScopes(catalog = getRemoteMcpScopeCatalog()) {
  return scopeCatalog(catalog).filter(isWriteScope).map((scope) => clone(scope));
}

export function buildRemoteMcpWriteScopeReadback({
  env = process.env,
  catalog = getRemoteMcpScopeCatalog(),
} = {}) {
  const writes = listRemoteMcpWriteScopes(catalog);
  const inventory = readSmartInventory();
  const inventoryReady = inventory?.readiness?.inventory_ready === true;
  const explicitlyEnabled = String(env.REMOTE_MCP_WRITE_SCOPES_ENABLED || "")
    .trim().toLowerCase() === "true";
  const staging = String(env.REMOTE_MCP_ENVIRONMENT || "staging").trim().toLowerCase() === "staging";
  const approvalsReady = String(env.REMOTE_MCP_WRITE_APPROVALS_READY || "")
    .trim().toLowerCase() === "true";
  const capabilityReady = String(env.REMOTE_MCP_WRITE_CAPABILITY_ENVELOPE_READY || "")
    .trim().toLowerCase() === "true";
  const leaseReady = String(env.REMOTE_MCP_WRITE_LEASE_READY || "")
    .trim().toLowerCase() === "true";
  const globalGatesReady = explicitlyEnabled && staging && inventoryReady && approvalsReady && capabilityReady && leaseReady;
  const promotedWrites = writes.filter(isPerScopePromoted);
  const active = globalGatesReady && promotedWrites.length > 0;
  return {
    mode: active ? "staging_active" : "shadow",
    activation_requested: explicitlyEnabled,
    activation_ready: active,
    global_gates_ready: globalGatesReady,
    inventory_ready: inventoryReady,
    inventory_catalog_fingerprint: inventory?.catalog_fingerprint || null,
    classified_write_surface_count: inventory?.classified_write_surface_count || 0,
    classified_write_route_count: inventory?.classified_write_route_count || 0,
    unclassified_write_route_count: inventory?.unclassified_write_route_count || 0,
    intentionally_unmapped_write_route_count: inventory?.intentionally_unmapped_write_route_count || 0,
    sensitive_intentionally_unmapped_write_route_count: inventory?.sensitive_intentionally_unmapped_write_route_count || 0,
    migration_evidence_count: inventory?.migration_count || 0,
    db_registry_evidence_count: inventory?.registry_evidence_count || 0,
    environment: staging ? "staging" : String(env.REMOTE_MCP_ENVIRONMENT || "unknown").trim().toLowerCase(),
    approval_gate_ready: approvalsReady,
    capability_gate_ready: capabilityReady,
    lease_gate_ready: leaseReady,
    write_scopes: writes.map((scope) => clone(scope)),
    write_scope_count: writes.length,
    default_write_scope_count: writes.filter((scope) => scope.default_request === true).length,
    active_write_scope_count: active ? promotedWrites.length : 0,
    shadow_write_scope_count: writes.length - (active ? promotedWrites.length : 0),
    promoted_scope_keys: active ? promotedWrites.map((scope) => scope.scope_key) : [],
    provider_mutation_allowed: false,
    production_allowed: false,
    readback_required: true,
    secrets_included: false,
  };
}

export function evaluateRemoteMcpWriteScopeDecision({
  scopeKey,
  tokenScopes = [],
  resourceAuthority = false,
  operationEligible = false,
  approvalSatisfied = false,
  capabilitySatisfied = false,
  leaseActive = false,
  environment = "staging",
  catalog = getRemoteMcpScopeCatalog(),
  env = process.env,
} = {}) {
  const scope = scopeCatalog(catalog).find((candidate) => candidate.scope_key === scopeKey);
  const governance = buildRemoteMcpWriteScopeReadback({ env, catalog });
  const scopePromoted = isPerScopePromoted(scope);
  const tokenScopeSet = new Set(normalizeScopes(tokenScopes));
  const sharedDecision = evaluateSharedMutationPolicyDecision({
    transport: "mcp",
    method: "POST",
    path: `/mcp/tools/${scopeKey || "unregistered"}`,
    operationId: scopeKey || null,
    effectClass: scope?.effect_class || null,
    requiredScope: scopeKey,
    tokenScopes,
    resourceAuthority,
    operationEligible,
    approvalSatisfied,
    capabilitySatisfied,
    leaseActive,
    environment,
    governance,
  });
  return {
    ...sharedDecision,
    ok: sharedDecision.ok,
    code: sharedDecision.ok ? "MCP_WRITE_AUTHORIZATION_ALLOWED" : "MCP_WRITE_AUTHORIZATION_DENIED",
    scope_key: scopeKey || null,
    scope_promotion: {
      promoted: scopePromoted,
      status: scope?.status || null,
      marker: scope?.promotion_marker || null,
      required_marker: REMOTE_MCP_PER_SCOPE_PROMOTION_MARKER,
    },
  };
}
