import { readFileSync } from "node:fs";
import { getRemoteMcpScopeCatalog } from "./remoteMcpScopeCatalog.js";

const GENERATED_ARCHITECTURE = JSON.parse(
  readFileSync(new URL("./remote-mcp-write-governance-reference-architecture.generated.json", import.meta.url), "utf8"),
);

function clone(value) {
  return structuredClone(value);
}

export function getRemoteMcpReferenceArchitecture() {
  return clone(GENERATED_ARCHITECTURE);
}

export function validateRemoteMcpReferenceArchitecture({
  architecture = GENERATED_ARCHITECTURE,
  catalog = getRemoteMcpScopeCatalog(),
} = {}) {
  const errors = [];
  const layers = Array.isArray(architecture?.layers) ? architecture.layers : [];
  const layerIds = new Set();
  for (const layer of layers) {
    if (!layer?.id || layerIds.has(layer.id)) errors.push(`duplicate_layer:${layer?.id || "missing"}`);
    layerIds.add(layer?.id);
  }
  if (layers.length < 10) errors.push("architecture_layers_incomplete");
  const requiredLayers = new Set(["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9"]);
  for (const id of requiredLayers) if (!layerIds.has(id)) errors.push(`missing_layer:${id}`);

  const defaults = architecture?.default_policy || {};
  for (const key of ["write_scope_default_request", "provider_mutation_allowed", "migration_apply_allowed", "production_allowed", "secrets_included"]) {
    if (defaults[key] !== false) errors.push(`unsafe_default:${key}`);
  }

  const requiredGates = architecture?.decision_contract?.required_gates || [];
  for (const gate of ["inventory", "scope_registration", "resource_authority", "operation_eligibility", "approval", "capability", "lease", "environment", "readback"]) {
    if (!requiredGates.includes(gate)) errors.push(`missing_gate:${gate}`);
  }

  const catalogWriteScopes = new Set((catalog.scopes || [])
    .filter((scope) => scope.effect_class !== "read_only")
    .map((scope) => scope.scope_key));
  const architectureWriteScopes = new Set((architecture.shadow_write_scopes || []).map((scope) => scope.scope_key));
  for (const scopeKey of catalogWriteScopes) {
    if (!architectureWriteScopes.has(scopeKey)) errors.push(`architecture_missing_write_scope:${scopeKey}`);
  }
  for (const scopeKey of architectureWriteScopes) {
    if (!catalogWriteScopes.has(scopeKey)) errors.push(`catalog_missing_write_scope:${scopeKey}`);
  }

  for (const invariant of [
    "no_default_write_scope",
    "shadow_write_scope_is_not_exported",
    "unbound_route_is_not_an_mcp_tool",
    "catalog_db_fingerprint_must_match",
    "missing_approval_denies",
    "missing_capability_denies",
    "missing_lease_denies",
    "non_staging_environment_denies",
    "insufficient_readback_does_not_complete",
    "provider_adapter_cannot_override_decision",
    "production_is_not_allowed_by_default",
  ]) {
    if (!(architecture.acceptance_invariants || []).includes(invariant)) errors.push(`missing_invariant:${invariant}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    architecture_revision: architecture.architecture_revision || null,
    layer_count: layers.length,
    write_scope_count: architectureWriteScopes.size,
    provider_adapter_count: (architecture.provider_adapters || []).length,
    secrets_included: false,
  };
}

const validation = validateRemoteMcpReferenceArchitecture();
if (!validation.ok) throw new Error(`Invalid Remote MCP reference architecture: ${validation.errors.join(",")}`);

export function buildRemoteMcpReferenceArchitectureReadback(options = {}) {
  const result = validateRemoteMcpReferenceArchitecture(options);
  return {
    ...result,
    status: result.ok ? "ready_for_shadow_implementation" : "blocked",
    provider_mutation_allowed: false,
    production_allowed: false,
    migration_apply_allowed: false,
    secrets_included: false,
  };
}
