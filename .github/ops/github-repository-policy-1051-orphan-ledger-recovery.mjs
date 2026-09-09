import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { splitMigrationSqlStatements } from "../../http-generic-api/migrationSqlStatements.js";
import { buildAdminControlDbReadRequest } from "./lib/admin-control-db-request.mjs";

export const MIGRATION = "1051_github_repository_policy_live_apply_authority.sql";
export const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
export const MIGRATION_BLOB_SHA = "a705b4425c962b65efae3f92a7e9ef20706e0841";
export const EXPECTED_STATEMENT_COUNT = 6;
export const RECORD_CONFIRM = "RECORD_1051_GITHUB_REPOSITORY_POLICY_LIVE_APPLY_AUTHORITY";
export const RECONCILE_CONFIRM = "RECONCILE_1051_GITHUB_REPOSITORY_POLICY_RECORD_ONLY_LEDGER";
export const RECONCILED_APPLY_CONFIRM = "APPLY_1051_GITHUB_REPOSITORY_POLICY_AFTER_RECORD_ONLY_RECONCILIATION";

const EXPECTED_TABLES = Object.freeze([
  "platform_resource_adapters",
  "platform_capability_readback_contracts",
  "capability_apply_authorization_policy_registry",
  "repository_capability_bindings",
  "repository_capability_policy_layers",
  "governed_migration_authorization_registry",
]);
const BASE = String(process.env.RUNTIME_BASE_URL || "https://auth.mad4b.com").replace(/\/+$/, "");
const KEY = String(process.env.BACKEND_API_KEY || "").trim();
const GH = String(process.env.GH_READ_TOKEN || "").trim();
const REPO = String(process.env.REPOSITORY || "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os").trim();
const PHASE = String(process.env.RECOVERY_PHASE || "verify_record_only").trim().toLowerCase();
const DIR = path.resolve(String(process.env.EVIDENCE_DIR || ".artifacts/github-repository-policy-1051-orphan-ledger-recovery"));
const [OWNER, NAME] = REPO.split("/");

const parsed = (value) => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return value;
  try { return JSON.parse(text); } catch { return value; }
};
function findObject(value, predicate, seen = new Set()) {
  value = parsed(value);
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    const found = findObject(child, predicate, seen);
    if (found) return found;
  }
  return null;
}
const keyed = (value, key) => findObject(value, (candidate) => Object.prototype.hasOwnProperty.call(candidate, key));
const sha256 = (value) => createHash("sha256").update(String(value || ""), "utf8").digest("hex");
function collectShas(value, output = new Set()) {
  if (typeof value === "string") for (const match of value.matchAll(/\b[0-9a-f]{40}\b/ig)) output.add(match[0].toLowerCase());
  else if (Array.isArray(value)) for (const child of value) collectShas(child, output);
  else if (value && typeof value === "object") for (const child of Object.values(value)) collectShas(child, output);
  return output;
}
async function writeJson(name, value) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
async function requestRaw(pathname, body, timeoutMs = 180000) {
  try {
    const response = await fetch(`${BASE}${pathname}`, {
      method: "POST",
      redirect: "error",
      headers: { "x-api-key": KEY, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  } catch (error) {
    return { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: String(error?.name || "Error") };
  }
}
async function requestGet(url, timeoutMs = 20000) {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  } catch (error) {
    return { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: String(error?.name || "Error") };
  }
}
function requireSuccess(result, label) {
  if (!result.transport_ok || !result.http_ok || result.payload?.ok === false) {
    const detail = keyed(result.payload, "code") || result.payload?.error || {};
    const error = new Error(`${label} failed: HTTP ${result.status ?? "transport_error"}`);
    error.code = String(detail?.code || result.payload?.error_code || `${label}_failed`);
    error.details = detail?.details || result.payload?.error?.details || null;
    error.result = result;
    throw error;
  }
  return result.payload;
}
async function githubJson(pathname) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${GH}`, "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json();
  assert.ok(response.ok, `GitHub read failed HTTP ${response.status}: ${pathname}`);
  return payload;
}
async function currentRefSha(branch) {
  const ref = await githubJson(`/repos/${REPO}/git/ref/heads/${encodeURIComponent(branch)}`);
  const commitSha = String(ref?.object?.sha || "").toLowerCase();
  assert.match(commitSha, /^[0-9a-f]{40}$/, `${branch} did not resolve to a full SHA`);
  return commitSha;
}
async function verifyRuntimeParity() {
  const productionSha = await currentRefSha("Production");
  const mainSha = await currentRefSha("main");
  const file = await githubJson(`/repos/${REPO}/contents/${MIGRATION_PATH}?ref=${productionSha}`);
  assert.equal(String(file?.sha || "").toLowerCase(), MIGRATION_BLOB_SHA, "Production Migration 1051 blob differs from the reviewed artifact");
  const sql = Buffer.from(String(file?.content || "").replace(/\s+/g, ""), "base64").toString("utf8");
  const checksum = sha256(sql);
  const statementCount = splitMigrationSqlStatements(sql).length;
  assert.equal(statementCount, EXPECTED_STATEMENT_COUNT, "Migration 1051 statement count drifted");
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const [health, version, deployment] = await Promise.all([
      requestGet(`${BASE}/health`),
      requestGet(`${BASE}/version`),
      requestGet(`${BASE}/deployment-info`),
    ]);
    if (health.http_ok && health.payload?.ok === true && version.http_ok && collectShas(version.payload).has(productionSha) && deployment.http_ok && collectShas(deployment.payload).has(productionSha)) {
      assert.equal(await currentRefSha("Production"), productionSha, "Production moved during orphan-ledger recovery");
      return { production_sha: productionSha, main_sha: mainSha, migration_checksum_sha256: checksum, statement_count: statementCount, runtime_parity: "pass", attempt, secrets_included: false };
    }
    if (attempt < 24) await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  throw new Error("Production runtime did not converge to the exact Production SHA within the bounded window");
}

export function validateMetadataReport(report = {}) {
  assert.equal(report?.diagnostic_status, "captured", "Migration 1051 metadata diagnostic is unavailable");
  assert.equal(report?.target_metadata_state, "complete", "Migration 1051 record-only reconciliation requires complete target metadata");
  assert.equal(report?.metadata_present, true, "Migration 1051 metadata must be present before record-only reconciliation");
  assert.equal(Number(report?.counts?.adapter || 0), 1);
  assert.equal(Number(report?.counts?.readback_contract || 0), 1);
  assert.equal(Number(report?.counts?.apply_policy || 0), 1);
  assert.equal(Number(report?.counts?.capability_binding || 0), 1);
  assert.equal(Number(report?.counts?.expected_policy_layers || 0), 3);
  assert.equal(Number(report?.counts?.total_policy_layers || 0), 3);
  assert.equal(Number(report?.counts?.migration_authorization || 0), 1);
  assert.equal(String(report?.metadata?.adapter_status || ""), "active");
  assert.equal(String(report?.metadata?.readback_status || ""), "certified");
  assert.equal(String(report?.metadata?.apply_policy_status || ""), "active");
  assert.equal(String(report?.metadata?.apply_runtime_surface || ""), "system_layer");
  assert.equal(Number(report?.metadata?.allow_external_write || 0), 1);
  assert.equal(Number(report?.metadata?.requires_typed_confirmation || 0), 1);
  assert.equal(Number(report?.metadata?.requires_same_cycle_dry_run || 0), 1);
  assert.equal(String(report?.metadata?.capability_readiness || ""), "ready");
  assert.equal(String(report?.metadata?.capability_policy_key || ""), "github_repository_policy_controller_apply_v1");
  assert.equal(String(report?.metadata?.migration_authorization_status || ""), "authorized");
  assert.ok(["0", "false"].includes(String(report?.metadata?.live_github_policy_apply ?? "").toLowerCase()));
  return { semantic_metadata_verified: true, secrets_included: false };
}
async function loadMetadataReport() {
  const report = JSON.parse(await fs.readFile(path.join(DIR, "metadata-diagnostic-readback.json"), "utf8"));
  validateMetadataReport(report);
  return report;
}
async function schemaReadback(checksum, statementCount) {
  const result = await requestRaw("/gpt/tools/call", {
    name: "governed_migration_schema_readback",
    tool_args: {
      migration: MIGRATION,
      expected_checksum_sha256: checksum,
      expected_statement_count: statementCount,
      expected_tables: [...EXPECTED_TABLES],
    },
  });
  return { result, readback: keyed(result.payload, "readback_status") };
}
function missingCounts(readback = {}) {
  const missing = readback?.expectations?.missing || {};
  return {
    tables: Array.isArray(missing.tables) ? missing.tables.length : 0,
    columns: Array.isArray(missing.columns) ? missing.columns.length : 0,
    indexes: Array.isArray(missing.indexes) ? missing.indexes.length : 0,
    rule_conditions: Array.isArray(missing.rule_conditions) ? missing.rule_conditions.length : 0,
  };
}
export function classifyLedgerState(readback, checksum, statementCount) {
  const ledger = readback?.ledger || {};
  const missing = missingCounts(readback);
  const schemaComplete = Object.values(missing).every((value) => value === 0);
  const exact = ledger?.found === true
    && ledger?.migration_file === MIGRATION
    && String(ledger?.migration_checksum_sha256 || "").toLowerCase() === checksum
    && Number(ledger?.statement_count || 0) === statementCount
    && String(ledger?.preflight_status || "") === "pass"
    && Number(ledger?.preflight_risk_count || 0) === 0;
  const mode = exact ? String(ledger?.mode || "").toLowerCase() : null;
  return {
    schema_complete: schemaComplete,
    exact_ledger: exact,
    ledger_mode: mode,
    apply_ledger: exact && mode === "apply",
    record_only_ledger: exact && mode === "record_only",
    missing,
  };
}
async function ledgerDetail(runId, checksum) {
  const payload = requireSuccess(await requestRaw("/admin/control", buildAdminControlDbReadRequest({
    sql: `SELECT run_id, migration_file, migration_checksum_sha256, applied_by, runner_version, mode, statement_count, preflight_status, preflight_risk_count, secrets_included,
      JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.record_only_backfill')) AS record_only_backfill,
      JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.sql_applied_by_this_run')) AS sql_applied_by_this_run
      FROM governed_migration_ledger WHERE run_id=? AND migration_file=? AND migration_checksum_sha256=? LIMIT 1`,
    params: [runId, MIGRATION, checksum],
    maxRows: 1,
    authorityContext: { resource_type: "database_metadata", resource_uri: "db-metadata://growth_intelligence_platform/github_repository_policy_1051_record_only_reconciliation", operation_mode: "read_only_reconciliation_probe", required: true },
  }), 120000), "migration_1051_record_only_ledger_detail");
  const rows = findObject(payload, (candidate) => Array.isArray(candidate.rows))?.rows || [];
  assert.equal(rows.length, 1, "Migration 1051 exact ledger detail row is missing");
  const row = rows[0];
  assert.equal(String(row.mode || "").toLowerCase(), "record_only");
  assert.equal(String(row.applied_by || ""), "governed_migration_runner_backfill");
  assert.equal(String(row.preflight_status || ""), "pass");
  assert.equal(Number(row.preflight_risk_count || 0), 0);
  assert.equal(Number(row.statement_count || 0), EXPECTED_STATEMENT_COUNT);
  assert.equal(Number(row.secrets_included || 0), 0);
  assert.equal(String(row.record_only_backfill || "").toLowerCase(), "true");
  assert.equal(String(row.sql_applied_by_this_run || "").toLowerCase(), "false");
  return { run_id: row.run_id, mode: "record_only", applied_by: row.applied_by, runner_version: row.runner_version, record_only_backfill: true, sql_applied_by_this_run: false, secrets_included: false };
}
async function verifyRecordOnly(checksum, statementCount) {
  const { result, readback } = await schemaReadback(checksum, statementCount);
  assert.ok(result.transport_ok, "Migration 1051 schema readback transport failed");
  const state = classifyLedgerState(readback, checksum, statementCount);
  assert.equal(state.schema_complete, true, "Migration 1051 schema/metadata tables are incomplete");
  assert.equal(state.record_only_ledger, true, "Exact Migration 1051 record-only ledger proof is missing");
  const detail = await ledgerDetail(readback.ledger.run_id, checksum);
  return { readback, state, detail };
}
async function recordOnly(checksum, statementCount) {
  const before = await schemaReadback(checksum, statementCount);
  const beforeState = classifyLedgerState(before.readback, checksum, statementCount);
  assert.equal(beforeState.schema_complete, true, "Migration 1051 schema/metadata tables are incomplete; record-only recovery is forbidden");
  if (beforeState.apply_ledger) return { result: "already_has_apply_ledger", mutation_executed: false, before: beforeState };
  if (beforeState.record_only_ledger) {
    const verified = await verifyRecordOnly(checksum, statementCount);
    return { result: "already_reconciled_record_only", mutation_executed: false, ...verified };
  }
  assert.equal(before.readback?.ledger?.found, false, "Migration 1051 has a non-exact or unsupported ledger state");
  const applied = requireSuccess(await requestRaw("/admin/control", {
    tool: "shell",
    action: "run",
    alias: "migration_ledger_record_apply",
    extra_args: [`--migration=${MIGRATION}`, `--confirm=${RECORD_CONFIRM}`],
    authority_context: { resource_type: "shell_alias", resource_uri: "shell://migration_ledger_record_apply", operation_mode: "migration_ledger_record_apply", required: true },
  }, 300000), "migration_1051_record_only_reconciliation");
  const runner = findObject(applied, (candidate) => candidate?.mode === "record_only" && candidate?.migration === MIGRATION);
  assert.ok(runner, "Record-only runner did not return the expected Migration 1051 evidence");
  assert.equal(runner.applies_sql, false);
  const verified = await verifyRecordOnly(checksum, statementCount);
  return { result: "record_only_reconciled", mutation_executed: true, runner: { mode: "record_only", applies_sql: false, recorded: runner.recorded ?? null, duplicate: runner.duplicate ?? false, secrets_included: false }, ...verified };
}
async function main() {
  assert.ok(["record_only", "verify_record_only"].includes(PHASE), "RECOVERY_PHASE must be record_only or verify_record_only");
  assert.ok(KEY, "BACKEND_API_KEY is required");
  assert.ok(GH, "GH_READ_TOKEN is required");
  assert.equal(REPO, `${OWNER}/${NAME}`);
  const metadata = await loadMetadataReport();
  const parity = await verifyRuntimeParity();
  await writeJson("orphan-ledger-source-runtime-parity.json", parity);
  const recovery = PHASE === "record_only"
    ? await recordOnly(parity.migration_checksum_sha256, parity.statement_count)
    : await verifyRecordOnly(parity.migration_checksum_sha256, parity.statement_count);
  await writeJson("orphan-ledger-recovery.json", recovery);
  await writeJson("orphan-ledger-summary.json", {
    contract: "github_repository_policy_1051_orphan_ledger_recovery.v1",
    phase: PHASE,
    result: recovery.result || "record_only_verified",
    main_sha: parity.main_sha,
    production_sha: parity.production_sha,
    migration: MIGRATION,
    migration_checksum_sha256: parity.migration_checksum_sha256,
    statement_count: parity.statement_count,
    semantic_metadata_verified: validateMetadataReport(metadata).semantic_metadata_verified,
    record_only_ledger_verified: PHASE === "record_only" ? Boolean(recovery?.state?.record_only_ledger || recovery?.detail?.record_only_backfill) : true,
    sql_applied_by_this_run: false,
    provider_call_executed: false,
    external_write_executed: false,
    live_github_policy_apply: false,
    protected_ref_mutation: false,
    force_push: false,
    secrets_included: false,
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1]).replace(/\\/g, "/")}`).href) {
  await main();
}
