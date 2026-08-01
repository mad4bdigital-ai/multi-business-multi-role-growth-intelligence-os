import { createHash } from 'node:crypto';

export const HOSTINGER_STORAGE_EXECUTION_AUTHORIZATION_VERSION = 'spec014-storage-execution-authorization-v1';

const SHA256_RE = /^[0-9a-f]{64}$/i;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const TERMINAL_APPROVAL_STATUSES = new Set(['approved', 'denied']);
const RISK_REQUIREMENTS = Object.freeze({
  tenant_low: Object.freeze({ recovery_required: false, attestation_required: true, impact_set_required: false }),
  tenant_high: Object.freeze({ recovery_required: true, attestation_required: true, impact_set_required: false }),
  platform_or_shared: Object.freeze({ recovery_required: true, attestation_required: true, impact_set_required: true }),
});

function failure(status, code, message, details = {}) {
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
  if (!SAFE_ID_RE.test(result)) {
    throw failure(400, 'STORAGE_EXECUTION_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return result;
}

function hash(value, field, { nullable = false } = {}) {
  const result = text(value, 64).toLowerCase();
  if (!result && nullable) return null;
  if (!SHA256_RE.test(result)) {
    throw failure(400, 'STORAGE_EXECUTION_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return result;
}

function epoch(value, field) {
  if (Number.isFinite(Number(value))) return Math.floor(Number(value));
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) {
    throw failure(400, 'STORAGE_EXECUTION_TIME_INVALID', 'A valid timestamp is required.', { field });
  }
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

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value, 256)).filter(Boolean))].sort();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

function assertSecretFree(value, path = 'value', depth = 0) {
  if (depth > 14 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key !== 'secrets_included' && /(secret|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session|raw_provider|raw_environment|file_content)/i.test(key)) {
      throw failure(400, 'STORAGE_EXECUTION_SECRET_FIELD_REJECTED', 'Execution authorization inputs must not contain secret-like fields.', { path: `${path}.${key}` });
    }
    assertSecretFree(item, `${path}.${key}`, depth + 1);
  }
}

function normalizePlanItem(item, index) {
  const ordinal = Number(item?.ordinal ?? index);
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw failure(400, 'STORAGE_PLAN_ITEM_ORDINAL_INVALID', 'Plan item ordinal must be a non-negative integer.', { index });
  }
  const sizeBytes = Number(item?.size_bytes ?? item?.sizeBytes);
  const inode = Number(item?.inode);
  const device = Number(item?.device ?? item?.device_id);
  const mtime = Number(item?.mtime_epoch ?? item?.mtime);
  const ctime = Number(item?.ctime_epoch ?? item?.ctime);
  for (const [field, value] of Object.entries({ size_bytes: sizeBytes, inode, device, mtime_epoch: mtime, ctime_epoch: ctime })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw failure(400, 'STORAGE_PLAN_ITEM_METADATA_INVALID', 'Plan item metadata must be a non-negative safe integer.', { index, field });
    }
  }
  const normalized = {
    item_id: safeId(item?.item_id ?? item?.itemId, `items[${index}].item_id`),
    ordinal,
    category: safeId(item?.category, `items[${index}].category`),
    path_ref: safeId(item?.path_ref ?? item?.pathRef, `items[${index}].path_ref`),
    relative_path_digest: hash(item?.relative_path_digest ?? item?.relativePathDigest, `items[${index}].relative_path_digest`),
    size_bytes: sizeBytes,
    device,
    inode,
    ctime_epoch: ctime,
    mtime_epoch: mtime,
    file_type: text(item?.file_type ?? item?.fileType, 32) || 'regular',
    eligibility_rule: safeId(item?.eligibility_rule ?? item?.eligibilityRule, `items[${index}].eligibility_rule`),
    protected: item?.protected === true,
    secrets_included: false,
  };
  if (normalized.protected) {
    throw failure(409, 'STORAGE_PLAN_PROTECTED_ITEM_FORBIDDEN', 'Protected items cannot enter the executable plan.', { item_id: normalized.item_id });
  }
  normalized.item_hash = digest(normalized);
  return deepFreeze(normalized);
}

export function buildCanonicalHostingerStoragePlanEnvelope(plan = {}) {
  assertSecretFree(plan, 'plan');
  const items = (Array.isArray(plan.items) ? plan.items : []).map(normalizePlanItem)
    .sort((left, right) => left.ordinal - right.ordinal || left.item_id.localeCompare(right.item_id));
  if (items.length === 0) {
    throw failure(400, 'STORAGE_PLAN_ITEMS_REQUIRED', 'An executable plan requires at least one immutable item.');
  }
  const ordinals = new Set(items.map((item) => item.ordinal));
  const itemIds = new Set(items.map((item) => item.item_id));
  if (ordinals.size !== items.length || itemIds.size !== items.length) {
    throw failure(409, 'STORAGE_PLAN_ITEM_IDENTITY_CONFLICT', 'Plan item IDs and ordinals must be unique.');
  }
  const candidateSet = items.map(({ item_hash, ordinal, item_id }) => ({ item_hash, ordinal, item_id }));
  const candidateSetHash = digest(candidateSet);
  const suppliedCandidateHash = hash(plan.candidate_set_hash ?? plan.candidateSetHash, 'candidate_set_hash');
  if (suppliedCandidateHash !== candidateSetHash) {
    throw failure(409, 'STORAGE_PLAN_CANDIDATE_SET_HASH_MISMATCH', 'Candidate-set hash does not match the canonical item set.', {
      expected_candidate_set_hash: candidateSetHash,
    });
  }
  const totalBytes = items.reduce((sum, item) => sum + item.size_bytes, 0);
  const categoryTotals = Object.entries(items.reduce((accumulator, item) => {
    const current = accumulator[item.category] || { count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += item.size_bytes;
    accumulator[item.category] = current;
    return accumulator;
  }, {})).sort(([left], [right]) => left.localeCompare(right)).map(([category, totals]) => ({ category, ...totals }));
  const core = {
    schema_version: 1,
    envelope_key: 'hostinger_storage_plan_envelope_v1',
    plan_id: safeId(plan.plan_id ?? plan.planId, 'plan_id'),
    operation_id: safeId(plan.operation_id ?? plan.operationId, 'operation_id'),
    target_id: safeId(plan.target_id ?? plan.targetId, 'target_id'),
    source_snapshot_id: safeId(plan.source_snapshot_id ?? plan.sourceSnapshotId, 'source_snapshot_id'),
    authority_context_hash: hash(plan.authority_context_hash ?? plan.authorityContextHash, 'authority_context_hash'),
    ownership_revision: safeId(plan.ownership_revision ?? plan.ownershipRevision, 'ownership_revision'),
    policy_revision: safeId(plan.policy_revision ?? plan.policyRevision, 'policy_revision'),
    impact_set_hash: hash(plan.impact_set_hash ?? plan.impactSetHash, 'impact_set_hash'),
    candidate_set_hash: candidateSetHash,
    item_count: items.length,
    total_bytes: totalBytes,
    category_totals: categoryTotals,
    created_at_epoch: epoch(plan.created_at_epoch ?? plan.created_at, 'created_at'),
    expires_at_epoch: epoch(plan.expires_at_epoch ?? plan.expires_at, 'expires_at'),
    items,
    secrets_included: false,
  };
  if (core.expires_at_epoch <= core.created_at_epoch) {
    throw failure(400, 'STORAGE_PLAN_EXPIRY_INVALID', 'Plan expiry must be later than creation time.');
  }
  const planHash = digest(core);
  const suppliedPlanHash = hash(plan.plan_hash ?? plan.planHash, 'plan_hash');
  if (suppliedPlanHash !== planHash) {
    throw failure(409, 'STORAGE_PLAN_HASH_MISMATCH', 'Plan hash does not match the canonical full plan envelope.', {
      expected_plan_hash: planHash,
    });
  }
  return deepFreeze({
    ok: true,
    envelope: core,
    plan_hash: planHash,
    candidate_set_hash: candidateSetHash,
    secrets_included: false,
  });
}

function approvalBinding(record, index) {
  assertSecretFree(record, `approvals[${index}]`);
  return deepFreeze({
    approval_id: safeId(record?.approval_id ?? record?.approvalId, `approvals[${index}].approval_id`),
    slot: safeId(record?.slot, `approvals[${index}].slot`),
    workspace_id: safeId(record?.workspace_id ?? record?.workspaceId, `approvals[${index}].workspace_id`, { nullable: true }),
    status: text(record?.status, 32).toLowerCase(),
    invalidated: record?.invalidated === true,
    decided_at_epoch: epoch(record?.decided_at_epoch ?? record?.decided_at, `approvals[${index}].decided_at`),
    expires_at_epoch: epoch(record?.expires_at_epoch ?? record?.expires_at, `approvals[${index}].expires_at`),
    plan_hash: hash(record?.plan_hash ?? record?.planHash, `approvals[${index}].plan_hash`),
    candidate_set_hash: hash(record?.candidate_set_hash ?? record?.candidateSetHash, `approvals[${index}].candidate_set_hash`),
    authority_context_hash: hash(record?.authority_context_hash ?? record?.authorityContextHash, `approvals[${index}].authority_context_hash`),
    ownership_revision: safeId(record?.ownership_revision ?? record?.ownershipRevision, `approvals[${index}].ownership_revision`),
    policy_revision: safeId(record?.policy_revision ?? record?.policyRevision, `approvals[${index}].policy_revision`),
    impact_set_hash: hash(record?.impact_set_hash ?? record?.impactSetHash, `approvals[${index}].impact_set_hash`),
    approver_principal_id: safeId(record?.approver_principal_id ?? record?.approverPrincipalId, `approvals[${index}].approver_principal_id`),
    approver_authority_ref: safeId(record?.approver_authority_ref ?? record?.approverAuthorityRef, `approvals[${index}].approver_authority_ref`),
    evidence_digest: hash(record?.evidence_digest ?? record?.evidenceDigest, `approvals[${index}].evidence_digest`),
    secrets_included: false,
  });
}

export function resolveHostingerStorageApprovalSet({ plan_envelope, required_slots = [], approval_records = [], now_epoch } = {}) {
  const plan = plan_envelope?.envelope || plan_envelope;
  const now = epoch(now_epoch, 'now_epoch');
  const required = unique(required_slots);
  const records = (Array.isArray(approval_records) ? approval_records : []).map(approvalBinding);
  const blockers = [];
  const accepted = [];
  for (const slot of required) {
    const candidates = records.filter((record) => record.slot === slot && record.status === 'approved' && !record.invalidated)
      .sort((left, right) => right.decided_at_epoch - left.decided_at_epoch);
    if (candidates.length === 0) {
      blockers.push(`STORAGE_APPROVAL_SLOT_MISSING:${slot}`);
      continue;
    }
    if (candidates.length !== 1) {
      blockers.push(`STORAGE_APPROVAL_SLOT_AMBIGUOUS:${slot}`);
      continue;
    }
    const [record] = candidates;
    if (!TERMINAL_APPROVAL_STATUSES.has(record.status)) blockers.push(`STORAGE_APPROVAL_STATUS_INVALID:${slot}`);
    if (record.expires_at_epoch <= now) blockers.push(`STORAGE_APPROVAL_EXPIRED:${slot}`);
    if (record.plan_hash !== plan.plan_hash) blockers.push(`STORAGE_APPROVAL_PLAN_HASH_MISMATCH:${slot}`);
    if (record.candidate_set_hash !== plan.candidate_set_hash) blockers.push(`STORAGE_APPROVAL_CANDIDATE_SET_MISMATCH:${slot}`);
    if (record.authority_context_hash !== plan.authority_context_hash) blockers.push(`STORAGE_APPROVAL_CONTEXT_MISMATCH:${slot}`);
    if (record.ownership_revision !== plan.ownership_revision) blockers.push(`STORAGE_APPROVAL_OWNERSHIP_REVISION_MISMATCH:${slot}`);
    if (record.policy_revision !== plan.policy_revision) blockers.push(`STORAGE_APPROVAL_POLICY_REVISION_MISMATCH:${slot}`);
    if (record.impact_set_hash !== plan.impact_set_hash) blockers.push(`STORAGE_APPROVAL_IMPACT_SET_MISMATCH:${slot}`);
    accepted.push(record);
  }
  const acceptedIds = new Set(accepted.map((record) => record.approval_id));
  const duplicateSlots = accepted.filter((record, index) => accepted.findIndex((other) => other.slot === record.slot) !== index);
  if (duplicateSlots.length) blockers.push('STORAGE_APPROVAL_SLOT_AMBIGUOUS');
  const approvalSetCore = {
    required_slots: required,
    approvals: accepted.filter((record) => acceptedIds.has(record.approval_id)).sort((left, right) => left.slot.localeCompare(right.slot)),
    plan_hash: plan.plan_hash,
    candidate_set_hash: plan.candidate_set_hash,
    authority_context_hash: plan.authority_context_hash,
    impact_set_hash: plan.impact_set_hash,
    secrets_included: false,
  };
  return deepFreeze({
    ok: true,
    ready: blockers.length === 0 && accepted.length === required.length,
    approval_set: approvalSetCore,
    approval_set_hash: digest(approvalSetCore),
    blockers: unique(blockers),
    secrets_included: false,
  });
}

function validateLease({ lease, operationId, targetId, now }) {
  const blockers = [];
  if (!lease || typeof lease !== 'object') return { blockers: ['STORAGE_EXECUTION_LEASE_REQUIRED'], lease: null };
  const normalized = {
    lease_id: safeId(lease.lease_id ?? lease.leaseId, 'lease_id'),
    operation_id: safeId(lease.operation_id ?? lease.operationId, 'lease.operation_id'),
    target_id: safeId(lease.target_id ?? lease.targetId, 'lease.target_id'),
    generation: Number(lease.generation),
    status: text(lease.status, 32).toLowerCase(),
    expires_at_epoch: epoch(lease.expires_at_epoch ?? lease.expires_at, 'lease.expires_at'),
    holder_ref: safeId(lease.holder_ref ?? lease.holderRef, 'lease.holder_ref'),
    evidence_digest: hash(lease.evidence_digest ?? lease.evidenceDigest, 'lease.evidence_digest'),
    secrets_included: false,
  };
  if (!Number.isSafeInteger(normalized.generation) || normalized.generation < 1) blockers.push('STORAGE_EXECUTION_LEASE_GENERATION_INVALID');
  if (normalized.status !== 'active') blockers.push('STORAGE_EXECUTION_LEASE_NOT_ACTIVE');
  if (normalized.operation_id !== operationId) blockers.push('STORAGE_EXECUTION_LEASE_OPERATION_MISMATCH');
  if (normalized.target_id !== targetId) blockers.push('STORAGE_EXECUTION_LEASE_TARGET_MISMATCH');
  if (normalized.expires_at_epoch <= now) blockers.push('STORAGE_EXECUTION_LEASE_EXPIRED');
  return { blockers, lease: deepFreeze(normalized) };
}

function validateToolchainProvenance(resolution, approvedTools = []) {
  const blockers = [];
  if (!resolution?.toolchain_ready || !SHA256_RE.test(text(resolution?.resolution_fingerprint, 64))) {
    blockers.push('STORAGE_TOOLCHAIN_RESOLUTION_NOT_READY');
  }
  const catalog = new Map((Array.isArray(approvedTools) ? approvedTools : []).map((record, index) => {
    assertSecretFree(record, `approved_tools[${index}]`);
    const key = `${safeId(record.tool_id ?? record.toolId, `approved_tools[${index}].tool_id`)}:${text(record.version, 64)}:${hash(record.binary_sha256 ?? record.binarySha256, `approved_tools[${index}].binary_sha256`)}`;
    return [key, record];
  }));
  const selected = [];
  for (const row of resolution?.selections || []) {
    if (!row?.selected_tool_id) continue;
    const toolId = safeId(row.selected_tool_id, `toolchain.${row.capability}.tool_id`);
    const version = text(row.selected?.observed_version, 64);
    const binarySha = hash(row.selected?.binary_sha256, `toolchain.${row.capability}.binary_sha256`);
    const key = `${toolId}:${version}:${binarySha}`;
    const approved = catalog.get(key);
    if (!approved || approved.status !== 'approved') blockers.push(`STORAGE_TOOL_BINARY_NOT_APPROVED:${toolId}`);
    if (!approved?.release_provenance_digest || !SHA256_RE.test(text(approved.release_provenance_digest, 64))) blockers.push(`STORAGE_TOOL_RELEASE_PROVENANCE_REQUIRED:${toolId}`);
    selected.push({
      capability: safeId(row.capability, `toolchain.${toolId}.capability`),
      tool_id: toolId,
      version,
      binary_sha256: binarySha,
      release_provenance_digest: approved?.release_provenance_digest ? hash(approved.release_provenance_digest, `approved_tools.${toolId}.release_provenance_digest`) : null,
    });
  }
  const core = {
    resolution_fingerprint: hash(resolution?.resolution_fingerprint, 'toolchain.resolution_fingerprint'),
    policy_fingerprint: hash(resolution?.policy_fingerprint, 'toolchain.policy_fingerprint'),
    selected_tools: selected.sort((left, right) => left.capability.localeCompare(right.capability)),
    secrets_included: false,
  };
  return { blockers, provenance: deepFreeze(core), provenance_digest: digest(core) };
}

function validateDispatchCertification(certification, envelope, now) {
  const blockers = [];
  if (!certification || typeof certification !== 'object') return { blockers: ['STORAGE_DISPATCH_CERTIFICATION_REQUIRED'], certification: null };
  const normalized = {
    certification_id: safeId(certification.certification_id ?? certification.certificationId, 'dispatch_certification.certification_id'),
    status: text(certification.status, 32).toLowerCase(),
    adapter_key: safeId(certification.adapter_key ?? certification.adapterKey, 'dispatch_certification.adapter_key'),
    target_id: safeId(certification.target_id ?? certification.targetId, 'dispatch_certification.target_id'),
    host_key_revision: safeId(certification.host_key_revision ?? certification.hostKeyRevision, 'dispatch_certification.host_key_revision'),
    host_key_pinned: certification.host_key_pinned === true,
    worker_image_digest: hash(certification.worker_image_digest ?? certification.workerImageDigest, 'dispatch_certification.worker_image_digest'),
    approved_program_digest: hash(certification.approved_program_digest ?? certification.approvedProgramDigest, 'dispatch_certification.approved_program_digest'),
    expires_at_epoch: epoch(certification.expires_at_epoch ?? certification.expires_at, 'dispatch_certification.expires_at'),
    evidence_digest: hash(certification.evidence_digest ?? certification.evidenceDigest, 'dispatch_certification.evidence_digest'),
    secrets_included: false,
  };
  if (normalized.status !== 'certified') blockers.push('STORAGE_DISPATCH_NOT_CERTIFIED');
  if (normalized.adapter_key !== envelope.provider_adapter?.adapter_key) blockers.push('STORAGE_DISPATCH_ADAPTER_MISMATCH');
  if (normalized.target_id !== envelope.target_binding?.target_id) blockers.push('STORAGE_DISPATCH_TARGET_MISMATCH');
  if (!normalized.host_key_pinned) blockers.push('STORAGE_SSH_HOST_KEY_NOT_PINNED');
  if (normalized.expires_at_epoch <= now) blockers.push('STORAGE_DISPATCH_CERTIFICATION_EXPIRED');
  return { blockers, certification: deepFreeze(normalized) };
}

function validateRecoveryProof(proof, plan, required) {
  const blockers = [];
  if (!required) return { blockers, proof: { required: false, ready: true, proof_digest: null, secrets_included: false } };
  if (!proof?.ready) blockers.push('STORAGE_RECOVERY_PROOF_REQUIRED');
  const normalized = {
    required: true,
    ready: proof?.ready === true,
    proof_digest: proof?.proof_digest ? hash(proof.proof_digest, 'recovery.proof_digest') : null,
    plan_id: proof?.proof?.plan_id ? safeId(proof.proof.plan_id, 'recovery.plan_id') : null,
    plan_hash: proof?.proof?.plan_hash ? hash(proof.proof.plan_hash, 'recovery.plan_hash') : null,
    candidate_set_hash: proof?.proof?.candidate_set_hash ? hash(proof.proof.candidate_set_hash, 'recovery.candidate_set_hash') : null,
    snapshot_id: proof?.proof?.snapshot_id ? safeId(proof.proof.snapshot_id, 'recovery.snapshot_id') : null,
    secrets_included: false,
  };
  if (normalized.plan_id !== plan.plan_id) blockers.push('STORAGE_RECOVERY_PLAN_ID_MISMATCH');
  if (normalized.plan_hash !== plan.plan_hash) blockers.push('STORAGE_RECOVERY_PLAN_HASH_MISMATCH');
  if (normalized.candidate_set_hash !== plan.candidate_set_hash) blockers.push('STORAGE_RECOVERY_CANDIDATE_SET_MISMATCH');
  if (!normalized.proof_digest) blockers.push('STORAGE_RECOVERY_PROOF_DIGEST_REQUIRED');
  return { blockers, proof: deepFreeze(normalized) };
}

function validateAttestation(evidence, plan, required, now) {
  const blockers = [];
  if (!required) return { blockers, attestation: { required: false, ready: true, evidence_digest: null, secrets_included: false } };
  const normalized = {
    required: true,
    ready: evidence?.ready === true,
    subject_digest: evidence?.evidence?.subject_digest ? hash(evidence.evidence.subject_digest, 'attestation.subject_digest') : null,
    evidence_digest: evidence?.evidence_digest ? hash(evidence.evidence_digest, 'attestation.evidence_digest') : null,
    plan_id: evidence?.evidence?.plan_id ? safeId(evidence.evidence.plan_id, 'attestation.plan_id') : null,
    plan_hash: evidence?.evidence?.plan_hash ? hash(evidence.evidence.plan_hash, 'attestation.plan_hash') : null,
    verified_at_epoch: evidence?.evidence?.verified_at ? epoch(evidence.evidence.verified_at, 'attestation.verified_at') : null,
    secrets_included: false,
  };
  if (!normalized.ready) blockers.push('STORAGE_ATTESTATION_VERIFICATION_REQUIRED');
  if (!normalized.subject_digest || !normalized.evidence_digest) blockers.push('STORAGE_ATTESTATION_DIGEST_REQUIRED');
  if (normalized.plan_id && normalized.plan_id !== plan.plan_id) blockers.push('STORAGE_ATTESTATION_PLAN_ID_MISMATCH');
  if (normalized.plan_hash && normalized.plan_hash !== plan.plan_hash) blockers.push('STORAGE_ATTESTATION_PLAN_HASH_MISMATCH');
  if (normalized.verified_at_epoch && normalized.verified_at_epoch > now) blockers.push('STORAGE_ATTESTATION_TIME_INVALID');
  return { blockers, attestation: deepFreeze(normalized) };
}

export function buildHostingerStorageExecutionAuthorizationBundle({
  operation_envelope,
  plan,
  required_approval_slots = [],
  approval_records = [],
  lease,
  toolchain_resolution,
  approved_tools = [],
  dispatch_certification,
  recovery_proof = null,
  attestation_verification = null,
  risk_profile,
  now_epoch = Math.floor(Date.now() / 1000),
} = {}) {
  assertSecretFree({ operation_envelope, plan, approval_records, lease, toolchain_resolution, approved_tools, dispatch_certification, recovery_proof, attestation_verification }, 'execution_bundle');
  const now = epoch(now_epoch, 'now_epoch');
  const risk = RISK_REQUIREMENTS[risk_profile];
  if (!risk) throw failure(400, 'STORAGE_EXECUTION_RISK_PROFILE_INVALID', 'A supported consequential risk profile is required.', { risk_profile });
  const blockers = [];
  if (!operation_envelope?.allowed) blockers.push('STORAGE_AUTHORIZED_OPERATION_ENVELOPE_REQUIRED');
  if (operation_envelope?.operation_key !== 'hostinger_storage_apply_plan') blockers.push('STORAGE_APPLY_OPERATION_REQUIRED');
  const canonical = buildCanonicalHostingerStoragePlanEnvelope(plan);
  const planEnvelope = { ...canonical.envelope, plan_hash: canonical.plan_hash };
  if (planEnvelope.expires_at_epoch <= now) blockers.push('STORAGE_PLAN_EXPIRED');
  if (operation_envelope?.operation_id !== planEnvelope.operation_id) blockers.push('STORAGE_OPERATION_PLAN_MISMATCH');
  if (operation_envelope?.target_binding?.target_id !== planEnvelope.target_id) blockers.push('STORAGE_TARGET_PLAN_MISMATCH');
  if (operation_envelope?.authority_context_hash !== planEnvelope.authority_context_hash) blockers.push('STORAGE_AUTHORITY_CONTEXT_PLAN_MISMATCH');
  if (operation_envelope?.request_binding?.plan_hash !== canonical.plan_hash) blockers.push('STORAGE_REQUEST_PLAN_HASH_MISMATCH');
  if (operation_envelope?.request_binding?.candidate_set_hash !== canonical.candidate_set_hash) blockers.push('STORAGE_REQUEST_CANDIDATE_SET_MISMATCH');
  if (risk.impact_set_required && !planEnvelope.impact_set_hash) blockers.push('STORAGE_IMPACT_SET_REQUIRED');

  const approvals = resolveHostingerStorageApprovalSet({
    plan_envelope: { envelope: planEnvelope },
    required_slots: required_approval_slots,
    approval_records,
    now_epoch: now,
  });
  blockers.push(...approvals.blockers);

  const leaseResult = validateLease({ lease, operationId: planEnvelope.operation_id, targetId: planEnvelope.target_id, now });
  blockers.push(...leaseResult.blockers);
  if (operation_envelope?.request_binding?.execution_lease_id !== leaseResult.lease?.lease_id) blockers.push('STORAGE_REQUEST_LEASE_MISMATCH');

  const toolchain = validateToolchainProvenance(toolchain_resolution, approved_tools);
  blockers.push(...toolchain.blockers);

  const dispatch = validateDispatchCertification(dispatch_certification, operation_envelope, now);
  blockers.push(...dispatch.blockers);

  const recovery = validateRecoveryProof(recovery_proof, planEnvelope, risk.recovery_required);
  blockers.push(...recovery.blockers);

  const attestation = validateAttestation(attestation_verification, planEnvelope, risk.attestation_required, now);
  blockers.push(...attestation.blockers);

  const core = {
    schema_version: 1,
    bundle_key: 'storage_execution_authorization_bundle_v1',
    bundle_version: HOSTINGER_STORAGE_EXECUTION_AUTHORIZATION_VERSION,
    operation_id: planEnvelope.operation_id,
    operation_key: operation_envelope?.operation_key || null,
    target_id: planEnvelope.target_id,
    risk_profile,
    plan_hash: canonical.plan_hash,
    candidate_set_hash: canonical.candidate_set_hash,
    authority_context_hash: planEnvelope.authority_context_hash,
    ownership_revision: planEnvelope.ownership_revision,
    policy_revision: planEnvelope.policy_revision,
    impact_set_hash: planEnvelope.impact_set_hash,
    approval_set_hash: approvals.approval_set_hash,
    execution_lease: leaseResult.lease,
    toolchain_provenance: toolchain.provenance,
    toolchain_provenance_digest: toolchain.provenance_digest,
    dispatch_certification: dispatch.certification,
    recovery: recovery.proof,
    attestation: attestation.attestation,
    evaluated_at_epoch: now,
    blockers: unique(blockers),
    secrets_included: false,
  };
  const bundleHash = digest(core);
  return deepFreeze({
    ok: true,
    authorization_ready: core.blockers.length === 0,
    bundle: core,
    bundle_hash: bundleHash,
    dispatch_allowed: false,
    provider_dispatch_default_off: true,
    blockers: core.blockers.length ? core.blockers : ['STORAGE_PROVIDER_DISPATCH_DEFAULT_OFF'],
    authority_created: false,
    secrets_included: false,
  });
}

export function verifyHostingerStorageExecutionAuthorizationBundle({ authorization, current = {}, expected_bundle_hash } = {}) {
  if (!authorization?.bundle) throw failure(400, 'STORAGE_EXECUTION_BUNDLE_REQUIRED', 'Execution authorization bundle is required.');
  assertSecretFree({ authorization, current }, 'bundle_verification');
  const blockers = [];
  const observedHash = digest(authorization.bundle);
  if (observedHash !== authorization.bundle_hash) blockers.push('STORAGE_EXECUTION_BUNDLE_TAMPERED');
  if (expected_bundle_hash && hash(expected_bundle_hash, 'expected_bundle_hash') !== observedHash) blockers.push('STORAGE_EXECUTION_BUNDLE_HASH_MISMATCH');
  const comparisons = [
    ['ownership_revision', 'STORAGE_OWNERSHIP_REVISION_CHANGED'],
    ['policy_revision', 'STORAGE_POLICY_REVISION_CHANGED'],
    ['plan_hash', 'STORAGE_PLAN_CHANGED'],
    ['candidate_set_hash', 'STORAGE_CANDIDATE_SET_CHANGED'],
    ['impact_set_hash', 'STORAGE_IMPACT_SET_CHANGED'],
    ['authority_context_hash', 'STORAGE_AUTHORITY_CONTEXT_CHANGED'],
    ['approval_set_hash', 'STORAGE_APPROVAL_SET_CHANGED'],
    ['toolchain_provenance_digest', 'STORAGE_TOOLCHAIN_PROVENANCE_CHANGED'],
  ];
  for (const [field, code] of comparisons) {
    if (current[field] && text(current[field], 256) !== text(authorization.bundle[field], 256)) blockers.push(code);
  }
  if (current.lease_generation && Number(current.lease_generation) !== Number(authorization.bundle.execution_lease?.generation)) blockers.push('STORAGE_EXECUTION_LEASE_GENERATION_CHANGED');
  if (current.host_key_revision && current.host_key_revision !== authorization.bundle.dispatch_certification?.host_key_revision) blockers.push('STORAGE_SSH_HOST_KEY_REVISION_CHANGED');
  return deepFreeze({
    ok: true,
    valid: blockers.length === 0 && authorization.authorization_ready === true,
    observed_bundle_hash: observedHash,
    dispatch_allowed: false,
    blockers: unique(blockers),
    secrets_included: false,
  });
}
