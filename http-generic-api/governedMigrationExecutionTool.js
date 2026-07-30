import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";

const execFileAsync = promisify(execFile);
const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = path.join(API_DIR, "migrations");
const DEFAULT_RUNNER_PATH = path.join(API_DIR, "scripts", "governed-migration-runner.mjs");
const READINESS_REPAIR_MIGRATION = "20260725_repository_authority_capability_readiness_repair.sql";
const MIGRATION_RUNNER_PATHS = Object.freeze({
  [READINESS_REPAIR_MIGRATION]: path.join(
    API_DIR,
    "scripts",
    "repository-authority-capability-readiness-repair-runner.mjs",
  ),
});
const MIGRATION_PATTERN = /^[A-Za-z0-9._-]+\.sql$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function toolError(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

export function governedMigrationApplyConfirmation(migration = "") {
  const normalized = String(migration || "")
    .replace(/\.sql$/i, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase();
  return `APPLY_${normalized}`;
}

export function splitGovernedMigrationStatements(sql = "") {
  return splitMigrationSqlStatements(sql);
}

function normalizeInput(input = {}) {
  const migration = String(input.migration || "").trim();
  const mode = String(input.mode || "dry_run").trim().toLowerCase();
  const expectedChecksum = String(input.expected_checksum_sha256 || "").trim().toLowerCase();
  const expectedStatementCount = Number(input.expected_statement_count);

  if (!MIGRATION_PATTERN.test(migration) || path.basename(migration) !== migration) {
    throw toolError("invalid_migration_filename", "migration must be one repository migration filename ending in .sql.");
  }
  if (!["dry_run", "apply"].includes(mode)) {
    throw toolError("invalid_migration_execution_mode", "mode must be dry_run or apply.");
  }
  if (!SHA256_PATTERN.test(expectedChecksum)) {
    throw toolError("invalid_expected_migration_checksum", "expected_checksum_sha256 must be a lowercase SHA-256 value.");
  }
  if (!Number.isInteger(expectedStatementCount) || expectedStatementCount < 1 || expectedStatementCount > 5000) {
    throw toolError("invalid_expected_statement_count", "expected_statement_count must be an integer from 1 to 5000.");
  }

  return {
    migration,
    mode,
    expectedChecksum,
    expectedStatementCount,
    confirm: String(input.confirm || "").trim(),
    capabilityEnvelopeId: String(input.capability_envelope_id || "").trim(),
  };
}

export async function inspectGovernedMigrationExecution(input = {}, deps = {}) {
  const normalized = normalizeInput(input);
  const migrationsDir = deps.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const migrationPath = path.join(migrationsDir, normalized.migration);
  const sql = await (deps.readFile || fs.readFile)(migrationPath, "utf8");
  const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
  const statementCount = splitGovernedMigrationStatements(sql).length;

  if (checksum !== normalized.expectedChecksum) {
    throw toolError("migration_checksum_mismatch", "Merged migration checksum does not match the approved checksum.", 409, {
      migration: normalized.migration,
      expected_checksum_sha256: normalized.expectedChecksum,
      actual_checksum_sha256: checksum,
      secrets_included: false,
    });
  }
  if (statementCount !== normalized.expectedStatementCount) {
    throw toolError("migration_statement_count_mismatch", "Merged migration statement count does not match the approved count.", 409, {
      migration: normalized.migration,
      expected_statement_count: normalized.expectedStatementCount,
      actual_statement_count: statementCount,
      secrets_included: false,
    });
  }

  const requiredConfirmation = governedMigrationApplyConfirmation(normalized.migration);
  if (normalized.mode === "apply" && normalized.confirm !== requiredConfirmation) {
    throw toolError("migration_apply_confirmation_required", `Apply requires confirm=${requiredConfirmation}.`, 409, {
      migration: normalized.migration,
      required_confirmation: requiredConfirmation,
      secrets_included: false,
    });
  }
  if (normalized.mode === "apply" && !normalized.capabilityEnvelopeId) {
    throw toolError("migration_apply_capability_envelope_required", "Apply requires capability_envelope_id.", 403);
  }

  return {
    ...normalized,
    migrationPath,
    migration_checksum_sha256: checksum,
    statement_count: statementCount,
    required_confirmation: requiredConfirmation,
    runner_path: MIGRATION_RUNNER_PATHS[normalized.migration] || DEFAULT_RUNNER_PATH,
    atomic_runner_required: normalized.migration === READINESS_REPAIR_MIGRATION,
    secrets_included: false,
  };
}

function extractRunnerPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.ok === "boolean") return value;
  const nestedRaw = typeof value.message === "string" ? value.message.trim() : "";
  if (!nestedRaw) return null;
  try {
    const nested = JSON.parse(nestedRaw);
    return nested && typeof nested === "object" && !Array.isArray(nested) && typeof nested.ok === "boolean"
      ? nested
      : null;
  } catch {
    return null;
  }
}

function parseRunnerOutput(stdout = "") {
  const raw = String(stdout || "").trim();
  if (!raw) throw toolError("governed_migration_runner_empty_output", "Governed migration runner returned no JSON output.", 502);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw toolError("governed_migration_runner_invalid_output", "Governed migration runner returned invalid JSON output.", 502);
  }
  const payload = extractRunnerPayload(parsed);
  if (!payload) throw toolError("governed_migration_runner_invalid_output", "Governed migration runner returned an unsupported JSON envelope.", 502);
  return payload;
}

const RUNNER_SENSITIVE_ASSIGNMENT = /\b([A-Za-z0-9_]*(?:secret|password|passwd|token|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_]*)\s*=\s*([^\s,;]+)/gi;
const RUNNER_BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const RUNNER_URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

function sanitizeRunnerDiagnostic(value = "", maxLength = 2000) {
  return String(value || "")
    .replace(RUNNER_SENSITIVE_ASSIGNMENT, (_match, key) => `${key}=[redacted]`)
    .replace(RUNNER_BEARER_VALUE, "Bearer [redacted]")
    .replace(RUNNER_URL_CREDENTIALS, "$1[redacted]@")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function runnerFailureDetails(error, inspection) {
  const stderrSummary = sanitizeRunnerDiagnostic(error?.stderr || error?.message || "");
  const stdoutSummary = sanitizeRunnerDiagnostic(error?.stdout || "");
  const diagnosticText = `${stderrSummary}\n${stdoutSummary}`;
  const mysqlCode = diagnosticText.match(/\b(ER_[A-Z0-9_]+)\b/)?.[1] || null;
  return {
    migration: inspection.migration,
    execution_mode: inspection.mode,
    exit_code: error?.code ?? error?.exitCode ?? null,
    signal: error?.signal || null,
    runner_error_code: mysqlCode || null,
    stderr_summary: stderrSummary || null,
    stdout_summary: stdoutSummary || null,
    diagnostic_truncated: String(error?.stderr || "").length > 2000 || String(error?.stdout || "").length > 2000,
    retry_without_readback_allowed: false,
    secrets_included: false,
  };
}

function parseRunnerErrorPayload(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const candidates = [raw];
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(raw.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
    }
  }
  return null;
}

function classifyRunnerFailure(error, inspection) {
  const payload = parseRunnerErrorPayload(error?.stderr) || parseRunnerErrorPayload(error?.stdout);
  const runnerMessage = String(payload?.error || payload?.message || error?.message || "").trim();
  const authorizationMatch = runnerMessage.match(
    /Migration is not authorized for governed runner:\s*([A-Za-z0-9._-]+\.sql)\s*\(([^)]+)\)/i,
  );
  if (!authorizationMatch) return null;
  return {
    code: "governed_migration_authorization_required",
    status: 409,
    message: "Governed migration authorization is required before dry-run or apply.",
    details: {
      migration: inspection.migration,
      runner_migration: authorizationMatch[1] || inspection.migration,
      execution_mode: inspection.mode,
      authorization_required: true,
      authorization_reason: authorizationMatch[2] || "migration_not_authorized",
      next_step: "run governed_migration_authorization_bootstrap for the checksum-bound migration before governed_migration_execute",
      runner_error_message: sanitizeRunnerDiagnostic(runnerMessage, 1000) || null,
      secrets_included: false,
    },
  };
}

function validateRunnerReadback(result, inspection) {
  if (!result || result.ok !== true) {
    throw toolError("governed_migration_runner_blocked", "Governed migration runner did not return a successful result.", 409, result || undefined);
  }
  if (String(result.migration || "") !== inspection.migration) {
    throw toolError("governed_migration_runner_migration_mismatch", "Runner migration readback does not match the requested migration.", 502);
  }
  if (String(result.migration_checksum_sha256 || "").toLowerCase() !== inspection.migration_checksum_sha256) {
    throw toolError("governed_migration_runner_checksum_mismatch", "Runner checksum readback does not match the approved checksum.", 502);
  }
  if (Number(result.statement_count ?? result.statements_executed) !== inspection.statement_count) {
    throw toolError("governed_migration_runner_statement_count_mismatch", "Runner statement-count readback does not match the approved count.", 502);
  }

  if (inspection.mode === "dry_run") {
    if (result.applies_sql !== false || result.mode !== "dry_run") {
      throw toolError("governed_migration_dry_run_contract_violation", "Dry-run result must confirm applies_sql=false.", 502);
    }
    return;
  }

  if (result.mode !== "apply" || result.applies_sql !== true || Number(result.statements_executed) !== inspection.statement_count) {
    throw toolError("governed_migration_apply_readback_failed", "Apply readback did not confirm all approved statements were executed.", 502);
  }
  if (result.ledger?.recorded !== true || !result.ledger?.run_id) {
    throw toolError("governed_migration_ledger_readback_failed", "Apply readback did not confirm a governed migration ledger row.", 502);
  }
  const requiredObjects = Array.isArray(result.requirements?.schema_objects) ? result.requirements.schema_objects : [];
  const afterObjects = new Set(Array.isArray(result.after_schema_objects) ? result.after_schema_objects : []);
  const missingObjects = requiredObjects.filter((name) => !afterObjects.has(name));
  if (missingObjects.length) {
    throw toolError("governed_migration_schema_readback_failed", "Apply readback is missing required schema objects.", 502, {
      missing_schema_objects: missingObjects,
      secrets_included: false,
    });
  }
  if (inspection.atomic_runner_required) {
    if (result.atomic_transaction !== true || result.same_cycle_row_readback_verified !== true) {
      throw toolError(
        "governed_migration_atomic_readback_failed",
        "Readiness repair apply must confirm one atomic transaction and same-cycle row readback.",
        502,
      );
    }
    if (result.capability_envelope?.consumed !== true) {
      throw toolError(
        "governed_migration_capability_envelope_consume_failed",
        "Readiness repair apply must consume the capability envelope in the same transaction.",
        502,
      );
    }
  }
}

function assertApplyCapability(capability, inspection) {
  if (!capability || !capability.envelope_id) {
    throw toolError("governed_migration_apply_capability_envelope_unresolved", "Apply authorizer did not return a capability envelope.", 403);
  }
  if (capability.apply_allowed !== true) {
    throw toolError("governed_migration_apply_not_allowed", "Capability envelope does not permit migration apply.", 403, {
      migration: inspection.migration,
      capability_envelope_id: capability.envelope_id,
      apply_allowed: false,
      secrets_included: false,
    });
  }
  if (capability.readback_required !== true) {
    throw toolError("governed_migration_readback_not_required", "Capability envelope must require migration readback.", 403, {
      migration: inspection.migration,
      capability_envelope_id: capability.envelope_id,
      secrets_included: false,
    });
  }
}

export async function runGovernedMigrationExecution(input = {}, deps = {}) {
  const inspection = await inspectGovernedMigrationExecution(input, deps);
  let capability = null;
  if (inspection.mode === "apply") {
    if (typeof deps.authorizeApply !== "function") {
      throw toolError("governed_migration_apply_authorizer_missing", "Apply authorization callback is required.", 500);
    }
    capability = await deps.authorizeApply(inspection);
    assertApplyCapability(capability, inspection);
  }

  const configuredRunner = deps.runnerPathByMigration?.[inspection.migration];
  const runnerPath = deps.runnerPath || configuredRunner || inspection.runner_path || DEFAULT_RUNNER_PATH;
  const args = [runnerPath, `--migration=${inspection.migration}`, inspection.mode === "apply" ? "--apply" : "--dry-run"];
  if (inspection.mode === "apply") args.push(`--confirm=${inspection.required_confirmation}`);
  const approvedCapabilityEnvelopeId = capability?.envelope_id || inspection.capabilityEnvelopeId || "";
  if (inspection.mode === "apply" && approvedCapabilityEnvelopeId) {
    args.push(`--capability-envelope-id=${approvedCapabilityEnvelopeId}`);
  }

  const execute = deps.execFile || execFileAsync;
  let execution;
  try {
    execution = await execute(process.execPath, args, {
      cwd: deps.apiDir || API_DIR,
      timeout: Number(deps.timeoutMs || 300000),
      maxBuffer: Number(deps.maxBuffer || 4 * 1024 * 1024),
      windowsHide: true,
    });
  } catch (error) {
    const classified = classifyRunnerFailure(error, inspection);
    if (classified) throw toolError(classified.code, classified.message, classified.status, classified.details);
    const details = runnerFailureDetails(error, inspection);
    const diagnostic = details.runner_error_code
      || details.stderr_summary?.split(/\r?\n/, 1)?.[0]
      || "runner process exited unsuccessfully";
    throw toolError("governed_migration_runner_failed", `Governed migration runner failed: ${diagnostic}`, 409, details);
  }

  const result = parseRunnerOutput(execution?.stdout);
  validateRunnerReadback(result, inspection);
  return {
    ...result,
    execution_mode: inspection.mode,
    capability_envelope_id: approvedCapabilityEnvelopeId || null,
    checksum_verified_before_execution: true,
    statement_count_verified_before_execution: true,
    same_cycle_readback_verified: true,
    secrets_included: false,
  };
}
