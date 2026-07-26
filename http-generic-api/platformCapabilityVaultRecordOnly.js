import { createHash } from "node:crypto";
import { getPool } from "./db.js";
import { writeAuditLog } from "./auditLogger.js";
import { buildRepoIngestionPlan } from "./platformPrivateCapabilityVault.js";

const ALLOWED_RECORD_INPUT_KEYS = new Set([
  "source_repo_full_name",
  "source_commit_sha",
  "default_branch",
  "parent_repo_full_name",
  "license_spdx",
  "description",
  "runtime_language",
  "confirm_record_only",
  "files",
]);

function text(value = "") {
  return String(value || "").trim();
}

function sha(value = "") {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function stableUuid(value = "") {
  const hex = sha(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function routeError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function rowsFrom(result) {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

function capabilityCandidateType(plan = {}) {
  if (plan.classification?.install_mode === "runtime_candidate_sandbox") return "runtime";
  if (plan.classification?.install_mode === "private_skill_import") return "adapter";
  if (plan.classification?.repo_kind?.includes("connector")) return "connector";
  if (plan.classification?.repo_kind?.includes("workflow")) return "workflow";
  return "unknown";
}

function candidateKeyForPlan(plan = {}) {
  const slug = text(plan.source_repo_full_name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "repo";
  const kind = text(plan.classification?.repo_kind || "candidate")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "candidate";
  return `repo.${slug}.${kind}`.slice(0, 191);
}

export async function recordRepoIngestionPlan(input = {}, deps = {}) {
  if (input.confirm_record_only !== true) {
    throw routeError(
      "platform_capability_vault_record_confirmation_required",
      "Set confirm_record_only=true to record metadata without executing or installing source assets."
    );
  }
  const unknownFields = Object.keys(input).filter((key) => !ALLOWED_RECORD_INPUT_KEYS.has(key));
  if (unknownFields.length) {
    throw routeError(
      "platform_capability_vault_unknown_fields",
      `Unsupported request fields: ${unknownFields.sort().join(", ")}.`
    );
  }

  const plan = buildRepoIngestionPlan(input);
  if (!plan.ok) {
    throw routeError(
      "platform_capability_vault_record_plan_blocked",
      `Repo ingestion record is blocked: ${plan.blockers.join(", ")}`,
      422
    );
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(plan.source_repo_full_name)) {
    throw routeError("platform_capability_vault_repo_ref_invalid", "source_repo_full_name must use owner/repo format.");
  }
  if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(plan.source_commit_sha)) {
    throw routeError("platform_capability_vault_commit_sha_invalid", "source_commit_sha must be a full 40- or 64-character hexadecimal commit SHA.");
  }
  if (plan.assets.length > 5000) {
    throw routeError("platform_capability_vault_file_scope_exceeded", "Repo ingestion records are limited to 5000 files.", 413);
  }

  const pool = deps.pool || getPool();
  const audit = deps.writeAuditLog || writeAuditLog;
  const principal = deps.principal || {};
  const [owner, repo] = plan.source_repo_full_name.split("/");
  const sourceSeed = `${plan.source_repo_full_name}@${plan.source_commit_sha}`;
  const sourceRef = `github:${sourceSeed}`;
  const correlationId = stableUuid(`vault-record:${sourceSeed}`);
  const deterministicSourceId = stableUuid(`repo-source:${plan.source_repo_full_name}`);
  const resolutionId = stableUuid(`source-resolution:${sourceSeed}`);
  const candidateKey = candidateKeyForPlan(plan);
  const candidateId = stableUuid(`capability-candidate:${sourceSeed}:${candidateKey}`);
  const jobId = stableUuid(`repo-ingestion-job:${sourceSeed}`);

  const intentAuditId = await audit({
    tenant_id: principal.tenant_id || null,
    user_id: principal.user_id || null,
    actor_id: principal.user_id || principal.mode || "platform_admin",
    actor_type: principal.user_id ? "user" : "service",
    correlation_id: correlationId,
    action: "platform_capability_vault_repo_ingestion_record_intent",
    resource_type: "github_repo",
    resource_id: sourceRef,
    service_mode: "admin_governed",
    execution_context_json: {
      mode: "record_only",
      source_repo_full_name: plan.source_repo_full_name,
      source_commit_sha: plan.source_commit_sha,
      will_execute: false,
      will_install: false,
      secrets_included: false,
    },
  });

  const connection = typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  let sourceId = deterministicSourceId;
  let transactionStarted = false;
  try {
    if (typeof connection.beginTransaction === "function") {
      await connection.beginTransaction();
      transactionStarted = true;
    }

    const existingSource = rowsFrom(await connection.query(
      "SELECT repo_source_id FROM repo_source_registry WHERE full_name = ? LIMIT 1",
      [plan.source_repo_full_name]
    ));
    if (existingSource[0]?.repo_source_id) sourceId = existingSource[0].repo_source_id;

    await connection.query(
      `INSERT INTO repo_source_registry
        (repo_source_id, owner, repo, full_name, html_url, default_branch, pinned_commit_sha,
         license_spdx, description, source_status, risk_class)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', ?)
       ON DUPLICATE KEY UPDATE
         pinned_commit_sha = VALUES(pinned_commit_sha),
         license_spdx = VALUES(license_spdx),
         description = VALUES(description),
         risk_class = VALUES(risk_class),
         source_status = 'discovered',
         updated_at = CURRENT_TIMESTAMP`,
      [
        sourceId,
        owner,
        repo,
        plan.source_repo_full_name,
        `https://github.com/${plan.source_repo_full_name}`,
        text(input.default_branch || "main"),
        plan.source_commit_sha,
        plan.license_spdx || null,
        text(input.description) || null,
        plan.classification.risk_class,
      ]
    );

    await connection.query(
      `INSERT INTO platform_capability_source_resolutions
        (resolution_id, source_type, source_ref, detected_product, mime_type, read_strategy,
         fallback_strategy, supports_all_drives, web_url_fetch_allowed, resolution_json, status)
       VALUES (?, 'github_repo', ?, 'github_repo', NULL, 'pinned_repo_tree_record_only',
         'manual_provider_readback', 0, 0, ?, 'planned')
       ON DUPLICATE KEY UPDATE
         detected_product = VALUES(detected_product),
         read_strategy = VALUES(read_strategy),
         fallback_strategy = VALUES(fallback_strategy),
         resolution_json = VALUES(resolution_json),
         status = 'planned'`,
      [
        resolutionId,
        sourceRef,
        JSON.stringify({
          mode: "record_only",
          source_repo_full_name: plan.source_repo_full_name,
          source_commit_sha: plan.source_commit_sha,
          classification: plan.classification,
          summary: plan.summary,
          candidate_counts: plan.candidate_counts,
          provider_verified: false,
          executes_source_assets: false,
          installs_source_assets: false,
          secrets_included: false,
        }),
      ]
    );

    await connection.query(
      `INSERT INTO repo_capability_candidates
        (capability_candidate_id, repo_source_id, candidate_type, capability_key_suggested,
         runtime_language, install_method_detected, requires_code_execution, requires_network,
         requires_credentials, requires_filesystem, requires_shell, risk_class, sandbox_status,
         certification_status, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, 'required', 'required', 'candidate')
       ON DUPLICATE KEY UPDATE
         repo_source_id = VALUES(repo_source_id),
         candidate_type = VALUES(candidate_type),
         runtime_language = VALUES(runtime_language),
         install_method_detected = VALUES(install_method_detected),
         requires_code_execution = VALUES(requires_code_execution),
         risk_class = VALUES(risk_class),
         sandbox_status = 'required',
         certification_status = 'required',
         status = 'candidate'`,
      [
        candidateId,
        sourceId,
        capabilityCandidateType(plan),
        candidateKey,
        text(input.runtime_language) || null,
        plan.classification.install_mode,
        plan.summary.requires_code_execution ? 1 : 0,
        plan.classification.risk_class,
      ]
    );

    await connection.query(
      `INSERT INTO repo_ingestion_jobs
        (job_id, repo_source_id, source_repo_full_name, requested_by, request_scope_type,
         request_scope_id, ingestion_mode, status, result_json, started_at, finished_at)
       VALUES (?, ?, ?, ?, 'platform', 'platform', 'preview', 'succeeded', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         repo_source_id = VALUES(repo_source_id),
         requested_by = VALUES(requested_by),
         status = 'succeeded',
         result_json = VALUES(result_json),
         finished_at = CURRENT_TIMESTAMP`,
      [
        jobId,
        sourceId,
        plan.source_repo_full_name,
        principal.user_id || principal.mode || "platform_admin",
        JSON.stringify({
          mode: "record_only",
          plan_type: plan.plan_type,
          resolution_id: resolutionId,
          candidate_id: candidateId,
          will_execute: false,
          will_install: false,
          secrets_included: false,
        }),
      ]
    );

    const sourceRows = rowsFrom(await connection.query(
      "SELECT repo_source_id, full_name, pinned_commit_sha, source_status, risk_class FROM repo_source_registry WHERE repo_source_id = ? LIMIT 1",
      [sourceId]
    ));
    const resolutionRows = rowsFrom(await connection.query(
      "SELECT resolution_id, source_type, source_ref, read_strategy, status FROM platform_capability_source_resolutions WHERE resolution_id = ? LIMIT 1",
      [resolutionId]
    ));
    const candidateRows = rowsFrom(await connection.query(
      "SELECT capability_candidate_id, repo_source_id, candidate_type, capability_key_suggested, risk_class, status FROM repo_capability_candidates WHERE capability_candidate_id = ? LIMIT 1",
      [candidateId]
    ));
    const jobRows = rowsFrom(await connection.query(
      "SELECT job_id, repo_source_id, source_repo_full_name, ingestion_mode, status FROM repo_ingestion_jobs WHERE job_id = ? LIMIT 1",
      [jobId]
    ));
    const readbackVerified = Boolean(
      sourceRows[0]
      && resolutionRows[0]
      && candidateRows[0]
      && jobRows[0]
      && candidateRows[0].repo_source_id === sourceId
      && jobRows[0].repo_source_id === sourceId
    );
    if (!readbackVerified) {
      throw routeError("platform_capability_vault_record_readback_failed", "Record-only ingestion readback did not verify all rows.", 500);
    }

    if (transactionStarted && typeof connection.commit === "function") await connection.commit();

    const completionAuditId = await audit({
      tenant_id: principal.tenant_id || null,
      user_id: principal.user_id || null,
      actor_id: principal.user_id || principal.mode || "platform_admin",
      actor_type: principal.user_id ? "user" : "service",
      correlation_id: correlationId,
      action: "platform_capability_vault_repo_ingestion_record_completed",
      resource_type: "github_repo",
      resource_id: sourceRef,
      service_mode: "admin_governed",
      after_json: {
        source_id: sourceId,
        resolution_id: resolutionId,
        candidate_id: candidateId,
        job_id: jobId,
        readback_verified: true,
        will_execute: false,
        will_install: false,
        secrets_included: false,
      },
    });

    return {
      ok: true,
      mode: "record_only",
      source_id: sourceId,
      resolution_id: resolutionId,
      candidate_id: candidateId,
      job_id: jobId,
      candidate_key: candidateKey,
      plan,
      readback: {
        source: sourceRows[0],
        resolution: resolutionRows[0],
        candidate: candidateRows[0],
        job: jobRows[0],
        verified: true,
      },
      audit: {
        intent_audit_id: intentAuditId,
        completion_audit_id: completionAuditId,
      },
      will_execute: false,
      will_install: false,
      secrets_included: false,
    };
  } catch (error) {
    if (transactionStarted && typeof connection.rollback === "function") {
      try { await connection.rollback(); } catch { /* preserve primary error */ }
    }
    throw error;
  } finally {
    if (connection !== pool && typeof connection.release === "function") connection.release();
  }
}
