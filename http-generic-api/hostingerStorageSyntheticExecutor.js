import { createHash } from 'node:crypto';
import { transitionHostingerStorageOperation } from './hostingerStorageOrchestrationPolicy.js';
import { verifyHostingerStorageSyntheticExecutionProtocol } from './hostingerStorageExecutorProtocol.js';

export const HOSTINGER_STORAGE_SYNTHETIC_EXECUTOR_VERSION = 'spec014-hostinger-storage-synthetic-executor-v1';

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function safeId(value, field) {
  const normalized = text(value, 256);
  if (!SAFE_ID_RE.test(normalized)) throw fail(400, 'STORAGE_SYNTHETIC_EXECUTOR_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  return normalized;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function requireRepository(repository) {
  const methods = ['readAggregate', 'transitionOperation', 'consumePlan', 'appendJournalEvent', 'recordReconciliation'];
  if (!repository || methods.some((method) => typeof repository[method] !== 'function')) {
    throw fail(500, 'STORAGE_SYNTHETIC_EXECUTOR_REPOSITORY_INVALID', 'Synthetic executor requires the governed repository contract.', { required_methods: methods });
  }
  if (repository.production_ready === true) {
    throw fail(409, 'STORAGE_SYNTHETIC_EXECUTOR_PRODUCTION_REPOSITORY_FORBIDDEN', 'Synthetic executor cannot run against a production repository adapter.');
  }
}

function requireAdapter(adapter) {
  if (!adapter || adapter.synthetic_only !== true || adapter.production_ready !== false || adapter.live_provider !== false
    || adapter.filesystem_access !== false || adapter.shell_access !== false
    || typeof adapter.mutateExact !== 'function' || typeof adapter.readbackItem !== 'function'
    || typeof adapter.readMutationReceipt !== 'function') {
    throw fail(409, 'STORAGE_SYNTHETIC_EXECUTOR_ADAPTER_INVALID', 'A non-production in-memory synthetic adapter is required.');
  }
}

function aggregate(repository, operationId) {
  const value = repository.readAggregate(operationId);
  if (!value?.operation) throw fail(404, 'STORAGE_SYNTHETIC_EXECUTOR_OPERATION_NOT_FOUND', 'Synthetic operation aggregate not found.', { operation_id: operationId });
  return value;
}

function transition(repository, operationId, nextState, nowEpoch, unknownOutcomeReconciled = false) {
  const current = aggregate(repository, operationId).operation;
  if (current.state === nextState) return current;
  const decision = transitionHostingerStorageOperation({
    current_state: current.state,
    next_state: nextState,
    unknown_outcome_reconciled: unknownOutcomeReconciled,
  });
  if (!decision.allowed) {
    throw fail(409, 'STORAGE_SYNTHETIC_EXECUTOR_STATE_TRANSITION_DENIED', 'Synthetic operation transition is not allowed.', {
      current_state: current.state,
      next_state: nextState,
      reason_codes: decision.reason_codes,
    });
  }
  return repository.transitionOperation({
    operation_id: operationId,
    expected_version: current.version,
    next_state: nextState,
    now_epoch: nowEpoch,
    terminal_reason: nextState === 'blocked' ? 'synthetic_reconciliation_conflict' : null,
  });
}

function journalRows(repository, operationId, runId) {
  return aggregate(repository, operationId).journals
    .filter((event) => event.run_id === runId)
    .sort((left, right) => left.sequence - right.sequence);
}

function appendEvent(repository, operationId, runId, planId, itemId, phase, result, evidence, nowEpoch) {
  const rows = journalRows(repository, operationId, runId);
  const eventId = `${runId}:${itemId}:${phase}`;
  const existing = rows.find((row) => row.event_id === eventId);
  if (existing) return existing;
  return repository.appendJournalEvent({
    event_id: eventId,
    operation_id: operationId,
    run_id: runId,
    plan_id: planId,
    item_id: itemId,
    sequence: rows.length + 1,
    phase,
    result,
    stat_digest: evidence?.stat_digest || null,
    evidence_digest: digest(evidence || {}),
    observed_at_epoch: nowEpoch,
    secrets_included: false,
  }).event;
}

function faultMatches(fault, phase, itemId) {
  return fault?.phase === phase && (!fault.item_id || fault.item_id === itemId);
}

function unknownResult({ repository, operationId, runId, itemId, phase, nowEpoch }) {
  transition(repository, operationId, 'unknown_outcome', nowEpoch);
  return deepFreeze({
    ok: true,
    state: 'unknown_outcome',
    operation_id: operationId,
    run_id: runId,
    item_id: itemId,
    interrupted_after: phase,
    automatic_retry_allowed: false,
    read_before_retry_required: true,
    dispatch_allowed: false,
    secrets_included: false,
  });
}

export function executeHostingerStorageSyntheticPlan({
  protocol,
  protocol_digest,
  repository,
  adapter,
  fault = null,
  now_epoch = Math.floor(Date.now() / 1000),
} = {}) {
  verifyHostingerStorageSyntheticExecutionProtocol({ protocol, expected_digest: protocol_digest });
  requireRepository(repository);
  requireAdapter(adapter);
  const operationId = safeId(protocol.operation_id, 'operation_id');
  const runId = safeId(protocol.run_id, 'run_id');
  const planId = safeId(protocol.plan_id, 'plan_id');
  const current = aggregate(repository, operationId).operation;
  if (!['lease_acquired', 'executing'].includes(current.state)) {
    throw fail(409, 'STORAGE_SYNTHETIC_EXECUTOR_OPERATION_STATE_INVALID', 'Synthetic execution requires lease_acquired or executing state.', { state: current.state });
  }
  if (current.state === 'lease_acquired') transition(repository, operationId, 'executing', now_epoch);
  repository.consumePlan({
    plan_id: planId,
    expected_plan_hash: protocol.plan_hash,
    run_id: runId,
    consumed_at_epoch: now_epoch,
  });

  for (const item of protocol.items) {
    const rows = journalRows(repository, operationId, runId).filter((row) => row.item_id === item.item_id);
    const prepared = rows.find((row) => row.phase === 'prepared');
    const result = rows.find((row) => row.phase === 'result');
    if (result) continue;
    if (prepared) {
      return unknownResult({ repository, operationId, runId, itemId: item.item_id, phase: 'prepared_without_result', nowEpoch: now_epoch });
    }
    appendEvent(repository, operationId, runId, planId, item.item_id, 'prepared', 'prepared', {
      item_hash: item.item_hash,
      expected: item.expected,
      protocol_digest,
      stat_digest: digest(item.expected),
      secrets_included: false,
    }, now_epoch);
    if (faultMatches(fault, 'after_prepared', item.item_id)) {
      return unknownResult({ repository, operationId, runId, itemId: item.item_id, phase: 'prepared', nowEpoch: now_epoch });
    }
    const receipt = adapter.mutateExact({ operation_id: operationId, run_id: runId, item });
    if (faultMatches(fault, 'after_mutation', item.item_id)) {
      return unknownResult({ repository, operationId, runId, itemId: item.item_id, phase: 'mutation', nowEpoch: now_epoch });
    }
    appendEvent(repository, operationId, runId, planId, item.item_id, 'result', receipt.outcome, {
      receipt_digest: receipt.receipt_digest,
      item_hash: receipt.item_hash,
      outcome: receipt.outcome,
      synthetic_only: true,
      secrets_included: false,
    }, now_epoch);
  }
  transition(repository, operationId, 'readback_pending', now_epoch);
  return reconcileHostingerStorageSyntheticOutcome({ protocol, protocol_digest, repository, adapter, now_epoch });
}

function classifyItem({ item, rows, adapter, operationId, runId }) {
  const result = rows.find((row) => row.phase === 'result');
  const receipt = adapter.readMutationReceipt({ operation_id: operationId, run_id: runId, item_id: item.item_id });
  const observed = adapter.readbackItem({ item_id: item.item_id, expected_item_hash: item.item_hash, expected: item.expected });
  if (result?.result === 'deleted' || result?.result === 'deleted_recovered') {
    return { classification: observed.exists ? 'conflict' : 'deleted', result, receipt, observed };
  }
  if (result?.result === 'skipped_changed') {
    return { classification: observed.exists && !observed.matches_plan ? 'skipped_changed' : 'conflict', result, receipt, observed };
  }
  if (result?.result === 'skipped_missing') {
    return { classification: observed.exists ? 'conflict' : 'skipped_missing', result, receipt, observed };
  }
  if (!result && receipt?.outcome === 'deleted' && receipt.item_hash === item.item_hash && observed.exists === false) {
    return { classification: 'deleted_recovered', result: null, receipt, observed };
  }
  if (!result && !receipt && observed.exists === true && observed.matches_plan === true) {
    return { classification: 'unchanged', result: null, receipt: null, observed };
  }
  return { classification: 'conflict', result: result || null, receipt: receipt || null, observed };
}

export function reconcileHostingerStorageSyntheticOutcome({
  protocol,
  protocol_digest,
  repository,
  adapter,
  now_epoch = Math.floor(Date.now() / 1000),
} = {}) {
  verifyHostingerStorageSyntheticExecutionProtocol({ protocol, expected_digest: protocol_digest });
  requireRepository(repository);
  requireAdapter(adapter);
  const operationId = safeId(protocol.operation_id, 'operation_id');
  const runId = safeId(protocol.run_id, 'run_id');
  const planId = safeId(protocol.plan_id, 'plan_id');
  const current = aggregate(repository, operationId).operation;
  if (!['readback_pending', 'unknown_outcome', 'reconciling'].includes(current.state)) {
    throw fail(409, 'STORAGE_SYNTHETIC_RECONCILIATION_STATE_INVALID', 'Reconciliation requires readback_pending, unknown_outcome, or reconciling state.', { state: current.state });
  }
  if (current.state !== 'reconciling') transition(repository, operationId, 'reconciling', now_epoch);

  const itemResults = [];
  for (const item of protocol.items) {
    let rows = journalRows(repository, operationId, runId).filter((row) => row.item_id === item.item_id);
    const classified = classifyItem({ item, rows, adapter, operationId, runId });
    if (classified.classification === 'deleted_recovered' && !rows.some((row) => row.phase === 'result')) {
      appendEvent(repository, operationId, runId, planId, item.item_id, 'result', 'deleted_recovered', {
        receipt_digest: classified.receipt.receipt_digest,
        item_hash: classified.receipt.item_hash,
        recovery_source: 'synthetic_provider_receipt',
        secrets_included: false,
      }, now_epoch);
      rows = journalRows(repository, operationId, runId).filter((row) => row.item_id === item.item_id);
    }
    if (rows.some((row) => row.phase === 'result') && !rows.some((row) => row.phase === 'readback')) {
      appendEvent(repository, operationId, runId, planId, item.item_id, 'readback', classified.classification, {
        evidence_digest: classified.observed.evidence_digest,
        exists: classified.observed.exists,
        matches_plan: classified.observed.matches_plan,
        secrets_included: false,
      }, now_epoch);
    }
    itemResults.push({
      item_id: item.item_id,
      classification: classified.classification,
      observed_evidence_digest: classified.observed.evidence_digest,
      receipt_digest: classified.receipt?.receipt_digest || null,
      secrets_included: false,
    });
  }

  const counts = itemResults.reduce((accumulator, row) => {
    accumulator[row.classification] = (accumulator[row.classification] || 0) + 1;
    return accumulator;
  }, {});
  const conflicts = counts.conflict || 0;
  const deleted = (counts.deleted || 0) + (counts.deleted_recovered || 0);
  const skipped = (counts.skipped_changed || 0) + (counts.skipped_missing || 0);
  const unchanged = counts.unchanged || 0;
  let outcome = 'still_unknown';
  if (conflicts > 0) outcome = 'conflict';
  else if (deleted === protocol.items.length) outcome = 'applied';
  else if (deleted > 0 || skipped > 0) outcome = 'partially_applied';
  else if (unchanged === protocol.items.length) outcome = 'not_applied';

  const reconciliationCore = {
    operation_id: operationId,
    run_id: runId,
    plan_id: planId,
    plan_hash: protocol.plan_hash,
    protocol_digest,
    outcome,
    retry_allowed: outcome === 'not_applied',
    new_plan_required_for_retry: outcome === 'not_applied',
    item_results: itemResults,
    counts,
    synthetic_only: true,
    secrets_included: false,
  };
  const resultDigest = digest(reconciliationCore);
  repository.recordReconciliation({
    reconciliation_id: `${runId}:reconciliation`,
    operation_id: operationId,
    run_id: runId,
    outcome,
    input_evidence_hash: digest(itemResults.map((row) => row.observed_evidence_digest)),
    result_digest: resultDigest,
    retry_allowed: outcome === 'not_applied',
    reviewed_at_epoch: now_epoch,
    secrets_included: false,
  });

  if (outcome === 'conflict') transition(repository, operationId, 'blocked', now_epoch);
  else if (outcome === 'still_unknown') transition(repository, operationId, 'unknown_outcome', now_epoch);
  else transition(repository, operationId, 'completed', now_epoch, current.state === 'unknown_outcome');

  return deepFreeze({
    ok: true,
    outcome,
    retry_allowed: outcome === 'not_applied',
    new_plan_required_for_retry: outcome === 'not_applied',
    item_results: itemResults,
    counts,
    result_digest: resultDigest,
    dispatch_allowed: false,
    live_provider_mutated: false,
    secrets_included: false,
  });
}
