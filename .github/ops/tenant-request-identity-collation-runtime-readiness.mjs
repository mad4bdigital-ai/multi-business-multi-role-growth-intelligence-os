import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';
import { buildAdminControlDbReadRequest } from './lib/admin-control-db-request.mjs';

const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH_TOKEN = String(process.env.GH_READ_TOKEN || '').trim();
const REPOSITORY = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const CONTROL_ISSUE = Number(process.env.CONTROL_ISSUE || 4449);
const EVIDENCE_DIR = String(process.env.EVIDENCE_DIR || '.artifacts/tenant-request-identity-collation-runtime-readiness').trim();

const MIGRATION = '20260808_tenant_request_identity_collation_alignment.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const MIGRATION_BLOB_SHA = '5f68a02f351a4cf80fa89a826abe3c92412f7079';
const CHECKSUM = 'cb22a379a48ad3c3f5be145562d0f96fe8f9830eb663edb204642ec8ec7915c7';
const STATEMENT_COUNT = 3;
const SOURCE_MERGE_SHA = '894f112c452887e9c8f3f58fe55af598cb04af31';
const VERIFY_CONFIRM = 'VERIFY_20260808_TENANT_REQUEST_IDENTITY_COLLATION_READINESS';
const TARGET_COLLATION = 'utf8mb4_uca1400_ai_ci';
const SUPPORTED_COLLATIONS = new Set(['utf8mb4_unicode_ci', TARGET_COLLATION]);
const IDENTITY_COLUMNS = Object.freeze([
  ['ticket_lifecycle_events', 'ticket_id'],
  ['ticket_lifecycle_events', 'tenant_id'],
  ['tenant_resolution_cases', 'tenant_id'],
  ['tenant_resolution_cases', 'ticket_id'],
]);

let stage = 'program_start';
let mainSha = null;
let productionSha = null;

const sensitiveKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;
const SAFE_EVIDENCE_KEYS = new Set([
  'apply_authorized',
  'apply_sent',
  'migration_apply_executed',
  'managed_control_plane_write_executed',
  'provider_call_executed',
  'credential_payload_accessed',
  'external_business_write_executed',
  'secrets_included',
]);

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    sensitiveKey.test(key) && !SAFE_EVIDENCE_KEYS.has(key) ? '[redacted]' : sanitize(child),
  ]));
}

function parsedValue(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value;
  try { return JSON.parse(text); } catch { return value; }
}

function findObject(value, predicate, seen = new Set()) {
  value = parsedValue(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    const found = findObject(child, predicate, seen);
    if (found) return found;
  }
  return null;
}

function collectShas(value, output = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\b[0-9a-f]{40}\b/ig)) output.add(match[0].toLowerCase());
  } else if (Array.isArray(value)) {
    for (const child of value) collectShas(child, output);
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) collectShas(child, output);
  }
  return output;
}

function gitBlobSha(content) {
  const body = Buffer.from(content, 'utf8');
  return createHash('sha1').update(Buffer.from(`blob ${body.length}\0`, 'utf8')).update(body).digest('hex');
}

function sha256(content) {
  return createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

async function writeJson(name, value) {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(`${EVIDENCE_DIR}/${name}`, `${JSON.stringify(sanitize(value), null, 2)}\n`, 'utf8');
}

async function requestGet(url, timeoutMs = 20000) {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  } catch (error) {
    return { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: String(error?.name || 'Error') };
  }
}

async function requestRaw(pathname, body, timeoutMs = 120000) {
  try {
    const response = await fetch(`${BASE}${pathname}`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  } catch (error) {
    return { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: String(error?.name || 'Error') };
  }
}

function requireSuccess(result, label) {
  if (!result.transport_ok || !result.http_ok || result.payload?.ok === false) {
    const error = new Error(`${label} failed with HTTP ${result.status ?? 'transport_error'}`);
    error.code = String(findObject(result.payload, (candidate) => Object.prototype.hasOwnProperty.call(candidate, 'code'))?.code || `${label}_failed`);
    throw error;
  }
  return result.payload;
}

async function githubResponse(pathname) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30000),
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  return { status: response.status, ok: response.ok, payload };
}

async function githubJson(pathname) {
  const result = await githubResponse(pathname);
  assert.ok(result.ok, `GitHub read failed for ${pathname}: HTTP ${result.status}`);
  return result.payload;
}

async function currentRefSha(branch) {
  const ref = await githubJson(`/repos/${REPOSITORY}/git/ref/heads/${branch}`);
  const sha = String(ref?.object?.sha || '').toLowerCase();
  assert.match(sha, /^[0-9a-f]{40}$/, `${branch} ref did not return a full SHA`);
  return sha;
}

async function containsCommit(ancestor, descendant) {
  const comparison = await githubResponse(`/repos/${REPOSITORY}/compare/${ancestor}...${descendant}`);
  if (!comparison.ok) return { contains: false, status: `http_${comparison.status}` };
  const status = String(comparison.payload?.status || 'unknown');
  return {
    contains: ['ahead', 'identical'].includes(status),
    status,
    ahead_by: Number(comparison.payload?.ahead_by || 0),
    behind_by: Number(comparison.payload?.behind_by || 0),
  };
}

async function migrationBlobAt(ref) {
  const result = await githubResponse(`/repos/${REPOSITORY}/contents/${MIGRATION_PATH}?ref=${ref}`);
  if (result.status === 404) return { found: false, blob_sha: null };
  assert.ok(result.ok, `GitHub migration read failed at ${ref}: HTTP ${result.status}`);
  return { found: true, blob_sha: String(result.payload?.sha || '').toLowerCase() || null };
}

async function adminDbRead(sql, params, maxRows, resourceSuffix) {
  const body = buildAdminControlDbReadRequest({
    sql,
    params,
    maxRows,
    authorityContext: {
      resource_type: 'database_query',
      resource_uri: `db://growth_intelligence_platform/tenant_request_identity_collation_readiness/${resourceSuffix}`,
      operation_mode: 'read_only',
      required: true,
    },
  });
  const payload = requireSuccess(await requestRaw('/admin/control', body), resourceSuffix);
  const rowEnvelope = findObject(payload, (candidate) => Array.isArray(candidate.rows));
  assert.ok(rowEnvelope, `${resourceSuffix} returned no rows envelope`);
  return rowEnvelope.rows;
}

async function verifyLocalContract() {
  assert.equal(BASE, 'https://auth.mad4b.com', 'Runtime base URL must remain canonical auth host');
  assert.ok(KEY, 'BACKEND_API_KEY is required');
  assert.ok(GH_TOKEN, 'GH_READ_TOKEN is required');
  assert.equal(REPOSITORY, 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os');
  assert.equal(CONTROL_ISSUE, 4449);
  assert.equal(VERIFY_CONFIRM, 'VERIFY_20260808_TENANT_REQUEST_IDENTITY_COLLATION_READINESS');
  const sql = await fs.readFile(MIGRATION_PATH, 'utf8');
  assert.equal(gitBlobSha(sql), MIGRATION_BLOB_SHA, 'Pinned migration Git blob changed');
  assert.equal(sha256(sql), CHECKSUM, 'Pinned migration SHA-256 changed');
  assert.equal(splitMigrationSqlStatements(sql).length, STATEMENT_COUNT, 'Pinned migration statement count changed');
  assert.ok(!/resource_ref/i.test(sql), 'Migration must not alter tenant_resolution_cases.resource_ref');
}

async function repositoryState() {
  mainSha = await currentRefSha('main');
  const checkoutSha = String(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })).trim().toLowerCase();
  assert.equal(checkoutSha, mainSha, 'Trusted-main checkout moved before readiness execution');
  const mainBlob = await migrationBlobAt(mainSha);
  assert.deepEqual(mainBlob, { found: true, blob_sha: MIGRATION_BLOB_SHA }, 'main migration blob does not match reviewed source');

  productionSha = await currentRefSha('Production');
  const productionContainsSource = await containsCommit(SOURCE_MERGE_SHA, productionSha);
  const productionBlob = await migrationBlobAt(productionSha);
  return { checkout_sha: checkoutSha, main_sha: mainSha, production_sha: productionSha, production_contains_source: productionContainsSource, production_migration: productionBlob };
}

async function runtimeParity() {
  const [health, version, deployment] = await Promise.all([
    requestGet(`${BASE}/health`),
    requestGet(`${BASE}/version`),
    requestGet(`${BASE}/deployment-info`),
  ]);
  return {
    pass: health.http_ok && health.payload?.ok === true && version.http_ok && deployment.http_ok && collectShas(version.payload).has(productionSha) && collectShas(deployment.payload).has(productionSha),
    health_http: health.status,
    version_http: version.status,
    deployment_info_http: deployment.status,
    version_contains_production_sha: collectShas(version.payload).has(productionSha),
    deployment_contains_production_sha: collectShas(deployment.payload).has(productionSha),
  };
}

async function schemaReadback() {
  const columns = await adminDbRead(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME, COLLATION_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND ((TABLE_NAME = ? AND COLUMN_NAME IN (?, ?))
          OR (TABLE_NAME = ? AND COLUMN_NAME IN (?, ?, ?)))
      ORDER BY TABLE_NAME, COLUMN_NAME`,
    ['ticket_lifecycle_events', 'ticket_id', 'tenant_id', 'tenant_resolution_cases', 'tenant_id', 'ticket_id', 'resource_ref'],
    10,
    'column_metadata',
  );
  const tables = await adminDbRead(
    `SELECT TABLE_NAME, TABLE_COLLATION
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (?, ?)
      ORDER BY TABLE_NAME`,
    ['ticket_lifecycle_events', 'tenant_resolution_cases'],
    5,
    'table_metadata',
  );
  const ledger = await adminDbRead(
    `SELECT run_id, migration_file, migration_checksum_sha256, mode, applied_at, statement_count,
            preflight_status, preflight_risk_count, secrets_included, capability_envelope_id
       FROM governed_migration_ledger
      WHERE migration_file = ? AND migration_checksum_sha256 = ?
      ORDER BY applied_at DESC
      LIMIT 1`,
    [MIGRATION, CHECKSUM],
    1,
    'exact_ledger',
  );
  return { columns, tables, ledger };
}

function classify(repo, parity, readback) {
  const columnMap = new Map(readback.columns.map((row) => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row]));
  const tableMap = new Map(readback.tables.map((row) => [String(row.TABLE_NAME), row]));
  const missingIdentity = IDENTITY_COLUMNS.filter(([table, column]) => !columnMap.has(`${table}.${column}`));
  const resourceRef = columnMap.get('tenant_resolution_cases.resource_ref') || null;
  if (missingIdentity.length || !resourceRef) {
    return { result: 'blocked_schema_state', reason: 'required_column_metadata_missing', missing_identity_columns: missingIdentity, resource_ref_present: Boolean(resourceRef) };
  }

  const unsupportedIdentity = IDENTITY_COLUMNS.map(([table, column]) => columnMap.get(`${table}.${column`}`));
  const identityRows = IDENTITY_COLUMNS.map(([table, column]) => columnMap.get(`${table}.${column}`));
  const unsupported = identityRows.filter((row) => String(row?.CHARACTER_SET_NAME || '').toLowerCase() !== 'utf8mb4' || !SUPPORTED_COLLATIONS.has(String(row?.COLLATION_NAME || '').toLowerCase()));
  if (unsupported.length) {
    return { result: 'blocked_schema_state', reason: 'unsupported_identity_collation', unsupported_identity_columns: unsupported };
  }

  const lifecycleTable = tableMap.get('ticket_lifecycle_events');
  const resolutionTable = tableMap.get('tenant_resolution_cases');
  if (!lifecycleTable || !resolutionTable) {
    return { result: 'blocked_schema_state', reason: 'required_table_metadata_missing' };
  }

  const targetAligned = identityRows.every((row) => String(row.COLLATION_NAME || '').toLowerCase() === TARGET_COLLATION)
    && String(lifecycleTable.TABLE_COLLATION || '').toLowerCase() === TARGET_COLLATION;
  const ledger = readback.ledger[0] || null;
  const exactApplyLedger = Boolean(
    ledger
    && String(ledger.migration_file || '') === MIGRATION
    && String(ledger.migration_checksum_sha256 || '').toLowerCase() === CHECKSUM
    && String(ledger.mode || '').toLowerCase() === 'apply'
    && Number(ledger.statement_count) === STATEMENT_COUNT
    && String(ledger.preflight_status || '').toLowerCase() === 'pass'
    && Number(ledger.preflight_risk_count || 0) === 0
    && !Boolean(Number(ledger.secrets_included || 0))
  );

  if (ledger && !exactApplyLedger) return { result: 'blocked_ledger_state', reason: 'exact_apply_ledger_not_verified', target_aligned: targetAligned };
  if (exactApplyLedger && !targetAligned) return { result: 'blocked_ledger_schema_mismatch', reason: 'apply_ledger_exists_but_target_schema_not_aligned', target_aligned: false };
  if (exactApplyLedger && targetAligned) return { result: 'already_applied_verified', reason: 'exact_apply_ledger_and_target_schema_verified', target_aligned: true };
  if (targetAligned) return { result: 'blocked_schema_aligned_without_apply_ledger', reason: 'target_schema_present_without_exact_apply_ledger', target_aligned: true };
  if (!parity.pass) return { result: 'blocked_runtime_parity', reason: 'runtime_does_not_match_current_production', target_aligned: false };
  if (!repo.production_migration.found || repo.production_migration.blob_sha !== MIGRATION_BLOB_SHA || !repo.production_contains_source.contains) {
    return { result: 'blocked_on_production_promotion', reason: 'reviewed_migration_source_not_present_in_current_production', target_aligned: false };
  }
  return { result: 'ready_to_authorize_dry_run', reason: 'source_runtime_and_schema_preconditions_verified', target_aligned: false };
}

async function main() {
  stage = 'local_contract';
  await verifyLocalContract();
  stage = 'repository_state';
  const repo = await repositoryState();
  stage = 'runtime_parity';
  const parity = await runtimeParity();
  stage = 'schema_readback';
  const readback = await schemaReadback();
  stage = 'classification';
  const classification = classify(repo, parity, readback);
  const currentProduction = await currentRefSha('Production');
  assert.equal(currentProduction, productionSha, 'Production moved during readiness readback');
  const currentMain = await currentRefSha('main');
  assert.equal(currentMain, mainSha, 'main moved during readiness readback');

  const summary = {
    contract: 'tenant_request_identity_collation_runtime_readiness.v1',
    result: classification.result,
    reason: classification.reason,
    main_sha: mainSha,
    production_sha: productionSha,
    source_merge_sha: SOURCE_MERGE_SHA,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    target_collation: TARGET_COLLATION,
    production_source_present: repo.production_migration.found && repo.production_migration.blob_sha === MIGRATION_BLOB_SHA && repo.production_contains_source.contains,
    runtime_parity: parity,
    schema: readback,
    classification,
    readback_only: true,
    apply_authorized: false,
    apply_sent: false,
    migration_apply_executed: false,
    managed_control_plane_write_executed: false,
    provider_call_executed: false,
    credential_payload_accessed: false,
    external_business_write_executed: false,
    secrets_included: false,
  };
  await writeJson('summary.json', summary);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main().catch(async (error) => {
  await writeJson('failure.json', {
    contract: 'tenant_request_identity_collation_runtime_readiness_failure.v1',
    stage,
    main_sha: mainSha,
    production_sha: productionSha,
    migration: MIGRATION,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    error: { code: String(error?.code || 'runtime_readiness_failed'), message: String(error?.message || error) },
    readback_only: true,
    apply_authorized: false,
    apply_sent: false,
    migration_apply_executed: false,
    managed_control_plane_write_executed: false,
    provider_call_executed: false,
    credential_payload_accessed: false,
    external_business_write_executed: false,
    secrets_included: false,
  }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
});
