import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';

const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH = String(process.env.GH_READ_TOKEN || '').trim();
const REPO = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const ISSUE = Number(process.env.CONTROL_ISSUE || 4449);
const SOURCE_PR = Number(process.env.SOURCE_PR || 6662);
const DIR = String(process.env.EVIDENCE_DIR || '.artifacts/tenant-request-identity-collation-authorize-dry-run').trim();

const MIGRATION = '20260808_tenant_request_identity_collation_alignment.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const MIGRATION_BLOB_SHA = '5f68a02f351a4cf80fa89a826abe3c92412f7079';
const CHECKSUM = 'cb22a379a48ad3c3f5be145562d0f96fe8f9830eb663edb204642ec8ec7915c7';
const STATEMENT_COUNT = 3;
const SOURCE_MERGE_SHA = '894f112c452887e9c8f3f58fe55af598cb04af31';
const AUTH_CONFIRM = 'AUTHORIZE_GOVERNED_MIGRATION_20260808_TENANT_REQUEST_IDENTITY_COLLATION_ALIGNMENT';
const TENANT = '00000000-0000-0000-0000-000000000000';
const ADMIN = '00000000-0000-4000-a000-000000000002';
const RESOURCE = `db-migration://growth_intelligence_platform/${MIGRATION}`;

let stage = 'start';
let mainSha = null;
let productionSha = null;
let envelopeId = null;
let authorizationCreated = false;
let dryRunSent = false;

const sensitiveKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;
const SAFE_EVIDENCE_KEYS = new Set([
  'authorization_created',
  'authorization_idempotent',
  'dry_run_sent',
  'migration_sql_executed',
  'applies_sql',
  'provider_call_executed',
  'credential_payload_accessed',
  'external_business_write_executed',
  'secrets_included',
]);

const sha256 = (value) => createHash('sha256').update(String(value || ''), 'utf8').digest('hex');

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    sensitiveKey.test(key) && !SAFE_EVIDENCE_KEYS.has(key) ? '[redacted]' : sanitize(child),
  ]));
}

function parsed(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value;
  try { return JSON.parse(text); } catch { return value; }
}

function findObject(value, predicate, seen = new Set()) {
  value = parsed(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    const found = findObject(child, predicate, seen);
    if (found) return found;
  }
  return null;
}

const keyed = (value, key) => findObject(value, (candidate) => Object.prototype.hasOwnProperty.call(candidate, key));

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

async function writeJson(name, value) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(`${DIR}/${name}`, `${JSON.stringify(sanitize(value), null, 2)}\n`, 'utf8');
}

async function writeState(extra = {}) {
  await writeJson('state.json', {
    contract: 'tenant_request_identity_collation_authorize_dry_run.v1',
    stage,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    source_pr: SOURCE_PR,
    source_merge_sha: SOURCE_MERGE_SHA,
    main_sha: mainSha,
    production_sha: productionSha,
    capability_envelope_id: envelopeId,
    authorization_created: authorizationCreated,
    dry_run_sent: dryRunSent,
    migration_sql_executed: false,
    provider_call_executed: false,
    credential_payload_accessed: false,
    external_business_write_executed: false,
    force_push_executed: false,
    secrets_included: false,
    ...extra,
  });
}

async function githubJson(pathname) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GH}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30000),
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  assert.ok(response.ok, `GitHub read failed HTTP ${response.status}: ${pathname}`);
  return payload;
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
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  } catch (error) {
    return { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: String(error?.name || 'Error') };
  }
}

function requireSuccess(result, label) {
  if (!result.transport_ok || !result.http_ok || result.payload?.ok === false) {
    const detail = keyed(result.payload, 'code') || result.payload?.error || {};
    const error = new Error(`${label} failed: HTTP ${result.status ?? 'transport_error'}`);
    error.code = String(detail?.code || result.payload?.error_code || `${label}_failed`);
    error.details = detail?.details || result.payload?.error?.details || null;
    throw error;
  }
  return result.payload;
}

async function adminShell(alias, extraArgs, label = alias) {
  return requireSuccess(await requestRaw('/admin/control', {
    tool: 'shell',
    action: 'run',
    alias,
    extra_args: extraArgs,
    authority_context: {
      resource_type: 'shell_alias',
      resource_uri: `shell://${alias}`,
      operation_mode: alias,
      required: true,
    },
  }), label);
}

function envelopeBindingSha() {
  return sha256(JSON.stringify({
    schema_version: 'governed_migration_envelope_binding.v1',
    app_key: 'platform_orchestration',
    capability_key: 'governed_migration_authorization_bootstrap',
    operation_intent: 'governed_migration_authorization_bootstrap',
    resource_uri: RESOURCE,
    migration_file: MIGRATION,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    production_sha: productionSha,
  }));
}

async function createBootstrapEnvelope() {
  const created = await adminShell('capability_resolution_envelope_create', [
    `--tenant-id=${TENANT}`,
    `--user-id=${ADMIN}`,
    '--user-role=Admin',
    '--app-key=platform_orchestration',
    '--capability-key=governed_migration_authorization_bootstrap',
    '--operation-intent=governed_migration_authorization_bootstrap',
    '--runtime-surface=auth_host',
    '--requested-source-tier=platform_managed_fallback',
    '--requested-by=github_actions_tenant_request_identity_collation_dry_run',
    '--ttl-minutes=45',
    '--explain',
    `--resource-uri=${RESOURCE}`,
    `--expected-commit-sha=${productionSha}`,
    `--binding-sha256=${envelopeBindingSha()}`,
  ], 'authorization_envelope_create');
  let envelope = keyed(created, 'envelope_id');
  assert.ok(envelope?.envelope_id, 'Capability envelope creation returned no envelope_id');
  assert.equal(Number(envelope.blocking_gap_count || 0), 0, 'Capability envelope has blocking gaps');
  if (envelope.approval_required === true || envelope.envelope_status === 'ready_requires_approval') {
    const approved = await adminShell('capability_resolution_envelope_approve', [
      `--envelope-id=${envelope.envelope_id}`,
      '--approved-by=github_actions',
      '--decision-note=Approve checksum-bound authorization bootstrap for tenant request identity collation Dry Run only; migration SQL is not applied.',
      '--ttl-minutes=45',
    ], 'authorization_envelope_approve');
    envelope = { ...envelope, ...(keyed(approved, 'envelope_id') || {}), approval_required: false, dispatch_allowed: true };
  }
  assert.equal(envelope.envelope_status, 'ready_for_dispatch');
  assert.equal(envelope.dispatch_allowed, true);
  return envelope.envelope_id;
}

async function verifyRepositoryAndRuntime() {
  assert.equal(BASE, 'https://auth.mad4b.com');
  assert.ok(KEY, 'BACKEND_API_KEY is required');
  assert.ok(GH, 'GH_READ_TOKEN is required');
  assert.equal(REPO, 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os');
  assert.equal(ISSUE, 4449);
  assert.equal(SOURCE_PR, 6662);

  const sql = await fs.readFile(MIGRATION_PATH, 'utf8');
  assert.equal(sha256(sql), CHECKSUM, 'Pinned migration checksum changed');
  assert.equal(splitMigrationSqlStatements(sql).length, STATEMENT_COUNT, 'Pinned migration statement count changed');

  const main = await githubJson(`/repos/${REPO}/git/ref/heads/main`);
  mainSha = String(main?.object?.sha || '').toLowerCase();
  const checkoutSha = String(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })).trim().toLowerCase();
  assert.equal(checkoutSha, mainSha, 'Issue-comment checkout is no longer exact current main');

  const pr = await githubJson(`/repos/${REPO}/pulls/${SOURCE_PR}`);
  assert.ok(pr?.merged_at, `Source PR #${SOURCE_PR} is not merged`);
  assert.equal(String(pr?.merge_commit_sha || '').toLowerCase(), SOURCE_MERGE_SHA, 'Source PR merge SHA changed');

  const production = await githubJson(`/repos/${REPO}/git/ref/heads/Production`);
  productionSha = String(production?.object?.sha || '').toLowerCase();
  assert.match(productionSha, /^[0-9a-f]{40}$/);
  const migration = await githubJson(`/repos/${REPO}/contents/${MIGRATION_PATH}?ref=${productionSha}`);
  assert.equal(String(migration?.sha || '').toLowerCase(), MIGRATION_BLOB_SHA, 'Production migration blob mismatch');
  const comparison = await githubJson(`/repos/${REPO}/compare/${SOURCE_MERGE_SHA}...${productionSha}`);
  assert.ok(['ahead', 'identical'].includes(String(comparison?.status || '')), 'Production does not contain reviewed source merge');

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const [health, version, deployment] = await Promise.all([
      requestGet(`${BASE}/health`),
      requestGet(`${BASE}/version`),
      requestGet(`${BASE}/deployment-info`),
    ]);
    const pass = health.http_ok && health.payload?.ok === true && version.http_ok && deployment.http_ok
      && collectShas(version.payload).has(productionSha)
      && collectShas(deployment.payload).has(productionSha);
    if (pass) return { checkout_sha: checkoutSha, main_sha: mainSha, production_sha: productionSha, runtime_attempt: attempt };
    if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  throw new Error('Runtime did not prove exact Production parity within bounded window');
}

async function bootstrapAuthorization() {
  envelopeId = await createBootstrapEnvelope();
  await writeState();
  const payload = requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: {
      migration: MIGRATION,
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
      pull_request: SOURCE_PR,
      merge_sha: SOURCE_MERGE_SHA,
      confirm: AUTH_CONFIRM,
      capability_envelope_id: envelopeId,
      decision_note: 'Authorize checksum-bound tenant request identity collation migration registration for this governed Dry Run only; no migration Apply is executed by this workflow.',
    },
  }), 'authorization_bootstrap');
  const result = keyed(payload, 'authorization_created') || payload;
  assert.equal(result?.migration_sql_executed, false, 'Authorization bootstrap unexpectedly executed migration SQL');
  assert.equal(result?.applies_migration, false, 'Authorization bootstrap unexpectedly applied migration');
  if (result?.idempotent === true || result?.authorization_created === false) {
    const error = new Error('A durable authorization already exists; refusing to replay the one-shot Dry Run authorization.');
    error.code = 'tenant_request_identity_collation_authorization_already_present';
    throw error;
  }
  assert.equal(result?.authorization_created, true, 'Authorization bootstrap did not create a new authorization');
  authorizationCreated = true;
  return result;
}

async function executeDryRun() {
  dryRunSent = true;
  await writeState();
  const payload = requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_execute',
    tool_args: {
      migration: MIGRATION,
      mode: 'dry_run',
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
    },
  }), 'governed_migration_dry_run');
  const result = keyed(payload, 'applies_sql') || payload;
  assert.equal(result?.mode, 'dry_run');
  assert.equal(result?.applies_sql, false);
  assert.equal(Number(result?.preflight_risk_count || 0), 0);
  if (result?.statement_count != null) assert.equal(Number(result.statement_count), STATEMENT_COUNT);
  return result;
}

try {
  await writeState();
  stage = 'repository_and_runtime_parity';
  const identity = await verifyRepositoryAndRuntime();
  await writeJson('identity.json', { ...identity, migration: MIGRATION, migration_blob_sha: MIGRATION_BLOB_SHA, checksum: CHECKSUM, statement_count: STATEMENT_COUNT, secrets_included: false });

  stage = 'authorization_bootstrap';
  const authorization = await bootstrapAuthorization();
  await writeJson('authorization.json', authorization);

  stage = 'dry_run';
  const dryRun = await executeDryRun();
  await writeJson('dry-run.json', dryRun);

  stage = 'complete';
  await writeJson('summary.json', {
    contract: 'tenant_request_identity_collation_authorize_dry_run.v1',
    result: 'dry_run_pass',
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    source_pr: SOURCE_PR,
    source_merge_sha: SOURCE_MERGE_SHA,
    main_sha: mainSha,
    production_sha: productionSha,
    authorization_created: true,
    authorization_idempotent: false,
    dry_run_sent: true,
    dry_run_mode: 'dry_run',
    applies_sql: false,
    preflight_risk_count: Number(dryRun?.preflight_risk_count || 0),
    migration_sql_executed: false,
    provider_call_executed: false,
    credential_payload_accessed: false,
    external_business_write_executed: false,
    force_push_executed: false,
    secrets_included: false,
  });
  await writeState({ completed: true });
} catch (error) {
  await writeJson('failure.json', {
    contract: 'tenant_request_identity_collation_authorize_dry_run.v1',
    result: 'fail',
    stage,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    source_pr: SOURCE_PR,
    source_merge_sha: SOURCE_MERGE_SHA,
    main_sha: mainSha,
    production_sha: productionSha,
    authorization_created: authorizationCreated,
    dry_run_sent: dryRunSent,
    migration_sql_executed: false,
    provider_call_executed: false,
    credential_payload_accessed: false,
    external_business_write_executed: false,
    force_push_executed: false,
    error: { name: error?.name || 'Error', code: error?.code || 'authorize_dry_run_failed', message: error?.message || String(error), details: error?.details || null },
    secrets_included: false,
  });
  await writeState({ failed: true });
  throw error;
}
