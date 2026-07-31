import assert from "node:assert/strict";
import {
  createGovernedPolicyLifecycleService,
  governedPolicyLifecycleContract,
} from "./src/application/governedPolicy/governedPolicyLifecycleService.js";
import { GovernedPolicyError, stableGovernedPolicySha256 } from "./src/domain/governedPolicy/governedPolicyQuestionnaireEngine.js";

const NOW = new Date("2026-07-31T09:00:00.000Z");
const FUTURE = new Date("2026-07-31T10:00:00.000Z").toISOString();
const TENANT = "tenant-001";
const RESOURCE = "urn:mad4b:tenant:tenant-001:deployment-exposure";
const POLICY_KEY = "activation.deployment_exposure";
const POLICY_HASH_V1 = "a".repeat(64);
const POLICY_HASH_V0 = "b".repeat(64);
const PROPOSAL_HASH = "c".repeat(64);
const COMPILATION_HASH = "d".repeat(64);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createMemoryRepository() {
  const state = {
    proposals: new Map(),
    approvals: new Map(),
    activations: new Map(),
    policies: new Map(),
    invalidations: new Map(),
    failedActivations: [],
    plaintextConfirmationObserved: false,
    mismatchReadback: false,
  };
  const policyIdentity = (tenant, key, version, resource) => `${tenant}|${key}|${version}|${resource}`;
  const activeIdentity = (tenant, key, resource) => `${tenant}|${key}|${resource}`;
  const active = new Map();

  const repository = {
    state,
    async withTransaction(callback) {
      return callback({ tx: true });
    },
    async persistCompiledProposal(_tx, input) {
      const existing = [...state.proposals.values()].find(
        (proposal) => proposal.tenant_id === input.proposal.tenant_id
          && proposal._idempotency_key === input.idempotency_key,
      );
      if (existing) return { idempotent_replay: true, proposal: clone(existing) };
      const persisted = {
        ...clone(input.proposal),
        compiled_policy_sha256: input.compilation.compiled_policy_sha256,
        compiled_policy: clone(input.compilation.compiled_policy),
        safety_bounds_sha256: input.compilation.safety_bounds_sha256,
        _idempotency_key: input.idempotency_key,
      };
      state.proposals.set(persisted.proposal_id, persisted);
      return { idempotent_replay: false, proposal: clone(persisted) };
    },
    async readProposalForUpdate(_tx, proposalId) {
      return clone(state.proposals.get(proposalId));
    },
    async readApprovalForProposal(_tx, proposalId) {
      return clone(state.approvals.get(proposalId));
    },
    async appendApproval(_tx, approval) {
      state.plaintextConfirmationObserved ||= Object.values(approval).some(
        (value) => value === "CONFIRM POLICY ACTIVATION",
      );
      const existing = state.approvals.get(approval.proposal_id);
      if (existing && existing.idempotency_key === approval.idempotency_key) return clone(existing);
      state.approvals.set(approval.proposal_id, clone(approval));
      const proposal = state.proposals.get(approval.proposal_id);
      proposal.status = "approved";
      return clone(approval);
    },
    async preparePolicyActivation(_tx, input) {
      const existing = [...state.activations.values()].find(
        (activation) => activation.tenant_id === input.tenant_id
          && activation.idempotency_key === input.idempotency_key,
      );
      if (existing) return clone(existing);
      const activation = {
        activation_id: input.activation_id,
        proposal_id: input.proposal_id,
        tenant_id: input.tenant_id,
        policy_key: input.policy_key,
        policy_version: input.policy_version,
        resource_uri: input.resource_uri,
        policy_sha256: input.policy_sha256,
        invalidation_event_id: input.invalidation_event_id,
        idempotency_key: input.idempotency_key,
        status: "activation_pending",
        rollback_id: null,
        secrets_included: false,
      };
      state.activations.set(activation.activation_id, activation);
      state.policies.set(
        policyIdentity(input.tenant_id, input.policy_key, input.policy_version, input.resource_uri),
        {
          tenant_id: input.tenant_id,
          policy_key: input.policy_key,
          policy_version: input.policy_version,
          resource_uri: input.resource_uri,
          policy_sha256: input.policy_sha256,
          policy_json: clone(input.compiled_policy),
          proposal_id: input.proposal_id,
          status: "activation_pending",
        },
      );
      state.invalidations.set(input.invalidation_event_id, {
        event_id: input.invalidation_event_id,
        critical: true,
        delivery_status: "pending",
      });
      state.proposals.get(input.proposal_id).status = "activation_pending";
      return clone(activation);
    },
    async readActivationForUpdate(_tx, activationId) {
      return clone(state.activations.get(activationId));
    },
    async readInvalidationEvent(_tx, eventId) {
      return clone(state.invalidations.get(eventId));
    },
    async finalizePolicyActivation(_tx, input) {
      const activation = state.activations.get(input.activation_id);
      activation.status = "active";
      const identity = policyIdentity(
        activation.tenant_id,
        activation.policy_key,
        activation.policy_version,
        activation.resource_uri,
      );
      const target = state.policies.get(identity);
      for (const policy of state.policies.values()) {
        if (
          policy.tenant_id === activation.tenant_id
          && policy.policy_key === activation.policy_key
          && policy.resource_uri === activation.resource_uri
          && policy.status === "active"
          && policy.policy_version !== activation.policy_version
        ) policy.status = "superseded";
      }
      target.status = "active";
      active.set(activeIdentity(activation.tenant_id, activation.policy_key, activation.resource_uri), target);
      state.invalidations.get(activation.invalidation_event_id).delivery_status = "published";
      state.proposals.get(activation.proposal_id).status = "active";
      return clone(activation);
    },
    async markActivationFailed(_tx, input) {
      const activation = state.activations.get(input.activation_id);
      if (activation) activation.status = "failed";
      state.failedActivations.push(clone(input));
      return clone(activation);
    },
    async readActivePolicyVersion(input) {
      const result = clone(active.get(activeIdentity(input.tenant_id, input.policy_key, input.resource_uri)));
      if (result && state.mismatchReadback) result.policy_version = "drifted-version";
      return result;
    },
    async readPolicyVersion(input) {
      return clone(state.policies.get(policyIdentity(
        input.tenant_id,
        input.policy_key,
        input.policy_version,
        input.resource_uri,
      )));
    },
    async preparePolicyRollback(_tx, input) {
      const target = state.policies.get(policyIdentity(
        input.tenant_id,
        input.policy_key,
        input.target_version,
        input.resource_uri,
      ));
      const activation = {
        activation_id: `activation-rollback-${input.rollback_id}`,
        proposal_id: input.approved_proposal_id,
        tenant_id: input.tenant_id,
        policy_key: input.policy_key,
        policy_version: input.target_version,
        resource_uri: input.resource_uri,
        policy_sha256: target.policy_sha256,
        invalidation_event_id: input.invalidation_event_id,
        idempotency_key: input.idempotency_key,
        status: "activation_pending",
        rollback_id: input.rollback_id,
        secrets_included: false,
      };
      state.activations.set(activation.activation_id, activation);
      state.invalidations.set(input.invalidation_event_id, {
        event_id: input.invalidation_event_id,
        critical: true,
        delivery_status: "pending",
      });
      return {
        rollback_id: input.rollback_id,
        activation_id: activation.activation_id,
        invalidation_event_id: input.invalidation_event_id,
        policy_sha256: target.policy_sha256,
        secrets_included: false,
      };
    },
  };
  return repository;
}

function compilationAndProposal({ version = "v1", policyHash = POLICY_HASH_V1 } = {}) {
  const compilation = {
    compilation_id: `compilation-${version}`,
    session_id: "session-001",
    policy_type: "deployment_evidence_exposure_policy",
    proposed_version: version,
    compiled_policy: {
      policy_type: "deployment_evidence_exposure_policy",
      policy_payload_sha256: policyHash,
      secrets_included: false,
    },
    compiled_policy_sha256: policyHash,
    safety_bounds_sha256: "e".repeat(64),
    compilation_sha256: COMPILATION_HASH,
    secrets_included: false,
  };
  const proposal = {
    proposal_id: `proposal-${version}`,
    compilation_id: compilation.compilation_id,
    tenant_id: TENANT,
    policy_type: compilation.policy_type,
    proposed_version: version,
    resource_uri: RESOURCE,
    status: "submitted",
    risk_tier: "high",
    required_approval_class: "platform_admin_approval",
    typed_confirmation_required: true,
    proposal_hash_sha256: PROPOSAL_HASH,
    created_by: "platform-admin-001",
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    secrets_included: false,
  };
  return { compilation, proposal };
}

const repository = createMemoryRepository();
const publishedEvents = [];
const publisher = {
  async publish(event) {
    publishedEvents.push(clone(event));
    return { accepted: true, event_id: event.event_id, revision: publishedEvents.length };
  },
};
const lifecycle = createGovernedPolicyLifecycleService({
  repository,
  invalidationPublisher: publisher,
  clock: () => new Date(NOW),
});
assert.ok(Object.isFrozen(lifecycle));
assert.equal(governedPolicyLifecycleContract.rollback_exact_proposal_and_approval_required, true);
assert.equal(governedPolicyLifecycleContract.approval_expiry_uses_injected_clock, true);

const { compilation, proposal } = compilationAndProposal();
const persisted = await lifecycle.persistCompiledProposal({
  compilation,
  proposal,
  answersEvidence: { normalized_answers_sha256: "f".repeat(64), secrets_included: false },
  idempotencyKey: "proposal-idempotency-v1",
});
assert.equal(persisted.runtime_authority_activated, false);
assert.equal(repository.state.proposals.get(proposal.proposal_id).status, "submitted");

const approval = await lifecycle.approveProposal({
  proposalId: proposal.proposal_id,
  tenantId: TENANT,
  resourceUri: RESOURCE,
  proposalHashSha256: PROPOSAL_HASH,
  approvalClass: "platform_admin_approval",
  approvedBy: "platform-admin-001",
  typedConfirmation: "CONFIRM POLICY ACTIVATION",
  expiresAt: FUTURE,
  idempotencyKey: "approval-idempotency-v1",
});
assert.equal(approval.typed_confirmation_present, true);
assert.equal(repository.state.plaintextConfirmationObserved, false);
assert.match(repository.state.approvals.get(proposal.proposal_id).typed_confirmation_hash, /^[a-f0-9]{64}$/);

const activated = await lifecycle.activateProposal({
  proposalId: proposal.proposal_id,
  tenantId: TENANT,
  policyKey: POLICY_KEY,
  policyVersion: "v1",
  resourceUri: RESOURCE,
  proposalHashSha256: PROPOSAL_HASH,
  idempotencyKey: "activation-idempotency-v1",
  effectiveAt: NOW,
});
assert.equal(activated.authority_activated, true);
assert.equal(activated.registry_readback.policy_version, "v1");
assert.equal(publishedEvents[0].critical, true);
assert.equal(publishedEvents[0].event_type, "governed_policy_version_activated");

const failingRepository = createMemoryRepository();
const failingLifecycle = createGovernedPolicyLifecycleService({
  repository: failingRepository,
  invalidationPublisher: { async publish() { return { accepted: false }; } },
  clock: () => new Date(NOW),
});
const failingData = compilationAndProposal();
await failingLifecycle.persistCompiledProposal({
  ...failingData,
  answersEvidence: {},
  idempotencyKey: "failure-proposal",
});
await failingLifecycle.approveProposal({
  proposalId: failingData.proposal.proposal_id,
  tenantId: TENANT,
  resourceUri: RESOURCE,
  proposalHashSha256: PROPOSAL_HASH,
  approvalClass: "platform_admin_approval",
  approvedBy: "platform-admin-001",
  typedConfirmation: "CONFIRM POLICY ACTIVATION",
  expiresAt: FUTURE,
  idempotencyKey: "failure-approval",
});
await assert.rejects(
  failingLifecycle.activateProposal({
    proposalId: failingData.proposal.proposal_id,
    tenantId: TENANT,
    policyKey: POLICY_KEY,
    policyVersion: "v1",
    resourceUri: RESOURCE,
    proposalHashSha256: PROPOSAL_HASH,
    idempotencyKey: "failure-activation",
  }),
  (error) => error instanceof GovernedPolicyError
    && error.code === "governed_policy_activation_invalidation_failed"
    && error.status === 503,
);
assert.equal(failingRepository.state.failedActivations.length, 1);
assert.equal([...failingRepository.state.activations.values()][0].status, "failed");

const mismatchRepository = createMemoryRepository();
const mismatchLifecycle = createGovernedPolicyLifecycleService({
  repository: mismatchRepository,
  invalidationPublisher: publisher,
  clock: () => new Date(NOW),
});
const mismatchData = compilationAndProposal();
await mismatchLifecycle.persistCompiledProposal({ ...mismatchData, answersEvidence: {}, idempotencyKey: "mismatch-proposal" });
await mismatchLifecycle.approveProposal({
  proposalId: mismatchData.proposal.proposal_id,
  tenantId: TENANT,
  resourceUri: RESOURCE,
  proposalHashSha256: PROPOSAL_HASH,
  approvalClass: "platform_admin_approval",
  approvedBy: "platform-admin-001",
  typedConfirmation: "CONFIRM POLICY ACTIVATION",
  expiresAt: FUTURE,
  idempotencyKey: "mismatch-approval",
});
mismatchRepository.state.mismatchReadback = true;
await assert.rejects(
  mismatchLifecycle.activateProposal({
    proposalId: mismatchData.proposal.proposal_id,
    tenantId: TENANT,
    policyKey: POLICY_KEY,
    policyVersion: "v1",
    resourceUri: RESOURCE,
    proposalHashSha256: PROPOSAL_HASH,
    idempotencyKey: "mismatch-activation",
  }),
  (error) => error instanceof GovernedPolicyError && error.code === "governed_policy_registry_readback_mismatch",
);

repository.state.policies.set(`${TENANT}|${POLICY_KEY}|v0|${RESOURCE}`, {
  tenant_id: TENANT,
  policy_key: POLICY_KEY,
  policy_version: "v0",
  resource_uri: RESOURCE,
  policy_sha256: POLICY_HASH_V0,
  policy_json: { policy_type: "deployment_evidence_exposure_policy", secrets_included: false },
  proposal_id: proposal.proposal_id,
  status: "superseded",
});
repository.state.proposals.get(proposal.proposal_id).status = "active";
const rollback = await lifecycle.rollbackPolicy({
  tenantId: TENANT,
  policyKey: POLICY_KEY,
  activeVersion: "v1",
  targetVersion: "v0",
  resourceUri: RESOURCE,
  approvedProposalId: proposal.proposal_id,
  proposalHashSha256: PROPOSAL_HASH,
  idempotencyKey: "rollback-idempotency-v0",
});
assert.equal(rollback.authority_activated, true);
assert.equal(rollback.to_version, "v0");
assert.equal(rollback.registry_readback.policy_sha256, POLICY_HASH_V0);
assert.equal(publishedEvents.at(-1).event_type, "governed_policy_version_rollback");

const driftedProposal = repository.state.proposals.get(proposal.proposal_id);
driftedProposal.proposal_hash_sha256 = "9".repeat(64);
await assert.rejects(
  lifecycle.rollbackPolicy({
    tenantId: TENANT,
    policyKey: POLICY_KEY,
    activeVersion: "v0",
    targetVersion: "v1",
    resourceUri: RESOURCE,
    approvedProposalId: proposal.proposal_id,
    proposalHashSha256: PROPOSAL_HASH,
    idempotencyKey: "rollback-drifted",
  }),
  (error) => error instanceof GovernedPolicyError && error.code === "governed_policy_proposal_binding_mismatch",
);

assert.match(stableGovernedPolicySha256({ lifecycle: "complete" }), /^[a-f0-9]{64}$/);
console.log("governed policy application lifecycle tests passed");
