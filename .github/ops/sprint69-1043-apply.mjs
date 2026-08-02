import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';

const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH_TOKEN = String(process.env.GH_READ_TOKEN || '').trim();
const REPOSITORY = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const CONTROL_ISSUE = Number(process.env.CONTROL_ISSUE || 4449);
const EVIDENCE_DIR = String(process.env.EVIDENCE_DIR || '.artifacts/sprint69-1043-apply').trim();

const MIGRATION = '1043_sprint69_tenant_managed_execution_lifecycle.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const MIGRATION_BLOB_SHA = '7f3e0152bcdfba36a659ff4a1df8e30d82024c8c';
const CHECKSUM = 'a11dff751fca4df19a6acfc188ca7310d8e1a90aa5c3f06fe0c3efeb1213a2a9';
const STATEMENT_COUNT = 4;
const SOURCE_PR = 4845;
const SOURCE_MERGE_SHA = 'a1c1f3d4f4b36a3a5764d898194818e3e9ea1ce3';
const REPOSITORY_READINESS_MERGE_SHA = '0cd5e8c894f2877db9de1e1942ff9db25d9ecc5e';
const RUNTIME_READINESS_CONTRACT_MERGE_SHA = 'f576d269d7af8d8deb52add9994a0cc70e05df0b';
const RECOVERY_OPERATIONS_MERGE_SHA = '22569cf75d22ca708ca7f12ea271828b3c642333';
const PROJECTIONS_RECONCILIATION_MERGE_SHA = '5a612237cb472308e243df03f95f05ea611680e7';
const APPLY_CONFIRM = 'APPLY_1043_SPRINT69_TENANT_MANAGED_EXECUTION_LIFECYCLE';
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const PLATFORM_ADMIN_USER_ID = '00000000-0000-4000-a000-000000000002';
const RESOURCE_URI = `db-migration://growth_intelligence_platform/${MIGRATION}`;
const APPLY_POLICY_KEY = 'governed_migration_execute_apply_v1';
const AUTHORIZATION_POLICY_KEY = 'governed_migration_runner_authorization_v1';
const AUTHORIZATION_SOURCE = 'governed_admin_bootstrap_tool';
const EXPECTED_OBJECTS = Object.freeze([
  'managed_execution_bindings',
  'managed_execution_step_requests',
  'managed_execution_events',
  'v_managed_execution_lifecycle_readiness',
]);

let stage = 'program_start';
let mainSha = null;
let productionSha = null;
let executionEnvelopeId = null;
let applySent = false;
let applyAttempt = null;
let finalReadback = null;
let finalReadiness = null;

const sensitiveKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    sensitiveKey.test(key) ? '[redacted]' : sanitize(child),
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
    contract: 'sprint69_1043_apply_state.v1',
    stage,
    main_sha: mainSha,
    production_sha: productionSha,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    execution_envelope_id: executionEnvelopeId,
    apply_sent: applySent,
    apply_transport_ok: applyAttempt?.transport_ok ?? null,
    apply_http_status: applyAttempt?.status ?? null,
    exact_apply_ledger_verified: Boolean(finalReadback),
    readiness_view_verified: Boolean(finalReadiness),
    activation_registry_sync_executed: false,
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

async function requestRaw(pathname, body, timeoutMs = 300000) {
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

function requireSuccess(result, label) {
  if (!result.transport_ok || !result.http_ok || result.payload?.ok === false) {
    const errorObject = findObjectWithKey(result.payload, 'code') || result.payload?.error || {};
    const error = new Error(`${label} failed with HTTP ${result.status ?? 'transport_error'}`);
    error.code = String(errorObject?.code || result.payload?.error_code || `${label}_failed`);
    error.details = errorObject?.details || result.payload?.error?.details || null;
    error.result = result;
    throw error;
  }
  return result.payload;
}

function shellInvocation(alias, extraArgs) {
  return {
    tool: 'shell',
    action: 'run',
    alias,
    authority_context: {
      resource_type: 'shell_alias',
      resource_uri: `shell://${alias}`,
      operation_mode: alias,
      required: true,
    },
    extra_args: extraArgs,
  };
}

async function adminShell(alias, extraArgs, label) {
  return requireSuccess(await requestRaw('/admin/control', shellInvocation(alias, extraArgs)), label);
}

async function adminDbFixed(query, params = []) {
  const result = await requestRaw('/admin/control', {
    tool: 'db',
    action: 'query',
    query,
    params,
    read_only: true,
    max_rows: 20,
    authority_context: {
      resource_type: 'database_query',
      resource_uri: 'db://growth_intelligence_platform/read_only_fixed_query',
      operation_mode: 'read_only',
      required: true,
    },
  }, 120000);
  const payload = requireSuccess(result, 'admin_db_fixed_query');
  return findObject(payload, (candidate) => Array.isArray(candidate.rows)) || payload;
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
  const mainContains = {};
  for (const [key, sha] of Object.entries({
    repository_readiness: REPOSITORY_READINESS_MERGE_SHA,
    runtime_readiness_contract: RUNTIME_READINESS_CONTRACT_MERGE_SHA,
    recovery_operations: RECOVERY_OPERATIONS_MERGE_SHA,
    projections_reconciliation: PROJECTIONS_RECONCILIATION_MERGE_SHA,
  })) {
    mainContains[key] = await assertContains(sha, mainSha, 'main');
  }

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
          main_contains: mainContains,
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

function envelopeBindingSha(capabilityKey, operationIntent) {
  return sha256(JSON.stringify({
    schema_version: 'governed_migration_envelope_binding.v1',
    app_key: 'platform_orchestration',
    capability_key: capabilityKey,
    operation_intent: operationIntent,
    resource_uri: RESOURCE_URI,
    migration_file: MIGRATION,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    production_sha: productionSha,
  }));
}

async function createReadyExecutionEnvelope() {
  const capabilityKey = 'governed_migration_execute';
  const operationIntent = 'governed_migration_execute';
  const bindingSha = envelopeBindingSha(capabilityKey, operationIntent);
  const createdPayload = await adminShell('capability_resolution_envelope_create', [
    `--tenant-id=${PLATFORM_TENANT_ID}`,
    `--user-id=${PLATFORM_ADMIN_USER_ID}`,
    '--user-role=Admin',
    '--app-key=platform_orchestration',
    `--capability-key=${capabilityKey}`,
    `--operation-intent=${operationIntent}`,
    '--runtime-surface=auth_host',
    '--requested-source-tier=platform_managed_fallback',
    '--requested-by=github_actions_sprint69_1043_apply',
    '--ttl-minutes=45',
    '--explain',
    `--resource-uri=${RESOURCE_URI}`,
    `--expected-commit-sha=${productionSha}`,
    `--binding-sha256=${bindingSha}`,
  ], 'migration_1043_execution_envelope_create');
  let envelope = findObjectWithKey(createdPayload, 'envelope_id');
  assert.ok(envelope?.envelope_id, 'Execution envelope creation returned no envelope_id');
  assert.notEqual(envelope.envelope_status, 'blocked', `Execution envelope blocked: ${envelope.decision || 'unknown'}`);
  assert.equal(Number(envelope.blocking_gap_count || 0), 0, 'Execution envelope has blocking gaps');

  if (envelope.approval_required === true || envelope.envelope_status === 'ready_requires_approval') {
    const approvedPayload = await adminShell('capability_resolution_envelope_approve', [
      `--envelope-id=${envelope.envelope_id}`,
      '--approved-by=github_actions',
      '--decision-note=Approve one exact checksum-bound Migration 1043 Apply attempt after explicit operator confirmation, exact Production parity, pre-existing readiness authorization, same-cycle dry-run, and zero-risk preflight.',
      '--ttl-minutes=45',
    ], 'migration_1043_execution_envelope_approve');
    const approved = findObjectWithKey(approvedPayload, 'envelope_id');
    if (approved) envelope = { ...envelope, ...approved, approval_required: false, dispatch_allowed: true };
  }

  assert.equal(envelope.envelope_status, 'ready_for_dispatch', 'Execution envelope is not ready_for_dispatch');
  assert.equal(envelope.dispatch_allowed, true, 'Execution envelope dispatch_allowed is not true');

  const authorizationPayload = requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'capability_resolution_envelope_apply_authorize',
    tool_args: {
      envelope_id: envelope.envelope_id,
      authorized_by: 'github_actions',
      decision_note: 'Authorize one exact Migration 1043 Apply attempt only. External writes remain disabled; same-cycle dry-run and readback are mandatory.',
      ttl_minutes: 45,
    },
  }), 'migration_1043_execution_envelope_apply_authorize');
  const authorization = findObjectWithKey(authorizationPayload, 'apply_allowed') || authorizationPayload;
  assert.equal(authorization?.apply_allowed, true, 'Execution envelope was not apply-authorized');
  assert.equal(authorization?.policy_key, APPLY_POLICY_KEY, 'Unexpected governed migration apply policy');
  assert.equal(authorization?.external_write_allowed, false, 'Apply envelope must not allow external writes');
  executionEnvelopeId = envelope.envelope_id;
  return {
    envelope,
    apply_authorization: authorization,
    binding_sha256: bindingSha,
    secrets_included: false,
  };
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
  }, 180000);
  return { result, readback: findObjectWithKey(result.payload, 'readback_status') || null };
}

function exactApplyLedger(readback) {
  const ledger = readback?.ledger;
  return Boolean(
    ledger?.found === true
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
  const tables = readback?.tables || [];
  const tableMap = new Map(tables.map((row) => [row.table, row]));
  return EXPECTED_OBJECTS.every((name) => {
    const row = tableMap.get(name);
    return row && row.found === true && Number(row.row_count || 0) >= 0;
  });
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

async function readExactAuthorizationRecord() {
  const result = await adminDbFixed(
    `SELECT migration_file, authorization_status, authorization_source, policy_key,
            requires_preflight, requires_confirmation, allow_record_only, allow_apply,
            metadata_json, created_at, updated_at
       FROM governed_migration_authorization_registry
      WHERE migration_file = ?
      LIMIT 2`,
    [MIGRATION],
  );
  const rows = result?.rows || [];
  assert.equal(rows.length, 1, 'Migration 1043 requires exactly one governed authorization row from Runtime Readiness');
  const row = rows[0];
  const metadata = parsedValue(row.metadata_json) || {};
  assert.equal(row.migration_file, MIGRATION);
  assert.equal(row.authorization_status, 'authorized');
  assert.equal(row.authorization_source, AUTHORIZATION_SOURCE);
  assert.equal(row.policy_key, AUTHORIZATION_POLICY_KEY);
  assert.equal(Number(row.requires_preflight || 0), 1);
  assert.equal(Number(row.requires_confirmation || 0), 1);
  assert.equal(Number(row.allow_record_only || 0), 0);
  assert.equal(Number(row.allow_apply || 0), 1);
  assert.equal(String(metadata.migration_checksum_sha256 || '').toLowerCase(), CHECKSUM);
  assert.equal(Number(metadata.expected_statement_count), STATEMENT_COUNT);
  assert.equal(metadata.preflight_status, 'pass');
  assert.equal(Number(metadata.preflight_risk_count || 0), 0);
  assert.equal(Number(metadata.destructive_operations || 0), 0);
  assert.equal(metadata.provider_write, false);
  assert.equal(metadata.external_send, false);
  assert.equal(metadata.migration_sql_executed, false);
  assert.equal(Number(metadata.pull_request), SOURCE_PR);
  assert.equal(String(metadata.merge_sha || '').toLowerCase(), SOURCE_MERGE_SHA);
  assert.equal(metadata.secrets_included, false);
  return {
    migration_file: row.migration_file,
    authorization_status: row.authorization_status,
    authorization_source: row.authorization_source,
    policy_key: row.policy_key,
    allow_apply: Number(row.allow_apply || 0),
    migration_checksum_sha256: String(metadata.migration_checksum_sha256 || '').toLowerCase(),
    expected_statement_count: Number(metadata.expected_statement_count),
    pull_request: Number(metadata.pull_request),
    merge_sha: String(metadata.merge_sha || '').toLowerCase(),
    capability_envelope_id: metadata.capability_envelope_id || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

async function dryRun() {
  const payload = requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_execute',
    tool_args: {
      migration: MIGRATION,
      mode: 'dry_run',
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
    },
  }, 300000), 'migration_1043_same_cycle_dry_run');
  const result = findObjectWithKey(payload, 'applies_sql') || payload;
  assert.equal(result?.applies_sql, false, 'Dry-run must report applies_sql=false');
  assert.equal(result?.mode, 'dry_run', 'Dry-run mode mismatch');
  assert.equal(String(result?.migration_checksum_sha256 || '').toLowerCase(), CHECKSUM, 'Dry-run checksum mismatch');
  assert.equal(Number(result?.statement_count), STATEMENT_COUNT, 'Dry-run statement count mismatch');
  assert.equal(result?.preflight?.status, 'pass', 'Migration preflight did not pass');
  assert.equal(Number(result?.preflight?.risk_count || 0), 0, 'Migration preflight has risks');
  return { payload, result };
}

async function verifyFinalState() {
  const readbackAttempt = await exactReadback();
  await writeJson('final-readback-transport.json', readbackAttempt.result);
  const readback = readbackAttempt.readback;
  assert.ok(readback, 'Migration 1043 final readback returned no readback_status');
  assert.ok(exactApplyLedger(readback), 'Migration 1043 exact apply ledger verification failed');
  assert.ok(exactObjects(readback), 'Migration 1043 expected table/view readback failed');
  finalReadback = readback;
  finalReadiness = await readinessViewProbe();
  await writeJson('final-readback.json', readback);
  await writeJson('readiness-view.json', finalReadiness);
  return { readback, readiness: finalReadiness };
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
  assert.equal(splitMigrationSqlStatements(sql).length, STATEMENT_COUNT, 'Pinned Migration 1043 statement count changed');
  const derivedApply = `APPLY_${MIGRATION.replace(/\.sql$/i, '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
  assert.equal(APPLY_CONFIRM, derivedApply, 'Apply confirmation is not derived from the exact migration filename');
}

async function main() {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await verifyLocalContract();
  await writeState({ local_contract_verified: true });

  stage = 'repository_and_runtime_parity';
  const parity = await verifyRepositoryAndRuntimeParity();
  await writeJson('runtime-parity.json', parity);
  await writeState();

  stage = 'readback_first';
  const initial = await exactReadback();
  await writeJson('initial-readback.json', initial.result);
  if (exactApplyLedger(initial.readback) && exactObjects(initial.readback)) {
    finalReadback = initial.readback;
    finalReadiness = await readinessViewProbe();
    await writeJson('readiness-view.json', finalReadiness);
    const summary = {
      contract: 'sprint69_1043_apply.v1',
      result: 'already_applied',
      main_sha: mainSha,
      production_sha: productionSha,
      migration: MIGRATION,
      migration_blob_sha: MIGRATION_BLOB_SHA,
      migration_checksum_sha256: CHECKSUM,
      statement_count: STATEMENT_COUNT,
      apply_sent_by_this_run: false,
      apply_retried: false,
      exact_apply_ledger_verified: true,
      readiness_view: finalReadiness,
      activation_registry_sync_executed: false,
      provider_call_executed: false,
      credential_payload_accessed: false,
      external_business_write_executed: false,
      secrets_included: false,
    };
    await writeJson('summary.json', summary);
    await writeState({ ok: true, result: summary.result });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  stage = 'readiness_authorization_readback';
  const authorization = await readExactAuthorizationRecord();
  await writeJson('readiness-authorization.json', authorization);
  await writeState({ readiness_authorization_verified: true });

  stage = 'same_cycle_dry_run';
  const dryRunResult = await dryRun();
  await writeJson('dry-run.json', dryRunResult.payload);
  await writeState({ dry_run_verified: true });

  stage = 'execution_envelope';
  const executionEnvelope = await createReadyExecutionEnvelope();
  await writeJson('execution-envelope.json', executionEnvelope);
  await writeState({ execution_envelope_apply_authorized: true });

  stage = 'single_apply_attempt';
  applySent = true;
  await writeState();
  applyAttempt = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_execute',
    tool_args: {
      migration: MIGRATION,
      mode: 'apply',
      confirm: APPLY_CONFIRM,
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
      capability_envelope_id: executionEnvelopeId,
    },
  }, 600000);
  await writeJson('apply-transport.json', applyAttempt);
  await writeState();

  if (!applyAttempt.transport_ok || !applyAttempt.http_ok || applyAttempt.payload?.ok === false) {
    const error = new Error('Migration 1043 Apply response was unsuccessful or ambiguous; no retry is permitted before exact readback.');
    error.code = 'migration_1043_apply_response_ambiguous';
    error.details = {
      transport_ok: applyAttempt.transport_ok,
      http_status: applyAttempt.status,
      retry_permitted: false,
      next_step: 'Perform exact governed migration ledger and readiness readback before considering any new Apply attempt.',
      secrets_included: false,
    };
    throw error;
  }

  stage = 'final_readback';
  const final = await verifyFinalState();
  await writeState({ final_readback_verified: true });

  stage = 'apply_complete';
  const summary = {
    contract: 'sprint69_1043_apply.v1',
    result: 'pass',
    main_sha: mainSha,
    production_sha: productionSha,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    source_pr: SOURCE_PR,
    source_merge_sha: SOURCE_MERGE_SHA,
    readiness_authorization: 'verified',
    same_cycle_dry_run: 'pass',
    execution_envelope_apply_authorized: true,
    apply_sent_by_this_run: true,
    apply_retried: false,
    exact_apply_ledger_verified: true,
    expected_objects_verified: true,
    readiness_view: final.readiness,
    activation_registry_sync_executed: false,
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
    contract: 'sprint69_1043_apply_failure.v1',
    ok: false,
    stage,
    main_sha: mainSha,
    production_sha: productionSha,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    error: {
      code: String(error?.code || 'sprint69_1043_apply_failed'),
      message: String(error?.message || error || 'Unknown failure').slice(0, 1000),
      details: sanitize(error?.details || undefined),
    },
    execution_envelope_id: executionEnvelopeId,
    apply_sent: applySent,
    apply_retried: false,
    exact_apply_ledger_verified: Boolean(finalReadback),
    readiness_view_verified: Boolean(finalReadiness),
    activation_registry_sync_executed: false,
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
