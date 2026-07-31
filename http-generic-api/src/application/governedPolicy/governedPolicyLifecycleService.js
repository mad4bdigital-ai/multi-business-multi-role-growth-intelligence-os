import { randomUUID, createHash } from "node:crypto";
import {
  GovernedPolicyError,
  stableGovernedPolicySha256,
} from "../../domain/governedPolicy/governedPolicyQuestionnaireEngine.js";

const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/;
const KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const MAX_TYPED_CONFIRMATION_BYTES = 1_024;

function fail(code, message, status = 409, details = {}) {
  throw new GovernedPolicyError(code, message, status, details);
}

function identifier(value, field) {
  const normalized = String(value ?? "").trim();
  if (!OPAQUE_ID_RE.test(normalized)) {
    fail("governed_policy_lifecycle_invalid_identifier", `${field} must be a bounded opaque identifier.`, 422, { field });
  }
  return normalized;
}

function canonical(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!KEY_RE.test(normalized)) {
    fail("governed_policy_lifecycle_invalid_key", `${field} must be a canonical key.`, 422, { field });
  }
  return normalized;
}

function version(value, field) {
  const normalized = String(value ?? "").trim();
  if (!VERSION_RE.test(normalized)) {
    fail("governed_policy_lifecycle_invalid_version", `${field} must be an explicit bounded version.`, 422, { field });
  }
  return normalized;
}

function sha256(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    fail("governed_policy_lifecycle_invalid_sha256", `${field} must be SHA-256.`, 422, { field });
  }
  return normalized;
}

function instant(value, field) {
  const normalized = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(normalized.getTime())) {
    fail("governed_policy_lifecycle_invalid_instant", `${field} must be a valid instant.`, 422, { field });
  }
  return normalized;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((nested) => deepFreeze(nested, seen));
  return Object.freeze(value);
}

function typedConfirmationHash(value) {
  if (value == null) return null;
  const normalized = String(value).normalize("NFKC").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > MAX_TYPED_CONFIRMATION_BYTES) {
    fail(
      "governed_policy_typed_confirmation_invalid",
      "Typed confirmation must be non-empty and within the supported byte bound.",
      422,
    );
  }
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function assertRepository(repository) {
  const requiredMethods = [
    "withTransaction",
    "persistCompiledProposal",
    "readProposalForUpdate",
    "readApprovalForProposal",
    "appendApproval",
    "preparePolicyActivation",
    "readActivationForUpdate",
    "finalizePolicyActivation",
    "markActivationFailed",
    "readActivePolicyVersion",
    "readPolicyVersion",
    "preparePolicyRollback",
    "readInvalidationEvent",
  ];
  if (!repository || typeof repository !== "object") {
    fail("governed_policy_repository_required", "A governed policy repository is required.", 500);
  }
  for (const method of requiredMethods) {
    if (typeof repository[method] !== "function") {
      fail("governed_policy_repository_invalid", `repository.${method} is required.`, 500, { method });
    }
  }
}

function assertPublisher(publisher) {
  if (!publisher || typeof publisher.publish !== "function") {
    fail("governed_policy_invalidation_publisher_required", "invalidationPublisher.publish is required.", 500);
  }
}

function normalizeProposalEvidence(compilation, proposal) {
  if (!compilation || !proposal) {
    fail("governed_policy_compilation_and_proposal_required", "compilation and proposal are required.", 400);
  }
  const normalized = {
    proposal_id: identifier(proposal.proposal_id, "proposal.proposal_id"),
    compilation_id: identifier(proposal.compilation_id, "proposal.compilation_id"),
    tenant_id: identifier(proposal.tenant_id, "proposal.tenant_id"),
    policy_type: canonical(proposal.policy_type, "proposal.policy_type"),
    proposed_version: version(proposal.proposed_version, "proposal.proposed_version"),
    resource_uri: String(proposal.resource_uri ?? "").trim(),
    proposal_hash_sha256: sha256(proposal.proposal_hash_sha256, "proposal.proposal_hash_sha256"),
    compilation_sha256: sha256(compilation.compilation_sha256, "compilation.compilation_sha256"),
    compiled_policy_sha256: sha256(compilation.compiled_policy_sha256, "compilation.compiled_policy_sha256"),
    required_approval_class: canonical(
      proposal.required_approval_class,
      "proposal.required_approval_class",
    ),
    typed_confirmation_required: proposal.typed_confirmation_required === true,
  };
  if (proposal.compilation_id !== compilation.compilation_id) {
    fail("governed_policy_proposal_compilation_mismatch", "Proposal and compilation identities do not match.", 409);
  }
  if (!normalized.resource_uri || normalized.resource_uri.length > 2_048) {
    fail("governed_policy_resource_invalid", "proposal.resource_uri must be bounded.", 422);
  }
  return deepFreeze(normalized);
}

function exactProposalBinding(proposal, expected) {
  const mismatches = [];
  for (const field of [
    "proposal_id",
    "tenant_id",
    "policy_type",
    "proposed_version",
    "resource_uri",
    "proposal_hash_sha256",
  ]) {
    if (String(proposal?.[field] ?? "") !== String(expected[field] ?? "")) mismatches.push(field);
  }
  if (mismatches.length > 0) {
    fail("governed_policy_proposal_binding_mismatch", "Proposal binding drifted from the requested operation.", 409, {
      mismatch_fields: mismatches,
    });
  }
}

function exactApprovalBinding(approval, proposal) {
  if (!approval) fail("governed_policy_approval_missing", "An active exact-bound approval is required.", 409);
  const mismatches = [];
  const expected = {
    proposal_id: proposal.proposal_id,
    tenant_id: proposal.tenant_id,
    resource_uri: proposal.resource_uri,
    proposal_hash_sha256: proposal.proposal_hash_sha256,
    approval_class: proposal.required_approval_class,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (String(approval[field] ?? "") !== String(value ?? "")) mismatches.push(field);
  }
  if (mismatches.length > 0) {
    fail("governed_policy_approval_binding_mismatch", "Approval is not bound to the exact proposal/resource/version.", 409, {
      mismatch_fields: mismatches,
    });
  }
  if (approval.decision !== "approved") {
    fail("governed_policy_approval_not_approved", "The exact proposal approval is not approved.", 409, {
      decision: approval.decision ?? "unknown",
    });
  }
  if (new Date(approval.expires_at).getTime() <= Date.now()) {
    fail("governed_policy_approval_expired", "The exact proposal approval has expired.", 409);
  }
  if (proposal.typed_confirmation_required && !SHA256_RE.test(String(approval.typed_confirmation_hash ?? ""))) {
    fail("governed_policy_typed_confirmation_missing", "A typed confirmation bound to this proposal is required.", 409);
  }
}

function exactRegistryReadback(readback, expected) {
  if (!readback) fail("governed_policy_registry_readback_missing", "Authoritative policy registry readback is missing.", 409);
  const mismatches = [];
  for (const field of ["tenant_id", "policy_key", "policy_version", "resource_uri", "policy_sha256", "status"]) {
    if (String(readback[field] ?? "") !== String(expected[field] ?? "")) mismatches.push(field);
  }
  if (mismatches.length > 0) {
    fail("governed_policy_registry_readback_mismatch", "Authoritative policy registry readback does not match the exact activation.", 409, {
      mismatch_fields: mismatches,
    });
  }
}

function normalizeIdempotencyKey(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 191) {
    fail("governed_policy_idempotency_key_required", "A bounded idempotency key is required.", 422);
  }
  return normalized;
}

export function createGovernedPolicyLifecycleService({
  repository,
  invalidationPublisher,
  clock = () => new Date(),
} = {}) {
  assertRepository(repository);
  assertPublisher(invalidationPublisher);

  async function persistCompiledProposal({ compilation, proposal, answersEvidence, idempotencyKey } = {}) {
    const binding = normalizeProposalEvidence(compilation, proposal);
    const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
    return repository.withTransaction(async (transaction) => {
      const persisted = await repository.persistCompiledProposal(transaction, {
        compilation,
        proposal,
        answers_evidence: answersEvidence,
        idempotency_key: normalizedIdempotencyKey,
      });
      exactProposalBinding(persisted.proposal, binding);
      return deepFreeze({
        ok: true,
        idempotent_replay: persisted.idempotent_replay === true,
        compilation_id: binding.compilation_id,
        proposal_id: binding.proposal_id,
        proposal_hash_sha256: binding.proposal_hash_sha256,
        runtime_authority_activated: false,
        secrets_included: false,
      });
    });
  }

  async function approveProposal({
    proposalId,
    tenantId,
    resourceUri,
    proposalHashSha256,
    approvalClass,
    approvedBy,
    typedConfirmation = null,
    expiresAt,
    idempotencyKey,
  } = {}) {
    const expected = {
      proposal_id: identifier(proposalId, "proposalId"),
      tenant_id: identifier(tenantId, "tenantId"),
      resource_uri: String(resourceUri ?? "").trim(),
      proposal_hash_sha256: sha256(proposalHashSha256, "proposalHashSha256"),
      approval_class: canonical(approvalClass, "approvalClass"),
    };
    const actor = identifier(approvedBy, "approvedBy");
    const expiry = instant(expiresAt, "expiresAt");
    const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
    const confirmationHash = typedConfirmationHash(typedConfirmation);
    return repository.withTransaction(async (transaction) => {
      const proposal = await repository.readProposalForUpdate(transaction, expected.proposal_id);
      exactProposalBinding(proposal, {
        ...expected,
        policy_type: proposal?.policy_type,
        proposed_version: proposal?.proposed_version,
      });
      if (proposal.required_approval_class !== expected.approval_class) {
        fail("governed_policy_approval_class_mismatch", "Approval class does not match the compiled requirement.", 409);
      }
      if (proposal.typed_confirmation_required === true && !confirmationHash) {
        fail("governed_policy_typed_confirmation_missing", "This proposal requires typed confirmation.", 409);
      }
      if (proposal.status !== "submitted" && proposal.status !== "approved") {
        fail("governed_policy_proposal_not_approvable", "The proposal is not in an approvable state.", 409, {
          status: proposal.status,
        });
      }
      const approval = await repository.appendApproval(transaction, {
        approval_id: randomUUID(),
        proposal_id: expected.proposal_id,
        tenant_id: expected.tenant_id,
        resource_uri: expected.resource_uri,
        proposal_hash_sha256: expected.proposal_hash_sha256,
        approval_class: expected.approval_class,
        decision: "approved",
        approved_by: actor,
        typed_confirmation_hash: confirmationHash,
        created_at: instant(clock(), "clock").toISOString(),
        expires_at: expiry.toISOString(),
        idempotency_key: normalizedIdempotencyKey,
        secrets_included: false,
      });
      exactApprovalBinding(approval, proposal);
      return deepFreeze({
        ok: true,
        approval_id: approval.approval_id,
        proposal_id: expected.proposal_id,
        proposal_hash_sha256: expected.proposal_hash_sha256,
        decision: "approved",
        typed_confirmation_present: Boolean(confirmationHash),
        authority_activated: false,
        secrets_included: false,
      });
    });
  }

  async function activateProposal({
    proposalId,
    tenantId,
    policyKey,
    policyVersion,
    resourceUri,
    proposalHashSha256,
    idempotencyKey,
    effectiveAt = clock(),
  } = {}) {
    const expected = {
      proposal_id: identifier(proposalId, "proposalId"),
      tenant_id: identifier(tenantId, "tenantId"),
      policy_key: canonical(policyKey, "policyKey"),
      policy_version: version(policyVersion, "policyVersion"),
      resource_uri: String(resourceUri ?? "").trim(),
      proposal_hash_sha256: sha256(proposalHashSha256, "proposalHashSha256"),
    };
    const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
    const effective = instant(effectiveAt, "effectiveAt").toISOString();
    const prepared = await repository.withTransaction(async (transaction) => {
      const proposal = await repository.readProposalForUpdate(transaction, expected.proposal_id);
      exactProposalBinding(proposal, {
        ...expected,
        policy_type: proposal?.policy_type,
        proposed_version: expected.policy_version,
      });
      if (proposal.proposed_version !== expected.policy_version) {
        fail("governed_policy_activation_version_mismatch", "The requested policy version differs from the approved proposal.", 409);
      }
      const approval = await repository.readApprovalForProposal(transaction, expected.proposal_id);
      exactApprovalBinding(approval, proposal);
      if (!new Set(["approved", "activation_pending"]).has(proposal.status)) {
        fail("governed_policy_proposal_not_activatable", "The proposal is not approved for activation.", 409, {
          status: proposal.status,
        });
      }
      const preparedActivation = await repository.preparePolicyActivation(transaction, {
        activation_id: randomUUID(),
        proposal_id: expected.proposal_id,
        tenant_id: expected.tenant_id,
        policy_key: expected.policy_key,
        policy_version: expected.policy_version,
        resource_uri: expected.resource_uri,
        proposal_hash_sha256: expected.proposal_hash_sha256,
        policy_sha256: sha256(proposal.compiled_policy_sha256, "proposal.compiled_policy_sha256"),
        compiled_policy: proposal.compiled_policy,
        effective_at: effective,
        idempotency_key: normalizedIdempotencyKey,
        invalidation_event_id: randomUUID(),
        status: "activation_pending",
        secrets_included: false,
      });
      return deepFreeze(preparedActivation);
    });

    let publishedEvidence;
    try {
      publishedEvidence = await invalidationPublisher.publish({
        event_id: prepared.invalidation_event_id,
        event_type: "governed_policy_version_activated",
        tenant_id: expected.tenant_id,
        policy_key: expected.policy_key,
        policy_version: expected.policy_version,
        resource_uri: expected.resource_uri,
        policy_sha256: prepared.policy_sha256,
        critical: true,
        created_at: instant(clock(), "clock").toISOString(),
        secrets_included: false,
      });
    } catch (error) {
      await repository.withTransaction((transaction) => repository.markActivationFailed(transaction, {
        activation_id: prepared.activation_id,
        failure_code: "critical_cache_invalidation_publish_failed",
        failure_message: String(error?.message ?? error).slice(0, 1_000),
      }));
      fail("governed_policy_invalidation_failed", "Critical policy invalidation failed; activation remains pending/failed.", 503, {
        activation_id: prepared.activation_id,
      });
    }
    if (!publishedEvidence || publishedEvidence.accepted !== true) {
      await repository.withTransaction((transaction) => repository.markActivationFailed(transaction, {
        activation_id: prepared.activation_id,
        failure_code: "critical_cache_invalidation_not_accepted",
        failure_message: "Invalidation publisher did not return accepted evidence.",
      }));
      fail("governed_policy_invalidation_not_accepted", "Critical policy invalidation was not accepted.", 503, {
        activation_id: prepared.activation_id,
      });
    }

    await repository.withTransaction(async (transaction) => {
      const activation = await repository.readActivationForUpdate(transaction, prepared.activation_id);
      if (!activation) fail("governed_policy_activation_missing", "Prepared activation was not found.", 409);
      if (activation.status === "active") return activation;
      if (activation.status !== "activation_pending") {
        fail("governed_policy_activation_not_finalizable", "Prepared activation is not finalizable.", 409, {
          status: activation.status,
        });
      }
      const invalidation = await repository.readInvalidationEvent(transaction, prepared.invalidation_event_id);
      if (!invalidation || invalidation.event_id !== prepared.invalidation_event_id) {
        fail("governed_policy_invalidation_readback_missing", "Critical invalidation event readback is missing.", 409);
      }
      await repository.finalizePolicyActivation(transaction, {
        activation_id: prepared.activation_id,
        invalidation_evidence_sha256: stableGovernedPolicySha256(publishedEvidence),
        activated_at: instant(clock(), "clock").toISOString(),
      });
      return activation;
    });

    const readback = await repository.readActivePolicyVersion({
      tenant_id: expected.tenant_id,
      policy_key: expected.policy_key,
      resource_uri: expected.resource_uri,
    });
    exactRegistryReadback(readback, {
      tenant_id: expected.tenant_id,
      policy_key: expected.policy_key,
      policy_version: expected.policy_version,
      resource_uri: expected.resource_uri,
      policy_sha256: prepared.policy_sha256,
      status: "active",
    });
    return deepFreeze({
      ok: true,
      activation_id: prepared.activation_id,
      proposal_id: expected.proposal_id,
      tenant_id: expected.tenant_id,
      policy_key: expected.policy_key,
      policy_version: expected.policy_version,
      resource_uri: expected.resource_uri,
      policy_sha256: prepared.policy_sha256,
      registry_readback: readback,
      invalidation_accepted: true,
      authority_activated: true,
      secrets_included: false,
    });
  }

  async function rollbackPolicy({
    tenantId,
    policyKey,
    activeVersion,
    targetVersion,
    resourceUri,
    approvedProposalId,
    proposalHashSha256,
    idempotencyKey,
  } = {}) {
    const tenant = identifier(tenantId, "tenantId");
    const key = canonical(policyKey, "policyKey");
    const active = version(activeVersion, "activeVersion");
    const target = version(targetVersion, "targetVersion");
    const proposalId = identifier(approvedProposalId, "approvedProposalId");
    const proposalHash = sha256(proposalHashSha256, "proposalHashSha256");
    const normalizedResourceUri = String(resourceUri ?? "").trim();
    const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
    if (active === target) fail("governed_policy_rollback_target_invalid", "Rollback target must differ from the active version.", 422);

    const targetPolicy = await repository.readPolicyVersion({
      tenant_id: tenant,
      policy_key: key,
      policy_version: target,
      resource_uri: normalizedResourceUri,
    });
    if (!targetPolicy || !new Set(["superseded", "active"]).has(targetPolicy.status)) {
      fail("governed_policy_rollback_target_unavailable", "Rollback target is not a previously valid policy version.", 409);
    }
    const prepared = await repository.withTransaction(async (transaction) => repository.preparePolicyRollback(transaction, {
      rollback_id: randomUUID(),
      tenant_id: tenant,
      policy_key: key,
      active_version: active,
      target_version: target,
      resource_uri: normalizedResourceUri,
      approved_proposal_id: proposalId,
      proposal_hash_sha256: proposalHash,
      idempotency_key: normalizedIdempotencyKey,
      invalidation_event_id: randomUUID(),
      created_at: instant(clock(), "clock").toISOString(),
      secrets_included: false,
    }));

    const published = await invalidationPublisher.publish({
      event_id: prepared.invalidation_event_id,
      event_type: "governed_policy_version_rollback",
      tenant_id: tenant,
      policy_key: key,
      policy_version: target,
      previous_policy_version: active,
      resource_uri: normalizedResourceUri,
      policy_sha256: targetPolicy.policy_sha256,
      critical: true,
      created_at: instant(clock(), "clock").toISOString(),
      secrets_included: false,
    });
    if (!published || published.accepted !== true) {
      fail("governed_policy_rollback_invalidation_failed", "Rollback invalidation was not accepted.", 503, {
        rollback_id: prepared.rollback_id,
      });
    }
    await repository.withTransaction(async (transaction) => repository.finalizePolicyActivation(transaction, {
      activation_id: prepared.activation_id,
      invalidation_evidence_sha256: stableGovernedPolicySha256(published),
      activated_at: instant(clock(), "clock").toISOString(),
      rollback_id: prepared.rollback_id,
    }));
    const readback = await repository.readActivePolicyVersion({
      tenant_id: tenant,
      policy_key: key,
      resource_uri: normalizedResourceUri,
    });
    exactRegistryReadback(readback, {
      tenant_id: tenant,
      policy_key: key,
      policy_version: target,
      resource_uri: normalizedResourceUri,
      policy_sha256: targetPolicy.policy_sha256,
      status: "active",
    });
    return deepFreeze({
      ok: true,
      rollback_id: prepared.rollback_id,
      policy_key: key,
      from_version: active,
      to_version: target,
      registry_readback: readback,
      authority_activated: true,
      secrets_included: false,
    });
  }

  return Object.freeze({
    persistCompiledProposal,
    approveProposal,
    activateProposal,
    rollbackPolicy,
  });
}

export const governedPolicyLifecycleContract = deepFreeze({
  version: "governed-policy-lifecycle-service-v1",
  proposal_and_resource_exact_binding_required: true,
  approval_invalidated_by_proposal_drift: true,
  typed_confirmation_plaintext_persisted: false,
  activation_prepare_before_invalidation: true,
  invalidation_failure_reports_active: false,
  exact_registry_version_readback_required: true,
  rollback_is_new_governed_operation: true,
  idempotency_required: true,
  provider_dispatch_performed: false,
  secrets_included: false,
});
