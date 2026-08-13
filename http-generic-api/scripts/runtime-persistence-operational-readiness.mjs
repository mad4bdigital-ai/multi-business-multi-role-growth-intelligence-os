import { getRuntimePersistencePool } from "../db.js";
import { inspectRuntimePersistenceWriteAuthority } from "../runtimePersistenceWriteAuthority.js";
import { inspectGovernedResponseChunkSchema } from "../governedToolResponseChunkStore.js";

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
    const [authority, schema] = await Promise.all([
      inspectAuthority({ table: RUNTIME_PERSISTENCE_ACTIVATION_CONTRACT.table }, deps),
      inspectSchema(deps),
    ]);
    const ok = authority.ready === true && schema.ready === true;
    return {
      ok,
      status: ok ? "ready" : "blocked",
      reason: ok ? "runtime_persistence_ready" : "runtime_persistence_authority_or_schema_not_ready",
      configuration,
      authority,
      schema,
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
