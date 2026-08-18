import { getPool } from "./db.js";

export const MCP_CATALOG_LEVEL_MIGRATION = "20260815_custom_gpt_mcp_catalog_levels.sql";
export const MCP_CATALOG_LEVEL_MIGRATION_SHA256 = "528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681";
export const MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT = Object.freeze({
  database_role: "runtime",
  database_name_env: "DB_NAME",
  principal_env: "DB_USER",
  required_field: "mcp_catalog_level",
  migration: MCP_CATALOG_LEVEL_MIGRATION,
  migration_checksum_sha256: MCP_CATALOG_LEVEL_MIGRATION_SHA256,
  secrets_included: false,
});
export const MCP_CATALOG_TABLES = Object.freeze([
  "admin_platform_endpoint_tools",
  "tenant_platform_endpoint_tools",
]);
export const MCP_CATALOG_LEVEL_COLUMN = "mcp_catalog_level";

const schemaCache = new WeakMap();
const CACHE_TTL_MS = 30_000;

function schemaError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = {
    ...details,
    migration: MCP_CATALOG_LEVEL_MIGRATION,
    table: details.table || null,
    column: MCP_CATALOG_LEVEL_COLUMN,
    migration_apply_required: true,
    secrets_included: false,
  };
  return error;
}

function cacheFor(pool) {
  let cache = schemaCache.get(pool);
  if (!cache) {
    cache = new Map();
    schemaCache.set(pool, cache);
  }
  return cache;
}

function readOnlyEvidence({ databaseConnectionPerformed = false, sqlReadbackPerformed = false } = {}) {
  return {
    read_only_probe: true,
    database_connection_performed: databaseConnectionPerformed === true,
    sql_readback_performed: sqlReadbackPerformed === true,
    sql_mutation_performed: false,
    migration_apply_performed: false,
    provider_mutation_performed: false,
    deployment_performed: false,
  };
}

export async function readMcpCatalogRuntimeIdentity({ pool, env = process.env } = {}) {
  if (!pool || typeof pool.query !== "function") {
    return {
      ok: false,
      code: "DB_CONFIG_MISSING",
      database_role: MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT.database_role,
      database_name_env: MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT.database_name_env,
      principal_env: MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT.principal_env,
      configured_database_present: false,
      configured_principal_present: false,
      observed_database_present: false,
      observed_principal_present: false,
      database_matches: false,
      principal_matches: false,
      identity_readback_performed: false,
      secrets_included: false,
    };
  }
  const expectedDatabase = String(env?.DB_NAME || "").trim();
  const expectedPrincipal = String(env?.DB_USER || "").trim();
  try {
    const [rows] = await pool.query(
      "SELECT DATABASE() AS current_database, CURRENT_USER() AS current_account",
    );
    const currentDatabase = String(rows?.[0]?.current_database || "").trim();
    const currentAccount = String(rows?.[0]?.current_account || "").trim();
    const databaseMatches = expectedDatabase ? currentDatabase === expectedDatabase : null;
    const observedPrincipal = currentAccount.split("@", 1)[0].replace(/[`'"]+/gu, "").trim();
    const principalMatches = expectedPrincipal ? observedPrincipal === expectedPrincipal : null;
    const ready = Boolean(expectedDatabase && expectedPrincipal && currentDatabase && currentAccount)
      && databaseMatches === true
      && principalMatches === true;
    return {
      ok: ready,
      code: ready
        ? null
        : (!expectedDatabase || !expectedPrincipal
          ? "MCP_CATALOG_RUNTIME_IDENTITY_CONFIG_MISSING"
          : (databaseMatches === false
            ? "MCP_CATALOG_RUNTIME_DATABASE_MISMATCH"
            : (principalMatches === false ? "MCP_CATALOG_RUNTIME_PRINCIPAL_MISMATCH" : "MCP_CATALOG_RUNTIME_IDENTITY_UNAVAILABLE"))),
      database_role: MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT.database_role,
      database_name_env: MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT.database_name_env,
      principal_env: MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT.principal_env,
      configured_database_present: Boolean(expectedDatabase),
      configured_principal_present: Boolean(expectedPrincipal),
      observed_database_present: Boolean(currentDatabase),
      observed_principal_present: Boolean(currentAccount),
      database_matches: databaseMatches,
      principal_matches: principalMatches,
      identity_readback_performed: true,
      secrets_included: false,
    };
  } catch (error) {
    return {
      ok: false,
      code: String(error?.code || error?.errno || "MCP_CATALOG_RUNTIME_IDENTITY_UNAVAILABLE").slice(0, 128),
      database_role: MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT.database_role,
      database_name_env: MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT.database_name_env,
      principal_env: MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT.principal_env,
      configured_database_present: Boolean(expectedDatabase),
      configured_principal_present: Boolean(expectedPrincipal),
      observed_database_present: false,
      observed_principal_present: false,
      database_matches: expectedDatabase ? false : null,
      principal_matches: expectedPrincipal ? false : null,
      identity_readback_performed: true,
      secrets_included: false,
    };
  }
}

export function buildMcpCatalogSchemaMigrationRequiredError({ table = null, originalErrorCode = null } = {}) {
  return schemaError("mcp_catalog_schema_migration_required", "MCP catalog schema is missing mcp_catalog_level; apply the governed migration before serving the catalog.", {
    table,
    original_error_code: originalErrorCode,
  });
}

export async function readMcpCatalogLevelSchemaStatus({ pool = getPool(), table } = {}) {
  const normalizedTable = String(table || "").trim();
  if (!MCP_CATALOG_TABLES.includes(normalizedTable)) {
    throw schemaError("mcp_catalog_table_invalid", "The requested MCP catalog table is not governed.", { table: normalizedTable });
  }
  const cache = cacheFor(pool);
  const cached = cache.get(normalizedTable);
  if (cached && cached.expires_at > Date.now()) return cached.status;

  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS column_count
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?`,
      [normalizedTable, MCP_CATALOG_LEVEL_COLUMN],
    );
    const available = Number(rows?.[0]?.column_count || 0) > 0;
    const status = {
      ...MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT,
      ok: available,
      table: normalizedTable,
      column: MCP_CATALOG_LEVEL_COLUMN,
      available,
      migration_apply_required: !available,
      secrets_included: false,
    };
    cache.set(normalizedTable, { expires_at: Date.now() + CACHE_TTL_MS, status });
    return status;
  } catch (error) {
    throw schemaError("mcp_catalog_schema_metadata_unavailable", "MCP catalog schema metadata could not be read.", {
      table: normalizedTable,
      original_error_code: String(error?.code || error?.errno || "schema_metadata_unavailable").slice(0, 128),
    });
  }
}

export async function assertMcpCatalogLevelColumn({ pool = getPool(), table } = {}) {
  const status = await readMcpCatalogLevelSchemaStatus({ pool, table });
  if (!status.available) {
    throw buildMcpCatalogSchemaMigrationRequiredError({
      table: status.table,
      originalErrorCode: status.code || null,
    });
  }
  return status;
}

export async function readMcpCatalogSchemaReadiness({ pool = null } = {}) {
  if (!pool) {
    return {
      ...MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT,
      ok: false,
      tables: MCP_CATALOG_TABLES.map((table) => ({
        ok: false,
        table,
        column: MCP_CATALOG_LEVEL_COLUMN,
        available: false,
        code: "DB_CONFIG_MISSING",
        migration: MCP_CATALOG_LEVEL_MIGRATION,
        migration_apply_required: true,
        secrets_included: false,
      })),
      migration_apply_required: true,
      secrets_included: false,
    };
  }
  const tables = [];
  for (const table of MCP_CATALOG_TABLES) {
    try {
      tables.push(await readMcpCatalogLevelSchemaStatus({ pool, table }));
    } catch (error) {
      tables.push({
        ok: false,
        table,
        column: MCP_CATALOG_LEVEL_COLUMN,
        available: false,
        code: error.code || "mcp_catalog_schema_metadata_unavailable",
        migration: MCP_CATALOG_LEVEL_MIGRATION,
        migration_apply_required: true,
        secrets_included: false,
      });
    }
  }
  return {
    ok: tables.every((item) => item.available === true),
    migration: MCP_CATALOG_LEVEL_MIGRATION,
    tables,
    migration_apply_required: tables.some((item) => item.available !== true),
    secrets_included: false,
  };
}

const mcpCatalogSchemaStartupPreflightState = {
  contract: "mad4b.mcp-catalog-schema-startup-preflight.v1",
  status: "not_run",
  ready: false,
  startup_blocked: false,
  database_connection_performed: false,
  sql_readback_performed: false,
  migration_apply_performed: false,
  database_mutation_performed: false,
  readiness: null,
  secrets_included: false,
};

function boundedSchemaErrorCode(error, fallback = "mcp_catalog_schema_metadata_unavailable") {
  const value = String(error?.code || error?.errno || fallback).trim();
  return value.slice(0, 128) || fallback;
}

function unavailableSchemaReadiness(error) {
  const originalErrorCode = boundedSchemaErrorCode(error);
  return {
    ok: false,
    ...MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT,
    identity: {
      ok: false,
      code: originalErrorCode,
      database_role: MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT.database_role,
      database_name_env: MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT.database_name_env,
      principal_env: MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT.principal_env,
      configured_database_present: false,
      configured_principal_present: false,
      observed_database_present: false,
      observed_principal_present: false,
      database_matches: false,
      principal_matches: false,
      identity_readback_performed: false,
      secrets_included: false,
    },
    tables: MCP_CATALOG_TABLES.map((table) => ({
      ...MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT,
      ok: false,
      table,
      column: MCP_CATALOG_LEVEL_COLUMN,
      available: false,
      code: "mcp_catalog_schema_metadata_unavailable",
      original_error_code: originalErrorCode,
      migration: MCP_CATALOG_LEVEL_MIGRATION,
      migration_apply_required: true,
      secrets_included: false,
    })),
    migration_apply_required: true,
    ...readOnlyEvidence(),
    secrets_included: false,
  };
}

export async function readMcpCatalogSchemaReadinessSafe({ pool, env = process.env } = {}) {
  try {
    const targetPool = pool || getPool();
    const identity = await readMcpCatalogRuntimeIdentity({ pool: targetPool, env });
    const readiness = await readMcpCatalogSchemaReadiness({ pool: targetPool });
    return {
      ...readiness,
      ...MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT,
      ok: readiness.ok === true && identity.ok === true,
      identity,
      ...readOnlyEvidence({ databaseConnectionPerformed: true, sqlReadbackPerformed: true }),
      secrets_included: false,
    };
  } catch (error) {
    return unavailableSchemaReadiness(error);
  }
}

export function getMcpCatalogSchemaStartupPreflight() {
  return JSON.parse(JSON.stringify(mcpCatalogSchemaStartupPreflightState));
}

export async function runMcpCatalogSchemaStartupPreflight({ pool, logger = console, environment = "unknown", env = process.env } = {}) {
  const targetPool = pool || (() => {
    try {
      return getPool();
    } catch {
      return null;
    }
  })();
  const readiness = targetPool
    ? await readMcpCatalogSchemaReadinessSafe({ pool: targetPool, env })
    : unavailableSchemaReadiness({ code: "DB_CONFIG_MISSING" });
  const result = {
    contract: "mad4b.mcp-catalog-schema-startup-preflight.v1",
    environment: String(environment || "unknown"),
    status: readiness.ok ? "ready" : "schema_contract_not_ready",
    ready: readiness.ok === true,
    startup_blocked: false,
    database_connection_performed: readiness.database_connection_performed === true,
    sql_readback_performed: readiness.sql_readback_performed === true,
    migration_apply_performed: false,
    database_mutation_performed: false,
    readiness,
    secrets_included: false,
  };
  Object.keys(mcpCatalogSchemaStartupPreflightState).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(result, key)) mcpCatalogSchemaStartupPreflightState[key] = result[key];
  });
  const event = { event: "mcp_catalog_schema_startup_preflight", ...result, secrets_included: false };
  if (result.ready) logger.log?.(JSON.stringify(event));
  else logger.warn?.(JSON.stringify(event));
  return getMcpCatalogSchemaStartupPreflight();
}

export function isMcpCatalogSchemaNotReadyError(error) {
  return [
    "mcp_catalog_schema_migration_required",
    "mcp_catalog_schema_metadata_unavailable",
    "MCP_CATALOG_SCHEMA_DRIFT",
    "MCP_CATALOG_LEVEL_COLUMN_MISSING",
    "MCP_CATALOG_SCHEMA_MIGRATION_UNVERIFIED",
  ].includes(String(error?.code || ""));
}

export function buildMcpCatalogSchemaNotReadyResponse(error = {}) {
  return {
    code: "schema_contract_not_ready",
    message: "MCP catalog schema is not ready; apply the governed migration before serving catalog operations.",
    details: {
      ...MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT,
      table: String(error?.details?.table || "") || null,
      column: MCP_CATALOG_LEVEL_COLUMN,
      migration_apply_required: true,
      original_error_code: boundedSchemaErrorCode(error, "mcp_catalog_schema_migration_required"),
      secrets_included: false,
    },
    secrets_included: false,
  };
}
