import { getPool } from "../../../db.js";

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

export function createGrowthControlShadowParityRepository({
  pool = null,
  resolvePool = async () => getPool()
} = {}) {
  if (pool != null && typeof pool.query !== "function") {
    throw new TypeError("The provided Growth Control shadow parity SQL pool is invalid.");
  }

  async function executor() {
    const resolved = pool || await resolvePool();
    if (!resolved || typeof resolved.query !== "function") {
      throw new Error("A SQL pool is required for Growth Control shadow parity.");
    }
    return resolved;
  }

  async function getMapping(growthConfigKey) {
    const db = await executor();
    const [rows] = await db.query(
      `SELECT
         growth_config_key AS growthConfigKey,
         legacy_config_key AS legacyConfigKey,
         growth_path AS growthPath,
         legacy_path AS legacyPath,
         privilege_paths_json AS privilegePathsJson,
         expected_difference AS expectedDifference
       FROM growth_control_shadow_parity_mappings
       WHERE growth_config_key = ?
         AND status = 'active'
       LIMIT 1`,
      [growthConfigKey]
    );
    const row = rows?.[0];
    if (!row) return null;
    return Object.freeze({
      growthConfigKey: row.growthConfigKey,
      legacyConfigKey: row.legacyConfigKey,
      growthPath: row.growthPath || "",
      legacyPath: row.legacyPath || "",
      privilegePaths: Array.isArray(parseJson(row.privilegePathsJson, []))
        ? parseJson(row.privilegePathsJson, []).map(String).slice(0, 64)
        : [],
      expectedDifference: row.expectedDifference || null
    });
  }

  async function readLegacyRuntimeConfig(legacyConfigKey) {
    const db = await executor();
    const [rows] = await db.query(
      `SELECT config_json AS configJson, updated_at AS updatedAt
       FROM platform_runtime_config
       WHERE config_key = ?
         AND status = 'active'
       LIMIT 1`,
      [legacyConfigKey]
    );
    const row = rows?.[0];
    if (!row) return null;
    const value = parseJson(row.configJson, undefined);
    if (value === undefined) return null;
    return Object.freeze({ value, updatedAt: row.updatedAt || null });
  }

  async function recordEvidence(evidence) {
    const db = await executor();
    await db.query(
      `INSERT INTO growth_control_shadow_parity_evidence (
         evidence_id, resolution_id, tenant_id, workspace_id, brand_key,
         growth_config_key, legacy_config_key,
         growth_hash, legacy_hash, normalized_growth_hash, normalized_legacy_hash,
         classification, severity, action, explanation_code,
         compared_paths_json, blocks_cutover, latency_ms, observed_at,
         provider_apply_allowed, external_write_allowed, mutation_allowed,
         enforcement_cutover, secrets_included, raw_payload_included, prompt_included
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evidence.evidenceId,
        evidence.resolutionId,
        evidence.tenantId,
        evidence.workspaceId,
        evidence.brandKey,
        evidence.growthConfigKey,
        evidence.legacyConfigKey,
        evidence.growthHash,
        evidence.legacyHash,
        evidence.normalizedGrowthHash,
        evidence.normalizedLegacyHash,
        evidence.classification,
        evidence.severity,
        evidence.action,
        evidence.explanationCode,
        JSON.stringify(evidence.comparedPaths || []),
        evidence.blocksCutover ? 1 : 0,
        evidence.latencyMs,
        evidence.observedAt,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    );
    return Object.freeze({ evidenceId: evidence.evidenceId, recorded: true });
  }

  return Object.freeze({ getMapping, readLegacyRuntimeConfig, recordEvidence });
}

export const _testingGrowthControlShadowParityRepository = Object.freeze({ parseJson });
