import { getPool } from "./db.js";
import { getOperationVersion } from "./operationRegistryRepository.js";
import { operationRevisionHash } from "./operationRegistryContracts.js";

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 250;
const DEFAULT_MAX_STEPS = 200;
const DEFAULT_ALLOWED_STATUSES = Object.freeze(["shadow", "active"]);
const OPERATION_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{2,190}$/;

export class OperationRuntimeContractLoaderError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationRuntimeContractLoaderError";
    this.code = code;
    this.status = status;
    this.details = { ...details, secrets_included: false };
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationRuntimeContractLoaderError(code, message, status, details);
}

function boundedInteger(value, fallback, min, max, field) {
  const parsed = Number(value);
  if (value === undefined || value === null || value === "") return fallback;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail("operation_runtime_contract_loader_invalid_integer", `${field} must be an integer between ${min} and ${max}.`, 400, { field });
  }
  return parsed;
}

function normalizeIdentity(input = {}) {
  const allowed = new Set(["operation_key", "version"]);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("operation_runtime_contract_loader_invalid_input", "input must be an object.");
  }
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      fail("operation_runtime_contract_loader_unknown_field", `input.${key} is not supported.`, 400, { field: `input.${key}` });
    }
  }
  const operationKey = String(input.operation_key || "").trim().toLowerCase();
  const version = Number(input.version);
  if (!OPERATION_KEY_PATTERN.test(operationKey)) {
    fail("operation_runtime_contract_loader_invalid_operation_key", "input.operation_key is invalid.", 400, { field: "input.operation_key" });
  }
  if (!Number.isInteger(version) || version < 1) {
    fail("operation_runtime_contract_loader_invalid_version", "input.version must be a positive integer.", 400, { field: "input.version" });
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

function cacheKey(identity) {
  return `${identity.operation_key}:${identity.version}`;
}

async function readRevisionProbe(pool, identity) {
  const [rows] = await pool.query(
    `SELECT id,operation_id,operation_key,version,revision_hash,status,updated_at
       FROM operation_registry
      WHERE operation_key=? AND version=?
      LIMIT 1`,
    [identity.operation_key, identity.version]
  );
  const row = rows?.[0];
  if (!row) {
    fail("operation_runtime_contract_not_found", "The requested SQL operation contract was not found.", 404, identity);
  }
  return {
    id: Number(row.id),
    operation_id: row.operation_id,
    operation_key: row.operation_key,
    version: Number(row.version),
    revision_hash: row.revision_hash,
    status: String(row.status || "").toLowerCase(),
    updated_at: row.updated_at || null
  };
}

function validateLoadedRecord(record, probe, { maxSteps, allowedStatuses }) {
  if (!record || typeof record !== "object" || !record.definition || typeof record.definition !== "object") {
    fail("operation_runtime_contract_readback_missing", "The SQL operation repository returned no contract readback.", 500);
  }
  if (Number(record.id) !== probe.id || record.operation_id !== probe.operation_id) {
    fail("operation_runtime_contract_identity_mismatch", "The loaded contract identity does not match the revision probe.", 500);
  }
  if (record.definition.operation_key !== probe.operation_key || Number(record.definition.version) !== probe.version) {
    fail("operation_runtime_contract_definition_identity_mismatch", "The loaded contract definition identity is inconsistent.", 500);
  }
  if (record.revision_hash !== probe.revision_hash) {
    fail("operation_runtime_contract_revision_changed_during_load", "The operation revision changed while the contract was loading.", 409, {
      probed_revision_hash: probe.revision_hash,
      loaded_revision_hash: record.revision_hash
    });
  }
  const observedRevisionHash = operationRevisionHash(record.definition);
  if (observedRevisionHash !== record.revision_hash) {
    fail("operation_runtime_contract_revision_hash_mismatch", "The loaded operation contract does not match its persisted revision hash.", 500, {
      persisted_revision_hash: record.revision_hash,
      observed_revision_hash: observedRevisionHash
    });
  }
  const status = String(record.definition.status || "").toLowerCase();
  if (status !== probe.status) {
    fail("operation_runtime_contract_status_mismatch", "The loaded contract lifecycle does not match the revision probe.", 500, {
      probed_status: probe.status,
      loaded_status: status
    });
  }
  if (!allowedStatuses.has(status)) {
    fail("operation_runtime_contract_lifecycle_blocked", "The SQL operation contract is not runtime-loadable in its current lifecycle.", 409, { status });
  }
  if (!Array.isArray(record.definition.steps) || record.definition.steps.length < 1 || record.definition.steps.length > maxSteps) {
    fail("operation_runtime_contract_step_count_invalid", `The SQL operation contract must contain 1-${maxSteps} steps.`, 409, {
      step_count: Array.isArray(record.definition.steps) ? record.definition.steps.length : null
    });
  }
}

function makeContract(record) {
  return deepFreeze(cloneValue({
    operation_registry_id: Number(record.id),
    operation_id: record.operation_id,
    operation_key: record.definition.operation_key,
    version: Number(record.definition.version),
    revision_hash: record.revision_hash,
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
    activated_at: record.activated_at || null,
    superseded_at: record.superseded_at || null,
    definition: record.definition,
    source: "sql_operation_registry",
    read_only: true,
    secrets_included: false
  }));
}

function makeReport(contract, cacheMetadata) {
  return {
    ok: true,
    report_type: "operation_runtime_contract_load",
    operation_key: contract.operation_key,
    version: contract.version,
    revision_hash: contract.revision_hash,
    contract,
    cache: cacheMetadata,
    read_only: true,
    database_writes_performed: false,
    provider_calls_performed: false,
    external_writes_performed: false,
    runtime_activation_changed: false,
    fallback_used: false,
    secrets_included: false
  };
}

export function createOperationRuntimeContractLoader(options = {}) {
  const pool = options.pool || getPool();
  const ttlMs = boundedInteger(options.ttl_ms, DEFAULT_TTL_MS, 1, 3_600_000, "ttl_ms");
  const maxEntries = boundedInteger(options.max_entries, DEFAULT_MAX_ENTRIES, 1, 5_000, "max_entries");
  const maxSteps = boundedInteger(options.max_steps, DEFAULT_MAX_STEPS, 1, 1_000, "max_steps");
  const now = typeof options.now === "function" ? options.now : Date.now;
  const allowedStatuses = new Set(Array.isArray(options.allowed_statuses) && options.allowed_statuses.length
    ? options.allowed_statuses.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    : DEFAULT_ALLOWED_STATUSES);
  const loadVersion = typeof options.load_version === "function"
    ? options.load_version
    : async (operationKey, version) => getOperationVersion(operationKey, version, { pool });
  const cache = new Map();
  const inflight = new Map();

  function prune(currentTime) {
    for (const [key, entry] of cache) {
      if (entry.expires_at <= currentTime) cache.delete(key);
    }
    while (cache.size >= maxEntries) {
      let oldestKey = null;
      let oldestAccess = Number.POSITIVE_INFINITY;
      for (const [key, entry] of cache) {
        if (entry.last_accessed_at < oldestAccess) {
          oldestAccess = entry.last_accessed_at;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      cache.delete(oldestKey);
    }
  }

  async function loadInternal(identity) {
    const key = cacheKey(identity);
    const currentTime = Number(now());
    const probe = await readRevisionProbe(pool, identity);
    if (!allowedStatuses.has(probe.status)) {
      fail("operation_runtime_contract_lifecycle_blocked", "The SQL operation contract is not runtime-loadable in its current lifecycle.", 409, { status: probe.status });
    }

    const cached = cache.get(key) || null;
    const cacheExpired = Boolean(cached && cached.expires_at <= currentTime);
    const revisionInvalidated = Boolean(cached && (
      cached.revision_hash !== probe.revision_hash || cached.status !== probe.status
    ));

    if (cached && !cacheExpired && !revisionInvalidated) {
      cached.last_accessed_at = currentTime;
      return makeReport(cached.contract, {
        cache_hit: true,
        cache_expired: false,
        revision_invalidated: false,
        revision_probe_performed: true,
        single_flight_joined: false,
        ttl_ms: ttlMs,
        max_entries: maxEntries,
        entry_count: cache.size
      });
    }

    if (cached) cache.delete(key);
    const repositoryResult = await loadVersion(identity.operation_key, identity.version);
    const record = repositoryResult?.operation || repositoryResult;
    validateLoadedRecord(record, probe, { maxSteps, allowedStatuses });
    const contract = makeContract(record);

    prune(currentTime);
    cache.set(key, {
      contract,
      revision_hash: contract.revision_hash,
      status: String(contract.definition.status || "").toLowerCase(),
      expires_at: currentTime + ttlMs,
      last_accessed_at: currentTime
    });

    return makeReport(contract, {
      cache_hit: false,
      cache_expired: cacheExpired,
      revision_invalidated: revisionInvalidated,
      revision_probe_performed: true,
      single_flight_joined: false,
      ttl_ms: ttlMs,
      max_entries: maxEntries,
      entry_count: cache.size
    });
  }

  async function load(input) {
    const identity = normalizeIdentity(input);
    const key = cacheKey(identity);
    const existingFlight = inflight.get(key);
    if (existingFlight) {
      const result = await existingFlight;
      return {
        ...result,
        cache: { ...result.cache, single_flight_joined: true }
      };
    }

    const flight = loadInternal(identity);
    inflight.set(key, flight);
    try {
      return await flight;
    } finally {
      if (inflight.get(key) === flight) inflight.delete(key);
    }
  }

  function invalidate(input) {
    const identity = normalizeIdentity(input);
    return cache.delete(cacheKey(identity));
  }

  function clear() {
    const removed = cache.size;
    cache.clear();
    return removed;
  }

  function stats() {
    const currentTime = Number(now());
    let expiredEntries = 0;
    for (const entry of cache.values()) if (entry.expires_at <= currentTime) expiredEntries += 1;
    return {
      entry_count: cache.size,
      inflight_count: inflight.size,
      expired_entry_count: expiredEntries,
      ttl_ms: ttlMs,
      max_entries: maxEntries,
      max_steps: maxSteps,
      allowed_statuses: [...allowedStatuses].sort(),
      read_only: true,
      secrets_included: false
    };
  }

  return Object.freeze({ load, invalidate, clear, stats });
}

let defaultLoader = null;

export async function loadOperationRuntimeContract(input) {
  if (!defaultLoader) defaultLoader = createOperationRuntimeContractLoader();
  return defaultLoader.load(input);
}

export function invalidateOperationRuntimeContract(input) {
  if (!defaultLoader) return false;
  return defaultLoader.invalidate(input);
}

export function clearOperationRuntimeContractCache() {
  if (!defaultLoader) return 0;
  return defaultLoader.clear();
}
