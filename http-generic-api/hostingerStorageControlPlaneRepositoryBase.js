import { createHash } from 'node:crypto';

export const HOSTINGER_STORAGE_CONTROL_PLANE_REPOSITORY_VERSION = 'spec014-storage-control-plane-repository-v1';

const SHA256_RE = /^[0-9a-f]{64}$/i;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const ACTIVE_OPERATION_STATES = new Set([
  'observed', 'classified', 'planned', 'inspected', 'approval_requested', 'partially_approved',
  'approved', 'lease_acquired', 'executing', 'readback_pending', 'reconciling', 'unknown_outcome',
]);
const TERMINAL_OPERATION_STATES = new Set(['completed', 'blocked', 'expired', 'cancelled', 'failed']);

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
function safeId(value, field, { nullable = false } = {}) {
  const result = text(value, 256);
  if (!result && nullable) return null;
  if (!SAFE_ID_RE.test(result)) throw fail(400, 'STORAGE_REPOSITORY_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  return result;
}
function hash(value, field, { nullable = false } = {}) {
  const result = text(value, 64).toLowerCase();
  if (!result && nullable) return null;
  if (!SHA256_RE.test(result)) throw fail(400, 'STORAGE_REPOSITORY_HASH_INVALID', 'A SHA-256 binding is required.', { field });
  return result;
}
function integer(value, field, { minimum = 0 } = {}) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) throw fail(400, 'STORAGE_REPOSITORY_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  return result;
}
function epoch(value, field) {
  if (Number.isFinite(Number(value))) return Math.floor(Number(value));
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) throw fail(400, 'STORAGE_REPOSITORY_TIME_INVALID', 'A valid timestamp is required.', { field });
  return Math.floor(parsed / 1000);
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
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}
function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value, 256)).filter(Boolean))].sort();
}
function assertSecretFree(value, at = 'value', depth = 0) {
  if (depth > 16 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, `${at}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content)/i.test(key)) {
      throw fail(400, 'STORAGE_REPOSITORY_SECRET_FIELD_REJECTED', 'Storage control-plane records must not contain secret material.', { path: `${at}.${key}` });
    }
    assertSecretFree(item, `${at}.${key}`, depth + 1);
  }
}

function emptyState() {
  return {
    schema_version: 1,
    operations: {},
    operation_idempotency: {},
    plans: {},
    approvals: {},
    leases: {},
    journals: {},
    reconciliations: {},
    secrets_included: false,
  };
}

function stateCore(state) {
  return {
    schema_version: state.schema_version,
    operations: state.operations,
    operation_idempotency: state.operation_idempotency,
    plans: state.plans,
    approvals: state.approvals,
    leases: state.leases,
    journals: state.journals,
    reconciliations: state.reconciliations,
    secrets_included: false,
  };
}

function assertSnapshot(snapshot) {
  assertSecretFree(snapshot, 'snapshot');
  if (!snapshot || snapshot.schema_version !== 1 || snapshot.snapshot_key !== 'hostinger_storage_control_plane_snapshot_v1') {
    throw fail(400, 'STORAGE_REPOSITORY_SNAPSHOT_INVALID', 'Unexpected storage control-plane snapshot contract.');
  }
  if (digest(snapshot.state) !== snapshot.state_digest) {
    throw fail(409, 'STORAGE_REPOSITORY_SNAPSHOT_TAMPERED', 'Storage control-plane snapshot digest mismatch.');
  }
  return clone(snapshot.state);
}

export function createMemoryHostingerStoragePersistenceAdapter({ snapshot = null } = {}) {
  let state = snapshot ? assertSnapshot(snapshot) : emptyState();
  let transactionVersion = snapshot?.transaction_version ? integer(snapshot.transaction_version, 'snapshot.transaction_version') : 0;
  let activeTransaction = false;

  function transaction(work) {
    if (activeTransaction) throw fail(409, 'STORAGE_REPOSITORY_NESTED_TRANSACTION_FORBIDDEN', 'Nested storage repository transactions are forbidden.');
    activeTransaction = true;
    const draft = clone(state);
    try {
      const result = work(draft, transactionVersion);
      assertSecretFree(draft, 'transaction_state');
      state = draft;
      transactionVersion += 1;
      return clone(result);
    } catch (error) {
      throw error;
    } finally {
      activeTransaction = false;
    }
  }

  return Object.freeze({
    adapter_key: 'hostinger_storage_memory_test_adapter_v1',
    production_ready: false,
    transaction,
    read(reader) {
      return clone(reader(clone(state), transactionVersion));
    },
    export_snapshot() {
      const core = stateCore(state);
      return deepFreeze({
        schema_version: 1,
        snapshot_key: 'hostinger_storage_control_plane_snapshot_v1',
        transaction_version: transactionVersion,
        state: clone(core),
        state_digest: digest(core),
        production_ready: false,
        secrets_included: false,
      });
    },
  });
}

function normalizeOperation(record, now) {
  assertSecretFree(record, 'operation');
  const state = text(record.state, 64).toLowerCase();
  if (!ACTIVE_OPERATION_STATES.has(state) && !TERMINAL_OPERATION_STATES.has(state)) {
    throw fail(400, 'STORAGE_OPERATION_STATE_INVALID', 'Unsupported storage operation state.', { state });
  }
  const normalized = {
    operation_id: safeId(record.operation_id ?? record.operationId, 'operation_id'),
    operation_key: safeId(record.operation_key ?? record.operationKey, 'operation_key'),
    target_id: safeId(record.target_id ?? record.targetId, 'target_id'),
    tenant_id: safeId(record.tenant_id ?? record.tenantId, 'tenant_id', { nullable: true }),
    workspace_id: safeId(record.workspace_id ?? record.workspaceId, 'workspace_id', { nullable: true }),
    resource_id: safeId(record.resource_id ?? record.resourceId, 'resource_id', { nullable: true }),
    context_mode: text(record.context_mode ?? record.contextMode, 16).toLowerCase(),
    authority_context_hash: hash(record.authority_context_hash ?? record.authorityContextHash, 'authority_context_hash'),
    ownership_revision: safeId(record.ownership_revision ?? record.ownershipRevision, 'ownership_revision'),
    policy_revision: safeId(record.policy_revision ?? record.policyRevision, 'policy_revision'),
    idempotency_key: hash(record.idempotency_key ?? record.idempotencyKey, 'idempotency_key'),
    risk_profile: safeId(record.risk_profile ?? record.riskProfile, 'risk_profile'),
    state,
    version: integer(record.version ?? 1, 'operation.version', { minimum: 1 }),
    created_at_epoch: epoch(record.created_at_epoch ?? record.created_at ?? now, 'operation.created_at'),
    updated_at_epoch: epoch(record.updated_at_epoch ?? record.updated_at ?? now, 'operation.updated_at'),
    terminal_reason: safeId(record.terminal_reason ?? record.terminalReason, 'terminal_reason', { nullable: true }),
    secrets_included: false,
  };
  normalized.record_digest = digest(normalized);
  return deepFreeze(normalized);
}

function normalizePlan(record) {
  assertSecretFree(record, 'plan');
  const normalized = {
    plan_id: safeId(record.plan_id ?? record.planId, 'plan_id'),
    operation_id: safeId(record.operation_id ?? record.operationId, 'plan.operation_id'),
    target_id: safeId(record.target_id ?? record.targetId, 'plan.target_id'),
    plan_hash: hash(record.plan_hash ?? record.planHash, 'plan_hash'),
    candidate_set_hash: hash(record.candidate_set_hash ?? record.candidateSetHash, 'candidate_set_hash'),
    impact_set_hash: hash(record.impact_set_hash ?? record.impactSetHash, 'impact_set_hash'),
    authority_context_hash: hash(record.authority_context_hash ?? record.authorityContextHash, 'plan.authority_context_hash'),
    ownership_revision: safeId(record.ownership_revision ?? record.ownershipRevision, 'plan.ownership_revision'),
    policy_revision: safeId(record.policy_revision ?? record.policyRevision, 'plan.policy_revision'),
    source_snapshot_id: safeId(record.source_snapshot_id ?? record.sourceSnapshotId, 'source_snapshot_id'),
    item_count: integer(record.item_count ?? record.itemCount, 'plan.item_count', { minimum: 1 }),
    total_bytes: integer(record.total_bytes ?? record.totalBytes, 'plan.total_bytes'),
    expires_at_epoch: epoch(record.expires_at_epoch ?? record.expires_at, 'plan.expires_at'),
    status: text(record.status, 32).toLowerCase(),
    consumed: record.consumed === true,
    consumed_run_id: safeId(record.consumed_run_id ?? record.consumedRunId, 'consumed_run_id', { nullable: true }),
    consumed_at_epoch: record.consumed_at_epoch || record.consumed_at ? epoch(record.consumed_at_epoch ?? record.consumed_at, 'consumed_at') : null,
    immutable_envelope_digest: hash(record.immutable_envelope_digest ?? record.immutableEnvelopeDigest ?? record.plan_hash ?? record.planHash, 'immutable_envelope_digest'),
    secrets_included: false,
  };
  normalized.record_digest = digest(normalized);
  return deepFreeze(normalized);
}

function normalizeApproval(record) {
  assertSecretFree(record, 'approval');
  const normalized = {
    approval_id: safeId(record.approval_id ?? record.approvalId, 'approval_id'),
    plan_id: safeId(record.plan_id ?? record.planId, 'approval.plan_id'),
    slot: safeId(record.slot, 'approval.slot'),
    workspace_id: safeId(record.workspace_id ?? record.workspaceId, 'approval.workspace_id', { nullable: true }),
    approver_principal_id: safeId(record.approver_principal_id ?? record.approverPrincipalId, 'approval.approver_principal_id'),
    approver_authority_ref: safeId(record.approver_authority_ref ?? record.approverAuthorityRef, 'approval.approver_authority_ref'),
    decision: text(record.decision ?? record.status, 32).toLowerCase(),
    plan_hash: hash(record.plan_hash ?? record.planHash, 'approval.plan_hash'),
    candidate_set_hash: hash(record.candidate_set_hash ?? record.candidateSetHash, 'approval.candidate_set_hash'),
    impact_set_hash: hash(record.impact_set_hash ?? record.impactSetHash, 'approval.impact_set_hash'),
    authority_context_hash: hash(record.authority_context_hash ?? record.authorityContextHash, 'approval.authority_context_hash'),
    ownership_revision: safeId(record.ownership_revision ?? record.ownershipRevision, 'approval.ownership_revision'),
    policy_revision: safeId(record.policy_revision ?? record.policyRevision, 'approval.policy_revision'),
    evidence_digest: hash(record.evidence_digest ?? record.evidenceDigest, 'approval.evidence_digest'),
    decided_at_epoch: epoch(record.decided_at_epoch ?? record.decided_at, 'approval.decided_at'),
    expires_at_epoch: epoch(record.expires_at_epoch ?? record.expires_at, 'approval.expires_at'),
    invalidated: record.invalidated === true,
    invalidated_reason: safeId(record.invalidated_reason ?? record.invalidatedReason, 'approval.invalidated_reason', { nullable: true }),
    supersedes_approval_id: safeId(record.supersedes_approval_id ?? record.supersedesApprovalId, 'approval.supersedes_approval_id', { nullable: true }),
    secrets_included: false,
  };
  if (!['approved', 'denied'].includes(normalized.decision)) {
    throw fail(400, 'STORAGE_APPROVAL_DECISION_INVALID', 'Approval decision must be approved or denied.');
  }
  normalized.record_digest = digest(normalized);
  return deepFreeze(normalized);
}

function normalizeJournalEvent(record) {
  assertSecretFree(record, 'journal_event');
  const normalized = {
    event_id: safeId(record.event_id ?? record.eventId, 'journal.event_id'),
    operation_id: safeId(record.operation_id ?? record.operationId, 'journal.operation_id'),
    run_id: safeId(record.run_id ?? record.runId, 'journal.run_id'),
    plan_id: safeId(record.plan_id ?? record.planId, 'journal.plan_id'),
    item_id: safeId(record.item_id ?? record.itemId, 'journal.item_id'),
    sequence: integer(record.sequence, 'journal.sequence', { minimum: 1 }),
    phase: text(record.phase, 32).toLowerCase(),
    result: text(record.result, 64).toLowerCase(),
    stat_digest: hash(record.stat_digest ?? record.statDigest, 'journal.stat_digest', { nullable: true }),
    evidence_digest: hash(record.evidence_digest ?? record.evidenceDigest, 'journal.evidence_digest'),
    observed_at_epoch: epoch(record.observed_at_epoch ?? record.observed_at, 'journal.observed_at'),
    secrets_included: false,
  };
  if (!['prepared', 'result', 'readback'].includes(normalized.phase)) {
    throw fail(400, 'STORAGE_JOURNAL_PHASE_INVALID', 'Journal phase must be prepared, result, or readback.');
  }
  normalized.record_digest = digest(normalized);
  return deepFreeze(normalized);
}

export function createHostingerStorageControlPlaneRepository({ adapter } = {}) {
  if (!adapter || typeof adapter.transaction !== 'function' || typeof adapter.read !== 'function' || typeof adapter.export_snapshot !== 'function') {
    throw fail(500, 'STORAGE_REPOSITORY_ADAPTER_INVALID', 'A transactional storage persistence adapter is required.');
  }

  function createOperation(record, { now_epoch = Math.floor(Date.now() / 1000) } = {}) {
    const normalized = normalizeOperation(record, now_epoch);
    return adapter.transaction((state) => {
      const existingId = state.operation_idempotency[normalized.idempotency_key];
      if (existingId) {
        const existing = state.operations[existingId];
        if (existing.record_digest !== normalized.record_digest) {
          throw fail(409, 'STORAGE_OPERATION_IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to a different operation envelope.', { existing_operation_id: existingId });
        }
        return { created: false, operation: existing, secrets_included: false };
      }
      if (state.operations[normalized.operation_id]) throw fail(409, 'STORAGE_OPERATION_ALREADY_EXISTS', 'Operation ID already exists.');
      const conflicting = Object.values(state.operations).find((operation) => operation.target_id === normalized.target_id && ACTIVE_OPERATION_STATES.has(operation.state));
      if (conflicting) throw fail(409, 'STORAGE_OPERATION_TARGET_BUSY', 'Another consequential operation is active for the target.', { operation_id: conflicting.operation_id });
      state.operations[normalized.operation_id] = clone(normalized);
      state.operation_idempotency[normalized.idempotency_key] = normalized.operation_id;
      return { created: true, operation: normalized, secrets_included: false };
    });
  }

  function transitionOperation({ operation_id, expected_version, next_state, terminal_reason = null, now_epoch = Math.floor(Date.now() / 1000) } = {}) {
    const operationId = safeId(operation_id, 'operation_id');
    const expectedVersion = integer(expected_version, 'expected_version', { minimum: 1 });
    const nextState = text(next_state, 64).toLowerCase();
    if (!ACTIVE_OPERATION_STATES.has(nextState) && !TERMINAL_OPERATION_STATES.has(nextState)) throw fail(400, 'STORAGE_OPERATION_STATE_INVALID', 'Unsupported next operation state.', { next_state: nextState });
    return adapter.transaction((state) => {
      const current = state.operations[operationId];
      if (!current) throw fail(404, 'STORAGE_OPERATION_NOT_FOUND', 'Storage operation not found.');
      if (current.version !== expectedVersion) throw fail(409, 'STORAGE_OPERATION_VERSION_CONFLICT', 'Operation version changed.', { observed_version: current.version });
      if (TERMINAL_OPERATION_STATES.has(current.state)) throw fail(409, 'STORAGE_OPERATION_TERMINAL', 'Terminal operation cannot transition.');
      const updated = normalizeOperation({
        ...current,
        state: nextState,
        version: current.version + 1,
        updated_at_epoch: now_epoch,
        terminal_reason: TERMINAL_OPERATION_STATES.has(nextState) ? terminal_reason : null,
      }, now_epoch);
      state.operations[operationId] = clone(updated);
      return updated;
    });
  }

  function persistImmutablePlan(record) {
    const normalized = normalizePlan(record);
    return adapter.transaction((state) => {
      const existing = state.plans[normalized.plan_id];
      if (existing) {
        if (existing.immutable_envelope_digest !== normalized.immutable_envelope_digest || existing.plan_hash !== normalized.plan_hash) {
          throw fail(409, 'STORAGE_PLAN_IMMUTABILITY_VIOLATION', 'Existing immutable plan cannot be replaced.');
        }
        return { created: false, plan: existing, secrets_included: false };
      }
      const operation = state.operations[normalized.operation_id];
      if (!operation) throw fail(409, 'STORAGE_PLAN_OPERATION_REQUIRED', 'Plan requires an existing operation.');
      if (operation.target_id !== normalized.target_id) throw fail(409, 'STORAGE_PLAN_TARGET_MISMATCH', 'Plan target does not match operation target.');
      state.plans[normalized.plan_id] = clone(normalized);
      return { created: true, plan: normalized, secrets_included: false };
    });
  }

  function appendApproval(record) {
    const normalized = normalizeApproval(record);
    return adapter.transaction((state) => {
      if (!state.plans[normalized.plan_id]) throw fail(409, 'STORAGE_APPROVAL_PLAN_REQUIRED', 'Approval requires an existing immutable plan.');
      const rows = state.approvals[normalized.plan_id] || [];
      const existing = rows.find((row) => row.approval_id === normalized.approval_id);
      if (existing) {
        if (existing.record_digest !== normalized.record_digest) throw fail(409, 'STORAGE_APPROVAL_ID_CONFLICT', 'Approval ID is already bound to different evidence.');
        return { created: false, approval: existing, secrets_included: false };
      }
      if (normalized.supersedes_approval_id) {
        const priorIndex = rows.findIndex((row) => row.approval_id === normalized.supersedes_approval_id);
        if (priorIndex < 0) throw fail(409, 'STORAGE_APPROVAL_SUPERSEDED_RECORD_REQUIRED', 'Superseded approval does not exist.');
        const prior = rows[priorIndex];
        rows[priorIndex] = { ...prior, invalidated: true, invalidated_reason: 'superseded', record_digest: digest({ ...prior, invalidated: true, invalidated_reason: 'superseded' }) };
      }
      rows.push(clone(normalized));
      state.approvals[normalized.plan_id] = rows;
      return { created: true, approval: normalized, secrets_included: false };
    });
  }

  function invalidateApprovals({ plan_id, reason, expected_plan_hash } = {}) {
    const planId = safeId(plan_id, 'plan_id');
    const normalizedReason = safeId(reason, 'reason');
    const expectedHash = hash(expected_plan_hash, 'expected_plan_hash');
    return adapter.transaction((state) => {
      const plan = state.plans[planId];
      if (!plan) throw fail(404, 'STORAGE_PLAN_NOT_FOUND', 'Plan not found.');
      if (plan.plan_hash !== expectedHash) throw fail(409, 'STORAGE_PLAN_HASH_CHANGED', 'Plan hash changed before approval invalidation.');
      const rows = state.approvals[planId] || [];
      let count = 0;
      state.approvals[planId] = rows.map((row) => {
        if (row.invalidated) return row;
        count += 1;
        const updated = { ...row, invalidated: true, invalidated_reason: normalizedReason };
        updated.record_digest = digest(updated);
        return updated;
      });
      return { invalidated_count: count, plan_id: planId, secrets_included: false };
    });
  }

  function acquireLease(record, { expected_generation = 0, now_epoch = Math.floor(Date.now() / 1000) } = {}) {
    assertSecretFree(record, 'lease');
    const targetId = safeId(record.target_id ?? record.targetId, 'lease.target_id');
    const operationId = safeId(record.operation_id ?? record.operationId, 'lease.operation_id');
    const expectedGeneration = integer(expected_generation, 'expected_generation');
    const now = epoch(now_epoch, 'now_epoch');
    const expires = epoch(record.expires_at_epoch ?? record.expires_at, 'lease.expires_at');
    if (expires <= now) throw fail(400, 'STORAGE_LEASE_EXPIRY_INVALID', 'Lease expiry must be in the future.');
    return adapter.transaction((state) => {
      const current = state.leases[targetId] || null;
      if (current && current.status === 'active' && current.expires_at_epoch > now && current.operation_id !== operationId) {
        throw fail(409, 'STORAGE_LEASE_TARGET_BUSY', 'Target already has an active execution lease.', { lease_id: current.lease_id, operation_id: current.operation_id });
      }
      const currentGeneration = current?.generation || 0;
      if (currentGeneration !== expectedGeneration) throw fail(409, 'STORAGE_LEASE_GENERATION_CONFLICT', 'Lease generation changed.', { observed_generation: currentGeneration });
      const normalized = {
        lease_id: safeId(record.lease_id ?? record.leaseId, 'lease_id'),
        target_id: targetId,
        operation_id: operationId,
        purpose: safeId(record.purpose, 'lease.purpose'),
        generation: currentGeneration + 1,
        holder_ref: safeId(record.holder_ref ?? record.holderRef, 'lease.holder_ref'),
        acquired_at_epoch: now,
        renewed_at_epoch: now,
        expires_at_epoch: expires,
        status: 'active',
        evidence_digest: hash(record.evidence_digest ?? record.evidenceDigest, 'lease.evidence_digest'),
        secrets_included: false,
      };
      normalized.record_digest = digest(normalized);
      state.leases[targetId] = normalized;
      return deepFreeze(clone(normalized));
    });
  }

  function renewLease({ target_id, lease_id, operation_id, holder_ref, expected_generation, expires_at_epoch, evidence_digest, now_epoch = Math.floor(Date.now() / 1000) } = {}) {
    const targetId = safeId(target_id, 'target_id');
    const expected = integer(expected_generation, 'expected_generation', { minimum: 1 });
    const now = epoch(now_epoch, 'now_epoch');
    const expires = epoch(expires_at_epoch, 'expires_at_epoch');
    return adapter.transaction((state) => {
      const current = state.leases[targetId];
      if (!current) throw fail(404, 'STORAGE_LEASE_NOT_FOUND', 'Lease not found.');
      if (current.generation !== expected) throw fail(409, 'STORAGE_LEASE_GENERATION_CONFLICT', 'Lease generation changed.', { observed_generation: current.generation });
      if (current.lease_id !== safeId(lease_id, 'lease_id') || current.operation_id !== safeId(operation_id, 'operation_id') || current.holder_ref !== safeId(holder_ref, 'holder_ref')) {
        throw fail(409, 'STORAGE_LEASE_HOLDER_MISMATCH', 'Only the current holder can renew the lease.');
      }
      if (current.status !== 'active' || current.expires_at_epoch <= now) throw fail(409, 'STORAGE_LEASE_NOT_ACTIVE', 'Expired or inactive lease cannot be renewed.');
      if (expires <= now) throw fail(400, 'STORAGE_LEASE_EXPIRY_INVALID', 'Renewed lease expiry must be in the future.');
      const updated = { ...current, generation: current.generation + 1, renewed_at_epoch: now, expires_at_epoch: expires, evidence_digest: hash(evidence_digest, 'evidence_digest') };
      updated.record_digest = digest(updated);
      state.leases[targetId] = updated;
      return deepFreeze(clone(updated));
    });
  }

  function releaseLease({ target_id, lease_id, operation_id, holder_ref, expected_generation, evidence_digest, now_epoch = Math.floor(Date.now() / 1000) } = {}) {
    const targetId = safeId(target_id, 'target_id');
    const expected = integer(expected_generation, 'expected_generation', { minimum: 1 });
    return adapter.transaction((state) => {
      const current = state.leases[targetId];
      if (!current) throw fail(404, 'STORAGE_LEASE_NOT_FOUND', 'Lease not found.');
      if (current.generation !== expected) throw fail(409, 'STORAGE_LEASE_GENERATION_CONFLICT', 'Lease generation changed.', { observed_generation: current.generation });
      if (current.lease_id !== safeId(lease_id, 'lease_id') || current.operation_id !== safeId(operation_id, 'operation_id') || current.holder_ref !== safeId(holder_ref, 'holder_ref')) {
        throw fail(409, 'STORAGE_LEASE_HOLDER_MISMATCH', 'Only the current holder can release the lease.');
      }
      const updated = {
        ...current,
        generation: current.generation + 1,
        status: 'released',
        released_at_epoch: epoch(now_epoch, 'now_epoch'),
        release_evidence_digest: hash(evidence_digest, 'release_evidence_digest'),
      };
      updated.record_digest = digest(updated);
      state.leases[targetId] = updated;
      return deepFreeze(clone(updated));
    });
  }

  function appendJournalEvent(record) {
    const normalized = normalizeJournalEvent(record);
    return adapter.transaction((state) => {
      const rows = state.journals[normalized.run_id] || [];
      const existing = rows.find((row) => row.event_id === normalized.event_id);
      if (existing) {
        if (existing.record_digest !== normalized.record_digest) throw fail(409, 'STORAGE_JOURNAL_EVENT_ID_CONFLICT', 'Journal event ID is bound to different evidence.');
        return { created: false, event: existing, secrets_included: false };
      }
      const expectedSequence = rows.length + 1;
      if (normalized.sequence !== expectedSequence) throw fail(409, 'STORAGE_JOURNAL_SEQUENCE_CONFLICT', 'Journal events must be appended without gaps or truncation.', { expected_sequence: expectedSequence });
      const sameItem = rows.filter((row) => row.item_id === normalized.item_id);
      if (normalized.phase === 'result' && !sameItem.some((row) => row.phase === 'prepared')) {
        throw fail(409, 'STORAGE_JOURNAL_PREPARED_EVENT_REQUIRED', 'A durable prepared event must precede the result event.');
      }
      if (normalized.phase === 'readback' && !sameItem.some((row) => row.phase === 'result')) {
        throw fail(409, 'STORAGE_JOURNAL_RESULT_EVENT_REQUIRED', 'A durable result event must precede readback.');
      }
      rows.push(clone(normalized));
      state.journals[normalized.run_id] = rows;
      return { created: true, event: normalized, secrets_included: false };
    });
  }

  function consumePlan({ plan_id, expected_plan_hash, run_id, consumed_at_epoch = Math.floor(Date.now() / 1000) } = {}) {
    const planId = safeId(plan_id, 'plan_id');
    const expectedHash = hash(expected_plan_hash, 'expected_plan_hash');
    const runId = safeId(run_id, 'run_id');
    return adapter.transaction((state) => {
      const plan = state.plans[planId];
      if (!plan) throw fail(404, 'STORAGE_PLAN_NOT_FOUND', 'Plan not found.');
      if (plan.plan_hash !== expectedHash) throw fail(409, 'STORAGE_PLAN_HASH_CHANGED', 'Plan hash changed before consumption.');
      if (plan.consumed) {
        if (plan.consumed_run_id === runId) return { consumed: false, plan, replay: true, secrets_included: false };
        throw fail(409, 'STORAGE_PLAN_ALREADY_CONSUMED', 'Plan has already been consumed by another run.', { consumed_run_id: plan.consumed_run_id });
      }
      const updated = { ...plan, consumed: true, status: 'consumed', consumed_run_id: runId, consumed_at_epoch: epoch(consumed_at_epoch, 'consumed_at_epoch') };
      updated.record_digest = digest(updated);
      state.plans[planId] = updated;
      return { consumed: true, plan: deepFreeze(clone(updated)), replay: false, secrets_included: false };
    });
  }

  function recordReconciliation(record) {
    assertSecretFree(record, 'reconciliation');
    const normalized = {
      reconciliation_id: safeId(record.reconciliation_id ?? record.reconciliationId, 'reconciliation_id'),
      operation_id: safeId(record.operation_id ?? record.operationId, 'reconciliation.operation_id'),
      run_id: safeId(record.run_id ?? record.runId, 'reconciliation.run_id'),
      outcome: text(record.outcome, 32).toLowerCase(),
      input_evidence_hash: hash(record.input_evidence_hash ?? record.inputEvidenceHash, 'reconciliation.input_evidence_hash'),
      result_digest: hash(record.result_digest ?? record.resultDigest, 'reconciliation.result_digest'),
      retry_allowed: record.retry_allowed === true,
      reviewed_at_epoch: epoch(record.reviewed_at_epoch ?? record.reviewed_at, 'reconciliation.reviewed_at'),
      secrets_included: false,
    };
    if (!['applied', 'partially_applied', 'not_applied', 'conflict', 'still_unknown'].includes(normalized.outcome)) {
      throw fail(400, 'STORAGE_RECONCILIATION_OUTCOME_INVALID', 'Unsupported reconciliation outcome.');
    }
    if (normalized.retry_allowed && normalized.outcome !== 'not_applied') {
      throw fail(409, 'STORAGE_RECONCILIATION_RETRY_FORBIDDEN', 'Retry is allowed only after complete not-applied proof.');
    }
    normalized.record_digest = digest(normalized);
    return adapter.transaction((state) => {
      const existing = state.reconciliations[normalized.reconciliation_id];
      if (existing) {
        if (existing.record_digest !== normalized.record_digest) throw fail(409, 'STORAGE_RECONCILIATION_ID_CONFLICT', 'Reconciliation ID is bound to different evidence.');
        return { created: false, reconciliation: existing, secrets_included: false };
      }
      state.reconciliations[normalized.reconciliation_id] = normalized;
      return { created: true, reconciliation: deepFreeze(clone(normalized)), secrets_included: false };
    });
  }

  function readAggregate(operationId) {
    const id = safeId(operationId, 'operation_id');
    return adapter.read((state, transactionVersion) => {
      const operation = state.operations[id];
      if (!operation) return null;
      const plans = Object.values(state.plans).filter((plan) => plan.operation_id === id);
      const planIds = new Set(plans.map((plan) => plan.plan_id));
      const approvals = Object.entries(state.approvals).filter(([planId]) => planIds.has(planId)).flatMap(([, rows]) => rows);
      const leases = Object.values(state.leases).filter((lease) => lease.operation_id === id);
      const journals = Object.values(state.journals).flat().filter((event) => event.operation_id === id);
      const reconciliations = Object.values(state.reconciliations).filter((row) => row.operation_id === id);
      const aggregate = { operation, plans, approvals, leases, journals, reconciliations, transaction_version: transactionVersion, secrets_included: false };
      return { ...aggregate, aggregate_digest: digest(aggregate) };
    });
  }

  return Object.freeze({
    repository_version: HOSTINGER_STORAGE_CONTROL_PLANE_REPOSITORY_VERSION,
    adapter_key: adapter.adapter_key || 'unknown',
    production_ready: adapter.production_ready === true,
    createOperation,
    transitionOperation,
    persistImmutablePlan,
    appendApproval,
    invalidateApprovals,
    acquireLease,
    renewLease,
    releaseLease,
    appendJournalEvent,
    consumePlan,
    recordReconciliation,
    readAggregate,
    exportSnapshot: () => adapter.export_snapshot(),
  });
}
