import { createHash, randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const SIGNAL_KEY_PATTERN = /^[A-Za-z0-9_.:-]{3,128}$/;
const ALLOWED_STATUSES = new Set(["success", "failure", "cancelled", "timed_out", "action_required"]);
const FAILURE_STATUSES = new Set(["failure", "cancelled", "timed_out", "action_required"]);
const ALLOWED_SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);
const OPEN_LIFECYCLE_STATES = new Set(["open", "acknowledged", "investigating"]);
const DEFAULT_SIGNAL_KEY = "custom_gpt_contract_guard";
const DEFAULT_TARGETS = Object.freeze({
  minimum_successful_runs_24h: 1,
  maximum_detection_seconds: 300,
  maximum_recovery_seconds: 3600,
});
const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|authorization|cookie|payload_json)/i;

function boundedText(value, max, fallback = null) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : fallback;
}

function parseDate(value, fallback = null) {
  const date = value ? new Date(value) : fallback ? new Date(fallback) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date;
}

function dbDate(value) {
  const date = value instanceof Date ? value : parseDate(value);
  return date ? date.toISOString().slice(0, 19).replace("T", " ") : null;
}

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function sanitizeEvidence(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeEvidence(entry, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
        .slice(0, 80)
        .map(([key, entry]) => [key, sanitizeEvidence(entry, depth + 1)])
    );
  }
  if (typeof value === "string") return value.slice(0, 4000);
  return value;
}

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

export function normalizeCiGuardSignal(input = {}, now = new Date()) {
  const signalKey = boundedText(input.signal_key, 128, DEFAULT_SIGNAL_KEY);
  if (!SIGNAL_KEY_PATTERN.test(signalKey)) {
    fail("invalid_ci_guard_signal_key", "signal_key must contain only letters, numbers, dots, colons, underscores, or hyphens.");
  }
  const status = boundedText(input.status, 32, "").toLowerCase();
  if (!ALLOWED_STATUSES.has(status)) {
    fail("invalid_ci_guard_signal_status", "status must be success, failure, cancelled, timed_out, or action_required.");
  }
  const idempotencyKey = boundedText(input.idempotency_key, 191);
  if (!idempotencyKey) fail("ci_guard_idempotency_key_required", "idempotency_key is required.");
  const workflowRunId = boundedText(input.workflow_run_id, 64);
  if (!workflowRunId) fail("ci_guard_workflow_run_id_required", "workflow_run_id is required.");
  const observedAt = parseDate(input.observed_at, now);
  if (!observedAt) fail("invalid_ci_guard_observed_at", "observed_at must be an ISO 8601 timestamp.");
  const startedAt = parseDate(input.started_at);
  if (startedAt && startedAt > observedAt) {
    fail("invalid_ci_guard_started_at", "started_at cannot be after observed_at.");
  }
  const severity = ALLOWED_SEVERITIES.has(String(input.severity || "").toLowerCase())
    ? String(input.severity).toLowerCase()
    : FAILURE_STATUSES.has(status) ? "high" : "info";
  const sourceRef = boundedText(input.source_ref, 255);
  const alertKey = `ci_guard.${signalKey}`.slice(0, 191);
  const detectionSeconds = startedAt
    ? Math.max(0, Math.round((observedAt.getTime() - startedAt.getTime()) / 1000))
    : null;
  return {
    signal_key: signalKey,
    alert_key: alertKey,
    fingerprint_sha256: sha256(alertKey),
    status,
    failure: FAILURE_STATUSES.has(status),
    idempotency_key: idempotencyKey,
    workflow_name: boundedText(input.workflow_name, 191, "Custom GPT Contract Guard"),
    workflow_run_id: workflowRunId,
    workflow_attempt: Math.max(1, Number.parseInt(input.workflow_attempt, 10) || 1),
    job_name: boundedText(input.job_name, 191, "guard"),
    source_ref: sourceRef,
    commit_sha: boundedText(input.commit_sha, 64),
    ref_name: boundedText(input.ref_name, 255),
    started_at: startedAt,
    observed_at: observedAt,
    detection_seconds: detectionSeconds,
    severity,
    title: boundedText(input.title, 512, `${signalKey} CI guard failed`),
    summary: boundedText(input.summary, 4000, `CI guard result: ${status}.`),
    evidence: sanitizeEvidence(input.evidence || {}),
  };
}

function objectiveStatus(sampleCount, value, target, { noSamples = "not_applicable" } = {}) {
  if (!sampleCount) return noSamples;
  return Number(value) <= Number(target) ? "pass" : "fail";
}

export function deriveRecoverySamples(events = []) {
  const chronological = [...events]
    .map((event) => ({ event, observedAt: parseDate(event?.observed_at) }))
    .filter((entry) => entry.observedAt)
    .sort((a, b) => a.observedAt - b.observedAt);
  const samples = [];
  let incidentStartedAt = null;
  for (const { event, observedAt } of chronological) {
    if (FAILURE_STATUSES.has(String(event?.status || "").toLowerCase())) {
      incidentStartedAt ||= observedAt;
      continue;
    }
    if (String(event?.status || "").toLowerCase() === "success" && incidentStartedAt) {
      samples.push(Math.max(0, Math.round((observedAt.getTime() - incidentStartedAt.getTime()) / 1000)));
      incidentStartedAt = null;
    }
  }
  return samples;
}

export function calculateCiGuardSlo(events = [], currentAlert = null, {
  generatedAt = new Date(),
  targets = DEFAULT_TARGETS,
} = {}) {
  const normalizedEvents = [...events].sort((a, b) => new Date(b.observed_at || 0) - new Date(a.observed_at || 0));
  const successes = normalizedEvents.filter((event) => event.status === "success");
  const failures = normalizedEvents.filter((event) => FAILURE_STATUSES.has(event.status));
  const detectionSamples = failures.map((event) => Number(event.detection_seconds)).filter(Number.isFinite);
  const recoverySamples = deriveRecoverySamples(normalizedEvents);
  const maxDetection = detectionSamples.length ? Math.max(...detectionSamples) : null;
  const averageDetection = detectionSamples.length
    ? Math.round(detectionSamples.reduce((sum, value) => sum + value, 0) / detectionSamples.length)
    : null;
  const maxRecovery = recoverySamples.length ? Math.max(...recoverySamples) : null;
  const averageRecovery = recoverySamples.length
    ? Math.round(recoverySamples.reduce((sum, value) => sum + value, 0) / recoverySamples.length)
    : null;
  const dailyStatus = successes.length >= targets.minimum_successful_runs_24h ? "pass" : "fail";
  const detectionStatus = objectiveStatus(detectionSamples.length, maxDetection, targets.maximum_detection_seconds);
  const unresolvedFailure = currentAlert && OPEN_LIFECYCLE_STATES.has(currentAlert.lifecycle_status);
  const recoveryStatus = unresolvedFailure
    ? "fail"
    : objectiveStatus(recoverySamples.length, maxRecovery, targets.maximum_recovery_seconds);
  const objectiveStatuses = [dailyStatus, detectionStatus, recoveryStatus];
  const overallStatus = normalizedEvents.length === 0
    ? "no_data"
    : objectiveStatuses.includes("fail") ? "fail" : "pass";
  return {
    ok: overallStatus !== "fail",
    signal_key: normalizedEvents[0]?.signal_key || DEFAULT_SIGNAL_KEY,
    generated_at: generatedAt.toISOString(),
    lookback_hours: 24,
    overall_status: overallStatus,
    current_alert: currentAlert ? {
      alert_id: currentAlert.alert_id || null,
      lifecycle_status: currentAlert.lifecycle_status || null,
      severity: currentAlert.severity || null,
      first_seen_at: currentAlert.first_seen_at || null,
      last_seen_at: currentAlert.last_seen_at || null,
      resolved_at: currentAlert.resolved_at || null,
    } : null,
    counts: {
      total_runs_24h: normalizedEvents.length,
      successful_runs_24h: successes.length,
      failed_runs_24h: failures.length,
    },
    objectives: {
      daily_success: {
        status: dailyStatus,
        target_minimum_runs: targets.minimum_successful_runs_24h,
        actual_runs: successes.length,
      },
      detection_time: {
        status: detectionStatus,
        target_maximum_seconds: targets.maximum_detection_seconds,
        sample_count: detectionSamples.length,
        average_seconds: averageDetection,
        maximum_seconds: maxDetection,
      },
      recovery_time: {
        status: recoveryStatus,
        target_maximum_seconds: targets.maximum_recovery_seconds,
        sample_count: recoverySamples.length,
        average_seconds: averageRecovery,
        maximum_seconds: maxRecovery,
      },
    },
    latest_run: normalizedEvents[0] ? sanitizeEvidence(normalizedEvents[0]) : null,
    secrets_included: false,
  };
}

export async function readCiGuardSlo({
  signalKey = DEFAULT_SIGNAL_KEY,
  lookbackHours = 24,
  pool = getPool(),
} = {}) {
  const normalizedSignalKey = SIGNAL_KEY_PATTERN.test(String(signalKey || "")) ? String(signalKey) : DEFAULT_SIGNAL_KEY;
  const boundedLookback = Math.max(1, Math.min(168, Number.parseInt(lookbackHours, 10) || 24));
  const [events] = await pool.query(
    `SELECT signal_key, status, workflow_run_id, workflow_attempt, source_ref, commit_sha, ref_name,
            started_at, observed_at, detection_seconds, recovery_seconds
       FROM operational_alert_ci_signal_events
      WHERE signal_key = ? AND observed_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? HOUR)
      ORDER BY observed_at DESC
      LIMIT 500`,
    [normalizedSignalKey, boundedLookback]
  );
  const [alerts] = await pool.query(
    `SELECT alert_id, lifecycle_status, severity, first_seen_at, last_seen_at, resolved_at
       FROM operational_alerts
      WHERE alert_key = ?
      LIMIT 1`,
    [`ci_guard.${normalizedSignalKey}`.slice(0, 191)]
  );
  const result = calculateCiGuardSlo(events || [], alerts?.[0] || null);
  return { ...result, lookback_hours: boundedLookback };
}

async function insertLifecycleEvent(connection, {
  alert,
  fromStatus,
  toStatus,
  actor,
  note,
  idempotencyKey,
  evidence,
}) {
  if (!alert?.alert_id || fromStatus === toStatus) return null;
  const eventId = randomUUID();
  await connection.query(
    `INSERT INTO operational_alert_lifecycle_events
      (event_id, alert_id, alert_key, tenant_id, user_id, workspace_id, source_type, source_record_id,
       from_status, to_status, lifecycle_revision, event_type, actor_id, actor_type, note, idempotency_key,
       operation_fingerprint_sha256, resource_fingerprint_sha256, evidence_json, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lifecycle_status_changed', ?, 'ci_guard_signal', ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE event_id = event_id`,
    [
      eventId,
      alert.alert_id,
      alert.alert_key,
      alert.tenant_id || null,
      alert.user_id || null,
      alert.workspace_id || null,
      alert.source_type || "ci_guard_signal",
      alert.source_record_id || null,
      fromStatus,
      toStatus,
      Number(alert.lifecycle_revision || 0) + 1,
      actor,
      note,
      idempotencyKey,
      alert.operation_fingerprint_sha256 || null,
      alert.resource_fingerprint_sha256 || null,
      JSON.stringify(sanitizeEvidence(evidence || {})),
    ]
  );
  return eventId;
}

export async function ingestCiGuardSignal({
  input,
  requestedBy = "github_actions",
  pool = getPool(),
} = {}) {
  const signal = normalizeCiGuardSignal(input || {});
  const connection = await pool.getConnection();
  let idempotentReplay = false;
  let eventId = null;
  let alertId = null;
  let recoverySeconds = null;
  try {
    await connection.beginTransaction();
    const [existingEvents] = await connection.query(
      `SELECT event_id, alert_id, status, detection_seconds, recovery_seconds
         FROM operational_alert_ci_signal_events
        WHERE idempotency_key = ?
        LIMIT 1
        FOR UPDATE`,
      [signal.idempotency_key]
    );
    if (existingEvents[0]) {
      idempotentReplay = true;
      eventId = existingEvents[0].event_id;
      alertId = existingEvents[0].alert_id || null;
      recoverySeconds = existingEvents[0].recovery_seconds ?? null;
      await connection.commit();
    } else {
      const [currentRows] = await connection.query(
        `SELECT alert_id, alert_key, fingerprint_sha256, operation_fingerprint_sha256,
                resource_fingerprint_sha256, tenant_id, user_id, workspace_id, source_type,
                source_record_id, lifecycle_status, lifecycle_revision, severity,
                first_seen_at, last_seen_at, resolved_at, occurrence_count
           FROM operational_alerts
          WHERE alert_key = ?
          LIMIT 1
          FOR UPDATE`,
        [signal.alert_key]
      );
      const current = currentRows[0] || null;
      const actor = boundedText(requestedBy, 191, "github_actions");
      const note = signal.failure
        ? `CI guard reported ${signal.status} in workflow run ${signal.workflow_run_id}.`
        : `CI guard recovered in workflow run ${signal.workflow_run_id}.`;
      if (signal.failure) {
        alertId = current?.alert_id || randomUUID();
        await connection.query(
          `INSERT INTO operational_alerts
            (alert_id, alert_key, fingerprint_sha256, tenant_id, user_id, workspace_id, container_key,
             source_type, source_ref, source_record_id, category, severity, title, summary, reason_code,
             lifecycle_status, verification_state, evidence_type, evidence_ref, evidence_json,
             occurrence_count, first_seen_at, last_seen_at, recommended_action_key,
             requires_confirmation, manual_known_issue, lifecycle_actor, lifecycle_note,
             resolved_at, resolution_note, secrets_included)
           VALUES (?, ?, ?, NULL, NULL, NULL, 'platform:ci-guard', 'ci_guard_signal', ?, ?,
                   'ci_guard', ?, ?, ?, 'ci_guard_failure', 'open', 'verified', 'github_workflow_run', ?, ?,
                   1, ?, ?, 'ci_guard.review_failure', 0, 0, ?, ?, NULL, NULL, 0)
           ON DUPLICATE KEY UPDATE
             lifecycle_revision = lifecycle_revision + IF(lifecycle_status IN ('resolved','ignored'), 1, 0),
             lifecycle_status = 'open', severity = VALUES(severity), title = VALUES(title),
             summary = VALUES(summary), source_ref = VALUES(source_ref), evidence_ref = VALUES(evidence_ref),
             evidence_json = VALUES(evidence_json), occurrence_count = occurrence_count + 1,
             first_seen_at = LEAST(first_seen_at, VALUES(first_seen_at)),
             last_seen_at = GREATEST(last_seen_at, VALUES(last_seen_at)),
             lifecycle_actor = VALUES(lifecycle_actor), lifecycle_note = VALUES(lifecycle_note),
             resolved_at = NULL, resolution_note = NULL, updated_at = CURRENT_TIMESTAMP`,
          [
            alertId,
            signal.alert_key,
            signal.fingerprint_sha256,
            signal.source_ref,
            signal.signal_key,
            signal.severity,
            signal.title,
            signal.summary,
            signal.source_ref,
            JSON.stringify(signal.evidence),
            dbDate(signal.observed_at),
            dbDate(signal.observed_at),
            actor,
            note,
          ]
        );
        const [alertRows] = await connection.query(
          `SELECT * FROM operational_alerts WHERE alert_key = ? LIMIT 1`,
          [signal.alert_key]
        );
        const alert = alertRows[0];
        alertId = alert?.alert_id || alertId;
        if (current && !OPEN_LIFECYCLE_STATES.has(current.lifecycle_status)) {
          await insertLifecycleEvent(connection, {
            alert: current,
            fromStatus: current.lifecycle_status,
            toStatus: "open",
            actor,
            note,
            idempotencyKey: `${signal.idempotency_key}:reopen`.slice(0, 191),
            evidence: { workflow_run_id: signal.workflow_run_id, status: signal.status },
          });
        }
        await connection.query(
          `INSERT INTO operational_alert_notification_outbox
            (notification_id, notification_key, alert_id, tenant_id, user_id, channel,
             recipient_scope, delivery_status, payload_summary_json, created_at, updated_at)
           VALUES (?, ?, ?, NULL, NULL, 'in_app', 'platform_admin', 'pending', ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
           ON DUPLICATE KEY UPDATE alert_id = VALUES(alert_id),
             payload_summary_json = VALUES(payload_summary_json),
             delivery_status = IF(delivery_status IN ('skipped','failed'), 'pending', delivery_status),
             error_code = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP`,
          [
            randomUUID(),
            `${signal.alert_key}:open`.slice(0, 255),
            alertId,
            JSON.stringify({ title: signal.title, severity: signal.severity, reason_code: "ci_guard_failure" }),
          ]
        );
      } else if (current && OPEN_LIFECYCLE_STATES.has(current.lifecycle_status)) {
        alertId = current.alert_id;
        const observedAtDb = dbDate(signal.observed_at);
        const [previousSuccessRows] = await connection.query(
          `SELECT MAX(observed_at) AS last_success_at
             FROM operational_alert_ci_signal_events
            WHERE signal_key = ? AND status = 'success' AND observed_at < ?`,
          [signal.signal_key, observedAtDb]
        );
        const previousSuccessAt = dbDate(previousSuccessRows?.[0]?.last_success_at)
          || "1970-01-01 00:00:00";
        const [incidentRows] = await connection.query(
          `SELECT MIN(observed_at) AS incident_started_at
             FROM operational_alert_ci_signal_events
            WHERE signal_key = ?
              AND status IN ('failure','cancelled','timed_out','action_required')
              AND observed_at > ?
              AND observed_at < ?`,
          [signal.signal_key, previousSuccessAt, observedAtDb]
        );
        const incidentStartedAt = parseDate(incidentRows?.[0]?.incident_started_at)
          || parseDate(current.last_seen_at)
          || parseDate(current.first_seen_at)
          || signal.observed_at;
        recoverySeconds = Math.max(0, Math.round(
          (signal.observed_at.getTime() - incidentStartedAt.getTime()) / 1000
        ));
        await connection.query(
          `UPDATE operational_alerts
              SET lifecycle_status = 'resolved', lifecycle_revision = lifecycle_revision + 1,
                  lifecycle_actor = ?, lifecycle_note = ?, resolved_at = ?, resolution_note = ?,
                  last_seen_at = GREATEST(last_seen_at, ?), updated_at = CURRENT_TIMESTAMP
            WHERE alert_id = ?`,
          [actor, note, dbDate(signal.observed_at), note, dbDate(signal.observed_at), current.alert_id]
        );
        await insertLifecycleEvent(connection, {
          alert: current,
          fromStatus: current.lifecycle_status,
          toStatus: "resolved",
          actor,
          note,
          idempotencyKey: `${signal.idempotency_key}:resolve`.slice(0, 191),
          evidence: { workflow_run_id: signal.workflow_run_id, recovery_seconds: recoverySeconds },
        });
        await connection.query(
          `UPDATE operational_alert_notification_outbox
              SET delivery_status = 'skipped', error_code = 'ci_guard_recovered',
                  error_message = 'CI guard recovered before notification delivery.', updated_at = CURRENT_TIMESTAMP
            WHERE alert_id = ? AND delivery_status = 'pending'`,
          [current.alert_id]
        );
      } else {
        alertId = current?.alert_id || null;
      }
      eventId = randomUUID();
      await connection.query(
        `INSERT INTO operational_alert_ci_signal_events
          (event_id, idempotency_key, signal_key, alert_key, alert_id, workflow_name,
           workflow_run_id, workflow_attempt, job_name, status, severity, source_ref,
           commit_sha, ref_name, started_at, observed_at, detection_seconds, recovery_seconds,
           evidence_json, secrets_included)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          eventId,
          signal.idempotency_key,
          signal.signal_key,
          signal.alert_key,
          alertId,
          signal.workflow_name,
          signal.workflow_run_id,
          signal.workflow_attempt,
          signal.job_name,
          signal.status,
          signal.severity,
          signal.source_ref,
          signal.commit_sha,
          signal.ref_name,
          dbDate(signal.started_at),
          dbDate(signal.observed_at),
          signal.detection_seconds,
          recoverySeconds,
          JSON.stringify(signal.evidence),
        ]
      );
      await connection.commit();
    }
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const [eventRows] = await pool.query(
    `SELECT event_id, idempotency_key, signal_key, alert_key, alert_id, workflow_name,
            workflow_run_id, workflow_attempt, job_name, status, severity, source_ref,
            commit_sha, ref_name, started_at, observed_at, detection_seconds, recovery_seconds
       FROM operational_alert_ci_signal_events
      WHERE event_id = ?
      LIMIT 1`,
    [eventId]
  );
  const [alertRows] = alertId
    ? await pool.query(
        `SELECT alert_id, alert_key, severity, lifecycle_status, lifecycle_revision,
                occurrence_count, first_seen_at, last_seen_at, resolved_at, updated_at
           FROM operational_alerts WHERE alert_id = ? LIMIT 1`,
        [alertId]
      )
    : [[]];
  return {
    ok: true,
    created: !idempotentReplay,
    idempotent_replay: idempotentReplay,
    event: sanitizeEvidence(eventRows?.[0] || {}),
    alert: sanitizeEvidence(alertRows?.[0] || null),
    slo: await readCiGuardSlo({ signalKey: signal.signal_key, pool }),
    secrets_included: false,
  };
}

export const _testingCiGuardOperationalAlerts = {
  DEFAULT_TARGETS,
  FAILURE_STATUSES,
  sanitizeEvidence,
  sha256,
  objectiveStatus,
  deriveRecoverySamples,
};
