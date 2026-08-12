import { createHash, randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import {
  capabilityEnvelopeError,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const REQUIRED_CHECKS = Object.freeze([
  "Syntax Check",
  "Architecture Drift Detection",
  "Execution Resolver Gate",
  "Unit & Integration Tests",
]);
const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "blocked", "cancelled"]);
const SECRET_KEY_PATTERN = /(?:^|_)(?:password|passwd|secret_value|access_token|refresh_token|private_key|client_secret|api_key|authorization_header)(?:$|_)/i;
const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\-/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:ghp_|github_pat_|ya29\.)[A-Za-z0-9_.\-]+\b/,
];

export const REPOSITORY_AUTOMATION_CAPABILITIES = Object.freeze([
  "pr_lifecycle_orchestrator",
  "migration_release_orchestrator",
  "deployment_parity_watcher",
  "capability_envelope_lifecycle_manager",
  "governed_retry_readback_wrapper",
  "branch_cleanup_controller",
  "spec_lifecycle_guard",
  "operational_closeout_workflow",
  "response_chunk_collector",
  "drift_aware_branch_update",
  "ci_auto_recovery",
  "docs_agent_stabilization_gate",
  "scheduled_hygiene_scan",
]);

const STEP_LIBRARY = Object.freeze({
  docs_agent_stabilization: {
    step_key: "docs_agent_stabilization",
    display_name: "Docs Agent stabilization gate",
    handler: "docs_agent_stabilization",
    mutation_required: false,
    capability: "docs_agent_stabilization_gate",
  },
  spec_lifecycle_guard: {
    step_key: "spec_lifecycle_guard",
    display_name: "Spec lifecycle placement guard",
    handler: "spec_lifecycle_guard",
    mutation_required: false,
    capability: "spec_lifecycle_guard",
  },
  branch_reconcile: {
    step_key: "branch_reconcile",
    display_name: "Branch drift reconciliation plan",
    tool_key: "admin_branch_reconcile",
    mutation_required: false,
    capability: "drift_aware_branch_update",
  },
  ci_gate: {
    step_key: "ci_gate",
    display_name: "Required CI gate",
    tool_key: "github_pr_ci_gate",
    mutation_required: false,
    capability: "pr_lifecycle_orchestrator",
  },
  ci_auto_recovery: {
    step_key: "ci_auto_recovery",
    display_name: "Missing CI check recovery",
    handler: "ci_auto_recovery",
    mutation_required: true,
    capability: "ci_auto_recovery",
    required_step_fields: ["dispatch_args.mutation_approval"],
  },
  mark_ready: {
    step_key: "mark_ready",
    display_name: "Mark pull request ready",
    tool_key: "runtime_endpoint_call",
    mutation_required: true,
    capability: "pr_lifecycle_orchestrator",
    required_step_fields: ["parent_action_key", "endpoint_key", "body", "mutation_approval"],
  },
  pr_finalize: {
    step_key: "pr_finalize",
    display_name: "Finalize pull request",
    tool_key: "github_pr_finalize",
    mutation_required: true,
    capability: "pr_lifecycle_orchestrator",
    required_step_fields: ["expected_head_sha", "expected_base_sha", "confirm", "capability_envelope_id"],
  },
  deployment_parity: {
    step_key: "deployment_parity",
    display_name: "Production and main parity",
    handler: "deployment_parity",
    mutation_required: false,
    capability: "deployment_parity_watcher",
  },
  migration_authorize: {
    step_key: "migration_authorize",
    display_name: "Migration authorization bootstrap",
    tool_key: "governed_migration_authorization_bootstrap",
    mutation_required: true,
    capability: "migration_release_orchestrator",
    required_step_fields: ["expected_checksum_sha256", "expected_statement_count", "pull_request", "merge_sha", "confirm", "capability_envelope_id"],
  },
  migration_dry_run: {
    step_key: "migration_dry_run",
    display_name: "Migration dry-run",
    tool_key: "governed_migration_execute",
    mutation_required: false,
    capability: "migration_release_orchestrator",
  },
  migration_apply: {
    step_key: "migration_apply",
    display_name: "Migration apply",
    tool_key: "governed_migration_execute",
    mutation_required: true,
    capability: "migration_release_orchestrator",
    required_step_fields: ["expected_checksum_sha256", "expected_statement_count", "confirm", "capability_envelope_id"],
  },
  migration_ledger_readback: {
    step_key: "migration_ledger_readback",
    display_name: "Migration ledger readback",
    handler: "migration_ledger_readback",
    mutation_required: false,
    capability: "migration_release_orchestrator",
  },
  sql_cache_diagnostics: {
    step_key: "sql_cache_diagnostics",
    display_name: "SQL cache runtime diagnostics",
    tool_key: "sql_cache_runtime_diagnostics_get",
    mutation_required: false,
    capability: "operational_closeout_workflow",
  },
  operational_alert_sync: {
    step_key: "operational_alert_sync",
    display_name: "Operational alert synchronization",
    tool_key: "activation_operational_attention_sync_api",
    mutation_required: true,
    capability: "operational_closeout_workflow",
    required_step_fields: ["capability_envelope_id"],
  },
  repository_inventory: {
    step_key: "repository_inventory",
    display_name: "Repository PR and branch inventory",
    handler: "repository_inventory",
    mutation_required: false,
    capability: "operational_closeout_workflow",
  },
  cleanup_dry_run: {
    step_key: "cleanup_dry_run",
    display_name: "Superseded branch cleanup dry-run",
    tool_key: "github_superseded_branch_cleanup",
    mutation_required: false,
    capability: "branch_cleanup_controller",
  },
  cleanup_apply: {
    step_key: "cleanup_apply",
    display_name: "Superseded branch cleanup apply",
    tool_key: "github_superseded_branch_cleanup",
    mutation_required: true,
    capability: "branch_cleanup_controller",
    required_step_fields: ["expected_base_sha", "expected_branch_sha", "expected_evidence_fingerprint", "confirm", "reason", "capability_envelope_id"],
  },
  hygiene_scan: {
    step_key: "hygiene_scan",
    display_name: "Repository automation hygiene scan",
    handler: "hygiene_scan",
    mutation_required: false,
    capability: "scheduled_hygiene_scan",
  },
});

const WORKFLOW_TEMPLATES = Object.freeze({
  pr_delivery: [
    "docs_agent_stabilization",
    "spec_lifecycle_guard",
    "branch_reconcile",
    "ci_gate",
    "ci_auto_recovery",
    "pr_finalize",
    "deployment_parity",
  ],
  migration_release: [
    "deployment_parity",
    "migration_authorize",
    "migration_dry_run",
    "migration_apply",
    "migration_ledger_readback",
  ],
  post_merge_closeout: [
    "deployment_parity",
    "sql_cache_diagnostics",
    "operational_alert_sync",
    "migration_ledger_readback",
    "repository_inventory",
  ],
  branch_cleanup: ["branch_reconcile", "cleanup_dry_run", "cleanup_apply"],
  spec_lifecycle: ["spec_lifecycle_guard"],
  hygiene_scan: ["hygiene_scan"],
  full_workstream: [
    "docs_agent_stabilization",
    "spec_lifecycle_guard",
    "branch_reconcile",
    "ci_gate",
    "ci_auto_recovery",
    "pr_finalize",
    "deployment_parity",
    "migration_authorize",
    "migration_dry_run",
    "migration_apply",
    "migration_ledger_readback",
    "sql_cache_diagnostics",
    "operational_alert_sync",
    "cleanup_dry_run",
    "cleanup_apply",
    "repository_inventory",
    "hygiene_scan",
  ],
});

function automationError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function compact(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = stableValue(value[key]);
    return acc;
  }, {});
}

function stableJson(value) {
  return JSON.stringify(stableValue(value ?? null));
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function bool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

function assertSecretFree(value, path = "input", depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw automationError(400, "repository_automation_secret_value_rejected", `Secret-like value is not allowed at ${path}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw automationError(400, "repository_automation_secret_field_rejected", `Secret-like field is not allowed at ${path}.${key}.`);
    }
    assertSecretFree(nested, `${path}.${key}`, depth + 1);
  }
}

function safeSummary(value, maxChars = 20000) {
  const seen = new WeakSet();
  const clean = (entry, depth = 0) => {
    if (depth > 8) return "[max-depth]";
    if (entry === null || entry === undefined) return entry;
    if (typeof entry === "string") {
      if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(entry))) return "[redacted]";
      return entry.length > 4000 ? `${entry.slice(0, 4000)}...[truncated]` : entry;
    }
    if (typeof entry !== "object") return entry;
    if (seen.has(entry)) return "[circular]";
    seen.add(entry);
    if (Array.isArray(entry)) return entry.slice(0, 100).map((item) => clean(item, depth + 1));
    const output = {};
    for (const [key, nested] of Object.entries(entry)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : clean(nested, depth + 1);
    }
    return output;
  };
  const cleaned = clean(value);
  const serialized = JSON.stringify(cleaned);
  if (serialized.length <= maxChars) return cleaned;
  return { truncated: true, preview: serialized.slice(0, maxChars), secrets_included: false };
}

function getPath(value, path) {
  return String(path || "").split(".").filter(Boolean).reduce((current, segment) => current?.[segment], value);
}

function mergeArgs(base = {}, overlay = {}) {
  const output = { ...(base || {}) };
  for (const [key, value] of Object.entries(overlay || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && output[key] && typeof output[key] === "object" && !Array.isArray(output[key])) {
      output[key] = mergeArgs(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function normalizeDispatchResult(result) {
  const status = Number(result?.status || result?.http_status || result?.body?.status || 200);
  const body = result?.body !== undefined ? result.body : result;
  const ok = status < 400 && body?.ok !== false;
  return { ok, status, body };
}

function toolBody(result) {
  return result?.body !== undefined ? result.body : result;
}

function stepArgsFor(input, stepKey) {
  const all = input.step_args && typeof input.step_args === "object" ? input.step_args : {};
  return all[stepKey] && typeof all[stepKey] === "object" ? all[stepKey] : {};
}

function defaultStepArgs(step, input) {
  const owner = compact(input.owner || "mad4bdigital-ai", 191);
  const repo = compact(input.repo || "multi-business-multi-role-growth-intelligence-os", 191);
  const defaultBranch = compact(input.default_branch || "main", 191);
  const pullNumber = Number(input.pull_number || 0) || undefined;
  const branch = compact(input.branch || input.head_ref || "", 255);
  const migration = compact(input.migration || "", 255);
  switch (step.step_key) {
    case "branch_reconcile":
      return { owner, repo, branch, default_branch: defaultBranch, mode: "dry_run" };
    case "ci_gate":
      return { owner, repo, pull_number: pullNumber, required_checks: input.required_checks || REQUIRED_CHECKS };
    case "migration_dry_run":
      return {
        migration,
        mode: "dry_run",
        expected_checksum_sha256: input.expected_checksum_sha256,
        expected_statement_count: input.expected_statement_count,
      };
    case "sql_cache_diagnostics":
      return {};
    case "operational_alert_sync":
      return { lookback_hours: input.lookback_hours || 1, requested_by: input.requested_by || "repository-automation-control-plane" };
    case "cleanup_dry_run":
      return { owner, repo, branch, default_branch: defaultBranch, superseding_commits: input.superseding_commits || [], mode: "dry_run" };
    case "repository_inventory":
      return { owner, repo, default_branch: defaultBranch };
    default:
      return {};
  }
}

export function classifySpecLifecycle({ changed_files = [], intent = "auto", historical = null } = {}) {
  const files = [...new Set((changed_files || []).map((file) => compact(file, 500)).filter(Boolean))].sort();
  const normalizedIntent = compact(intent || "auto", 64).toLowerCase();
  const explicitlyHistorical = historical === true || ["historical", "implemented", "superseded", "archive"].includes(normalizedIntent);
  const explicitlyActive = historical === false || ["active", "delivery", "reopen", "implementation"].includes(normalizedIntent);
  const activeSpecFiles = files.filter((file) => /^specs\//.test(file));
  const staleArtifacts = files.filter((file) => /(?:^|\/)(?:completion\.json|tasks\.md|checklists\/|docs\/auto-docs-agent\/)/.test(file));
  const historyFiles = files.filter((file) => /^docs\/history\//.test(file));
  const blockers = [];
  const warnings = [];
  let classification = "neutral";
  let recommended_root = null;

  if (explicitlyHistorical) {
    classification = "historical";
    recommended_root = "docs/history/<topic>/";
    if (activeSpecFiles.length) blockers.push("historical_content_must_not_use_active_specs_path");
    if (staleArtifacts.length) blockers.push("historical_content_contains_stale_delivery_artifacts");
  } else if (explicitlyActive) {
    classification = "active_spec_kit";
    recommended_root = "specs/<feature>/";
    if (!activeSpecFiles.length) warnings.push("active_spec_kit_path_not_present");
  } else if (historyFiles.length && activeSpecFiles.length) {
    classification = "mixed";
    blockers.push("mixed_active_and_historical_spec_paths");
  } else if (activeSpecFiles.length) {
    classification = "active_spec_kit";
    recommended_root = "specs/<feature>/";
  } else if (historyFiles.length) {
    classification = "historical";
    recommended_root = "docs/history/<topic>/";
  }

  return {
    ok: blockers.length === 0,
    classification,
    recommended_root,
    active_spec_files: activeSpecFiles,
    historical_files: historyFiles,
    stale_artifacts: staleArtifacts,
    blockers,
    warnings,
    secrets_included: false,
  };
}

export function buildRepositoryAutomationPlan(input = {}) {
  assertSecretFree(input);
  const automationKey = compact(input.automation_key || input.automationKey || "full_workstream", 64).toLowerCase();
  const template = WORKFLOW_TEMPLATES[automationKey];
  if (!template) {
    throw automationError(400, "repository_automation_key_invalid", `Unsupported automation_key '${automationKey}'.`, {
      allowed: Object.keys(WORKFLOW_TEMPLATES),
    });
  }
  const owner = compact(input.owner || "mad4bdigital-ai", 191);
  const repo = compact(input.repo || "multi-business-multi-role-growth-intelligence-os", 191);
  const defaultBranch = compact(input.default_branch || "main", 191);
  const steps = template.map((stepName, index) => {
    const source = STEP_LIBRARY[stepName];
    const supplied = stepArgsFor(input, source.step_key);
    const args = mergeArgs(defaultStepArgs(source, input), supplied);
    const missingFields = (source.required_step_fields || []).filter((path) => getPath(args, path) === undefined || getPath(args, path) === null || getPath(args, path) === "");
    return {
      step_order: index + 1,
      ...source,
      default_args: safeSummary(args, 8000),
      missing_required_fields: missingFields,
      status: source.mutation_required && missingFields.length ? "awaiting_input" : "planned",
      retry_policy: { max_attempts: 2, readback_before_retry: true, transient_statuses: [...TRANSIENT_STATUS_CODES] },
      approval_policy: source.mutation_required
        ? { outer_envelope_required: true, inner_tool_authority_preserved: true, auto_approval_forbidden: true }
        : { outer_envelope_required: false },
    };
  });
  const planCore = {
    automation_key: automationKey,
    owner,
    repo,
    default_branch: defaultBranch,
    pull_number: Number(input.pull_number || 0) || null,
    branch: compact(input.branch || input.head_ref || "", 255) || null,
    migration: compact(input.migration || "", 255) || null,
    mode: compact(input.mode || "dry_run", 32).toLowerCase() === "apply" ? "apply" : "dry_run",
    capabilities: [...new Set(steps.map((step) => step.capability))],
    steps,
    safety: {
      no_force_push: true,
      no_direct_provider_credentials: true,
      no_freeform_mutation_sql: true,
      readback_before_retry: true,
      outer_and_inner_authority_required_for_mutations: true,
      chunk_continuations_must_be_exhausted: true,
      secrets_included: false,
    },
  };
  return {
    ok: true,
    ...planCore,
    plan_sha256: sha256(stableJson(planCore)),
    mutation_step_count: steps.filter((step) => step.mutation_required).length,
    awaiting_input_step_count: steps.filter((step) => step.status === "awaiting_input").length,
    secrets_included: false,
  };
}

async function safeQuery(pool, sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return { ok: true, rows: Array.isArray(rows) ? rows : [], error: null };
  } catch (error) {
    return { ok: false, rows: [], error: { code: error.code || "query_failed", message: error.message } };
  }
}

async function persistRun(pool, plan, input) {
  const idempotencyKey = compact(input.idempotency_key || sha256(`${plan.automation_key}|${plan.plan_sha256}`), 191);
  const existing = await safeQuery(
    pool,
    `SELECT * FROM repository_automation_runs WHERE automation_key = ? AND idempotency_key = ? LIMIT 1`,
    [plan.automation_key, idempotencyKey]
  );
  if (existing.ok && existing.rows[0]) return { row: existing.rows[0], created: false };
  const runId = randomUUID();
  await pool.query(
    `INSERT INTO repository_automation_runs
      (run_id, automation_key, mode, status, stage, owner, repo, default_branch, pull_number, branch_name,
       migration_file, idempotency_key, input_sha256, plan_sha256, plan_json, capability_envelope_id, secrets_included)
     VALUES (?, ?, ?, 'planned', 'plan_created', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      runId,
      plan.automation_key,
      plan.mode,
      plan.owner,
      plan.repo,
      plan.default_branch,
      plan.pull_number,
      plan.branch,
      plan.migration,
      idempotencyKey,
      sha256(stableJson(input)),
      plan.plan_sha256,
      JSON.stringify(plan),
      compact(input.capability_envelope_id || "", 64) || null,
    ]
  );
  for (const step of plan.steps) {
    await pool.query(
      `INSERT INTO repository_automation_step_runs
        (step_run_id, run_id, step_key, step_order, capability_key, tool_key, mutation_required, status, request_sha256, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        randomUUID(),
        runId,
        step.step_key,
        step.step_order,
        step.capability,
        step.tool_key || step.handler || null,
        step.mutation_required ? 1 : 0,
        step.status,
        sha256(stableJson(step.default_args || {})),
      ]
    );
  }
  const [rows] = await pool.query("SELECT * FROM repository_automation_runs WHERE run_id = ? LIMIT 1", [runId]);
  return { row: rows[0], created: true };
}

async function updateRun(pool, runId, { status, stage, summary = null, error = null, complete = false } = {}) {
  await pool.query(
    `UPDATE repository_automation_runs
        SET status = COALESCE(?, status), stage = COALESCE(?, stage), summary_json = COALESCE(?, summary_json),
            error_json = ?, completed_at = CASE WHEN ? THEN NOW() ELSE completed_at END, updated_at = NOW()
      WHERE run_id = ?`,
    [status || null, stage || null, summary ? JSON.stringify(safeSummary(summary)) : null, error ? JSON.stringify(safeSummary(error)) : null, complete ? 1 : 0, runId]
  );
}

async function updateStep(pool, runId, stepKey, { status, output = null, error = null, incrementAttempt = false, complete = false } = {}) {
  await pool.query(
    `UPDATE repository_automation_step_runs
        SET status = ?, output_json = ?, error_json = ?,
            attempt_count = attempt_count + ?,
            started_at = COALESCE(started_at, NOW()),
            completed_at = CASE WHEN ? THEN NOW() ELSE completed_at END,
            updated_at = NOW()
      WHERE run_id = ? AND step_key = ?`,
    [status, output ? JSON.stringify(safeSummary(output)) : null, error ? JSON.stringify(safeSummary(error)) : null, incrementAttempt ? 1 : 0, complete ? 1 : 0, runId, stepKey]
  );
}

async function readReceipt(pool, runId, stepKey, requestSha) {
  const result = await safeQuery(
    pool,
    `SELECT * FROM repository_automation_receipts WHERE run_id = ? AND step_key = ? AND request_sha256 = ? LIMIT 1`,
    [runId, stepKey, requestSha]
  );
  return result.rows[0] || null;
}

async function writeReceipt(pool, {
  runId,
  stepKey,
  operationKey,
  idempotencyKey,
  requestSha,
  dispatchStatus,
  providerStatus = null,
  providerReceipt = null,
  readback = null,
  recovered = false,
}) {
  await pool.query(
    `INSERT INTO repository_automation_receipts
      (receipt_id, run_id, step_key, operation_key, idempotency_key, request_sha256, dispatch_status,
       provider_status, provider_receipt_json, readback_json, recovered_from_transport, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       dispatch_status = VALUES(dispatch_status), provider_status = VALUES(provider_status),
       provider_receipt_json = VALUES(provider_receipt_json), readback_json = VALUES(readback_json),
       recovered_from_transport = VALUES(recovered_from_transport), updated_at = NOW()`,
    [
      randomUUID(), runId, stepKey, operationKey, idempotencyKey, requestSha, dispatchStatus,
      providerStatus, providerReceipt ? JSON.stringify(safeSummary(providerReceipt)) : null,
      readback ? JSON.stringify(safeSummary(readback)) : null, recovered ? 1 : 0,
    ]
  );
}

function chunkContinuation(body = {}) {
  if (!body || typeof body !== "object") return null;
  if (body.continuation?.next_call?.name === "response_chunk_read") return body.continuation.next_call.tool_args || null;
  const hasMore = body.continuation_required === true || body.page?.has_more === true || body.page?.next_cursor !== null && body.page?.next_cursor !== undefined;
  if (!hasMore || !body.chunk_id) return null;
  return {
    chunk_id: body.chunk_id,
    cursor: body.page?.next_cursor ?? 0,
    max_chars: body.page?.max_chars || 45000,
  };
}

export async function collectChunkedToolResponse(initial, { dispatch, maxChunks = 25 } = {}) {
  const normalized = normalizeDispatchResult(initial);
  let body = normalized.body;
  const pieces = [];
  if (typeof body?.chunk === "string") pieces.push(body.chunk);
  let continuation = chunkContinuation(body);
  let chunkCount = pieces.length ? 1 : 0;
  while (continuation && chunkCount < boundedInt(maxChunks, 25, 1, 100)) {
    if (typeof dispatch !== "function") {
      throw automationError(500, "repository_automation_chunk_dispatch_missing", "Chunked response requires a response_chunk_read dispatcher.");
    }
    const next = normalizeDispatchResult(await dispatch("response_chunk_read", continuation));
    if (!next.ok) {
      throw automationError(next.status, "repository_automation_chunk_read_failed", "Unable to consume the complete governed response chunk chain.", safeSummary(next.body));
    }
    body = next.body;
    if (typeof body?.chunk === "string") pieces.push(body.chunk);
    chunkCount += 1;
    continuation = chunkContinuation(body);
  }
  if (continuation) {
    throw automationError(409, "repository_automation_chunk_limit_exceeded", "Chunk continuation exceeded the bounded collector limit.", { chunk_count: chunkCount });
  }
  let reconstructed = null;
  if (pieces.length) reconstructed = parseJson(pieces.join(""), null);
  return {
    ok: normalized.ok,
    status: normalized.status,
    body: reconstructed || normalized.body,
    chunk_collection: {
      response_chunked: pieces.length > 0,
      chunk_count: chunkCount,
      continuation_complete: continuation === null,
      response_sha256: pieces.length ? sha256(pieces.join("")) : null,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

async function dispatchAndCollect(dispatch, toolKey, args, options = {}) {
  return collectChunkedToolResponse(await dispatch(toolKey, args), {
    dispatch,
    maxChunks: options.maxChunks || 25,
  });
}

function readbackIndicatesCompletion(step, body = {}) {
  const value = toolBody(body) || {};
  if (step.step_key === "pr_finalize") return value?.data?.merged === true || value?.merged === true || String(value?.state || "").toLowerCase() === "merged";
  if (step.step_key === "migration_apply") return Number(value?.ledger_count || value?.data?.ledger_count || 0) > 0;
  if (step.step_key === "cleanup_apply") return value?.branch_missing === true || value?.readback?.branch_missing === true || value?.status === 404;
  if (step.step_key === "mark_ready") return value?.data?.isDraft === false || value?.isDraft === false;
  return value?.ok === true && (value?.completed === true || value?.readback_verified === true || value?.same_cycle_readback_verified === true);
}

async function dispatchWithReceipt({ pool, runId, step, args, dispatch, readbackDispatch = null, persist = true }) {
  const requestSha = sha256(stableJson({ tool_key: step.tool_key || step.handler, args }));
  const idempotencyKey = compact(args.idempotency_key || `${runId}:${step.step_key}:${requestSha.slice(0, 16)}`, 191);
  if (persist) {
    const existing = await readReceipt(pool, runId, step.step_key, requestSha);
    if (existing?.dispatch_status === "completed") {
      return {
        ok: true,
        status: Number(existing.provider_status || 200),
        body: parseJson(existing.provider_receipt_json, {}),
        receipt_reused: true,
        secrets_included: false,
      };
    }
  }

  const call = async () => collectChunkedToolResponse(
    await dispatch(step.tool_key, args),
    { dispatch, maxChunks: 25 }
  );
  let first;
  try {
    first = await call();
  } catch (error) {
    first = { ok: false, status: Number(error.status || 503), body: { ok: false, error: { code: error.code || "dispatch_failed", message: error.message } } };
  }
  if (first.ok) {
    if (persist) await writeReceipt(pool, {
      runId, stepKey: step.step_key, operationKey: step.tool_key || step.handler,
      idempotencyKey, requestSha, dispatchStatus: "completed", providerStatus: first.status, providerReceipt: first.body,
    });
    return first;
  }

  const transient = TRANSIENT_STATUS_CODES.has(Number(first.status));
  let readback = null;
  if (transient && typeof readbackDispatch === "function") {
    try {
      readback = normalizeDispatchResult(await readbackDispatch());
      if (readback.ok && readbackIndicatesCompletion(step, readback.body)) {
        if (persist) await writeReceipt(pool, {
          runId, stepKey: step.step_key, operationKey: step.tool_key || step.handler,
          idempotencyKey, requestSha, dispatchStatus: "completed", providerStatus: readback.status,
          providerReceipt: readback.body, readback: readback.body, recovered: true,
        });
        return { ok: true, status: readback.status, body: readback.body, recovered_from_transport: true, secrets_included: false };
      }
    } catch (error) {
      readback = { ok: false, status: error.status || 500, body: { error: { code: error.code || "readback_failed", message: error.message } } };
    }
  }

  if (transient) {
    const retry = await call();
    if (retry.ok) {
      if (persist) await writeReceipt(pool, {
        runId, stepKey: step.step_key, operationKey: step.tool_key || step.handler,
        idempotencyKey, requestSha, dispatchStatus: "completed", providerStatus: retry.status,
        providerReceipt: retry.body, readback: readback?.body || null,
      });
      return { ...retry, retried_after_readback: true };
    }
    first = retry;
  }

  if (persist) await writeReceipt(pool, {
    runId, stepKey: step.step_key, operationKey: step.tool_key || step.handler,
    idempotencyKey, requestSha, dispatchStatus: "failed", providerStatus: first.status,
    providerReceipt: first.body, readback: readback?.body || null,
  });
  return first;
}

function normalizeRuntimeEndpointResultBody(result) {
  let body = toolBody(result) || {};
  for (let depth = 0; depth < 6; depth += 1) {
    if (body?.result?.result?.body && typeof body.result.result.body === "object") {
      body = body.result.result.body;
      continue;
    }
    if (body?.result?.body && typeof body.result.body === "object") {
      body = body.result.body;
      continue;
    }
    if (body?.body && typeof body.body === "object") {
      body = body.body;
      continue;
    }
    break;
  }
  return body || {};
}

function githubData(result) {
  const body = normalizeRuntimeEndpointResultBody(result);
  return body?.data?.data || body?.data || body;
}

function githubRepositoryData(result) {
  const body = githubData(result);
  return body?.repository || body?.data?.repository || body?.data?.data?.repository || null;
}

function githubRefSha(result) {
  const body = githubData(result);
  return compact(
    body?.object?.sha
    || body?.data?.object?.sha
    || body?.data?.data?.object?.sha
    || body?.sha
    || body?.data?.sha
    || "",
    64,
  );
}

async function executeDocsAgentStabilization(input, dispatch) {
  if (!input.pull_number) return { ok: false, status: "awaiting_input", missing_required_fields: ["pull_number"], secrets_included: false };
  const args = {
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_get_pull_request",
    path_params: { owner: input.owner, repo: input.repo, pull_number: String(input.pull_number) },
    credential_scope: "platform",
    timeout_seconds: 60,
  };
  const first = await dispatchAndCollect(dispatch, "runtime_endpoint_call", args);
  const second = await dispatchAndCollect(dispatch, "runtime_endpoint_call", args);
  const a = githubData(first)?.data || githubData(first);
  const b = githubData(second)?.data || githubData(second);
  const headA = compact(a?.head?.sha || a?.headRefOid || "", 64);
  const headB = compact(b?.head?.sha || b?.headRefOid || "", 64);
  const updatedAt = new Date(b?.updated_at || b?.updatedAt || 0).getTime();
  const stabilityWindow = boundedInt(input.stability_window_seconds, 20, 0, 300);
  const ageSeconds = updatedAt ? Math.max(0, Math.floor((Date.now() - updatedAt) / 1000)) : null;
  const stable = first.ok && second.ok && headA && headA === headB && (ageSeconds === null || ageSeconds >= stabilityWindow);
  return {
    ok: stable,
    status: stable ? "stable" : "awaiting_stability",
    head_sha: headB || headA || null,
    head_unchanged_across_reads: Boolean(headA && headA === headB),
    updated_age_seconds: ageSeconds,
    required_stability_window_seconds: stabilityWindow,
    next_action: stable ? "continue_ci" : "rerun_after_automation_commits_settle",
    secrets_included: false,
  };
}

async function executeDeploymentParity(input, dispatch) {
  const local = await dispatchAndCollect(dispatch, "repo_inspect", { action: "git_status", max_chars: 12000 });
  const remote = await dispatchAndCollect(dispatch, "github_rest_endpoint_dispatch", {
    tool_args: {
      parent_action_key: "github_api_mcp",
      endpoint_key: "github_get_reference",
      path_params: { owner: input.owner, repo: input.repo, ref: `heads/${input.default_branch}` },
      credential_scope: "platform",
      timeout_seconds: 60,
    },
  });
  const localBody = toolBody(local)?.result || toolBody(local);
  const productionSha = compact(localBody?.head_sha || "", 64);
  const mainSha = githubRefSha(remote);
  const clean = /^## HEAD \(no branch\)\s*$/m.test(String(localBody?.status || "").trim()) || /working tree clean/i.test(String(localBody?.status || ""));
  const parity = local.ok && remote.ok && productionSha && mainSha && productionSha === mainSha && clean;
  return {
    ok: parity,
    status: parity ? "stable" : "deploying_or_degraded",
    production_sha: productionSha || null,
    main_sha: mainSha || null,
    checkout_clean: clean,
    parity,
    next_action: parity ? "continue" : "recheck_auto_deploy_without_ssh",
    secrets_included: false,
  };
}

export async function executeCiAutoRecovery(input, dispatch, suppliedArgs = {}) {
  if (!input.pull_number) return { ok: false, status: "awaiting_input", missing_required_fields: ["pull_number"], secrets_included: false };
  const gateArgs = { owner: input.owner, repo: input.repo, pull_number: input.pull_number, required_checks: input.required_checks || REQUIRED_CHECKS };
  const before = await dispatchAndCollect(dispatch, "github_pr_ci_gate", gateArgs);
  const gate = toolBody(before)?.result || toolBody(before);
  if (before.ok && gate?.gate_status === "pass") return { ok: true, status: "already_passing", gate, secrets_included: false };
  const missing = gate?.missing_checks || [];
  const pending = gate?.pending_checks || [];
  if (!missing.length && pending.length) {
    return { ok: false, status: "checks_pending", gate, next_action: "rerun_status_after_checks_complete", secrets_included: false };
  }
  if (!suppliedArgs?.dispatch_args?.mutation_approval) {
    return {
      ok: false,
      status: "awaiting_input",
      gate,
      missing_required_fields: ["step_args.ci_auto_recovery.dispatch_args.mutation_approval"],
      required_dispatch: {
        tool_key: "github_rest_endpoint_dispatch",
        tool_args: {
          parent_action_key: "github_api_mcp",
          endpoint_key: "github_create_workflow_dispatch",
          path_params: { owner: input.owner, repo: input.repo, workflow_id: suppliedArgs?.workflow_id || "ci.yml" },
          body: { ref: input.branch, inputs: {} },
        },
      },
      secrets_included: false,
    };
  }
  const dispatchArgs = mergeArgs({
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_create_workflow_dispatch",
    path_params: { owner: input.owner, repo: input.repo, workflow_id: suppliedArgs?.workflow_id || "ci.yml" },
    body: { ref: input.branch, inputs: {} },
    credential_scope: "platform",
    timeout_seconds: 120,
  }, suppliedArgs.dispatch_args);
  const dispatched = await dispatchAndCollect(dispatch, "github_rest_endpoint_dispatch", { tool_args: dispatchArgs });
  if (!dispatched.ok) return { ok: false, status: "dispatch_failed", dispatch: safeSummary(dispatched.body), secrets_included: false };
  const after = await dispatchAndCollect(dispatch, "github_pr_ci_gate", gateArgs);
  return {
    ok: after.ok && toolBody(after)?.result?.gate_status === "pass",
    status: toolBody(after)?.result?.gate_status === "pass" ? "recovered" : "dispatched_pending_readback",
    dispatch: safeSummary(dispatched.body),
    gate: toolBody(after)?.result || toolBody(after),
    secrets_included: false,
  };
}

async function executeMigrationLedgerReadback(input, pool) {
  if (!input.migration) return { ok: true, skipped: true, reason: "migration_not_supplied", secrets_included: false };
  const params = [input.migration];
  let sql = `SELECT run_id, migration_file, migration_checksum_sha256, runner_version, mode, statement_count,
                    preflight_status, preflight_risk_count, applied_at, secrets_included
               FROM governed_migration_ledger WHERE migration_file = ?`;
  if (input.expected_checksum_sha256) {
    sql += " AND migration_checksum_sha256 = ?";
    params.push(input.expected_checksum_sha256);
  }
  sql += " ORDER BY applied_at DESC LIMIT 5";
  const result = await safeQuery(pool, sql, params);
  return {
    ok: result.ok && result.rows.length > 0,
    ledger_count: result.rows.length,
    rows: result.rows,
    error: result.error,
    secrets_included: false,
  };
}

async function executeRepositoryInventory(input, dispatch) {
  const query = `query RepositoryAutomationInventory($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){defaultBranchRef{name target{... on Commit{oid committedDate}}}refs(refPrefix:"refs/heads/",first:100){nodes{name target{... on Commit{oid}}}}openPullRequests:pullRequests(states:OPEN,first:100,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title isDraft headRefName headRefOid baseRefName updatedAt}}recentPullRequests:pullRequests(states:[MERGED,CLOSED],first:100,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number state mergedAt headRefName headRefOid mergeCommit{oid}}}}}`;
  const result = await dispatchAndCollect(dispatch, "github_rest_endpoint_dispatch", {
    tool_args: {
      parent_action_key: "github_api_mcp",
      endpoint_key: "github_graphql",
      body: { query, variables: { owner: input.owner, repo: input.repo } },
      credential_scope: "platform",
      timeout_seconds: 60,
    },
  });
  const repoData = githubRepositoryData(result);
  if (!result.ok || !repoData) return { ok: false, status: "inventory_failed", provider: safeSummary(result.body), secrets_included: false };
  const refs = repoData.refs?.nodes || [];
  const refNames = new Set(refs.map((ref) => ref.name));
  const mergedBranchesPresent = (repoData.recentPullRequests?.nodes || [])
    .filter((pr) => pr.mergedAt && pr.headRefName && refNames.has(pr.headRefName))
    .map((pr) => ({ pull_number: pr.number, branch: pr.headRefName, head_sha: pr.headRefOid, merge_sha: pr.mergeCommit?.oid || null }));
  return {
    ok: true,
    main: repoData.defaultBranchRef || null,
    branch_count: refs.length,
    open_pull_requests: repoData.openPullRequests?.nodes || [],
    merged_branches_present: mergedBranchesPresent,
    secrets_included: false,
  };
}

export async function scanRepositoryAutomationHygiene(input = {}, deps = {}) {
  assertSecretFree(input);
  const pool = deps.pool || getPool();
  const findings = [];
  const now = deps.now ? new Date(deps.now) : new Date();
  const staleHours = boundedInt(input.stale_hours, 24, 1, 24 * 30);

  const envelopes = await safeQuery(pool,
    `SELECT envelope_id, envelope_status, decision, execution_status, expires_at
       FROM capability_resolution_envelope_ledger
      WHERE expires_at <= NOW()
        AND execution_status IN ('not_executed','referenced')
        AND envelope_status IN ('ready_requires_approval','ready_for_dispatch')
      ORDER BY expires_at ASC LIMIT 100`
  );
  for (const row of envelopes.rows) findings.push({
    severity: "medium", category: "expired_capability_envelope", resource_key: row.envelope_id,
    evidence: { envelope_status: row.envelope_status, execution_status: row.execution_status, expires_at: row.expires_at },
    recommended_action: "create_fresh_envelope_just_in_time_or_cancel_stale_envelope",
  });

  const migrations = await safeQuery(pool,
    `SELECT r.migration_file, r.authorization_status, r.updated_at
       FROM governed_migration_authorization_registry r
       LEFT JOIN governed_migration_ledger l ON l.migration_file = r.migration_file AND l.mode = 'apply'
      WHERE r.authorization_status = 'authorized' AND l.run_id IS NULL
      ORDER BY r.updated_at ASC LIMIT 100`
  );
  for (const row of migrations.rows) findings.push({
    severity: "medium", category: "authorized_unapplied_migration", resource_key: row.migration_file,
    evidence: { authorization_status: row.authorization_status, updated_at: row.updated_at },
    recommended_action: "review_checksum_then_dry_run_or_disable_authorization",
  });

  const staleRuns = await safeQuery(pool,
    `SELECT run_id, automation_key, status, stage, updated_at
       FROM repository_automation_runs
      WHERE status NOT IN ('completed','failed','blocked','cancelled')
        AND updated_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
      ORDER BY updated_at ASC LIMIT 100`,
    [staleHours]
  );
  for (const row of staleRuns.rows) findings.push({
    severity: "medium", category: "stale_automation_run", resource_key: row.run_id,
    evidence: { automation_key: row.automation_key, status: row.status, stage: row.stage, updated_at: row.updated_at },
    recommended_action: "resume_or_cancel_after_resource_fingerprint_revalidation",
  });

  const policy = await safeQuery(pool,
    `SELECT policy_value FROM execution_policies
      WHERE policy_group = 'Repository Mutation Governance'
        AND policy_key = 'Stale Duplicate Branch Merge Guard'
        AND active = 'TRUE' AND blocking = 'TRUE' LIMIT 1`
  );
  const policyValue = parseJson(policy.rows[0]?.policy_value, {});
  const overrides = policyValue?.superseded_branch_delete_branch_overrides || {};
  for (const [branch, config] of Object.entries(overrides)) {
    const expiresAt = config?.expires_at ? new Date(config.expires_at) : null;
    findings.push({
      severity: expiresAt && expiresAt <= now ? "high" : "low",
      category: expiresAt && expiresAt <= now ? "expired_temporary_branch_override" : "active_temporary_branch_override",
      resource_key: branch,
      evidence: {
        expected_branch_sha: config?.expected_branch_sha || null,
        max_ahead_commits: config?.max_ahead_commits || null,
        expires_at: config?.expires_at || null,
        reason: config?.reason || null,
      },
      recommended_action: expiresAt && expiresAt <= now ? "remove_override_with_governed_migration" : "verify_branch_cleanup_then_remove_override",
    });
  }

  let github = null;
  let parity = null;
  if (bool(input.include_github, true) && typeof deps.dispatch === "function") {
    github = await executeRepositoryInventory({
      owner: compact(input.owner || "mad4bdigital-ai", 191),
      repo: compact(input.repo || "multi-business-multi-role-growth-intelligence-os", 191),
      default_branch: compact(input.default_branch || "main", 191),
    }, deps.dispatch);
    if (github.ok) {
      for (const item of github.merged_branches_present || []) findings.push({
        severity: "low", category: "merged_pull_request_branch_present", resource_key: item.branch,
        evidence: item, recommended_action: "run_governed_branch_cleanup_dry_run",
      });
      const staleDays = boundedInt(input.stale_draft_days, 7, 1, 365);
      for (const pr of github.open_pull_requests || []) {
        const ageDays = pr.updatedAt ? Math.floor((now.getTime() - new Date(pr.updatedAt).getTime()) / 86400000) : null;
        if (pr.isDraft && ageDays !== null && ageDays >= staleDays) findings.push({
          severity: "low", category: "stale_draft_pull_request", resource_key: String(pr.number),
          evidence: { title: pr.title, branch: pr.headRefName, updated_at: pr.updatedAt, age_days: ageDays },
          recommended_action: "review_close_or_resume",
        });
      }
    }
    parity = await executeDeploymentParity({
      owner: compact(input.owner || "mad4bdigital-ai", 191),
      repo: compact(input.repo || "multi-business-multi-role-growth-intelligence-os", 191),
      default_branch: compact(input.default_branch || "main", 191),
    }, deps.dispatch);
    if (!parity.ok) findings.push({
      severity: "high", category: "production_main_sha_mismatch", resource_key: `${input.owner || "mad4bdigital-ai"}/${input.repo || "multi-business-multi-role-growth-intelligence-os"}`,
      evidence: parity, recommended_action: "recheck_auto_deploy_and_health_without_ssh",
    });
  }

  const bySeverity = findings.reduce((acc, item) => {
    acc[item.severity] = (acc[item.severity] || 0) + 1;
    return acc;
  }, {});
  return {
    ok: true,
    generated_at: now.toISOString(),
    finding_count: findings.length,
    by_severity: bySeverity,
    findings,
    sources: {
      expired_envelopes: envelopes.ok,
      migration_authorizations: migrations.ok,
      automation_runs: staleRuns.ok,
      repository_policy: policy.ok,
      github_inventory: github?.ok ?? null,
      deployment_parity: parity?.ok ?? null,
    },
    schedule: {
      daily: ["expired_temporary_overrides", "merged_pr_branches", "stale_draft_prs", "missing_ci_checks", "production_main_parity", "authorized_unapplied_migrations"],
      weekly: ["sql_cache_health_trend", "migration_ledger_reconciliation", "historical_specs_under_active_paths", "open_pr_dependency_graph"],
      execution_surface: "governed_admin_job_or_n8n",
      mutation_allowed: false,
    },
    secrets_included: false,
  };
}

async function executeInternalStep(step, input, args, deps) {
  if (step.handler === "spec_lifecycle_guard") {
    return classifySpecLifecycle({ changed_files: input.changed_files || [], intent: input.spec_intent || input.intent || "auto", historical: input.historical });
  }
  if (step.handler === "docs_agent_stabilization") return executeDocsAgentStabilization(input, deps.dispatch);
  if (step.handler === "deployment_parity") return executeDeploymentParity(input, deps.dispatch);
  if (step.handler === "ci_auto_recovery") return executeCiAutoRecovery(input, deps.dispatch, args);
  if (step.handler === "migration_ledger_readback") return executeMigrationLedgerReadback(input, deps.pool);
  if (step.handler === "repository_inventory") return executeRepositoryInventory(input, deps.dispatch);
  if (step.handler === "hygiene_scan") return scanRepositoryAutomationHygiene(input, deps);
  throw automationError(500, "repository_automation_handler_missing", `No internal handler exists for '${step.handler}'.`);
}

function readbackFactory(step, input, args, dispatch, pool) {
  if (step.step_key === "pr_finalize" || step.step_key === "mark_ready") {
    return () => dispatch("runtime_endpoint_call", {
      parent_action_key: "github_api_mcp",
      endpoint_key: "github_get_pull_request",
      path_params: { owner: input.owner, repo: input.repo, pull_number: String(input.pull_number) },
      credential_scope: "platform",
      timeout_seconds: 60,
    });
  }
  if (step.step_key === "migration_apply") {
    return async () => executeMigrationLedgerReadback(input, pool);
  }
  if (step.step_key === "cleanup_apply") {
    return () => dispatch("runtime_endpoint_call", {
      parent_action_key: "github_api_mcp",
      endpoint_key: "github_get_reference",
      path_params: { owner: input.owner, repo: input.repo, ref: `heads/${input.branch}` },
      credential_scope: "platform",
      timeout_seconds: 60,
    });
  }
  return null;
}

export async function runRepositoryAutomation(input = {}, deps = {}) {
  assertSecretFree(input);
  const plan = buildRepositoryAutomationPlan(input);
  if (plan.mode !== "apply") {
    return { ...plan, status: "dry_run_complete", mutations_executed: false, provider_writes_executed: false, secrets_included: false };
  }
  if (typeof deps.dispatch !== "function") {
    throw automationError(500, "repository_automation_dispatch_missing", "Apply mode requires a governed tool dispatcher.");
  }
  const persist = deps.persist !== false;
  const resolveEnvelope = deps.resolveEnvelope || resolveCapabilityExecutionEnvelope;
  const pool = deps.pool || ((persist || resolveEnvelope === resolveCapabilityExecutionEnvelope) ? getPool() : null);
  const expectedTenantId = compact(deps.auth?.tenant_id || PLATFORM_TENANT_ID, 64);
  const expectedUserId = compact(deps.auth?.user_id || "", 64);
  const envelope = await resolveEnvelope({
    pool,
    source: input,
    acceptedAppKeys: ["platform_orchestration"],
    acceptedIntents: ["repository_automation_run", "repository_automation_apply", "repo_automation"],
    expectedTenantId,
    expectedUserId,
    requireReadyForDispatch: true,
    requireDispatchAllowed: true,
    requireNoApprovalRequired: true,
    requireNoBlockingGaps: true,
    requireNoSecrets: true,
  });
  if (!envelope.ok) throw capabilityEnvelopeError(envelope, "Repository automation apply requires a ready platform_orchestration capability envelope.");
  if (persist) await (deps.markEnvelopeReferenced || markCapabilityEnvelopeReferenced)({ pool, envelopeId: envelope.envelope_id, executionRef: `repository_automation:${plan.plan_sha256}` });

  const persisted = persist ? await persistRun(pool, plan, input) : { row: { run_id: input.run_id || randomUUID(), status: "planned" }, created: true };
  const runId = persisted.row.run_id;
  if (!persisted.created && TERMINAL_RUN_STATUSES.has(String(persisted.row.status))) {
    return readRepositoryAutomationRun({ run_id: runId }, { pool });
  }
  if (persist) await updateRun(pool, runId, { status: "running", stage: "execution_started", summary: { plan_sha256: plan.plan_sha256 } });

  const results = [];
  let mutationCount = 0;
  for (const step of plan.steps) {
    const supplied = stepArgsFor(input, step.step_key);
    const args = mergeArgs(defaultStepArgs(step, input), supplied);
    const missing = (step.required_step_fields || []).filter((path) => getPath(args, path) === undefined || getPath(args, path) === null || getPath(args, path) === "");
    if (step.mutation_required && missing.length) {
      const checkpoint = { step_key: step.step_key, status: "awaiting_input", missing_required_fields: missing, required_capability: step.capability, secrets_included: false };
      if (persist) {
        await updateStep(pool, runId, step.step_key, { status: "awaiting_input", output: checkpoint });
        await updateRun(pool, runId, { status: "awaiting_input", stage: step.step_key, summary: checkpoint });
      }
      return { ok: false, run_id: runId, status: "awaiting_input", checkpoint, results, mutations_executed: mutationCount > 0, secrets_included: false };
    }
    if (persist) await updateStep(pool, runId, step.step_key, { status: "running", incrementAttempt: true });
    let result;
    try {
      if (step.handler) {
        result = await executeInternalStep(step, { ...input, owner: plan.owner, repo: plan.repo, default_branch: plan.default_branch }, args, { ...deps, pool });
      } else {
        result = await dispatchWithReceipt({
          pool,
          runId,
          step,
          args,
          dispatch: deps.dispatch,
          readbackDispatch: readbackFactory(step, { ...input, owner: plan.owner, repo: plan.repo, default_branch: plan.default_branch }, args, deps.dispatch, pool),
          persist,
        });
        result = { ...normalizeDispatchResult(result), chunk_collection: result.chunk_collection || null, recovered_from_transport: result.recovered_from_transport || false, secrets_included: false };
      }
    } catch (error) {
      const failure = { code: error.code || "repository_automation_step_failed", message: error.message, details: error.details || null, secrets_included: false };
      if (persist) {
        await updateStep(pool, runId, step.step_key, { status: "failed", error: failure, complete: true });
        await updateRun(pool, runId, { status: "failed", stage: step.step_key, error: failure, complete: true });
      }
      return { ok: false, run_id: runId, status: "failed", failed_step: step.step_key, error: failure, results, mutations_executed: mutationCount > 0, secrets_included: false };
    }

    const resultOk = result?.ok === true;
    const waiting = ["awaiting_input", "awaiting_stability", "checks_pending", "dispatched_pending_readback", "deploying_or_degraded"].includes(String(result?.status || ""));
    const stepStatus = resultOk ? "completed" : waiting ? "awaiting_input" : "blocked";
    if (step.mutation_required && resultOk) mutationCount += 1;
    results.push({ step_key: step.step_key, status: stepStatus, result: safeSummary(result), secrets_included: false });
    if (persist) await updateStep(pool, runId, step.step_key, { status: stepStatus, output: result, complete: resultOk || stepStatus === "blocked" });
    if (!resultOk) {
      const runStatus = waiting ? "awaiting_input" : "blocked";
      if (persist) await updateRun(pool, runId, { status: runStatus, stage: step.step_key, summary: result, complete: runStatus === "blocked" });
      return {
        ok: false,
        run_id: runId,
        status: runStatus,
        checkpoint: waiting ? { step_key: step.step_key, result: safeSummary(result), secrets_included: false } : null,
        blocked_step: waiting ? null : step.step_key,
        results,
        mutations_executed: mutationCount > 0,
        secrets_included: false,
      };
    }
  }

  const summary = { completed_step_count: results.length, mutation_step_count: mutationCount, plan_sha256: plan.plan_sha256, secrets_included: false };
  if (persist) await updateRun(pool, runId, { status: "completed", stage: "complete", summary, complete: true });
  return { ok: true, run_id: runId, status: "completed", results, summary, mutations_executed: mutationCount > 0, secrets_included: false };
}

export async function readRepositoryAutomationRun(input = {}, deps = {}) {
  const runId = compact(input.run_id || input.runId || "", 64);
  if (!runId) throw automationError(400, "repository_automation_run_id_required", "run_id is required.");
  const pool = deps.pool || getPool();
  const run = await safeQuery(pool, "SELECT * FROM repository_automation_runs WHERE run_id = ? LIMIT 1", [runId]);
  if (!run.rows[0]) throw automationError(404, "repository_automation_run_not_found", "Repository automation run was not found.");
  const steps = await safeQuery(pool, "SELECT * FROM repository_automation_step_runs WHERE run_id = ? ORDER BY step_order", [runId]);
  const receipts = await safeQuery(pool, "SELECT * FROM repository_automation_receipts WHERE run_id = ? ORDER BY created_at", [runId]);
  const normalizeRow = (row) => ({
    ...row,
    plan_json: row.plan_json ? parseJson(row.plan_json, null) : undefined,
    summary_json: row.summary_json ? parseJson(row.summary_json, null) : undefined,
    error_json: row.error_json ? parseJson(row.error_json, null) : undefined,
    output_json: row.output_json ? parseJson(row.output_json, null) : undefined,
    provider_receipt_json: row.provider_receipt_json ? parseJson(row.provider_receipt_json, null) : undefined,
    readback_json: row.readback_json ? parseJson(row.readback_json, null) : undefined,
    secrets_included: false,
  });
  return {
    ok: true,
    run: normalizeRow(run.rows[0]),
    steps: steps.rows.map(normalizeRow),
    receipts: receipts.rows.map(normalizeRow),
    secrets_included: false,
  };
}
