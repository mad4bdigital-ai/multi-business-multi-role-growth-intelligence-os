import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';
import { buildAdminControlDbReadRequest } from './lib/admin-control-db-request.mjs';

const PHASE = String(process.env.ROLLOUT_PHASE || '').trim();
const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH = String(process.env.GH_READ_TOKEN || '').trim();
const REPO = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const ISSUE = Number(process.env.CONTROL_ISSUE || 6612);
const DIR = String(process.env.EVIDENCE_DIR || `${process.env.RUNNER_TEMP || '/tmp'}/github-repository-policy-1049`).trim();

const MIGRATION = '1049_github_repository_policy_single_owner_mode.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const MIGRATION_BLOB_SHA = '55f9996b736debf072d1a54c2f19adf7fcd8c704';
const EXPECTED_STATEMENT_COUNT = 4;
const SOURCE_PR = 6550;
const SOURCE_MERGE_SHA = 'f3f98374a8207c6106aea8a6a334e38101defed1';
const CONFIRMATION_KEY = MIGRATION.replace(/\.sql$/i, '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
const AUTH_CONFIRM = `AUTHORIZE_GOVERNED_MIGRATION_${CONFIRMATION_KEY}`;
const APPLY_CONFIRM = `APPLY_${CONFIRMATION_KEY}`;
const VERIFY_CONFIRM = `VERIFY_GOVERNED_MIGRATION_${CONFIRMATION_KEY}`;
const READY_PREFIX = 'GITHUB_REPOSITORY_POLICY_1049_READINESS result=pass ';
const TENANT = '00000000-0000-0000-0000-000000000000';
const ADMIN = '00000000-0000-4000-a000-000000000002';
const APPLY_POLICY = 'governed_migration_execute_apply_v1';
const RESOURCE = `db-migration://growth_intelligence_platform/${MIGRATION}`;
const READBACK_SQL = `SELECT
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(policy_value,'$.review_policy_mode')) FROM execution_policies WHERE policy_group='Repository Automation Governance' AND policy_key='github_repository_policy_controller_v1' LIMIT 1) AS review_policy_mode,
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(policy_value,'$.single_owner_gate_check')) FROM execution_policies WHERE policy_group='Repository Automation Governance' AND policy_key='github_repository_policy_controller_v1' LIMIT 1) AS single_owner_gate_check,
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(input_schema,'$.properties.single_owner_mode.type')) FROM admin_platform_endpoint_tools WHERE tool_key='github_repository_policy_controller' LIMIT 1) AS single_owner_input_type,
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.review_policy_mode')) FROM platform_plugin_capabilities WHERE capability_key='repository_policy_controller' LIMIT 1) AS capability_review_policy_mode,
  (SELECT authorization_status FROM governed_migration_authorization_registry WHERE migration_file='1049_github_repository_policy_single_owner_mode.sql' LIMIT 1) AS authorization_status,
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.live_github_policy_apply')) FROM governed_migration_authorization_registry WHERE migration_file='1049_github_repository_policy_single_owner_mode.sql' LIMIT 1) AS live_github_policy_apply;`;

let stage = 'start';
let checksum = null;
let statementCount = null;
let productionSha = null;
let applySent = false;
let applyResponse = null;
let exactLedgerVerified = false;
let metadataReadbackVerified = false;

const redactKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;
const sha256 = (value) => createHash('sha256').update(String(value || ''), 'utf8').digest('hex');

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactKey.test(key) ? '[redacted]' : sanitize(child)]));
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
  if (typeof value === 'string') for (const match of value.matchAll(/\b[0-9a-f]{40}\b/ig)) output.add(match[0].toLowerCase());
  else if (Array.isArray(value)) for (const child of value) collectShas(child, output);
  else if (value && typeof value === 'object') for (const child of Object.values(value)) collectShas(child, output);
  return output;
}

async function writeJson(name, value) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(`${DIR}/${name}`, `${JSON.stringify(sanitize(value), null, 2)}\n`, 'utf8');
}

async function writeState(extra = {}) {
  await writeJson('state.json', {
    contract: 'github_repository_policy_1049_governed_rollout.v1', phase: PHASE, stage,
    migration: MIGRATION, migration_blob_sha: MIGRATION_BLOB_SHA, migration_checksum_sha256: checksum,
    statement_count: statementCount, source_pr: SOURCE_PR, source_merge_sha: SOURCE_MERGE_SHA,
    production_sha: productionSha, apply_sent: applySent, apply_retried: false,
    apply_transport_ok: applyResponse?.transport_ok ?? null, apply_http_status: applyResponse?.status ?? null,
    exact_apply_ledger_verified: exactLedgerVerified, metadata_readback_verified: metadataReadbackVerified,
    live_github_policy_apply_performed: false, provider_call_executed: false,
    credential_payload_accessed: false, external_send_executed: false, secrets_included: false, ...extra,
  });
}

async function githubJson(pathname) {
  const response = await fetch(`https://api.github.com${pathname}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${GH}`, 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000) });
  const payload = await response.json();
  assert.ok(response.ok, `GitHub read failed HTTP ${response.status}: ${pathname}`);
  return payload;
}

async function requestGet(url, timeoutMs = 20000) {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let payload; try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  } catch (error) { return { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: String(error?.name || 'Error') }; }
}

async function requestRaw(pathname, body, timeoutMs = 300000) {
  try {
    const response = await fetch(`${BASE}${pathname}`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let payload; try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  } catch (error) { return { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: String(error?.name || 'Error') }; }
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
  return requireSuccess(await requestRaw('/admin/control', { tool: 'shell', action: 'run', alias, extra_args: extraArgs, authority_context: { resource_type: 'shell_alias', resource_uri: `shell://${alias}`, operation_mode: alias, required: true } }), label);
}

function envelopeBindingSha(capabilityKey, operationIntent) {
  return sha256(JSON.stringify({ schema_version: 'governed_migration_envelope_binding.v1', app_key: 'platform_orchestration', capability_key: capabilityKey, operation_intent: operationIntent, resource_uri: RESOURCE, migration_file: MIGRATION, migration_checksum_sha256: checksum, statement_count: statementCount, production_sha: productionSha }));
}

async function createEnvelope(capabilityKey, operationIntent, requestedBy, note, authorizeApply = false) {
  const created = await adminShell('capability_resolution_envelope_create', [
    `--tenant-id=${TENANT}`, `--user-id=${ADMIN}`, '--user-role=Admin', '--app-key=platform_orchestration',
    `--capability-key=${capabilityKey}`, `--operation-intent=${operationIntent}`, '--runtime-surface=auth_host',
    '--requested-source-tier=platform_managed_fallback', `--requested-by=${requestedBy}`, '--ttl-minutes=45', '--explain',
    `--resource-uri=${RESOURCE}`, `--expected-commit-sha=${productionSha}`, `--binding-sha256=${envelopeBindingSha(capabilityKey, operationIntent)}`,
  ], `${capabilityKey}_envelope_create`);
  let envelope = keyed(created, 'envelope_id');
  assert.ok(envelope?.envelope_id, 'Capability envelope creation returned no envelope_id');
  assert.equal(Number(envelope.blocking_gap_count || 0), 0, 'Capability envelope has blocking gaps');
  if (envelope.approval_required === true || envelope.envelope_status === 'ready_requires_approval') {
    const approved = await adminShell('capability_resolution_envelope_approve', [`--envelope-id=${envelope.envelope_id}`, '--approved-by=github_actions', `--decision-note=${note}`, '--ttl-minutes=45'], `${capabilityKey}_envelope_approve`);
    envelope = { ...envelope, ...(keyed(approved, 'envelope_id') || {}), approval_required: false, dispatch_allowed: true };
  }
  assert.equal(envelope.envelope_status, 'ready_for_dispatch');
  assert.equal(envelope.dispatch_allowed, true);
  if (authorizeApply) {
    const auth = requireSuccess(await requestRaw('/gpt/tools/call', { name: 'capability_resolution_envelope_apply_authorize', tool_args: { envelope_id: envelope.envelope_id, authorized_by: 'github_actions', decision_note: note, ttl_minutes: 45 } }), 'capability_resolution_envelope_apply_authorize');
    const row = keyed(auth, 'apply_allowed');
    assert.equal(row?.apply_allowed, true); assert.equal(row?.policy_key, APPLY_POLICY); assert.equal(row?.external_write_allowed, false);
  }
  return envelope.envelope_id;
}

async function verifyProductionMigration() {
  const ref = await githubJson(`/repos/${REPO}/git/ref/heads/Production`);
  productionSha = String(ref?.object?.sha || '').toLowerCase();
  assert.match(productionSha, /^[0-9a-f]{40}$/);
  const file = await githubJson(`/repos/${REPO}/contents/${MIGRATION_PATH}?ref=${productionSha}`);
  assert.equal(String(file?.sha || '').toLowerCase(), MIGRATION_BLOB_SHA, 'Production Migration 1049 blob mismatch');
  const sql = Buffer.from(String(file.content || '').replace(/\s+/g, ''), 'base64').toString('utf8');
  checksum = sha256(sql); statementCount = splitMigrationSqlStatements(sql).length;
  assert.equal(statementCount, EXPECTED_STATEMENT_COUNT, 'Migration 1049 statement count changed');
  const compare = await githubJson(`/repos/${REPO}/compare/${SOURCE_MERGE_SHA}...${productionSha}`);
  assert.ok(['ahead', 'identical'].includes(compare.status), `Production does not contain source merge ${SOURCE_MERGE_SHA}`);
  return { production_sha: productionSha, migration_blob_sha: MIGRATION_BLOB_SHA, checksum, statement_count: statementCount, source_merge_status: compare.status, secrets_included: false };
}

async function verifyRuntimeParity() {
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const [health, version, deployment] = await Promise.all([requestGet(`${BASE}/health`), requestGet(`${BASE}/version`), requestGet(`${BASE}/deployment-info`)]);
    if (health.http_ok && health.payload?.ok === true && version.http_ok && collectShas(version.payload).has(productionSha) && deployment.http_ok && collectShas(deployment.payload).has(productionSha)) {
      const current = await githubJson(`/repos/${REPO}/git/ref/heads/Production`);
      assert.equal(String(current?.object?.sha || '').toLowerCase(), productionSha, 'Production moved during runtime parity');
      return { production_sha: productionSha, attempt, health: 'pass', version: 'pass', deployment: 'pass' };
    }
    if (attempt < 24) await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  throw new Error('Runtime did not converge to exact Production SHA within bounded window');
}

async function dryRun() {
  const payload = requireSuccess(await requestRaw('/gpt/tools/call', { name: 'governed_migration_execute', tool_args: { migration: MIGRATION, mode: 'dry_run', expected_checksum_sha256: checksum, expected_statement_count: statementCount } }), 'migration_1049_dry_run');
  const result = keyed(payload, 'applies_sql') || payload;
  assert.equal(result?.applies_sql, false); assert.equal(result?.mode, 'dry_run'); assert.equal(Number(result?.preflight_risk_count || 0), 0);
  return result;
}

async function bootstrapAuthorization(envelopeId) {
  const args = { migration: MIGRATION, expected_checksum_sha256: checksum, expected_statement_count: statementCount, pull_request: SOURCE_PR, merge_sha: SOURCE_MERGE_SHA, confirm: AUTH_CONFIRM, capability_envelope_id: envelopeId, decision_note: 'Authorize checksum-bound Migration 1049 readiness only; no SQL executes in readiness and no GitHub policy is applied.' };
  const first = await requestRaw('/gpt/tools/call', { name: 'governed_migration_authorization_bootstrap', tool_args: args });
  if (first.transport_ok && first.http_ok && first.payload?.ok !== false) return requireSuccess(first, 'migration_1049_authorization_bootstrap');
  const detail = keyed(first.payload, 'code') || first.payload?.error || {};
  if (String(detail?.code) === 'governed_migration_authorization_confirmation_required') {
    const required = String(detail?.details?.required_confirmation || detail?.details?.confirmation || '');
    assert.equal(required, AUTH_CONFIRM, 'Runtime authorization challenge differs from canonical Migration 1049 confirmation');
    return requireSuccess(await requestRaw('/gpt/tools/call', { name: 'governed_migration_authorization_bootstrap', tool_args: { ...args, confirm: required } }), 'migration_1049_authorization_confirmed');
  }
  const previous = String(detail?.details?.recorded_checksum_sha256 || detail?.details?.current_checksum_sha256 || '').toLowerCase();
  assert.equal(String(detail?.code), 'governed_migration_authorization_previous_checksum_required'); assert.match(previous, /^[0-9a-f]{64}$/); assert.notEqual(previous, checksum);
  return requireSuccess(await requestRaw('/gpt/tools/call', { name: 'governed_migration_authorization_bootstrap', tool_args: { ...args, previous_checksum_sha256: previous } }), 'migration_1049_authorization_rotation');
}

async function migrationReadback() {
  const result = await requestRaw('/gpt/tools/call', { name: 'governed_migration_schema_readback', tool_args: { migration: MIGRATION, expected_checksum_sha256: checksum, expected_statement_count: statementCount, expected_tables: ['execution_policies', 'admin_platform_endpoint_tools', 'platform_plugin_capabilities', 'governed_migration_authorization_registry'] } }, 180000);
  return { result, readback: keyed(result.payload, 'readback_status') };
}

function ledgerPass(readback) {
  const ledger = readback?.ledger;
  return Boolean(readback?.readback_status === 'pass' && ledger?.found === true && ledger?.migration_file === MIGRATION && String(ledger?.migration_checksum_sha256 || '').toLowerCase() === checksum && String(ledger?.mode || '').toLowerCase() === 'apply' && Number(ledger?.statement_count) === statementCount && String(ledger?.preflight_status || '').toLowerCase() === 'pass' && Number(ledger?.preflight_risk_count || 0) === 0);
}

async function metadataReadback() {
  const payload = requireSuccess(await requestRaw('/admin/control', buildAdminControlDbReadRequest({
    sql: READBACK_SQL,
    params: [],
    maxRows: 1,
    authorityContext: {
      resource_type: 'database_metadata',
      resource_uri: 'db-metadata://growth_intelligence_platform/github_repository_policy_single_owner_mode',
      operation_mode: 'read_only_readiness_probe',
      required: true,
    },
  }), 120000), 'github_repository_policy_1049_readback');
  const row = findObject(payload, (candidate) => Array.isArray(candidate.rows))?.rows?.[0];
  assert.equal(row?.review_policy_mode, 'auto_single_owner_or_independent');
  assert.equal(row?.single_owner_gate_check, 'Single Owner Review Gate');
  assert.equal(row?.single_owner_input_type, 'boolean');
  assert.equal(row?.capability_review_policy_mode, 'auto_single_owner_or_independent');
  assert.equal(row?.authorization_status, 'authorized');
  assert.ok(['0', 'false'].includes(String(row?.live_github_policy_apply).toLowerCase()));
  metadataReadbackVerified = true;
  return row;
}

async function requireReadyComment() {
  const comments = await githubJson(`/repos/${REPO}/issues/${ISSUE}/comments?per_page=100`);
  const expected = `${READY_PREFIX}production_sha=${productionSha} migration_blob=${MIGRATION_BLOB_SHA} checksum=${checksum} statement_count=${statementCount} source_merge=${SOURCE_MERGE_SHA}`;
  assert.ok(comments.some((comment) => String(comment?.body || '').trim() === expected), 'Exact checksum-bound Migration 1049 readiness marker is missing');
  return expected;
}

async function reconcileAfterApply() {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const { result, readback } = await migrationReadback();
    await writeJson(`post-apply-readback-${attempt}.json`, result);
    if (result.transport_ok && ledgerPass(readback)) {
      exactLedgerVerified = true;
      const metadata = await metadataReadback();
      return { attempt, readback, metadata };
    }
    if (attempt < 8) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('Exact Migration 1049 apply ledger was not proven; Apply was not retried');
}

async function readiness() {
  stage = 'production_identity'; const identity = await verifyProductionMigration(); await writeJson('production-identity.json', identity);
  stage = 'runtime_parity'; await writeJson('runtime-parity.json', await verifyRuntimeParity());
  const existing = await migrationReadback(); await writeJson('pre-readback.json', existing.result);
  if (existing.result.transport_ok && ledgerPass(existing.readback)) {
    exactLedgerVerified = true; await metadataReadback();
    const summary = { result: 'already_applied', ...identity, checksum, statement_count: statementCount, exact_apply_ledger_verified: true, metadata_readback_verified: true, secrets_included: false };
    await writeJson('summary.json', summary); return;
  }
  stage = 'authorization_envelope';
  const envelopeId = await createEnvelope('governed_migration_authorization_bootstrap', 'governed_migration_authorization_bootstrap', 'github_actions_repository_policy_1049_readiness', 'Approve checksum-bound Migration 1049 readiness authorization only.');
  stage = 'authorization_bootstrap'; await bootstrapAuthorization(envelopeId);
  stage = 'dry_run'; await dryRun();
  const summary = { result: 'ready_for_apply', ...identity, checksum, statement_count: statementCount, authorization: 'pass', dry_run: 'pass', apply_sent_by_this_run: false, secrets_included: false };
  await writeJson('summary.json', summary);
}

async function apply() {
  stage = 'production_identity'; const identity = await verifyProductionMigration(); await writeJson('production-identity.json', identity);
  stage = 'runtime_parity'; await writeJson('runtime-parity.json', await verifyRuntimeParity());
  const existing = await migrationReadback();
  if (existing.result.transport_ok && ledgerPass(existing.readback)) {
    exactLedgerVerified = true; const metadata = await metadataReadback();
    await writeJson('summary.json', { result: 'already_applied', ...identity, checksum, statement_count: statementCount, exact_apply_ledger_verified: true, metadata_readback_verified: true, metadata, apply_sent_by_this_run: false, apply_retried: false, secrets_included: false }); return;
  }
  stage = 'readiness_marker'; await requireReadyComment();
  stage = 'same_cycle_dry_run'; await dryRun();
  stage = 'execution_envelope';
  const envelopeId = await createEnvelope('governed_migration_execute', 'governed_migration_execute', 'github_actions_repository_policy_1049_apply', 'Authorize exactly one checksum-bound Migration 1049 Apply invocation.', true);
  stage = 'apply_once'; applySent = true; await writeState();
  applyResponse = await requestRaw('/gpt/tools/call', { name: 'governed_migration_execute', tool_args: { migration: MIGRATION, mode: 'apply', confirm: APPLY_CONFIRM, expected_checksum_sha256: checksum, expected_statement_count: statementCount, capability_envelope_id: envelopeId } });
  await writeJson('apply-response.json', applyResponse);
  stage = 'post_apply_reconciliation'; const reconciled = await reconcileAfterApply();
  await writeJson('summary.json', { result: 'applied_and_verified', ...identity, checksum, statement_count: statementCount, apply_sent_by_this_run: true, apply_transport_ok: applyResponse.transport_ok, apply_http_status: applyResponse.status, apply_retried: false, exact_apply_ledger_verified: exactLedgerVerified, metadata_readback_verified: metadataReadbackVerified, metadata: reconciled.metadata, live_github_policy_apply_performed: false, secrets_included: false });
}

async function verify() {
  stage = 'production_identity'; const identity = await verifyProductionMigration(); await writeJson('production-identity.json', identity);
  stage = 'runtime_parity'; await writeJson('runtime-parity.json', await verifyRuntimeParity());
  stage = 'ledger_readback'; const { result, readback } = await migrationReadback(); await writeJson('verification-readback.json', result);
  assert.ok(result.transport_ok && ledgerPass(readback), 'Exact Migration 1049 apply ledger is not proven'); exactLedgerVerified = true;
  stage = 'metadata_readback'; const metadata = await metadataReadback();
  await writeJson('summary.json', { result: 'verified', ...identity, checksum, statement_count: statementCount, exact_apply_ledger_verified: true, metadata_readback_verified: true, metadata, apply_sent_by_this_run: false, apply_retried: false, live_github_policy_apply_performed: false, secrets_included: false });
}

try {
  assert.ok(['readiness', 'apply', 'verify'].includes(PHASE), 'ROLLOUT_PHASE must be readiness, apply, or verify');
  assert.ok(KEY, 'BACKEND_API_KEY is required'); assert.ok(GH, 'GH_READ_TOKEN is required');
  await writeState();
  if (PHASE === 'readiness') await readiness(); else if (PHASE === 'apply') await apply(); else await verify();
} catch (error) {
  await writeJson('failure.json', { result: 'fail', phase: PHASE, stage, production_sha: productionSha, migration: MIGRATION, migration_blob_sha: MIGRATION_BLOB_SHA, checksum, statement_count: statementCount, apply_sent: applySent, apply_retried: false, exact_apply_ledger_verified: exactLedgerVerified, metadata_readback_verified: metadataReadbackVerified, live_github_policy_apply_performed: false, error: { name: error?.name || 'Error', code: error?.code || 'rollout_failed', message: error?.message || String(error), details: error?.details || null }, secrets_included: false });
  await writeState({ failed: true }); throw error;
}
