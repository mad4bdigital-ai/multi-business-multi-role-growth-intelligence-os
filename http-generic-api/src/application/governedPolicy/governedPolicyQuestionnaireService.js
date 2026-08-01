import { randomUUID } from "node:crypto";
import {
  GovernedPolicyError,
  createPinnedQuestionnaireSession,
  selectGovernedPolicyQuestions,
  validateQuestionnaireAnswers,
  compileGovernedPolicyProposal,
} from "../../domain/governedPolicy/governedPolicyQuestionnaireEngine.js";

const KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/;

function fail(code, message, status = 409, details = {}) {
  throw new GovernedPolicyError(code, message, status, details);
}

function canonical(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!KEY_RE.test(normalized)) fail("governed_policy_questionnaire_invalid_key", `${field} must be canonical.`, 422, { field });
  return normalized;
}

function identifier(value, field) {
  const normalized = String(value ?? "").trim();
  if (!OPAQUE_ID_RE.test(normalized)) {
    fail("governed_policy_questionnaire_invalid_identifier", `${field} must be a bounded opaque identifier.`, 422, { field });
  }
  return normalized;
}

function assertRepository(repository) {
  for (const method of [
    "withTransaction",
    "readDomainAdoption",
    "readActiveQuestionnaireDefinition",
    "readQuestionnaireDefinitionVersion",
    "readActiveSafetyBounds",
    "createQuestionnaireSession",
    "readQuestionnaireSessionForUpdate",
    "appendAnswerSet",
  ]) {
    if (!repository || typeof repository[method] !== "function") {
      fail("governed_policy_questionnaire_repository_invalid", `repository.${method} is required.`, 500, { method });
    }
  }
}

function adapterKey(key, version) {
  return `${String(key)}@${String(version)}`;
}

function normalizeSource(source) {
  const normalized = String(source ?? "user").trim().toLowerCase();
  if (!new Set(["user", "recommended_profile", "admin_override"]).has(normalized)) {
    fail("governed_policy_answer_source_invalid", "Answer source is unsupported.", 422);
  }
  return normalized;
}

export function createGovernedPolicyQuestionnaireService({
  repository,
  lifecycleService,
  adapters = [],
  clock = () => new Date(),
} = {}) {
  assertRepository(repository);
  if (!lifecycleService || typeof lifecycleService.persistCompiledProposal !== "function") {
    fail("governed_policy_lifecycle_service_required", "lifecycleService.persistCompiledProposal is required.", 500);
  }
  const adapterRegistry = new Map();
  for (const adapter of adapters) {
    const key = canonical(adapter?.key, "adapter.key");
    const version = String(adapter?.version ?? "").trim();
    const registryKey = adapterKey(key, version);
    if (adapterRegistry.has(registryKey)) {
      fail("governed_policy_adapter_duplicate", "Compiler adapter key/version must be unique.", 500, { registry_key: registryKey });
    }
    adapterRegistry.set(registryKey, adapter);
  }

  async function resolveDomainAuthorities({ domainKey, purposeKey, now }) {
    const domain = canonical(domainKey, "domainKey");
    const purpose = canonical(purposeKey, "purposeKey");
    const adoption = await repository.readDomainAdoption({ domain_key: domain, purpose_key: purpose });
    if (!adoption) {
      fail("governed_policy_domain_not_adopted", "The domain/purpose has not passed the governed platform adoption gate.", 409, {
        domain_key: domain,
        purpose_key: purpose,
      });
    }
    const definition = await repository.readActiveQuestionnaireDefinition({
      questionnaire_key: adoption.questionnaire_key,
      domain_key: domain,
      purpose_key: purpose,
      at: now,
    });
    if (!definition) fail("governed_policy_definition_missing", "No active exact questionnaire definition was found.", 409);
    if (definition.compiler_key !== adoption.compiler_key) {
      fail("governed_policy_adoption_compiler_drift", "Domain adoption and questionnaire compiler keys differ.", 409);
    }
    const safetyBounds = await repository.readActiveSafetyBounds({
      safety_bounds_key: adoption.safety_bounds_key,
      domain_key: domain,
      at: now,
    });
    if (!safetyBounds) fail("governed_policy_safety_bounds_missing", "No active exact safety bounds were found.", 409);
    const adapter = adapterRegistry.get(adapterKey(definition.compiler_key, definition.compiler_version));
    if (!adapter) {
      fail("governed_policy_compiler_adapter_missing", "The exact compiler adapter key/version is unavailable.", 503, {
        compiler_key: definition.compiler_key,
        compiler_version: definition.compiler_version,
      });
    }
    return Object.freeze({ adoption, definition, safetyBounds, adapter });
  }

  async function startSession({
    domainKey,
    purposeKey,
    tenantId,
    userId,
    actorRoles = [],
    interactionMode,
    context = {},
    ttlSeconds = 3_600,
    sessionId = randomUUID(),
  } = {}) {
    const now = new Date(clock());
    const authorities = await resolveDomainAuthorities({ domainKey, purposeKey, now });
    const session = createPinnedQuestionnaireSession({
      definition: authorities.definition,
      tenantId: identifier(tenantId, "tenantId"),
      userId: identifier(userId, "userId"),
      actorRoles,
      interactionMode,
      context,
      ttlSeconds,
      sessionId,
      now,
    });
    const persisted = await repository.withTransaction((transaction) => repository.createQuestionnaireSession(transaction, session));
    const questions = selectGovernedPolicyQuestions({
      definition: authorities.definition,
      answers: {},
      context: session.context_snapshot,
      actorRoles: session.actor_roles,
      interactionMode: session.interaction_mode,
    });
    return Object.freeze({
      ok: true,
      idempotent_replay: persisted.idempotent_replay === true,
      session: persisted.session,
      questions,
      runtime_authority_activated: false,
      secrets_included: false,
    });
  }

  async function readPinnedSession(sessionId) {
    return repository.withTransaction((transaction) => repository.readQuestionnaireSessionForUpdate(
      transaction,
      identifier(sessionId, "sessionId"),
    ));
  }

  async function submitAnswers({
    sessionId,
    tenantId,
    userId,
    expectedRevision,
    answers,
    source = "user",
  } = {}) {
    const session = await readPinnedSession(sessionId);
    if (session.tenant_id !== identifier(tenantId, "tenantId") || session.user_id !== identifier(userId, "userId")) {
      fail("governed_policy_session_scope_mismatch", "Questionnaire session is outside the verified tenant/user scope.", 403);
    }
    if (session.revision !== Number(expectedRevision)) {
      fail("governed_policy_session_version_conflict", "Questionnaire session revision changed.", 409, {
        expected_revision: Number(expectedRevision),
        observed_revision: session.revision,
      });
    }
    const definition = await repository.readQuestionnaireDefinitionVersion({
      questionnaire_key: session.questionnaire_key,
      questionnaire_version: session.questionnaire_version,
    });
    if (!definition || definition.definition_sha256 !== session.definition_sha256) {
      fail("governed_policy_session_definition_readback_mismatch", "Pinned questionnaire definition readback does not match the session.", 409);
    }
    const evidence = validateQuestionnaireAnswers({ session, definition, answers });
    const persisted = await repository.withTransaction((transaction) => repository.appendAnswerSet(transaction, {
      answer_set_id: randomUUID(),
      session_id: session.session_id,
      expected_revision: session.revision,
      evidence,
      source: normalizeSource(source),
    }));
    return Object.freeze({
      ok: true,
      idempotent_replay: persisted.idempotent_replay === true,
      session: persisted.session,
      answer_set_id: persisted.answer_set_id,
      normalized_answers_sha256: evidence.normalized_answers_sha256,
      runtime_authority_activated: false,
      secrets_included: false,
    });
  }

  async function compileAndSubmitProposal({
    sessionId,
    tenantId,
    userId,
    answers,
    resourceUri,
    proposedVersion,
    idempotencyKey,
  } = {}) {
    const session = await readPinnedSession(sessionId);
    if (session.tenant_id !== identifier(tenantId, "tenantId") || session.user_id !== identifier(userId, "userId")) {
      fail("governed_policy_session_scope_mismatch", "Questionnaire session is outside the verified tenant/user scope.", 403);
    }
    if (session.status !== "ready_for_preview") {
      fail("governed_policy_session_not_ready_for_preview", "Questionnaire session must contain a validated answer revision before compilation.", 409, {
        status: session.status,
      });
    }
    const definition = await repository.readQuestionnaireDefinitionVersion({
      questionnaire_key: session.questionnaire_key,
      questionnaire_version: session.questionnaire_version,
    });
    if (!definition || definition.definition_sha256 !== session.definition_sha256) {
      fail("governed_policy_session_definition_readback_mismatch", "Pinned questionnaire definition readback does not match the session.", 409);
    }
    const adoption = await repository.readDomainAdoption({
      domain_key: session.domain_key,
      purpose_key: session.purpose_key,
    });
    if (!adoption || adoption.questionnaire_key !== session.questionnaire_key || adoption.compiler_key !== definition.compiler_key) {
      fail("governed_policy_domain_adoption_drift", "Domain adoption no longer matches the pinned session compiler authority.", 409);
    }
    const safetyBounds = await repository.readActiveSafetyBounds({
      safety_bounds_key: adoption.safety_bounds_key,
      domain_key: session.domain_key,
      at: new Date(clock()),
    });
    if (!safetyBounds) fail("governed_policy_safety_bounds_missing", "No active exact safety bounds were found.", 409);
    const adapter = adapterRegistry.get(adapterKey(definition.compiler_key, definition.compiler_version));
    if (!adapter) fail("governed_policy_compiler_adapter_missing", "The exact compiler adapter is unavailable.", 503);
    const compiled = compileGovernedPolicyProposal({
      session,
      definition,
      answers,
      safetyBounds,
      adapter,
      resourceUri,
      proposedVersion,
      now: new Date(clock()),
    });
    const persisted = await lifecycleService.persistCompiledProposal({
      compilation: compiled.compilation,
      proposal: compiled.proposal,
      answersEvidence: {
        session_id: session.session_id,
        questionnaire_key: session.questionnaire_key,
        questionnaire_version: session.questionnaire_version,
        definition_sha256: session.definition_sha256,
        normalized_answers_sha256: compiled.compilation.provenance.normalized_answers_sha256,
        secrets_included: false,
      },
      idempotencyKey,
    });
    return Object.freeze({
      ...persisted,
      compilation: compiled.compilation,
      proposal: compiled.proposal,
      impact_preview: compiled.compilation.impact_preview,
      authority_activated: false,
      secrets_included: false,
    });
  }

  return Object.freeze({
    startSession,
    submitAnswers,
    compileAndSubmitProposal,
  });
}

export const governedPolicyQuestionnaireServiceContract = Object.freeze({
  version: "governed-policy-questionnaire-application-service-v1",
  domain_adoption_gate_required: true,
  exact_definition_and_safety_bound_versions_required: true,
  sessions_pinned_to_definition_sha256: true,
  optimistic_answer_revision_required: true,
  deterministic_compiler_adapter_key_version_required: true,
  questionnaire_is_runtime_authority: false,
  proposal_activation_performed: false,
  provider_dispatch_performed: false,
  secrets_included: false,
});
