import { createHash, randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { enqueuePlatformOutboxEvent } from "./platformOutbox.js";
import { createRuntimeVerificationRun } from "./runtimeVerificationService.js";
import { createReleaseAdvisorRun } from "./selfHealingReleaseAdvisorService.js";

export const REPOSITORY_MAIN_MOVED_EVENT_TYPE = "repository.main_moved";
export const REPOSITORY_MAIN_MOVED_CONTRACT = "mad4b.release.repository-main-moved.v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ENVIRONMENTS = new Set(["production", "staging"]);
const DEFAULT_REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";

function fail(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}

function text(value, max = 512, fallback = "") {
  return String(value ?? fallback).trim().slice(0, max);
}

function sha(value, field) {
  const normalized = text(value, 40).toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    fail("repository_main_moved_validation_error", `${field} must be a 40-character Git SHA.`, 400, { field });
  }
  return normalized;
}

function optionalUuid(value, field) {
  const normalized = text(value, 36);
  if (!normalized) return null;
  if (!UUID_PATTERN.test(normalized)) {
    fail("repository_main_moved_validation_error", `${field} must be a UUID.`, 400, { field });
  }
  return normalized;
}

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function expectedRepository(env = process.env) {
  return text(env.RELEASE_TRIGGER_REPOSITORY || env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY, 255).toLowerCase();
}

export function resolveConfiguredReleaseBranch(env = process.env) {
  const branch = text(
    env.RELEASE_TRIGGER_BRANCH
      || env.ACTIVATION_GITHUB_BRANCH
      || env.GITHUB_DEFAULT_BRANCH
      || "main",
    191,
  ).replace(/^refs\/heads\//, "");
  return branch || "main";
}

export function normalizeRepositoryMainMovedEvent(input = {}, options = {}) {
  const repository = text(input.repository || input.repository_full_name, 255).toLowerCase();
  const env = options.env || process.env;
  const allowedRepository = expectedRepository(env);
  if (!repository || repository !== allowedRepository) {
    fail("repository_main_moved_repository_not_allowed", "The repository is not allowlisted for release triggering.", 403, {
      repository,
      expected_repository: allowedRepository,
    });
  }
  const allowedBranch = resolveConfiguredReleaseBranch(env);
  const branch = text(input.branch || input.branch_name || allowedBranch, 191).replace(/^refs\/heads\//, "");
  if (branch !== allowedBranch) {
    fail("repository_main_moved_branch_not_supported", "Only the configured release branch may trigger release coordination.", 400, {
      branch,
      expected_branch: allowedBranch,
    });
  }
  const beforeSha = sha(input.before_sha || input.before, "before_sha");
  const afterSha = sha(input.after_sha || input.after, "after_sha");
  if (beforeSha === afterSha) {
    fail("repository_main_moved_no_change", "before_sha and after_sha must differ.", 409);
  }
  if (input.deleted === true) {
    fail("repository_main_moved_deleted_ref_blocked", "Deleted release references cannot trigger release coordination.", 409);
  }
  const environmentKey = text(input.environment_key || "production", 64).toLowerCase();
  if (!ALLOWED_ENVIRONMENTS.has(environmentKey)) {
    fail("repository_main_moved_environment_invalid", "environment_key must be production or staging.", 400, { environment_key: environmentKey });
  }
  const sourceEventId = text(input.source_event_id || input.delivery_id, 191);
  if (!sourceEventId) {
    fail("repository_main_moved_source_event_required", "source_event_id is required for audit and replay analysis.", 400);
  }
  const occurredAt = input.occurred_at ? new Date(input.occurred_at) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    fail("repository_main_moved_occurred_at_invalid", "occurred_at must be a valid ISO 8601 timestamp.", 400);
  }
  return {
    source_event_id: sourceEventId,
    repository,
    branch,
    before_sha: beforeSha,
    after_sha: afterSha,
    forced: input.forced === true,
    deleted: false,
    environment_key: environmentKey,
    target_id: optionalUuid(input.target_id, "target_id"),
    occurred_at: occurredAt,
  };
}

export function buildRepositoryMainMovedFingerprint(event) {
  return sha256([event.repository, event.branch, event.after_sha].join("|"));
}

export function deriveRepositoryMainMovedOutcome({ verification = {}, advisor = {} } = {}) {
  const advisorRun = advisor.advisor_run || {};
  const advisorStatus = text(advisorRun.advisor_status || "blocked", 32);
  const productionParity = text(verification.production_parity || "unknown", 32);
  const approvalRequired = advisorStatus === "review_required" || advisorRun.requires_approval === true;
  const coordinationStatus = productionParity === "verified" && advisorStatus === "no_action"
    ? "no_action"
    : approvalRequired
      ? "approval_required"
      : advisorStatus === "blocked"
        ? "blocked"
        : "evaluated";
  const nextActionKey = coordinationStatus === "approval_required"
    ? "release.await_typed_approval"
    : coordinationStatus === "no_action"
      ? "release.no_action"
      : coordinationStatus === "blocked"
        ? "release.review_blocking_evidence"
        : "release.review_advisor_plan";
  return {
    coordination_status: coordinationStatus,
    next_action_key: nextActionKey,
    approval_required: approvalRequired,
    execution_allowed: false,
    release_operation_created: false,
    gate_opened: false,
    capability_envelope_created: false,
    job_enqueued: false,
    deploy_executed: false,
    restart_executed: false,
    provider_call_performed: false,
    external_write_performed: false,
    secrets_included: false,
  };
}

function shapeTrigger(row) {
  if (!row) return null;
  return {
    ...row,
    forced: Number(row.forced || 0) === 1,
    deleted: Number(row.deleted || 0) === 1,
    summary_json: parseJson(row.summary_json, {}),
    execution_allowed: false,
    provider_write: false,
    external_write: false,
    secrets_included: false,
  };
}

async function loadByFingerprint(pool, fingerprint) {
  const [rows] = await pool.query(
    `SELECT * FROM repository_main_moved_trigger_events WHERE event_fingerprint_sha256 = ? LIMIT 1`,
    [fingerprint],
  );
  return shapeTrigger(rows[0] || null);
}

export async function getRepositoryMainMovedTriggerEvent(triggerEventId, deps = {}) {
  const pool = deps.pool || getPool();
  const id = optionalUuid(triggerEventId, "trigger_event_id");
  if (!id) fail("repository_main_moved_trigger_not_found", "Trigger event was not found.", 404);
  const [rows] = await pool.query(
    `SELECT * FROM repository_main_moved_trigger_events WHERE trigger_event_id = ? LIMIT 1`,
    [id],
  );
  if (!rows[0]) fail("repository_main_moved_trigger_not_found", "Trigger event was not found.", 404);
  return {
    ok: true,
    trigger_event: shapeTrigger(rows[0]),
    execution_allowed: false,
    provider_write: false,
    external_write: false,
    secrets_included: false,
  };
}

export async function createRepositoryMainMovedTriggerEvent(rawInput = {}, actor = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const enqueueOutbox = deps.enqueuePlatformOutboxEvent || enqueuePlatformOutboxEvent;
  const runVerification = deps.createRuntimeVerificationRun || createRuntimeVerificationRun;
  const runAdvisor = deps.createReleaseAdvisorRun || createReleaseAdvisorRun;
  const event = normalizeRepositoryMainMovedEvent(rawInput, { env: deps.env || process.env });
  const fingerprint = buildRepositoryMainMovedFingerprint(event);
  const existing = await loadByFingerprint(pool, fingerprint);
  if (existing) {
    return {
      ok: true,
      deduplicated: true,
      trigger_event: existing,
      execution_allowed: false,
      provider_write: false,
      external_write: false,
      secrets_included: false,
    };
  }

  const triggerEventId = randomUUID();
  const outboxEventId = randomUUID();
  const createdBy = text(actor.user_id || actor.email || actor.mode || "repository_main_moved_trigger_route", 191);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO repository_main_moved_trigger_events
       (trigger_event_id, event_fingerprint_sha256, source_event_id, outbox_event_id,
        repository_full_name, branch_name, before_sha, after_sha, forced, deleted,
        environment_key, target_id, coordination_status, next_action_key,
        created_by, occurred_at, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'received', 'release.run_runtime_verification', ?, ?, 0)`,
      [triggerEventId, fingerprint, event.source_event_id, outboxEventId,
       event.repository, event.branch, event.before_sha, event.after_sha,
       event.forced ? 1 : 0, event.environment_key, event.target_id,
       createdBy, event.occurred_at],
    );
    await enqueueOutbox({
      pool,
      connection,
      eventId: outboxEventId,
      eventType: REPOSITORY_MAIN_MOVED_EVENT_TYPE,
      schemaVersion: 1,
      aggregateType: "repository_branch",
      aggregateId: `${event.repository}:${event.branch}`,
      payload: {
        contract: REPOSITORY_MAIN_MOVED_CONTRACT,
        trigger_event_id: triggerEventId,
        repository: event.repository,
        branch: event.branch,
        before_sha: event.before_sha,
        after_sha: event.after_sha,
        forced: event.forced,
        deleted: false,
        environment_key: event.environment_key,
        target_id: event.target_id,
      },
      metadata: {
        producer_key: "repository_main_moved_trigger_coordinator",
        source_event_id: event.source_event_id,
        execution_allowed: false,
      },
      sourceEnvironment: event.environment_key,
      occurredAt: event.occurred_at,
      secretsIncluded: false,
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error?.code === "ER_DUP_ENTRY") {
      const duplicate = await loadByFingerprint(pool, fingerprint);
      if (duplicate) {
        return {
          ok: true,
          deduplicated: true,
          trigger_event: duplicate,
          execution_allowed: false,
          provider_write: false,
          external_write: false,
          secrets_included: false,
        };
      }
    }
    throw error;
  } finally {
    connection.release();
  }

  try {
    await pool.query(
      `UPDATE repository_main_moved_trigger_events
          SET coordination_status = 'verifying', next_action_key = 'release.run_runtime_verification', updated_at = CURRENT_TIMESTAMP(3)
        WHERE trigger_event_id = ?`,
      [triggerEventId],
    );
    const verification = await runVerification({
      environment_key: event.environment_key,
      expected_commit_sha: event.after_sha,
      workflow_key: "repository_main_moved_release_trigger",
      runtime_profile: "api_only",
    }, {
      user_id: actor.user_id || null,
      email: actor.email || null,
      mode: actor.mode || "repository_main_moved_trigger_coordinator",
    });
    if (!verification?.run_id) {
      fail("repository_main_moved_verification_missing", "Runtime verification did not return a run identifier.", 500);
    }
    const advisor = await runAdvisor({
      environment_key: event.environment_key,
      runtime_verification_run_id: verification.run_id,
      target_id: event.target_id,
      expected_commit_sha: event.after_sha,
      created_by: createdBy,
      context: {
        source: "repository_main_moved_trigger_coordinator",
        trigger_event_id: triggerEventId,
        outbox_event_id: outboxEventId,
        execution_allowed: false,
        provider_write: false,
        external_write: false,
      },
    }, { pool });
    const outcome = deriveRepositoryMainMovedOutcome({ verification, advisor });
    const advisorRun = advisor?.advisor_run || {};
    const summary = {
      contract: REPOSITORY_MAIN_MOVED_CONTRACT,
      verification: {
        run_id: verification.run_id,
        run_status: verification.run_status,
        production_parity: verification.production_parity,
        blocking_gap_count: Number(verification.summary?.blocking_gap_count || verification.gaps?.length || 0),
        expected_commit_sha: verification.expected_commit_sha,
        deployed_commit_sha: verification.deployed_commit_sha,
      },
      advisor: {
        advisor_run_id: advisorRun.advisor_run_id || null,
        advisor_status: advisorRun.advisor_status || null,
        recommendation_count: Number(advisorRun.recommendation_count || advisor?.recommendations?.length || 0),
        requires_approval: advisorRun.requires_approval === true,
      },
      handoff: outcome,
      secrets_included: false,
    };
    await pool.query(
      `UPDATE repository_main_moved_trigger_events
          SET runtime_verification_run_id = ?, release_advisor_run_id = ?,
              coordination_status = ?, next_action_key = ?, summary_json = ?,
              error_code = NULL, error_message = NULL, completed_at = CURRENT_TIMESTAMP(3),
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE trigger_event_id = ?`,
      [verification.run_id, advisorRun.advisor_run_id || null,
       outcome.coordination_status, outcome.next_action_key,
       JSON.stringify(summary), triggerEventId],
    );
    return {
      ...(await getRepositoryMainMovedTriggerEvent(triggerEventId, { pool })),
      deduplicated: false,
    };
  } catch (error) {
    await pool.query(
      `UPDATE repository_main_moved_trigger_events
          SET coordination_status = 'failed', next_action_key = 'release.review_trigger_failure',
              error_code = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP(3),
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE trigger_event_id = ?`,
      [text(error?.code || "repository_main_moved_coordination_failed", 120),
       text(error?.message || "Release trigger coordination failed.", 500), triggerEventId],
    ).catch(() => {});
    error.details = { ...(error.details || {}), trigger_event_id: triggerEventId };
    throw error;
  }
}
