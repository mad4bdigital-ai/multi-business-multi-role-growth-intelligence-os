import { createHash, randomUUID } from "node:crypto";
import {
  GovernedPolicyError,
  stableGovernedPolicySha256,
} from "../../domain/governedPolicy/governedPolicyQuestionnaireEngine.js";

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/;
const KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA_RE = /^[a-f0-9]{64}$/;

function fail(code, message, status = 409, details = {}) {
  throw new GovernedPolicyError(code, message, status, details);
}
function identifier(value, field) {
  const result = String(value ?? "").trim();
  if (!ID_RE.test(result)) fail("governed_policy_lifecycle_invalid_identifier", `${field} must be a bounded opaque identifier.`, 422, { field });
  return result;
}
function canonical(value, field) {
  const result = String(value ?? "").trim().toLowerCase();
  if (!KEY_RE.test(result)) fail("governed_policy_lifecycle_invalid_key", `${field} must be a canonical key.`, 422, { field });
  return result;
}
function explicitVersion(value, field) {
  const result = String(value ?? "").trim();
  if (!VERSION_RE.test(result)) fail("governed_policy_lifecycle_invalid_version", `${field} must be an explicit bounded version.`, 422, { field });
  return result;
}
function sha256(value, field) {
  const result = String(value ?? "").trim().toLowerCase();
  if (!SHA_RE.test(result)) fail("governed_policy_lifecycle_invalid_sha256", `${field} must be SHA-256.`, 422, { field });
  return result;
}
function instant(value, field) {
  const result = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(result.getTime())) fail("governed_policy_lifecycle_invalid_instant", `${field} must be a valid instant.`, 422, { field });
  return result;
}
function normalizeIdempotencyKey(value) {
  const result = String(value ?? "").trim();
  if (!result || result.length > 191) fail("governed_policy_idempotency_key_required", "A bounded idempotency key is required.", 422);
  return result;
}
function resourceUri(value) {
  const result = String(value ?? "").trim();
  if (!result || result.length > 2048) fail("governed_policy_resource_invalid", "resourceUri must be bounded.", 422);
  try {
    const parsed = new URL(result);
    if (!new Set(["https:", "urn:"]).has(parsed.protocol)) throw new Error("unsupported");
  } catch {
    fail("governed_policy_resource_invalid", "resourceUri must be an absolute https or urn URI.", 422);
  }
  return result;
}
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach((nested) => freeze(nested));
    Object.freeze(value);
  }
  return value;
}
function confirmationHash(value) {
  if (value == null) return null;
  const normalized = String(value).normalize("NFKC").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > 1024) fail("governed_policy_typed_confirmation_invalid", "Typed confirmation is empty or oversized.", 422);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
function assertDependencies(repository, publisher) {
  const methods = [
    "withTransaction", "persistCompiledProposal", "readProposalForUpdate",
    "readApprovalForProposal", "appendApproval", "preparePolicyActivation",
    "readActivationForUpdate", "finalizePolicyActivation", "markActivationFailed",
    "readActivePolicyVersion", "readPolicyVersion", "preparePolicyRollback",
    "readInvalidationEvent",
  ];
  for (const method of methods) if (!repository || typeof repository[method] !== "function") fail("governed_policy_repository_invalid", `repository.${method} is required.`, 500, { method });
  if (!publisher || typeof publisher.publish !== "function") fail("governed_policy_invalidation_publisher_required", "invalidationPublisher.publish is required.", 500);
}
function expectedProposal({ proposalId, tenantId, resource, proposalHash, policyVersion = null }) {
  return {
    proposal_id: identifier(proposalId, "proposalId"),
    tenant_id: identifier(tenantId, "tenantId"),
    resource_uri: resourceUri(resource),
    proposal_hash_sha256: sha256(proposalHash, "proposalHashSha256"),
    proposed_version: policyVersion == null ? null : explicitVersion(policyVersion, "policyVersion"),
  };
}
function assertProposal(proposal, expected, requireVersion = true) {
  if (!proposal) fail("governed_policy_proposal_not_found", "Proposal was not found.", 404);
  const fields = ["proposal_id", "tenant_id", "resource_uri", "proposal_hash_sha256"];
  if (requireVersion && expected.proposed_version != null) fields.push("proposed_version");
  const mismatch = fields.filter((field) => String(proposal[field] ?? "") !== String(expected[field] ?? ""));
  if (mismatch.length) fail("governed_policy_proposal_binding_mismatch", "Proposal binding drifted.", 409, { mismatch_fields: mismatch });
}
function assertApproval(approval, proposal, now) {
  if (!approval) fail("governed_policy_approval_missing", "An exact-bound approval is required.", 409);
  const expected = {
    proposal_id: proposal.proposal_id,
    tenant_id: proposal.tenant_id,
    resource_uri: proposal.resource_uri,
    proposal_hash_sha256: proposal.proposal_hash_sha256,
    approval_class: proposal.required_approval_class,
  };
  const mismatch = Object.entries(expected).filter(([field, value]) => String(approval[field] ?? "") !== String(value)).map(([field]) => field);
  if (mismatch.length) fail("governed_policy_approval_binding_mismatch", "Approval binding drifted.", 409, { mismatch_fields: mismatch });
  if (approval.decision !== "approved") fail("governed_policy_approval_not_approved", "Approval is not approved.", 409);
  const expiry = new Date(approval.expires_at);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= now.getTime()) fail("governed_policy_approval_expired", "Approval expired.", 409);
  if (proposal.typed_confirmation_required && !SHA_RE.test(String(approval.typed_confirmation_hash ?? ""))) fail("governed_policy_typed_confirmation_missing", "Typed confirmation is required.", 409);
}
function assertReadback(readback, expected) {
  if (!readback) fail("governed_policy_registry_readback_missing", "Registry readback is missing.", 409);
  const fields = ["tenant_id", "policy_key", "policy_version", "resource_uri", "policy_sha256", "status"];
  const mismatch = fields.filter((field) => String(readback[field] ?? "") !== String(expected[field] ?? ""));
  if (mismatch.length) fail("governed_policy_registry_readback_mismatch", "Registry readback differs from the exact activation.", 409, { mismatch_fields: mismatch });
}

export function createGovernedPolicyLifecycleService({ repository, invalidationPublisher, clock = () => new Date() } = {}) {
  assertDependencies(repository, invalidationPublisher);
  const now = () => instant(clock(), "clock");

  async function persistCompiledProposal({ compilation, proposal, answersEvidence, idempotencyKey: rawIdempotencyKey } = {}) {
    if (!compilation || !proposal || proposal.compilation_id !== compilation.compilation_id) fail("governed_policy_proposal_compilation_mismatch", "Proposal and compilation identities differ.", 409);
    sha256(compilation.compilation_sha256, "compilation.compilation_sha256");
    sha256(compilation.compiled_policy_sha256, "compilation.compiled_policy_sha256");
    const expected = expectedProposal({ proposalId: proposal.proposal_id, tenantId: proposal.tenant_id, resource: proposal.resource_uri, proposalHash: proposal.proposal_hash_sha256, policyVersion: proposal.proposed_version });
    const persisted = await repository.withTransaction((tx) => repository.persistCompiledProposal(tx, {
      compilation,
      proposal,
      answers_evidence: answersEvidence,
      idempotency_key: normalizeIdempotencyKey(rawIdempotencyKey),
    }));
    assertProposal(persisted.proposal, expected);
    return freeze({ ok: true, idempotent_replay: persisted.idempotent_replay === true, compilation_id: compilation.compilation_id, proposal_id: proposal.proposal_id, proposal_hash_sha256: proposal.proposal_hash_sha256, runtime_authority_activated: false, secrets_included: false });
  }

  async function approveProposal({ proposalId, tenantId, resourceUri: resource, proposalHashSha256, approvalClass, approvedBy, typedConfirmation = null, expiresAt, idempotencyKey: rawIdempotencyKey } = {}) {
    const expected = expectedProposal({ proposalId, tenantId, resource, proposalHash: proposalHashSha256 });
    const expiry = instant(expiresAt, "expiresAt");
    const current = now();
    if (expiry.getTime() <= current.getTime()) fail("governed_policy_approval_expiry_invalid", "Approval expiry must be future.", 422);
    return repository.withTransaction(async (tx) => {
      const proposal = await repository.readProposalForUpdate(tx, expected.proposal_id);
      assertProposal(proposal, expected, false);
      const approvalClassKey = canonical(approvalClass, "approvalClass");
      if (proposal.required_approval_class !== approvalClassKey) fail("governed_policy_approval_class_mismatch", "Approval class differs from compiled requirement.", 409);
      const typedHash = confirmationHash(typedConfirmation);
      if (proposal.typed_confirmation_required && !typedHash) fail("governed_policy_typed_confirmation_missing", "Typed confirmation is required.", 409);
      if (!new Set(["submitted", "approved"]).has(proposal.status)) fail("governed_policy_proposal_not_approvable", "Proposal is not approvable.", 409, { status: proposal.status });
      const approval = await repository.appendApproval(tx, {
        approval_id: randomUUID(), proposal_id: proposal.proposal_id, tenant_id: proposal.tenant_id,
        resource_uri: proposal.resource_uri, proposal_hash_sha256: proposal.proposal_hash_sha256,
        approval_class: approvalClassKey, decision: "approved", approved_by: identifier(approvedBy, "approvedBy"),
        typed_confirmation_hash: typedHash, idempotency_key: normalizeIdempotencyKey(rawIdempotencyKey),
        created_at: current.toISOString(), expires_at: expiry.toISOString(), secrets_included: false,
      });
      assertApproval(approval, proposal, current);
      return freeze({ ok: true, approval_id: approval.approval_id, proposal_id: proposal.proposal_id, proposal_hash_sha256: proposal.proposal_hash_sha256, decision: "approved", typed_confirmation_present: Boolean(typedHash), authority_activated: false, secrets_included: false });
    });
  }

  async function publishOrFail(event, activationId, prefix) {
    try {
      const evidence = await invalidationPublisher.publish(event);
      if (!evidence || evidence.accepted !== true) throw new Error("not_accepted");
      return evidence;
    } catch (error) {
      await repository.withTransaction((tx) => repository.markActivationFailed(tx, { activation_id: activationId, failure_code: `${prefix}_invalidation_failed`, failure_message: String(error?.message ?? error).slice(0, 1000) }));
      fail(`${prefix}_invalidation_failed`, "Critical invalidation failed; runtime authority was not activated.", 503, { activation_id: activationId });
    }
  }

  async function finalize(prepared, expected, evidence, rollbackId = null) {
    await repository.withTransaction(async (tx) => {
      const activation = await repository.readActivationForUpdate(tx, prepared.activation_id);
      if (!activation) fail("governed_policy_activation_missing", "Prepared activation was not found.", 409);
      if (activation.status === "active") return;
      if (activation.status !== "activation_pending") fail("governed_policy_activation_not_finalizable", "Activation is not pending.", 409);
      const invalidation = await repository.readInvalidationEvent(tx, prepared.invalidation_event_id);
      if (!invalidation || invalidation.event_id !== prepared.invalidation_event_id || invalidation.critical !== true) fail("governed_policy_invalidation_readback_missing", "Critical invalidation readback is missing.", 409);
      await repository.finalizePolicyActivation(tx, { activation_id: prepared.activation_id, invalidation_evidence_sha256: stableGovernedPolicySha256(evidence), activated_at: now().toISOString(), rollback_id: rollbackId });
    });
    const readback = await repository.readActivePolicyVersion({ tenant_id: expected.tenant_id, policy_key: expected.policy_key, resource_uri: expected.resource_uri });
    assertReadback(readback, { ...expected, status: "active" });
    return readback;
  }

  async function activateProposal({ proposalId, tenantId, policyKey, policyVersion, resourceUri: resource, proposalHashSha256, idempotencyKey: rawIdempotencyKey, effectiveAt = clock() } = {}) {
    const expected = expectedProposal({ proposalId, tenantId, resource, proposalHash: proposalHashSha256, policyVersion });
    const key = canonical(policyKey, "policyKey");
    const prepared = await repository.withTransaction(async (tx) => {
      const proposal = await repository.readProposalForUpdate(tx, expected.proposal_id);
      assertProposal(proposal, expected);
      assertApproval(await repository.readApprovalForProposal(tx, proposal.proposal_id), proposal, now());
      if (!new Set(["approved", "activation_pending"]).has(proposal.status)) fail("governed_policy_proposal_not_activatable", "Proposal is not activatable.", 409, { status: proposal.status });
      return repository.preparePolicyActivation(tx, {
        activation_id: randomUUID(), proposal_id: proposal.proposal_id, tenant_id: proposal.tenant_id,
        policy_key: key, policy_version: proposal.proposed_version, resource_uri: proposal.resource_uri,
        proposal_hash_sha256: proposal.proposal_hash_sha256,
        policy_sha256: sha256(proposal.compiled_policy_sha256, "proposal.compiled_policy_sha256"),
        compiled_policy: proposal.compiled_policy, effective_at: instant(effectiveAt, "effectiveAt").toISOString(),
        idempotency_key: normalizeIdempotencyKey(rawIdempotencyKey), invalidation_event_id: randomUUID(), status: "activation_pending", secrets_included: false,
      });
    });
    const evidence = await publishOrFail({ event_id: prepared.invalidation_event_id, event_type: "governed_policy_version_activated", tenant_id: prepared.tenant_id, policy_key: prepared.policy_key, policy_version: prepared.policy_version, resource_uri: prepared.resource_uri, policy_sha256: prepared.policy_sha256, critical: true, created_at: now().toISOString(), secrets_included: false }, prepared.activation_id, "governed_policy_activation");
    const readback = await finalize(prepared, { tenant_id: prepared.tenant_id, policy_key: prepared.policy_key, policy_version: prepared.policy_version, resource_uri: prepared.resource_uri, policy_sha256: prepared.policy_sha256 }, evidence);
    return freeze({ ok: true, activation_id: prepared.activation_id, proposal_id: prepared.proposal_id, tenant_id: prepared.tenant_id, policy_key: prepared.policy_key, policy_version: prepared.policy_version, resource_uri: prepared.resource_uri, policy_sha256: prepared.policy_sha256, registry_readback: readback, invalidation_accepted: true, authority_activated: true, secrets_included: false });
  }

  async function rollbackPolicy({ tenantId, policyKey, activeVersion, targetVersion, resourceUri: resource, approvedProposalId, proposalHashSha256, idempotencyKey: rawIdempotencyKey } = {}) {
    const tenant = identifier(tenantId, "tenantId");
    const key = canonical(policyKey, "policyKey");
    const active = explicitVersion(activeVersion, "activeVersion");
    const target = explicitVersion(targetVersion, "targetVersion");
    if (active === target) fail("governed_policy_rollback_target_invalid", "Rollback target must differ from active version.", 422);
    const expected = expectedProposal({ proposalId: approvedProposalId, tenantId: tenant, resource, proposalHash: proposalHashSha256 });
    const targetPolicy = await repository.readPolicyVersion({ tenant_id: tenant, policy_key: key, policy_version: target, resource_uri: expected.resource_uri });
    if (!targetPolicy || !new Set(["superseded", "active"]).has(targetPolicy.status)) fail("governed_policy_rollback_target_unavailable", "Rollback target is not a prior valid version.", 409);
    const prepared = await repository.withTransaction(async (tx) => {
      const proposal = await repository.readProposalForUpdate(tx, expected.proposal_id);
      assertProposal(proposal, expected, false);
      assertApproval(await repository.readApprovalForProposal(tx, proposal.proposal_id), proposal, now());
      if (!new Set(["approved", "active", "superseded"]).has(proposal.status)) fail("governed_policy_rollback_proposal_not_authorized", "Rollback proposal is not authorized.", 409, { status: proposal.status });
      return repository.preparePolicyRollback(tx, {
        rollback_id: randomUUID(), tenant_id: tenant, policy_key: key, active_version: active,
        target_version: target, resource_uri: expected.resource_uri, approved_proposal_id: proposal.proposal_id,
        proposal_hash_sha256: proposal.proposal_hash_sha256, idempotency_key: normalizeIdempotencyKey(rawIdempotencyKey),
        invalidation_event_id: randomUUID(), created_at: now().toISOString(), secrets_included: false,
      });
    });
    const evidence = await publishOrFail({ event_id: prepared.invalidation_event_id, event_type: "governed_policy_version_rollback", tenant_id: tenant, policy_key: key, policy_version: target, previous_policy_version: active, resource_uri: expected.resource_uri, policy_sha256: targetPolicy.policy_sha256, critical: true, created_at: now().toISOString(), secrets_included: false }, prepared.activation_id, "governed_policy_rollback");
    const readback = await finalize(prepared, { tenant_id: tenant, policy_key: key, policy_version: target, resource_uri: expected.resource_uri, policy_sha256: targetPolicy.policy_sha256 }, evidence, prepared.rollback_id);
    return freeze({ ok: true, rollback_id: prepared.rollback_id, policy_key: key, from_version: active, to_version: target, registry_readback: readback, authority_activated: true, secrets_included: false });
  }

  return Object.freeze({ persistCompiledProposal, approveProposal, activateProposal, rollbackPolicy });
}

export const governedPolicyLifecycleContract = freeze({
  version: "governed-policy-lifecycle-service-v3",
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
