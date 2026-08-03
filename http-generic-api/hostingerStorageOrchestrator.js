import { createHash } from 'node:crypto';
import {
  buildStorageAuthorityContextFingerprintInput,
  resolveHostingerStorageAuthorization,
} from './hostingerStorageOrchestrationPolicy.js';

const PROVIDER_ACTIONS = Object.freeze({
  hostinger_storage_scan: 'scan',
  hostinger_storage_plan: 'plan',
  hostinger_storage_inspect_plan: 'inspect',
  hostinger_storage_apply_plan: 'apply',
  hostinger_storage_readback: 'scan',
  hostinger_storage_reserve_status: 'reserve-status',
  hostinger_storage_reserve_create: 'reserve-create',
  hostinger_storage_reserve_release: 'reserve-release',
});

const MUTATING_PROVIDER_OPERATIONS = new Set([
  'hostinger_storage_apply_plan',
  'hostinger_storage_reserve_create',
  'hostinger_storage_reserve_release',
]);

const INTERNAL_ONLY_OPERATIONS = new Set([
  'hostinger_storage_request_apply',
  'hostinger_storage_approve_plan',
  'hostinger_storage_policy_manage',
]);

const TENANT_ALLOWED_EVIDENCE_KEYS = new Set([
  'ok',
  'operation_id',
  'operation_key',
  'state',
  'pressure_state',
  'resource_id',
  'tenant_id',
  'workspace_id',
  'resource_usage_kb',
  'resource_inode_count',
  'candidate_count',
  'candidate_bytes',
  'plan_id',
  'plan_hash',
  'expires_at',
  'categories',
  'candidates',
  'deleted_count',
  'deleted_bytes',
  'skipped_count',
  'failed_count',
  'readback_status',
  'reason_codes',
  'completeness',
  'secrets_included',
]);

function compact(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => compact(value, 128))
    .filter(Boolean))];
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
  const payload = typeof value === 'string' ? value : JSON.stringify(stableValue(value));
  return createHash('sha256').update(payload).digest('hex');
}

function allow(details = {}) {
  return {
    ok: true,
    allowed: true,
    decision: 'allow',
    reason_codes: [],
    secrets_included: false,
    ...details,
  };
}

function deny(reasonCodes, details = {}) {
  return {
    ok: false,
    allowed: false,
    decision: 'deny',
    reason_codes: unique(Array.isArray(reasonCodes) ? reasonCodes : [reasonCodes]),
    secrets_included: false,
    ...details,
  };
}

function epoch(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function normalizeTarget(target = {}) {
  return {
    target_id: compact(target.target_id || target.targetId, 64),
    hosting_account_id: compact(target.hosting_account_id || target.hostingAccountId, 64),
    resource_id: compact(target.resource_id || target.resourceId, 64),
    ownership_scope: compact(target.ownership_scope || target.ownershipScope, 16).toLowerCase(),
    account_ownership_scope: compact(target.account_ownership_scope || target.accountOwnershipScope, 16).toLowerCase(),
    tenant_id: compact(target.tenant_id || target.tenantId, 64) || null,
    workspace_id: compact(target.workspace_id || target.workspaceId, 64) || null,
    ownership_revision: compact(target.ownership_revision || target.ownershipRevision, 128),
    policy_revision: compact(target.policy_revision || target.policyRevision, 128),
    storage_root_ref: compact(target.storage_root_ref || target.storageRootRef, 128) || null,
  };
}

function normalizeRequest(request = {}) {
  return {
    operation_key: compact(request.operation_key || request.operationKey, 128),
    plan_id: compact(request.plan_id || request.planId, 128) || null,
    plan_hash: compact(request.plan_hash || request.planHash, 128).toLowerCase() || null,
    candidate_set_hash: compact(request.candidate_set_hash || request.candidateSetHash, 128).toLowerCase() || null,
    authority_context_hash: compact(request.authority_context_hash || request.authorityContextHash, 128).toLowerCase() || null,
    ownership_revision: compact(request.ownership_revision || request.ownershipRevision, 128) || null,
    policy_revision: compact(request.policy_revision || request.policyRevision, 128) || null,
    capability_envelope_id: compact(request.capability_envelope_id || request.capabilityEnvelopeId, 64) || null,
    resource_authority_id: compact(request.resource_authority_id || request.resourceAuthorityId, 64) || null,
    execution_lease_id: compact(request.execution_lease_id || request.executionLeaseId, 64) || null,
    typed_confirmation: compact(request.typed_confirmation || request.typedConfirmation, 512) || null,
    approval_workspace_ids: unique(request.approval_workspace_ids || request.approvalWorkspaceIds),
    impacted_workspace_ids: unique(request.impacted_workspace_ids || request.impactedWorkspaceIds),
    plan_candidate_classes: unique(request.plan_candidate_classes || request.planCandidateClasses),
  };
}

export function computeHostingerStorageAuthorityContextHash(input = {}) {
  return sha256(buildStorageAuthorityContextFingerprintInput(input));
}

export function computeHostingerStorageIdempotencyKey({ operation_key, target, request, authority_context_hash } = {}) {
  const normalizedTarget = normalizeTarget(target);
  const normalizedRequest = normalizeRequest(request);
  return sha256({
    operation_key: compact(operation_key || normalizedRequest.operation_key, 128),
    target_id: normalizedTarget.target_id,
    hosting_account_id: normalizedTarget.hosting_account_id,
    resource_id: normalizedTarget.resource_id,
    ownership_revision: normalizedTarget.ownership_revision,
    policy_revision: normalizedTarget.policy_revision,
    plan_id: normalizedRequest.plan_id,
    plan_hash: normalizedRequest.plan_hash,
    candidate_set_hash: normalizedRequest.candidate_set_hash,
    authority_context_hash: compact(authority_context_hash || normalizedRequest.authority_context_hash, 128),
  });
}

export function createHostingerStorageOperationEnvelope({
  operation_id,
  actor = {},
  context = {},
  target = {},
  request = {},
  created_at_epoch = Math.floor(Date.now() / 1000),
} = {}) {
  const operationId = compact(operation_id, 128);
  if (!operationId) return deny('operation_id_required');

  const authorization = resolveHostingerStorageAuthorization({ actor, context, target, request });
  if (!authorization.allowed) {
    return deny(authorization.reason_codes, {
      operation_id: operationId,
      operation_key: compact(request.operation_key || request.operationKey, 128) || null,
      authorization,
    });
  }

  const normalizedTarget = normalizeTarget(target);
  const normalizedRequest = normalizeRequest(request);
  const expectedAuthorityContextHash = computeHostingerStorageAuthorityContextHash({ actor, context, target, request });
  const mutatingProviderOperation = MUTATING_PROVIDER_OPERATIONS.has(normalizedRequest.operation_key);

  if (mutatingProviderOperation && normalizedRequest.authority_context_hash !== expectedAuthorityContextHash) {
    return deny('authority_context_hash_mismatch', {
      operation_id: operationId,
      operation_key: normalizedRequest.operation_key,
      expected_authority_context_hash: expectedAuthorityContextHash,
    });
  }

  const idempotencyKey = computeHostingerStorageIdempotencyKey({
    operation_key: normalizedRequest.operation_key,
    target,
    request,
    authority_context_hash: expectedAuthorityContextHash,
  });

  return allow({
    operation_id: operationId,
    operation_key: normalizedRequest.operation_key,
    state: 'observed',
    created_at_epoch: Number(created_at_epoch),
    selected_context: {
      mode: compact(context.mode, 16).toLowerCase(),
      tenant_id: compact(context.tenant_id || context.tenantId, 64) || null,
      workspace_id: compact(context.workspace_id || context.workspaceId, 64) || null,
      resource_id: compact(context.resource_id || context.resourceId, 64) || null,
    },
    target_binding: normalizedTarget,
    request_binding: normalizedRequest,
    authority_context_hash: expectedAuthorityContextHash,
    idempotency_key: idempotencyKey,
    required_workspace_approvals: authorization.required_workspace_approvals || [],
    visibility: authorization.visibility,
    provider_adapter: {
      adapter_key: 'hostinger_ssh_storage_v1',
      provider_action: PROVIDER_ACTIONS[normalizedRequest.operation_key] || null,
      fixed_operation: true,
      freeform_shell_allowed: false,
      dispatch_certified: false,
      internal_only: INTERNAL_ONLY_OPERATIONS.has(normalizedRequest.operation_key),
    },
    authorization,
  });
}

function approvalStatus({ required = [], approvals = [] } = {}) {
  const approved = new Set((Array.isArray(approvals) ? approvals : [])
    .filter((row) => row?.status === 'approved' && row?.invalidated !== true)
    .map((row) => compact(row.workspace_id || row.workspaceId, 64))
    .filter(Boolean));
  const missing = unique(required).filter((workspaceId) => !approved.has(workspaceId));
  return { satisfied: missing.length === 0, missing };
}

export function evaluateHostingerStorageDispatchReadiness({
  envelope,
  plan = {},
  approvals = [],
  lease = {},
  dispatch_certification = {},
  runtime_flags = {},
  concurrent_operation = null,
  now_epoch = Math.floor(Date.now() / 1000),
} = {}) {
  if (!envelope?.allowed) return deny('authorized_operation_envelope_required', { ready: false });
  if (envelope.provider_adapter?.internal_only) {
    return deny('operation_has_no_provider_dispatch', {
      ready: false,
      operation_id: envelope.operation_id,
      operation_key: envelope.operation_key,
    });
  }

  const operationKey = compact(envelope.operation_key, 128);
  const mutating = MUTATING_PROVIDER_OPERATIONS.has(operationKey);
  const reasons = [];

  if (dispatch_certification?.status !== 'certified') reasons.push('dispatch_not_certified');
  if (dispatch_certification?.adapter_key !== envelope.provider_adapter?.adapter_key) reasons.push('dispatch_adapter_mismatch');
  if (dispatch_certification?.host_key_pinned !== true) reasons.push('ssh_host_key_not_pinned');
  if (!envelope.target_binding?.storage_root_ref) reasons.push('storage_root_ref_required');

  if (!mutating) {
    const readFlag = operationKey === 'hostinger_storage_scan' || operationKey === 'hostinger_storage_readback'
      ? runtime_flags.scan_enabled
      : runtime_flags.plan_enabled;
    if (readFlag !== true) reasons.push('runtime_read_dispatch_flag_disabled');
    return reasons.length
      ? deny(reasons, { ready: false, operation_id: envelope.operation_id, operation_key: operationKey })
      : allow({ ready: true, operation_id: envelope.operation_id, operation_key: operationKey });
  }

  if (runtime_flags.apply_enabled !== true) reasons.push('runtime_apply_flag_disabled');
  if (!lease?.lease_id || lease.lease_id !== envelope.request_binding.execution_lease_id) reasons.push('execution_lease_mismatch');
  if (lease?.operation_id !== envelope.operation_id) reasons.push('execution_lease_operation_mismatch');
  if (lease?.target_id !== envelope.target_binding.target_id) reasons.push('execution_lease_target_mismatch');
  if (epoch(lease?.expires_at_epoch || lease?.expires_at) <= Number(now_epoch)) reasons.push('execution_lease_expired');

  if (concurrent_operation && !['completed', 'blocked', 'expired', 'cancelled', 'failed'].includes(concurrent_operation.state)) {
    reasons.push('conflicting_operation_active');
  }

  if (operationKey === 'hostinger_storage_apply_plan') {
    if (plan?.status !== 'approved') reasons.push('plan_not_approved');
    if (compact(plan?.plan_id, 128) !== envelope.request_binding.plan_id) reasons.push('plan_id_mismatch');
    if (compact(plan?.plan_hash, 128).toLowerCase() !== envelope.request_binding.plan_hash) reasons.push('plan_hash_mismatch');
    if (compact(plan?.candidate_set_hash, 128).toLowerCase() !== envelope.request_binding.candidate_set_hash) reasons.push('candidate_set_hash_mismatch');
    if (compact(plan?.ownership_revision, 128) !== envelope.target_binding.ownership_revision) reasons.push('plan_ownership_revision_mismatch');
    if (compact(plan?.policy_revision, 128) !== envelope.target_binding.policy_revision) reasons.push('plan_policy_revision_mismatch');
    if (epoch(plan?.expires_at_epoch || plan?.expires_at) <= Number(now_epoch)) reasons.push('plan_expired');
    if (plan?.consumed === true) reasons.push('plan_already_consumed');
    const approval = approvalStatus({ required: envelope.required_workspace_approvals, approvals });
    if (!approval.satisfied) reasons.push('required_workspace_approvals_missing');
  }

  if (operationKey === 'hostinger_storage_reserve_release' && !envelope.request_binding?.typed_confirmation) {
    reasons.push('typed_confirmation_required');
  }

  return reasons.length
    ? deny(reasons, { ready: false, operation_id: envelope.operation_id, operation_key: operationKey })
    : allow({ ready: true, operation_id: envelope.operation_id, operation_key: operationKey });
}

export function buildHostingerStorageProviderInvocation({ envelope, readiness } = {}) {
  if (!envelope?.allowed) return deny('authorized_operation_envelope_required');
  if (!readiness?.ready) {
    return deny(readiness?.reason_codes?.length ? readiness.reason_codes : 'dispatch_readiness_required');
  }
  const providerAction = envelope.provider_adapter?.provider_action;
  if (!providerAction) return deny('provider_action_not_available');

  const args = {
    action: providerAction,
    storage_root_ref: envelope.target_binding.storage_root_ref,
  };
  if (envelope.request_binding.plan_id) args.plan_id = envelope.request_binding.plan_id;
  if (envelope.request_binding.plan_hash) args.expected_plan_hash = envelope.request_binding.plan_hash;
  if (envelope.request_binding.typed_confirmation) args.typed_confirmation = envelope.request_binding.typed_confirmation;

  return allow({
    invocation: {
      adapter_key: envelope.provider_adapter.adapter_key,
      operation_id: envelope.operation_id,
      target_id: envelope.target_binding.target_id,
      fixed_script_ref: 'repo:http-generic-api/scripts/hostinger-storage-cleanup.sh',
      args,
      shell_command: null,
      wildcard_allowed: false,
      arbitrary_root_allowed: false,
      output_policy: 'bounded_redacted_json',
      secrets_included: false,
    },
  });
}

function tenantCandidate(candidate = {}) {
  return {
    relative_path: compact(candidate.relative_path || candidate.relativePath, 1024),
    category: compact(candidate.category, 64),
    size_bytes: Number(candidate.size_bytes ?? candidate.sizeBytes ?? 0),
    still_valid: candidate.still_valid !== false,
  };
}

export function projectHostingerStorageEvidence({ context = {}, evidence = {} } = {}) {
  const mode = compact(context.mode, 16).toLowerCase();
  if (mode === 'admin') {
    const projection = { ...evidence, secrets_included: false };
    delete projection.credentials;
    delete projection.raw_secret_values;
    delete projection.raw_provider_payload;
    return projection;
  }
  if (mode !== 'tenant') return deny('explicit_projection_context_required');

  const projected = {};
  for (const [key, value] of Object.entries(evidence || {})) {
    if (!TENANT_ALLOWED_EVIDENCE_KEYS.has(key)) continue;
    projected[key] = key === 'candidates' && Array.isArray(value)
      ? value.map(tenantCandidate)
      : value;
  }
  projected.tenant_id = compact(context.tenant_id || context.tenantId, 64) || projected.tenant_id || null;
  projected.workspace_id = compact(context.workspace_id || context.workspaceId, 64) || projected.workspace_id || null;
  projected.resource_id = compact(context.resource_id || context.resourceId, 64) || projected.resource_id || null;
  projected.secrets_included = false;
  return projected;
}

export function reconcileHostingerStorageOutcome({ plan_items = [], journal_items = [], observed_items = [] } = {}) {
  const plan = new Map((Array.isArray(plan_items) ? plan_items : []).map((item) => [compact(item.item_id || item.itemId, 128), item]));
  const journal = new Map((Array.isArray(journal_items) ? journal_items : []).map((item) => [compact(item.item_id || item.itemId, 128), item]));
  const observed = new Map((Array.isArray(observed_items) ? observed_items : []).map((item) => [compact(item.item_id || item.itemId, 128), item]));

  if (plan.size === 0) return deny('plan_items_required', { outcome: 'still_unknown' });

  let deleted = 0;
  let skipped = 0;
  let unchanged = 0;
  let conflicts = 0;
  const item_results = [];

  for (const [itemId] of plan) {
    const journalRow = journal.get(itemId);
    const observedRow = observed.get(itemId);
    let result = 'still_unknown';

    if (journalRow?.result === 'deleted' && observedRow?.exists === false) {
      result = 'deleted';
      deleted += 1;
    } else if (String(journalRow?.result || '').startsWith('skipped_') && observedRow?.exists !== false) {
      result = journalRow.result;
      skipped += 1;
    } else if (!journalRow && observedRow?.exists === true && observedRow?.matches_plan === true) {
      result = 'unchanged';
      unchanged += 1;
    } else if (journalRow?.result === 'deleted' && observedRow?.exists === true) {
      result = 'conflict';
      conflicts += 1;
    } else if (!journalRow && observedRow?.exists === false) {
      result = 'conflict';
      conflicts += 1;
    } else {
      conflicts += 1;
      result = 'conflict';
    }
    item_results.push({ item_id: itemId, result });
  }

  let outcome = 'still_unknown';
  if (conflicts > 0) outcome = 'conflict';
  else if (deleted === plan.size) outcome = 'applied';
  else if (deleted > 0 || skipped > 0) outcome = 'partially_applied';
  else if (unchanged === plan.size) outcome = 'not_applied';

  return allow({
    outcome,
    retry_allowed: outcome === 'not_applied',
    deleted_count: deleted,
    skipped_count: skipped,
    unchanged_count: unchanged,
    conflict_count: conflicts,
    item_results,
    reconciliation_digest: sha256(item_results),
  });
}

export const HOSTINGER_STORAGE_PROVIDER_ACTIONS = PROVIDER_ACTIONS;
