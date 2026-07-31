import { createHash, randomUUID } from "node:crypto";
import {
  GovernedPolicyError,
  stableGovernedPolicySha256,
} from "../../domain/governedPolicy/governedPolicyQuestionnaireEngine.js";

const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/;
const KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

function fail(code, message, status = 409, details = {}) {
  throw new GovernedPolicyError(code, message, status, details);
}

function identifier(value, field) {
  const normalized = String(value ?? "").trim();
  if (!OPAQUE_ID_RE.test(normalized)) fail("governed_policy_lifecycle_invalid_identifier", `${field} must be a bounded opaque identifier.`, 422, { field });
  return normalized;
}

function canonical(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!KEY_RE.test(normalized)) fail("governed_policy_lifecycle_invalid_key", `${field} must be a canonical key.`, 422, { field });
  return normalized;
}

function version(value, field) {
  const normalized = String(value ?? "").trim();
  if (!VERSION_RE.test(normalized)) fail("governed_policy_lifecycle_invalid_version", `${field} must be an explicit bounded version.`, 422, { field });
  return normalized;
}

function sha256(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA256_RE.test(normalized)) fail("governed_policy_lifecycle_invalid_sha256", `${field} must be SHA-256.`, 422, { field });
  return normalized;
}

function instant(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) fail("governed_policy_lifecycle_invalid_instant", `${field} must be a valid instant.`, 422, { field });
  return date;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return Object.freeze(value);
}

function idempotencyKey(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 191) fail("governed_policy_idempotency_key_required", "A bounded idempotency key is required.", 422);
  return normalized;
}

function resourceUri(value, field = "resourceUri") {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 2048) fail("governed_policy_resource_invalid", `${field} must be a bounded URI.`, 422, { field });
  try {
    const parsed = new URL(normalized);
    if (!new Set(["https:", "urn:"]).has(parsed.protocol)) throw new Error("unsupported");
  } catch {
    fail("governed_policy_resource_invalid", `${field} must be an absolute https or urn URI.`, 422, { field });
  }
  return normalized;
}

function typedConfirmationHash(value) {
  if (value == null) return null;
  const normalized = String(value).normalize("NFKC").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > 1024) fail("governed_policy_typed_confirmation_invalid", "Typed confirmation is empty or oversized.", 422);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function assertRepository(repository) {
  const methods = [
    "withTransaction", "persistCompiledProposal", "readProposalForUpdate",
    "readApprovalForProposal", "appendApproval", "preparePolicyActivation",
    "readActivationForUpdate", "finalizePolicyActivation", "markActivationFailed",
    "readActivePolicyVersion", "readPolicyVersion", "preparePolicyRollback",
    "readInvalidationEvent",
  ];
  for (const method of methods) {
    if (!repository || typeof repository[method] !== "function") fail("governed_policy_repository_invalid", `repository.${method} is required.`, 500, { method });
  }
}

function assertPublisher(publisher) {
  if (!publisher || typeof publisher.publish !== "function") fail("governed_policy_invalidation_publisher_required", "invalidationPublisher.publish is required.", 500);
}

function proposalExpected(proposalId, tenantId, resource, proposalHash, policyVersion = null) {
  return {
    proposal_id: identifier(proposalId, "proposalId"),
    tenant_id: identifier(tenantId, "tenantId"),
    resource_uri: resourceUri(resource),
    proposal_hash_sha256: sha256(proposalHash, "proposalHashSha256"),
    proposed_version: policyVersion == null ? null : version(policyVersion, "policyVersion"),
  };
}

function assertProposalBinding(proposal, expected, { requireVersion = true } = {}) {
  if (!proposal) fail("governed_policy_proposal_not_found", "Proposal was not found.", 404);
  const fields = ["proposal_id", "tenant_id", "resource_uri", "proposal_hash_sha256"];
  if (requireVersion && expected.proposed_version != null) fields.push("proposed_version");
  const mismatches = fields.filter((field) => String(proposal[field] ?? "") !== String(expected[field] ?? ""));
  if (mismatches.length > 0) fail("governed_policy_proposal_binding_mismatch", "Proposal binding drifted from the requested operation.", 409, { mismatch_fields: mismatches });
}

function assertApprovalBinding(approval, proposal, now) {
  if (!approval) fail("governed_policy_approval_missing", "An active exact-bound approval is required.", 409);
  const expected = {
    proposal_id: proposal.proposal_id,
    tenant_id: proposal.tenant_id,
    resource_uri: proposal.resource_uri,
    proposal_hash_sha256: proposal.proposal_hash_sha256,
    approval_class: proposal.required_approval_class,
  };
  const mismatches = Object.entries(expected)
    .filter(([field, value]) => String(approval[field] ?? "") !== String(value ?? ""))
    .map(([field]) => field);
  if (mismatches.length > 0) fail("governed_policy_approval_binding_mismatch", "Approval is not bound to the exact proposal/resource/version.", 409, { mismatch_fields: mismatches });
  if (approval.decision !== "approved") fail("governed_policy_approval_not_approved", "The exact proposal approval is not approved.", 409, { decision: approval.decision ?? "unknown" });
  const expiresAt = new Date(approval.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) fail("governed_policy_approval_expired", "The exact proposal approval has expired.", 409);
  if (proposal.typed_confirmation_required && !SHA256_RE.test(String(approval.typed_confirmation_hash ?? ""))) fail("governed_policy_typed_confirmation_missing", "A typed confirmation bound to this proposal is required.", 409);
}

function assertRegistryReadback(readback, expected) {
  if (!readback) fail("governed_policy_registry_readback_missing", "Authoritative policy registry readback is missing.", 409);
  const fields = ["tenant_id", "policy_key", "policy_version", "resource_uri", "policy_sha256", "status"];
  const mismatches = fields.filter((field) => String(readback[field] ?? "") !== String(expected[field] ?? ""));
  if (mismatches.length > 0) fail("governed_policy_registry_readback_mismatch", "Authoritative registry readback does not match the exact policy version.", 409, { mismatch_fields: mismatches });
}

export function createGovernedPolicyLifecycleService({ repository, invalidationPublisher, clock = () => new Date() } = {}) {
  assertRepository(repository);
  assertPublisher(invalidationPublisher);
  const currentTime = () => instant(clock(), "clock");

  async function persistCompiledProposal({ compilation, proposal, answersEvidence, idempotencyKey } = {}) {
    if (!compilation || !proposal || proposal.compilation_id !== compilation.compilation_id) fail("governed_policy_proposal_compilation_mismatch", "Proposal and compilation identities do not match.", 409);
    sha256(compilation.compilation_sha256, "compilation.compilation_sha256");
    sha256(compilation.compiled_policy_sha256, "compilation.compiled_policy_sha256");
    const expected = proposalExpected(proposal.proposal_id, proposal.tenant_id, proposal.resource_uri, proposal.proposal_hash_sha256, proposal.proposed_version);
    const persisted = await repository.withTransaction((transaction) => repository.persistCompiledProposal(transaction, {
      compilation,
      proposal,
      answers_evidence: answersEvidence,
      idempotency_key: idempotencyKey(idempotencyKey),
    }));
    assertProposalBinding(persisted.proposal, expected);
    return deepFreeze({
      ok: true,
      idempotent_replay: persisted.idempotent_replay === true,
      compilation_id: compilation.compilation_id,
      proposal_id: proposal.proposal_id,
      proposal_hash_sha256: proposal.proposal_hash_sha256,
      runtime_authority_activated: false,
      secrets_included: false,
    });
  }

  async function approveProposal({ proposalId, tenantId, resourceUri: resource, proposalHashSha256, approvalClass, approvedBy, typedConfirmation = null, expiresAt, idempotencyKey: key } = {}) {
    const expected = proposalExpected(proposalId, tenantId, resource, proposalHashSha256);
    const approvalClassKey = canonical(approvalClass, "approvalClass");
    const actor = identifier(approvedBy, "approvedBy");
    const confirmationHash = typedConfirmationHash(typedConfirmation);
    const expiry = instant(expiresAt, "expiresAt");
    const now = currentTime();
    if (expiry.getTime() <= now.getTime()) fail("governed_policy_approval_expiry_invalid", "Approval expiry must be in the future.", 422);
    return repository.withTransaction(async (transaction) => {
      const proposal = await repository.readProposalForUpdate(transaction, expected.proposal_id);
      assertProposalBinding(proposal, expected, { requireVersion: false });
      if (proposal.required_approval_class !== approvalClassKey) fail("governed_policy_approval_class_mismatch", "Approval class does not match the compiled requirement.", 409);
      if (proposal.typed_confirmation_required && !confirmationHash) fail("governed_policy_typed_confirmation_missing", "This proposal requires typed confirmation.", 409);
      if (!new Set(["submitted", "approved"]).has(proposal.status)) fail("governed_policy_proposal_not_approvable", "Proposal is not approvable.", 409, { status: proposal.status });
      const approval = await repository.appendApproval(transaction, {
        approval_id: randomUUID(), proposal_id: proposal.proposal_id, tenant_id: proposal.tenant_id,
        resource_uri: proposal.resource_uri, proposal_hash_sha256: proposal.proposal_hash_sha256,
        approval_class: approvalClassKey, decision: "approved", approved_by: actor,
        typed_confirmation_hash: confirmationHash, created_at: now.toISOString(),
        expires_at: expiry.toISOString(), idempotency_key: idempotencyKey(key), secrets_included: false,
      });
      assertApprovalBinding(approval, proposal, now);
      return deepFreeze({
        ok: true, approval_id: approval.approval_id, proposal_id: proposal.proposal_id,
        proposal_hash_sha256: proposal.proposal_hash_sha256, decision: "approved",
        typed_confirmation_present: Boolean(confirmationHash), authority_activated: false,
        secrets_included: false,
      });
    });
  }

  async function publishInvalidation(event, activationId, failurePrefix) {
    try {
      const evidence = await invalidationPublisher.publish(event);
      if (!evidence || evidence.accepted !== true) throw new Error("invalidation_not_accepted");
      return evidence;
    } catch (error) {
      await repository.withTransaction((transaction) => repository.markActivationFailed(transaction, {
        activation_id: activationId,
        failure_code: `${failurePrefix}_invalidation_failed`,
        failure_message: String(error?.message ?? error).slice(0, 1000),
      }));
      fail(`${failurePrefix}_invalidation_failed`, "Critical policy invalidation failed; runtime authority was not activated.", 503, { activation_id: activationId });
    }
  }

  async function finalizeAndReadback(prepared, expected, publishedEvidence, rollbackId = null) {
    await repository.withTransaction(async (transaction) => {
      const activation = await repository.readActivationForUpdate(transaction, prepared.activation_id);
      if (!activation) fail("governed_policy_activation_missing", "Prepared activation was not found.", 409);
      if (activation.status !== "active" && activation.status !== "activation_pending") fail("governed_policy_activation_not_finalizable", "Prepared activation is not finalizable.", 409, { status: activation.status });
      if (activation.status === "active") return;
      const invalidation = await repository.readInvalidationEvent(transaction, prepared.invalidation_event_id);
      if (!invalidation || invalidation.event_id !== prepared.invalidation_event_id || invalidation.critical !== true) fail("governed_policy_invalidation_readback_missing", "Critical invalidation event readback is missing.", 409);
      await repository.finalizePolicyActivation(transaction, {
        activation_id: prepared.activation_id,
        invalidation_evidence_sha256: stableGovernedPolicySha256(publishedEvidence),
        activated_at: currentTime().toISOString(),
        rollback_id: rollbackId,
      });
    });
    const readback = await repository.readActivePolicyVersion({
      tenant_id: expected.tenant_id,
      policy_key: expected.policy_key,
      resource_uri: expected.resource_uri,
    });
    assertRegistryReadback(readback, {
      tenant_id: expected.tenant_id, policy_key: expected.policy_key,
      policy_version: expected.policy_version, resource_uri: expected.resource_uri,
      policy_sha256: expected.policy_sha256, status: "active",
    });
    return readback;
  }

  async function activateProposal({ proposalId, tenantId, policyKey, policyVersion, resourceUri: resource, proposalHashSha256, idempotencyKey: key, effectiveAt = clock() } = {}) {
    const expectedProposal = proposalExpected(proposalId, tenantId, resource, proposalHashSha256, policyVersion);
    const policyKeyValue = canonical(policyKey, "policyKey");
    const prepared = await repository.withTransaction(async (transaction) => {
      const proposal = await repository.readProposalForUpdate(transaction, expectedProposal.proposal_id);
      assertProposalBinding(proposal, expectedProposal);
      const approval = await repository.readApprovalForProposal(transaction, proposal.proposal_id);
      assertApprovalBinding(approval, proposal, currentTime());
      if (!new Set(["approved", "activation_pending"]).has(proposal.status)) fail("governed_policy_proposal_not_activatable", "Proposal is not approved for activation.", 409, { status: proposal.status });
      return repository.preparePolicyActivation(transaction, {
        activation_id: randomUUID(), proposal_id: proposal.proposal_id,
        tenant_id: proposal.tenant_id, policy_key: policyKeyValue,
        policy_version: proposal.proposed_version, resource_uri: proposal.resource_uri,
        proposal_hash_sha256: proposal.proposal_hash_sha256,
        policy_sha256: sha256(proposal.compiled_policy_sha256, "proposal.compiled_policy_sha256"),
        compiled_policy: proposal.compiled_policy,
        effective_at: instant(effectiveAt, "effectiveAt").toISOString(),
        idempotency_key: idempotencyKey(key), invalidation_event_id: randomUUID(),
        status: "activation_pending", secrets_included: false,
      });
    });
    const event = {
      event_id: prepared.invalidation_event_id,
      event_type: "governed_policy_version_activated",
      tenant_id: prepared.tenant_id, policy_key: prepared.policy_key,
      policy_version: prepared.policy_version, resource_uri: prepared.resource_uri,
      policy_sha256: prepared.policy_sha256, critical: true,
      created_at: currentTime().toISOString(), secrets_included: false,
    };
    const published = await publishInvalidation(event, prepared.activation_id, "governed_policy_activation");
    const readback = await finalizeAndReadback(prepared, {
      tenant_id: prepared.tenant_id, policy_key: prepared.policy_key,
      policy_version: prepared.policy_version, resource_uri: prepared.resource_uri,
      policy_sha256: prepared.policy_sha256,
    }, published);
    return deepFreeze({
      ok: true, activation_id: prepared.activation_id, proposal_id: prepared.proposal_id,
      tenant_id: prepared.tenant_id, policy_key: prepared.policy_key,
      policy_version: prepared.policy_version, resource_uri: prepared.resource_uri,
      policy_sha256: prepared.policy_sha256, registry_readback: readback,
      invalidation_accepted: true, authority_activated: true, secrets_included: false,
    });
  }

  async function rollbackPolicy({ tenantId, policyKey, activeVersion, targetVersion, resourceUri: resource, approvedProposalId, proposalHashSha256, idempotencyKey: key } = {}) {
    const tenant = identifier(tenantId, "tenantId");
    const policyKeyValue = canonical(policyKey, "policyKey");
    const active = version(activeVersion, "activeVersion");
    const target = version(targetVersion, "targetVersion");
    const expectedProposal = proposalExpected(approvedProposalId, tenant, resource, proposalHashSha256);
    if (active === target) fail("governed_policy_rollback_target_invalid", "Rollback target must differ from the active version.", 422);
    const targetPolicy = await repository.readPolicyVersion({
      tenant_id: tenant, policy_key: policyKeyValue, policy_version: target,
      resource_uri: expectedProposal.resource_uri,
    });
    if (!targetPolicy || !new Set(["superseded", "active"]).has(targetPolicy.status)) fail("governed_policy_rollback_target_unavailable", "Rollback target is not a previously valid policy version.", 409);
    const prepared = await repository.withTransaction(async (transaction) => {
      const proposal = await repository.readProposalForUpdate(transaction, expectedProposal.proposal_id);
      assertProposalBinding(proposal, expectedProposal, { requireVersion: false });
      const approval = await repository.readApprovalForProposal(transaction, proposal.proposal_id);
      assertApprovalBinding(approval, proposal, currentTime());
      if (!new Set(["approved", "active", "superseded"]).has(proposal.status)) fail("governed_policy_rollback_proposal_not_authorized", "Rollback proposal is not in an authorized state.", 409, { status: proposal.status });
      return repository.preparePolicyRollback(transaction, {
        rollback_id: randomUUID(), tenant_id: tenant, policy_key: policyKeyValue,
        active_version: active, target_version: target,
        resource_uri: expectedProposal.resource_uri,
        approved_proposal_id: proposal.proposal_id,
        proposal_hash_sha256: proposal.proposal_hash_sha256,
        idempotency_key: idempotencyKey(key), invalidation_event_id: randomUUID(),
        created_at: currentTime().toISOString(), secrets_included: false,
      });
    });
    const event = {
      event_id: prepared.invalidation_event_id,
      event_type: "governed_policy_version_rollback",
      tenant_id: tenant, policy_key: policyKeyValue,
      policy_version: target, previous_policy_version: active,
      resource_uri: expectedProposal.resource_uri,
      policy_sha256: targetPolicy.policy_sha256, critical: true,
      created_at: currentTime().toISOString(), secrets_included: false,
    };
    const published = await publishInvalidation(event, prepared.activation_id, "governed_policy_rollback");
    const readback = await finalizeAndReadback(prepared, {
      tenant_id: tenant, policy_key: policyKeyValue, policy_version: target,
      resource_uri: expectedProposal.resource_uri, policy_sha256: targetPolicy.policy_sha256,
    }, published, prepared.rollback_id);
    return deepFreeze({
      ok: true, rollback_id: prepared.rollback_id, policy_key: policyKeyValue,
      from_version: active, to_version: target, registry_readback: readback,
      authority_activated: true, secrets_included: false,
    });
  }

  return Object.freeze({ persistCompiledProposal, approveProposal, activateProposal, rollbackPolicy });
}

export const governedPolicyLifecycleContract = deepFreeze({
  version: "governed-policy-lifecycle-service-v2",
  proposal_resource_version_exact_binding_required: true,
  approval_invalidated_by_proposal_drift: true,
  rollback_exact_proposal_and_approval_required: true,
  approval_expiry_uses_injected_clock: true,
  typed_confirmation_plaintext_persisted: false,
  activation_prepare_before_invalidation: true,
  invalidation_failure_reports_active: false,
  exact_registry_version_readback_required: true,
  rollback_is_new_governed_operation: true,
  idempotency_required: true,
  provider_dispatch_performed: false,
  secrets_included: false,
});
