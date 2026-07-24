import { createOperationRuntimeContractLoader } from "./operationRuntimeContractLoader.js";
import { getOperationContract, normalizeOperationKey } from "./operationContractRegistry.js";
import { evaluateCapabilityKillSwitch } from "./capabilityKillSwitchPolicy.js";
import { stableOperationHash } from "./operationRegistryContracts.js";

const OPERATION_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{2,190}$/;
const TRANSIENT_SQL_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "PROTOCOL_CONNECTION_LOST",
  "ER_CON_COUNT_ERROR",
  "ER_LOCK_WAIT_TIMEOUT",
  "ER_LOCK_DEADLOCK",
  "SERVICE_UNAVAILABLE",
  "DEPENDENCY_UNAVAILABLE"
]);
const FALLBACK_SURFACE = "operation_contract_code_fallback";
const FALLBACK_ACTION = "use";
const LEGACY_FALLBACK_VERSION = 1;

export class OperationRuntimeContractResolverError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationRuntimeContractResolverError";
    this.code = code;
    this.status = status;
    this.details = { ...details, secrets_included: false };
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationRuntimeContractResolverError(code, message, status, details);
}

function normalizeIdentity(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("operation_runtime_contract_resolver_invalid_input", "input must be an object.");
  }
  const allowed = new Set(["operation_key", "version"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      fail("operation_runtime_contract_resolver_unknown_field", `input.${key} is not supported.`, 400, { field: `input.${key}` });
    }
  }
  const operationKey = String(input.operation_key || "").trim().toLowerCase();
  const version = Number(input.version);
  if (!OPERATION_KEY_PATTERN.test(operationKey)) {
    fail("operation_runtime_contract_resolver_invalid_operation_key", "input.operation_key is invalid.", 400, { field: "input.operation_key" });
  }
  if (!Number.isInteger(version) || version < 1) {
    fail("operation_runtime_contract_resolver_invalid_version", "input.version must be a positive integer.", 400, { field: "input.version" });
  }
  return { operation_key: operationKey, version };
}

function cloneValue(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function classifySqlFailure(error) {
  const code = String(error?.code || "").trim();
  const status = Number(error?.status || 0);
  if (code === "operation_runtime_contract_not_found") {
    return { eligible: true, classification: "migration_gap", code, status: status || 404, retryable: false };
  }
  if (TRANSIENT_SQL_CODES.has(code) || status === 503 || status === 504) {
    return { eligible: true, classification: "sql_unavailable", code: code || "SQL_UNAVAILABLE", status: status || 503, retryable: true };
  }
  return { eligible: false, classification: "non_fallback_error", code: code || null, status: status || null, retryable: false };
}

function boundedSwitchEvidence(decision) {
  return {
    blocked: Boolean(decision?.blocked),
    switch_enabled: Boolean(decision?.switch_enabled),
    switch_key: decision?.switch_key || null,
    env_var: decision?.env_var || null,
    surface: decision?.surface || null,
    action: decision?.action || null,
    mutation: Boolean(decision?.mutation),
    gated_action: Boolean(decision?.gated_action),
    secrets_included: false
  };
}

function makeSqlReport(sqlReport) {
  if (!sqlReport?.ok || !sqlReport.contract || sqlReport.fallback_used === true) {
    fail("operation_runtime_contract_sql_result_invalid", "The SQL runtime contract loader returned an invalid success result.", 500);
  }
  return {
    ok: true,
    report_type: "operation_runtime_contract_resolve",
    operation_key: sqlReport.operation_key,
    version: sqlReport.version,
    revision_hash: sqlReport.revision_hash,
    resolution_source: "sql_operation_registry",
    contract_kind: "sql_runtime_contract",
    contract: sqlReport.contract,
    cache: sqlReport.cache || null,
    fallback_used: false,
    fallback_reason: null,
    fallback_switch: null,
    sql_authority_primary: true,
    legacy_code_authority_temporary: false,
    read_only: true,
    database_writes_performed: false,
    provider_calls_performed: false,
    external_writes_performed: false,
    runtime_activation_changed: false,
    secrets_included: false
  };
}

function makeFallbackContract(staticContract, version) {
  const canonical = cloneValue(staticContract);
  const revisionHash = stableOperationHash({
    schema_version: "legacy-operation-contract-v1",
    version,
    contract: canonical
  });
  return deepFreeze({
    operation_key: canonical.operation_key,
    version,
    revision_hash: revisionHash,
    definition: canonical,
    source: "legacy_code_registry",
    read_only: true,
    secrets_included: false
  });
}

function dependencies(options = {}) {
  const sqlLoader = options.sql_loader || createOperationRuntimeContractLoader(options.loader_options || {});
  return {
    loadSql: typeof options.load_sql === "function" ? options.load_sql : (input) => sqlLoader.load(input),
    getStaticContract: options.get_static_contract || getOperationContract,
    evaluateKillSwitch: options.evaluate_kill_switch || evaluateCapabilityKillSwitch,
    env: options.env || process.env
  };
}

export function createOperationRuntimeContractResolver(options = {}) {
  const resolved = dependencies(options);

  async function resolve(input) {
    const identity = normalizeIdentity(input);
    try {
      const sqlReport = await resolved.loadSql(identity);
      return makeSqlReport(sqlReport);
    } catch (error) {
      const classification = classifySqlFailure(error);
      if (!classification.eligible) throw error;

      const switchDecision = resolved.evaluateKillSwitch({
        surface: FALLBACK_SURFACE,
        action: FALLBACK_ACTION,
        env: resolved.env
      });
      if (switchDecision?.switch_key !== FALLBACK_SURFACE || switchDecision?.gated_action !== true) {
        fail("operation_contract_code_fallback_policy_missing", "The operation-contract fallback kill-switch policy is not registered.", 500, {
          sql_error_code: classification.code
        });
      }
      if (switchDecision.blocked) {
        fail("operation_contract_code_fallback_disabled", "Static operation-contract fallback is disabled by the operational kill switch.", 503, {
          sql_error_code: classification.code,
          sql_failure_classification: classification.classification,
          switch_key: switchDecision.switch_key,
          env_var: switchDecision.env_var,
          retryable: true
        });
      }
      if (identity.version !== LEGACY_FALLBACK_VERSION) {
        fail("operation_contract_code_fallback_version_unsupported", "The legacy code registry can only satisfy version 1 contracts.", 503, {
          requested_version: identity.version,
          sql_error_code: classification.code,
          retryable: classification.retryable
        });
      }

      let staticContract;
      try {
        staticContract = resolved.getStaticContract(identity.operation_key);
      } catch (staticError) {
        fail("operation_contract_code_fallback_not_registered", "No legacy code contract is registered for the requested SQL operation.", 404, {
          operation_key: identity.operation_key,
          sql_error_code: classification.code,
          static_error_code: staticError?.code || null,
          retryable: classification.retryable
        });
      }
      const canonicalKey = normalizeOperationKey(identity.operation_key);
      if (!canonicalKey || staticContract?.operation_key !== canonicalKey) {
        fail("operation_contract_code_fallback_identity_mismatch", "The legacy code contract identity does not match the requested operation.", 500, {
          operation_key: identity.operation_key,
          canonical_operation_key: canonicalKey
        });
      }

      const contract = makeFallbackContract(staticContract, identity.version);
      return {
        ok: true,
        report_type: "operation_runtime_contract_resolve",
        operation_key: contract.operation_key,
        version: contract.version,
        revision_hash: contract.revision_hash,
        resolution_source: "legacy_code_registry",
        contract_kind: "legacy_code_contract",
        contract,
        cache: null,
        fallback_used: true,
        fallback_reason: {
          classification: classification.classification,
          sql_error_code: classification.code,
          sql_status: classification.status,
          retryable: classification.retryable,
          secrets_included: false
        },
        fallback_switch: boundedSwitchEvidence(switchDecision),
        sql_authority_primary: true,
        legacy_code_authority_temporary: true,
        migration_only: true,
        read_only: true,
        database_writes_performed: false,
        provider_calls_performed: false,
        external_writes_performed: false,
        runtime_activation_changed: false,
        secrets_included: false
      };
    }
  }

  return Object.freeze({ resolve });
}

let defaultResolver = null;

export async function resolveOperationRuntimeContract(input) {
  if (!defaultResolver) defaultResolver = createOperationRuntimeContractResolver();
  return defaultResolver.resolve(input);
}

export const _testingOperationRuntimeContractResolver = {
  classifySqlFailure,
  FALLBACK_SURFACE,
  FALLBACK_ACTION,
  LEGACY_FALLBACK_VERSION
};
