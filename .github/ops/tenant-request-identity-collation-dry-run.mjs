import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';

const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH_TOKEN = String(process.env.GH_READ_TOKEN || '').trim();
const REPOSITORY = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const CONTROL_ISSUE = Number(process.env.CONTROL_ISSUE || 4449);
const EVIDENCE_DIR = String(process.env.EVIDENCE_DIR || '.artifacts/tenant-request-identity-collation-dry-run').trim();

const MIGRATION = '20260808_tenant_request_identity_collation_alignment.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const MIGRATION_BLOB_SHA = '5f68a02f351a4cf80fa89a826abe3c92412f7079';
const CHECKSUM = 'cb22a379a48ad3c3f5be145562d0f96fe8f9830eb663edb204642ec8ec7915c7';
const STATEMENT_COUNT = 3;
const SOURCE_PR = 6662;
const SOURCE_MERGE_SHA = '894f112c452887e9c8f3f58fe55af598cb04af31';
const AUTH_CONFIRM = 'AUTHORIZE_GOVERNED_MIGRATION_20260808_TENANT_REQUEST_IDENTITY_COLLATION_ALIGNMENT';
const RESOURCE_URI = `db-migration://growth_intelligence_platform/${MIGRATION}`;
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const PLATFORM_ADMIN_USER_ID = '00000000-0000-4000-a000-000000000002';

let mainSha = null;
let productionSha = null;
let authorizationEnvelopeId = null;
let authorizationCreated = false;
let dryRunVerified = false;
let stage = 'program_start';

const sensitiveKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;
const SAFE_EVIDENCE_KEYS = new Set([
  'authorization_created',
  'authorization_idempotent',
  'apply_authorized',
  'apply_sent',
  'dry_run_verified',
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

async function writeJson(name, value) {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(`${EVIDENCE_DIR}/${name}`, `${JSON.stringify(sanitize(value), null, 2)}\n`, 'utf8');
}

async function writeState(extra = {}) {
  await writeJson('state.json', {
    contract: 'tenant_request_identity_collation_dry_run_state.v1',
    stage,
    main_sha: mainSha,
    production_sha: productionSha,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    authorization_envelope_id: authorizationEnvelopeId,
    authorization_created: authorizationCreated,
    dry_run_verified: dryRunVerified,
    apply_authorized: false,
    apply_sent: false,
    migration_apply_executed: false,
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
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  } catch (error) {
    return { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: String(error?.name || 'Error') };
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
    return { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: String(error?.name || 'Error') };
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
  return comparison.status;
}

async function verifyRepositoryAndRuntimeParity() {
  mainSha = await currentRefSha('main');
  await assertContains(SOURCE_MERGE_SHA, mainSha, 'main');

  for (let convergence = 1; convergence <= 2; convergence += 1) {
    const targetSha = await currentRefSha('Production');
    await assertContains(SOURCE_MERGE_SHA, targetSha, 'Production');
    const productionFile = await githubJson(`/repos/${REPOSITORY}/contents/${MIGRATION_PATH}?ref=${targetSha}`);
    assert.equal(String(productionFile?.sha || '').toLowerCase(), MIGRATION_BLOB_SHA, 'Production migration blob does not match reviewed source');

    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const [health, version, deployment] = await Promise.all([
        requestGet(`${BASE}/health`),
        requestGet(`${BASE}/version`),
        requestGet(`${BASE}/deployment-info`),
      ]);
      const pass = health.http_ok && health.payload?.ok === true
        && version.http_ok && collectShas(version.payload).has(targetSha)
        && deployment.http_ok && collectShas(deployment.payload).has(targetSha);
      if (pass) {
        const latest = await currentRefSha('Production');
        if (latest !== targetSha) break;
        productionSha = targetSha;
        return {
          main_sha: mainSha,
          production_sha: productionSha,
          health_http: health.status,
          version_http: version.status,
          deployment_info_http: deployment.status,
          migration_blob_sha: MIGRATION_BLOB_SHA,
          secrets_included: false,
        };
      }
      if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 10000));
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
    '--requested-by=github_actions_tenant_request_identity_collation_dry_run',
    '--ttl-minutes=45',
    '--explain',
    `--resource-uri=${RESOURCE_URI}`,
    `--expected-commit-sha=${productionSha}`,
    `--binding-sha256=${bindingSha}`,
  ], 'tenant_request_identity_collation_authorization_envelope_create');

  let envelope = findObjectWithKey(createdPayload, 'envelope_id');
  assert.ok(envelope?.envelope_id, 'Authorization envelope creation returned no envelope_id');
  assert.notEqual(envelope.envelope_status, 'blocked', `Authorization envelope blocked: ${envelope.decision || 'unknown'}`);
  assert.equal(Number(envelope.blocking_gap_count || 0), 0, 'Authorization envelope has blocking gaps');

  if (envelope.approval_required === true || envelope.envelope_status === 'ready_requires_approval') {
    const approvedPayload = await adminShell('capability_resolution_envelope_approve', [
      `--envelope-id=${envelope.envelope_id}`,
      '--approved-by=github_actions',
      '--decision-note=Approve checksum-bound tenant request identity collation authorization bootstrap for Dry Run only. Migration SQL Apply is forbidden in this workflow.',
      '--ttl-minutes=45',
    ], 'tenant_request_identity_collation_authorization_envelope_approve');
    const approved = findObjectWithKey(approvedPayload, 'envelope_id');
    if (approved) envelope = { ...envelope, ...approved, approval_required: false, dispatch_allowed: true };
  }

  assert.equal(envelope.envelope_status, 'ready_for_dispatch', 'Authorization envelope is not ready_for_dispatch');
  assert.equal(envelope.dispatch_allowed, true, 'Authorization envelope dispatch_allowed is not true');
  authorizationEnvelopeId = envelope.envelope_id;
  return { envelope, binding_sha256: bindingSha, secrets_included: false };
}

async function bootstrapAuthorization() {
  const payload = requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: {
      migration: MIGRATION,
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
      pull_request: SOURCE_PR,
      merge_sha: SOURCE_MERGE_SHA,
      confirm: AUTH_CONFIRM,
      capability_envelope_id: authorizationEnvelopeId,
      decision_note: 'Authorize the reviewed checksum-bound tenant request identity collation migration for governed Dry Run only. This action records authorization evidence and does not execute migration SQL.',
    },
  }), 'tenant_request_identity_collation_authorization_bootstrap');

  const result = findObjectWithKey(payload, 'authorization_created') || payload;
  assert.equal(result?.migration_sql_executed, false, 'Authorization bootstrap must not execute migration SQL');
  assert.equal(result?.applies_migration, false, 'Authorization bootstrap must not apply the migration');
  authorizationCreated = result?.authorization_created === true;
  return result;
}

async function executeDryRun() {
  const payload = requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_execute',
    tool_args: {
      migration: MIGRATION,
      mode: 'dry_run',
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
    },
  }), 'tenant_request_identity_collation_dry_run');
  const result = findObjectWithKey(payload, 'applies_sql') || payload;
  assert.equal(result?.mode, 'dry_run', 'Dry Run mode mismatch');
  assert.equal(result?.applies_sql, false, 'Dry Run must report applies_sql=false');
  assert.equal(String(result?.migration_checksum_sha256 || '').toLowerCase(), CHECKSUM, 'Dry Run checksum mismatch');
  assert.equal(Number(result?.statement_count), STATEMENT_COUNT, 'Dry Run statement count mismatch');
  dryRunVerified = true;
  return result;
}

async function main() {
  assert.ok(KEY, 'BACKEND_API_KEY is required');
  assert.ok(GH_TOKEN, 'GH_READ_TOKEN is required');
  assert.equal(CONTROL_ISSUE, 4449, 'Dry Run is pinned to control issue #4449');

  try {
    stage = 'repository_and_runtime_parity';
    const parity = await verifyRepositoryAndRuntimeParity();
    await writeJson('repository-runtime-parity.json', parity);
    await writeState();

    stage = 'authorization_envelope';
    const envelope = await createReadyAuthorizationEnvelope();
    await writeJson('authorization-envelope.json', envelope);
    await writeState();

    stage = 'authorization_bootstrap';
    const authorization = await bootstrapAuthorization();
    await writeJson('authorization-bootstrap.json', authorization);
    await writeState({ authorization_idempotent: authorization?.idempotent === true });

    stage = 'dry_run';
    const dryRun = await executeDryRun();
    await writeJson('dry-run.json', dryRun);

    stage = 'complete';
    await writeState({
      dry_run_verified: true,
      apply_authorized: false,
      apply_sent: false,
      migration_apply_executed: false,
      managed_control_plane_write_executed: authorizationCreated,
      provider_call_executed: false,
      credential_payload_accessed: false,
      external_business_write_executed: false,
      secrets_included: false,
    });
    await writeJson('summary.json', {
      contract: 'tenant_request_identity_collation_dry_run_summary.v1',
      status: 'dry_run_verified',
      main_sha: mainSha,
      production_sha: productionSha,
      migration: MIGRATION,
      migration_checksum_sha256: CHECKSUM,
      statement_count: STATEMENT_COUNT,
      authorization_created: authorizationCreated,
      authorization_idempotent: authorization?.idempotent === true,
      dry_run_verified: true,
      applies_sql: false,
      apply_authorized: false,
      apply_sent: false,
      migration_apply_executed: false,
      provider_call_executed: false,
      credential_payload_accessed: false,
      external_business_write_executed: false,
      secrets_included: false,
    });
    console.log(JSON.stringify({ ok: true, status: 'dry_run_verified', migration: MIGRATION, production_sha: productionSha }, null, 2));
  } catch (error) {
    await writeState({
      failed: true,
      error_code: String(error?.code || error?.name || 'dry_run_failed'),
      error_message: String(error?.message || error),
    });
    throw error;
  }
}

await main();
