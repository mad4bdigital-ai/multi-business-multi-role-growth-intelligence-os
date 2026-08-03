import { createHash } from 'node:crypto';
import { assertHostingerStorageSecretFree } from './hostingerStorageAttestationSecretFree.js';

export const HOSTINGER_STORAGE_RECOVERY_VERSION = 'spec014-hostinger-storage-recovery-v1';

const SHA256_RE = /^[0-9a-f]{64}$/i;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,510}$/;

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function assertSecretFree(value, at = 'value') {
  return assertHostingerStorageSecretFree(value, {
    at,
    allow_authorization_envelope: true,
    on_violation: ({ reason, path, key }) => fail(
      400,
      'STORAGE_RECOVERY_SECRET_FIELD_REJECTED',
      'Recovery contracts must not contain secret-like fields.',
      { reason, path, key: key || null },
    ),
  });
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function safeId(value, field) {
  const result = text(value, 191);
  if (!SAFE_ID_RE.test(result)) throw fail(400, 'STORAGE_RECOVERY_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  return result;
}

function safeRef(value, field) {
  const result = text(value, 512);
  if (!SAFE_REF_RE.test(result) || result.startsWith('/') || result.includes('..') || /[\0\r\n]/.test(result)) {
    throw fail(400, 'STORAGE_RECOVERY_REFERENCE_INVALID', 'A bounded opaque reference is required.', { field });
  }
  return result;
}

function hash(value, field) {
  const result = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(result)) throw fail(400, 'STORAGE_RECOVERY_HASH_INVALID', 'A SHA-256 binding is required.', { field });
  return result;
}

function iso(value, field) {
  const timestamp = text(value, 64);
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) throw fail(400, 'STORAGE_RECOVERY_TIME_INVALID', 'A valid ISO timestamp is required.', { field });
  return new Date(timestamp).toISOString();
}

function selectedCapability(toolchainResolution, capability) {
  return (toolchainResolution?.selections || []).find((row) => row?.capability === capability) || null;
}

function normalizeToolBinding(selection, field) {
  return Object.freeze({
    tool_id: safeId(selection?.selected_tool_id, `${field}.tool_id`),
    binary_sha256: hash(selection?.selected?.binary_sha256, `${field}.binary_sha256`),
    version: safeId(selection?.selected?.observed_version, `${field}.version`),
    secrets_included: false,
  });
}

function normalizePlanBinding(plan = {}) {
  return Object.freeze({
    plan_id: safeId(plan.plan_id, 'plan_id'),
    operation_id: safeId(plan.operation_id, 'operation_id'),
    target_id: safeId(plan.target_id, 'target_id'),
    plan_hash: hash(plan.plan_hash, 'plan_hash'),
    candidate_set_hash: hash(plan.candidate_set_hash, 'candidate_set_hash'),
    authority_context_hash: hash(plan.authority_context_hash, 'authority_context_hash'),
    ownership_revision: safeId(plan.ownership_revision, 'ownership_revision'),
    policy_revision: safeId(plan.policy_revision, 'policy_revision'),
    secrets_included: false,
  });
}

function normalizeObservedTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => text(entry, 256)).filter(Boolean))].sort();
}

function buildRequirementBinding({ riskProfile, requestedAt, planBinding, checkpointRequired, restoreSampleRequired, replicaRequired }) {
  return Object.freeze({
    schema_version: 1,
    binding_key: 'hostinger_storage_recovery_requirement_v1',
    recovery_version: HOSTINGER_STORAGE_RECOVERY_VERSION,
    risk_profile: riskProfile,
    requested_at: requestedAt,
    plan_binding: planBinding,
    checkpoint_required: checkpointRequired,
    restore_sample_required: restoreSampleRequired,
    replica_verification_required: replicaRequired,
    automatic_retry_allowed: false,
    secrets_included: false,
  });
}

export function buildHostingerStorageRecoveryCheckpoint({
  policy,
  risk_profile,
  plan,
  repository,
  toolchain_resolution,
  requested_at,
} = {}) {
  assertSecretFree({ plan, repository, toolchain_resolution }, 'checkpoint_request');
  const risk = policy?.risk_profiles?.[risk_profile];
  if (!risk) throw fail(400, 'STORAGE_RECOVERY_RISK_PROFILE_INVALID', 'Unknown storage risk profile.', { risk_profile: risk_profile || null });
  const binding = normalizePlanBinding(plan);
  const requestedAt = iso(requested_at, 'requested_at');
  const checkpointRequired = risk.checkpoint_required === true;
  const restoreSampleRequired = risk.restore_sample_required === true;
  const replicaRequired = risk.replica_verification_required === true;
  const requirementBinding = buildRequirementBinding({
    riskProfile: risk_profile,
    requestedAt,
    planBinding: binding,
    checkpointRequired,
    restoreSampleRequired,
    replicaRequired,
  });
  const requirementBindingDigest = digest(requirementBinding);

  if (!checkpointRequired) {
    return Object.freeze({
      ok: true,
      checkpoint_required: false,
      restore_sample_required: false,
      replica_verification_required: false,
      requirement_binding: requirementBinding,
      requirement_binding_digest: requirementBindingDigest,
      plan_binding: binding,
      dispatch_allowed: false,
      blockers: [],
      secrets_included: false,
    });
  }

  const checkpointCapability = selectedCapability(toolchain_resolution, 'checkpoint');
  if (!checkpointCapability?.satisfied || checkpointCapability.selected_tool_id !== 'restic') {
    throw fail(409, 'STORAGE_RECOVERY_CHECKPOINT_TOOL_REQUIRED', 'A ready restic checkpoint capability is required.');
  }
  const checkpointTool = normalizeToolBinding(checkpointCapability, 'checkpoint_tool');

  let replicaVerificationTool = null;
  if (replicaRequired) {
    const replicaCapability = selectedCapability(toolchain_resolution, 'replica_verification');
    const allowedReplicaTools = policy?.selection_rules?.replica_verification || [];
    if (!replicaCapability?.satisfied || !allowedReplicaTools.includes(replicaCapability.selected_tool_id)) {
      throw fail(409, 'STORAGE_RECOVERY_REPLICA_TOOL_REQUIRED', 'A ready allowlisted replica-verification capability is required.');
    }
    replicaVerificationTool = normalizeToolBinding(replicaCapability, 'replica_verification_tool');
  }

  const resticPolicy = policy.tools?.restic;
  const backend = text(repository?.backend, 32).toLowerCase();
  if (!(resticPolicy?.repository_backends || []).includes(backend)) {
    throw fail(400, 'STORAGE_RECOVERY_BACKEND_INVALID', 'Recovery repository backend is not allowlisted.', { backend: backend || null });
  }
  const repositoryBinding = Object.freeze({
    repository_ref: safeRef(repository.repository_ref, 'repository_ref'),
    backend,
    binding_revision: safeId(repository.binding_revision, 'repository.binding_revision'),
    retention_policy_revision: safeId(repository.retention_policy_revision, 'repository.retention_policy_revision'),
    external_to_target: repository.external_to_target === true,
    secrets_included: false,
  });
  if (!repositoryBinding.external_to_target) {
    throw fail(409, 'STORAGE_RECOVERY_EXTERNAL_REPOSITORY_REQUIRED', 'Recovery checkpoint repository must be external to the mutation target.');
  }
  const repositoryBindingDigest = digest(repositoryBinding);
  const contractCore = {
    schema_version: 1,
    contract_key: 'hostinger_storage_recovery_checkpoint_v1',
    recovery_version: HOSTINGER_STORAGE_RECOVERY_VERSION,
    risk_profile,
    requested_at: requestedAt,
    checkpoint_required: true,
    restore_sample_required: restoreSampleRequired,
    replica_verification_required: replicaRequired,
    requirement_binding_digest: requirementBindingDigest,
    plan_binding: binding,
    repository_binding: repositoryBinding,
    repository_binding_digest: repositoryBindingDigest,
    checkpoint_tool: checkpointTool,
    replica_verification_tool: replicaVerificationTool,
    required_tags: [
      `operation:${binding.operation_id}`,
      `plan:${binding.plan_hash}`,
      `target:${binding.target_id}`,
      `policy:${binding.policy_revision}`,
    ],
    automatic_retry_allowed: false,
    secrets_included: false,
  };
  return Object.freeze({
    ok: true,
    checkpoint_required: true,
    restore_sample_required: restoreSampleRequired,
    replica_verification_required: replicaRequired,
    requirement_binding: requirementBinding,
    requirement_binding_digest: requirementBindingDigest,
    checkpoint_contract: Object.freeze(contractCore),
    checkpoint_contract_digest: digest(contractCore),
    dispatch_allowed: false,
    authority_granted: false,
    blockers: ['STORAGE_DISPATCH_DISABLED'],
    secrets_included: false,
  });
}

export function verifyHostingerStorageRecoveryEvidence({ checkpoint, evidence, verified_at } = {}) {
  assertSecretFree({ checkpoint, evidence }, 'recovery_verification');
  const requirement = checkpoint?.requirement_binding;
  if (!requirement || checkpoint.requirement_binding_digest !== digest(requirement)) {
    throw fail(409, 'STORAGE_RECOVERY_REQUIREMENT_TAMPERED', 'Recovery requirement binding digest does not match.');
  }
  if (
    checkpoint.checkpoint_required !== requirement.checkpoint_required
    || checkpoint.restore_sample_required !== requirement.restore_sample_required
    || checkpoint.replica_verification_required !== requirement.replica_verification_required
  ) {
    throw fail(409, 'STORAGE_RECOVERY_REQUIREMENT_TAMPERED', 'Recovery requirement flags do not match the bound risk profile.');
  }

  const verifiedAt = iso(verified_at, 'verified_at');
  const verifiedAtEpoch = Date.parse(verifiedAt);
  if (!requirement.checkpoint_required) {
    return Object.freeze({
      ok: true,
      required: false,
      ready: true,
      blockers: [],
      requirement_binding_digest: checkpoint.requirement_binding_digest,
      proof_digest: digest({ required: false, requirement_binding_digest: checkpoint.requirement_binding_digest }),
      secrets_included: false,
    });
  }

  const contract = checkpoint.checkpoint_contract;
  if (!contract || checkpoint.checkpoint_contract_digest !== digest(contract)) {
    throw fail(409, 'STORAGE_RECOVERY_CHECKPOINT_CONTRACT_TAMPERED', 'Checkpoint contract digest does not match.');
  }
  if (
    contract.requirement_binding_digest !== checkpoint.requirement_binding_digest
    || contract.checkpoint_required !== requirement.checkpoint_required
    || contract.restore_sample_required !== requirement.restore_sample_required
    || contract.replica_verification_required !== requirement.replica_verification_required
    || digest(contract.plan_binding) !== digest(requirement.plan_binding)
  ) {
    throw fail(409, 'STORAGE_RECOVERY_CHECKPOINT_CONTRACT_TAMPERED', 'Checkpoint contract does not match its bound requirement.');
  }

  const blockers = [];
  const snapshotId = text(evidence?.snapshot_id, 191);
  if (!SAFE_ID_RE.test(snapshotId)) blockers.push('STORAGE_RECOVERY_SNAPSHOT_REQUIRED');
  if (text(evidence?.repository_binding_digest, 64).toLowerCase() !== contract.repository_binding_digest) blockers.push('STORAGE_RECOVERY_REPOSITORY_BINDING_MISMATCH');
  if (text(evidence?.plan_hash, 64).toLowerCase() !== contract.plan_binding.plan_hash) blockers.push('STORAGE_RECOVERY_PLAN_HASH_MISMATCH');
  if (text(evidence?.candidate_set_hash, 64).toLowerCase() !== contract.plan_binding.candidate_set_hash) blockers.push('STORAGE_RECOVERY_CANDIDATE_SET_MISMATCH');
  if (evidence?.repository_check_passed !== true) blockers.push('STORAGE_RECOVERY_REPOSITORY_CHECK_REQUIRED');

  if (text(evidence?.checkpoint_tool?.tool_id, 191) !== contract.checkpoint_tool?.tool_id) blockers.push('STORAGE_RECOVERY_CHECKPOINT_TOOL_MISMATCH');
  if (text(evidence?.checkpoint_tool?.tool_version, 191) !== contract.checkpoint_tool?.version) blockers.push('STORAGE_RECOVERY_CHECKPOINT_VERSION_MISMATCH');
  if (text(evidence?.checkpoint_tool?.tool_binary_sha256, 64).toLowerCase() !== contract.checkpoint_tool?.binary_sha256) blockers.push('STORAGE_RECOVERY_CHECKPOINT_BINARY_MISMATCH');

  const observedTags = normalizeObservedTags(evidence?.snapshot_tags);
  if (!contract.required_tags.every((tag) => observedTags.includes(tag))) blockers.push('STORAGE_RECOVERY_SNAPSHOT_TAGS_MISMATCH');

  const requestedAtEpoch = Date.parse(contract.requested_at);
  const backupCompletedAt = Date.parse(text(evidence?.backup_completed_at, 64));
  if (!Number.isFinite(backupCompletedAt)) blockers.push('STORAGE_RECOVERY_BACKUP_TIME_REQUIRED');
  else {
    if (backupCompletedAt < requestedAtEpoch) blockers.push('STORAGE_RECOVERY_BACKUP_BEFORE_CHECKPOINT_REQUEST');
    if (backupCompletedAt > verifiedAtEpoch) blockers.push('STORAGE_RECOVERY_BACKUP_AFTER_VERIFICATION');
  }

  let restoreSampleVerifiedAt = Number.NaN;
  if (contract.restore_sample_required) {
    if (evidence?.restore_sample?.verified !== true) blockers.push('STORAGE_RECOVERY_RESTORE_SAMPLE_REQUIRED');
    if (!SHA256_RE.test(text(evidence?.restore_sample?.content_digest, 64))) blockers.push('STORAGE_RECOVERY_RESTORE_SAMPLE_DIGEST_REQUIRED');
    restoreSampleVerifiedAt = Date.parse(text(evidence?.restore_sample?.verified_at, 64));
    if (!Number.isFinite(restoreSampleVerifiedAt)) blockers.push('STORAGE_RECOVERY_RESTORE_SAMPLE_TIME_REQUIRED');
    else {
      if (Number.isFinite(backupCompletedAt) && restoreSampleVerifiedAt < backupCompletedAt) blockers.push('STORAGE_RECOVERY_RESTORE_SAMPLE_BEFORE_BACKUP');
      if (restoreSampleVerifiedAt > verifiedAtEpoch) blockers.push('STORAGE_RECOVERY_RESTORE_SAMPLE_AFTER_VERIFICATION');
    }
  }

  if (contract.replica_verification_required) {
    if (evidence?.replica?.verified !== true) blockers.push('STORAGE_RECOVERY_REPLICA_VERIFICATION_REQUIRED');
    if (!SHA256_RE.test(text(evidence?.replica?.verification_digest, 64))) blockers.push('STORAGE_RECOVERY_REPLICA_DIGEST_REQUIRED');
    if (text(evidence?.replica?.tool_id, 191) !== contract.replica_verification_tool?.tool_id) blockers.push('STORAGE_RECOVERY_REPLICA_TOOL_MISMATCH');
    if (text(evidence?.replica?.tool_version, 191) !== contract.replica_verification_tool?.version) blockers.push('STORAGE_RECOVERY_REPLICA_VERSION_MISMATCH');
    if (text(evidence?.replica?.tool_binary_sha256, 64).toLowerCase() !== contract.replica_verification_tool?.binary_sha256) blockers.push('STORAGE_RECOVERY_REPLICA_BINARY_MISMATCH');
  }

  const proof = {
    schema_version: 1,
    proof_key: 'hostinger_storage_recovery_proof_v1',
    requirement_binding_digest: checkpoint.requirement_binding_digest,
    operation_id: contract.plan_binding.operation_id,
    plan_id: contract.plan_binding.plan_id,
    plan_hash: contract.plan_binding.plan_hash,
    candidate_set_hash: contract.plan_binding.candidate_set_hash,
    target_id: contract.plan_binding.target_id,
    repository_binding_digest: contract.repository_binding_digest,
    snapshot_id: snapshotId || null,
    snapshot_tags: observedTags,
    snapshot_tags_digest: digest(observedTags),
    checkpoint_tool_id: contract.checkpoint_tool?.tool_id || null,
    checkpoint_tool_version: contract.checkpoint_tool?.version || null,
    checkpoint_tool_binary_sha256: contract.checkpoint_tool?.binary_sha256 || null,
    backup_completed_at: Number.isFinite(backupCompletedAt) ? new Date(backupCompletedAt).toISOString() : null,
    repository_check_passed: evidence?.repository_check_passed === true,
    restore_sample_verified: evidence?.restore_sample?.verified === true,
    restore_sample_digest: SHA256_RE.test(text(evidence?.restore_sample?.content_digest, 64)) ? text(evidence.restore_sample.content_digest, 64).toLowerCase() : null,
    restore_sample_verified_at: Number.isFinite(restoreSampleVerifiedAt) ? new Date(restoreSampleVerifiedAt).toISOString() : null,
    replica_verified: evidence?.replica?.verified === true,
    replica_verification_digest: SHA256_RE.test(text(evidence?.replica?.verification_digest, 64)) ? text(evidence.replica.verification_digest, 64).toLowerCase() : null,
    replica_tool_id: contract.replica_verification_tool?.tool_id || null,
    replica_tool_version: contract.replica_verification_tool?.version || null,
    replica_tool_binary_sha256: contract.replica_verification_tool?.binary_sha256 || null,
    verified_at: verifiedAt,
    blockers: [...new Set(blockers)].sort(),
    secrets_included: false,
  };
  return Object.freeze({
    ok: true,
    required: true,
    ready: proof.blockers.length === 0,
    proof: Object.freeze(proof),
    proof_digest: digest(proof),
    blockers: proof.blockers,
    automatic_retry_allowed: false,
    secrets_included: false,
  });
}
