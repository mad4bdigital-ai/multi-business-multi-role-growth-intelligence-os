import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { buildAdminControlDbReadRequest } from './lib/admin-control-db-request.mjs';

const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH_TOKEN = String(process.env.GH_READ_TOKEN || '').trim();
const REPOSITORY = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const CONTROL_ISSUE = Number(process.env.CONTROL_ISSUE || 4449);
const EVIDENCE_DIR = String(process.env.EVIDENCE_DIR || '.artifacts/sprint69-1043-readback-certification').trim();

const MIGRATION = '1043_sprint69_tenant_managed_execution_lifecycle.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const MIGRATION_BLOB_SHA = '7f3e0152bcdfba36a659ff4a1df8e30d82024c8c';
const CHECKSUM = 'a11dff751fca4df19a6acfc188ca7310d8e1a90aa5c3f06fe0c3efeb1213a2a9';
const STATEMENT_COUNT = 4;
const SOURCE_MERGE_SHA = 'a1c1f3d4f4b36a3a5764d898194818e3e9ea1ce3';
const CERTIFY_CONFIRM = 'CERTIFY_1043_SPRINT69_TENANT_MANAGED_EXECUTION_LIFECYCLE_READBACK';
const EXPECTED_OBJECTS = Object.freeze([
  'managed_execution_bindings',
  'managed_execution_step_requests',
  'managed_execution_events',
  'v_managed_execution_lifecycle_readiness',
]);

let stage = 'program_start';
let mainSha = null;
let productionSha = null;
let finalReadback = null;
let finalReadiness = null;

const sensitiveKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;
const SAFE_EVIDENCE_KEYS = new Set([
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

function findObjectWithKey(value, key) {
  return findObject(value, (candidate) => Object.prototype.hasOwnProperty.call(candidate, key));
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
  return createHash('sha1')
    .update(Buffer.from(`blob ${body.length}\0`, 'utf8'))
    .update(body)
    .digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

async function writeJson(name, value) {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(`${EVIDENCE_DIR}/${name}`, `${JSON.stringify(sanitize(value), null, 2)}\n`, 'utf8');
}

async function writeState(extra = {}) {
  await writeJson('state.json', {
    contract: 'sprint69_1043_readback_certification_state.v1',
    stage,
    main_sha: mainSha,
    production_sha: productionSha,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    exact_apply_ledger_verified: Boolean(finalReadback),
    expected_objects_verified: Boolean(finalReadback),
    readiness_view_verified: Boolean(finalReadiness),
    readback_only: true,
    apply_sent: false,
    migration_apply_executed: false,
    managed_control_plane_write_executed: false,
    provider_call_executed: false,
    credential_payload_accessed: false,
    external_business_write_executed: false,
    secrets_included: false,
    ...extra,
  });
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
    try { payload = text ? JSON.parse(text) : null; }
    catch { payload = { non_json_response: true }; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  } catch (error) {
    return {
      transport_ok: false,
      status: null,
      http_ok: false,
      payload: null,
      transport_error: String(error?.name || 'Error'),
    };
  }
}

async function requestRaw(pathname, body, timeoutMs = 180000) {
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
    try { payload = text ? JSON.parse(text) : null; }
    catch { payload = { non_json_response: true, raw_preview: text.slice(0, 300) }; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  } catch (error) {
    return {
      transport_ok: false,
      status: null,
      http_ok: false,
      payload: null,
      transport_error: String(error?.name || 'Error'),
    };
  }
}

function requireSuccess(result, label) {
  if (!result.transport_ok || !result.http_ok || result.payload?.ok === false) {
    const errorObject = findObjectWithKey(result.payload, 'code') || result.payload?.error || {};
    const error = new Error(`${label} failed with HTTP ${result.status ?? 'transport_error'}`);
    error.code = String(errorObject?.code || result.payload?.error_code || `${label}_failed`);
    error.details = errorObject?.details || result.payload?.error?.details || null;
    throw error;
  }
  return result.payload;
}

async function githubJson(pathname) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json();
  assert.ok(response.ok, `GitHub read failed for ${pathname}: HTTP ${response.status}`);
  return payload;
}

async function currentRefSha(branch) {
  const ref = await githubJson(`/repos/${REPOSITORY}/git/ref/heads/${branch}`);
  const sha = String(ref?.object?.sha || '').toLowerCase();
  assert.match(sha, /^[0-9a-f]{40}$/, `${branch} ref did not return a full SHA`);
  return sha;
}

async function assertContains(ancestor, descendant, label) {
  const comparison = await githubJson(`/repos/${REPOSITORY}/compare/${ancestor}...${descendant}`);
  assert.ok(['ahead', 'identical'].includes(comparison.status), `${label} does not contain ${ancestor}; status=${comparison.status}`);
  return {
    status: comparison.status,
    ahead_by: Number(comparison.ahead_by || 0),
    behind_by: Number(comparison.behind_by || 0),
  };
}

async function verifyRepositoryAndRuntimeParity() {
  mainSha = await currentRefSha('main');
  for (let convergence = 1; convergence <= 2; convergence += 1) {
    const targetSha = await currentRefSha('Production');
    const sourceCompare = await assertContains(SOURCE_MERGE_SHA, targetSha, 'Production');
    const productionFile = await githubJson(`/repos/${REPOSITORY}/contents/${MIGRATION_PATH}?ref=${targetSha}`);
    assert.equal(String(productionFile?.sha || '').toLowerCase(), MIGRATION_BLOB_SHA, 'Production migration blob does not match reviewed Migration 1043');

    for (let attempt = 1; attempt <= 16; attempt += 1) {
      const [health, version, deployment] = await Promise.all([
        requestGet(`${BASE}/health`),
        requestGet(`${BASE}/version`),
        requestGet(`${BASE}/deployment-info`),
      ]);
      const healthPass = health.http_ok && health.payload?.ok === true;
      const versionPass = version.http_ok && collectShas(version.payload).has(targetSha);
      const deploymentPass = deployment.http_ok && collectShas(deployment.payload).has(targetSha);
      if (healthPass && versionPass && deploymentPass) {
        const latest = await currentRefSha('Production');
        if (latest !== targetSha) break;
        productionSha = targetSha;
        return {
          main_sha: mainSha,
          production_sha: targetSha,
          production_contains_foundation: sourceCompare,
          migration_blob_sha: MIGRATION_BLOB_SHA,
          health_http: health.status,
          version_http: version.status,
          deployment_info_http: deployment.status,
          protected_ref_stable: true,
          runtime_contacted: true,
          secrets_included: false,
        };
      }
      if (attempt < 16) await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }
  throw new Error('Runtime did not converge to the exact current Production SHA within the bounded window');
}

async function exactReadback() {
  const result = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_schema_readback',
    tool_args: {
      migration: MIGRATION,
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
      expected_tables: [...EXPECTED_OBJECTS],
    },
  });
  const payload = requireSuccess(result, 'migration_1043_schema_readback');
  return { result, readback: findObjectWithKey(payload, 'readback_status') || null };
}

function exactApplyLedger(readback) {
  const ledger = readback?.ledger;
  return Boolean(
    String(readback?.readback_status || '').toLowerCase() === 'pass'
    && ledger?.found === true
    && String(ledger?.migration_file || '') === MIGRATION
    && String(ledger?.migration_checksum_sha256 || '').toLowerCase() === CHECKSUM
    && String(ledger?.mode || '').toLowerCase() === 'apply'
    && Number(ledger?.statement_count) === STATEMENT_COUNT
    && String(ledger?.preflight_status || '').toLowerCase() === 'pass'
    && Number(ledger?.preflight_risk_count || 0) === 0
    && ledger?.secrets_included === false
  );
}

function exactObjects(readback) {
  const tables = readback?.schema?.tables;
  const missing = readback?.expectations?.missing?.tables;
  if (!Array.isArray(tables) || !Array.isArray(missing) || missing.length !== 0) return false;
  const tableNames = new Set(tables.map((row) => String(row?.TABLE_NAME || '').trim()).filter(Boolean));
  return EXPECTED_OBJECTS.every((name) => tableNames.has(name));
}

async function adminDbFixed(sql, params = []) {
  const body = buildAdminControlDbReadRequest({
    sql,
    params,
    maxRows: 20,
    authorityContext: {
      resource_type: 'database_query',
      resource_uri: 'db://growth_intelligence_platform/migration_1043_readback_only',
      operation_mode: 'read_only',
      required: true,
    },
  });
  const result = await requestRaw('/admin/control', body, 120000);
  const payload = requireSuccess(result, 'migration_1043_readiness_view_readback');
  return findObject(payload, (candidate) => Array.isArray(candidate.rows)) || payload;
}

async function readinessViewProbe() {
  const result = await adminDbFixed(
    `SELECT present_table_count, required_table_count,
            present_binding_column_count, required_binding_column_count,
            readiness_status
       FROM v_managed_execution_lifecycle_readiness
      LIMIT 1`,
    [],
  );
  const rows = result?.rows || [];
  assert.equal(rows.length, 1, 'Migration 1043 readiness view must return exactly one row');
  const row = rows[0];
  assert.equal(Number(row.present_table_count), 3, 'Migration 1043 readiness view table count mismatch');
  assert.equal(Number(row.required_table_count), 3, 'Migration 1043 readiness view required table count mismatch');
  assert.equal(Number(row.present_binding_column_count), 15, 'Migration 1043 readiness view binding column count mismatch');
  assert.equal(Number(row.required_binding_column_count), 15, 'Migration 1043 readiness view required binding column count mismatch');
  assert.equal(String(row.readiness_status || '').toLowerCase(), 'ready', 'Migration 1043 readiness view is not ready');
  return {
    present_table_count: Number(row.present_table_count),
    required_table_count: Number(row.required_table_count),
    present_binding_column_count: Number(row.present_binding_column_count),
    required_binding_column_count: Number(row.required_binding_column_count),
    readiness_status: String(row.readiness_status || '').toLowerCase(),
    secrets_included: false,
  };
}

async function verifyLocalContract() {
  assert.equal(BASE, 'https://auth.mad4b.com', 'Runtime base URL must remain canonical auth host');
  assert.ok(KEY, 'BACKEND_API_KEY is required');
  assert.ok(GH_TOKEN, 'GH_READ_TOKEN is required');
  assert.equal(REPOSITORY, 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os');
  assert.equal(CONTROL_ISSUE, 4449);
  const sql = await fs.readFile(MIGRATION_PATH, 'utf8');
  assert.equal(gitBlobSha(sql), MIGRATION_BLOB_SHA, 'Pinned Migration 1043 Git blob changed');
  assert.equal(sha256(sql), CHECKSUM, 'Pinned Migration 1043 checksum changed');
}

function canonicalFixture() {
  return {
    readback_status: 'pass',
    ledger: {
      found: true,
      migration_file: MIGRATION,
      migration_checksum_sha256: CHECKSUM,
      mode: 'apply',
      statement_count: STATEMENT_COUNT,
      preflight_status: 'pass',
      preflight_risk_count: 0,
      secrets_included: false,
    },
    schema: {
      tables: EXPECTED_OBJECTS.map((TABLE_NAME) => ({ TABLE_NAME })),
    },
    expectations: {
      missing: { tables: [] },
    },
  };
}

function runSelfTest() {
  const canonical = canonicalFixture();
  assert.equal(exactApplyLedger(canonical), true);
  assert.equal(exactObjects(canonical), true);

  const missingObject = canonicalFixture();
  missingObject.schema.tables = missingObject.schema.tables.slice(0, -1);
  missingObject.expectations.missing.tables = ['v_managed_execution_lifecycle_readiness'];
  assert.equal(exactObjects(missingObject), false);

  const legacyShape = {
    ...canonicalFixture(),
    schema: undefined,
    tables: EXPECTED_OBJECTS.map((table) => ({ table, found: true, row_count: 0 })),
  };
  assert.equal(exactObjects(legacyShape), false, 'Legacy readback.tables shape must not be accepted as canonical certification evidence.');

  const wrongMode = canonicalFixture();
  wrongMode.ledger.mode = 'dry_run';
  assert.equal(exactApplyLedger(wrongMode), false);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    contract: 'sprint69_1043_readback_certification_self_test.v1',
    terminal_outcome: 'migration_1043_readback_only_contract_verified',
    canonical_schema_table_field: 'TABLE_NAME',
    legacy_shape_accepted: false,
    apply_capability_present: false,
  }, null, 2)}\n`);
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await verifyLocalContract();
  await writeState({ local_contract_verified: true });

  stage = 'repository_and_runtime_parity';
  const parity = await verifyRepositoryAndRuntimeParity();
  await writeJson('runtime-parity.json', parity);
  await writeState();

  stage = 'canonical_schema_readback';
  const readbackAttempt = await exactReadback();
  await writeJson('readback-transport.json', readbackAttempt.result);
  const readback = readbackAttempt.readback;
  assert.ok(readback, 'Migration 1043 readback-only certification returned no readback_status');
  assert.ok(exactApplyLedger(readback), 'Migration 1043 exact Apply ledger verification failed');
  assert.ok(exactObjects(readback), 'Migration 1043 canonical schema object verification failed');
  finalReadback = readback;
  await writeJson('readback.json', readback);
  await writeState({ exact_apply_ledger_verified: true, expected_objects_verified: true });

  stage = 'readiness_view_readback';
  finalReadiness = await readinessViewProbe();
  await writeJson('readiness-view.json', finalReadiness);
  await writeState({ readiness_view_verified: true });

  stage = 'certification_complete';
  const summary = {
    contract: 'sprint69_1043_readback_certification.v1',
    result: 'pass',
    main_sha: mainSha,
    production_sha: productionSha,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    runtime_parity: 'pass',
    exact_apply_ledger_verified: true,
    expected_objects_verified: true,
    readiness_view: finalReadiness,
    readback_only: true,
    apply_sent: false,
    migration_apply_executed: false,
    managed_control_plane_write_executed: false,
    provider_call_executed: false,
    credential_payload_accessed: false,
    external_business_write_executed: false,
    secrets_included: false,
  };
  await writeJson('summary.json', summary);
  await writeState({ ok: true, result: summary.result });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(async (error) => {
  const failure = {
    contract: 'sprint69_1043_readback_certification_failure.v1',
    ok: false,
    stage,
    main_sha: mainSha,
    production_sha: productionSha,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    error: {
      code: String(error?.code || 'sprint69_1043_readback_certification_failed'),
      message: String(error?.message || error || 'Unknown failure').slice(0, 1000),
      details: sanitize(error?.details || undefined),
    },
    readback_only: true,
    apply_sent: false,
    migration_apply_executed: false,
    managed_control_plane_write_executed: false,
    provider_call_executed: false,
    credential_payload_accessed: false,
    external_business_write_executed: false,
    secrets_included: false,
  };
  try {
    await writeJson('failure.json', failure);
    await writeState({ failure: failure.error });
  } catch { }
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
});
