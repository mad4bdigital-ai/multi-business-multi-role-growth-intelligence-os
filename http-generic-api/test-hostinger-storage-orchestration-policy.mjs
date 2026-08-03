import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildStorageAuthorityContextFingerprintInput,
  resolveHostingerStorageAuthorization,
  transitionHostingerStorageOperation,
  validateStoragePlanBinding,
} from './hostingerStorageOrchestrationPolicy.js';

const policy = JSON.parse(readFileSync(new URL('./config/hostinger-storage-orchestration-policy.json', import.meta.url), 'utf8'));
assert.equal(policy.schema_version, 'mad4b.hostinger-storage-orchestration.v1');
assert.equal(policy.orchestrator.single_application_service, true);
assert.equal(policy.orchestrator.separate_admin_and_tenant_surfaces, true);
assert.equal(policy.orchestrator.freeform_shell_allowed, false);
assert.equal(policy.orchestrator.automatic_apply_allowed, false);
assert.equal(policy.orchestrator.unknown_outcome_retry_allowed, false);
assert.equal(policy.context_isolation.admin_context_may_borrow_tenant_authority, false);
assert.equal(policy.context_isolation.tenant_context_may_invoke_platform_only_operation, false);
assert.equal(policy.operations.hostinger_storage_apply_plan.dispatch_allowed, false);
assert.equal(policy.dispatch_certification.apply.includes('disabled'), true);

const hashes = {
  plan_hash: 'a'.repeat(64),
  candidate_set_hash: 'b'.repeat(64),
  authority_context_hash: 'ctx-v1',
  ownership_revision: 'ownership-v7',
  policy_revision: 'policy-v3',
};

const platformTarget = {
  target_id: 'hostinger-prod-platform',
  hosting_account_id: 'hostinger-account-1',
  resource_id: 'auth-mad4b-com',
  ownership_scope: 'platform',
  account_ownership_scope: 'shared',
  ownership_revision: hashes.ownership_revision,
  policy_revision: hashes.policy_revision,
};

const tenantTarget = {
  target_id: 'hostinger-tenant-a',
  hosting_account_id: 'hostinger-account-1',
  resource_id: 'tenant-site-a',
  ownership_scope: 'tenant',
  account_ownership_scope: 'shared',
  tenant_id: 'tenant-a',
  workspace_id: 'workspace-a',
  ownership_revision: hashes.ownership_revision,
  policy_revision: hashes.policy_revision,
};

const sharedTarget = {
  target_id: 'hostinger-shared-account',
  hosting_account_id: 'hostinger-account-1',
  resource_id: 'shared-account-root',
  ownership_scope: 'shared',
  account_ownership_scope: 'shared',
  ownership_revision: hashes.ownership_revision,
  policy_revision: hashes.policy_revision,
};

const admin = {
  principal_id: 'admin-1',
  principal_type: 'user',
  roles: ['platform_admin'],
};

const tenantOwner = {
  principal_id: 'user-owner-a',
  principal_type: 'user',
  tenant_id: 'tenant-a',
  workspace_id: 'workspace-a',
  roles: ['workspace_owner'],
};

const tenantOperator = {
  principal_id: 'user-operator-a',
  principal_type: 'user',
  tenant_id: 'tenant-a',
  workspace_id: 'workspace-a',
  roles: ['tenant_operator'],
};

const adminContext = { mode: 'admin', resource_id: platformTarget.resource_id };
const tenantContext = {
  mode: 'tenant',
  tenant_id: 'tenant-a',
  workspace_id: 'workspace-a',
  resource_id: tenantTarget.resource_id,
};

function request(operation_key, extra = {}) {
  return { operation_key, ...extra };
}

let decision = resolveHostingerStorageAuthorization({
  actor: admin,
  context: adminContext,
  target: platformTarget,
  request: request('hostinger_storage_scan'),
});
assert.equal(decision.allowed, true);
assert.equal(decision.visibility, 'admin_bounded_projection');
assert.equal(decision.dispatch_allowed, true);

decision = resolveHostingerStorageAuthorization({
  actor: tenantOperator,
  context: tenantContext,
  target: tenantTarget,
  request: request('hostinger_storage_scan'),
});
assert.equal(decision.allowed, true);
assert.equal(decision.visibility, 'tenant_redacted_projection');
assert.equal(decision.authority_context.context_tenant_id, 'tenant-a');

decision = resolveHostingerStorageAuthorization({
  actor: tenantOperator,
  context: tenantContext,
  target: platformTarget,
  request: request('hostinger_storage_scan'),
});
assert.equal(decision.allowed, false);
assert(decision.reason_codes.includes('tenant_context_requires_tenant_owned_resource'));
assert(decision.reason_codes.includes('target_tenant_mismatch'));

decision = resolveHostingerStorageAuthorization({
  actor: admin,
  context: tenantContext,
  target: tenantTarget,
  request: request('hostinger_storage_scan'),
});
assert.equal(decision.allowed, false);
assert(decision.reason_codes.includes('tenant_role_required'));

const dualRoleActor = {
  ...tenantOwner,
  roles: ['workspace_owner', 'platform_admin'],
};
decision = resolveHostingerStorageAuthorization({
  actor: dualRoleActor,
  context: tenantContext,
  target: tenantTarget,
  request: request('hostinger_storage_scan'),
});
assert.equal(decision.allowed, true, 'a dual-role user must be allowed only after explicitly selecting tenant context');

decision = resolveHostingerStorageAuthorization({
  actor: tenantOperator,
  context: tenantContext,
  target: tenantTarget,
  request: request('hostinger_storage_request_apply'),
});
assert.equal(decision.allowed, true);
assert.equal(decision.mutating, false);
assert.equal(decision.dispatch_allowed, true, 'request_apply creates an approval hold and does not dispatch cleanup');

const tenantApplyRequest = request('hostinger_storage_apply_plan', {
  ...hashes,
  capability_envelope_id: 'cap-1',
  resource_authority_id: 'authority-1',
  execution_lease_id: 'lease-1',
  typed_confirmation: 'APPLY_HOSTINGER_STORAGE_CLEANUP:plan:token',
  approval_workspace_ids: ['workspace-a'],
});

decision = resolveHostingerStorageAuthorization({
  actor: tenantOperator,
  context: tenantContext,
  target: tenantTarget,
  request: tenantApplyRequest,
});
assert.equal(decision.allowed, false);
assert(decision.reason_codes.includes('tenant_operation_role_not_satisfied'));

decision = resolveHostingerStorageAuthorization({
  actor: tenantOwner,
  context: tenantContext,
  target: tenantTarget,
  request: tenantApplyRequest,
});
assert.equal(decision.allowed, true);
assert.equal(decision.dispatch_allowed, false, 'authorization success does not certify live dispatch');
assert.deepEqual(decision.required_workspace_approvals, ['workspace-a']);

decision = resolveHostingerStorageAuthorization({
  actor: tenantOwner,
  context: tenantContext,
  target: sharedTarget,
  request: tenantApplyRequest,
});
assert.equal(decision.allowed, false);
assert(decision.reason_codes.includes('tenant_context_requires_tenant_owned_resource'));

const adminTenantApply = {
  ...tenantApplyRequest,
  resource_authority_id: '',
  approval_workspace_ids: ['workspace-a'],
};
decision = resolveHostingerStorageAuthorization({
  actor: admin,
  context: { mode: 'admin', resource_id: tenantTarget.resource_id },
  target: tenantTarget,
  request: adminTenantApply,
});
assert.equal(decision.allowed, false);
assert(decision.reason_codes.includes('tenant_mutation_requires_delegation_or_break_glass'));

decision = resolveHostingerStorageAuthorization({
  actor: admin,
  context: { mode: 'admin', resource_id: tenantTarget.resource_id },
  target: tenantTarget,
  request: {
    ...adminTenantApply,
    delegation_id: 'delegation-1',
    support_case_id: 'support-1',
  },
});
assert.equal(decision.allowed, true);

const sharedApply = {
  ...tenantApplyRequest,
  resource_authority_id: '',
  impacted_workspace_ids: ['workspace-a', 'workspace-b'],
  approval_workspace_ids: ['workspace-a'],
};
decision = resolveHostingerStorageAuthorization({
  actor: admin,
  context: { mode: 'admin', resource_id: sharedTarget.resource_id },
  target: sharedTarget,
  request: sharedApply,
});
assert.equal(decision.allowed, false);
assert(decision.reason_codes.includes('required_workspace_approvals_missing'));
assert.deepEqual(decision.required_workspace_approvals, ['workspace-a', 'workspace-b']);

decision = resolveHostingerStorageAuthorization({
  actor: admin,
  context: { mode: 'admin', resource_id: sharedTarget.resource_id },
  target: sharedTarget,
  request: { ...sharedApply, approval_workspace_ids: ['workspace-a', 'workspace-b'] },
});
assert.equal(decision.allowed, true);

decision = resolveHostingerStorageAuthorization({
  actor: tenantOwner,
  context: tenantContext,
  target: tenantTarget,
  request: request('hostinger_storage_reserve_status'),
});
assert.equal(decision.allowed, false);
assert(decision.reason_codes.includes('operation_not_available_in_context'));
assert(decision.reason_codes.includes('platform_only_operation'));

decision = resolveHostingerStorageAuthorization({
  actor: admin,
  context: adminContext,
  target: platformTarget,
  request: request('hostinger_storage_reserve_release', {
    capability_envelope_id: 'cap-reserve',
    execution_lease_id: 'lease-reserve',
    authority_context_hash: 'ctx-reserve',
  }),
});
assert.equal(decision.allowed, false);
assert(decision.reason_codes.includes('active_storage_incident_required'));

decision = resolveHostingerStorageAuthorization({
  actor: admin,
  context: adminContext,
  target: platformTarget,
  request: request('hostinger_storage_reserve_release', {
    capability_envelope_id: 'cap-reserve',
    execution_lease_id: 'lease-reserve',
    authority_context_hash: 'ctx-reserve',
    active_incident_id: 'incident-storage-1',
  }),
});
assert.equal(decision.allowed, true);

const binding = validateStoragePlanBinding({
  context: tenantContext,
  target: tenantTarget,
  request: { ...tenantApplyRequest, ownership_revision: 'stale-ownership' },
});
assert.equal(binding.allowed, false);
assert(binding.reason_codes.includes('ownership_revision_mismatch'));

decision = resolveHostingerStorageAuthorization({
  actor: tenantOwner,
  context: tenantContext,
  target: tenantTarget,
  request: { ...tenantApplyRequest, plan_candidate_classes: ['deployment_history'] },
});
assert.equal(decision.allowed, false);
assert(decision.reason_codes.includes('release_authority_required'));

const fingerprintInput = buildStorageAuthorityContextFingerprintInput({
  actor: tenantOwner,
  context: tenantContext,
  target: tenantTarget,
  request: tenantApplyRequest,
});
assert.equal(fingerprintInput.context_mode, 'tenant');
assert.equal(fingerprintInput.target_workspace_id, 'workspace-a');
assert.equal(fingerprintInput.operation_key, 'hostinger_storage_apply_plan');
assert.equal('credential' in fingerprintInput, false);

let transition = transitionHostingerStorageOperation({ current_state: 'planned', next_state: 'inspected' });
assert.equal(transition.allowed, true);
transition = transitionHostingerStorageOperation({ current_state: 'planned', next_state: 'executing' });
assert.equal(transition.allowed, false);
assert(transition.reason_codes.includes('invalid_state_transition'));
transition = transitionHostingerStorageOperation({ current_state: 'unknown_outcome', next_state: 'completed' });
assert.equal(transition.allowed, false);
assert(transition.reason_codes.includes('unknown_outcome_requires_reconciliation'));
transition = transitionHostingerStorageOperation({
  current_state: 'unknown_outcome',
  next_state: 'completed',
  unknown_outcome_reconciled: true,
});
assert.equal(transition.allowed, true);
transition = transitionHostingerStorageOperation({ current_state: 'completed', next_state: 'observed' });
assert.equal(transition.allowed, false);
assert(transition.reason_codes.includes('terminal_state_transition_forbidden'));

console.log('Hostinger admin/tenant storage orchestration policy guard passed');
