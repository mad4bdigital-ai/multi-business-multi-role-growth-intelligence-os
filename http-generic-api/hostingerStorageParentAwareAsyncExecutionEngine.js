import { createHash } from 'node:crypto';
import {
  HOSTINGER_STORAGE_EXECUTOR_PROTOCOL_VERSION,
  verifyHostingerStorageSyntheticExecutionProtocol,
} from './hostingerStorageExecutorProtocol.js';
import {
  HOSTINGER_STORAGE_SYNTHETIC_ADAPTER_VERSION,
  isCanonicalHostingerStorageSyntheticAdapter,
} from './hostingerStorageSyntheticAdapter.js';
import {
  HOSTINGER_STORAGE_DURABLE_TENANT_REPOSITORY_FACADE_VERSION,
  isCanonicalHostingerStorageDurableTenantRepositoryFacade,
} from './hostingerStorageDurableTenantRepositoryFacade.js';

export const HOSTINGER_STORAGE_PARENT_AWARE_ASYNC_EXECUTION_ENGINE_VERSION = 'spec014-hostinger-storage-parent-aware-async-execution-engine-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-parent-aware-async-execution-engine');
const SHA256_RE = /^[0-9a-f]{64}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const ALLOWED_OPTIONS = new Set(['facade', 'adapter']);

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
    throw fail(400, 'STORAGE_ASYNC_ENGINE_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_ASYNC_ENGINE_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(400, 'STORAGE_ASYNC_ENGINE_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return normalized;
}

function assertDataOnly(value, path = 'value', active = new WeakSet(), depth = 0) {
  if (depth > 24) throw fail(400, 'STORAGE_ASYNC_ENGINE_DATA_TOO_DEEP', 'Execution inputs exceeded the supported depth.', { path });
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') throw fail(400, 'STORAGE_ASYNC_ENGINE_DATA_INVALID', 'Execution inputs must contain data values only.', { path });
  if (active.has(value)) throw fail(400, 'STORAGE_ASYNC_ENGINE_DATA_CYCLE', 'Execution inputs must not contain cycles.', { path });
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw fail(400, 'STORAGE_ASYNC_ENGINE_DATA_INVALID', 'Execution inputs must use plain data objects.', { path });
  }
  active.add(value);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        throw fail(400, 'STORAGE_ASYNC_ENGINE_ACCESSOR_REJECTED', 'Execution inputs must not contain accessor properties.', { path: `${path}.${key}` });
      }
      if (key === 'secrets_included' && descriptor.value !== false) {
        throw fail(400, 'STORAGE_ASYNC_ENGINE_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
      }
      if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command)/i.test(key)) {
        throw fail(400, 'STORAGE_ASYNC_ENGINE_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Execution inputs cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
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

function reconciliationId(runId) {
  const hex = createHash('sha256').update(`${runId}\0durable-async-reconciliation`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-c${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function eventId(runId, ordinal, phase) {
  return `${runId}:${ordinal}:${phase}`;
}

function assertFactories(facade, adapter) {
  if (!isCanonicalHostingerStorageDurableTenantRepositoryFacade(facade)
    || facade.facade_version !== HOSTINGER_STORAGE_DURABLE_TENANT_REPOSITORY_FACADE_VERSION
    || facade.async_only !== true
    || facade.runtime_mounted !== false
    || facade.route_mounted !== false
    || facade.worker_mounted !== false
    || facade.provider_dispatch_allowed !== false
    || facade.production_ready !== false) {
    throw fail(409, 'STORAGE_ASYNC_ENGINE_FACADE_INVALID', 'An unmounted canonical durable Tenant repository facade is required.');
  }
  if (!isCanonicalHostingerStorageSyntheticAdapter(adapter)
    || adapter.adapter_version !== HOSTINGER_STORAGE_SYNTHETIC_ADAPTER_VERSION
    || adapter.synthetic_only !== true
    || adapter.production_ready !== false
    || adapter.live_provider !== false
    || adapter.filesystem_access !== false
    || adapter.shell_access !== false
    || typeof adapter.mutateExact !== 'function'
    || typeof adapter.readbackItem !== 'function'
    || typeof adapter.readMutationReceipt !== 'function') {
    throw fail(409, 'STORAGE_ASYNC_ENGINE_ADAPTER_INVALID', 'A canonical non-provider synthetic adapter is required.');
  }
}

function normalizeExecution(input = {}) {
  const copy = snapshot(input, 'execution');
  const protocol = copy.protocol;
  const protocolDigest = hash(copy.protocol_digest ?? copy.protocolDigest, 'protocol_digest');
  verifyHostingerStorageSyntheticExecutionProtocol({ protocol, expected_digest: protocolDigest });
  const preparation = copy.preparation;
  if (!preparation || typeof preparation !== 'object' || Array.isArray(preparation)) {
    throw fail(400, 'STORAGE_ASYNC_ENGINE_PREPARATION_REQUIRED', 'A durable preparation envelope is required.');
  }
  const executionEpoch = integer(copy.execution_epoch ?? copy.executionEpoch, 'execution_epoch', 1);
  const operationId = identifier(protocol.operation_id, 'protocol.operation_id', 36);
  const planId = identifier(protocol.plan_id, 'protocol.plan_id', 36);
  const runId = identifier(protocol.run_id, 'protocol.run_id', 36);
  const targetId = identifier(protocol.target_id, 'protocol.target_id', 36);
  if (protocol.protocol_version !== HOSTINGER_STORAGE_EXECUTOR_PROTOCOL_VERSION) {
    throw fail(409, 'STORAGE_ASYNC_ENGINE_PROTOCOL_VERSION_MISMATCH', 'Unexpected execution protocol version.');
  }
  if (protocol.plan_expires_at_epoch <= executionEpoch || protocol.lease_expires_at_epoch <= executionEpoch) {
    throw fail(409, 'STORAGE_ASYNC_ENGINE_EXECUTION_WINDOW_EXPIRED', 'Plan and lease must remain valid for the deterministic execution epoch.');
  }
  const mismatches = [];
  if ((preparation.operation_id ?? preparation.operationId) !== operationId) mismatches.push('operation_id');
  if ((preparation.plan_id ?? preparation.planId) !== planId) mismatches.push('plan_id');
  if ((preparation.expected_plan_hash ?? preparation.expectedPlanHash) !== protocol.plan_hash) mismatches.push('plan_hash');
  if ((preparation.run?.run_id ?? preparation.run?.runId) !== runId) mismatches.push('run_id');
  if ((preparation.run?.target_id ?? preparation.run?.targetId) !== targetId) mismatches.push('target_id');
  if ((preparation.run?.lease_id ?? preparation.run?.leaseId) !== protocol.lease_id) mismatches.push('lease_id');
  if (Number(preparation.run?.lease_generation ?? preparation.run?.leaseGeneration) !== Number(protocol.lease_generation)) mismatches.push('lease_generation');
  if (Number(preparation.run?.lease_expires_at_epoch ?? preparation.run?.leaseExpiresAtEpoch) !== Number(protocol.lease_expires_at_epoch)) mismatches.push('lease_expires_at_epoch');
  if (mismatches.length) {
    throw fail(409, 'STORAGE_ASYNC_ENGINE_PREPARATION_BINDING_MISMATCH', 'Durable preparation does not match the authorized protocol.', { mismatches });
  }
  const parentItems = preparation.plan_items ?? preparation.planItems;
  if (!Array.isArray(parentItems) || parentItems.length !== protocol.items.length) {
    throw fail(409, 'STORAGE_ASYNC_ENGINE_PLAN_ITEM_COUNT_MISMATCH', 'Parent plan-item count must match the protocol.');
  }
  for (const [index, item] of protocol.items.entries()) {
    const parent = parentItems[index];
    const itemMismatches = [];
    if (Number(parent?.ordinal) !== Number(item.ordinal)) itemMismatches.push('ordinal');
    if ((parent?.item_id ?? parent?.itemId) !== item.item_id) itemMismatches.push('item_id');
    if ((parent?.item_hash ?? parent?.itemHash) !== item.item_hash) itemMismatches.push('item_hash');
    if ((parent?.path_ref ?? parent?.pathRef) !== item.path_ref) itemMismatches.push('path_ref');
    if (String(parent?.size_bytes ?? parent?.sizeBytes) !== String(item.expected?.size_bytes)) itemMismatches.push('size_bytes');
    if ((parent?.expected_file_type ?? parent?.expectedFileType) !== item.expected?.file_type) itemMismatches.push('file_type');
    if (itemMismatches.length) {
      throw fail(409, 'STORAGE_ASYNC_ENGINE_PLAN_ITEM_BINDING_MISMATCH', 'A durable plan-item parent differs from the execution protocol.', {
        item_id: item.item_id,
        mismatches: itemMismatches,
      });
    }
  }
  return deepFreeze({
    protocol,
    protocol_digest: protocolDigest,
    preparation,
    execution_epoch: executionEpoch,
    operation_id: operationId,
    plan_id: planId,
    run_id: runId,
    target_id: targetId,
    initial_checkpoint_digest: hash(preparation.run?.checkpoint_digest ?? preparation.run?.checkpointDigest, 'preparation.run.checkpoint_digest'),
    secrets_included: false,
  });
}

function classify(receipt, observed) {
  if (receipt?.outcome === 'deleted') return observed?.exists === false ? 'deleted' : 'conflict';
  if (receipt?.outcome === 'skipped_changed') return observed?.exists === true && observed?.matches_plan === false ? 'skipped_changed' : 'conflict';
  if (receipt?.outcome === 'skipped_missing') return observed?.exists === false ? 'skipped_missing' : 'conflict';
  return 'conflict';
}

function summarize(itemResults, protocol) {
  const counts = {
    deleted: 0,
    skipped_changed: 0,
    skipped_missing: 0,
    conflict: 0,
  };
  let deletedBytes = 0n;
  for (const row of itemResults) {
    counts[row.classification] += 1;
    if (row.classification === 'deleted') {
      const item = protocol.items.find((candidate) => candidate.item_id === row.item_id);
      deletedBytes += BigInt(item?.expected?.size_bytes || 0);
    }
  }
  let outcome = 'still_unknown';
  if (counts.conflict > 0) outcome = 'conflict';
  else if (counts.deleted === protocol.items.length) outcome = 'applied';
  else if (counts.deleted > 0 || counts.skipped_changed > 0 || counts.skipped_missing > 0) outcome = 'partially_applied';
  return { counts, deleted_bytes: deletedBytes.toString(), outcome };
}

function runFinalization({ state, epoch, summary, journalDigest, checkpointDigest, resultDigest = null }) {
  return {
    finished_at_epoch: epoch,
    state,
    deleted_count: summary.counts.deleted,
    deleted_bytes: summary.deleted_bytes,
    skipped_count: summary.counts.skipped_changed,
    missing_count: summary.counts.skipped_missing,
    failed_count: summary.counts.conflict,
    journal_digest: journalDigest,
    checkpoint_digest: checkpointDigest,
    after_snapshot_id: null,
    provider_response_classification: 'synthetic_non_provider',
    unknown_outcome: state === 'unknown_outcome',
    readback_status: state === 'readback_pending' ? 'complete' : state,
    result_digest: resultDigest,
    secrets_included: false,
  };
}

export function createHostingerStorageParentAwareAsyncExecutionEngine(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail(500, 'STORAGE_ASYNC_ENGINE_OPTIONS_INVALID', 'Engine options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unsupported.length) {
    throw fail(409, 'STORAGE_ASYNC_ENGINE_OVERRIDE_FORBIDDEN', 'Only canonical facade and adapter dependencies may be supplied.', { unsupported_options: unsupported.sort() });
  }
  const { facade, adapter } = options;
  assertFactories(facade, adapter);

  async function execute(input = {}) {
    const execution = normalizeExecution(input);
    const preparationResult = await facade.prepareExecution(execution.preparation);
    if (preparationResult?.ok !== true || preparationResult?.evidence?.operation_id !== execution.operation_id
      || preparationResult?.evidence?.plan_id !== execution.plan_id
      || preparationResult?.evidence?.run_id !== execution.run_id) {
      throw fail(409, 'STORAGE_ASYNC_ENGINE_PREPARATION_RESULT_INVALID', 'Durable preparation result does not match the execution protocol.');
    }

    let sequence = 0;
    const journalEvents = [];
    const itemResults = [];
    for (const item of execution.protocol.items) {
      const prepared = {
        event_id: eventId(execution.run_id, item.ordinal, 'prepared'),
        operation_id: execution.operation_id,
        run_id: execution.run_id,
        plan_id: execution.plan_id,
        item_id: item.item_id,
        item_hash: item.item_hash,
        sequence: ++sequence,
        phase: 'prepared',
        result: 'prepared',
        prepared_at_epoch: execution.execution_epoch,
        observed_stat_digest: digest(item.expected),
        checkpoint_at_epoch: execution.execution_epoch,
        secrets_included: false,
      };
      await facade.appendJournalEvent(prepared);
      journalEvents.push(prepared);

      const receipt = await Promise.resolve(adapter.mutateExact({
        operation_id: execution.operation_id,
        run_id: execution.run_id,
        item,
      }));
      const resultEvent = {
        event_id: eventId(execution.run_id, item.ordinal, 'result'),
        operation_id: execution.operation_id,
        run_id: execution.run_id,
        plan_id: execution.plan_id,
        item_id: item.item_id,
        item_hash: item.item_hash,
        sequence: ++sequence,
        phase: 'result',
        result: receipt.outcome,
        result_evidence_digest: receipt.receipt_digest,
        checkpoint_at_epoch: execution.execution_epoch,
        secrets_included: false,
      };
      await facade.appendJournalEvent(resultEvent);
      journalEvents.push(resultEvent);

      const observed = await Promise.resolve(adapter.readbackItem({
        item_id: item.item_id,
        expected_item_hash: item.item_hash,
        expected: item.expected,
      }));
      const classification = classify(receipt, observed);
      const readbackEvent = {
        event_id: eventId(execution.run_id, item.ordinal, 'readback'),
        operation_id: execution.operation_id,
        run_id: execution.run_id,
        plan_id: execution.plan_id,
        item_id: item.item_id,
        item_hash: item.item_hash,
        sequence: ++sequence,
        phase: 'readback',
        result: classification,
        result_evidence_digest: observed.evidence_digest,
        checkpoint_at_epoch: execution.execution_epoch,
        readback_state: classification,
        secrets_included: false,
      };
      await facade.appendJournalEvent(readbackEvent);
      journalEvents.push(readbackEvent);
      itemResults.push(deepFreeze({
        item_id: item.item_id,
        ordinal: item.ordinal,
        classification,
        receipt_digest: receipt.receipt_digest,
        observed_evidence_digest: observed.evidence_digest,
        secrets_included: false,
      }));
    }

    const summary = summarize(itemResults, execution.protocol);
    const journalDigest = digest(journalEvents);
    const readbackDigest = digest(itemResults);
    const checkpointReadback = digest({ phase: 'readback_pending', protocol_digest: execution.protocol_digest, journal_digest: journalDigest, readback_digest: readbackDigest });
    const checkpointReconciling = digest({ phase: 'reconciling', previous: checkpointReadback, outcome: summary.outcome });

    await facade.finalizeRun({
      run_id: execution.run_id,
      expected_checkpoint_digest: execution.initial_checkpoint_digest,
      finalization: runFinalization({
        state: 'readback_pending',
        epoch: execution.execution_epoch,
        summary,
        journalDigest,
        checkpointDigest: checkpointReadback,
      }),
      secrets_included: false,
    });
    let operationVersion = Number(preparationResult.evidence.operation_version);
    const readbackTransition = await facade.advanceExecutionState({
      operation_id: execution.operation_id,
      expected_version: operationVersion,
      expected_current_state: 'executing',
      next_state: 'readback_pending',
      now_epoch: execution.execution_epoch,
      secrets_included: false,
    });
    operationVersion = Number(readbackTransition.operation.version);

    await facade.finalizeRun({
      run_id: execution.run_id,
      expected_checkpoint_digest: checkpointReadback,
      finalization: runFinalization({
        state: 'reconciling',
        epoch: execution.execution_epoch,
        summary,
        journalDigest,
        checkpointDigest: checkpointReconciling,
      }),
      secrets_included: false,
    });
    const reconcilingTransition = await facade.advanceExecutionState({
      operation_id: execution.operation_id,
      expected_version: operationVersion,
      expected_current_state: 'readback_pending',
      next_state: 'reconciling',
      now_epoch: execution.execution_epoch,
      secrets_included: false,
    });
    operationVersion = Number(reconcilingTransition.operation.version);

    const reconciliationCore = {
      reconciliation_key: 'hostinger_storage_parent_aware_async_reconciliation_v1',
      operation_id: execution.operation_id,
      run_id: execution.run_id,
      plan_id: execution.plan_id,
      protocol_digest: execution.protocol_digest,
      journal_digest: journalDigest,
      readback_digest: readbackDigest,
      item_results: itemResults,
      counts: summary.counts,
      deleted_bytes: summary.deleted_bytes,
      outcome: summary.outcome,
      retry_permission: summary.outcome === 'not_applied',
      synthetic_only: true,
      provider_dispatch_allowed: false,
      secrets_included: false,
    };
    const reconciliationDigest = digest(reconciliationCore);
    await facade.appendReconciliation({
      reconciliation_id: reconciliationId(execution.run_id),
      operation_id: execution.operation_id,
      run_id: execution.run_id,
      input_evidence_hashes: {
        protocol: execution.protocol_digest,
        preparation: preparationResult.evidence_digest,
        journal: journalDigest,
        readback: readbackDigest,
      },
      item_accounting: {
        total: execution.protocol.items.length,
        prepared: execution.protocol.items.length,
        result: execution.protocol.items.length,
        readback: execution.protocol.items.length,
        conflict: summary.counts.conflict,
        secrets_included: false,
      },
      outcome: summary.outcome,
      retry_permission: summary.outcome === 'not_applied',
      reviewed_at_epoch: execution.execution_epoch,
      evidence_digest: reconciliationDigest,
      secrets_included: false,
    });

    const finalRunState = summary.outcome === 'conflict' ? 'failed' : summary.outcome === 'still_unknown' ? 'unknown_outcome' : 'completed';
    const finalOperationState = summary.outcome === 'conflict' ? 'blocked' : summary.outcome === 'still_unknown' ? 'unknown_outcome' : 'completed';
    const resultCore = {
      engine_key: 'hostinger_storage_parent_aware_async_execution_result_v1',
      engine_version: HOSTINGER_STORAGE_PARENT_AWARE_ASYNC_EXECUTION_ENGINE_VERSION,
      operation_id: execution.operation_id,
      run_id: execution.run_id,
      plan_id: execution.plan_id,
      outcome: summary.outcome,
      item_results: itemResults,
      counts: summary.counts,
      deleted_bytes: summary.deleted_bytes,
      protocol_digest: execution.protocol_digest,
      preparation_digest: preparationResult.evidence_digest,
      journal_digest: journalDigest,
      readback_digest: readbackDigest,
      reconciliation_digest: reconciliationDigest,
      synthetic_only: true,
      live_provider_mutated: false,
      provider_dispatch_allowed: false,
      runtime_mounted: false,
      route_mounted: false,
      worker_mounted: false,
      production_ready: false,
      secrets_included: false,
    };
    const resultDigest = digest(resultCore);
    const checkpointTerminal = digest({ phase: finalRunState, previous: checkpointReconciling, result_digest: resultDigest });

    await facade.finalizeRun({
      run_id: execution.run_id,
      expected_checkpoint_digest: checkpointReconciling,
      finalization: runFinalization({
        state: finalRunState,
        epoch: execution.execution_epoch,
        summary,
        journalDigest,
        checkpointDigest: checkpointTerminal,
        resultDigest,
      }),
      secrets_included: false,
    });
    const terminalTransition = await facade.advanceExecutionState({
      operation_id: execution.operation_id,
      expected_version: operationVersion,
      expected_current_state: 'reconciling',
      next_state: finalOperationState,
      terminal_reason: finalOperationState === 'blocked' ? 'durable_async_reconciliation_conflict' : null,
      now_epoch: execution.execution_epoch,
      secrets_included: false,
    });

    return deepFreeze({
      ok: true,
      ...resultCore,
      result_digest: resultDigest,
      final_run_state: finalRunState,
      final_operation_state: terminalTransition.operation.state,
      final_operation_version: Number(terminalTransition.operation.version),
    });
  }

  const engine = {
    engine_key: 'hostinger_storage_parent_aware_async_execution_engine_v1',
    engine_version: HOSTINGER_STORAGE_PARENT_AWARE_ASYNC_EXECUTION_ENGINE_VERSION,
    facade_version: facade.facade_version,
    adapter_version: adapter.adapter_version,
    async_only: true,
    synthetic_only: true,
    live_provider: false,
    filesystem_access: false,
    shell_access: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    execute,
    secrets_included: false,
  };
  Object.defineProperty(engine, BRAND, { value: true, enumerable: false });
  return Object.freeze(engine);
}

export function isCanonicalHostingerStorageParentAwareAsyncExecutionEngine(value) {
  return Boolean(value?.[BRAND] === true
    && Object.isFrozen(value)
    && value?.engine_key === 'hostinger_storage_parent_aware_async_execution_engine_v1'
    && value?.engine_version === HOSTINGER_STORAGE_PARENT_AWARE_ASYNC_EXECUTION_ENGINE_VERSION
    && value?.async_only === true
    && value?.synthetic_only === true
    && value?.live_provider === false
    && value?.filesystem_access === false
    && value?.shell_access === false
    && value?.runtime_mounted === false
    && value?.route_mounted === false
    && value?.worker_mounted === false
    && value?.provider_dispatch_allowed === false
    && value?.production_ready === false
    && typeof value?.execute === 'function');
}
