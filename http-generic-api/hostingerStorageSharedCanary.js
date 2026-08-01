import { createHash } from 'node:crypto';
import {
  HOSTINGER_STORAGE_SHARED_CANARY_VERSION,
  buildHostingerStorageSharedCanaryAuthorization as buildCoreAuthorization,
  verifyHostingerStorageSharedCanaryAuthorization as verifyCoreAuthorization,
  createMemoryHostingerStorageSharedCanaryAuthorityStore as createCoreAuthorityStore,
  createMemoryHostingerStorageSharedCanaryEnablementRegistry,
  executeHostingerStorageSharedCanary as executeCoreCanary,
} from './hostingerStorageSharedCanaryCore.js';

export { HOSTINGER_STORAGE_SHARED_CANARY_VERSION, createMemoryHostingerStorageSharedCanaryEnablementRegistry };

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;

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
  if (!SAFE_ID_RE.test(normalized)) throw fail(400, 'STORAGE_SHARED_CANARY_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) throw fail(400, 'STORAGE_SHARED_CANARY_HASH_INVALID', 'A SHA-256 binding is required.', { field });
  return normalized;
}

function epoch(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw fail(400, 'STORAGE_SHARED_CANARY_TIME_INVALID', 'A non-negative epoch timestamp is required.', { field });
  return normalized;
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw fail(400, 'STORAGE_SHARED_CANARY_INTEGER_INVALID', 'A positive integer is required.', { field });
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

function unique(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
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

function normalizeQuorumEvidence(input = {}) {
  return {
    mode: safeId(input.mode, 'quorum.mode'),
    policy_id: safeId(input.policy_id, 'quorum.policy_id'),
    policy_revision: safeId(input.policy_revision, 'quorum.policy_revision'),
    status: safeId(input.status, 'quorum.status'),
    target_id: safeId(input.target_id, 'quorum.target_id'),
    plan_hash: hash(input.plan_hash, 'quorum.plan_hash'),
    impact_set_hash: hash(input.impact_set_hash, 'quorum.impact_set_hash'),
    authority_context_hash: hash(input.authority_context_hash, 'quorum.authority_context_hash'),
    minimum_approvals: positiveInteger(input.minimum_approvals, 'quorum.minimum_approvals'),
    release_authority_approved: input.release_authority_approved === true,
    approved_by_role: safeId(input.approved_by_role, 'quorum.approved_by_role'),
    decided_at_epoch: epoch(input.decided_at_epoch, 'quorum.decided_at_epoch'),
    expires_at_epoch: epoch(input.expires_at_epoch, 'quorum.expires_at_epoch'),
    evidence_digest: hash(input.evidence_digest, 'quorum.evidence_digest'),
    secrets_included: false,
  };
}

function workspaceSlotInvalid(approval = {}) {
  const role = text(approval.role, 256);
  if (role !== 'workspace_owner') return false;
  const workspaceId = text(approval.workspace_id, 256);
  return !workspaceId || text(approval.slot, 256) !== `workspace_owner:${workspaceId}`;
}

function quorumBindingBlockers(record, authorization, now) {
  const blockers = [];
  if (record.mode !== 'approved_quorum' || record.status !== 'approved') blockers.push('STORAGE_SHARED_CANARY_QUORUM_POLICY_INVALID');
  if (record.target_id !== authorization.operation.target_id
    || record.plan_hash !== authorization.immutable_plan.plan_hash
    || record.impact_set_hash !== authorization.impact_set.impact_set_hash
    || record.authority_context_hash !== authorization.operation.authority_context_hash) blockers.push('STORAGE_SHARED_CANARY_QUORUM_POLICY_BINDING_MISMATCH');
  if (record.approved_by_role !== 'release_authority' || record.release_authority_approved !== true
    || record.decided_at_epoch > now || record.expires_at_epoch <= now) blockers.push('STORAGE_SHARED_CANARY_QUORUM_POLICY_INVALID');
  if (record.minimum_approvals < 1 || record.minimum_approvals > authorization.impact_set.workspace_ids.length) blockers.push('STORAGE_SHARED_CANARY_QUORUM_POLICY_INVALID');
  return unique(blockers);
}

function governedQuorumBlockers(record, store, authorization, now) {
  const blockers = quorumBindingBlockers(record, authorization, now);
  if (!store || store.synthetic_only !== true || store.production_ready !== false || typeof store.readQuorum !== 'function') {
    blockers.push('STORAGE_SHARED_CANARY_QUORUM_AUTHORITY_REQUIRED');
    return unique(blockers);
  }
  const current = store.readQuorum(record.policy_id);
  if (!current || digest(current) !== digest(record)) blockers.push('STORAGE_SHARED_CANARY_QUORUM_CURRENT_STATE_INVALID');
  return unique(blockers);
}

function rebuildResult(coreResult, extraBlockers, quorumRecord = null) {
  const authorization = clone(coreResult.authorization);
  if (quorumRecord) authorization.quorum_policy = quorumRecord;
  authorization.blockers = unique([...(authorization.blockers || []), ...extraBlockers]);
  const authorizationDigest = digest(authorization);
  return deepFreeze({
    ...clone(coreResult),
    canary_ready: authorization.blockers.length === 0,
    authorization,
    authorization_digest: authorizationDigest,
    blockers: authorization.blockers,
    dispatch_allowed: false,
    live_provider_allowed: false,
    production_ready: false,
    secrets_included: false,
  });
}

export function buildHostingerStorageSharedCanaryAuthorization(input = {}) {
  const { quorum_authority_store, ...coreInput } = input;
  const coreResult = buildCoreAuthorization(coreInput);
  const extraBlockers = [];
  const approvals = Array.isArray(input.workspace_approvals) ? input.workspace_approvals : [];
  if (approvals.some(workspaceSlotInvalid)) extraBlockers.push('STORAGE_SHARED_CANARY_WORKSPACE_APPROVAL_SLOT_INVALID');

  let quorumRecord = null;
  if (text(input.quorum_policy?.mode, 64) === 'approved_quorum') {
    quorumRecord = normalizeQuorumEvidence(input.quorum_policy);
    const previewAuthorization = clone(coreResult.authorization);
    previewAuthorization.quorum_policy = quorumRecord;
    extraBlockers.push(...governedQuorumBlockers(quorumRecord, quorum_authority_store, previewAuthorization, epoch(input.now_epoch ?? Math.floor(Date.now() / 1000), 'now_epoch')));
  }
  return rebuildResult(coreResult, unique(extraBlockers), quorumRecord);
}

export function verifyHostingerStorageSharedCanaryAuthorization({ authorization, expected_digest, now_epoch = Math.floor(Date.now() / 1000) } = {}) {
  const core = verifyCoreAuthorization({ authorization, expected_digest, now_epoch });
  const blockers = [...(core.blockers || [])];
  if ((authorization?.workspace_approvals || []).some(workspaceSlotInvalid)) blockers.push('STORAGE_SHARED_CANARY_WORKSPACE_APPROVAL_SLOT_INVALID');
  if (authorization?.quorum_policy?.mode === 'approved_quorum') blockers.push(...quorumBindingBlockers(normalizeQuorumEvidence(authorization.quorum_policy), authorization, epoch(now_epoch, 'now_epoch')));
  const normalized = unique(blockers);
  return deepFreeze({ ...clone(core), valid: normalized.length === 0, blockers: normalized, dispatch_allowed: false, secrets_included: false });
}

export function createMemoryHostingerStorageSharedCanaryAuthorityStore() {
  const core = createCoreAuthorityStore();
  const quorumRecords = new Map();
  return Object.freeze({
    ...core,
    registerQuorum(record) {
      const normalized = deepFreeze(normalizeQuorumEvidence(record));
      const existing = quorumRecords.get(normalized.policy_id);
      if (existing && digest(existing) !== digest(normalized)) throw fail(409, 'STORAGE_SHARED_CANARY_QUORUM_ID_CONFLICT', 'Quorum policy ID is already bound to different evidence.');
      if (!existing) quorumRecords.set(normalized.policy_id, normalized);
      return clone(quorumRecords.get(normalized.policy_id));
    },
    readQuorum(policyId) {
      return clone(quorumRecords.get(safeId(policyId, 'quorum.policy_id')) || null);
    },
    updateQuorum({ policy_id, expected_evidence_digest, record } = {}) {
      const id = safeId(policy_id, 'quorum.policy_id');
      const current = quorumRecords.get(id);
      if (!current) throw fail(404, 'STORAGE_SHARED_CANARY_QUORUM_NOT_FOUND', 'Current governed quorum policy was not found.');
      const expected = hash(expected_evidence_digest, 'quorum.expected_evidence_digest');
      if (current.evidence_digest !== expected) throw fail(409, 'STORAGE_SHARED_CANARY_QUORUM_EVIDENCE_CONFLICT', 'Quorum evidence changed before update.', { current_evidence_digest: current.evidence_digest });
      const normalized = deepFreeze(normalizeQuorumEvidence({ ...record, policy_id: id }));
      if (normalized.evidence_digest === current.evidence_digest) throw fail(409, 'STORAGE_SHARED_CANARY_QUORUM_EVIDENCE_NOT_ADVANCED', 'Quorum updates must advance the governed evidence token.', { current_evidence_digest: current.evidence_digest });
      quorumRecords.set(id, normalized);
      return clone(normalized);
    },
  });
}

export function executeHostingerStorageSharedCanary(input = {}) {
  const authorization = input.canary_authorization?.authorization;
  if (authorization?.quorum_policy?.mode === 'approved_quorum') {
    const verification = verifyHostingerStorageSharedCanaryAuthorization({
      authorization,
      expected_digest: input.canary_authorization?.authorization_digest,
      now_epoch: input.now_epoch,
    });
    if (!verification.valid) throw fail(409, 'STORAGE_SHARED_CANARY_AUTHORIZATION_INVALID', 'Shared canary authorization is stale or blocked.', { blockers: verification.blockers });
    const quorumRecord = normalizeQuorumEvidence(authorization.quorum_policy);
    const blockers = governedQuorumBlockers(quorumRecord, input.authority_store, authorization, epoch(input.now_epoch ?? Math.floor(Date.now() / 1000), 'now_epoch'));
    if (blockers.length) throw fail(409, 'STORAGE_SHARED_CANARY_QUORUM_CURRENT_STATE_INVALID', 'Current governed quorum evidence no longer authorizes this Shared canary.', { blockers });
  }
  return executeCoreCanary(input);
}
