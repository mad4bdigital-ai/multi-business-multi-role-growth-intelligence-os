import { getPool } from "./db.js";

export const LEGACY_ACTIVATION_CANONICAL_REFERENCES = Object.freeze([
  "AI_Agent_Knowledge_Guide.md",
  "system_bootstrap.md",
  "memory_schema.json",
  "direct_instructions_registry_patch.md",
  "module_loader.md",
  "prompt_router.md",
]);

function text(value = "") {
  return String(value ?? "").trim();
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function environmentScope(options = {}) {
  const requested = text(options.environment_scope || options.environmentScope).toLowerCase();
  if (["staging", "production"].includes(requested)) return requested;
  return text(process.env.RUNTIME_ENVIRONMENT || process.env.NODE_ENV).toLowerCase() === "production" ? "production" : "staging";
}

function legacyRows() {
  return LEGACY_ACTIVATION_CANONICAL_REFERENCES.map((path, index) => ({
    resource_key: `legacy_activation_${index + 1}`,
    path,
    resource_type: path.endsWith(".json") ? "schema" : "document",
    resource_class: "runtime_critical",
    load_strategy: "load_at_activation",
    validation_strategy: path.endsWith(".json") ? "json_valid" : "exists_nonempty",
    required_at_activation: true,
    searchable: path !== "memory_schema.json",
    environment_scope: "all",
    registry_revision: 0,
    metadata: { legacy_fallback: true },
  }));
}

function normalizeRow(row = {}) {
  return {
    resource_key: text(row.resource_key),
    path: text(row.path),
    resource_type: text(row.resource_type) || "document",
    resource_class: text(row.resource_class) || "on_demand_searchable",
    load_strategy: text(row.load_strategy) || "on_demand_search",
    validation_strategy: text(row.validation_strategy) || "exists_nonempty",
    required_at_activation: Boolean(Number(row.required_at_activation)),
    searchable: Boolean(Number(row.searchable)),
    environment_scope: text(row.environment_scope) || "all",
    registry_revision: Number(row.registry_revision || 0),
    updated_at: row.updated_at || null,
    metadata: safeJson(row.metadata_json, {}),
  };
}

export async function resolveCanonicalResourceRegistry(options = {}, deps = {}) {
  const scope = environmentScope(options);
  const pool = deps.pool || getPool();
  try {
    const [rows] = await pool.query(
      `SELECT resource_key, path, resource_type, resource_class, load_strategy, validation_strategy,
              required_at_activation, searchable, environment_scope, registry_revision, metadata_json, updated_at
         FROM canonical_resource_registry
        WHERE enabled = 1
          AND (environment_scope = 'all' OR environment_scope = ?)
        ORDER BY required_at_activation DESC, resource_class, resource_key`,
      [scope],
    );
    const resources = (rows || []).map(normalizeRow).filter((row) => row.resource_key && row.path);
    const activationResources = resources.filter((row) => row.required_at_activation);
    if (!activationResources.length) {
      return {
        ok: false,
        source: "sql_canonical_resource_registry",
        reason_code: "canonical_resource_registry_activation_set_empty",
        environment_scope: scope,
        resources,
        activation_resources: [],
        searchable_resources: resources.filter((row) => row.searchable),
        registry_revision: Math.max(0, ...resources.map((row) => row.registry_revision)),
        legacy_fallback_available: true,
        secrets_included: false,
      };
    }
    return {
      ok: true,
      source: "sql_canonical_resource_registry",
      reason_code: null,
      environment_scope: scope,
      resources,
      activation_resources: activationResources,
      searchable_resources: resources.filter((row) => row.searchable),
      registry_revision: Math.max(0, ...resources.map((row) => row.registry_revision)),
      legacy_fallback_used: false,
      secrets_included: false,
    };
  } catch (error) {
    if (!/doesn't exist|ER_NO_SUCH_TABLE|unknown table/i.test(String(error?.message || ""))) throw error;
    const resources = legacyRows();
    return {
      ok: true,
      source: "legacy_fixed_reference_fallback",
      reason_code: "canonical_resource_registry_not_migrated",
      environment_scope: scope,
      resources,
      activation_resources: resources,
      searchable_resources: resources.filter((row) => row.searchable),
      registry_revision: 0,
      legacy_fallback_used: true,
      parity_required_before_fallback_retirement: true,
      secrets_included: false,
    };
  }
}

export async function resolveActivationCanonicalReferences(options = {}, deps = {}) {
  const registry = await resolveCanonicalResourceRegistry(options, deps);
  if (registry.ok && registry.activation_resources.length) {
    return {
      ...registry,
      references: registry.activation_resources.map((row) => row.path),
      resource_contracts: registry.activation_resources,
    };
  }
  const resources = legacyRows();
  return {
    ...registry,
    ok: true,
    source: "legacy_fixed_reference_fallback",
    reason_code: registry.reason_code || "canonical_resource_registry_not_ready",
    references: resources.map((row) => row.path),
    resource_contracts: resources,
    legacy_fallback_used: true,
    parity_required_before_fallback_retirement: true,
    secrets_included: false,
  };
}
