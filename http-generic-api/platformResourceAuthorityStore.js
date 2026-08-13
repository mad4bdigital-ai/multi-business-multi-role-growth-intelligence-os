import { getGovernancePool } from "./governanceDb.js";

export const PLATFORM_RESOURCE_AUTHORITY_TABLE = "platform_resource_authority_bindings";
export const PLATFORM_RESOURCE_AUTHORITY_STORE_CONTRACT = Object.freeze({
  contract: "mad4b.platform-resource-authority-store.v1",
  owner: "governance_db",
  table: PLATFORM_RESOURCE_AUTHORITY_TABLE,
  runtime_pool_fallback_allowed: false,
  governance_identity_required: true,
  secrets_included: false,
});

function authorityStoreError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = { ...details, secrets_included: false };
  return error;
}

function isQueryExecutor(value) {
  return Boolean(value && typeof value.query === "function");
}

export function resolvePlatformResourceAuthorityPool(deps = {}) {
  const explicit = deps.authorityStorePool || deps.governancePool || deps.writerPool || deps.readerPool;
  if (explicit !== undefined && explicit !== null) {
    if (!isQueryExecutor(explicit)) {
      throw authorityStoreError(
        "PLATFORM_RESOURCE_AUTHORITY_EXECUTOR_INVALID",
        "The Governance Authority Store executor must expose a query method.",
        { contract: PLATFORM_RESOURCE_AUTHORITY_STORE_CONTRACT },
      );
    }
    return explicit;
  }
  return getGovernancePool();
}

export function assertPlatformResourceAuthorityStoreSource({ pool, runtimePool } = {}) {
  if (!isQueryExecutor(pool)) {
    throw authorityStoreError(
      "PLATFORM_RESOURCE_AUTHORITY_EXECUTOR_REQUIRED",
      "The Governance Authority Store requires an explicit query executor.",
      { contract: PLATFORM_RESOURCE_AUTHORITY_STORE_CONTRACT },
    );
  }
  if (runtimePool && pool === runtimePool) {
    throw authorityStoreError(
      "PLATFORM_RESOURCE_AUTHORITY_RUNTIME_POOL_FORBIDDEN",
      "The Runtime DB pool cannot serve as the Governance Authority Store executor.",
      { contract: PLATFORM_RESOURCE_AUTHORITY_STORE_CONTRACT },
    );
  }
  return {
    contract: PLATFORM_RESOURCE_AUTHORITY_STORE_CONTRACT.contract,
    owner: PLATFORM_RESOURCE_AUTHORITY_STORE_CONTRACT.owner,
    table: PLATFORM_RESOURCE_AUTHORITY_STORE_CONTRACT.table,
    source_verified: true,
    runtime_pool_fallback_allowed: false,
    secrets_included: false,
  };
}
