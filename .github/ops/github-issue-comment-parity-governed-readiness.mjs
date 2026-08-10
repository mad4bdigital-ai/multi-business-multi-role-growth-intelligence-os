import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';

const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH = String(process.env.GH_READ_TOKEN || '').trim();
const REPO = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const ISSUE = Number(process.env.CONTROL_ISSUE || 4451);
const SOURCE_PR = 6814;
const SOURCE_MERGE_SHA = 'fd5ce7a5c0be75ee4b10167f04c1baf51f6c39d8';
const EXPECTED_PRODUCTION_SHA = '2a83e9593b2030a5e6f69d13984b6b0155ed45cd';
const MIGRATION = '20260810_github_issue_comment_exact_response_parity.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const MIGRATION_BLOB_SHA = '70dbabefe6d9fabd96cec1783b3bc0610f24c61d';
const EXPECTED_CHECKSUM_SHA256 = 'a2322903e061c7084370aa32f8426082f10fecd58679d4743122fbe43a2d9c42';
const EXPECTED_STATEMENT_COUNT = 5;
const AUTH_CONFIRM = 'AUTHORIZE_GOVERNED_MIGRATION_20260810_GITHUB_ISSUE_COMMENT_EXACT_RESPONSE_PARITY';
const TENANT = '00000000-0000-0000-0000-000000000000';
const ADMIN = '00000000-0000-4000-a000-000000000002';
const RESOURCE = `db-migration://growth_intelligence_platform/${MIGRATION}`;
const DIR = String(process.env.EVIDENCE_DIR || `${process.env.RUNNER_TEMP || '/tmp'}/github-issue-comment-parity-readiness`).trim();

let stage = 'start';
let envelopeId = null;

const sensitiveKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;
const SAFE_EVIDENCE_KEYS = new Set(['authorization_status', 'authorization_bootstrap', 'provider_call_executed', 'credential_payload_accessed', 'secrets_included']);

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function gitBlobSha(bytes) {
  return createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`, 'utf8')).update(bytes).digest('hex');
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
    contract: 'github_issue_comment_exact_response_parity_migration_readiness.v1',
    stage,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: EXPECTED_CHECKSUM_SHA256,
    statement_count: EXPECTED_STATEMENT_COUNT,
    source_pr: SOURCE_PR,
    source_merge_sha: SOURCE_MERGE_SHA,
    expected_production_sha: EXPECTED_PRODUCTION_SHA,
    capability_envelope_id: envelopeId,
    migration_apply_performed: false,
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
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${GH}`, 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json();
  assert.ok(response.ok, `GitHub read failed HTTP ${response.status}: ${pathname}`);
  return payload;
}
async function requestGet(pathname, timeoutMs = 30000) {
  const response = await fetch(`${BASE}${pathname}`, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
  return { status: response.status, http_ok: response.ok, payload };
}
async function requestRaw(pathname, body, timeoutMs = 180000) {
  try {
    const response = await fetch(`${BASE}${pathname}`, {
      method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
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
    tool: 'shell', action: 'run', alias, extra_args: extraArgs,
    authority_context: { resource_type: 'shell_alias', resource_uri: `shell://${alias}`, operation_mode: alias, required: true },
  }), label);
}
function envelopeBindingSha() {
  return sha256(JSON.stringify({
    schema_version: 'governed_migration_envelope_binding.v1',
    app_key: 'platform_orchestration', capability_key: 'governed_migration_authorization_bootstrap',
    operation_intent: 'governed_migration_authorization_bootstrap', resource_uri: RESOURCE,
    migration_file: MIGRATION, migration_checksum_sha256: EXPECTED_CHECKSUM_SHA256,
    statement_count: EXPECTED_STATEMENT_COUNT, production_sha: EXPECTED_PRODUCTION_SHA,
  }));
}
async function verifySourceAndMigration() {
  assert.equal(ISSUE, 4451);
  const issue = await githubJson(`/repos/${REPO}/issues/${ISSUE}`);
  assert.equal(issue.state, 'open', '#4451 must remain open during readiness');
  const sourcePr = await githubJson(`/repos/${REPO}/pulls/${SOURCE_PR}`);
  assert.ok(sourcePr.merged_at, `Source PR #${SOURCE_PR} is not merged`);
  assert.equal(String(sourcePr.merge_commit_sha || '').toLowerCase(), SOURCE_MERGE_SHA);
  const production = await githubJson(`/repos/${REPO}/git/ref/heads/Production`);
  assert.equal(String(production?.object?.sha || '').toLowerCase(), EXPECTED_PRODUCTION_SHA);
  const bytes = await fs.readFile(MIGRATION_PATH);
  assert.equal(gitBlobSha(bytes), MIGRATION_BLOB_SHA, 'Migration blob identity changed');
  assert.equal(sha256(bytes), EXPECTED_CHECKSUM_SHA256, 'Migration SHA-256 changed');
  assert.equal(splitMigrationSqlStatements(bytes.toString('utf8')).length, EXPECTED_STATEMENT_COUNT, 'Migration statement count changed');
}
async function verifyRuntimeParity() {
  const [health, version, deployment, connector] = await Promise.all([
    requestGet('/health'), requestGet('/version'), requestGet('/deployment-info'), requestGet('/connector-agent/version'),
  ]);
  for (const [label, result] of Object.entries({ health, version, deployment, connector })) assert.equal(result.status, 200, `${label} must return HTTP 200`);
  assert.equal(health.payload?.ok, true, 'Production health must be healthy');
  assert.ok(collectShas(version.payload).has(EXPECTED_PRODUCTION_SHA), '/version does not contain exact Production SHA');
  const manifest = deployment.payload?.deployment && typeof deployment.payload.deployment === 'object' ? deployment.payload.deployment : {};
  const runtimeSha = String(deployment.payload?.commit_sha || deployment.payload?.commit || manifest?.commit_sha || manifest?.commit || '').toLowerCase();
  const runtimeBranch = String(deployment.payload?.branch || manifest?.branch || '');
  assert.equal(runtimeSha, EXPECTED_PRODUCTION_SHA, 'Runtime deployment SHA differs from Production');
  assert.equal(runtimeBranch, 'Production', 'Runtime deployment branch differs from Production');
}
async function repinProduction() {
  stage = 'production_ref_repin';
  const production = await githubJson(`/repos/${REPO}/git/ref/heads/Production`);
  assert.equal(String(production?.object?.sha || '').toLowerCase(), EXPECTED_PRODUCTION_SHA, 'Production ref moved after runtime parity and before authorization mutation');
}
async function createBootstrapEnvelope() {
  const created = await adminShell('capability_resolution_envelope_create', [
    `--tenant-id=${TENANT}`, `--user-id=${ADMIN}`, '--user-role=Admin', '--app-key=platform_orchestration',
    '--capability-key=governed_migration_authorization_bootstrap', '--operation-intent=governed_migration_authorization_bootstrap',
    '--runtime-surface=auth_host', '--requested-source-tier=platform_managed_fallback',
    '--requested-by=github_actions_github_issue_comment_parity_readiness', '--ttl-minutes=45', '--explain',
    `--resource-uri=${RESOURCE}`, `--expected-commit-sha=${EXPECTED_PRODUCTION_SHA}`, `--binding-sha256=${envelopeBindingSha()}`,
  ], 'issue_comment_parity_envelope_create');
  let envelope = keyed(created, 'envelope_id');
  assert.ok(envelope?.envelope_id, 'Capability envelope creation returned no envelope_id');
  assert.equal(Number(envelope.blocking_gap_count || 0), 0, 'Capability envelope has blocking gaps');
  if (envelope.approval_required === true || envelope.envelope_status === 'ready_requires_approval') {
    const approved = await adminShell('capability_resolution_envelope_approve', [
      `--envelope-id=${envelope.envelope_id}`, '--approved-by=github_actions',
      '--decision-note=Approve checksum-bound GitHub issue-comment parity migration authorization bootstrap and dry-run readiness only. No Migration Apply, provider call, external write, or protected-ref mutation.',
      '--ttl-minutes=45',
    ], 'issue_comment_parity_envelope_approve');
    envelope = { ...envelope, ...(keyed(approved, 'envelope_id') || {}), approval_required: false, dispatch_allowed: true };
  }
  assert.equal(envelope.envelope_status, 'ready_for_dispatch');
  assert.equal(envelope.dispatch_allowed, true);
  envelopeId = envelope.envelope_id;
}
async function bootstrapAuthorization() {
  const payload = requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: {
      migration: MIGRATION,
      expected_checksum_sha256: EXPECTED_CHECKSUM_SHA256,
      expected_statement_count: EXPECTED_STATEMENT_COUNT,
      pull_request: SOURCE_PR,
      merge_sha: SOURCE_MERGE_SHA,
      confirm: AUTH_CONFIRM,
      capability_envelope_id: envelopeId,
    },
  }), 'issue_comment_parity_authorization_bootstrap');
  const auth = keyed(payload, 'authorization_status') || keyed(payload, 'migration_checksum_sha256');
  assert.ok(auth, 'Authorization bootstrap returned no same-cycle authorization evidence');
  return payload;
}
async function dryRun() {
  const payload = requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_execute',
    tool_args: {
      migration: MIGRATION, mode: 'dry_run', expected_checksum_sha256: EXPECTED_CHECKSUM_SHA256,
      expected_statement_count: EXPECTED_STATEMENT_COUNT,
    },
  }), 'issue_comment_parity_dry_run');
  const result = findObject(payload, (candidate) => candidate.mode === 'dry_run' && candidate.applies_sql === false);
  assert.ok(result, 'Dry-run must return mode=dry_run and applies_sql=false');
  assert.equal(String(result.migration_checksum_sha256 || '').toLowerCase(), EXPECTED_CHECKSUM_SHA256);
  assert.equal(Number(result.statement_count ?? result.statements_executed), EXPECTED_STATEMENT_COUNT);
  return result;
}

try {
  assert.ok(KEY, 'BACKEND_API_KEY is required');
  assert.ok(GH, 'GH_READ_TOKEN is required');
  stage = 'source_and_migration_identity'; await verifySourceAndMigration(); await writeState();
  stage = 'runtime_parity'; await verifyRuntimeParity(); await writeState();
  await repinProduction(); await writeState();
  stage = 'authorization_envelope'; await createBootstrapEnvelope(); await writeState();
  stage = 'authorization_bootstrap'; const authorization = await bootstrapAuthorization(); await writeState({ authorization_bootstrap: true });
  stage = 'dry_run'; const dryRunResult = await dryRun();
  stage = 'complete';
  await writeJson('summary.json', {
    result: 'pass', stage, migration: MIGRATION, source_pr: SOURCE_PR, source_merge_sha: SOURCE_MERGE_SHA,
    production_sha: EXPECTED_PRODUCTION_SHA, migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: EXPECTED_CHECKSUM_SHA256, statement_count: EXPECTED_STATEMENT_COUNT,
    authorization_bootstrap: true, authorization_readback_present: Boolean(authorization), dry_run: 'pass',
    dry_run_applies_sql: dryRunResult.applies_sql, migration_apply_performed: false,
    provider_call_executed: false, external_write_executed: false, credential_payload_accessed: false,
    protected_ref_mutation_executed: false, force_push_executed: false, secrets_included: false,
  });
  await writeState({ authorization_bootstrap: true, dry_run: 'pass' });
} catch (error) {
  await writeJson('failure.json', {
    result: 'fail', stage, migration: MIGRATION, expected_production_sha: EXPECTED_PRODUCTION_SHA,
    error: { code: error?.code || 'readiness_failed', message: String(error?.message || error) },
    capability_envelope_id: envelopeId, migration_apply_performed: false, provider_call_executed: false,
    external_write_executed: false, credential_payload_accessed: false, protected_ref_mutation_executed: false,
    force_push_executed: false, secrets_included: false,
  });
  throw error;
}
