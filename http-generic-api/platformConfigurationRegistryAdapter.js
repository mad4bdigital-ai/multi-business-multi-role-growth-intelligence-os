import { randomUUID } from "node:crypto";
import { resolvePlatformConfiguration } from "./platformConfigurationResolver.js";

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function singleOrAmbiguous(rows, code) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (rows.length > 1) {
    const error = new Error(`${code}: multiple rows matched a unique lookup`);
    error.code = code;
    error.details = { row_count: rows.length, secrets_included: false };
    throw error;
  }
  const uniqueRow = rows.reduce((selected, candidate) => {
    if (selected !== undefined) throw new Error(`${code}: unique lookup proof failed`);
    return candidate;
  }, undefined);
  return uniqueRow;
}

function mapDefinition(row) {
  if (!row) return null;
  return {
    config_key: row.config_key,
    namespace: row.namespace,
    value_type: row.value_type,
    schema_version: Number(row.schema_version || 1),
    schema_json: parseJson(row.schema_json, {}),
    allowed_scope_types_json: parseJson(row.allowed_scope_types_json, []),
    merge_operator: row.merge_operator,
    risk_class: row.risk_class,
    mutability: row.mutability,
    fallback_policy: row.fallback_policy,
    owner_domain: row.owner_domain,
    status: row.status,
    revision: Number(row.revision || 0),
    source_contract: row.source_contract || null,
    secrets_included: false,
  };
}

function mapBinding(row) {
  return {
    binding_id: row.binding_id,
    config_key: row.config_key,
    source_registry: row.source_registry,
    source_ref: row.source_ref || null,
    scope_type: row.scope_type,
    scope_ref: row.scope_ref,
    precedence: Number(row.precedence || 0),
    payload_json: parseJson(row.payload_json, null),
    schema_version: Number(row.schema_version || 1),
    lifecycle: row.lifecycle,
    revision: Number(row.revision || 0),
    checksum_sha256: row.checksum_sha256 || null,
    approval_ref: row.approval_ref || null,
    effective_from: row.effective_from || null,
    effective_to: row.effective_to || null,
    secrets_included: Boolean(row.secrets_included),
  };
}

export function createPlatformConfigurationRegistryAdapter({ pool, legacyAdapter = null, resolver = resolvePlatformConfiguration, uuid = randomUUID, now = () => new Date() } = {}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A database pool is required.");

  async function getDefinition(configKey) {
    const [rows] = await pool.query(
      "SELECT * FROM platform_configuration_catalog WHERE config_key=? AND status IN ('active','deprecated')",
      [configKey],
    );
    return mapDefinition(singleOrAmbiguous(rows, "PLATFORM_CONFIG_DEFINITION_AMBIGUOUS"));
  }

  async function listBindings(configKey) {
    const [rows] = await pool.query(
      "SELECT * FROM platform_configuration_bindings WHERE config_key=? AND lifecycle='active' ORDER BY precedence ASC, binding_id ASC",
      [configKey],
    );
    return (Array.isArray(rows) ? rows : []).map(mapBinding);
  }

  async function recordResolutionEvidence({ configKey, result }) {
    const evidenceId = uuid();
    await pool.query(
      `INSERT INTO platform_configuration_resolution_evidence
        (evidence_id,config_key,context_hash,resolved_checksum,decision,lineage_json,conflicts_json,resolver_version,observed_at,secrets_included)
       VALUES (?,?,?,?,?,?,?,?,?,0)`,
      [
        evidenceId,
        configKey,
        result.context_hash,
        result.resolved_checksum,
        result.decision,
        JSON.stringify(result.lineage || []),
        JSON.stringify(result.conflicts || []),
        result.resolver_version,
        now(),
      ],
    );
    return { evidence_id: evidenceId, recorded: true, secrets_included: false };
  }

  async function resolve({ configKey, context = {}, legacyValue, fallbackValue } = {}) {
    const definition = await getDefinition(configKey);
    if (!definition) {
      const result = resolver({ definition: null, bindings: [], context, legacyValue, fallbackValue, now: now() });
      return { result, evidence: null };
    }
    const bindings = await listBindings(configKey);
    let compatibilityValue = legacyValue;
    if (compatibilityValue === undefined && definition.fallback_policy === "legacy_compatibility" && legacyAdapter?.read) {
      const legacy = await legacyAdapter.read(configKey);
      if (legacy.present) compatibilityValue = legacy.value;
    }
    const result = resolver({ definition, bindings, context, legacyValue: compatibilityValue, fallbackValue, now: now() });
    const evidence = await recordResolutionEvidence({ configKey, result });
    return { result, evidence };
  }

  return Object.freeze({ getDefinition, listBindings, recordResolutionEvidence, resolve });
}

export const __test__ = Object.freeze({ parseJson, singleOrAmbiguous, mapDefinition, mapBinding });
