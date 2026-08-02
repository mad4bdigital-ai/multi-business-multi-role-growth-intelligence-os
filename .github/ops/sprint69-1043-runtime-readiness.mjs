import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';

const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH_TOKEN = String(process.env.GH_READ_TOKEN || '').trim();
const REPOSITORY = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const CONTROL_ISSUE = Number(process.env.CONTROL_ISSUE || 4449);
const EVIDENCE_DIR = String(process.env.EVIDENCE_DIR || '.artifacts/sprint69-1043-runtime-readiness').trim();

const MIGRATION = '1043_sprint69_tenant_managed_execution_lifecycle.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const MIGRATION_BLOB_SHA = '7f3e0152bcdfba36a659ff4a1df8e30d82024c8c';
const CHECKSUM = 'a11dff751fca4df19a6acfc188ca7310d8e1a90aa5c3f06fe0c3efeb1213a2a9';
const STATEMENT_COUNT = 4;
const SOURCE_PR = 4845;
const SOURCE_MERGE_SHA = 'a1c1f3d4f4b36a3a5764d898194818e3e9ea1ce3';
const REPOSITORY_READINESS_MERGE_SHA = '0cd5e8c894f2877db9de1e1942ff9db25d9ecc5e';
const AUTH_CONFIRM = 'AUTHORIZE_GOVERNED_MIGRATION_1043_SPRINT69_TENANT_MANAGED_EXECUTION_LIFECYCLE';
const RESOURCE_URI = `db-migration://growth_intelligence_platform/${MIGRATION}`;
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const PLATFORM_ADMIN_USER_ID = '00000000-0000-4000-a000-000000000002';
const EXPECTED_OBJECTS = Object.freeze([
  'managed_execution_bindings',
  'managed_execution_step_requests',
  'managed_execution_events',
  'v_managed_execution_lifecycle_readiness',
]);

let stage = 'program_start';
let productionSha = null;
let mainSha = null;
let authorizationEnvelopeId = null;
let authorizationCreated = false;

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

async function writeJson(name, value) {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(`${EVIDENCE_DIR}/${name}`, `${JSON.stringify(sanitize(value), null, 2)}\n`, 'utf8');
}

async function writeState(extra = {}) {
  await writeJson('state.json', {
    contract: 'sprint69_1043_runtime_readiness_state.v1',
    stage,
    main_sha: mainSha,
    production_sha: productionSha,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    authorization_envelope_id: authorizationEnvelopeId,
    authorization_created: authorizationCreated,
    apply_authorized: false,
    apply_sent: false,
    migration_apply_executed: false,
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

async function waitForRuntimeParity() {
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
          production_sha: targetSha,
          source_compare: sourceCompare,
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

function envelopeBindingSha(capabilityKey, operationIntent) {
  return createHash('sha256').update(JSON.stringify({
    schema_version: 'governed_migration_envelope_binding.v1',
    app_key: 'platform_orchestration',
    capability_key: capabilityKey,
    operation_intent: operationIntent,
    resource_uri: RESOURCE_URI,
    migration_file: MIGRATION,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    production_sha: productionSha,
  })).digest('hex');
}

async function createReadyAuthorizationEnvelope() {
  const capabilityKey = 'governed_migration_authorization_bootstrap';
  const operationIntent = 'governed_migration_authorization_bootstrap';
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
    '--requested-by=github_actions_sprint69_1043_runtime_readiness',
    '--ttl-minutes=45',
    '--explain',
    `--resource-uri=${RESOURCE_URI}`,
    `--expected-commit-sha=${productionSha}`,
    `--binding-sha256=${bindingSha}`,
  ], 'migration_1043_authorization_envelope_create');
  let envelope = findObjectWithKey(createdPayload, 'envelope_id');
  assert.ok(envelope?.envelope_id, 'Capability envelope creation returned no envelope_id');
  assert.notEqual(envelope.envelope_status, 'blocked', `Capability envelope blocked: ${envelope.decision || 'unknown'}`);
  assert.equal(Number(envelope.blocking_gap_count || 0), 0, 'Capability envelope has blocking gaps');

  if (envelope.approval_required === true || envelope.envelope_status === 'ready_requires_approval') {
    const approvedPayload = await adminShell('capability_resolution_envelope_approve', [
      `--envelope-id=${envelope.envelope_id}`,
      '--approved-by=github_actions',
      '--decision-note=Approve the checksum-bound Migration 1043 authorization-bootstrap envelope for runtime readiness only; migration SQL and activation registry synchronization are not executed.',
      '--ttl-minutes=45',
    ], 'migration_1043_authorization_envelope_approve');
    const approved = findObjectWithKey(approvedPayload, 'envelope_id');
    if (approved) envelope = { ...envelope, ...approved, approval_required: false, dispatch_allowed: true };
  }

  assert.equal(envelope.envelope_status, 'ready_for_dispatch', 'Authorization envelope is not ready_for_dispatch');
  assert.equal(envelope.dispatch_allowed, true, 'Authorization envelope dispatch_allowed is not true');
  authorizationEnvelopeId = envelope.envelope_id;
  authorizationCreated = true;
  return { envelope, binding_sha256: bindingSha, apply_authorized: false, secrets_included: false };
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

async function bootstrapAuthorization(envelopeId) {
  const baseArgs = {
    migration: MIGRATION,
    expected_checksum_sha256: CHECKSUM,
    expected_statement_count: STATEMENT_COUNT,
    pull_request: SOURCE_PR,
    merge_sha: SOURCE_MERGE_SHA,
    confirm: AUTH_CONFIRM,
    capability_envelope_id: envelopeId,
    decision_note: 'Authorize reviewed additive Migration 1043 after exact Production parity and checksum validation. This runtime-readiness action records authorization but does not execute migration SQL.',
  };

  const first = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: baseArgs,
  }, 300000);
  if (first.transport_ok && first.http_ok && first.payload?.ok !== false) {
    return requireSuccess(first, 'migration_1043_authorization_bootstrap');
  }

  const errorObject = findObjectWithKey(first.payload, 'code') || first.payload?.error || {};
  const code = String(errorObject?.code || first.payload?.error?.code || '');
  const details = errorObject?.details || first.payload?.error?.details || {};
  const recorded = String(details?.recorded_checksum_sha256 || details?.current_checksum_sha256 || '').toLowerCase();
  assert.equal(code, 'governed_migration_authorization_previous_checksum_required', `Authorization bootstrap failed unexpectedly: ${code || 'unknown'}`);
  assert.match(recorded, /^[0-9a-f]{64}$/, 'Bootstrap did not expose a valid recorded checksum for one exact rotation retry');
  assert.notEqual(recorded, CHECKSUM, 'Recorded checksum unexpectedly equals target checksum');
  await writeJson('authorization-rotation-discovery.json', {
    code,
    recorded_checksum_sha256: recorded,
    secrets_included: false,
  });

  return requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: { ...baseArgs, previous_checksum_sha256: recorded },
  }, 300000), 'migration_1043_authorization_rotation');
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
  }, 300000), 'migration_1043_dry_run');
  const result = findObjectWithKey(payload, 'applies_sql') || payload;
  assert.equal(result?.applies_sql, false, 'Dry-run must report applies_sql=false');
  assert.equal(result?.mode, 'dry_run', 'Dry-run mode mismatch');
  assert.equal(String(result?.migration_checksum_sha256 || '').toLowerCase(), CHECKSUM, 'Dry-run checksum mismatch');
  assert.equal(Number(result?.statement_count), STATEMENT_COUNT, 'Dry-run statement count mismatch');
  assert.equal(result?.preflight?.status, 'pass', 'Migration preflight did not pass');
  assert.equal(Number(result?.preflight?.risk_count || 0), 0, 'Migration preflight has risks');
  return { payload, result };
}

async function verifyLocalContract() {
  assert.equal(BASE, 'https://auth.mad4b.com', 'Runtime base URL must remain canonical auth host');
  assert.ok(KEY, 'BACKEND_API_KEY is required');
  assert.ok(GH_TOKEN, 'GH_READ_TOKEN is required');
  assert.equal(REPOSITORY, 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os');
  assert.equal(CONTROL_ISSUE, 4449);
  const sql = await fs.readFile(MIGRATION_PATH, 'utf8');
  assert.equal(gitBlobSha(sql), MIGRATION_BLOB_SHA, 'Pinned Migration 1043 Git blob changed');
  assert.equal(createHash('sha256').update(sql, 'utf8').digest('hex'), CHECKSUM, 'Pinned Migration 1043 checksum changed');
  assert.equal(splitMigrationSqlStatements(sql).length, STATEMENT_COUNT, 'Pinned Migration 1043 statement count changed');
  const derivedConfirmation = `AUTHORIZE_GOVERNED_MIGRATION_${MIGRATION.replace(/\.sql$/i, '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
  assert.equal(AUTH_CONFIRM, derivedConfirmation, 'Runtime authorization confirmation is not derived from the exact migration filename');
}

async function main() {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await verifyLocalContract();
  mainSha = await currentRefSha('main');
  const mainCompare = await assertContains(REPOSITORY_READINESS_MERGE_SHA, mainSha, 'main');
  await writeState({ local_contract_verified: true, main_compare: mainCompare });

  stage = 'runtime_parity';
  const runtime = await waitForRuntimeParity();
  await writeJson('runtime-parity.json', runtime);
  await writeState();

  stage = 'readback_first';
  const initial = await exactReadback();
  await writeJson('initial-readback.json', initial.result);
  if (exactApplyLedger(initial.readback)) {
    const summary = {
      contract: 'sprint69_1043_runtime_readiness.v1',
      result: 'already_applied',
      main_sha: mainSha,
      production_sha: productionSha,
      migration: MIGRATION,
      migration_blob_sha: MIGRATION_BLOB_SHA,
      migration_checksum_sha256: CHECKSUM,
      statement_count: STATEMENT_COUNT,
      runtime_parity: 'pass',
      authorization_created: false,
      authorization_bootstrap: 'not_required',
      dry_run: 'not_required',
      apply_authorized: false,
      apply_sent: false,
      migration_apply_executed: false,
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

  stage = 'authorization_envelope';
  const envelope = await createReadyAuthorizationEnvelope();
  await writeJson('authorization-envelope.json', envelope);
  await writeState();

  stage = 'authorization_bootstrap';
  const authorization = await bootstrapAuthorization(authorizationEnvelopeId);
  await writeJson('authorization-bootstrap.json', authorization);
  await writeState({ authorization_bootstrap_verified: true });

  stage = 'governed_dry_run';
  const dryRunResult = await dryRun();
  await writeJson('dry-run.json', dryRunResult.payload);
  await writeState({ dry_run_verified: true });

  stage = 'readiness_complete';
  const summary = {
    contract: 'sprint69_1043_runtime_readiness.v1',
    result: 'pass',
    main_sha: mainSha,
    production_sha: productionSha,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    source_pr: SOURCE_PR,
    source_merge_sha: SOURCE_MERGE_SHA,
    repository_readiness_merge_sha: REPOSITORY_READINESS_MERGE_SHA,
    runtime_parity: 'pass',
    authorization_created: true,
    authorization_bootstrap: 'pass',
    dry_run: 'pass',
    apply_authorized: false,
    apply_sent: false,
    migration_apply_executed: false,
    activation_registry_sync_executed: false,
    managed_control_plane_write_executed: true,
    business_data_mutation_executed: false,
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
    contract: 'sprint69_1043_runtime_readiness_failure.v1',
    ok: false,
    stage,
    main_sha: mainSha,
    production_sha: productionSha,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    error: {
      code: String(error?.code || 'sprint69_1043_runtime_readiness_failed'),
      message: String(error?.message || error || 'Unknown failure').slice(0, 1000),
      details: sanitize(error?.details || undefined),
    },
    runtime_contacted: stage !== 'program_start',
    authorization_created: authorizationCreated,
    apply_authorized: false,
    apply_sent: false,
    migration_apply_executed: false,
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
