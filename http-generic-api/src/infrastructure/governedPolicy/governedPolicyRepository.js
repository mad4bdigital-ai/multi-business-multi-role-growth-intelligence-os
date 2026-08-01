import { createHash, randomUUID } from "node:crypto";
import { stableGovernedPolicySha256 } from "../../domain/governedPolicy/governedPolicyQuestionnaireEngine.js";

function repositoryError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function dbDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw repositoryError("governed_policy_repository_invalid_date", "Invalid repository date input.", 422);
  }
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function sha256Text(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function assertPool(pool) {
  if (!pool || typeof pool.getConnection !== "function" || typeof pool.query !== "function") {
    throw repositoryError("governed_policy_repository_pool_required", "pool.getConnection and pool.query are required.", 500);
  }
}

function single(rows, { missingCode = null, missingMessage = null, ambiguousCode, ambiguousMessage }) {
  const candidates = Array.isArray(rows) ? rows : [];
  if (candidates.length > 1) throw repositoryError(ambiguousCode, ambiguousMessage);
  if (!candidates[0] && missingCode) throw repositoryError(missingCode, missingMessage, 404);
  return candidates[0] ?? null;
}

function mapDefinition(row) {
  if (!row) return null;
  const definition = parseJson(row.definition_json, null);
  if (!definition) throw repositoryError("governed_policy_definition_json_invalid", "Stored questionnaire definition JSON is invalid.", 500);
  return Object.freeze({
    ...definition,
    definition_id: String(row.definition_id),
    definition_sha256: String(row.definition_sha256),
    status: String(row.status),
    effective_at: new Date(row.effective_at).toISOString(),
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    secrets_included: false,
  });
}

function mapSafetyBounds(row) {
  if (!row) return null;
  const bounds = parseJson(row.bounds_json, null);
  if (!bounds) throw repositoryError("governed_policy_safety_bounds_json_invalid", "Stored safety bounds JSON is invalid.", 500);
  return Object.freeze({
    ...bounds,
    safety_bounds_id: String(row.safety_bounds_id),
    safety_bounds_sha256: String(row.safety_bounds_sha256),
    status: String(row.status),
    effective_at: new Date(row.effective_at).toISOString(),
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    secrets_included: false,
  });
}

function mapSession(row) {
  if (!row) return null;
  return Object.freeze({
    session_id: String(row.session_id),
    tenant_id: String(row.tenant_id),
    user_id: String(row.user_id),
    questionnaire_key: String(row.questionnaire_key),
    questionnaire_version: String(row.questionnaire_version),
    definition_sha256: String(row.definition_sha256),
    domain_key: String(row.domain_key),
    purpose_key: String(row.purpose_key),
    interaction_mode: String(row.interaction_mode),
    actor_roles: parseJson(row.actor_roles_json, []),
    context_snapshot: parseJson(row.context_snapshot_json, {}),
    status: String(row.status),
    revision: Number(row.revision),
    session_binding_sha256: String(row.session_binding_sha256),
    created_at: new Date(row.created_at).toISOString(),
    expires_at: new Date(row.expires_at).toISOString(),
    secrets_included: false,
  });
}

function mapProposal(row) {
  if (!row) return null;
  return Object.freeze({
    proposal_id: String(row.proposal_id),
    compilation_id: String(row.compilation_id),
    tenant_id: String(row.tenant_id),
    policy_type: String(row.policy_type),
    proposed_version: String(row.proposed_version),
    resource_uri: String(row.resource_uri),
    status: String(row.status),
    risk_tier: String(row.risk_tier),
    required_approval_class: String(row.required_approval_class),
    typed_confirmation_required: Number(row.typed_confirmation_required) === 1,
    proposal_hash_sha256: String(row.proposal_hash_sha256),
    compiled_policy_sha256: String(row.compiled_policy_sha256),
    compiled_policy: parseJson(row.compiled_policy_json, {}),
    safety_bounds_sha256: String(row.safety_bounds_sha256),
    created_by: String(row.created_by),
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    secrets_included: false,
  });
}

function mapApproval(row) {
  if (!row) return null;
  return Object.freeze({
    approval_id: String(row.approval_id),
    proposal_id: String(row.proposal_id),
    tenant_id: String(row.tenant_id),
    resource_uri: String(row.resource_uri),
    proposal_hash_sha256: String(row.proposal_hash_sha256),
    approval_class: String(row.approval_class),
    decision: String(row.decision),
    approved_by: String(row.approved_by),
    typed_confirmation_hash: row.typed_confirmation_hash ? String(row.typed_confirmation_hash) : null,
    created_at: new Date(row.created_at).toISOString(),
    expires_at: new Date(row.expires_at).toISOString(),
    idempotency_key: String(row.idempotency_key),
    secrets_included: false,
  });
}

function mapPolicyVersion(row) {
  if (!row) return null;
  return Object.freeze({
    policy_version_id: String(row.policy_version_id),
    tenant_id: String(row.tenant_id),
    policy_key: String(row.policy_key),
    policy_version: String(row.policy_version),
    resource_uri: String(row.resource_uri),
    policy_sha256: String(row.policy_sha256),
    policy_json: parseJson(row.policy_json, {}),
    proposal_id: String(row.proposal_id),
    status: String(row.status),
    effective_at: new Date(row.effective_at).toISOString(),
    activated_at: row.activated_at ? new Date(row.activated_at).toISOString() : null,
    superseded_at: row.superseded_at ? new Date(row.superseded_at).toISOString() : null,
    secrets_included: false,
  });
}

function mapActivation(row) {
  if (!row) return null;
  return Object.freeze({
    activation_id: String(row.activation_id),
    proposal_id: String(row.proposal_id),
    tenant_id: String(row.tenant_id),
    policy_key: String(row.policy_key),
    policy_version: String(row.policy_version),
    resource_uri: String(row.resource_uri),
    policy_sha256: String(row.policy_sha256),
    invalidation_event_id: String(row.invalidation_event_id),
    status: String(row.status),
    idempotency_key: String(row.idempotency_key),
    rollback_id: row.rollback_id ? String(row.rollback_id) : null,
    secrets_included: false,
  });
}

export function createGovernedPolicyRepository({ pool } = {}) {
  assertPool(pool);

  async function withTransaction(callback) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function readActiveQuestionnaireDefinition({ questionnaire_key: questionnaireKey, domain_key: domainKey, purpose_key: purposeKey, at }) {
    const [rows] = await pool.query(
      `SELECT * FROM governed_policy_questionnaire_definitions
        WHERE questionnaire_key = ? AND domain_key = ? AND purpose_key = ?
          AND status = 'active' AND effective_at <= ?
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY effective_at DESC, questionnaire_version DESC
        LIMIT 2`,
      [questionnaireKey, domainKey, purposeKey, dbDate(at), dbDate(at)],
    );
    const row = single(rows, {
      ambiguousCode: "governed_policy_definition_ambiguous",
      ambiguousMessage: "Active questionnaire definition authority is ambiguous.",
    });
    return mapDefinition(row);
  }

  async function readQuestionnaireDefinitionVersion({ questionnaire_key: questionnaireKey, questionnaire_version: questionnaireVersion }) {
    const [rows] = await pool.query(
      `SELECT * FROM governed_policy_questionnaire_definitions
        WHERE questionnaire_key = ? AND questionnaire_version = ? LIMIT 2`,
      [questionnaireKey, questionnaireVersion],
    );
    return mapDefinition(single(rows, {
      ambiguousCode: "governed_policy_definition_version_ambiguous",
      ambiguousMessage: "Questionnaire definition version is ambiguous.",
    }));
  }

  async function readActiveSafetyBounds({ safety_bounds_key: safetyBoundsKey, domain_key: domainKey, at }) {
    const [rows] = await pool.query(
      `SELECT * FROM governed_policy_safety_bounds
        WHERE safety_bounds_key = ? AND domain_key = ? AND status = 'active'
          AND effective_at <= ? AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY effective_at DESC, safety_bounds_version DESC
        LIMIT 2`,
      [safetyBoundsKey, domainKey, dbDate(at), dbDate(at)],
    );
    return mapSafetyBounds(single(rows, {
      ambiguousCode: "governed_policy_safety_bounds_ambiguous",
      ambiguousMessage: "Active safety-bound authority is ambiguous.",
    }));
  }

  async function readDomainAdoption({ domain_key: domainKey, purpose_key: purposeKey }) {
    const [rows] = await pool.query(
      `SELECT * FROM governed_policy_domain_adoptions
        WHERE domain_key = ? AND purpose_key = ? AND status = 'active' LIMIT 2`,
      [domainKey, purposeKey],
    );
    const row = single(rows, {
      ambiguousCode: "governed_policy_domain_adoption_ambiguous",
      ambiguousMessage: "Governed policy domain adoption is ambiguous.",
    });
    if (!row) return null;
    return Object.freeze({
      domain_key: String(row.domain_key),
      purpose_key: String(row.purpose_key),
      questionnaire_key: String(row.questionnaire_key),
      safety_bounds_key: String(row.safety_bounds_key),
      compiler_key: String(row.compiler_key),
      runtime_registry_key: String(row.runtime_registry_key),
      status: String(row.status),
      adoption_sha256: String(row.adoption_sha256),
      secrets_included: false,
    });
  }

  async function createQuestionnaireSession(connection, session) {
    const [existingRows] = await connection.query(
      "SELECT * FROM governed_policy_sessions WHERE session_id = ? LIMIT 2 FOR UPDATE",
      [session.session_id],
    );
    const existing = single(existingRows, {
      ambiguousCode: "governed_policy_session_ambiguous",
      ambiguousMessage: "Questionnaire session identity is ambiguous.",
    });
    if (existing) {
      const mapped = mapSession(existing);
      if (mapped.session_binding_sha256 !== session.session_binding_sha256) {
        throw repositoryError("governed_policy_session_identity_conflict", "Session identity is bound to different pinned evidence.");
      }
      return { session: mapped, idempotent_replay: true };
    }
    await connection.query(
      `INSERT INTO governed_policy_sessions
        (session_id, tenant_id, user_id, questionnaire_key, questionnaire_version,
         definition_sha256, domain_key, purpose_key, interaction_mode,
         actor_roles_json, context_snapshot_json, status, revision,
         session_binding_sha256, created_at, expires_at, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        session.session_id,
        session.tenant_id,
        session.user_id,
        session.questionnaire_key,
        session.questionnaire_version,
        session.definition_sha256,
        session.domain_key,
        session.purpose_key,
        session.interaction_mode,
        JSON.stringify(session.actor_roles),
        JSON.stringify(session.context_snapshot),
        session.status,
        session.revision,
        session.session_binding_sha256,
        dbDate(session.created_at),
        dbDate(session.expires_at),
      ],
    );
    return { session, idempotent_replay: false };
  }

  async function readQuestionnaireSessionForUpdate(connection, sessionId) {
    const [rows] = await connection.query(
      "SELECT * FROM governed_policy_sessions WHERE session_id = ? LIMIT 2 FOR UPDATE",
      [sessionId],
    );
    return mapSession(single(rows, {
      missingCode: "governed_policy_session_not_found",
      missingMessage: "Questionnaire session was not found.",
      ambiguousCode: "governed_policy_session_ambiguous",
      ambiguousMessage: "Questionnaire session identity is ambiguous.",
    }));
  }

  async function appendAnswerSet(connection, { answer_set_id: answerSetId, session_id: sessionId, expected_revision: expectedRevision, evidence, source }) {
    const session = await readQuestionnaireSessionForUpdate(connection, sessionId);
    if (session.revision !== expectedRevision) {
      throw repositoryError("governed_policy_session_version_conflict", "Questionnaire session revision changed.", 409, {
        expected_revision: expectedRevision,
        observed_revision: session.revision,
      });
    }
    const nextRevision = session.revision + 1;
    const [existingRows] = await connection.query(
      "SELECT * FROM governed_policy_answers WHERE session_id = ? AND session_revision = ? LIMIT 2",
      [sessionId, nextRevision],
    );
    if (existingRows.length > 1) throw repositoryError("governed_policy_answer_revision_ambiguous", "Answer revision is ambiguous.");
    if (existingRows[0]) {
      if (String(existingRows[0].normalized_answers_sha256) !== evidence.normalized_answers_sha256) {
        throw repositoryError("governed_policy_answer_revision_conflict", "Answer revision is bound to different normalized answers.");
      }
      return { session, answer_set_id: String(existingRows[0].answer_set_id), idempotent_replay: true };
    }
    await connection.query(
      `INSERT INTO governed_policy_answers
        (answer_set_id, session_id, session_revision, normalized_answers_json,
         visible_question_keys_json, normalized_answers_sha256, source,
         created_at, updated_at, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(6), NOW(6), 0)`,
      [
        answerSetId,
        sessionId,
        nextRevision,
        JSON.stringify(evidence.answers),
        JSON.stringify(evidence.visible_question_keys),
        evidence.normalized_answers_sha256,
        source,
      ],
    );
    await connection.query(
      `UPDATE governed_policy_sessions
          SET revision = ?, status = 'ready_for_preview', updated_at = NOW(6)
        WHERE session_id = ? AND revision = ?`,
      [nextRevision, sessionId, expectedRevision],
    );
    return {
      session: Object.freeze({ ...session, revision: nextRevision, status: "ready_for_preview" }),
      answer_set_id: answerSetId,
      idempotent_replay: false,
    };
  }

  async function persistCompiledProposal(connection, { compilation, proposal, answers_evidence: answersEvidence, idempotency_key: idempotencyKey }) {
    const [existingRows] = await connection.query(
      `SELECT p.*, c.compiled_policy_sha256, c.compiled_policy_json, c.safety_bounds_sha256
         FROM governed_policy_proposals p
         JOIN governed_policy_compilations c ON c.compilation_id = p.compilation_id
        WHERE p.tenant_id = ? AND p.idempotency_key = ? LIMIT 2 FOR UPDATE`,
      [proposal.tenant_id, idempotencyKey],
    );
    if (existingRows.length > 1) throw repositoryError("governed_policy_proposal_idempotency_ambiguous", "Proposal idempotency is ambiguous.");
    if (existingRows[0]) return { idempotent_replay: true, proposal: mapProposal(existingRows[0]) };
    await connection.query(
      `INSERT INTO governed_policy_compilations
        (compilation_id, session_id, policy_type, proposed_version, normalized_input_sha256,
         compiled_policy_json, compiled_policy_sha256, safety_validation_json,
         safety_bounds_key, safety_bounds_version, safety_bounds_sha256,
         risk_tier, required_approval_class, typed_confirmation_required,
         impact_preview_json, provenance_json, compilation_sha256, status, created_at, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        compilation.compilation_id,
        compilation.session_id,
        compilation.policy_type,
        compilation.proposed_version,
        compilation.normalized_input_sha256,
        JSON.stringify(compilation.compiled_policy),
        compilation.compiled_policy_sha256,
        JSON.stringify(compilation.safety_validation),
        compilation.safety_bounds_key,
        compilation.safety_bounds_version,
        compilation.safety_bounds_sha256,
        compilation.risk_tier,
        compilation.required_approval_class,
        compilation.typed_confirmation_required ? 1 : 0,
        JSON.stringify(compilation.impact_preview),
        JSON.stringify(compilation.provenance),
        compilation.compilation_sha256,
        compilation.status,
        dbDate(compilation.created_at),
      ],
    );
    await connection.query(
      `INSERT INTO governed_policy_proposals
        (proposal_id, compilation_id, tenant_id, policy_type, proposed_version,
         resource_uri, resource_uri_sha256, status, risk_tier,
         required_approval_class, typed_confirmation_required, proposal_hash_sha256,
         created_by, idempotency_key, answers_evidence_json,
         created_at, updated_at, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        proposal.proposal_id,
        proposal.compilation_id,
        proposal.tenant_id,
        proposal.policy_type,
        proposal.proposed_version,
        proposal.resource_uri,
        sha256Text(proposal.resource_uri),
        proposal.status,
        proposal.risk_tier,
        proposal.required_approval_class,
        proposal.typed_confirmation_required ? 1 : 0,
        proposal.proposal_hash_sha256,
        proposal.created_by,
        idempotencyKey,
        JSON.stringify(answersEvidence ?? {}),
        dbDate(proposal.created_at),
        dbDate(proposal.updated_at),
      ],
    );
    const [rows] = await connection.query(
      `SELECT p.*, c.compiled_policy_sha256, c.compiled_policy_json, c.safety_bounds_sha256
         FROM governed_policy_proposals p
         JOIN governed_policy_compilations c ON c.compilation_id = p.compilation_id
        WHERE p.proposal_id = ? LIMIT 1`,
      [proposal.proposal_id],
    );
    return { idempotent_replay: false, proposal: mapProposal(rows[0]) };
  }

  async function readProposalForUpdate(connection, proposalId) {
    const [rows] = await connection.query(
      `SELECT p.*, c.compiled_policy_sha256, c.compiled_policy_json, c.safety_bounds_sha256
         FROM governed_policy_proposals p
         JOIN governed_policy_compilations c ON c.compilation_id = p.compilation_id
        WHERE p.proposal_id = ? LIMIT 2 FOR UPDATE`,
      [proposalId],
    );
    return mapProposal(single(rows, {
      missingCode: "governed_policy_proposal_not_found",
      missingMessage: "Proposal was not found.",
      ambiguousCode: "governed_policy_proposal_ambiguous",
      ambiguousMessage: "Proposal identity is ambiguous.",
    }));
  }

  async function readApprovalForProposal(connection, proposalId) {
    const [rows] = await connection.query(
      `SELECT * FROM governed_policy_approvals
        WHERE proposal_id = ? ORDER BY created_at DESC, approval_id DESC LIMIT 2 FOR UPDATE`,
      [proposalId],
    );
    if (rows.length > 1 && new Date(rows[0].created_at).getTime() === new Date(rows[1].created_at).getTime()) {
      throw repositoryError("governed_policy_approval_ambiguous", "Latest approval authority is ambiguous.");
    }
    return mapApproval(rows[0]);
  }

  async function appendApproval(connection, approval) {
    const [existingRows] = await connection.query(
      "SELECT * FROM governed_policy_approvals WHERE proposal_id = ? AND idempotency_key = ? LIMIT 2 FOR UPDATE",
      [approval.proposal_id, approval.idempotency_key],
    );
    if (existingRows.length > 1) throw repositoryError("governed_policy_approval_idempotency_ambiguous", "Approval idempotency is ambiguous.");
    if (existingRows[0]) return mapApproval(existingRows[0]);
    await connection.query(
      `INSERT INTO governed_policy_approvals
        (approval_id, proposal_id, tenant_id, resource_uri, resource_uri_sha256,
         proposal_hash_sha256, approval_class, decision, approved_by,
         typed_confirmation_hash, idempotency_key, created_at, expires_at, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        approval.approval_id,
        approval.proposal_id,
        approval.tenant_id,
        approval.resource_uri,
        sha256Text(approval.resource_uri),
        approval.proposal_hash_sha256,
        approval.approval_class,
        approval.decision,
        approval.approved_by,
        approval.typed_confirmation_hash,
        approval.idempotency_key,
        dbDate(approval.created_at),
        dbDate(approval.expires_at),
      ],
    );
    await connection.query(
      "UPDATE governed_policy_proposals SET status = 'approved', updated_at = NOW(6) WHERE proposal_id = ? AND status IN ('submitted','approved')",
      [approval.proposal_id],
    );
    const [rows] = await connection.query("SELECT * FROM governed_policy_approvals WHERE approval_id = ? LIMIT 1", [approval.approval_id]);
    return mapApproval(rows[0]);
  }

  async function preparePolicyActivation(connection, input) {
    const [existingRows] = await connection.query(
      "SELECT * FROM governed_policy_activations WHERE tenant_id = ? AND idempotency_key = ? LIMIT 2 FOR UPDATE",
      [input.tenant_id, input.idempotency_key],
    );
    if (existingRows.length > 1) throw repositoryError("governed_policy_activation_idempotency_ambiguous", "Activation idempotency is ambiguous.");
    if (existingRows[0]) {
      const existing = mapActivation(existingRows[0]);
      if (existing.proposal_id !== input.proposal_id || existing.policy_key !== input.policy_key || existing.policy_version !== input.policy_version || existing.resource_uri !== input.resource_uri) {
        throw repositoryError("governed_policy_activation_idempotency_conflict", "Activation idempotency key is bound to a different operation.");
      }
      return existing;
    }
    const resourceHash = sha256Text(input.resource_uri);
    await connection.query(
      `INSERT INTO governed_policy_versions
        (policy_version_id, tenant_id, policy_key, policy_version, resource_uri,
         resource_uri_sha256, policy_sha256, policy_json, proposal_id, status,
         effective_at, created_at, updated_at, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'activation_pending', ?, NOW(6), NOW(6), 0)
       ON DUPLICATE KEY UPDATE
         policy_sha256 = IF(status = 'activation_pending', VALUES(policy_sha256), policy_sha256),
         policy_json = IF(status = 'activation_pending', VALUES(policy_json), policy_json),
         proposal_id = IF(status = 'activation_pending', VALUES(proposal_id), proposal_id),
         effective_at = IF(status = 'activation_pending', VALUES(effective_at), effective_at),
         updated_at = NOW(6)`,
      [
        randomUUID(), input.tenant_id, input.policy_key, input.policy_version,
        input.resource_uri, resourceHash, input.policy_sha256,
        JSON.stringify(input.compiled_policy), input.proposal_id, dbDate(input.effective_at),
      ],
    );
    await connection.query(
      `INSERT INTO governed_policy_invalidation_outbox
        (event_id, event_type, tenant_id, policy_key, policy_version, resource_uri,
         resource_uri_sha256, policy_sha256, critical, delivery_status,
         payload_json, created_at, updated_at, secrets_included)
       VALUES (?, 'governed_policy_version_activated', ?, ?, ?, ?, ?, ?, 1, 'pending', ?, NOW(6), NOW(6), 0)`,
      [
        input.invalidation_event_id, input.tenant_id, input.policy_key,
        input.policy_version, input.resource_uri, resourceHash, input.policy_sha256,
        JSON.stringify({ proposal_id: input.proposal_id, activation_id: input.activation_id, effective_at: input.effective_at, secrets_included: false }),
      ],
    );
    await connection.query(
      `INSERT INTO governed_policy_activations
        (activation_id, proposal_id, tenant_id, policy_key, policy_version,
         resource_uri, resource_uri_sha256, proposal_hash_sha256, policy_sha256,
         invalidation_event_id, status, idempotency_key,
         created_at, updated_at, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activation_pending', ?, NOW(6), NOW(6), 0)`,
      [
        input.activation_id, input.proposal_id, input.tenant_id, input.policy_key,
        input.policy_version, input.resource_uri, resourceHash,
        input.proposal_hash_sha256, input.policy_sha256,
        input.invalidation_event_id, input.idempotency_key,
      ],
    );
    await connection.query(
      "UPDATE governed_policy_proposals SET status = 'activation_pending', updated_at = NOW(6) WHERE proposal_id = ?",
      [input.proposal_id],
    );
    return Object.freeze({
      activation_id: input.activation_id,
      proposal_id: input.proposal_id,
      tenant_id: input.tenant_id,
      policy_key: input.policy_key,
      policy_version: input.policy_version,
      resource_uri: input.resource_uri,
      policy_sha256: input.policy_sha256,
      invalidation_event_id: input.invalidation_event_id,
      status: "activation_pending",
      idempotency_key: input.idempotency_key,
      rollback_id: null,
      secrets_included: false,
    });
  }

  async function readActivationForUpdate(connection, activationId) {
    const [rows] = await connection.query("SELECT * FROM governed_policy_activations WHERE activation_id = ? LIMIT 2 FOR UPDATE", [activationId]);
    return mapActivation(single(rows, {
      ambiguousCode: "governed_policy_activation_ambiguous",
      ambiguousMessage: "Activation identity is ambiguous.",
    }));
  }

  async function readInvalidationEvent(connection, eventId) {
    const [rows] = await connection.query("SELECT * FROM governed_policy_invalidation_outbox WHERE event_id = ? LIMIT 2 FOR UPDATE", [eventId]);
    const row = single(rows, {
      ambiguousCode: "governed_policy_invalidation_ambiguous",
      ambiguousMessage: "Invalidation event identity is ambiguous.",
    });
    if (!row) return null;
    return Object.freeze({
      event_id: String(row.event_id),
      event_type: String(row.event_type),
      tenant_id: String(row.tenant_id),
      policy_key: String(row.policy_key),
      policy_version: String(row.policy_version),
      resource_uri: String(row.resource_uri),
      policy_sha256: String(row.policy_sha256),
      critical: Number(row.critical) === 1,
      delivery_status: String(row.delivery_status),
      payload_sha256: stableGovernedPolicySha256(parseJson(row.payload_json, {})),
      secrets_included: false,
    });
  }

  async function finalizePolicyActivation(connection, { activation_id: activationId, invalidation_evidence_sha256: evidenceSha, activated_at: activatedAt, rollback_id: rollbackId = null }) {
    const activation = await readActivationForUpdate(connection, activationId);
    if (!activation) throw repositoryError("governed_policy_activation_not_found", "Activation was not found.", 404);
    if (activation.status === "active") return activation;
    if (activation.status !== "activation_pending") throw repositoryError("governed_policy_activation_not_pending", "Activation is not pending.");
    await connection.query(
      `UPDATE governed_policy_versions SET status = 'superseded', superseded_at = ?, updated_at = NOW(6)
        WHERE tenant_id = ? AND policy_key = ? AND resource_uri_sha256 = ?
          AND status = 'active' AND policy_version <> ?`,
      [dbDate(activatedAt), activation.tenant_id, activation.policy_key, sha256Text(activation.resource_uri), activation.policy_version],
    );
    await connection.query(
      `UPDATE governed_policy_versions SET status = 'active', activated_at = ?, superseded_at = NULL, updated_at = NOW(6)
        WHERE tenant_id = ? AND policy_key = ? AND policy_version = ?
          AND resource_uri_sha256 = ? AND resource_uri = ?
          AND status IN ('activation_pending','superseded','active')`,
      [dbDate(activatedAt), activation.tenant_id, activation.policy_key, activation.policy_version, sha256Text(activation.resource_uri), activation.resource_uri],
    );
    await connection.query(
      `UPDATE governed_policy_activations SET status = 'active', invalidation_evidence_sha256 = ?, activated_at = ?, updated_at = NOW(6)
        WHERE activation_id = ?`,
      [evidenceSha, dbDate(activatedAt), activationId],
    );
    await connection.query(
      `UPDATE governed_policy_invalidation_outbox SET delivery_status = 'published', delivered_at = ?, evidence_sha256 = ?, updated_at = NOW(6)
        WHERE event_id = ?`,
      [dbDate(activatedAt), evidenceSha, activation.invalidation_event_id],
    );
    await connection.query("UPDATE governed_policy_proposals SET status = 'active', updated_at = NOW(6) WHERE proposal_id = ?", [activation.proposal_id]);
    if (rollbackId) {
      await connection.query("UPDATE governed_policy_rollbacks SET status = 'active', activated_at = ?, updated_at = NOW(6) WHERE rollback_id = ?", [dbDate(activatedAt), rollbackId]);
    }
    return Object.freeze({ ...activation, status: "active" });
  }

  async function markActivationFailed(connection, { activation_id: activationId, failure_code: failureCode, failure_message: failureMessage }) {
    const activation = await readActivationForUpdate(connection, activationId);
    if (!activation || activation.status === "active") return activation;
    await connection.query(
      "UPDATE governed_policy_activations SET status = 'failed', failure_code = ?, failure_message = ?, updated_at = NOW(6) WHERE activation_id = ?",
      [String(failureCode).slice(0, 191), String(failureMessage).slice(0, 1_000), activationId],
    );
    await connection.query(
      `UPDATE governed_policy_versions SET status = 'activation_failed', updated_at = NOW(6)
        WHERE tenant_id = ? AND policy_key = ? AND policy_version = ?
          AND resource_uri_sha256 = ? AND resource_uri = ? AND status = 'activation_pending'`,
      [activation.tenant_id, activation.policy_key, activation.policy_version, sha256Text(activation.resource_uri), activation.resource_uri],
    );
    await connection.query(
      "UPDATE governed_policy_invalidation_outbox SET delivery_status = 'failed', error_code = ?, error_message = ?, updated_at = NOW(6) WHERE event_id = ?",
      [String(failureCode).slice(0, 191), String(failureMessage).slice(0, 1_000), activation.invalidation_event_id],
    );
    return Object.freeze({ ...activation, status: "failed" });
  }

  async function readActivePolicyVersion({ tenant_id: tenantId, policy_key: policyKey, resource_uri: resourceUri }) {
    const [rows] = await pool.query(
      `SELECT * FROM governed_policy_versions
        WHERE tenant_id = ? AND policy_key = ? AND resource_uri_sha256 = ?
          AND resource_uri = ? AND status = 'active'
        ORDER BY activated_at DESC, updated_at DESC LIMIT 2`,
      [tenantId, policyKey, sha256Text(resourceUri), resourceUri],
    );
    return mapPolicyVersion(single(rows, {
      ambiguousCode: "governed_policy_active_version_ambiguous",
      ambiguousMessage: "Active policy authority is ambiguous.",
    }));
  }

  async function readPolicyVersion({ tenant_id: tenantId, policy_key: policyKey, policy_version: policyVersion, resource_uri: resourceUri }) {
    const [rows] = await pool.query(
      `SELECT * FROM governed_policy_versions
        WHERE tenant_id = ? AND policy_key = ? AND policy_version = ?
          AND resource_uri_sha256 = ? AND resource_uri = ? LIMIT 2`,
      [tenantId, policyKey, policyVersion, sha256Text(resourceUri), resourceUri],
    );
    return mapPolicyVersion(single(rows, {
      ambiguousCode: "governed_policy_version_ambiguous",
      ambiguousMessage: "Policy version identity is ambiguous.",
    }));
  }

  async function preparePolicyRollback(connection, input) {
    const [existingRows] = await connection.query(
      `SELECT r.*, a.activation_id, a.invalidation_event_id, a.policy_sha256
         FROM governed_policy_rollbacks r
         JOIN governed_policy_activations a ON a.rollback_id = r.rollback_id
        WHERE r.tenant_id = ? AND r.idempotency_key = ? LIMIT 2 FOR UPDATE`,
      [input.tenant_id, input.idempotency_key],
    );
    if (existingRows.length > 1) throw repositoryError("governed_policy_rollback_idempotency_ambiguous", "Rollback idempotency is ambiguous.");
    if (existingRows[0]) {
      return Object.freeze({
        rollback_id: String(existingRows[0].rollback_id),
        activation_id: String(existingRows[0].activation_id),
        invalidation_event_id: String(existingRows[0].invalidation_event_id),
        policy_sha256: String(existingRows[0].policy_sha256),
        secrets_included: false,
      });
    }
    const resourceHash = sha256Text(input.resource_uri);
    const [activeRows] = await connection.query(
      `SELECT * FROM governed_policy_versions
        WHERE tenant_id = ? AND policy_key = ? AND policy_version = ?
          AND resource_uri_sha256 = ? AND resource_uri = ? AND status = 'active' LIMIT 2 FOR UPDATE`,
      [input.tenant_id, input.policy_key, input.active_version, resourceHash, input.resource_uri],
    );
    if (activeRows.length !== 1) throw repositoryError("governed_policy_rollback_active_version_mismatch", "Exact active version was not found.");
    const [targetRows] = await connection.query(
      `SELECT * FROM governed_policy_versions
        WHERE tenant_id = ? AND policy_key = ? AND policy_version = ?
          AND resource_uri_sha256 = ? AND resource_uri = ? AND status IN ('superseded','active') LIMIT 2 FOR UPDATE`,
      [input.tenant_id, input.policy_key, input.target_version, resourceHash, input.resource_uri],
    );
    if (targetRows.length !== 1) throw repositoryError("governed_policy_rollback_target_invalid", "Exact rollback target was not found.");
    const target = mapPolicyVersion(targetRows[0]);
    const activationId = randomUUID();
    await connection.query(
      `INSERT INTO governed_policy_rollbacks
        (rollback_id, tenant_id, policy_key, active_version, target_version,
         resource_uri, resource_uri_sha256, approved_proposal_id,
         proposal_hash_sha256, invalidation_event_id, status,
         idempotency_key, created_at, updated_at, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activation_pending', ?, ?, ?, 0)`,
      [
        input.rollback_id, input.tenant_id, input.policy_key, input.active_version,
        input.target_version, input.resource_uri, resourceHash,
        input.approved_proposal_id, input.proposal_hash_sha256,
        input.invalidation_event_id, input.idempotency_key,
        dbDate(input.created_at), dbDate(input.created_at),
      ],
    );
    await connection.query(
      `INSERT INTO governed_policy_invalidation_outbox
        (event_id, event_type, tenant_id, policy_key, policy_version,
         resource_uri, resource_uri_sha256, policy_sha256, critical,
         delivery_status, payload_json, created_at, updated_at, secrets_included)
       VALUES (?, 'governed_policy_version_rollback', ?, ?, ?, ?, ?, ?, 1, 'pending', ?, NOW(6), NOW(6), 0)`,
      [
        input.invalidation_event_id, input.tenant_id, input.policy_key,
        input.target_version, input.resource_uri, resourceHash, target.policy_sha256,
        JSON.stringify({ rollback_id: input.rollback_id, activation_id: activationId, previous_policy_version: input.active_version, secrets_included: false }),
      ],
    );
    await connection.query(
      `INSERT INTO governed_policy_activations
        (activation_id, proposal_id, tenant_id, policy_key, policy_version,
         resource_uri, resource_uri_sha256, proposal_hash_sha256, policy_sha256,
         invalidation_event_id, status, idempotency_key, rollback_id,
         created_at, updated_at, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activation_pending', ?, ?, NOW(6), NOW(6), 0)`,
      [
        activationId, input.approved_proposal_id, input.tenant_id,
        input.policy_key, input.target_version, input.resource_uri, resourceHash,
        input.proposal_hash_sha256, target.policy_sha256,
        input.invalidation_event_id, input.idempotency_key, input.rollback_id,
      ],
    );
    return Object.freeze({
      rollback_id: input.rollback_id,
      activation_id: activationId,
      invalidation_event_id: input.invalidation_event_id,
      policy_sha256: target.policy_sha256,
      secrets_included: false,
    });
  }

  return Object.freeze({
    withTransaction,
    readActiveQuestionnaireDefinition,
    readQuestionnaireDefinitionVersion,
    readActiveSafetyBounds,
    readDomainAdoption,
    createQuestionnaireSession,
    readQuestionnaireSessionForUpdate,
    appendAnswerSet,
    persistCompiledProposal,
    readProposalForUpdate,
    readApprovalForProposal,
    appendApproval,
    preparePolicyActivation,
    readActivationForUpdate,
    finalizePolicyActivation,
    markActivationFailed,
    readActivePolicyVersion,
    readPolicyVersion,
    preparePolicyRollback,
    readInvalidationEvent,
  });
}

export const governedPolicyRepositoryContract = Object.freeze({
  version: "governed-policy-sql-repository-v2",
  questionnaire_definition_registry: true,
  safety_bound_registry: true,
  domain_adoption_registry: true,
  pinned_session_and_answer_revisions: true,
  transaction_bound_mutations: true,
  exact_tenant_policy_resource_version_identity: true,
  resource_uri_hash_plus_exact_value: true,
  idempotent_proposal_approval_activation_rollback: true,
  critical_invalidation_outbox_before_activation_fk: true,
  activation_pending_before_invalidation: true,
  exact_active_registry_readback: true,
  external_tenant_foreign_key_created: false,
  provider_dispatch_performed: false,
  secrets_included: false,
});
