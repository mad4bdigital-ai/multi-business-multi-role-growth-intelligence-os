import { createHash } from 'node:crypto';
import {
  HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION,
  isCanonicalHostingerStorageVerifiedSqlRuntimeComposition,
} from './hostingerStorageVerifiedSqlRuntimeComposition.js';

export const HOSTINGER_STORAGE_DURABLE_TENANT_REPOSITORY_FACADE_VERSION = 'spec014-hostinger-storage-durable-tenant-repository-facade-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-durable-tenant-repository-facade');
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const ALLOWED_OPTIONS = new Set(['composition']);
const PREPARABLE_OPERATION_STATES = new Set(['lease_acquired', 'executing']);
const PREPARABLE_PLAN_STATES = new Set(['approved', 'consumed']);

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

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function identifier(value, field, max = 256) {
  const normalized = text(value, max);
  if (!SAFE_ID_RE.test(normalized) || normalized.length > max) {
    throw fail(400, 'STORAGE_DURABLE_TENANT_FACADE_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_DURABLE_TENANT_FACADE_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(400, 'STORAGE_DURABLE_TENANT_FACADE_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return normalized;
}

function assertDataOnly(value, path = 'value', active = new WeakSet(), depth = 0) {
  if (depth > 20) throw fail(400, 'STORAGE_DURABLE_TENANT_FACADE_DATA_TOO_DEEP', 'Facade inputs exceeded the supported depth.', { path });
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') throw fail(400, 'STORAGE_DURABLE_TENANT_FACADE_DATA_INVALID', 'Facade inputs must contain data values only.', { path });
  if (active.has(value)) throw fail(400, 'STORAGE_DURABLE_TENANT_FACADE_DATA_CYCLE', 'Facade inputs must not contain cycles.', { path });
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw fail(400, 'STORAGE_DURABLE_TENANT_FACADE_DATA_INVALID', 'Facade inputs must use plain data objects.', { path });
  }
  active.add(value);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        throw fail(400, 'STORAGE_DURABLE_TENANT_FACADE_ACCESSOR_REJECTED', 'Facade inputs must not contain accessor properties.', { path: `${path}.${key}` });
      }
      if (key === 'secrets_included' && descriptor.value !== false) {
        throw fail(400, 'STORAGE_DURABLE_TENANT_FACADE_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
      }
      if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command)/i.test(key)) {
        throw fail(400, 'STORAGE_DURABLE_TENANT_FACADE_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Facade inputs cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
      }
      assertDataOnly(descriptor.value, `${path}.${key}`, active, depth + 1);
    }
  } finally {
    active.delete(value);
  }
}

function snapshot(value, path) {
  assertDataOnly(value, path);
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function normalizePreparation(input = {}) {
  const copy = snapshot(input, 'prepare_execution');
  const operationId = identifier(copy.operation_id ?? copy.operationId, 'operation_id', 36);
  const planId = identifier(copy.plan_id ?? copy.planId, 'plan_id', 36);
  const expectedOperationVersion = integer(copy.expected_operation_version ?? copy.expectedOperationVersion, 'expected_operation_version', 1);
  const expectedPlanHash = hash(copy.expected_plan_hash ?? copy.expectedPlanHash, 'expected_plan_hash');
  const nowEpoch = integer(copy.now_epoch ?? copy.nowEpoch, 'now_epoch', 1);
  if (!Array.isArray(copy.plan_items ?? copy.planItems) || (copy.plan_items ?? copy.planItems).length < 1) {
    throw fail(400, 'STORAGE_DURABLE_TENANT_FACADE_PLAN_ITEMS_REQUIRED', 'At least one canonical plan item is required.');
  }
  const planItems = copy.plan_items ?? copy.planItems;
  const ordinals = planItems.map((item, index) => integer(item?.ordinal, `plan_items[${index}].ordinal`, 1));
  if (ordinals.some((ordinal, index) => ordinal !== index + 1)) {
    throw fail(409, 'STORAGE_DURABLE_TENANT_FACADE_PLAN_ITEM_ORDINAL_GAP', 'Plan-item ordinals must be contiguous from one.', { ordinals });
  }
  const run = copy.run;
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    throw fail(400, 'STORAGE_DURABLE_TENANT_FACADE_RUN_REQUIRED', 'A canonical run-parent envelope is required.');
  }
  const runId = identifier(run.run_id ?? run.runId, 'run.run_id', 36);
  const runOperationId = identifier(run.operation_id ?? run.operationId, 'run.operation_id', 36);
  const runPlanId = identifier(run.plan_id ?? run.planId, 'run.plan_id', 36);
  const runTargetId = identifier(run.target_id ?? run.targetId, 'run.target_id', 36);
  if (runOperationId !== operationId || runPlanId !== planId) {
    throw fail(409, 'STORAGE_DURABLE_TENANT_FACADE_RUN_BINDING_MISMATCH', 'Run parent must bind the exact operation and plan.', {
      operation_id: operationId,
      plan_id: planId,
    });
  }
  return deepFreeze({
    operation_id: operationId,
    plan_id: planId,
    expected_operation_version: expectedOperationVersion,
    expected_plan_hash: expectedPlanHash,
    plan_items: planItems,
    run: { ...run, run_id: runId, operation_id: runOperationId, plan_id: runPlanId, target_id: runTargetId },
    run_id: runId,
    run_target_id: runTargetId,
    now_epoch: nowEpoch,
    secrets_included: false,
  });
}

function assertAggregateBindings(aggregate, preparation) {
  const operation = aggregate?.operation;
  if (!operation) {
    throw fail(404, 'STORAGE_DURABLE_TENANT_FACADE_OPERATION_NOT_FOUND', 'Durable operation aggregate was not found.', { operation_id: preparation.operation_id });
  }
  if (operation.operation_id !== preparation.operation_id || operation.target_id !== preparation.run_target_id) {
    throw fail(409, 'STORAGE_DURABLE_TENANT_FACADE_OPERATION_BINDING_MISMATCH', 'Operation does not match the requested run target.');
  }
  if (Number(operation.version) !== preparation.expected_operation_version) {
    throw fail(409, 'STORAGE_DURABLE_TENANT_FACADE_OPERATION_VERSION_CONFLICT', 'Operation version changed before durable preparation.', {
      expected_version: preparation.expected_operation_version,
      observed_version: Number(operation.version),
    });
  }
  if (!PREPARABLE_OPERATION_STATES.has(operation.state)) {
    throw fail(409, 'STORAGE_DURABLE_TENANT_FACADE_OPERATION_STATE_INVALID', 'Operation must be lease_acquired or executing before durable preparation.', { state: operation.state });
  }
  const plan = Array.isArray(aggregate.plans)
    ? aggregate.plans.find((row) => row.plan_id === preparation.plan_id)
    : null;
  if (!plan) throw fail(404, 'STORAGE_DURABLE_TENANT_FACADE_PLAN_NOT_FOUND', 'Immutable plan was not found.', { plan_id: preparation.plan_id });
  const mismatches = [];
  if (plan.operation_id !== preparation.operation_id) mismatches.push('operation_id');
  if (plan.target_id !== preparation.run_target_id) mismatches.push('target_id');
  if (plan.plan_hash !== preparation.expected_plan_hash) mismatches.push('plan_hash');
  if (!PREPARABLE_PLAN_STATES.has(plan.status)) mismatches.push('status');
  if (plan.consumed === true && plan.consumed_run_id !== preparation.run_id) mismatches.push('consumed_run_id');
  if (mismatches.length) {
    throw fail(409, 'STORAGE_DURABLE_TENANT_FACADE_PLAN_BINDING_MISMATCH', 'Immutable plan no longer matches the requested durable run.', { mismatches });
  }
  return { operation, plan };
}

function assertComposition(composition) {
  if (!isCanonicalHostingerStorageVerifiedSqlRuntimeComposition(composition)
    || composition.composition_version !== HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION
    || composition.runtime_mounted !== false
    || composition.route_mounted !== false
    || composition.worker_mounted !== false
    || composition.provider_dispatch_allowed !== false
    || composition.production_ready !== false) {
    throw fail(409, 'STORAGE_DURABLE_TENANT_FACADE_COMPOSITION_INVALID', 'An unmounted canonical verified SQL runtime composition is required.');
  }
  const methods = [
    ['control_plane.readAggregate', composition.control_plane?.readAggregate],
    ['control_plane.transitionOperation', composition.control_plane?.transitionOperation],
    ['control_plane.consumePlan', composition.control_plane?.consumePlan],
    ['execution_parents.registerPlanItems', composition.execution_parents?.registerPlanItems],
    ['execution_parents.startRun', composition.execution_parents?.startRun],
    ['execution_parents.finalizeRun', composition.execution_parents?.finalizeRun],
    ['child_evidence.appendJournalEvent', composition.child_evidence?.appendJournalEvent],
    ['child_evidence.appendReconciliation', composition.child_evidence?.appendReconciliation],
  ];
  const missing = methods.filter(([, method]) => typeof method !== 'function').map(([name]) => name);
  if (missing.length) {
    throw fail(409, 'STORAGE_DURABLE_TENANT_FACADE_COMPOSITION_METHOD_MISSING', 'Canonical composition is missing required methods.', { missing });
  }
}

export function createHostingerStorageDurableTenantRepositoryFacade(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail(500, 'STORAGE_DURABLE_TENANT_FACADE_OPTIONS_INVALID', 'Facade options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unsupported.length) {
    throw fail(409, 'STORAGE_DURABLE_TENANT_FACADE_OVERRIDE_FORBIDDEN', 'Only the canonical composition may be supplied.', { unsupported_options: unsupported.sort() });
  }
  const { composition } = options;
  assertComposition(composition);

  async function readExecutionAggregate(operationId) {
    const normalized = identifier(operationId, 'operation_id', 36);
    const aggregate = await composition.control_plane.readAggregate(normalized);
    return deepFreeze(snapshot(aggregate, 'aggregate'));
  }

  async function prepareExecution(input = {}) {
    const preparation = normalizePreparation(input);
    const before = await composition.control_plane.readAggregate(preparation.operation_id);
    const { operation } = assertAggregateBindings(before, preparation);

    const planItems = await composition.execution_parents.registerPlanItems({
      plan_id: preparation.plan_id,
      expected_plan_hash: preparation.expected_plan_hash,
      items: preparation.plan_items,
    });

    let operationTransition = null;
    if (operation.state === 'lease_acquired') {
      operationTransition = await composition.control_plane.transitionOperation({
        operation_id: preparation.operation_id,
        expected_version: preparation.expected_operation_version,
        next_state: 'executing',
        now_epoch: preparation.now_epoch,
      });
    }

    const planConsumption = await composition.control_plane.consumePlan({
      plan_id: preparation.plan_id,
      expected_plan_hash: preparation.expected_plan_hash,
      run_id: preparation.run_id,
      consumed_at_epoch: preparation.now_epoch,
    });

    const runParent = await composition.execution_parents.startRun({ run: preparation.run });
    const after = await composition.control_plane.readAggregate(preparation.operation_id);
    const afterOperation = after?.operation;
    const afterPlan = Array.isArray(after?.plans) ? after.plans.find((row) => row.plan_id === preparation.plan_id) : null;
    if (!afterOperation || afterOperation.state !== 'executing'
      || !afterPlan || afterPlan.consumed !== true || afterPlan.consumed_run_id !== preparation.run_id) {
      throw fail(409, 'STORAGE_DURABLE_TENANT_FACADE_PREPARATION_READBACK_MISMATCH', 'Durable preparation readback does not prove executing state and exact plan consumption.');
    }

    const evidence = {
      preparation_key: 'hostinger_storage_durable_tenant_execution_preparation_v1',
      operation_id: preparation.operation_id,
      plan_id: preparation.plan_id,
      run_id: preparation.run_id,
      transitioned_to_executing: operationTransition !== null,
      plan_item_mapping: planItems?.mapping || [],
      plan_item_set_digest: planItems?.item_set_digest || null,
      plan_consumed: planConsumption?.plan?.consumed === true,
      plan_consumption_replay: planConsumption?.replay === true,
      run_parent_created: runParent?.created === true,
      run_parent_replay: runParent?.replay === true,
      aggregate_digest: after.aggregate_digest,
      schema_verification_digest: composition.schema_provenance.evidence_digest,
      source_commit: composition.schema_provenance.source_commit,
      deployed_runtime_sha: composition.schema_provenance.deployed_runtime_sha,
      database_fingerprint: composition.schema_provenance.database_fingerprint,
      readback_cycle_id: composition.schema_provenance.readback_cycle_id,
      async_only: true,
      legacy_synthetic_executor_compatible: false,
      provider_dispatch_allowed: false,
      runtime_mounted: false,
      production_ready: false,
      secrets_included: false,
    };
    return deepFreeze({ ok: true, evidence, evidence_digest: digest(evidence), secrets_included: false });
  }

  async function appendJournalEvent(input = {}) {
    const result = await composition.child_evidence.appendJournalEvent(snapshot(input, 'journal_event'));
    return deepFreeze(snapshot(result, 'journal_result'));
  }

  async function appendReconciliation(input = {}) {
    const result = await composition.child_evidence.appendReconciliation(snapshot(input, 'reconciliation'));
    return deepFreeze(snapshot(result, 'reconciliation_result'));
  }

  async function finalizeRun(input = {}) {
    const result = await composition.execution_parents.finalizeRun(snapshot(input, 'run_finalization'));
    return deepFreeze(snapshot(result, 'run_finalization_result'));
  }

  const facade = {
    facade_key: 'hostinger_storage_durable_tenant_repository_facade_v1',
    facade_version: HOSTINGER_STORAGE_DURABLE_TENANT_REPOSITORY_FACADE_VERSION,
    composition_version: composition.composition_version,
    schema_provenance: composition.schema_provenance,
    async_only: true,
    legacy_synthetic_executor_compatible: false,
    raw_composition_exposed: false,
    legacy_record_reconciliation_exposed: false,
    transition_operation_exposed: false,
    consume_plan_exposed: false,
    readExecutionAggregate,
    prepareExecution,
    appendJournalEvent,
    appendReconciliation,
    finalizeRun,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
  Object.defineProperty(facade, BRAND, { value: true, enumerable: false });
  return Object.freeze(facade);
}

export function isCanonicalHostingerStorageDurableTenantRepositoryFacade(value) {
  return Boolean(value?.[BRAND] === true
    && Object.isFrozen(value)
    && value?.facade_key === 'hostinger_storage_durable_tenant_repository_facade_v1'
    && value?.facade_version === HOSTINGER_STORAGE_DURABLE_TENANT_REPOSITORY_FACADE_VERSION
    && value?.async_only === true
    && value?.legacy_synthetic_executor_compatible === false
    && value?.raw_composition_exposed === false
    && value?.legacy_record_reconciliation_exposed === false
    && value?.transition_operation_exposed === false
    && value?.consume_plan_exposed === false
    && value?.runtime_mounted === false
    && value?.route_mounted === false
    && value?.worker_mounted === false
    && value?.provider_dispatch_allowed === false
    && value?.production_ready === false
    && typeof value?.readExecutionAggregate === 'function'
    && typeof value?.prepareExecution === 'function'
    && typeof value?.appendJournalEvent === 'function'
    && typeof value?.appendReconciliation === 'function'
    && typeof value?.finalizeRun === 'function'
    && typeof value?.transitionOperation === 'undefined'
    && typeof value?.consumePlan === 'undefined'
    && typeof value?.recordReconciliation === 'undefined');
}
