import { createHash } from 'node:crypto';
import {
  HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION,
  isCanonicalHostingerStorageVerifiedSqlRuntimeComposition,
} from './hostingerStorageVerifiedSqlRuntimeComposition.js';
import {
  HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_STORE_VERSION,
  isCanonicalHostingerStorageDurableTenantAuthorityStore,
} from './hostingerStorageDurableTenantAuthorityStore.js';
import {
  HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_REGISTRY_VERSION,
  isCanonicalHostingerStorageDurableTenantEnablementRegistry,
} from './hostingerStorageDurableTenantEnablementRegistry.js';

export const HOSTINGER_STORAGE_TENANT_SAFE_DURABLE_PROJECTION_VERSION = 'spec014-hostinger-storage-tenant-safe-durable-projection-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-tenant-safe-durable-projection');
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const ALLOWED_OPTIONS = new Set(['composition', 'authority_store', 'enablement_registry']);
const REDACTED_FIELDS = Object.freeze([
  'root_ref',
  'path_ref_prefix',
  'tenant_safe_relative_path',
  'path_ref',
  'worker_ref',
  'connector_ref',
  'dispatch_certification_ref',
  'host_key_evidence_ref',
  'before_snapshot_id',
  'after_snapshot_id',
  'device_id_digest',
  'inode_value',
  'ctime_ns',
  'mtime_ns',
  'ownership_evidence_ref',
  'observed_stat_digest',
  'result_evidence_digest',
  'input_evidence_hashes',
  'raw_record_json',
]);
const FORBIDDEN_OUTPUT_KEY_RE = /^(?:root_ref|path_ref_prefix|tenant_safe_relative_path|path_ref|worker_ref|connector_ref|dispatch_certification_ref|host_key_evidence_ref|before_snapshot_id|after_snapshot_id|device_id_digest|inode_value|ctime_ns|mtime_ns|ownership_evidence_ref|observed_stat_digest|result_evidence_digest|input_evidence_hashes|record_json)$/u;

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = Object.freeze({ ...details, secrets_included: false });
  return error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function identifier(value, field, max = 256) {
  const normalized = text(value, max);
  if (!SAFE_ID_RE.test(normalized) || normalized.length > max) {
    throw fail(400, 'STORAGE_TENANT_PROJECTION_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function optionalHash(value, field) {
  if (value == null || value === '') return null;
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw fail(409, 'STORAGE_TENANT_PROJECTION_HASH_INVALID', 'A durable lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(409, 'STORAGE_TENANT_PROJECTION_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return normalized;
}

function assertDataOnly(value, path = 'value', active = new WeakSet(), depth = 0) {
  if (depth > 20) throw fail(400, 'STORAGE_TENANT_PROJECTION_DATA_TOO_DEEP', 'Projection input exceeded the supported depth.', { path });
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') throw fail(400, 'STORAGE_TENANT_PROJECTION_DATA_INVALID', 'Projection inputs must contain data values only.', { path });
  if (active.has(value)) throw fail(400, 'STORAGE_TENANT_PROJECTION_DATA_CYCLE', 'Projection inputs must not contain cycles.', { path });
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw fail(400, 'STORAGE_TENANT_PROJECTION_DATA_INVALID', 'Projection inputs must use plain data objects.', { path });
  }
  active.add(value);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        throw fail(400, 'STORAGE_TENANT_PROJECTION_ACCESSOR_REJECTED', 'Projection inputs must not contain accessor properties.', { path: `${path}.${key}` });
      }
      if (key === 'secrets_included' && descriptor.value !== false) {
        throw fail(400, 'STORAGE_TENANT_PROJECTION_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
      }
      if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command)/i.test(key)) {
        throw fail(400, 'STORAGE_TENANT_PROJECTION_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Projection inputs cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
      }
      assertDataOnly(descriptor.value, `${path}.${key}`, active, depth + 1);
    }
  } finally {
    active.delete(value);
  }
}

function assertTenantSafeOutput(value, path = 'projection', depth = 0) {
  if (depth > 20 || value === null || value === undefined) return;
  if (Array.isArray(value)) return value.forEach((entry, index) => assertTenantSafeOutput(entry, `${path}[${index}]`, depth + 1));
  if (typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_OUTPUT_KEY_RE.test(key)) {
      throw fail(500, 'STORAGE_TENANT_PROJECTION_REDACTION_FAILURE', 'Tenant projection contains a forbidden field.', { path: `${path}.${key}` });
    }
    assertTenantSafeOutput(entry, `${path}.${key}`, depth + 1);
  }
}

function normalizeRequest(input = {}) {
  assertDataOnly(input, 'projection_request');
  return deepFreeze({
    tenant_id: identifier(input.tenant_id, 'tenant_id', 36),
    workspace_id: identifier(input.workspace_id, 'workspace_id', 36),
    resource_id: identifier(input.resource_id, 'resource_id', 36),
    operation_id: identifier(input.operation_id, 'operation_id', 36),
    plan_id: identifier(input.plan_id, 'plan_id', 36),
    run_id: identifier(input.run_id, 'run_id', 36),
    allowlist_id: identifier(input.allowlist_id, 'allowlist_id', 36),
    approval_id: identifier(input.approval_id, 'approval_id', 36),
    enablement_id: identifier(input.enablement_id, 'enablement_id', 36),
    secrets_included: false,
  });
}

function assertDependencies(composition, authorityStore, enablementRegistry) {
  if (!isCanonicalHostingerStorageVerifiedSqlRuntimeComposition(composition)
    || composition.composition_version !== HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION
    || typeof composition.execution_parents?.readRun !== 'function') {
    throw fail(409, 'STORAGE_TENANT_PROJECTION_COMPOSITION_INVALID', 'Canonical verified SQL composition with Run read support is required.');
  }
  if (!isCanonicalHostingerStorageDurableTenantAuthorityStore(authorityStore)
    || authorityStore.store_version !== HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_STORE_VERSION) {
    throw fail(409, 'STORAGE_TENANT_PROJECTION_AUTHORITY_STORE_INVALID', 'Canonical durable Tenant authority store is required.');
  }
  if (!isCanonicalHostingerStorageDurableTenantEnablementRegistry(enablementRegistry)
    || enablementRegistry.registry_version !== HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_REGISTRY_VERSION) {
    throw fail(409, 'STORAGE_TENANT_PROJECTION_ENABLEMENT_REGISTRY_INVALID', 'Canonical durable Tenant enablement registry is required.');
  }
  const fingerprints = new Set([
    composition.schema_provenance.database_fingerprint,
    authorityStore.database_fingerprint,
    enablementRegistry.database_fingerprint,
  ]);
  if (fingerprints.size !== 1) {
    throw fail(409, 'STORAGE_TENANT_PROJECTION_DATABASE_PROVENANCE_MISMATCH', 'Projection dependencies must bind the same durable database fingerprint.');
  }
}

function requireAudience(aggregate, request) {
  const operation = aggregate?.operation;
  if (!operation) throw fail(404, 'STORAGE_TENANT_PROJECTION_OPERATION_NOT_FOUND', 'Durable operation aggregate was not found.', { operation_id: request.operation_id });
  const mismatches = [];
  if (operation.operation_id !== request.operation_id) mismatches.push('operation_id');
  if (operation.context_mode !== 'tenant') mismatches.push('context_mode');
  if (operation.tenant_id !== request.tenant_id) mismatches.push('tenant_id');
  if (operation.workspace_id !== request.workspace_id) mismatches.push('workspace_id');
  if (operation.resource_id !== request.resource_id) mismatches.push('resource_id');
  if (mismatches.length) {
    throw fail(403, 'STORAGE_TENANT_PROJECTION_AUDIENCE_MISMATCH', 'Durable evidence does not belong to the requested Tenant audience.', { mismatches: [...new Set(mismatches)].sort() });
  }
  const plan = Array.isArray(aggregate.plans) ? aggregate.plans.find((row) => row.plan_id === request.plan_id) : null;
  if (!plan || plan.operation_id !== request.operation_id || plan.target_id !== operation.target_id) {
    throw fail(409, 'STORAGE_TENANT_PROJECTION_PLAN_BINDING_MISMATCH', 'Requested immutable plan does not belong to the Tenant operation.');
  }
  return { operation, plan };
}

function journalSummary(journals, runId) {
  const rows = (Array.isArray(journals) ? journals : []).filter((row) => row.run_id === runId);
  const phases = { prepared: 0, result: 0, readback: 0, other: 0 };
  const results = { deleted: 0, skipped: 0, failed: 0, other: 0 };
  let maxSequence = 0;
  for (const row of rows) {
    const phase = text(row.phase, 32).toLowerCase();
    if (Object.hasOwn(phases, phase)) phases[phase] += 1;
    else phases.other += 1;
    const result = text(row.result, 64).toLowerCase();
    if (result === 'deleted' || result === 'applied') results.deleted += 1;
    else if (result.startsWith('skipped') || result === 'missing') results.skipped += 1;
    else if (result.includes('fail') || result === 'conflict') results.failed += 1;
    else results.other += 1;
    maxSequence = Math.max(maxSequence, Number(row.sequence) || 0);
  }
  return deepFreeze({ total: rows.length, phases, results, max_sequence: maxSequence, secrets_included: false });
}

function reconciliationSummary(reconciliations, runId) {
  const rows = (Array.isArray(reconciliations) ? reconciliations : [])
    .filter((row) => row.run_id === runId)
    .sort((left, right) => Number(left.reviewed_at_epoch || 0) - Number(right.reviewed_at_epoch || 0));
  const latest = rows.at(-1) || null;
  const outcome = latest ? text(latest.outcome, 32).toLowerCase() : null;
  const retryPermission = latest?.retry_permission === true || latest?.retry_allowed === true;
  return deepFreeze({
    total: rows.length,
    latest_outcome: outcome,
    latest_reviewed_at_epoch: latest?.reviewed_at_epoch == null ? null : integer(latest.reviewed_at_epoch, 'reconciliation.reviewed_at_epoch'),
    retry_allowed: outcome === 'not_applied' && retryPermission,
    read_before_retry_required: outcome === 'not_applied' && retryPermission,
    secrets_included: false,
  });
}

export function createHostingerStorageTenantSafeDurableProjection(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail(500, 'STORAGE_TENANT_PROJECTION_OPTIONS_INVALID', 'Projection options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unsupported.length) {
    throw fail(409, 'STORAGE_TENANT_PROJECTION_OVERRIDE_FORBIDDEN', 'Only canonical durable dependencies may be supplied.', { unsupported_options: unsupported.sort() });
  }
  const composition = options.composition;
  const authorityStore = options.authority_store;
  const enablementRegistry = options.enablement_registry;
  assertDependencies(composition, authorityStore, enablementRegistry);

  async function project(input = {}) {
    const request = normalizeRequest(input);
    const aggregate = await composition.control_plane.readAggregate(request.operation_id);
    const { operation, plan } = requireAudience(aggregate, request);

    const [runRead, allowlist, approval, enablement, consumption] = await Promise.all([
      composition.execution_parents.readRun({ run_id: request.run_id }),
      authorityStore.readAllowlist(request.allowlist_id),
      authorityStore.readApproval(request.approval_id),
      enablementRegistry.read(request.enablement_id),
      enablementRegistry.readConsumption(request.enablement_id),
    ]);

    const run = runRead?.run;
    if (runRead?.found !== true || !run
      || run.operation_id !== request.operation_id || run.plan_id !== request.plan_id) {
      throw fail(409, 'STORAGE_TENANT_PROJECTION_RUN_BINDING_MISMATCH', 'Requested durable run does not belong to the Tenant operation and plan.');
    }
    if (!allowlist || allowlist.tenant_id !== request.tenant_id
      || allowlist.workspace_id !== request.workspace_id || allowlist.resource_id !== request.resource_id
      || allowlist.target_id !== operation.target_id || allowlist.target_scope !== 'tenant'
      || allowlist.shared_target !== false || allowlist.platform_target !== false) {
      throw fail(403, 'STORAGE_TENANT_PROJECTION_ALLOWLIST_BINDING_MISMATCH', 'Durable allowlist does not belong to the requested Tenant audience.');
    }
    if (!approval || approval.tenant_id !== request.tenant_id
      || approval.workspace_id !== request.workspace_id || approval.operation_id !== request.operation_id
      || approval.target_id !== operation.target_id || approval.plan_hash !== plan.plan_hash
      || approval.approver_role !== 'workspace_owner') {
      throw fail(403, 'STORAGE_TENANT_PROJECTION_APPROVAL_BINDING_MISMATCH', 'Durable approval does not belong to the requested Tenant operation and plan.');
    }
    if (!enablement || enablement.operation_id !== request.operation_id || enablement.run_id !== request.run_id) {
      throw fail(409, 'STORAGE_TENANT_PROJECTION_ENABLEMENT_BINDING_MISMATCH', 'Durable enablement does not belong to the requested operation and run.');
    }
    if ((enablement.consumed === true) !== Boolean(consumption)) {
      throw fail(409, 'STORAGE_TENANT_PROJECTION_CONSUMPTION_STATE_MISMATCH', 'Current enablement state and immutable consumption receipt disagree.');
    }
    if (consumption && (consumption.operation_id !== request.operation_id || consumption.run_id !== request.run_id
      || consumption.enablement_id !== request.enablement_id)) {
      throw fail(409, 'STORAGE_TENANT_PROJECTION_CONSUMPTION_BINDING_MISMATCH', 'Immutable consumption receipt does not belong to the requested operation and run.');
    }

    const journals = journalSummary(aggregate.journals, request.run_id);
    const reconciliation = reconciliationSummary(aggregate.reconciliations, request.run_id);
    const counts = deepFreeze({
      deleted: integer(run.deleted_count, 'run.deleted_count'),
      deleted_bytes: String(run.deleted_bytes ?? '0'),
      skipped: integer(run.skipped_count, 'run.skipped_count'),
      missing: integer(run.missing_count, 'run.missing_count'),
      failed: integer(run.failed_count, 'run.failed_count'),
      secrets_included: false,
    });
    const projection = {
      schema_version: 1,
      projection_key: 'hostinger_storage_tenant_safe_durable_projection_v1',
      projection_version: HOSTINGER_STORAGE_TENANT_SAFE_DURABLE_PROJECTION_VERSION,
      tenant_id: request.tenant_id,
      workspace_id: request.workspace_id,
      resource_id: request.resource_id,
      target_id: operation.target_id,
      operation: {
        operation_id: request.operation_id,
        state: operation.state,
        version: integer(operation.version, 'operation.version', 1),
        terminal_reason: operation.terminal_reason || null,
        updated_at_epoch: integer(operation.updated_at_epoch, 'operation.updated_at_epoch'),
        secrets_included: false,
      },
      plan: {
        plan_id: request.plan_id,
        status: plan.status,
        item_count: integer(plan.item_count, 'plan.item_count'),
        total_bytes: String(plan.total_bytes ?? '0'),
        expires_at_epoch: integer(plan.expires_at_epoch, 'plan.expires_at_epoch'),
        consumed: plan.consumed === true,
        plan_hash: optionalHash(plan.plan_hash, 'plan.plan_hash'),
        secrets_included: false,
      },
      run: {
        run_id: request.run_id,
        state: run.state,
        run_generation: integer(run.run_generation, 'run.run_generation', 1),
        started_at_epoch: integer(run.started_at_epoch, 'run.started_at_epoch'),
        finished_at_epoch: run.finished_at_epoch == null ? null : integer(run.finished_at_epoch, 'run.finished_at_epoch'),
        readback_status: run.readback_status,
        unknown_outcome: run.unknown_outcome === true,
        provider_response_classification: run.provider_response_classification,
        result_digest: optionalHash(run.result_digest, 'run.result_digest'),
        counts,
        secrets_included: false,
      },
      authority: {
        allowlist_id: request.allowlist_id,
        allowlist_revision: allowlist.revision,
        allowlist_status: allowlist.status,
        environment: allowlist.environment,
        valid_from_epoch: integer(allowlist.valid_from_epoch, 'allowlist.valid_from_epoch'),
        expires_at_epoch: integer(allowlist.expires_at_epoch, 'allowlist.expires_at_epoch'),
        max_items: integer(allowlist.max_items, 'allowlist.max_items', 1),
        max_bytes: String(allowlist.max_bytes ?? '0'),
        approval_id: request.approval_id,
        approval_slot: approval.slot,
        approval_status: approval.status,
        approval_expires_at_epoch: integer(approval.expires_at_epoch, 'approval.expires_at_epoch'),
        workspace_owner_bound: true,
        secrets_included: false,
      },
      enablement: {
        enablement_id: request.enablement_id,
        generation: integer(enablement.generation, 'enablement.generation', 1),
        expires_at_epoch: integer(enablement.expires_at_epoch, 'enablement.expires_at_epoch'),
        consumed: enablement.consumed === true,
        consumed_at_epoch: enablement.consumed_at_epoch == null ? null : integer(enablement.consumed_at_epoch, 'enablement.consumed_at_epoch'),
        immutable_consumption_receipt_present: Boolean(consumption),
        automatic_retry_allowed: false,
        secrets_included: false,
      },
      evidence: {
        journals,
        reconciliation,
        aggregate_digest: optionalHash(aggregate.aggregate_digest, 'aggregate.aggregate_digest'),
        secrets_included: false,
      },
      outcome: reconciliation.latest_outcome || run.state,
      retry_allowed: reconciliation.retry_allowed,
      read_before_retry_required: reconciliation.read_before_retry_required,
      redacted_fields: REDACTED_FIELDS,
      tenant_exclusive: true,
      durable_sql: true,
      synthetic_only: false,
      live_provider_payload_exposed: false,
      provider_dispatch_allowed: false,
      runtime_mounted: false,
      route_mounted: false,
      worker_mounted: false,
      production_ready: false,
      secrets_included: false,
    };
    assertTenantSafeOutput(projection);
    const frozenProjection = deepFreeze(projection);
    return deepFreeze({
      ok: true,
      projection: frozenProjection,
      projection_digest: digest(frozenProjection),
      provider_dispatch_allowed: false,
      production_ready: false,
      secrets_included: false,
    });
  }

  const projector = {
    projection_key: 'hostinger_storage_tenant_safe_durable_projection_v1',
    projection_version: HOSTINGER_STORAGE_TENANT_SAFE_DURABLE_PROJECTION_VERSION,
    async_only: true,
    read_only: true,
    tenant_exclusive: true,
    durable_sql: true,
    redacted_fields: REDACTED_FIELDS,
    raw_dependencies_exposed: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    project,
    secrets_included: false,
  };
  Object.defineProperty(projector, BRAND, { value: true, enumerable: false });
  return Object.freeze(projector);
}

export function isCanonicalHostingerStorageTenantSafeDurableProjection(value) {
  return Boolean(value?.[BRAND] === true
    && value?.projection_key === 'hostinger_storage_tenant_safe_durable_projection_v1'
    && value?.projection_version === HOSTINGER_STORAGE_TENANT_SAFE_DURABLE_PROJECTION_VERSION
    && value?.async_only === true
    && value?.read_only === true
    && value?.tenant_exclusive === true
    && value?.durable_sql === true
    && value?.raw_dependencies_exposed === false
    && value?.runtime_mounted === false
    && value?.route_mounted === false
    && value?.worker_mounted === false
    && value?.provider_dispatch_allowed === false
    && value?.production_ready === false
    && typeof value?.project === 'function'
    && Object.isFrozen(value));
}
