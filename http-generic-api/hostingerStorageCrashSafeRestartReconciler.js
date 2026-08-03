import { createHash } from 'node:crypto';
import { transitionHostingerStorageOperation } from './hostingerStorageOrchestrationPolicy.js';
import {
  HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION,
  isCanonicalHostingerStorageVerifiedSqlRuntimeComposition,
} from './hostingerStorageVerifiedSqlRuntimeComposition.js';

export const HOSTINGER_STORAGE_CRASH_SAFE_RESTART_RECONCILER_VERSION = 'spec014-hostinger-storage-crash-safe-restart-reconciler-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-crash-safe-restart-reconciler');
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const UINT64_RE = /^(?:0|[1-9][0-9]{0,19})$/u;
const ALLOWED_OPTIONS = new Set(['composition']);
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
  if (!UINT64_RE.test(normalized) || BigInt(normalized) > 18446744073709551615n) {
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

function deterministicUuid(seed) {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-e${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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

function assertComposition(composition) {
  if (!isCanonicalHostingerStorageVerifiedSqlRuntimeComposition(composition)
    || composition.composition_version !== HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION
    || composition.runtime_mounted !== false
    || composition.route_mounted !== false
    || composition.worker_mounted !== false
    || composition.provider_dispatch_allowed !== false
    || composition.production_ready !== false
    || typeof composition.control_plane?.readAggregate !== 'function'
    || typeof composition.control_plane?.transitionOperation !== 'function'
    || typeof composition.execution_parents?.readRun !== 'function'
    || typeof composition.execution_parents?.readPlanItems !== 'function'
    || typeof composition.execution_parents?.finalizeRun !== 'function'
    || typeof composition.child_evidence?.appendReconciliation !== 'function') {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_COMPOSITION_INVALID', 'An unmounted canonical verified SQL composition with restart read and CAS write support is required.');
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
  if (runRead.database_fingerprint !== compositionFingerprint(itemsRead, runRead)) {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_DATABASE_PROVENANCE_MISMATCH', 'Restart reads do not share one durable database fingerprint.');
  }
  if (!ACTIVE_RUN_STATES.has(run.state) && !TERMINAL_RUN_STATES.has(run.state)) {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_RUN_STATE_INVALID', 'Durable run state cannot be reconciled.', { state: run.state });
  }
  if (!ACTIVE_OPERATION_STATES.has(operation.state) && !TERMINAL_OPERATION_STATES.has(operation.state)) {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_OPERATION_STATE_INVALID', 'Durable operation state cannot be reconciled.', { state: operation.state });
  }
  return { operation, plan, run, items };
}

function compositionFingerprint(itemsRead, runRead) {
  if (!runRead?.database_fingerprint || runRead.database_fingerprint !== itemsRead?.database_fingerprint) return null;
  return runRead.database_fingerprint;
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
    const group = groups.get(parentId) || { phases: new Map() };
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

function runFinalization({ state, epoch, analysis, checkpointDigest, resultDigest = null }) {
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
    evidence_digest: evidenceDigest,
    input_evidence_hashes: {
      aggregate: hash(aggregate.aggregate_digest, 'aggregate.aggregate_digest'),
      run: hash(runRead.run_digest ?? runRead.run?.record_digest, 'run_read.run_digest'),
      plan_items: hash(itemsRead.item_set_digest, 'items_read.item_set_digest'),
      journal: analysis.journal_digest,
      analysis: analysis.analysis_digest,
    },
    reconciliation_id: deterministicUuid(`${request.run_id}\0${evidenceDigest}\0restart-reconciliation`),
    secrets_included: false,
  });
}

function matchingReconciliation(aggregate, runId, outcome) {
  const rows = Array.isArray(aggregate?.reconciliations) ? aggregate.reconciliations : [];
  return rows.find((row) => row.run_id === runId && row.outcome === outcome) || null;
}

export function createHostingerStorageCrashSafeRestartReconciler(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail(500, 'STORAGE_RESTART_RECONCILER_OPTIONS_INVALID', 'Reconciler options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unsupported.length) {
    throw fail(409, 'STORAGE_RESTART_RECONCILER_OVERRIDE_FORBIDDEN', 'Only the canonical verified SQL composition may be supplied.', { unsupported_options: unsupported.sort() });
  }
  const { composition } = options;
  assertComposition(composition);

  async function reconcile(input = {}) {
    const request = normalizeRequest(input);
    let aggregate = await composition.control_plane.readAggregate(request.operation_id);
    let runRead = await composition.execution_parents.readRun({ run_id: request.run_id });
    const itemsRead = await composition.execution_parents.readPlanItems({ plan_id: request.plan_id });
    const bindings = requireBindings({ aggregate, runRead, itemsRead, request });
    if (runRead.database_fingerprint !== composition.schema_provenance.database_fingerprint
      || itemsRead.database_fingerprint !== composition.schema_provenance.database_fingerprint) {
      throw fail(409, 'STORAGE_RESTART_RECONCILER_COMPOSITION_PROVENANCE_MISMATCH', 'Restart reads do not match the verified SQL composition database fingerprint.');
    }
    const analysis = analyzeEvidence({ aggregate, items: bindings.items, plan: bindings.plan, request });
    let operation = snapshot(bindings.operation, 'operation');
    let run = snapshot(bindings.run, 'run');

    async function refreshAggregate() {
      aggregate = await composition.control_plane.readAggregate(request.operation_id);
      operation = snapshot(aggregate.operation, 'operation');
    }

    async function refreshRun() {
      runRead = await composition.execution_parents.readRun({ run_id: request.run_id });
      if (runRead?.found !== true || !runRead.run) {
        throw fail(409, 'STORAGE_RESTART_RECONCILER_RUN_DISAPPEARED', 'Durable run disappeared during restart reconciliation.');
      }
      run = snapshot(runRead.run, 'run');
    }

    async function advanceOperation(nextState, terminalReason = null) {
      if (operation.state === nextState) return;
      const decision = transitionHostingerStorageOperation({
        current_state: operation.state,
        next_state: nextState,
        unknown_outcome_reconciled: operation.state === 'unknown_outcome',
      });
      if (decision.allowed !== true) {
        throw fail(409, 'STORAGE_RESTART_RECONCILER_OPERATION_TRANSITION_DENIED', 'Operation transition is denied by the canonical storage policy.', {
          current_state: operation.state,
          next_state: nextState,
          reason_codes: decision.reason_codes || [],
        });
      }
      await composition.control_plane.transitionOperation({
        operation_id: request.operation_id,
        expected_version: Number(operation.version),
        next_state: nextState,
        terminal_reason: terminalReason,
        now_epoch: request.recovery_epoch,
      });
      await refreshAggregate();
      if (operation.state !== nextState) {
        throw fail(409, 'STORAGE_RESTART_RECONCILER_OPERATION_READBACK_MISMATCH', 'Operation transition readback differs from the requested state.', { expected_state: nextState, observed_state: operation.state });
      }
    }

    async function advanceRun(nextState, checkpointDigest, resultDigest = null) {
      if (run.state === nextState) return;
      await composition.execution_parents.finalizeRun({
        run_id: request.run_id,
        expected_checkpoint_digest: run.checkpoint_digest,
        finalization: runFinalization({
          state: nextState,
          epoch: request.recovery_epoch,
          analysis,
          checkpointDigest,
          resultDigest,
        }),
        secrets_included: false,
      });
      await refreshRun();
      if (run.state !== nextState || run.checkpoint_digest !== checkpointDigest) {
        throw fail(409, 'STORAGE_RESTART_RECONCILER_RUN_READBACK_MISMATCH', 'Run transition readback differs from the requested state.', {
          expected_state: nextState,
          observed_state: run.state,
        });
      }
    }

    async function appendRestartReconciliation(reconciliation, outcome) {
      return composition.child_evidence.appendReconciliation({
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
        outcome,
        retry_permission: false,
        reviewed_at_epoch: request.recovery_epoch,
        evidence_digest: reconciliation.evidence_digest,
        secrets_included: false,
      });
    }

    if (TERMINAL_RUN_STATES.has(run.state)) {
      if (!analysis.complete) {
        throw fail(409, 'STORAGE_RESTART_RECONCILER_TERMINAL_RUN_EVIDENCE_INCOMPLETE', 'Terminal durable run has incomplete restart evidence.', { run_state: run.state, blockers: analysis.blockers });
      }
      const expectedRunState = analysis.outcome === 'conflict' ? 'failed' : 'completed';
      const expectedOperationState = analysis.outcome === 'conflict' ? 'blocked' : 'completed';
      if (run.state !== expectedRunState) {
        throw fail(409, 'STORAGE_RESTART_RECONCILER_TERMINAL_RUN_STATE_MISMATCH', 'Terminal run state differs from durable child evidence.', { expected_state: expectedRunState, observed_state: run.state });
      }
      if (!matchingReconciliation(aggregate, request.run_id, analysis.outcome)) {
        throw fail(409, 'STORAGE_RESTART_RECONCILER_TERMINAL_RECONCILIATION_REQUIRED', 'Terminal run requires existing durable reconciliation evidence.', { outcome: analysis.outcome });
      }
      if (!TERMINAL_OPERATION_STATES.has(operation.state)) {
        if (!['reconciling', 'unknown_outcome'].includes(operation.state)) {
          throw fail(409, 'STORAGE_RESTART_RECONCILER_TERMINAL_STATE_DIVERGENCE', 'Terminal run is not paired with a reconcilable operation state.', { operation_state: operation.state });
        }
        await advanceOperation(expectedOperationState, expectedOperationState === 'blocked' ? 'crash_safe_restart_reconciliation_conflict' : null);
      }
      if (operation.state !== expectedOperationState) {
        throw fail(409, 'STORAGE_RESTART_RECONCILER_TERMINAL_OPERATION_STATE_MISMATCH', 'Terminal operation state differs from durable child evidence.', { expected_state: expectedOperationState, observed_state: operation.state });
      }
      return deepFreeze({
        ok: true,
        reconciliation_key: 'hostinger_storage_crash_safe_restart_result_v1',
        reconciliation_version: HOSTINGER_STORAGE_CRASH_SAFE_RESTART_RECONCILER_VERSION,
        operation_id: request.operation_id,
        plan_id: request.plan_id,
        run_id: request.run_id,
        outcome: analysis.outcome,
        final_run_state: run.state,
        final_operation_state: operation.state,
        terminal_replay: true,
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

    if (TERMINAL_OPERATION_STATES.has(operation.state)) {
      throw fail(409, 'STORAGE_RESTART_RECONCILER_ACTIVE_RUN_TERMINAL_OPERATION_DIVERGENCE', 'Active durable run cannot be reconciled beneath a terminal operation.', {
        run_state: run.state,
        operation_state: operation.state,
      });
    }

    const recoveryOutcome = analysis.complete ? analysis.outcome : 'still_unknown';
    const reconciliation = reconciliationEnvelope({ request, aggregate, runRead, itemsRead, analysis, outcome: recoveryOutcome });

    if (!analysis.complete) {
      const checkpointIntermediate = digest({ phase: 'restart_incomplete_reconciling', previous: run.checkpoint_digest, analysis_digest: analysis.analysis_digest });
      if (run.state === 'readback_pending') await advanceRun('reconciling', checkpointIntermediate);
      const checkpointUnknown = digest({ phase: 'restart_unknown_outcome', previous: run.checkpoint_digest, analysis_digest: analysis.analysis_digest });
      if (run.state !== 'unknown_outcome') await advanceRun('unknown_outcome', checkpointUnknown);
      if (operation.state !== 'unknown_outcome') await advanceOperation('unknown_outcome');
      await appendRestartReconciliation(reconciliation, 'still_unknown');
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
        terminal_replay: false,
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

    if (run.state === 'executing') {
      const checkpointReadback = digest({ phase: 'restart_readback_pending', previous: run.checkpoint_digest, analysis_digest: analysis.analysis_digest });
      await advanceRun('readback_pending', checkpointReadback);
    }
    if (operation.state === 'executing') await advanceOperation('readback_pending');

    if (run.state === 'readback_pending' || run.state === 'unknown_outcome') {
      const checkpointReconciling = digest({ phase: 'restart_reconciling', previous: run.checkpoint_digest, analysis_digest: analysis.analysis_digest });
      await advanceRun('reconciling', checkpointReconciling);
    }
    if (operation.state === 'readback_pending' || operation.state === 'unknown_outcome') await advanceOperation('reconciling');

    if (run.state !== 'reconciling' || operation.state !== 'reconciling') {
      throw fail(409, 'STORAGE_RESTART_RECONCILER_RECONCILING_STATE_REQUIRED', 'Complete evidence must converge run and operation to reconciling before terminalization.', {
        run_state: run.state,
        operation_state: operation.state,
      });
    }

    await appendRestartReconciliation(reconciliation, analysis.outcome);
    const checkpointTerminal = digest({ phase: finalRunState, previous: run.checkpoint_digest, result_digest: resultDigest });
    await advanceRun(finalRunState, checkpointTerminal, resultDigest);
    await advanceOperation(finalOperationState, finalOperationState === 'blocked' ? 'crash_safe_restart_reconciliation_conflict' : null);

    return deepFreeze({
      ok: true,
      reconciliation_key: 'hostinger_storage_crash_safe_restart_result_v1',
      reconciliation_version: HOSTINGER_STORAGE_CRASH_SAFE_RESTART_RECONCILER_VERSION,
      ...resultCore,
      result_digest: resultDigest,
      final_run_state: finalRunState,
      final_operation_state: finalOperationState,
      terminal_replay: false,
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
    composition_version: composition.composition_version,
    database_fingerprint: composition.schema_provenance.database_fingerprint,
    async_only: true,
    evidence_only: true,
    mutation_replay_allowed: false,
    provider_calls_allowed: false,
    automatic_retry_allowed: false,
    raw_composition_exposed: false,
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
    && value?.raw_composition_exposed === false
    && value?.runtime_mounted === false
    && value?.route_mounted === false
    && value?.worker_mounted === false
    && value?.provider_dispatch_allowed === false
    && value?.production_ready === false
    && typeof value?.reconcile === 'function');
}
