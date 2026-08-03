import { createHash } from 'node:crypto';
import { buildCanonicalHostingerStoragePlanEnvelope } from './hostingerStorageExecutionAuthorizationV2.js';
import { verifyHostingerStorageSyntheticExecutionProtocol } from './hostingerStorageExecutorProtocol.js';
import { executeHostingerStorageSyntheticPlan } from './hostingerStorageSyntheticExecutor.js';

export const HOSTINGER_STORAGE_SHARED_CANARY_VERSION = 'spec014-hostinger-storage-shared-canary-v1';

const EXPECTED_PROTOCOL_VERSION = 'spec014-hostinger-storage-executor-v1';
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,510}$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const GIT_SHA_RE = /^[0-9a-f]{40}$/i;

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

function safeRef(value, field) {
  const normalized = text(value, 512);
  if (!SAFE_REF_RE.test(normalized) || normalized.startsWith('/') || normalized.includes('..') || /[\\\0\r\n]/u.test(normalized)) {
    throw fail(400, 'STORAGE_SHARED_CANARY_REFERENCE_INVALID', 'A bounded opaque reference is required.', { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) throw fail(400, 'STORAGE_SHARED_CANARY_HASH_INVALID', 'A SHA-256 binding is required.', { field });
  return normalized;
}

function gitSha(value, field) {
  const normalized = text(value, 40).toLowerCase();
  if (!GIT_SHA_RE.test(normalized)) throw fail(400, 'STORAGE_SHARED_CANARY_GIT_SHA_INVALID', 'An exact 40-character Git SHA is required.', { field });
  return normalized;
}

function epoch(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw fail(400, 'STORAGE_SHARED_CANARY_TIME_INVALID', 'A non-negative epoch timestamp is required.', { field });
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) throw fail(400, 'STORAGE_SHARED_CANARY_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
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
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value, 256)).filter(Boolean))].sort();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function assertSecretFree(value, path = 'value', depth = 0, ancestors = new WeakSet()) {
  if (depth > 16 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1, ancestors));
    return;
  }
  if (typeof value !== 'object') return;
  if (ancestors.has(value)) throw fail(400, 'STORAGE_SHARED_CANARY_SECRET_FIELD_REJECTED', 'Cyclic canary input is forbidden.', { path });
  ancestors.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'secrets_included' && entry !== false) throw fail(400, 'STORAGE_SHARED_CANARY_SECRET_FIELD_REJECTED', 'Secret declaration must remain false.', { path: `${path}.${key}` });
    if (key !== 'secrets_included' && /(password|passwd|secret|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|raw_authorization|cookie|session_cookie|raw_provider_payload|absolute_path|shell_command|file_content)/i.test(key)) {
      throw fail(400, 'STORAGE_SHARED_CANARY_SECRET_FIELD_REJECTED', 'Shared canary inputs must not contain secret-bearing or free-form execution fields.', { path: `${path}.${key}` });
    }
    assertSecretFree(entry, `${path}.${key}`, depth + 1, ancestors);
  }
  ancestors.delete(value);
}

function normalizeOperation(operation = {}) {
  return {
    operation_id: safeId(operation.operation_id, 'operation.operation_id'),
    operation_key: safeId(operation.operation_key, 'operation.operation_key'),
    context_mode: safeId(operation.context_mode, 'operation.context_mode'),
    target_scope: safeId(operation.target_scope, 'operation.target_scope'),
    target_id: safeId(operation.target_id, 'operation.target_id'),
    authority_context_hash: hash(operation.authority_context_hash, 'operation.authority_context_hash'),
    ownership_revision: safeId(operation.ownership_revision, 'operation.ownership_revision'),
    policy_revision: safeId(operation.policy_revision, 'operation.policy_revision'),
  };
}

function normalizeCommittedItem(item = {}, index, canonical = false) {
  const source = canonical ? item : item.expected || {};
  return {
    item_id: safeId(item.item_id, `items[${index}].item_id`),
    ordinal: integer(item.ordinal, `items[${index}].ordinal`),
    category: safeId(item.category, `items[${index}].category`),
    path_ref: safeRef(item.path_ref, `items[${index}].path_ref`),
    item_hash: hash(item.item_hash, `items[${index}].item_hash`),
    relative_path_digest: hash(item.relative_path_digest, `items[${index}].relative_path_digest`),
    size_bytes: integer(source.size_bytes, `items[${index}].size_bytes`),
    device: integer(source.device, `items[${index}].device`),
    inode: integer(source.inode, `items[${index}].inode`),
    ctime_epoch: integer(source.ctime_epoch, `items[${index}].ctime_epoch`),
    mtime_epoch: integer(source.mtime_epoch, `items[${index}].mtime_epoch`),
    file_type: safeId(source.file_type, `items[${index}].file_type`),
  };
}

function normalizeProtocol(protocol = {}) {
  const items = (Array.isArray(protocol.items) ? protocol.items : []).map((item, index) => normalizeCommittedItem(item, index, false));
  return {
    protocol_key: safeId(protocol.protocol_key, 'protocol.protocol_key'),
    protocol_version: safeId(protocol.protocol_version, 'protocol.protocol_version'),
    run_id: safeId(protocol.run_id, 'protocol.run_id'),
    operation_id: safeId(protocol.operation_id, 'protocol.operation_id'),
    plan_id: safeId(protocol.plan_id, 'protocol.plan_id'),
    target_id: safeId(protocol.target_id, 'protocol.target_id'),
    plan_hash: hash(protocol.plan_hash, 'protocol.plan_hash'),
    candidate_set_hash: hash(protocol.candidate_set_hash, 'protocol.candidate_set_hash'),
    authorization_bundle_hash: hash(protocol.authorization_bundle_hash, 'protocol.authorization_bundle_hash'),
    item_count: items.length,
    item_set_digest: digest(items),
    synthetic_only: protocol.synthetic_only === true,
    production_ready: protocol.production_ready === true,
    provider_dispatch_allowed: protocol.provider_dispatch_allowed === true,
    automatic_retry_allowed: protocol.automatic_retry_allowed === true,
  };
}

function normalizePlan(plan = {}) {
  const canonical = buildCanonicalHostingerStoragePlanEnvelope(plan);
  const items = canonical.envelope.items.map((item, index) => normalizeCommittedItem(item, index, true));
  return {
    plan_id: safeId(canonical.envelope.plan_id, 'plan.plan_id'),
    operation_id: safeId(canonical.envelope.operation_id, 'plan.operation_id'),
    target_id: safeId(canonical.envelope.target_id, 'plan.target_id'),
    plan_hash: hash(canonical.plan_hash, 'plan.plan_hash'),
    candidate_set_hash: hash(canonical.candidate_set_hash, 'plan.candidate_set_hash'),
    impact_set_hash: hash(canonical.envelope.impact_set_hash, 'plan.impact_set_hash'),
    item_count: items.length,
    item_set_digest: digest(items),
  };
}

function normalizeImpactSet(input = {}) {
  return {
    impact_set_id: safeId(input.impact_set_id, 'impact_set.impact_set_id'),
    status: safeId(input.status, 'impact_set.status'),
    target_id: safeId(input.target_id, 'impact_set.target_id'),
    plan_hash: hash(input.plan_hash, 'impact_set.plan_hash'),
    impact_set_hash: hash(input.impact_set_hash, 'impact_set.impact_set_hash'),
    workspace_ids: unique(input.workspace_ids).map((id, index) => safeId(id, `impact_set.workspace_ids[${index}]`)),
    complete: input.complete === true,
    unknown_count: integer(input.unknown_count, 'impact_set.unknown_count'),
    evidence_digest: hash(input.evidence_digest, 'impact_set.evidence_digest'),
  };
}

function normalizeApproval(input = {}, label = 'approval') {
  return {
    approval_id: safeId(input.approval_id, `${label}.approval_id`),
    slot: safeId(input.slot, `${label}.slot`),
    role: safeId(input.role, `${label}.role`),
    status: safeId(input.status, `${label}.status`),
    workspace_id: input.workspace_id ? safeId(input.workspace_id, `${label}.workspace_id`) : null,
    target_id: safeId(input.target_id, `${label}.target_id`),
    plan_hash: hash(input.plan_hash, `${label}.plan_hash`),
    impact_set_hash: hash(input.impact_set_hash, `${label}.impact_set_hash`),
    authority_context_hash: hash(input.authority_context_hash, `${label}.authority_context_hash`),
    active_production_sha: input.active_production_sha ? gitSha(input.active_production_sha, `${label}.active_production_sha`) : null,
    decided_at_epoch: epoch(input.decided_at_epoch, `${label}.decided_at_epoch`),
    expires_at_epoch: epoch(input.expires_at_epoch, `${label}.expires_at_epoch`),
    evidence_digest: hash(input.evidence_digest, `${label}.evidence_digest`),
  };
}

function normalizeQuorum(input = {}, workspaceCount) {
  const mode = safeId(input.mode, 'quorum.mode');
  return {
    mode,
    policy_id: input.policy_id ? safeId(input.policy_id, 'quorum.policy_id') : null,
    policy_revision: input.policy_revision ? safeId(input.policy_revision, 'quorum.policy_revision') : null,
    status: input.status ? safeId(input.status, 'quorum.status') : null,
    minimum_approvals: integer(input.minimum_approvals ?? workspaceCount, 'quorum.minimum_approvals'),
    release_authority_approved: input.release_authority_approved === true,
    evidence_digest: input.evidence_digest ? hash(input.evidence_digest, 'quorum.evidence_digest') : null,
  };
}

function normalizeLayout(input = {}) {
  return {
    layout_proof_id: safeId(input.layout_proof_id, 'layout.layout_proof_id'),
    status: safeId(input.status, 'layout.status'),
    target_id: safeId(input.target_id, 'layout.target_id'),
    layout_revision: safeId(input.layout_revision, 'layout.layout_revision'),
    active_production_sha: gitSha(input.active_production_sha, 'layout.active_production_sha'),
    active_root_excluded: input.active_root_excluded === true,
    rollback_set_retained: input.rollback_set_retained === true,
    rollback_set_count: integer(input.rollback_set_count, 'layout.rollback_set_count'),
    candidate_roots_certified: input.candidate_roots_certified === true,
    evidence_digest: hash(input.evidence_digest, 'layout.evidence_digest'),
  };
}

function normalizeReserve(input = {}) {
  return {
    certification_id: safeId(input.certification_id, 'reserve.certification_id'),
    status: safeId(input.status, 'reserve.status'),
    target_id: safeId(input.target_id, 'reserve.target_id'),
    reserve_ref: safeRef(input.reserve_ref, 'reserve.reserve_ref'),
    reserve_fingerprint_digest: hash(input.reserve_fingerprint_digest, 'reserve.reserve_fingerprint_digest'),
    reserve_size_bytes: integer(input.reserve_size_bytes, 'reserve.reserve_size_bytes', 1048576),
    reserve_file_type: safeId(input.reserve_file_type, 'reserve.reserve_file_type'),
    active_incident_id: safeId(input.active_incident_id, 'reserve.active_incident_id'),
    release_separate_authorization_required: input.release_separate_authorization_required === true,
    evidence_digest: hash(input.evidence_digest, 'reserve.evidence_digest'),
  };
}

function normalizeEnablement(input = {}) {
  return {
    enablement_id: safeId(input.enablement_id, 'enablement.enablement_id'),
    mode: safeId(input.mode, 'enablement.mode'),
    status: safeId(input.status, 'enablement.status'),
    operation_id: safeId(input.operation_id, 'enablement.operation_id'),
    target_id: safeId(input.target_id, 'enablement.target_id'),
    plan_hash: hash(input.plan_hash, 'enablement.plan_hash'),
    impact_set_hash: hash(input.impact_set_hash, 'enablement.impact_set_hash'),
    approved_by_role: safeId(input.approved_by_role, 'enablement.approved_by_role'),
    generation: integer(input.generation, 'enablement.generation', 1),
    enabled_at_epoch: epoch(input.enabled_at_epoch, 'enablement.enabled_at_epoch'),
    expires_at_epoch: epoch(input.expires_at_epoch, 'enablement.expires_at_epoch'),
    consumed: input.consumed === true,
    evidence_digest: hash(input.evidence_digest, 'enablement.evidence_digest'),
  };
}

export function buildHostingerStorageSharedCanaryAuthorization({
  operation,
  protocol,
  protocol_digest,
  immutable_plan,
  impact_set,
  platform_admin_approval,
  release_authority_approval,
  workspace_approvals = [],
  quorum_policy,
  deployment_layout_proof,
  reserve_certification,
  manual_enablement,
  now_epoch = Math.floor(Date.now() / 1000),
} = {}) {
  assertSecretFree({ operation, protocol, immutable_plan, impact_set, platform_admin_approval, release_authority_approval, workspace_approvals, quorum_policy, deployment_layout_proof, reserve_certification, manual_enablement }, 'shared_canary');
  const now = epoch(now_epoch, 'now_epoch');
  const op = normalizeOperation(operation);
  const protocolValue = normalizeProtocol(protocol);
  const plan = normalizePlan(immutable_plan);
  const impact = normalizeImpactSet(impact_set);
  const platformApproval = normalizeApproval(platform_admin_approval, 'platform_admin_approval');
  const releaseApproval = normalizeApproval(release_authority_approval, 'release_authority_approval');
  const workspaceApprovals = workspace_approvals.map((approval, index) => normalizeApproval(approval, `workspace_approvals[${index}]`));
  const quorum = normalizeQuorum(quorum_policy, impact.workspace_ids.length);
  const layout = normalizeLayout(deployment_layout_proof);
  const reserve = normalizeReserve(reserve_certification);
  const enablement = normalizeEnablement(manual_enablement);
  const blockers = [];

  if (op.context_mode !== 'admin') blockers.push('STORAGE_SHARED_CANARY_ADMIN_CONTEXT_REQUIRED');
  if (op.operation_key !== 'hostinger_storage_apply_plan') blockers.push('STORAGE_SHARED_CANARY_OPERATION_KEY_INVALID');
  if (!['shared', 'platform'].includes(op.target_scope)) blockers.push('STORAGE_SHARED_CANARY_SHARED_OR_PLATFORM_TARGET_REQUIRED');
  if (protocolValue.protocol_key !== 'hostinger_storage_synthetic_execution_protocol_v1' || protocolValue.protocol_version !== EXPECTED_PROTOCOL_VERSION) blockers.push('STORAGE_SHARED_CANARY_SYNTHETIC_PROTOCOL_REQUIRED');
  if (protocolValue.item_count < 1) blockers.push('STORAGE_SHARED_CANARY_ITEMS_REQUIRED');
  if (!protocolValue.synthetic_only || protocolValue.production_ready || protocolValue.provider_dispatch_allowed || protocolValue.automatic_retry_allowed) blockers.push('STORAGE_SHARED_CANARY_UNSAFE_PROTOCOL');
  if (hash(protocol_digest, 'protocol_digest') !== digest(protocol)) blockers.push('STORAGE_SHARED_CANARY_PROTOCOL_DIGEST_MISMATCH');
  if (protocolValue.operation_id !== op.operation_id || protocolValue.target_id !== op.target_id) blockers.push('STORAGE_SHARED_CANARY_OPERATION_TARGET_MISMATCH');
  if (plan.operation_id !== op.operation_id || plan.target_id !== op.target_id || plan.plan_id !== protocolValue.plan_id
    || plan.plan_hash !== protocolValue.plan_hash || plan.candidate_set_hash !== protocolValue.candidate_set_hash) blockers.push('STORAGE_SHARED_CANARY_IMMUTABLE_PLAN_MISMATCH');
  if (plan.item_count !== protocolValue.item_count || plan.item_set_digest !== protocolValue.item_set_digest) blockers.push('STORAGE_SHARED_CANARY_CANDIDATE_ITEMS_MISMATCH');

  if (impact.status !== 'resolved' || !impact.complete || impact.unknown_count !== 0) blockers.push('STORAGE_SHARED_CANARY_IMPACT_SET_INCOMPLETE');
  if (impact.target_id !== op.target_id || impact.plan_hash !== plan.plan_hash || impact.impact_set_hash !== plan.impact_set_hash) blockers.push('STORAGE_SHARED_CANARY_IMPACT_SET_MISMATCH');
  if (op.target_scope === 'shared' && impact.workspace_ids.length < 1) blockers.push('STORAGE_SHARED_CANARY_IMPACT_WORKSPACES_REQUIRED');

  const commonApprovalMismatch = (approval) => approval.target_id !== op.target_id || approval.plan_hash !== plan.plan_hash
    || approval.impact_set_hash !== impact.impact_set_hash || approval.authority_context_hash !== op.authority_context_hash;
  if (platformApproval.status !== 'approved' || platformApproval.role !== 'platform_admin' || platformApproval.slot !== 'platform_admin'
    || commonApprovalMismatch(platformApproval) || platformApproval.decided_at_epoch > now || platformApproval.expires_at_epoch <= now) blockers.push('STORAGE_SHARED_CANARY_PLATFORM_ADMIN_APPROVAL_REQUIRED');
  if (releaseApproval.status !== 'approved' || releaseApproval.role !== 'release_authority' || releaseApproval.slot !== 'release_authority'
    || commonApprovalMismatch(releaseApproval) || releaseApproval.active_production_sha !== layout.active_production_sha
    || releaseApproval.decided_at_epoch > now || releaseApproval.expires_at_epoch <= now) blockers.push('STORAGE_SHARED_CANARY_RELEASE_AUTHORITY_REQUIRED');

  const approvedWorkspaceIds = unique(workspaceApprovals.filter((approval) => approval.status === 'approved' && approval.role === 'workspace_owner'
    && !commonApprovalMismatch(approval) && approval.workspace_id && approval.decided_at_epoch <= now && approval.expires_at_epoch > now)
    .map((approval) => approval.workspace_id));
  if (quorum.mode === 'all_required') {
    if (approvedWorkspaceIds.length !== impact.workspace_ids.length || !impact.workspace_ids.every((id) => approvedWorkspaceIds.includes(id))) blockers.push('STORAGE_SHARED_CANARY_IMPACT_APPROVALS_MISSING');
  } else if (quorum.mode === 'approved_quorum') {
    if (quorum.status !== 'approved' || !quorum.policy_id || !quorum.policy_revision || !quorum.evidence_digest
      || !quorum.release_authority_approved || quorum.minimum_approvals < 1 || quorum.minimum_approvals > impact.workspace_ids.length
      || approvedWorkspaceIds.filter((id) => impact.workspace_ids.includes(id)).length < quorum.minimum_approvals) blockers.push('STORAGE_SHARED_CANARY_QUORUM_POLICY_INVALID');
  } else {
    blockers.push('STORAGE_SHARED_CANARY_APPROVAL_MODE_INVALID');
  }
  if (!approvedWorkspaceIds.every((id) => impact.workspace_ids.includes(id))) blockers.push('STORAGE_SHARED_CANARY_APPROVAL_OUTSIDE_IMPACT_SET');

  if (layout.status !== 'verified' || layout.target_id !== op.target_id || !layout.active_root_excluded
    || !layout.rollback_set_retained || layout.rollback_set_count < 1 || !layout.candidate_roots_certified) blockers.push('STORAGE_SHARED_CANARY_DEPLOYMENT_LAYOUT_PROOF_REQUIRED');
  if (reserve.status !== 'certified' || reserve.target_id !== op.target_id || reserve.reserve_file_type !== 'regular'
    || !reserve.release_separate_authorization_required) blockers.push('STORAGE_SHARED_CANARY_RESERVE_CERTIFICATION_REQUIRED');

  if (enablement.mode !== 'manual_one_shot' || enablement.status !== 'enabled' || enablement.approved_by_role !== 'platform_admin'
    || enablement.consumed || enablement.operation_id !== op.operation_id || enablement.target_id !== op.target_id
    || enablement.plan_hash !== plan.plan_hash || enablement.impact_set_hash !== impact.impact_set_hash
    || enablement.enabled_at_epoch > now || enablement.expires_at_epoch <= now) blockers.push('STORAGE_SHARED_CANARY_MANUAL_ENABLEMENT_REQUIRED');

  const core = {
    schema_version: 1,
    authorization_key: 'hostinger_storage_shared_canary_authorization_v1',
    canary_version: HOSTINGER_STORAGE_SHARED_CANARY_VERSION,
    operation: op,
    protocol: {
      protocol_version: protocolValue.protocol_version,
      run_id: protocolValue.run_id,
      operation_id: protocolValue.operation_id,
      plan_id: protocolValue.plan_id,
      target_id: protocolValue.target_id,
      plan_hash: protocolValue.plan_hash,
      candidate_set_hash: protocolValue.candidate_set_hash,
      item_set_digest: protocolValue.item_set_digest,
      authorization_bundle_hash: protocolValue.authorization_bundle_hash,
      protocol_digest: hash(protocol_digest, 'protocol_digest'),
      item_count: protocolValue.item_count,
    },
    immutable_plan: plan,
    impact_set: impact,
    platform_admin_approval: platformApproval,
    release_authority_approval: releaseApproval,
    workspace_approvals: workspaceApprovals.sort((left, right) => left.approval_id.localeCompare(right.approval_id)),
    quorum_policy: quorum,
    deployment_layout_proof: layout,
    reserve_certification: reserve,
    manual_enablement: enablement,
    evaluated_at_epoch: now,
    blockers: unique(blockers),
    synthetic_only: true,
    shared_or_platform_only: true,
    reserve_release_allowed: false,
    live_provider_allowed: false,
    dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
  return deepFreeze({
    ok: true,
    canary_ready: core.blockers.length === 0,
    authorization: core,
    authorization_digest: digest(core),
    blockers: core.blockers,
    dispatch_allowed: false,
    live_provider_allowed: false,
    production_ready: false,
    secrets_included: false,
  });
}

export function verifyHostingerStorageSharedCanaryAuthorization({ authorization, expected_digest, now_epoch = Math.floor(Date.now() / 1000) } = {}) {
  assertSecretFree(authorization, 'shared_canary_authorization');
  const now = epoch(now_epoch, 'now_epoch');
  if (authorization?.authorization_key !== 'hostinger_storage_shared_canary_authorization_v1'
    || authorization?.canary_version !== HOSTINGER_STORAGE_SHARED_CANARY_VERSION
    || authorization?.protocol?.protocol_version !== EXPECTED_PROTOCOL_VERSION
    || authorization?.protocol?.item_set_digest !== authorization?.immutable_plan?.item_set_digest
    || authorization?.impact_set?.impact_set_hash !== authorization?.immutable_plan?.impact_set_hash
    || authorization?.synthetic_only !== true || authorization?.shared_or_platform_only !== true
    || authorization?.reserve_release_allowed !== false || authorization?.live_provider_allowed !== false
    || authorization?.dispatch_allowed !== false || authorization?.production_ready !== false) {
    throw fail(409, 'STORAGE_SHARED_CANARY_AUTHORIZATION_IDENTITY_INVALID', 'Unexpected or unsafe Shared canary authorization identity.');
  }
  const observed = digest(authorization);
  if (observed !== hash(expected_digest, 'expected_digest')) throw fail(409, 'STORAGE_SHARED_CANARY_AUTHORIZATION_TAMPERED', 'Shared canary authorization digest mismatch.');
  const blockers = [...(authorization.blockers || [])];
  for (const approval of [authorization.platform_admin_approval, authorization.release_authority_approval, ...(authorization.workspace_approvals || [])]) {
    if (approval?.expires_at_epoch <= now) blockers.push('STORAGE_SHARED_CANARY_APPROVAL_EXPIRED');
  }
  if (authorization.manual_enablement?.expires_at_epoch <= now) blockers.push('STORAGE_SHARED_CANARY_ENABLEMENT_EXPIRED');
  return deepFreeze({ ok: true, valid: unique(blockers).length === 0, observed_digest: observed, blockers: unique(blockers), dispatch_allowed: false, secrets_included: false });
}

export function createMemoryHostingerStorageSharedCanaryAuthorityStore() {
  const records = new Map();
  const key = (kind, id) => `${kind}:${id}`;
  function register(kind, id, record) {
    const storeKey = key(kind, safeId(id, `${kind}.id`));
    const normalized = deepFreeze(clone(record));
    const existing = records.get(storeKey);
    if (existing && digest(existing) !== digest(normalized)) throw fail(409, 'STORAGE_SHARED_CANARY_AUTHORITY_ID_CONFLICT', 'Authority ID is already bound to different evidence.', { kind, id });
    if (!existing) records.set(storeKey, normalized);
    return clone(records.get(storeKey));
  }
  function read(kind, id) {
    return clone(records.get(key(kind, safeId(id, `${kind}.id`))) || null);
  }
  function update(kind, id, expectedEvidenceDigest, record) {
    const storeKey = key(kind, safeId(id, `${kind}.id`));
    const current = records.get(storeKey);
    if (!current) throw fail(404, 'STORAGE_SHARED_CANARY_AUTHORITY_NOT_FOUND', 'Authority evidence was not found.', { kind, id });
    const expected = hash(expectedEvidenceDigest, `${kind}.expected_evidence_digest`);
    if (current.evidence_digest !== expected) throw fail(409, 'STORAGE_SHARED_CANARY_AUTHORITY_EVIDENCE_CONFLICT', 'Authority evidence changed before update.', { kind, current_evidence_digest: current.evidence_digest });
    const normalized = deepFreeze(clone(record));
    if (normalized.evidence_digest === current.evidence_digest) throw fail(409, 'STORAGE_SHARED_CANARY_AUTHORITY_EVIDENCE_NOT_ADVANCED', 'Authority updates must advance the evidence token.', { kind, current_evidence_digest: current.evidence_digest });
    records.set(storeKey, normalized);
    return clone(normalized);
  }
  return Object.freeze({
    synthetic_only: true,
    production_ready: false,
    registerImpact: (record) => register('impact', record.impact_set_id, record),
    readImpact: (id) => read('impact', id),
    updateImpact: ({ impact_set_id, expected_evidence_digest, record }) => update('impact', impact_set_id, expected_evidence_digest, record),
    registerApproval: (record) => register('approval', record.approval_id, record),
    readApproval: (id) => read('approval', id),
    updateApproval: ({ approval_id, expected_evidence_digest, record }) => update('approval', approval_id, expected_evidence_digest, record),
    registerLayout: (record) => register('layout', record.layout_proof_id, record),
    readLayout: (id) => read('layout', id),
    updateLayout: ({ layout_proof_id, expected_evidence_digest, record }) => update('layout', layout_proof_id, expected_evidence_digest, record),
    registerReserve: (record) => register('reserve', record.certification_id, record),
    readReserve: (id) => read('reserve', id),
    updateReserve: ({ certification_id, expected_evidence_digest, record }) => update('reserve', certification_id, expected_evidence_digest, record),
  });
}

export function createMemoryHostingerStorageSharedCanaryEnablementRegistry() {
  const records = new Map();
  return Object.freeze({
    synthetic_only: true,
    production_ready: false,
    register(record) {
      const normalized = deepFreeze({
        enablement_id: safeId(record.enablement_id, 'enablement.enablement_id'),
        authorization_digest: hash(record.authorization_digest, 'enablement.authorization_digest'),
        operation_id: safeId(record.operation_id, 'enablement.operation_id'),
        run_id: safeId(record.run_id, 'enablement.run_id'),
        generation: integer(record.generation, 'enablement.generation', 1),
        expires_at_epoch: epoch(record.expires_at_epoch, 'enablement.expires_at_epoch'),
        consumed: false,
        consumed_at_epoch: null,
        secrets_included: false,
      });
      const existing = records.get(normalized.enablement_id);
      if (existing && digest(existing) !== digest(normalized)) throw fail(409, 'STORAGE_SHARED_CANARY_ENABLEMENT_ID_CONFLICT', 'Enablement ID is bound to different evidence.');
      if (!existing) records.set(normalized.enablement_id, normalized);
      return clone(records.get(normalized.enablement_id));
    },
    read(id) {
      return clone(records.get(safeId(id, 'enablement_id')) || null);
    },
    consume({ enablement_id, authorization_digest, operation_id, run_id, expected_generation, now_epoch }) {
      const id = safeId(enablement_id, 'enablement_id');
      const current = records.get(id);
      if (!current) throw fail(404, 'STORAGE_SHARED_CANARY_ENABLEMENT_NOT_FOUND', 'Manual shared canary enablement was not registered.');
      const now = epoch(now_epoch, 'now_epoch');
      if (current.authorization_digest !== hash(authorization_digest, 'authorization_digest')
        || current.operation_id !== safeId(operation_id, 'operation_id') || current.run_id !== safeId(run_id, 'run_id')) throw fail(409, 'STORAGE_SHARED_CANARY_ENABLEMENT_BINDING_MISMATCH', 'Enablement is not bound to this authorization and run.');
      if (current.generation !== Number(expected_generation)) throw fail(409, 'STORAGE_SHARED_CANARY_ENABLEMENT_GENERATION_MISMATCH', 'Enablement generation changed.', { current_generation: current.generation });
      if (current.consumed) throw fail(409, 'STORAGE_SHARED_CANARY_ENABLEMENT_ALREADY_CONSUMED', 'Shared canary enablement is one-shot.');
      if (current.expires_at_epoch <= now) throw fail(409, 'STORAGE_SHARED_CANARY_ENABLEMENT_EXPIRED', 'Shared canary enablement expired.');
      const next = deepFreeze({ ...current, generation: current.generation + 1, consumed: true, consumed_at_epoch: now });
      records.set(id, next);
      return clone(next);
    },
    exportState() {
      return clone([...records.values()].sort((left, right) => left.enablement_id.localeCompare(right.enablement_id)));
    },
  });
}

function requireStore(store) {
  if (!store || store.synthetic_only !== true || store.production_ready !== false
    || typeof store.readImpact !== 'function' || typeof store.readApproval !== 'function'
    || typeof store.readLayout !== 'function' || typeof store.readReserve !== 'function') throw fail(409, 'STORAGE_SHARED_CANARY_AUTHORITY_STORE_INVALID', 'A synthetic shared-canary authority store is required.');
}

function requireRegistry(registry) {
  if (!registry || registry.synthetic_only !== true || registry.production_ready !== false
    || typeof registry.read !== 'function' || typeof registry.consume !== 'function') throw fail(409, 'STORAGE_SHARED_CANARY_ENABLEMENT_REGISTRY_INVALID', 'A synthetic one-shot enablement registry is required.');
}

function requireRepository(repository) {
  if (!repository || repository.production_ready === true || typeof repository.readAggregate !== 'function') throw fail(409, 'STORAGE_SHARED_CANARY_CONTROL_PLANE_INVALID', 'The non-production governed repository is required.');
}

function assertCurrentRecord(current, signed, code, label) {
  if (!current || digest(current) !== digest(signed)) throw fail(409, code, `Current ${label} evidence no longer matches the signed authorization.`);
}

function preflight({ protocol, protocolDigest, repository, adapter, now }) {
  verifyHostingerStorageSyntheticExecutionProtocol({ protocol, expected_digest: protocolDigest });
  if (!adapter || adapter.synthetic_only !== true || adapter.production_ready !== false || adapter.live_provider !== false
    || adapter.filesystem_access !== false || adapter.shell_access !== false
    || typeof adapter.mutateExact !== 'function' || typeof adapter.readbackItem !== 'function' || typeof adapter.readMutationReceipt !== 'function') throw fail(409, 'STORAGE_SHARED_CANARY_EXECUTOR_ADAPTER_INVALID', 'The canonical in-memory synthetic adapter is required.');
  const aggregate = repository.readAggregate(protocol.operation_id);
  if (!aggregate?.operation) throw fail(404, 'STORAGE_SHARED_CANARY_OPERATION_NOT_FOUND', 'Shared canary operation was not found.');
  if (!['lease_acquired', 'executing'].includes(aggregate.operation.state)) throw fail(409, 'STORAGE_SHARED_CANARY_OPERATION_STATE_INVALID', 'Operation state is not eligible for a shared canary attempt.', { state: aggregate.operation.state });
  const plan = aggregate.plans.find((row) => row.plan_id === protocol.plan_id);
  if (!plan || plan.operation_id !== protocol.operation_id || plan.target_id !== protocol.target_id || plan.plan_hash !== protocol.plan_hash
    || plan.candidate_set_hash !== protocol.candidate_set_hash || Number(plan.expires_at_epoch) !== Number(protocol.plan_expires_at_epoch)
    || Number(plan.expires_at_epoch) <= now || (plan.consumed && plan.consumed_run_id !== protocol.run_id)) throw fail(409, 'STORAGE_SHARED_CANARY_EXECUTOR_PLAN_INVALID', 'Current immutable plan failed shared-canary preflight.');
  const lease = aggregate.leases.find((row) => row.target_id === protocol.target_id);
  if (!lease || lease.lease_id !== protocol.lease_id || lease.operation_id !== protocol.operation_id || lease.status !== 'active'
    || Number(lease.generation) !== Number(protocol.lease_generation) || Number(lease.expires_at_epoch) !== Number(protocol.lease_expires_at_epoch)
    || Number(lease.expires_at_epoch) <= now) throw fail(409, 'STORAGE_SHARED_CANARY_EXECUTOR_LEASE_INVALID', 'Current execution lease failed shared-canary preflight.');
}

export function executeHostingerStorageSharedCanary({
  canary_authorization,
  protocol,
  protocol_digest,
  repository,
  adapter,
  authority_store,
  enablement_registry,
  fault = null,
  now_epoch = Math.floor(Date.now() / 1000),
} = {}) {
  const now = epoch(now_epoch, 'now_epoch');
  if (canary_authorization?.canary_ready !== true || !canary_authorization.authorization) throw fail(409, 'STORAGE_SHARED_CANARY_AUTHORIZATION_REQUIRED', 'A ready Shared canary authorization is required.', { blockers: canary_authorization?.blockers || [] });
  const verification = verifyHostingerStorageSharedCanaryAuthorization({ authorization: canary_authorization.authorization, expected_digest: canary_authorization.authorization_digest, now_epoch: now });
  if (!verification.valid) throw fail(409, 'STORAGE_SHARED_CANARY_AUTHORIZATION_INVALID', 'Shared canary authorization is stale or blocked.', { blockers: verification.blockers });
  requireStore(authority_store);
  requireRegistry(enablement_registry);
  requireRepository(repository);
  const authorization = canary_authorization.authorization;
  const aggregate = repository.readAggregate(authorization.operation.operation_id);
  if (!aggregate?.operation || aggregate.operation.context_mode !== 'admin' || aggregate.operation.target_id !== authorization.operation.target_id
    || aggregate.operation.authority_context_hash !== authorization.operation.authority_context_hash
    || aggregate.operation.ownership_revision !== authorization.operation.ownership_revision
    || aggregate.operation.policy_revision !== authorization.operation.policy_revision) throw fail(409, 'STORAGE_SHARED_CANARY_CURRENT_BINDING_MISMATCH', 'Current Admin operation context differs from the signed authorization.');
  if (protocol?.protocol_version !== authorization.protocol.protocol_version || protocol?.operation_id !== authorization.operation.operation_id
    || protocol?.target_id !== authorization.operation.target_id || protocol?.plan_hash !== authorization.protocol.plan_hash
    || protocol?.run_id !== authorization.protocol.run_id || hash(protocol_digest, 'protocol_digest') !== authorization.protocol.protocol_digest) throw fail(409, 'STORAGE_SHARED_CANARY_PROTOCOL_BINDING_MISMATCH', 'Current protocol differs from the signed Shared canary authorization.');

  assertCurrentRecord(authority_store.readImpact(authorization.impact_set.impact_set_id), authorization.impact_set, 'STORAGE_SHARED_CANARY_IMPACT_SET_CURRENT_STATE_INVALID', 'impact set');
  for (const approval of [authorization.platform_admin_approval, authorization.release_authority_approval, ...authorization.workspace_approvals]) {
    assertCurrentRecord(authority_store.readApproval(approval.approval_id), approval, 'STORAGE_SHARED_CANARY_APPROVAL_CURRENT_STATE_INVALID', 'approval');
  }
  assertCurrentRecord(authority_store.readLayout(authorization.deployment_layout_proof.layout_proof_id), authorization.deployment_layout_proof, 'STORAGE_SHARED_CANARY_LAYOUT_CURRENT_STATE_INVALID', 'deployment layout');
  assertCurrentRecord(authority_store.readReserve(authorization.reserve_certification.certification_id), authorization.reserve_certification, 'STORAGE_SHARED_CANARY_RESERVE_CURRENT_STATE_INVALID', 'reserve certification');
  preflight({ protocol, protocolDigest: protocol_digest, repository, adapter, now });

  const enablement = authorization.manual_enablement;
  if (!enablement_registry.read(enablement.enablement_id)) throw fail(404, 'STORAGE_SHARED_CANARY_ENABLEMENT_NOT_FOUND', 'Shared canary enablement was not registered.');
  enablement_registry.consume({ enablement_id: enablement.enablement_id, authorization_digest: canary_authorization.authorization_digest,
    operation_id: authorization.operation.operation_id, run_id: authorization.protocol.run_id, expected_generation: enablement.generation, now_epoch: now });

  const execution = executeHostingerStorageSyntheticPlan({ protocol, protocol_digest, repository, adapter, fault, now_epoch: now });
  const projection = {
    schema_version: 1,
    projection_key: 'hostinger_storage_shared_canary_result_v1',
    canary_version: HOSTINGER_STORAGE_SHARED_CANARY_VERSION,
    operation_id: authorization.operation.operation_id,
    run_id: authorization.protocol.run_id,
    plan_id: authorization.protocol.plan_id,
    target_id: authorization.operation.target_id,
    target_scope: authorization.operation.target_scope,
    impact_set_hash: authorization.impact_set.impact_set_hash,
    impacted_workspace_count: authorization.impact_set.workspace_ids.length,
    deployment_layout_revision: authorization.deployment_layout_proof.layout_revision,
    active_production_sha: authorization.deployment_layout_proof.active_production_sha,
    reserve_certification_id: authorization.reserve_certification.certification_id,
    reserve_released: false,
    outcome: execution.outcome || execution.state || 'unknown_outcome',
    retry_allowed: execution.retry_allowed === true,
    read_before_retry_required: execution.read_before_retry_required === true,
    counts: execution.counts || null,
    manual_enablement_consumed: true,
    synthetic_only: true,
    shared_or_platform_only: true,
    live_provider_mutated: false,
    dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
  return deepFreeze({ ok: true, outcome: projection.outcome, projection, projection_digest: digest(projection), dispatch_allowed: false, live_provider_mutated: false, production_ready: false, secrets_included: false });
}
