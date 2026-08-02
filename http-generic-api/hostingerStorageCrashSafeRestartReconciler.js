import { createHash } from 'node:crypto';
import {
  HOSTINGER_STORAGE_DURABLE_TENANT_REPOSITORY_FACADE_VERSION,
  isCanonicalHostingerStorageDurableTenantRepositoryFacade,
} from './hostingerStorageDurableTenantRepositoryFacade.js';

export const HOSTINGER_STORAGE_CRASH_SAFE_RESTART_RECONCILER_VERSION = 'spec014-hostinger-storage-crash-safe-restart-reconciler-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-crash-safe-restart-reconciler');
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const ALLOWED_OPTIONS = new Set(['facade']);
const ACTIVE_RUN_STATES = new Set(['executing', 'readback_pending', 'reconciling', 'unknown_outcome']);
const TERMINAL_RUN_STATES = new Set(['completed', 'failed']);
const ACTIVE_OPERATION_STATES = new Set(['executing', 'readback_pending', 'reconciling', 'unknown_outcome']);
const TERMINAL_OPERATION_STATES = new Set(['completed', 'blocked', 'failed']);
const PHASES = Object.freeze(['prepared', 'result', 'readback']);
const RESULT_OUTCOMES = new Set(['deleted', 'skipped_changed', 'skipped_missing']);
const READBACK_OUTCOMES = new Set(['deleted', 'skipped_changed', 'skipped_missing', 'conflict']);

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
    throw fail(400, 'STORAGE_RESTART_RECONCILER_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field, { nullable = false } = {}) {
  const normalized = text(value, 64).toLowerCase();
  if (!normalized && nullable) return null;
  if (!SHA256_RE.test(normalized)) {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(400, 'STORAGE_RESTART_RECONCILER_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return normalized;
}

function uint64(value, field) {
  const normalized = String(value ?? '');
  if (!/^(?:0|[1-9][0-9]{0,19})$/u.test(normalized)
    || BigInt(normalized) > 18446744073709551615n) {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_UINT64_INVALID', 'An unsigned BIGINT-compatible value is required.', { field });
  }
  return normalized;
}

function assertDataOnly(value, path = 'value', active = new WeakSet(), depth = 0) {
  if (depth > 24) throw fail(400, 'STORAGE_RESTART_RECONCILER_DATA_TOO_DEEP', 'Recovery input exceeded the supported depth.', { path });
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') throw fail(400, 'STORAGE_RESTART_RECONCILER_DATA_INVALID', 'Recovery input must contain data values only.', { path });
  if (active.has(value)) throw fail(400, 'STORAGE_RESTART_RECONCILER_DATA_CYCLE', 'Recovery input must not contain cycles.', { path });
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw fail(400, 'STORAGE_RESTART_RECONCILER_DATA_INVALID', 'Recovery input must use plain data objects.', { path });
  }
  active.add(value);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        throw fail(400, 'STORAGE_RESTART_RECONCILER_ACCESSOR_REJECTED', 'Recovery input must not contain accessor properties.', { path: `${path}.${key}` });
      }
      if (key === 'secrets_included' && descriptor.value !== false) {
        throw fail(400, 'STORAGE_RESTART_RECONCILER_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
      }
      if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command)/i.test(key)) {
        throw fail(400, 'STORAGE_RESTART_RECONCILER_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Recovery input cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
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

function deterministicUuid(seed, variant = 'd') {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function normalizeRequest(input = {}) {
  const copy = snapshot(input, 'restart_reconciliation');
  return deepFreeze({
    operation_id: identifier(copy.operation_id ?? copy.operationId, 'operation_id', 36),
    plan_id: identifier(copy.plan_id ?? copy.planId, 'plan_id', 36),
    run_id: identifier(copy.run_id ?? copy.runId, 'run_id', 36),
    recovery_epoch: integer(copy.recovery_epoch ?? copy.recoveryEpoch, 'recovery_epoch', 1),
    secrets_included: false,
  });
}

function assertFacade(facade) {
  if (!isCanonicalHostingerStorageDurableTenantRepositoryFacade(facade)
    || facade.facade_version !== HOSTINGER_STORAGE_DURABLE_TENANT_REPOSITORY_FACADE_VERSION
    || facade.async_only !== true
    || facade.runtime_mounted !== false
    || facade.route_mounted !== false
    || facade.worker_mounted !== false
    || facade.provider_dispatch_allowed !== false
    || facade.production_ready !== false
    || typeof facade.readExecutionAggregate !== 'function'
    || typeof facade.readExecutionRun !== 'function'
    || typeof facade.readExecutionPlanItems !== 'function'
    || typeof facade.finalizeRun !== 'function'
    || typeof facade.advanceExecutionState !== 'function'
    || typeof facade.appendReconciliation !== 'function') {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_FACADE_INVALID', 'An unmounted canonical durable Tenant repository facade with restart read support is required.');
  }
}

function requireBindings({ aggregate, runRead, itemsRead, request }) {
  const operation = aggregate?.operation;
  if (!operation) {
    throw fail(404, 'STORAGE_RESTART_RECONCILER_OPERATION_NOT_FOUND', 'Durable operation aggregate was not found.', { operation_id: request.operation_id });
  }
  if (operation.operation_id !== request.operation_id || operation.context_mode !== 'tenant') {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_OPERATION_BINDING_MISMATCH', 'Recovery is limited to the exact Tenant operation.', {
      operation_id: request.operation_id,
      observed_context_mode: operation.context_mode || null,
    });
  }
  const plan = Array.isArray(aggregate.plans)
    ? aggregate.plans.find((row) => row.plan_id === request.plan_id)
    : null;
  if (!plan || plan.operation_id !== request.operation_id || plan.consumed !== true
    || plan.consumed_run_id !== request.run_id) {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_PLAN_BINDING_MISMATCH', 'Immutable plan is not consumed by the requested durable run.');
  }
  const run = runRead?.run;
  if (runRead?.found !== true || !run || run.run_id !== request.run_id
    || run.operation_id !== request.operation_id || run.plan_id !== request.plan_id) {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_RUN_BINDING_MISMATCH', 'Durable run does not belong to the requested operation and plan.');
  }
  const items = Array.isArray(itemsRead?.items) ? itemsRead.items : [];
  if (itemsRead?.found !== true || items.length !== Number(plan.item_count)
    || Number(itemsRead.item_count) !== Number(plan.item_count)) {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_PLAN_ITEM_COUNT_MISMATCH', 'Durable plan-item parents do not match the immutable plan item count.', {
      expected: Number(plan.item_count),
      observed: items.length,
    });
  }
  const ordinals = items.map((row) => Number(row.ordinal));
  if (ordinals.some((ordinal, index) => ordinal !== index + 1)) {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_PLAN_ITEM_ORDINAL_GAP', 'Durable plan-item ordinals are not contiguous.', { ordinals });
  }
  if (!ACTIVE_RUN_STATES.has(run.state) && !TERMINAL_RUN_STATES.has(run.state)) {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_RUN_STATE_INVALID', 'Durable run state cannot be reconciled.', { state: run.state });
  }
  if (!ACTIVE_OPERATION_STATES.has(operation.state) && !TERMINAL_OPERATION_STATES.has(operation.state)) {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_OPERATION_STATE_INVALID', 'Durable operation state cannot be reconciled.', { state: operation.state });
  }
  return { operation, plan, run, items };
}

function normalizeJournalRows(aggregate, request) {
  const rows = (Array.isArray(aggregate?.journals) ? aggregate.journals : [])
    .filter((row) => row.run_id === request.run_id)
    .map((row) => snapshot(row, 'journal'))
    .sort((left, right) => Number(left.sequence) - Number(right.sequence));
  const blockers = [];
  const seenEventIds = new Set();
  for (const [index, row] of rows.entries()) {
    if (row.operation_id !== request.operation_id || row.plan_id !== request.plan_id || row.run_id !== request.run_id) {
      throw fail(409, 'STORAGE_RESTART_RECONCILER_JOURNAL_BINDING_MISMATCH', 'A durable journal row belongs to a different operation, plan, or run.');
    }
    const sequence = integer(row.sequence, `journals[${index}].sequence`, 1);
    if (sequence !== index + 1) blockers.push('journal_sequence_gap');
    const eventId = identifier(row.runtime_event_id ?? row.event_id ?? row.id, `journals[${index}].event_id`, 191);
    if (seenEventIds.has(eventId)) {
      throw fail(409, 'STORAGE_RESTART_RECONCILER_JOURNAL_EVENT_DUPLICATE', 'Durable journal event identity is duplicated.', { event_id: eventId });
    }
    seenEventIds.add(eventId);
  }
  return { rows, blockers };
}

function analyzeEvidence({ aggregate, items, plan, request }) {
  const itemByParentId = new Map(items.map((item) => [item.id, item]));
  const { rows, blockers } = normalizeJournalRows(aggregate, request);
  const groups = new Map();
  for (const [index, row] of rows.entries()) {
    const parentId = identifier(row.plan_item_id, `journals[${index}].plan_item_id`, 36);
    const parent = itemByParentId.get(parentId);
    if (!parent) {
      throw fail(409, 'STORAGE_RESTART_RECONCILER_JOURNAL_PARENT_MISSING', 'Journal row does not bind a durable plan-item parent.', { plan_item_id: parentId });
    }
    const itemHash = hash(row.item_hash, `journals[${index}].item_hash`);
    if (itemHash !== parent.item_hash) {
      throw fail(409, 'STORAGE_RESTART_RECONCILER_JOURNAL_ITEM_HASH_MISMATCH', 'Journal item hash differs from the durable plan-item parent.', { plan_item_id: parentId });
    }
    const phase = text(row.phase, 32).toLowerCase();
    if (!PHASES.includes(phase)) {
      throw fail(409, 'STORAGE_RESTART_RECONCILER_JOURNAL_PHASE_INVALID', 'Unexpected durable journal phase.', { phase });
    }
    const group = groups.get(parentId) || { parent, phases: new Map() };
    if (group.phases.has(phase)) {
      throw fail(409, 'STORAGE_RESTART_RECONCILER_JOURNAL_PHASE_DUPLICATE', 'A plan item has duplicate durable journal phases.', { plan_item_id: parentId, phase });
    }
    group.phases.set(phase, row);
    groups.set(parentId, group);
  }

  const itemResults = [];
  const counts = { deleted: 0, skipped_changed: 0, skipped_missing: 0, conflict: 0 };
  let deletedBytes = 0n;
  let preparedCount = 0;
  let resultCount = 0;
  let readbackCount = 0;

  for (const item of items) {
    const group = groups.get(item.id);
    const prepared = group?.phases.get('prepared') || null;
    const result = group?.phases.get('result') || null;
    const readback = group?.phases.get('readback') || null;
    if (prepared) preparedCount += 1;
    if (result) resultCount += 1;
    if (readback) readbackCount += 1;
    if (!prepared || !result || !readback) {
      blockers.push(`incomplete_item:${item.id}`);
      continue;
    }
    if (!(Number(prepared.sequence) < Number(result.sequence) && Number(result.sequence) < Number(readback.sequence))) {
      throw fail(409, 'STORAGE_RESTART_RECONCILER_JOURNAL_PHASE_ORDER_INVALID', 'Prepared, result, and readback phases are out of order.', { plan_item_id: item.id });
    }
    const mutationOutcome = text(result.result, 64).toLowerCase();
    const readbackOutcome = text(readback.readback_state ?? readback.result, 64).toLowerCase();
    if (!RESULT_OUTCOMES.has(mutationOutcome) || !READBACK_OUTCOMES.has(readbackOutcome)) {
      throw fail(409, 'STORAGE_RESTART_RECONCILER_JOURNAL_OUTCOME_INVALID', 'Durable mutation or readback outcome is unsupported.', {
        plan_item_id: item.id,
        mutation_outcome: mutationOutcome,
        readback_outcome: readbackOutcome,
      });
    }
    if (readbackOutcome !== 'conflict' && readbackOutcome !== mutationOutcome) {
      throw fail(409, 'STORAGE_RESTART_RECONCILER_JOURNAL_OUTCOME_MISMATCH', 'Durable mutation receipt and readback classification disagree.', { plan_item_id: item.id });
    }
    counts[readbackOutcome] += 1;
    if (readbackOutcome === 'deleted') deletedBytes += BigInt(uint64(item.size_bytes, `items.${item.id}.size_bytes`));
    itemResults.push({
      plan_item_id: item.id,
      ordinal: Number(item.ordinal),
      item_hash: item.item_hash,
      mutation_outcome: mutationOutcome,
      readback_outcome: readbackOutcome,
      result_evidence_digest: hash(result.result_evidence_digest ?? result.evidence_digest, `items.${item.id}.result_evidence_digest`),
      readback_evidence_digest: hash(readback.result_evidence_digest ?? readback.evidence_digest, `items.${item.id}.readback_evidence_digest`),
      secrets_included: false,
    });
  }

  const uniqueBlockers = [...new Set(blockers)].sort();
  const complete = uniqueBlockers.length === 0
    && groups.size === items.length
    && rows.length === items.length * PHASES.length
    && preparedCount === items.length
    && resultCount === items.length
    && readbackCount === items.length;
  let outcome = 'still_unknown';
  if (complete) {
    if (counts.conflict > 0) outcome = 'conflict';
    else if (counts.deleted === items.length) outcome = 'applied';
    else outcome = 'partially_applied';
  }
  const journalCore = rows.map((row) => ({
    event_id: row.runtime_event_id ?? row.event_id ?? row.id,
    plan_item_id: row.plan_item_id,
    item_hash: row.item_hash,
    sequence: Number(row.sequence),
    phase: row.phase,
    result: row.result,
    readback_state: row.readback_state || null,
    result_evidence_digest: row.result_evidence_digest ?? row.evidence_digest ?? null,
    secrets_included: false,
  }));
  const analysis = {
    analysis_key: 'hostinger_storage_crash_safe_restart_analysis_v1',
    operation_id: request.operation_id,
    plan_id: request.plan_id,
    run_id: request.run_id,
    plan_hash: hash(plan.plan_hash, 'plan.plan_hash'),
    expected_item_count: Number(plan.item_count),
    journal_row_count: rows.length,
    prepared_count: preparedCount,
    result_count: resultCount,
    readback_count: readbackCount,
    complete,
    blockers: uniqueBlockers,
    counts,
    deleted_bytes: deletedBytes.toString(),
    outcome,
    item_results: itemResults.sort((left, right) => left.ordinal - right.ordinal),
    journal_digest: digest(journalCore),
    plan_item_set_digest: digest(items.map((item) => ({
      id: item.id,
      plan_id: item.plan_id,
      ordinal: Number(item.ordinal),
      item_hash: item.item_hash,
      size_bytes: String(item.size_bytes),
      secrets_included: false,
    }))),
    mutation_replayed: false,
    provider_called: false,
    automatic_retry_allowed: false,
    secrets_included: false,
  };
  return deepFreeze({ ...analysis, analysis_digest: digest(analysis) });
}

function runFinalization({ run, state, epoch, analysis, checkpointDigest, resultDigest = null }) {
  return {
    finished_at_epoch: epoch,
    state,
    deleted_count: analysis.counts.deleted,
    deleted_bytes: analysis.deleted_bytes,
    skipped_count: analysis.counts.skipped_changed,
    missing_count: analysis.counts.skipped_missing,
    failed_count: analysis.counts.conflict,
    journal_digest: analysis.journal_digest,
    checkpoint_digest: checkpointDigest,
    after_snapshot_id: null,
    provider_response_classification: 'restart_evidence_only_no_provider_call',
    unknown_outcome: state === 'unknown_outcome',
    readback_status: state === 'unknown_outcome' ? 'incomplete' : state === 'readback_pending' ? 'complete' : state,
    result_digest: resultDigest,
    prior_run_record_digest: run.record_digest || null,
    secrets_included: false,
  };
}

function reconciliationEnvelope({ request, aggregate, runRead, itemsRead, analysis, outcome }) {
  const core = {
    reconciliation_key: 'hostinger_storage_crash_safe_restart_reconciliation_v1',
    operation_id: request.operation_id,
    plan_id: request.plan_id,
    run_id: request.run_id,
    recovery_epoch: request.recovery_epoch,
    outcome,
    complete_evidence: analysis.complete,
    blockers: analysis.blockers,
    counts: analysis.counts,
    deleted_bytes: analysis.deleted_bytes,
    journal_digest: analysis.journal_digest,
    analysis_digest: analysis.analysis_digest,
    mutation_replayed: false,
    provider_called: false,
    automatic_retry_allowed: false,
    secrets_included: false,
  };
  const evidenceDigest = digest(core);
  return deepFreeze({
    core,
    evidence_digest: evidenceDigest,
    input_evidence_hashes: {
      aggregate: hash(aggregate.aggregate_digest, 'aggregate.aggregate_digest'),
      run: hash(runRead.run_digest ?? runRead.run?.record_digest, 'run_read.run_digest'),
      plan_items: hash(itemsRead.item_set_digest, 'items_read.item_set_digest'),
      journal: analysis.journal_digest,
      analysis: analysis.analysis_digest,
    },
    reconciliation_id: deterministicUuid(`${request.run_id}\0${evidenceDigest}\0restart-reconciliation`, 'e'),
    secrets_included: false,
  });
}

export function createHostingerStorageCrashSafeRestartReconciler(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail(500, 'STORAGE_RESTART_RECONCILER_OPTIONS_INVALID', 'Reconciler options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unsupported.length) {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_OVERRIDE_FORBIDDEN', 'Only the canonical durable facade may be supplied.', { unsupported_options: unsupported.sort() });
  }
  const { facade } = options;
  assertFacade(facade);

  async function reconcile(input = {}) {
    const request = normalizeRequest(input);
    const aggregate = await facade.readExecutionAggregate(request.operation_id);
    const [runRead, itemsRead] = await Promise.all([
      facade.readExecutionRun(request.run_id),
      facade.readExecutionPlanItems(request.plan_id),
    ]);
    const bindings = requireBindings({ aggregate, runRead, itemsRead, request });
    const analysis = analyzeEvidence({ aggregate, items: bindings.items, plan: bindings.plan, request });
    let operation = snapshot(bindings.operation, 'operation');
    let run = snapshot(bindings.run, 'run');

    async function advanceOperation(desiredState, terminalReason = null) {
      if (operation.state === desiredState) return;
      const allowedPredecessors = {
        readback_pending: new Set(['executing']),
        reconciling: new Set(['readback_pending', 'unknown_outcome']),
        unknown_outcome: new Set(['executing', 'readback_pending', 'reconciling']),
        completed: new Set(['reconciling', 'unknown_outcome']),
        blocked: new Set(['reconciling', 'unknown_outcome']),
      };
      if (!allowedPredecessors[desiredState]?.has(operation.state)) {
        throw fail(409, 'STORAGE_RESTART_RECONCILER_OPERATION_STATE_DIVERGENCE', 'Operation state cannot be advanced to match durable restart evidence.', {
          current_state: operation.state,
          desired_state: desiredState,
        });
      }
      const result = await facade.advanceExecutionState({
        operation_id: request.operation_id,
        expected_version: Number(operation.version),
        expected_current_state: operation.state,
        next_state: desiredState,
        terminal_reason: terminalReason,
        now_epoch: request.recovery_epoch,
        secrets_included: false,
      });
      operation = snapshot(result.operation, 'advanced_operation');
    }

    async function advanceRun(desiredState, checkpointDigest, resultDigest = null) {
      if (run.state === desiredState) return;
      const result = await facade.finalizeRun({
        run_id: request.run_id,
        expected_checkpoint_digest: run.checkpoint_digest,
        finalization: runFinalization({
          run,
          state: desiredState,
          epoch: request.recovery_epoch,
          analysis,
          checkpointDigest,
          resultDigest,
        }),
        secrets_included: false,
      });
      run = {
        ...run,
        state: desiredState,
        checkpoint_digest: checkpointDigest,
        journal_digest: analysis.journal_digest,
        result_digest: resultDigest,
        unknown_outcome: desiredState === 'unknown_outcome',
        readback_status: desiredState === 'unknown_outcome' ? 'incomplete' : desiredState,
        deleted_count: analysis.counts.deleted,
        deleted_bytes: analysis.deleted_bytes,
        skipped_count: analysis.counts.skipped_changed,
        missing_count: analysis.counts.skipped_missing,
        failed_count: analysis.counts.conflict,
        finished_at_epoch: request.recovery_epoch,
        finalize_result: result,
        secrets_included: false,
      };
    }

    const checkpointReadback = digest({ phase: 'restart_readback_pending', previous: run.checkpoint_digest, analysis_digest: analysis.analysis_digest });
    const checkpointReconciling = digest({ phase: 'restart_reconciling', previous: checkpointReadback, analysis_digest: analysis.analysis_digest });
    const recoveryOutcome = analysis.complete ? analysis.outcome : 'still_unknown';
    const reconciliation = reconciliationEnvelope({ request, aggregate, runRead, itemsRead, analysis, outcome: recoveryOutcome });

    if (!analysis.complete) {
      const checkpointUnknown = digest({ phase: 'restart_unknown_outcome', previous: run.checkpoint_digest, analysis_digest: analysis.analysis_digest });
      if (ACTIVE_RUN_STATES.has(run.state) && run.state !== 'unknown_outcome') {
        await advanceRun('unknown_outcome', checkpointUnknown);
      } else if (TERMINAL_RUN_STATES.has(run.state)) {
        throw fail(409, 'STORAGE_RESTART_RECONCILER_TERMINAL_RUN_EVIDENCE_INCOMPLETE', 'Terminal durable run has incomplete restart evidence.', { run_state: run.state, blockers: analysis.blockers });
      }
      if (operation.state !== 'unknown_outcome') await advanceOperation('unknown_outcome');
      await facade.appendReconciliation({
        reconciliation_id: reconciliation.reconciliation_id,
        operation_id: request.operation_id,
        run_id: request.run_id,
        input_evidence_hashes: reconciliation.input_evidence_hashes,
        item_accounting: {
          total: Number(bindings.plan.item_count),
          prepared: analysis.prepared_count,
          result: analysis.result_count,
          readback: analysis.readback_count,
          conflict: analysis.counts.conflict,
          secrets_included: false,
        },
        outcome: 'still_unknown',
        retry_permission: false,
        reviewed_at_epoch: request.recovery_epoch,
        evidence_digest: reconciliation.evidence_digest,
        secrets_included: false,
      });
      return deepFreeze({
        ok: true,
        reconciliation_key: 'hostinger_storage_crash_safe_restart_result_v1',
        reconciliation_version: HOSTINGER_STORAGE_CRASH_SAFE_RESTART_RECONCILER_VERSION,
        operation_id: request.operation_id,
        plan_id: request.plan_id,
        run_id: request.run_id,
        outcome: 'still_unknown',
        final_run_state: 'unknown_outcome',
        final_operation_state: 'unknown_outcome',
        analysis,
        reconciliation_digest: reconciliation.evidence_digest,
        mutation_replayed: false,
        provider_called: false,
        automatic_retry_allowed: false,
        read_before_retry_required: true,
        runtime_mounted: false,
        route_mounted: false,
        worker_mounted: false,
        provider_dispatch_allowed: false,
        production_ready: false,
        secrets_included: false,
      });
    }

    const finalRunState = analysis.outcome === 'conflict' ? 'failed' : 'completed';
    const finalOperationState = analysis.outcome === 'conflict' ? 'blocked' : 'completed';
    const resultCore = {
      result_key: 'hostinger_storage_crash_safe_restart_terminal_result_v1',
      operation_id: request.operation_id,
      plan_id: request.plan_id,
      run_id: request.run_id,
      outcome: analysis.outcome,
      counts: analysis.counts,
      deleted_bytes: analysis.deleted_bytes,
      journal_digest: analysis.journal_digest,
      analysis_digest: analysis.analysis_digest,
      reconciliation_digest: reconciliation.evidence_digest,
      mutation_replayed: false,
      provider_called: false,
      automatic_retry_allowed: false,
      secrets_included: false,
    };
    const resultDigest = digest(resultCore);
    const checkpointTerminal = digest({ phase: finalRunState, previous: checkpointReconciling, result_digest: resultDigest });

    if (run.state === 'executing') {
      await advanceRun('readback_pending', checkpointReadback);
    }
    if (operation.state === 'executing') await advanceOperation('readback_pending');

    if (run.state === 'readback_pending') {
      await advanceRun('reconciling', checkpointReconciling);
    } else if (run.state === 'unknown_outcome') {
      await advanceRun('reconciling', checkpointReconciling);
    }
    if (operation.state === 'readback_pending' || operation.state === 'unknown_outcome') await advanceOperation('reconciling');

    await facade.appendReconciliation({
      reconciliation_id: reconciliation.reconciliation_id,
      operation_id: request.operation_id,
      run_id: request.run_id,
      input_evidence_hashes: reconciliation.input_evidence_hashes,
      item_accounting: {
        total: Number(bindings.plan.item_count),
        prepared: analysis.prepared_count,
        result: analysis.result_count,
        readback: analysis.readback_count,
        conflict: analysis.counts.conflict,
        secrets_included: false,
      },
      outcome: analysis.outcome,
      retry_permission: false,
      reviewed_at_epoch: request.recovery_epoch,
      evidence_digest: reconciliation.evidence_digest,
      secrets_included: false,
    });

    if (!TERMINAL_RUN_STATES.has(run.state)) await advanceRun(finalRunState, checkpointTerminal, resultDigest);
    if (!TERMINAL_OPERATION_STATES.has(operation.state)) {
      await advanceOperation(finalOperationState, finalOperationState === 'blocked' ? 'crash_safe_restart_reconciliation_conflict' : null);
    }

    return deepFreeze({
      ok: true,
      reconciliation_key: 'hostinger_storage_crash_safe_restart_result_v1',
      reconciliation_version: HOSTINGER_STORAGE_CRASH_SAFE_RESTART_RECONCILER_VERSION,
      ...resultCore,
      result_digest: resultDigest,
      final_run_state: finalRunState,
      final_operation_state: finalOperationState,
      analysis,
      mutation_replayed: false,
      provider_called: false,
      automatic_retry_allowed: false,
      read_before_retry_required: false,
      runtime_mounted: false,
      route_mounted: false,
      worker_mounted: false,
      provider_dispatch_allowed: false,
      production_ready: false,
      secrets_included: false,
    });
  }

  const reconciler = {
    reconciler_key: 'hostinger_storage_crash_safe_restart_reconciler_v1',
    reconciler_version: HOSTINGER_STORAGE_CRASH_SAFE_RESTART_RECONCILER_VERSION,
    facade_version: facade.facade_version,
    async_only: true,
    evidence_only: true,
    mutation_replay_allowed: false,
    provider_calls_allowed: false,
    automatic_retry_allowed: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    reconcile,
    secrets_included: false,
  };
  Object.defineProperty(reconciler, BRAND, { value: true, enumerable: false });
  return Object.freeze(reconciler);
}

export function isCanonicalHostingerStorageCrashSafeRestartReconciler(value) {
  return Boolean(value?.[BRAND] === true
    && Object.isFrozen(value)
    && value?.reconciler_key === 'hostinger_storage_crash_safe_restart_reconciler_v1'
    && value?.reconciler_version === HOSTINGER_STORAGE_CRASH_SAFE_RESTART_RECONCILER_VERSION
    && value?.async_only === true
    && value?.evidence_only === true
    && value?.mutation_replay_allowed === false
    && value?.provider_calls_allowed === false
    && value?.automatic_retry_allowed === false
    && value?.runtime_mounted === false
    && value?.route_mounted === false
    && value?.worker_mounted === false
    && value?.provider_dispatch_allowed === false
    && value?.production_ready === false
    && typeof value?.reconcile === 'function');
}
