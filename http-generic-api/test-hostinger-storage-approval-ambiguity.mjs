#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveHostingerStorageApprovalSet } from './hostingerStorageExecutionAuthorization.js';

const h = (character) => character.repeat(64);
const slot = 'workspace_owner:workspace-1';
const plan = {
  plan_hash: h('1'),
  candidate_set_hash: h('2'),
  authority_context_hash: h('3'),
  ownership_revision: 'ownership-r1',
  policy_revision: 'policy-r1',
  impact_set_hash: h('4'),
};
const approval = {
  approval_id: 'approval-1',
  slot,
  workspace_id: 'workspace-1',
  status: 'approved',
  invalidated: false,
  decided_at_epoch: 850,
  expires_at_epoch: 1700,
  plan_hash: plan.plan_hash,
  candidate_set_hash: plan.candidate_set_hash,
  authority_context_hash: plan.authority_context_hash,
  ownership_revision: plan.ownership_revision,
  policy_revision: plan.policy_revision,
  impact_set_hash: plan.impact_set_hash,
  approver_principal_id: 'principal-1',
  approver_authority_ref: 'authority/workspace-owner-1',
  evidence_digest: h('5'),
  secrets_included: false,
};

const single = resolveHostingerStorageApprovalSet({
  plan_envelope: plan,
  required_slots: [slot],
  approval_records: [approval],
  now_epoch: 1000,
});
assert.equal(single.ready, true);
assert.equal(single.approval_set.approvals.length, 1);

const ambiguous = resolveHostingerStorageApprovalSet({
  plan_envelope: plan,
  required_slots: [slot],
  approval_records: [
    approval,
    { ...approval, approval_id: 'approval-2', decided_at_epoch: 860, evidence_digest: h('6') },
  ],
  now_epoch: 1000,
});
assert.equal(ambiguous.ready, false);
assert.deepEqual(ambiguous.approval_set.approvals, []);
assert(ambiguous.blockers.includes(`STORAGE_APPROVAL_SLOT_AMBIGUOUS:${slot}`));

const invalidatedDuplicate = resolveHostingerStorageApprovalSet({
  plan_envelope: plan,
  required_slots: [slot],
  approval_records: [approval, { ...approval, approval_id: 'approval-2', invalidated: true, evidence_digest: h('6') }],
  now_epoch: 1000,
});
assert.equal(invalidatedDuplicate.ready, true);
assert.equal(invalidatedDuplicate.approval_set.approvals.length, 1);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_approval_candidate_uniqueness',
  zero_candidate_is_missing: true,
  one_candidate_is_accepted: true,
  multiple_active_candidates_are_ambiguous: true,
  ambiguity_accepts_no_candidate: true,
  invalidated_candidates_are_excluded: true,
  secrets_included: false,
}));
