import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { proposeAdsProviderGovernanceSnapshot } from "./adsProviderGovernanceSnapshotProposal.js";

function normalizeKey(value, fieldName, max = 191) {
  const key = String(value || "").trim();
  if (!key || key.length > max || !/^[A-Za-z0-9_.:-]+$/.test(key)) {
    const err = new Error(`${fieldName} must be a non-empty safe key.`);
    err.status = 400;
    err.code = `invalid_${fieldName}`;
    throw err;
  }
  return key;
}

function normalizeSha256(value) {
  const hash = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    const err = new Error("candidate_sha256 must be a 64-character SHA-256 hex string.");
    err.status = 400;
    err.code = "invalid_candidate_sha256";
    throw err;
  }
  return hash;
}

function bool(value) {
  return value === true || ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function json(value) {
  return JSON.stringify(value ?? null);
}

async function requireReadyCapabilityEnvelope({ envelopeId }) {
  const [rows] = await getPool().query(
    `SELECT envelope_id, envelope_status, decision, dispatch_allowed, apply_allowed,
            blocking_gap_count, expires_at, secrets_included, capability_key,
            operation_intent, selected_runtime_surface, requested_by
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id = ?
      LIMIT 1`,
    [envelopeId]
  );
  const envelope = rows[0] || null;
  if (!envelope) {
    const err = new Error("capability envelope was not found.");
    err.status = 403;
    err.code = "capability_envelope_not_found";
    throw err;
  }
  const expired = envelope.expires_at && new Date(envelope.expires_at).getTime() <= Date.now();
  if (expired || envelope.envelope_status !== "ready_for_dispatch" || Number(envelope.dispatch_allowed) !== 1 || Number(envelope.blocking_gap_count) !== 0 || Number(envelope.secrets_included) !== 0) {
    const err = new Error("capability envelope is not ready for dispatch.");
    err.status = 403;
    err.code = "capability_envelope_not_ready";
    err.details = {
      envelope_id: envelope.envelope_id,
      envelope_status: envelope.envelope_status,
      decision: envelope.decision,
      dispatch_allowed: Boolean(envelope.dispatch_allowed),
      blocking_gap_count: envelope.blocking_gap_count,
      expired,
      secrets_included: Boolean(envelope.secrets_included),
    };
    throw err;
  }
  return envelope;
}

async function readRecordedRows({ snapshotKey, recommendationKey }) {
  const [[snapshotRows], [recommendationRows]] = await Promise.all([
    getPool().query(
      `SELECT snapshot_id, snapshot_key, plugin_key, scope_type, scope_id, subject_key,
              state_classification, maturity_score, status, secrets_included,
              created_at, updated_at
         FROM platform_orchestration_state_snapshots
        WHERE snapshot_key = ?
        LIMIT 1`,
      [snapshotKey]
    ),
    getPool().query(
      `SELECT recommendation_id, recommendation_key, snapshot_id, plugin_key,
              task_class, recommendation_type, priority, recommendation_status,
              secrets_included, created_at, updated_at
         FROM platform_orchestration_recommendations
        WHERE recommendation_key = ?
        LIMIT 1`,
      [recommendationKey]
    ),
  ]);
  return {
    snapshot: snapshotRows[0] || null,
    recommendation: recommendationRows[0] || null,
  };
}

export async function recordAdsProviderGovernanceSnapshot(input = {}) {
  const providerKey = normalizeKey(input.provider_key || input.providerKey || "google_ads", "provider_key", 128);
  const candidateSha256 = normalizeSha256(input.candidate_sha256 || input.candidateSha256);
  const idempotencyKey = normalizeKey(input.idempotency_key || input.idempotencyKey, "idempotency_key", 80);
  const capabilityEnvelopeId = normalizeKey(input.capability_envelope_id || input.capabilityEnvelopeId, "capability_envelope_id", 36);
  const apply = bool(input.apply);

  const proposal = await proposeAdsProviderGovernanceSnapshot({ provider_key: providerKey });
  if (proposal.candidate_sha256 !== candidateSha256) {
    const err = new Error("candidate_sha256 does not match the current recomputed proposal.");
    err.status = 409;
    err.code = "candidate_sha256_mismatch";
    err.details = {
      provider_key: providerKey,
      expected_candidate_sha256: proposal.candidate_sha256,
      received_candidate_sha256: candidateSha256,
      secrets_included: false,
    };
    throw err;
  }

  const envelope = await requireReadyCapabilityEnvelope({ envelopeId: capabilityEnvelopeId });
  const snapshotCandidate = proposal.snapshot_candidate;
  const recommendationCandidate = proposal.recommendation_candidate;
  const snapshotKey = `${snapshotCandidate.snapshot_key}:record:${idempotencyKey}`;
  const recommendationKey = `${recommendationCandidate.recommendation_key}:record:${idempotencyKey}`;

  if (!apply) {
    return {
      ok: true,
      mode: "record_dry_run",
      provider_key: providerKey,
      plugin_key: proposal.plugin_key,
      candidate_sha256: candidateSha256,
      idempotency_key: idempotencyKey,
      capability_envelope_id: capabilityEnvelopeId,
      would_record_snapshot: true,
      would_record_recommendation: true,
      snapshot_key: snapshotKey,
      recommendation_key: recommendationKey,
      envelope: {
        envelope_id: envelope.envelope_id,
        envelope_status: envelope.envelope_status,
        decision: envelope.decision,
        dispatch_allowed: Boolean(envelope.dispatch_allowed),
        apply_allowed: Boolean(envelope.apply_allowed),
        capability_key: envelope.capability_key,
        operation_intent: envelope.operation_intent,
        selected_runtime_surface: envelope.selected_runtime_surface,
      },
      execution: {
        will_record_snapshot: false,
        will_record_recommendation: false,
        will_execute_provider_call: false,
        will_read_credential_payload: false,
        will_change_spend: false,
        will_external_write: false,
        will_deploy: false,
        will_publish: false,
      },
      secrets_included: false,
    };
  }

  if (Number(envelope.apply_allowed) !== 1) {
    const err = new Error("capability envelope is ready for dispatch but not apply-allowed for snapshot recording.");
    err.status = 403;
    err.code = "capability_envelope_apply_not_allowed";
    err.details = {
      envelope_id: envelope.envelope_id,
      envelope_status: envelope.envelope_status,
      decision: envelope.decision,
      dispatch_allowed: Boolean(envelope.dispatch_allowed),
      apply_allowed: Boolean(envelope.apply_allowed),
      secrets_included: false,
    };
    throw err;
  }

  const snapshotId = randomUUID();
  const recommendationId = randomUUID();
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO platform_orchestration_state_snapshots (
         snapshot_id, snapshot_key, plugin_key, scope_type, scope_id, tenant_id,
         workspace_id, brand_key, subject_key, state_classification, maturity_score,
         input_sources_json, state_json, maturity_json, blockers_json, safety_json,
         decision_run_id, produced_by_engine_key, status, secrets_included
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'recorded', 0)
       ON DUPLICATE KEY UPDATE
         updated_at = CURRENT_TIMESTAMP,
         status = 'recorded'`,
      [
        snapshotId,
        snapshotKey,
        snapshotCandidate.plugin_key,
        snapshotCandidate.scope_type || "platform",
        snapshotCandidate.scope_id || null,
        snapshotCandidate.tenant_id || null,
        snapshotCandidate.workspace_id || null,
        snapshotCandidate.brand_key || null,
        snapshotCandidate.subject_key || providerKey,
        snapshotCandidate.state_classification,
        snapshotCandidate.maturity_score,
        json(snapshotCandidate.input_sources),
        json(snapshotCandidate.state),
        json(snapshotCandidate.maturity),
        json(snapshotCandidate.blockers),
        json({ ...snapshotCandidate.safety, candidate_sha256: candidateSha256, idempotency_key: idempotencyKey, capability_envelope_id: capabilityEnvelopeId }),
        "orchestration_intelligence_engine",
      ]
    );
    const [snapshotRows] = await conn.query(
      `SELECT snapshot_id FROM platform_orchestration_state_snapshots WHERE snapshot_key = ? LIMIT 1`,
      [snapshotKey]
    );
    const recordedSnapshotId = snapshotRows[0]?.snapshot_id || snapshotId;

    await conn.query(
      `INSERT INTO platform_orchestration_recommendations (
         recommendation_id, recommendation_key, snapshot_id, plugin_key, scope_type,
         scope_id, task_class, recommendation_type, priority, recommendation_status,
         decision_json, blockers_json, next_actions_json, safety_contract_json,
         decision_run_id, produced_by_engine_key, secrets_included
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, NULL, ?, 0)
       ON DUPLICATE KEY UPDATE
         snapshot_id = VALUES(snapshot_id),
         updated_at = CURRENT_TIMESTAMP,
         recommendation_status = 'proposed'`,
      [
        recommendationId,
        recommendationKey,
        recordedSnapshotId,
        recommendationCandidate.plugin_key,
        recommendationCandidate.scope_type || "platform",
        recommendationCandidate.scope_id || null,
        recommendationCandidate.task_class,
        recommendationCandidate.recommendation_type,
        recommendationCandidate.priority,
        json(recommendationCandidate.decision),
        json(recommendationCandidate.blockers),
        json(recommendationCandidate.next_actions),
        json({ ...recommendationCandidate.safety_contract, candidate_sha256: candidateSha256, idempotency_key: idempotencyKey, capability_envelope_id: capabilityEnvelopeId }),
        "orchestration_intelligence_engine",
      ]
    );
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    conn.release();
  }

  const recorded = await readRecordedRows({ snapshotKey, recommendationKey });
  return {
    ok: true,
    mode: "recorded",
    provider_key: providerKey,
    plugin_key: proposal.plugin_key,
    candidate_sha256: candidateSha256,
    idempotency_key: idempotencyKey,
    capability_envelope_id: capabilityEnvelopeId,
    snapshot_key: snapshotKey,
    recommendation_key: recommendationKey,
    recorded,
    execution: {
      will_record_snapshot: true,
      will_record_recommendation: true,
      will_execute_provider_call: false,
      will_read_credential_payload: false,
      will_change_spend: false,
      will_external_write: false,
      will_deploy: false,
      will_publish: false,
    },
    secrets_included: false,
  };
}
