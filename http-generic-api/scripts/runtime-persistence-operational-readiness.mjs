import { getRuntimePersistencePool } from "../db.js";
import { inspectRuntimePersistenceWriteAuthority } from "../runtimePersistenceWriteAuthority.js";
import { inspectGovernedResponseChunkSchema } from "../governedToolResponseChunkStore.js";

export const RUNTIME_PERSISTENCE_COLLATION_POLICY = Object.freeze({
  character_set: "utf8mb4",
  table_collation: "utf8mb4_unicode_ci",
  json_allowed_collations: Object.freeze(["utf8mb4_bin", "utf8mb4_unicode_ci"]),
});

function isJsonLikeColumn(columnName = "") {
  return /(^|_)json$|_json$|json_/.test(String(columnName || ""));
}

export async function inspectRuntimePersistenceCollation({ runtimePersistencePool } = {}) {
  if (!runtimePersistencePool || typeof runtimePersistencePool.query !== "function") {
    return {
      ready: false,
      reason: "runtime_persistence_collation_pool_missing",
      policy: RUNTIME_PERSISTENCE_COLLATION_POLICY,
      violations: ["database_pool_missing"],
      secrets_included: false,
    };
  }

  try {
    const [databaseRows] = await runtimePersistencePool.query(
      "SELECT DEFAULT_CHARACTER_SET_NAME AS character_set_name, DEFAULT_COLLATION_NAME AS collation_name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()",
    );
    const [tableRows] = await runtimePersistencePool.query(
      "SELECT TABLE_NAME AS table_name, ENGINE AS engine, TABLE_COLLATION AS collation_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
      [RUNTIME_PERSISTENCE_ACTIVATION_CONTRACT.table],
    );
    const [columnRows] = await runtimePersistencePool.query(
      "SELECT COLUMN_NAME AS column_name, CHARACTER_SET_NAME AS character_set_name, COLLATION_NAME AS collation_name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CHARACTER_SET_NAME IS NOT NULL ORDER BY ORDINAL_POSITION",
      [RUNTIME_PERSISTENCE_ACTIVATION_CONTRACT.table],
    );

    const database = databaseRows?.[0] || null;
    const table = tableRows?.[0] || null;
    const violations = [];
    if (!database) violations.push("database_readback_missing");
    if (!table) violations.push("response_chunk_table_missing");
    if (database && database.character_set_name !== RUNTIME_PERSISTENCE_COLLATION_POLICY.character_set) {
      violations.push("database_character_set_mismatch");
    }
    if (database && database.collation_name !== RUNTIME_PERSISTENCE_COLLATION_POLICY.table_collation) {
      violations.push("database_default_collation_mismatch");
    }
    if (table && table.engine !== "InnoDB") violations.push("response_chunk_engine_mismatch");
    if (table && table.collation_name !== RUNTIME_PERSISTENCE_COLLATION_POLICY.table_collation) {
      violations.push("response_chunk_table_collation_mismatch");
    }
    for (const column of columnRows || []) {
      if (column.character_set_name !== RUNTIME_PERSISTENCE_COLLATION_POLICY.character_set) {
        violations.push(`column_character_set_mismatch:${column.column_name}`);
        continue;
      }
      const allowed = isJsonLikeColumn(column.column_name)
        ? RUNTIME_PERSISTENCE_COLLATION_POLICY.json_allowed_collations
        : [RUNTIME_PERSISTENCE_COLLATION_POLICY.table_collation];
      if (!allowed.includes(column.collation_name)) {
        violations.push(`column_collation_mismatch:${column.column_name}`);
      }
    }

    return {
      ready: violations.length === 0,
      reason: violations.length === 0 ? "runtime_persistence_collation_ready" : "runtime_persistence_collation_not_ready",
      policy: RUNTIME_PERSISTENCE_COLLATION_POLICY,
      database: database
        ? { present: true, character_set_name: database.character_set_name, collation_name: database.collation_name }
        : { present: false },
      table: table
        ? { present: true, engine: table.engine, collation_name: table.collation_name }
        : { present: false },
      character_columns_checked: (columnRows || []).length,
      violations,
      secrets_included: false,
    };
  } catch (error) {
    return {
      ready: false,
      reason: "runtime_persistence_collation_readback_failed",
      error_code: String(error?.code || "runtime_persistence_collation_readback_failed").slice(0, 128),
      policy: RUNTIME_PERSISTENCE_COLLATION_POLICY,
      violations: ["collation_readback_failed"],
      secrets_included: false,
    };
  }
}

export const RUNTIME_PERSISTENCE_ACTIVATION_CONTRACT = Object.freeze({
  contract: "mad4b.runtime-persistence-third-database-activation.v1",
  migration_file: "1048_transport_response_chunk_schema_recovery.sql",
  readiness_view: "v_governed_response_chunk_transport_schema_readiness",
  database_identity: "RUNTIME_PERSISTENCE_DB_*",
  table: "governed_tool_response_chunks",
  required_operations: Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]),
  provider_calls: 0,
  credential_payload_reads: 0,
  external_writes: 0,
  collation_policy: RUNTIME_PERSISTENCE_COLLATION_POLICY,
  secrets_included: false,
});

const REQUIRED_ENVIRONMENT_KEYS = Object.freeze([
  "RUNTIME_PERSISTENCE_DB_HOST",
  "RUNTIME_PERSISTENCE_DB_NAME",
  "RUNTIME_PERSISTENCE_DB_USER",
  "RUNTIME_PERSISTENCE_DB_PASSWORD",
]);

function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function inspectRuntimePersistenceConfiguration(env = process.env) {
  const missing = REQUIRED_ENVIRONMENT_KEYS.filter((key) => !present(env?.[key]));
  return {
    contract: RUNTIME_PERSISTENCE_ACTIVATION_CONTRACT.contract,
    configured: missing.length === 0,
    required_keys: [...REQUIRED_ENVIRONMENT_KEYS],
    missing_keys: missing,
    fallback_to_db_user: false,
    secrets_included: false,
  };
}

function normalizeError(error) {
  return {
    code: String(error?.code || "runtime_persistence_readiness_failed").slice(0, 128),
    status: Number.isInteger(error?.status) ? error.status : 503,
    secrets_included: false,
  };
}

export async function runRuntimePersistenceOperationalReadiness({
  env = process.env,
  runtimePersistencePoolFactory = getRuntimePersistencePool,
  inspectAuthority = inspectRuntimePersistenceWriteAuthority,
  inspectSchema = inspectGovernedResponseChunkSchema,
  inspectCollation = inspectRuntimePersistenceCollation,
} = {}) {
  const configuration = inspectRuntimePersistenceConfiguration(env);
  if (!configuration.configured) {
    return {
      ok: false,
      status: "blocked",
      reason: "runtime_persistence_configuration_missing",
      configuration,
      activation_contract: RUNTIME_PERSISTENCE_ACTIVATION_CONTRACT,
      provider_calls: 0,
      credential_payload_reads: 0,
      external_writes: 0,
      secrets_included: false,
    };
  }

  let pool;
  try {
    pool = runtimePersistencePoolFactory();
    const deps = { runtimePersistencePool: pool };
    const [authority, schema, collation] = await Promise.all([
      inspectAuthority({ table: RUNTIME_PERSISTENCE_ACTIVATION_CONTRACT.table }, deps),
      inspectSchema(deps),
      inspectCollation(deps),
    ]);
    const ok = authority.ready === true && schema.ready === true && collation.ready === true;
    return {
      ok,
      status: ok ? "ready" : "blocked",
      reason: ok ? "runtime_persistence_ready" : "runtime_persistence_authority_schema_or_collation_not_ready",
      configuration,
      authority,
      schema,
      collation,
      activation_contract: RUNTIME_PERSISTENCE_ACTIVATION_CONTRACT,
      provider_calls: 0,
      credential_payload_reads: 0,
      external_writes: 0,
      secrets_included: false,
    };
  } catch (error) {
    return {
      ok: false,
      status: "blocked",
      reason: "runtime_persistence_readiness_probe_failed",
      configuration,
      error: normalizeError(error),
      activation_contract: RUNTIME_PERSISTENCE_ACTIVATION_CONTRACT,
      provider_calls: 0,
      credential_payload_reads: 0,
      external_writes: 0,
      secrets_included: false,
    };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRuntimePersistenceOperationalReadiness()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        status: "blocked",
        reason: "runtime_persistence_readiness_probe_failed",
        error: normalizeError(error),
        secrets_included: false,
      })}\n`);
      process.exitCode = 1;
    });
}
