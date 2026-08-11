import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';
import { buildAdminControlDbReadRequest } from './lib/admin-control-db-request.mjs';

const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH = String(process.env.GH_READ_TOKEN || '').trim();
const REPO = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const ISSUE = Number(process.env.CONTROL_ISSUE || 4451);
const SOURCE_PR = 6763;
const SOURCE_MERGE_SHA = 'ccb4ea8b298a2bef97afec20d2f2cb782b33a6a1';
const EXPECTED_PRODUCTION_SHA = '6957f56ead3f720767957dbb7b9b213cc54ed04e';
const MIGRATION = '1052_tenant_platform_plugin_managed_repair_authority.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const MIGRATION_BLOB_SHA = 'f9c44b9e504d4e72914a28a8d0496c6bde385b3a';
const EXPECTED_CHECKSUM_SHA256 = 'ba98da0406f416227cdb0122527455baa4a4cdbb87e196f51357f6cac2c87890';
const EXPECTED_STATEMENT_COUNT = 3;
const AUTH_CONFIRM = 'AUTHORIZE_GOVERNED_MIGRATION_1052_TENANT_PLATFORM_PLUGIN_MANAGED_REPAIR_AUTHORITY';
const TENANT = '00000000-0000-0000-0000-000000000000';
const ADMIN = '00000000-0000-4000-a000-000000000002';
const RESOURCE = `db-migration://growth_intelligence_platform/${MIGRATION}`;
const DIR = String(process.env.EVIDENCE_DIR || `${process.env.RUNNER_TEMP || '/tmp'}/migration-1052-readiness`).trim();

let stage = 'start';
let checksum = null;
let statementCount = null;
let envelopeId = null;

const sensitiveKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;
const SAFE_EVIDENCE_KEYS = new Set(['authorization_status', 'credential_payload_accessed', 'provider_call_executed', 'secrets_included']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
function gitBlobSha(bytes) {
  return createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
}
function parsed(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value;
  try { return JSON.parse(text); } catch { return value; }
}
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    sensitiveKey.test(key) && !SAFE_EVIDENCE_KEYS.has(key) ? '[redacted]' : sanitize(child),
  ]));
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
    contract: 'tenant_platform_plugin_migration_1052_readiness.v1',
    stage,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: checksum,
    statement_count: statementCount,
    source_pr: SOURCE_PR,
    source_merge_sha: SOURCE_MERGE_SHA,
    expected_production_sha: EXPECTED_PRODUCTION_SHA,
    capability_envelope_id: envelopeId,
    migration_apply_performed: false,
    managed_execution_run_created: false,
    runtime_dispatch_certification_issued: false,
    provider_call_executed: false,
    external_write_executed: false,
    credential_payload_accessed: false,
    protected_ref_mutation_executed: false,
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
  const payload = await response.json();
  assert.ok(response.ok, `GitHub read failed HTTP ${response.status}: ${pathname}`);
  return payload;
}
async function requestGet(pathname, timeoutMs = 30000) {
  const response = await fetch(`${BASE}${pathname}`, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
  return { status: response.status, http_ok: response.ok, payload };
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
    const detail = keyed(result.payload, 'code') || result.payload?.error || {};
    const error = new Error(`${label} failed: HTTP ${result.status ?? 'transport_error'}`);
    error.code = String(detail?.code || result.payload?.error_code || `${label}_failed`);
    error.details = detail?.details || result.payload?.error?.details || null;
    error.result = result;
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
    migration_checksum_sha256: checksum,
    statement_count: statementCount,
    production_sha: EXPECTED_PRODUCTION_SHA,
  }));
}
async function verifySourceAndMigration() {
  assert.equal(ISSUE, 4451, 'Migration 1052 readiness bridge is bound to issue #4451');
  const issue = await githubJson(`/repos/${REPO}/issues/${ISSUE}`);
  assert.equal(issue.state, 'open', '#4451 must remain open during Migration 1052 readiness');

  const sourcePr = await githubJson(`/repos/${REPO}/pulls/${SOURCE_PR}`);
  assert.ok(sourcePr.merged_at, `Source PR #${SOURCE_PR} is not merged`);
  assert.equal(String(sourcePr.merge_commit_sha || '').toLowerCase(), SOURCE_MERGE_SHA);

  const production = await githubJson(`/repos/${REPO}/git/ref/heads/Production`);
  assert.equal(String(production?.object?.sha || '').toLowerCase(), EXPECTED_PRODUCTION_SHA);

  const bytes = await fs.readFile(MIGRATION_PATH);
  assert.equal(gitBlobSha(bytes), MIGRATION_BLOB_SHA, 'Migration 1052 blob identity changed');
  checksum = sha256(bytes);
  assert.equal(checksum, EXPECTED_CHECKSUM_SHA256, 'Migration 1052 SHA-256 changed');
  statementCount = splitMigrationSqlStatements(bytes.toString('utf8')).length;
  assert.equal(statementCount, EXPECTED_STATEMENT_COUNT, 'Migration 1052 statement count changed');

  return {
    source_pr: SOURCE_PR,
    source_merge_sha: SOURCE_MERGE_SHA,
    production_sha: EXPECTED_PRODUCTION_SHA,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: checksum,
    statement_count: statementCount,
  };
}
async function verifyRuntimeParity() {
  const [health, version, deployment, connector] = await Promise.all([
    requestGet('/health'),
    requestGet('/version'),
    requestGet('/deployment-info'),
    requestGet('/connector-agent/version'),
  ]);
  for (const [label, result] of Object.entries({ health, version, deployment, connector })) {
    assert.equal(result.status, 200, `${label} runtime readback must return HTTP 200`);
  }
  assert.equal(health.payload?.ok, true, 'Production health must be healthy');
  assert.notEqual(connector.payload?.ok, false, 'Connector-agent version readback must not report failure');

  const versionShas = [...collectShas(version.payload)];
  assert.ok(versionShas.includes(EXPECTED_PRODUCTION_SHA), 'Runtime /version does not contain exact Production SHA');

  const manifest = deployment.payload?.deployment && typeof deployment.payload.deployment === 'object'
    ? deployment.payload.deployment
    : {};
  const runtimeSha = String(
    deployment.payload?.commit_sha ||
    deployment.payload?.commit ||
    manifest?.commit_sha ||
    manifest?.commit ||
    ''
  ).toLowerCase();
  const runtimeBranch = String(deployment.payload?.branch || manifest?.branch || '');
  assert.equal(runtimeSha, EXPECTED_PRODUCTION_SHA, 'Runtime deployment SHA differs from protected Production');
  assert.equal(runtimeBranch, 'Production', 'Runtime deployment branch provenance differs from Production');

  return {
    health_ok: true,
    version_sha_exact: true,
    deployment_sha_exact: true,
    deployment_branch: runtimeBranch,
    connector_agent_ok: connector.payload?.ok ?? null,
  };
}
async function repinProductionAfterRuntimeParity() {
  const production = await githubJson(`/repos/${REPO}/git/ref/heads/Production`);
  const productionSha = String(production?.object?.sha || '').toLowerCase();
  assert.equal(
    productionSha,
    EXPECTED_PRODUCTION_SHA,
    'Production ref moved after runtime parity and before authorization mutation'
  );
  return {
    production_sha: productionSha,
    unchanged_after_runtime_parity: true,
  };
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
    '--requested-by=github_actions_tenant_platform_plugin_1052_readiness',
    '--ttl-minutes=45',
    '--explain',
    `--resource-uri=${RESOURCE}`,
    `--expected-commit-sha=${EXPECTED_PRODUCTION_SHA}`,
    `--binding-sha256=${envelopeBindingSha()}`,
  ], 'migration_1052_envelope_create');

  let envelope = keyed(created, 'envelope_id');
  assert.ok(envelope?.envelope_id, 'Capability envelope creation returned no envelope_id');
  assert.equal(Number(envelope.blocking_gap_count || 0), 0, 'Capability envelope has blocking gaps');

  if (envelope.approval_required === true || envelope.envelope_status === 'ready_requires_approval') {
    const approved = await adminShell('capability_resolution_envelope_approve', [
      `--envelope-id=${envelope.envelope_id}`,
      '--approved-by=github_actions',
      '--decision-note=Approve checksum-bound Migration 1052 authorization bootstrap and dry-run readiness only. No Migration Apply, runtime certification issuance, managed execution run, provider call, or external write.',
      '--ttl-minutes=45',
    ], 'migration_1052_envelope_approve');
    envelope = { ...envelope, ...(keyed(approved, 'envelope_id') || {}), approval_required: false, dispatch_allowed: true };
  }

  assert.equal(envelope.envelope_status, 'ready_for_dispatch');
  assert.equal(envelope.dispatch_allowed, true);
  envelopeId = envelope.envelope_id;
  return {
    envelope_id: envelopeId,
    envelope_status: envelope.envelope_status,
    dispatch_allowed: envelope.dispatch_allowed,
    blocking_gap_count: Number(envelope.blocking_gap_count || 0),
  };
}
async function bootstrapAuthorization() {
  const args = {
    migration: MIGRATION,
    expected_checksum_sha256: checksum,
    expected_statement_count: statementCount,
    pull_request: SOURCE_PR,
    merge_sha: SOURCE_MERGE_SHA,
    confirm: AUTH_CONFIRM,
    capability_envelope_id: envelopeId,
    executor_readiness_mode: 'require_existing',
    decision_note: 'Authorize checksum-bound Migration 1052 staged managed-repair authority only. Readiness includes dry-run; Migration Apply and Runtime Dispatch Certification remain separate.',
  };

  const first = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: args,
  });
  if (first.transport_ok && first.http_ok && first.payload?.ok !== false) {
    return requireSuccess(first, 'migration_1052_authorization_bootstrap');
  }

  const detail = keyed(first.payload, 'code') || first.payload?.error || {};
  if (String(detail?.code) === 'governed_migration_authorization_confirmation_required') {
    const required = String(detail?.details?.required_confirmation || detail?.details?.confirmation || '');
    assert.equal(required, AUTH_CONFIRM, 'Runtime authorization challenge differs from canonical Migration 1052 confirmation');
    return requireSuccess(await requestRaw('/gpt/tools/call', {
      name: 'governed_migration_authorization_bootstrap',
      tool_args: { ...args, confirm: required },
    }), 'migration_1052_authorization_confirmed');
  }

  const previous = String(
    detail?.details?.recorded_checksum_sha256 ||
    detail?.details?.current_checksum_sha256 ||
    ''
  ).toLowerCase();
  assert.equal(String(detail?.code), 'governed_migration_authorization_previous_checksum_required');
  assert.match(previous, /^[0-9a-f]{64}$/);
  assert.notEqual(previous, checksum);
  return requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: { ...args, previous_checksum_sha256: previous },
  }), 'migration_1052_authorization_rotation');
}
async function durableAuthorizationReadback() {
  const payload = requireSuccess(await requestRaw('/admin/control', buildAdminControlDbReadRequest({
    sql: `SELECT migration_file, authorization_status, authorization_source, policy_key, requires_preflight, requires_confirmation, allow_record_only, allow_apply, metadata_json
          FROM governed_migration_authorization_registry WHERE migration_file=? LIMIT 2`,
    params: [MIGRATION],
    maxRows: 2,
    authorityContext: {
      resource_type: 'database_metadata',
      resource_uri: RESOURCE,
      operation_mode: 'governed_migration_authorization_readback',
      required: true,
    },
  }), 120000), 'migration_1052_authorization_readback');

  const rows = findObject(payload, (candidate) => Array.isArray(candidate.rows))?.rows || [];
  assert.equal(rows.length, 1, 'Migration 1052 requires exactly one durable authorization row');
  const row = rows[0];
  assert.equal(row.authorization_status, 'authorized');
  assert.equal(Number(row.requires_preflight || 0), 1);
  assert.equal(Number(row.requires_confirmation || 0), 1);
  assert.equal(Number(row.allow_apply || 0), 1);

  const metadata = parsed(row.metadata_json) || {};
  assert.equal(String(metadata.migration_checksum_sha256 || '').toLowerCase(), checksum);
  assert.equal(Number(metadata.expected_statement_count || 0), statementCount);
  assert.equal(Number(metadata.pull_request || 0), SOURCE_PR);
  assert.equal(String(metadata.merge_sha || '').toLowerCase(), SOURCE_MERGE_SHA);
  assert.equal(metadata.secrets_included, false);

  return {
    authorization_status: row.authorization_status,
    policy_key: row.policy_key,
    migration_checksum_sha256: checksum,
    expected_statement_count: statementCount,
    pull_request: SOURCE_PR,
    merge_sha: SOURCE_MERGE_SHA,
    secrets_included: false,
  };
}
async function dryRun() {
  const payload = requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_execute',
    tool_args: {
      migration: MIGRATION,
      mode: 'dry_run',
      expected_checksum_sha256: checksum,
      expected_statement_count: statementCount,
    },
  }), 'migration_1052_dry_run');

  const result = keyed(payload, 'applies_sql') || payload;
  assert.equal(result?.applies_sql, false);
  assert.equal(result?.mode, 'dry_run');
  assert.equal(String(result?.migration_checksum_sha256 || '').toLowerCase(), checksum);
  assert.equal(Number(result?.statement_count), statementCount);
  assert.equal(Number(result?.preflight_risk_count || 0), 0);
  return result;
}

try {
  assert.ok(KEY, 'BACKEND_API_KEY is required');
  assert.ok(GH, 'GH_READ_TOKEN is required');

  await writeState();

  stage = 'source_and_migration_identity';
  const identity = await verifySourceAndMigration();
  await writeJson('identity.json', identity);

  stage = 'runtime_parity';
  const parity = await verifyRuntimeParity();
  await writeJson('runtime-parity.json', parity);

  stage = 'production_ref_repin';
  const productionRepin = await repinProductionAfterRuntimeParity();
  await writeJson('production-ref-repin.json', productionRepin);

  stage = 'authorization_envelope';
  const envelope = await createBootstrapEnvelope();
  await writeJson('authorization-envelope.json', envelope);

  stage = 'authorization_bootstrap';
  const authorization = await bootstrapAuthorization();
  await writeJson('authorization-bootstrap.json', authorization);

  stage = 'authorization_readback';
  const authorizationReadback = await durableAuthorizationReadback();
  await writeJson('authorization-readback.json', authorizationReadback);

  stage = 'dry_run';
  const dryRunResult = await dryRun();
  await writeJson('dry-run.json', dryRunResult);

  stage = 'complete';
  await writeState({
    result: 'pass',
    authorization_bootstrap_completed: true,
    authorization_readback_verified: true,
    dry_run_completed: true,
    dry_run_applies_sql: false,
  });
} catch (error) {
  await writeJson('failure.json', {
    result: 'fail',
    stage,
    code: String(error?.code || error?.name || 'migration_1052_readiness_failed'),
    message: String(error?.message || error),
    details: error?.details || null,
    migration_apply_performed: false,
    managed_execution_run_created: false,
    runtime_dispatch_certification_issued: false,
    provider_call_executed: false,
    external_write_executed: false,
    credential_payload_accessed: false,
    secrets_included: false,
  });
  await writeState({ result: 'fail' });
  throw error;
}
