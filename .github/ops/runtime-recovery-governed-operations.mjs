import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitMigrationSqlStatements } from "../../http-generic-api/migrationSqlStatements.js";

export const RUNTIME_RECOVERY_CONTRACT = "mad4b.runtime-recovery-governed-operations.v1";
export const CATALOG_MIGRATION = "20260815_custom_gpt_mcp_catalog_levels.sql";
export const CATALOG_MIGRATION_SHA256 = "528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681";
export const CATALOG_STATEMENT_COUNT = 7;
export const VERIFICATION_ONLY_MIGRATIONS = Object.freeze([
  Object.freeze({ migration: "225_sprint67_capability_resolution_envelope_ledger.sql", checksum: "35b034940c2be63d9bf8a8099573cac1c5a75b5fffd8ccfad60a453ed3cf7419", statement_count: 3 }),
  Object.freeze({ migration: "1048_transport_response_chunk_schema_recovery.sql", checksum: "aecfbd9d87dca6eba11677cd992637f55ecf3c0743f704df4bbea48c57d8d788", statement_count: 34 }),
]);
export const WRITE_AUTHORITY_PROFILES = Object.freeze({
  session_continuity_writer: Object.freeze(["customer_sessions", "gpt_session_turns"]),
  runtime_inventory_writer: Object.freeze(["actions", "endpoints", "dynamic_audit_scheduler_runs", "openapi_endpoint_inventory_sync_runs"]),
  observability_sink_writer: Object.freeze(["execution_log", "json_assets"]),
});
export const ALLOWED_TABLE_OPERATIONS = Object.freeze(["SELECT", "INSERT", "UPDATE"]);
export const PHASES = Object.freeze([
  "deploy_readiness", "deploy_apply", "runner_verify", "migration_readiness",
  "migration_apply", "grant_readiness", "grant_apply", "final_verify",
]);

const BROAD_WRITE_PRIVILEGES = new Set([
  "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "INDEX", "TRIGGER",
  "REFERENCES", "EXECUTE", "EVENT", "CREATE ROUTINE", "ALTER ROUTINE", "CREATE VIEW",
  "CREATE TEMPORARY TABLES", "LOCK TABLES",
]);
const SENSITIVE_KEY = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key)/iu;
const SAFE_KEYS = new Set(["authorization_status", "authorization_readback_verified", "secrets_included"]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function required(value, field, pattern) {
  const normalized = String(value || "").trim();
  if (!normalized || (pattern && !pattern.test(normalized))) {
    throw fail("RUNTIME_RECOVERY_INPUT_INVALID", `${field} is missing or invalid.`, { field });
  }
  return normalized;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    SENSITIVE_KEY.test(key) && !SAFE_KEYS.has(key) ? "[redacted]" : sanitize(child),
  ]));
}

function locate(value, predicate, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    const found = locate(child, predicate, seen);
    if (found) return found;
  }
  return null;
}

function collectShas(value, found = new Set()) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\b[0-9a-f]{40}\b/giu)) found.add(match[0].toLowerCase());
  } else if (Array.isArray(value)) {
    for (const child of value) collectShas(child, found);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectShas(child, found);
  }
  return found;
}

export function expectedConfirmation(phase, { productionSha = "", profile = "" } = {}) {
  switch (phase) {
    case "deploy_readiness": return "PLAN_PRODUCTION_RUNTIME_DEPLOY";
    case "deploy_apply": return `APPLY_PRODUCTION_RUNTIME_DEPLOY_${required(productionSha, "expected_production_sha", /^[0-9a-f]{40}$/iu).toUpperCase()}`;
    case "runner_verify": return "VERIFY_GOVERNED_MIGRATION_RUNNER_INTEGRITY";
    case "migration_readiness": return "AUTHORIZE_GOVERNED_MIGRATION_20260815_CUSTOM_GPT_MCP_CATALOG_LEVELS";
    case "migration_apply": return "APPLY_20260815_CUSTOM_GPT_MCP_CATALOG_LEVELS";
    case "grant_readiness": return `VERIFY_RUNTIME_WRITE_AUTHORITY_${resolveProfile(profile).profile.toUpperCase()}`;
    case "grant_apply": return `APPLY_RUNTIME_WRITE_AUTHORITY_${resolveProfile(profile).profile.toUpperCase()}`;
    case "final_verify": return "VERIFY_PRODUCTION_RUNTIME_RECOVERY";
    default: throw fail("RUNTIME_RECOVERY_PHASE_INVALID", "Unsupported runtime recovery phase.", { phase });
  }
}

export function resolveProfile(profile) {
  const normalized = String(profile || "").trim();
  const tables = WRITE_AUTHORITY_PROFILES[normalized];
  if (!tables) throw fail("RUNTIME_RECOVERY_WRITER_PROFILE_INVALID", "Writer profile is not allowlisted.", { profile: normalized });
  return { profile: normalized, tables: [...tables], operations: [...ALLOWED_TABLE_OPERATIONS] };
}

export function assertMigrationModeAllowed(migration, mode) {
  if (mode === "apply" && migration !== CATALOG_MIGRATION) {
    throw fail("RUNTIME_RECOVERY_MIGRATION_APPLY_FORBIDDEN", "Only the exact MCP catalog migration may be applied.", { migration, mode });
  }
  const permitted = migration === CATALOG_MIGRATION || VERIFICATION_ONLY_MIGRATIONS.some((entry) => entry.migration === migration);
  if (!permitted || !["dry_run", "apply"].includes(mode)) {
    throw fail("RUNTIME_RECOVERY_MIGRATION_NOT_ALLOWLISTED", "Migration or mode is not allowlisted.", { migration, mode });
  }
  return true;
}

export function buildTableScopedGrant({ database, principal, accountHost, table, operations = ALLOWED_TABLE_OPERATIONS } = {}) {
  const databaseName = required(database, "database", /^[A-Za-z0-9_]{1,64}$/u);
  const tableName = required(table, "table", /^[A-Za-z0-9_]{1,64}$/u);
  const accountName = required(principal, "principal", /^[A-Za-z0-9_.-]{1,80}$/u);
  const hostName = required(accountHost, "account_host", /^[A-Za-z0-9_.:%-]{1,255}$/u);
  const normalizedOperations = [...new Set((Array.isArray(operations) ? operations : []).map((operation) => String(operation).toUpperCase()))];
  if (normalizedOperations.length !== ALLOWED_TABLE_OPERATIONS.length || normalizedOperations.some((operation) => !ALLOWED_TABLE_OPERATIONS.includes(operation))) {
    throw fail("RUNTIME_RECOVERY_GRANT_OPERATION_FORBIDDEN", "Only SELECT, INSERT and UPDATE may be granted.", { table: tableName });
  }
  return `GRANT ${ALLOWED_TABLE_OPERATIONS.join(", ")} ON \`${databaseName}\`.\`${tableName}\` TO '${accountName}'@'${hostName}'`;
}

export function evaluatePrivilegeSnapshot({ database, profile, tablePrivileges = [], schemaPrivileges = [], userPrivileges = [] } = {}) {
  const selected = resolveProfile(profile);
  const allowed = new Set(ALLOWED_TABLE_OPERATIONS);
  const broadGlobal = userPrivileges.filter((row) => BROAD_WRITE_PRIVILEGES.has(String(row.PRIVILEGE_TYPE || "").toUpperCase()));
  const broadSchema = schemaPrivileges.filter((row) => String(row.TABLE_SCHEMA || "") === database && BROAD_WRITE_PRIVILEGES.has(String(row.PRIVILEGE_TYPE || "").toUpperCase()));
  const tables = selected.tables.map((table) => {
    const rows = tablePrivileges.filter((row) => row.TABLE_SCHEMA === database && row.TABLE_NAME === table);
    const observed = [...new Set(rows.map((row) => String(row.PRIVILEGE_TYPE || "").toUpperCase()))].sort();
    const missing = ALLOWED_TABLE_OPERATIONS.filter((operation) => !observed.includes(operation));
    const forbidden = observed.filter((operation) => !allowed.has(operation));
    const grantOption = rows.some((row) => String(row.IS_GRANTABLE || "NO").toUpperCase() === "YES");
    return { table, observed_operations: observed, missing_operations: missing, forbidden_operations: forbidden, grant_option: grantOption, ready: missing.length === 0 && forbidden.length === 0 && !grantOption };
  });
  return {
    profile: selected.profile,
    database,
    tables,
    broad_global_write_privilege_count: broadGlobal.length,
    broad_schema_write_privilege_count: broadSchema.length,
    ready: broadGlobal.length === 0 && broadSchema.length === 0 && tables.every((table) => table.ready),
    secrets_included: false,
  };
}

function context(env = process.env) {
  const phase = required(env.ROLLOUT_PHASE, "phase");
  if (!PHASES.includes(phase)) throw fail("RUNTIME_RECOVERY_PHASE_INVALID", "Unsupported runtime recovery phase.", { phase });
  const productionSha = required(env.EXPECTED_PRODUCTION_SHA, "expected_production_sha", /^[0-9a-f]{40}$/iu).toLowerCase();
  const profile = String(env.WRITER_PROFILE || "").trim();
  const expected = expectedConfirmation(phase, { productionSha, profile });
  if (String(env.OPERATOR_CONFIRMATION || "") !== expected) {
    throw fail("RUNTIME_RECOVERY_CONFIRMATION_REQUIRED", "The phase-specific typed confirmation is required.", { required_confirmation: expected, phase });
  }
  return {
    phase,
    productionSha,
    profile,
    baseUrl: String(env.RUNTIME_BASE_URL || "https://auth.mad4b.com").replace(/\/+$/u, ""),
    apiKey: required(env.BACKEND_API_KEY, "BACKEND_API_KEY"),
    githubToken: required(env.GH_READ_TOKEN, "GH_READ_TOKEN"),
    repository: required(env.REPOSITORY, "repository", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u),
    evidenceDir: String(env.EVIDENCE_DIR || `${env.RUNNER_TEMP || "/tmp"}/runtime-recovery-governed-operations`),
    targetId: String(env.HOSTINGER_TARGET_ID || "").trim(),
    envelopeId: String(env.CAPABILITY_ENVELOPE_ID || "").trim(),
    sourcePr: Number(env.SOURCE_PULL_REQUEST || 0),
    principal: String(env.RUNTIME_WRITER_PRINCIPAL || "").trim(),
    accountHost: String(env.RUNTIME_WRITER_ACCOUNT_HOST || "%").trim(),
    env,
    migrationApplySent: false,
    grantStatementsSent: 0,
    deploymentSent: false,
  };
}

async function evidence(state, name, value) {
  await fs.mkdir(state.evidenceDir, { recursive: true });
  await fs.writeFile(path.join(state.evidenceDir, `${name}.json`), `${JSON.stringify(sanitize(value), null, 2)}\n`, "utf8");
}

async function github(state, pathname) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${state.githubToken}`, "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw fail("RUNTIME_RECOVERY_GITHUB_READ_FAILED", `GitHub read failed with HTTP ${response.status}.`, { pathname, status: response.status });
  return payload;
}

async function request(state, pathname, { method = "GET", body, authenticated = false, timeoutMs = 60_000 } = {}) {
  try {
    const response = await fetch(`${state.baseUrl}${pathname}`, {
      method,
      redirect: "error",
      headers: {
        Accept: "application/json",
        ...(authenticated ? { Authorization: `Bearer ${state.apiKey}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  } catch (error) {
    return { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: String(error?.name || "Error") };
  }
}

function successful(result, code) {
  if (!result.transport_ok || !result.http_ok || result.payload?.ok === false) {
    const detail = locate(result.payload, (candidate) => typeof candidate.code === "string") || {};
    throw fail(String(detail.code || code), `${code} failed with HTTP ${result.status ?? "transport_error"}.`, { status: result.status, response_code: detail.code || null });
  }
  return result.payload;
}

async function verifyProductionIdentity(state) {
  const ref = await github(state, `/repos/${state.repository}/git/ref/heads/Production`);
  if (String(ref?.object?.sha || "").toLowerCase() !== state.productionSha) {
    throw fail("RUNTIME_RECOVERY_PRODUCTION_SHA_MISMATCH", "Production does not match the exact authorized SHA.", { expected_production_sha: state.productionSha });
  }
  const migrationPath = `http-generic-api/migrations/${CATALOG_MIGRATION}`;
  const file = await github(state, `/repos/${state.repository}/contents/${migrationPath}?ref=${state.productionSha}`);
  const sql = Buffer.from(String(file.content || "").replace(/\s+/gu, ""), "base64").toString("utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const statementCount = splitMigrationSqlStatements(sql).length;
  if (checksum !== CATALOG_MIGRATION_SHA256 || statementCount !== CATALOG_STATEMENT_COUNT) {
    throw fail("RUNTIME_RECOVERY_MIGRATION_ARTIFACT_MISMATCH", "The exact catalog migration artifact does not match its checksum and statement-count contract.", { checksum, statement_count: statementCount });
  }
  const identity = { production_sha: state.productionSha, migration: CATALOG_MIGRATION, migration_blob_sha: file.sha, checksum, statement_count: statementCount, secrets_included: false };
  await evidence(state, "production-identity", identity);
  return identity;
}

async function verifyRuntimeParity(state, { attempts = 1 } = {}) {
  let observed = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const [health, version, deployment] = await Promise.all([
      request(state, "/health", { timeoutMs: 20_000 }),
      request(state, "/version", { timeoutMs: 20_000 }),
      request(state, "/deployment-info", { timeoutMs: 20_000 }),
    ]);
    const branch = String(deployment.payload?.branch || deployment.payload?.deployment?.branch || "");
    observed = {
      attempt,
      health_status: health.status,
      version_status: version.status,
      deployment_status: deployment.status,
      health_ready: health.payload?.ok === true,
      version_matches: collectShas(version.payload).has(state.productionSha),
      deployment_matches: collectShas(deployment.payload).has(state.productionSha),
      deployment_branch: branch || null,
      secrets_included: false,
    };
    if (observed.health_ready && observed.version_matches && observed.deployment_matches && branch === "Production") {
      await evidence(state, "runtime-parity", observed);
      return observed;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  await evidence(state, "runtime-parity", observed);
  throw fail("RUNTIME_RECOVERY_DEPLOYED_SHA_MISMATCH", "The running service does not report the exact protected Production SHA.", observed);
}

async function tool(state, name, toolArgs, timeoutMs = 60_000) {
  return request(state, "/gpt/tools/call", { method: "POST", authenticated: true, timeoutMs, body: { name, tool_args: toolArgs } });
}

async function executeMigration(state, migration, mode, extra = {}) {
  assertMigrationModeAllowed(migration.migration, mode);
  return tool(state, "governed_migration_execute", {
    migration: migration.migration,
    mode,
    expected_checksum_sha256: migration.checksum,
    expected_statement_count: migration.statement_count,
    ...extra,
  }, mode === "dry_run" ? 65_000 : 330_000);
}

async function verifyRunner(state) {
  const results = [];
  for (const migration of VERIFICATION_ONLY_MIGRATIONS) {
    const response = await executeMigration(state, migration, "dry_run");
    const payload = successful(response, "RUNTIME_RECOVERY_APPLIED_LEDGER_PROBE_FAILED");
    const result = locate(payload, (candidate) => candidate.already_applied === true) || payload;
    if (response.status !== 200 || result.already_applied !== true || result.live_schema_preflight_skipped !== true || result.schema_readback_required !== true || result.applies_sql !== false) {
      throw fail("RUNTIME_RECOVERY_APPLIED_LEDGER_CONTRACT_INVALID", "An already-applied migration did not return the exact safe dry-run contract.", { migration: migration.migration, http_status: response.status });
    }
    results.push({ migration: migration.migration, http_status: response.status, already_applied: true, live_schema_preflight_skipped: true, applies_sql: false });
  }
  await evidence(state, "runner-integrity", { ok: true, probes: results, migration_apply_performed: false, secrets_included: false });
  return results;
}

async function catalogReadback(state) {
  const response = await tool(state, "governed_migration_schema_readback", {
    migration: CATALOG_MIGRATION,
    expected_checksum_sha256: CATALOG_MIGRATION_SHA256,
    expected_statement_count: CATALOG_STATEMENT_COUNT,
    expected_columns: [
      { table: "admin_platform_endpoint_tools", column: "mcp_catalog_level" },
      { table: "tenant_platform_endpoint_tools", column: "mcp_catalog_level" },
    ],
  }, 60_000);
  const readback = locate(response.payload, (candidate) => typeof candidate.readback_status === "string") || {};
  const applied = response.transport_ok && readback.readback_status === "pass"
    && readback.ledger?.found === true
    && String(readback.ledger?.migration_file || "") === CATALOG_MIGRATION
    && String(readback.ledger?.migration_checksum_sha256 || "").toLowerCase() === CATALOG_MIGRATION_SHA256
    && String(readback.ledger?.mode || "").toLowerCase() === "apply"
    && Number(readback.ledger?.statement_count || 0) === CATALOG_STATEMENT_COUNT;
  return { applied, response, readback };
}

async function assertCatalogApplied(state) {
  const result = await catalogReadback(state);
  await evidence(state, "catalog-schema-readback", { applied: result.applied, status: result.response.status, readback: result.readback, secrets_included: false });
  if (!result.applied) throw fail("RUNTIME_RECOVERY_CATALOG_SCHEMA_NOT_READY", "The exact catalog apply ledger and both schema columns were not verified.");
  return result;
}

function requiredEnvelope(state) {
  return required(state.envelopeId, "capability_envelope_id", /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
}

async function verifySourcePullRequest(state) {
  if (!Number.isSafeInteger(state.sourcePr) || state.sourcePr < 1) {
    throw fail("RUNTIME_RECOVERY_SOURCE_PR_REQUIRED", "A merged source pull request is required for catalog authorization.");
  }
  const pull = await github(state, `/repos/${state.repository}/pulls/${state.sourcePr}`);
  const mergeSha = String(pull.merge_commit_sha || "").toLowerCase();
  if (!pull.merged_at || !/^[0-9a-f]{40}$/u.test(mergeSha)) {
    throw fail("RUNTIME_RECOVERY_SOURCE_PR_NOT_MERGED", "The source pull request must already be merged.", { pull_request: state.sourcePr });
  }
  const comparison = await github(state, `/repos/${state.repository}/compare/${mergeSha}...${state.productionSha}`);
  if (!["ahead", "identical"].includes(String(comparison.status || ""))) {
    throw fail("RUNTIME_RECOVERY_SOURCE_PR_NOT_IN_PRODUCTION", "The merged source pull request is not an ancestor of exact Production.", { pull_request: state.sourcePr, merge_sha: mergeSha });
  }
  return { pull_request: state.sourcePr, merge_sha: mergeSha };
}

async function deploy(state, apply) {
  const targetId = required(state.targetId, "target_id", /^[A-Za-z0-9_.:-]{1,100}$/u);
  const response = await request(state, "/platform/remote-runtime/hosting/deploy-release", {
    method: "POST",
    authenticated: true,
    timeoutMs: apply ? 330_000 : 60_000,
    body: {
      target_id: targetId,
      branch: "Production",
      expected_commit_sha: state.productionSha,
      app_key: "auth.mad4b.com",
      dry_run: !apply,
      restart: true,
      ...(apply ? {
        capability_envelope_id: requiredEnvelope(state),
        approval_reason: `Explicit protected GitHub Production recovery workflow ${state.env.GITHUB_RUN_ID || "manual"} for exact SHA ${state.productionSha}`,
      } : {}),
    },
  });
  state.deploymentSent = apply;
  const payload = successful(response, apply ? "RUNTIME_RECOVERY_DEPLOY_APPLY_FAILED" : "RUNTIME_RECOVERY_DEPLOY_PLAN_FAILED");
  if (apply && payload.execution?.executed !== true) throw fail("RUNTIME_RECOVERY_DEPLOY_NOT_EXECUTED", "Hostinger deployment did not confirm execution.");
  if (!apply && payload.dry_run !== true) throw fail("RUNTIME_RECOVERY_DEPLOY_PLAN_INVALID", "Hostinger deployment planning must remain dry-run only.");
  await evidence(state, apply ? "deployment-apply" : "deployment-readiness", { result: payload, deployment_performed: apply, secrets_included: false });
  if (apply) await verifyRuntimeParity(state, { attempts: 18 });
  return { deployment_performed: apply, target_id: targetId };
}

async function migrationReadiness(state) {
  const existing = await catalogReadback(state);
  if (existing.applied) return { result: "already_applied", migration_apply_performed: false };
  const source = await verifySourcePullRequest(state);
  const authorization = await tool(state, "governed_migration_authorization_bootstrap", {
    migration: CATALOG_MIGRATION,
    expected_checksum_sha256: CATALOG_MIGRATION_SHA256,
    expected_statement_count: CATALOG_STATEMENT_COUNT,
    pull_request: source.pull_request,
    merge_sha: source.merge_sha,
    confirm: expectedConfirmation("migration_readiness"),
    capability_envelope_id: requiredEnvelope(state),
    decision_note: "Authorize the exact checksum-bound seven-statement MCP catalog migration; SQL Apply remains separately confirmed.",
  });
  successful(authorization, "RUNTIME_RECOVERY_MIGRATION_AUTHORIZATION_FAILED");
  const dryRun = await executeMigration(state, { migration: CATALOG_MIGRATION, checksum: CATALOG_MIGRATION_SHA256, statement_count: CATALOG_STATEMENT_COUNT }, "dry_run");
  const payload = successful(dryRun, "RUNTIME_RECOVERY_MIGRATION_DRY_RUN_FAILED");
  const result = locate(payload, (candidate) => candidate.mode === "dry_run") || payload;
  if (result.applies_sql !== false) throw fail("RUNTIME_RECOVERY_MIGRATION_DRY_RUN_INVALID", "Catalog migration readiness must not execute SQL.");
  await evidence(state, "migration-readiness", { migration: CATALOG_MIGRATION, checksum: CATALOG_MIGRATION_SHA256, statement_count: CATALOG_STATEMENT_COUNT, authorization_readback_verified: true, dry_run_passed: true, migration_apply_performed: false, secrets_included: false });
  return { result: "ready_for_apply", migration_apply_performed: false };
}

async function migrationApply(state) {
  const existing = await catalogReadback(state);
  if (existing.applied) return { result: "already_applied", migration_apply_performed: false, apply_retried: false };
  const candidate = { migration: CATALOG_MIGRATION, checksum: CATALOG_MIGRATION_SHA256, statement_count: CATALOG_STATEMENT_COUNT };
  successful(await executeMigration(state, candidate, "dry_run"), "RUNTIME_RECOVERY_MIGRATION_SAME_CYCLE_DRY_RUN_FAILED");
  const envelopeId = requiredEnvelope(state);
  const authorization = successful(await tool(state, "capability_resolution_envelope_apply_authorize", {
    envelope_id: envelopeId,
    authorized_by: "github_actions_runtime_recovery",
    decision_note: "Authorize exactly one checksum-bound MCP catalog migration Apply after same-cycle dry-run.",
    ttl_minutes: 30,
  }), "RUNTIME_RECOVERY_MIGRATION_APPLY_AUTHORIZATION_FAILED");
  const policy = locate(authorization, (candidatePolicy) => Object.hasOwn(candidatePolicy, "apply_allowed")) || {};
  if (policy.apply_allowed !== true || policy.external_write_allowed !== false) {
    throw fail("RUNTIME_RECOVERY_MIGRATION_APPLY_POLICY_INVALID", "The capability envelope must permit only the governed internal migration Apply.");
  }
  state.migrationApplySent = true;
  await evidence(state, "pre-apply-state", { migration: CATALOG_MIGRATION, apply_sent: true, apply_retried: false, secrets_included: false });
  const response = await executeMigration(state, candidate, "apply", {
    confirm: expectedConfirmation("migration_apply"),
    capability_envelope_id: envelopeId,
  });
  await evidence(state, "migration-apply-response", { transport_ok: response.transport_ok, http_status: response.status, apply_sent: true, apply_retried: false, secrets_included: false });
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const readback = await catalogReadback(state);
    if (readback.applied) {
      await evidence(state, "catalog-schema-readback", { attempt, readback: readback.readback, migration_apply_performed: true, apply_retried: false, secrets_included: false });
      return { result: "applied_and_verified", migration_apply_performed: true, apply_retried: false };
    }
    if (attempt < 8) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw fail("RUNTIME_RECOVERY_MIGRATION_APPLY_READBACK_MISSING", "The single Apply invocation did not produce a verified exact ledger and schema readback; automatic retry is forbidden.", { apply_sent: true, apply_retried: false });
}

async function operatorConnection(state) {
  const env = state.env;
  const config = {
    host: required(env.RUNTIME_DB_OPERATOR_HOST, "RUNTIME_DB_OPERATOR_HOST"),
    database: required(env.RUNTIME_DB_OPERATOR_NAME, "RUNTIME_DB_OPERATOR_NAME", /^[A-Za-z0-9_]{1,64}$/u),
    user: required(env.RUNTIME_DB_OPERATOR_USER, "RUNTIME_DB_OPERATOR_USER", /^[A-Za-z0-9_.-]{1,80}$/u),
    password: required(env.RUNTIME_DB_OPERATOR_PASSWORD, "RUNTIME_DB_OPERATOR_PASSWORD"),
    port: Number(env.RUNTIME_DB_OPERATOR_PORT || 3306),
    connectTimeout: 10_000,
    multipleStatements: false,
  };
  const principal = required(state.principal, "runtime_writer_principal", /^[A-Za-z0-9_.-]{1,80}$/u);
  if (config.user === principal) throw fail("RUNTIME_RECOVERY_OPERATOR_IDENTITY_NOT_SEPARATED", "The privileged operator identity must be different from the target runtime writer.");
  const require = createRequire(new URL("../../http-generic-api/package.json", import.meta.url));
  const mysql = require("mysql2/promise");
  const connection = await mysql.createConnection(config);
  const [rows] = await connection.query("SELECT CURRENT_USER() AS current_account, DATABASE() AS current_database");
  if (String(rows?.[0]?.current_database || "") !== config.database) {
    await connection.end();
    throw fail("RUNTIME_RECOVERY_OPERATOR_DATABASE_MISMATCH", "Operator connection did not resolve the exact configured runtime database.");
  }
  return { connection, database: config.database, principal, accountHost: required(state.accountHost, "account_host", /^[A-Za-z0-9_.:%-]{1,255}$/u) };
}

async function privilegeSnapshot(connection, database, principal, accountHost, profile) {
  const grantee = `'${principal}'@'${accountHost}'`;
  const [userPrivileges] = await connection.query("SELECT PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ?", [grantee]);
  const [schemaPrivileges] = await connection.query("SELECT TABLE_SCHEMA, PRIVILEGE_TYPE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ?", [grantee]);
  const [tablePrivileges] = await connection.query("SELECT TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = ?", [grantee]);
  const selected = resolveProfile(profile);
  const [presentTables] = await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)", [database, selected.tables]);
  const present = new Set(presentTables.map((row) => row.TABLE_NAME));
  const missingTables = selected.tables.filter((table) => !present.has(table));
  if (missingTables.length) throw fail("RUNTIME_RECOVERY_GRANT_TABLE_MISSING", "All writer-profile tables must exist before a grant can be planned.", { profile, missing_tables: missingTables });
  return evaluatePrivilegeSnapshot({ database, profile, tablePrivileges, schemaPrivileges, userPrivileges });
}

async function grants(state, apply) {
  const selected = resolveProfile(state.profile);
  const { connection, database, principal, accountHost } = await operatorConnection(state);
  try {
    const before = await privilegeSnapshot(connection, database, principal, accountHost, selected.profile);
    await evidence(state, "write-authority-before", { principal, account_host: accountHost, ...before });
    if (before.broad_global_write_privilege_count || before.broad_schema_write_privilege_count || before.tables.some((table) => table.grant_option || table.forbidden_operations.length)) {
      throw fail("RUNTIME_RECOVERY_EXISTING_PRIVILEGES_TOO_BROAD", "Existing writer grants violate the least-privilege contract; no grants were executed.", { profile: selected.profile });
    }
    if (!apply) return { result: before.ready ? "ready" : "grant_required", grant_mutation_performed: false, profile: selected.profile };
    if (before.ready) return { result: "already_granted", grant_mutation_performed: false, profile: selected.profile };
    for (const table of before.tables.filter((entry) => entry.missing_operations.length)) {
      const sql = buildTableScopedGrant({ database, principal, accountHost, table: table.table });
      await connection.query(sql);
      state.grantStatementsSent += 1;
    }
    const after = await privilegeSnapshot(connection, database, principal, accountHost, selected.profile);
    await evidence(state, "write-authority-after", { principal, account_host: accountHost, ...after, grant_statements_sent: state.grantStatementsSent, secrets_included: false });
    if (!after.ready) throw fail("RUNTIME_RECOVERY_GRANT_READBACK_FAILED", "Table-scoped grants were not verified in the same cycle.", { profile: selected.profile });
    return { result: "granted_and_verified", profile: selected.profile, grant_mutation_performed: true, grant_statements_sent: state.grantStatementsSent };
  } finally {
    await connection.end();
  }
}

async function finalVerify(state) {
  await assertCatalogApplied(state);
  const [catalog, session] = await Promise.all([
    request(state, "/gpt/tools", { authenticated: true, timeoutMs: 30_000 }),
    request(state, "/activation/session-context/read-only", { authenticated: true, timeoutMs: 30_000 }),
  ]);
  successful(catalog, "RUNTIME_RECOVERY_MCP_CATALOG_READBACK_FAILED");
  successful(session, "RUNTIME_RECOVERY_SESSION_CONTEXT_READBACK_FAILED");
  const result = { result: "verified", mcp_catalog_http_status: catalog.status, session_context_http_status: session.status, session_context_read_only: true, migration_apply_performed: false, grant_mutation_performed: false, secrets_included: false };
  await evidence(state, "final-readback", result);
  return result;
}

export async function runRuntimeRecovery(env = process.env) {
  const state = context(env);
  let stage = "production_identity";
  try {
    await verifyProductionIdentity(state);
    let result;
    if (state.phase === "deploy_readiness" || state.phase === "deploy_apply") {
      stage = state.phase;
      result = await deploy(state, state.phase === "deploy_apply");
    } else {
      stage = "runtime_parity";
      await verifyRuntimeParity(state);
      stage = "runner_integrity";
      await verifyRunner(state);
      if (state.phase === "runner_verify") result = { result: "runner_verified", migration_apply_performed: false };
      else if (state.phase === "migration_readiness") { stage = "migration_readiness"; result = await migrationReadiness(state); }
      else if (state.phase === "migration_apply") { stage = "migration_apply"; result = await migrationApply(state); }
      else if (state.phase === "grant_readiness" || state.phase === "grant_apply") {
        stage = "catalog_schema_readback";
        await assertCatalogApplied(state);
        stage = state.phase;
        result = await grants(state, state.phase === "grant_apply");
      } else { stage = "final_verify"; result = await finalVerify(state); }
    }
    await verifyProductionIdentity(state);
    const summary = {
      contract: RUNTIME_RECOVERY_CONTRACT,
      phase: state.phase,
      expected_production_sha: state.productionSha,
      ...result,
      migration_apply_sent: state.migrationApplySent,
      migration_apply_retried: false,
      grant_statements_sent: state.grantStatementsSent,
      deployment_sent: state.deploymentSent,
      verification_only_migrations_never_applied: true,
      secrets_included: false,
    };
    await evidence(state, "summary", summary);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return summary;
  } catch (error) {
    const failure = {
      contract: RUNTIME_RECOVERY_CONTRACT,
      phase: state.phase,
      stage,
      expected_production_sha: state.productionSha,
      error: { code: error?.code || "RUNTIME_RECOVERY_FAILED", message: error?.message || String(error), details: error?.details || null },
      migration_apply_sent: state.migrationApplySent,
      migration_apply_retried: false,
      grant_statements_sent: state.grantStatementsSent,
      deployment_sent: state.deploymentSent,
      secrets_included: false,
    };
    await evidence(state, "failure", failure);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRuntimeRecovery().catch((error) => {
    process.stderr.write(`${JSON.stringify(sanitize({ ok: false, code: error?.code || "RUNTIME_RECOVERY_FAILED", message: error?.message || String(error), details: error?.details || null, secrets_included: false }))}\n`);
    process.exitCode = 1;
  });
}
