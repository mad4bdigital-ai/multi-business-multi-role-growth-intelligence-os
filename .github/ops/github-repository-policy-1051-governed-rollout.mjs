import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';
import { buildAdminControlDbReadRequest } from './lib/admin-control-db-request.mjs';

const PHASE = String(process.env.ROLLOUT_PHASE || '').trim();
const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH = String(process.env.GH_READ_TOKEN || '').trim();
const REPO = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const ISSUE = Number(process.env.CONTROL_ISSUE || 6625);
const SOURCE_PR = Number(process.env.SOURCE_PR || 0);
const DIR = String(process.env.EVIDENCE_DIR || `${process.env.RUNNER_TEMP || '/tmp'}/github-repository-policy-1051`).trim();

export const MIGRATION = '1051_github_repository_policy_live_apply_authority.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
export const MIGRATION_BLOB_SHA = 'a705b4425c962b65efae3f92a7e9ef20706e0841';
export const EXPECTED_STATEMENT_COUNT = 6;
const CONFIRMATION_KEY = MIGRATION.replace(/\.sql$/i, '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
const AUTH_CONFIRM = `AUTHORIZE_GOVERNED_MIGRATION_${CONFIRMATION_KEY}`;
const APPLY_CONFIRM = `APPLY_${CONFIRMATION_KEY}`;
const VERIFY_CONFIRM = `VERIFY_GOVERNED_MIGRATION_${CONFIRMATION_KEY}`;
export const RECORD_CONFIRM = 'RECORD_1051_GITHUB_REPOSITORY_POLICY_LIVE_APPLY_AUTHORITY';
export const RECONCILE_CONFIRM = 'RECONCILE_1051_GITHUB_REPOSITORY_POLICY_RECORD_ONLY_LEDGER';
export const RECONCILED_APPLY_CONFIRM = 'APPLY_1051_GITHUB_REPOSITORY_POLICY_AFTER_RECORD_ONLY_RECONCILIATION';
const TENANT = '00000000-0000-0000-0000-000000000000';
const ADMIN = '00000000-0000-4000-a000-000000000002';
const APPLY_POLICY = 'governed_migration_execute_apply_v1';
const RESOURCE = `db-migration://growth_intelligence_platform/${MIGRATION}`;
const EXPECTED_TABLES = Object.freeze([
  'platform_resource_adapters',
  'platform_capability_readback_contracts',
  'capability_apply_authorization_policy_registry',
  'repository_capability_bindings',
  'repository_capability_policy_layers',
  'governed_migration_authorization_registry',
]);
const READBACK_SQL = `SELECT
  (SELECT status FROM platform_resource_adapters WHERE adapter_key='github_repository_policy_v2' LIMIT 1) AS adapter_status,
  (SELECT status FROM platform_capability_readback_contracts WHERE contract_key='github_repository_policy_controller_readback_v2' AND is_current=1 LIMIT 1) AS readback_status,
  (SELECT status FROM capability_apply_authorization_policy_registry WHERE policy_key='github_repository_policy_controller_apply_v1' LIMIT 1) AS apply_policy_status,
  (SELECT runtime_surface FROM capability_apply_authorization_policy_registry WHERE policy_key='github_repository_policy_controller_apply_v1' LIMIT 1) AS apply_runtime_surface,
  (SELECT allow_external_write FROM capability_apply_authorization_policy_registry WHERE policy_key='github_repository_policy_controller_apply_v1' LIMIT 1) AS allow_external_write,
  (SELECT requires_typed_confirmation FROM capability_apply_authorization_policy_registry WHERE policy_key='github_repository_policy_controller_apply_v1' LIMIT 1) AS requires_typed_confirmation,
  (SELECT requires_same_cycle_dry_run FROM capability_apply_authorization_policy_registry WHERE policy_key='github_repository_policy_controller_apply_v1' LIMIT 1) AS requires_same_cycle_dry_run,
  (SELECT readiness_status FROM v_repository_capability_binding_readiness WHERE capability_binding_key='growth_intelligence_platform.github.repository_policy_controller.production' LIMIT 1) AS capability_readiness,
  (SELECT policy_key FROM v_repository_capability_binding_readiness WHERE capability_binding_key='growth_intelligence_platform.github.repository_policy_controller.production' LIMIT 1) AS capability_policy_key,
  (SELECT authorization_status FROM governed_migration_authorization_registry WHERE migration_file='1051_github_repository_policy_live_apply_authority.sql' LIMIT 1) AS authorization_status,
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.live_github_policy_apply')) FROM governed_migration_authorization_registry WHERE migration_file='1051_github_repository_policy_live_apply_authority.sql' LIMIT 1) AS live_github_policy_apply;`;
const READBACK_MISSING_KEYS = Object.freeze(['tables', 'columns', 'indexes', 'rule_conditions']);

let stage = 'start';
let checksum = null;
let statementCount = null;
let productionSha = null;
let sourceMergeSha = null;
let applySent = false;
let applyResponse = null;
let exactLedgerVerified = false;
let metadataReadbackVerified = false;

const sensitiveKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;
const SAFE_EVIDENCE_KEYS = new Set(['authorization_status','apply_authorized','apply_sent','credential_payload_accessed','external_write_executed','live_github_policy_apply','provider_call_executed','secrets_included']);
const sha256 = (value) => createHash('sha256').update(String(value || ''), 'utf8').digest('hex');

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sensitiveKey.test(key) && !SAFE_EVIDENCE_KEYS.has(key) ? '[redacted]' : sanitize(child)]));
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
    contract: 'github_repository_policy_1051_governed_rollout.v1', phase: PHASE, stage,
    migration: MIGRATION, migration_blob_sha: MIGRATION_BLOB_SHA, migration_checksum_sha256: checksum,
    statement_count: statementCount, source_pr: SOURCE_PR || null, source_merge_sha: sourceMergeSha,
    production_sha: productionSha, apply_sent: applySent, apply_retried: false,
    apply_transport_ok: applyResponse?.transport_ok ?? null, apply_http_status: applyResponse?.status ?? null,
    exact_apply_ledger_verified: exactLedgerVerified, metadata_readback_verified: metadataReadbackVerified,
    live_github_policy_apply: false, provider_call_executed: false, external_write_executed: false,
    credential_payload_accessed: false, protected_ref_mutation_executed: false, force_push_executed: false,
    secrets_included: false, ...extra,
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
    const response = await fetch(`${BASE}${pathname}`, { method: 'POST', redirect: 'error', headers: { 'x-api-key': KEY, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
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
async function sourceMerge() {
  assert.ok(Number.isInteger(SOURCE_PR) && SOURCE_PR > 0, 'SOURCE_PR must identify the merged source PR');
  const pr = await githubJson(`/repos/${REPO}/pulls/${SOURCE_PR}`);
  assert.ok(pr?.merged_at, `Source PR #${SOURCE_PR} is not merged`);
  const sha = String(pr?.merge_commit_sha || '').toLowerCase();
  assert.match(sha, /^[0-9a-f]{40}$/, 'Source PR has no full merge SHA');
  return sha;
}
async function verifyProductionMigration() {
  sourceMergeSha = await sourceMerge();
  const ref = await githubJson(`/repos/${REPO}/git/ref/heads/Production`);
  productionSha = String(ref?.object?.sha || '').toLowerCase();
  assert.match(productionSha, /^[0-9a-f]{40}$/);
  const file = await githubJson(`/repos/${REPO}/contents/${MIGRATION_PATH}?ref=${productionSha}`);
  assert.equal(String(file?.sha || '').toLowerCase(), MIGRATION_BLOB_SHA, 'Production Migration 1051 blob mismatch');
  const sql = Buffer.from(String(file.content || '').replace(/\s+/g, ''), 'base64').toString('utf8');
  checksum = sha256(sql); statementCount = splitMigrationSqlStatements(sql).length;
  assert.equal(statementCount, EXPECTED_STATEMENT_COUNT, 'Migration 1051 statement count changed');
  const compare = await githubJson(`/repos/${REPO}/compare/${sourceMergeSha}...${productionSha}`);
  assert.ok(['ahead', 'identical'].includes(compare.status), `Production does not contain source merge ${sourceMergeSha}`);
  return { production_sha: productionSha, migration_blob_sha: MIGRATION_BLOB_SHA, checksum, statement_count: statementCount, source_pr: SOURCE_PR, source_merge_sha: sourceMergeSha, source_merge_status: compare.status, secrets_included: false };
}
async function verifyRuntimeParity() {
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const [health, version, deployment] = await Promise.all([requestGet(`${BASE}/health`), requestGet(`${BASE}/version`), requestGet(`${BASE}/deployment-info`)]);
    if (health.http_ok && health.payload?.ok === true && version.http_ok && collectShas(version.payload).has(productionSha) && deployment.http_ok && collectShas(deployment.payload).has(productionSha)) {
      const current = await githubJson(`/repos/${REPO}/git/ref/heads/Production`);
      assert.equal(String(current?.object?.sha || '').toLowerCase(), productionSha, 'Production moved during runtime parity');
      return { production_sha: productionSha, attempt, health: 'pass', version: 'pass', deployment: 'pass', secrets_included: false };
    }
    if (attempt < 24) await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  throw new Error('Runtime did not converge to exact Production SHA within bounded window');
}
async function dryRun() {
  const payload = requireSuccess(await requestRaw('/gpt/tools/call', { name: 'governed_migration_execute', tool_args: { migration: MIGRATION, mode: 'dry_run', expected_checksum_sha256: checksum, expected_statement_count: statementCount } }), 'migration_1051_dry_run');
  const result = keyed(payload, 'applies_sql') || payload;
  assert.equal(result?.applies_sql, false); assert.equal(result?.mode, 'dry_run'); assert.equal(Number(result?.preflight_risk_count || 0), 0);
  return result;
}
async function bootstrapAuthorization(envelopeId) {
  const args = { migration: MIGRATION, expected_checksum_sha256: checksum, expected_statement_count: statementCount, pull_request: SOURCE_PR, merge_sha: sourceMergeSha, confirm: AUTH_CONFIRM, capability_envelope_id: envelopeId, decision_note: 'Authorize checksum-bound Migration 1051 metadata registration only; no GitHub Ruleset Apply occurs in this migration lifecycle.' };
  const first = await requestRaw('/gpt/tools/call', { name: 'governed_migration_authorization_bootstrap', tool_args: args });
  if (first.transport_ok && first.http_ok && first.payload?.ok !== false) return requireSuccess(first, 'migration_1051_authorization_bootstrap');
  const detail = keyed(first.payload, 'code') || first.payload?.error || {};
  if (String(detail?.code) === 'governed_migration_authorization_confirmation_required') {
    const required = String(detail?.details?.required_confirmation || detail?.details?.confirmation || '');
    assert.equal(required, AUTH_CONFIRM, 'Runtime authorization challenge differs from canonical Migration 1051 confirmation');
    return requireSuccess(await requestRaw('/gpt/tools/call', { name: 'governed_migration_authorization_bootstrap', tool_args: { ...args, confirm: required } }), 'migration_1051_authorization_confirmed');
  }
  const previous = String(detail?.details?.recorded_checksum_sha256 || detail?.details?.current_checksum_sha256 || '').toLowerCase();
  assert.equal(String(detail?.code), 'governed_migration_authorization_previous_checksum_required'); assert.match(previous, /^[0-9a-f]{64}$/); assert.notEqual(previous, checksum);
  return requireSuccess(await requestRaw('/gpt/tools/call', { name: 'governed_migration_authorization_bootstrap', tool_args: { ...args, previous_checksum_sha256: previous } }), 'migration_1051_authorization_rotation');
}
async function migrationReadback() {
  const result = await requestRaw('/gpt/tools/call', { name: 'governed_migration_schema_readback', tool_args: { migration: MIGRATION, expected_checksum_sha256: checksum, expected_statement_count: statementCount, expected_tables: [...EXPECTED_TABLES] } }, 180000);
  return { result, readback: keyed(result.payload, 'readback_status') };
}
function ledgerPass(readback) {
  const ledger = readback?.ledger;
  return Boolean(readback?.readback_status === 'pass' && ledger?.found === true && ledger?.migration_file === MIGRATION && String(ledger?.migration_checksum_sha256 || '').toLowerCase() === checksum && String(ledger?.mode || '').toLowerCase() === 'apply' && Number(ledger?.statement_count) === statementCount && String(ledger?.preflight_status || '').toLowerCase() === 'pass' && Number(ledger?.preflight_risk_count || 0) === 0);
}
function structuredReadback(readback) {
  const missing = readback?.expectations?.missing;
  return Boolean(readback && typeof readback === 'object' && ['pass', 'fail'].includes(String(readback.readback_status || '')) && readback.ledger && typeof readback.ledger === 'object' && typeof readback.ledger.found === 'boolean' && missing && typeof missing === 'object' && READBACK_MISSING_KEYS.every((key) => Array.isArray(missing[key])));
}
function missingCounts(readback) {
  if (!structuredReadback(readback)) return { tables: null, columns: null, indexes: null, rule_conditions: null };
  const missing = readback.expectations.missing;
  return Object.fromEntries(READBACK_MISSING_KEYS.map((key) => [key, missing[key].length]));
}
export function classifyLedgerState(readback, expectedChecksum, expectedStatementCount) {
  const readable = structuredReadback(readback);
  const ledger = readable ? readback.ledger : {};
  const missing = missingCounts(readback);
  const schemaComplete = readable && Object.values(missing).every((value) => value === 0);
  const exact = readable && readback.readback_status === 'pass' && ledger.found === true && ledger.migration_file === MIGRATION && String(ledger.migration_checksum_sha256 || '').toLowerCase() === expectedChecksum && Number(ledger.statement_count || 0) === expectedStatementCount && String(ledger.preflight_status || '') === 'pass' && Number(ledger.preflight_risk_count || 0) === 0;
  const ledgerMode = exact ? String(ledger.mode || '').toLowerCase() : null;
  return { readback_structured: readable, schema_complete: schemaComplete, exact_ledger: exact, ledger_mode: ledgerMode, apply_ledger: exact && ledgerMode === 'apply', record_only_ledger: exact && ledgerMode === 'record_only', missing };
}
export function validateMetadataReport(report = {}) {
  assert.equal(report?.diagnostic_status, 'captured', 'Migration 1051 metadata diagnostic is unavailable');
  assert.equal(report?.target_metadata_state, 'complete', 'Migration 1051 record-only reconciliation requires complete target metadata');
  assert.equal(report?.metadata_present, true, 'Migration 1051 metadata must be present before record-only reconciliation');
  assert.equal(Number(report?.counts?.adapter || 0), 1);
  assert.equal(Number(report?.counts?.readback_contract || 0), 1);
  assert.equal(Number(report?.counts?.apply_policy || 0), 1);
  assert.equal(Number(report?.counts?.capability_binding || 0), 1);
  assert.equal(Number(report?.counts?.expected_policy_layers || 0), 3);
  assert.equal(Number(report?.counts?.total_policy_layers || 0), 3);
  assert.equal(Number(report?.counts?.migration_authorization || 0), 1);
  assert.equal(String(report?.metadata?.adapter_status || ''), 'active');
  assert.equal(String(report?.metadata?.readback_status || ''), 'certified');
  assert.equal(String(report?.metadata?.apply_policy_status || ''), 'active');
  assert.equal(String(report?.metadata?.apply_runtime_surface || ''), 'system_layer');
  assert.equal(Number(report?.metadata?.allow_external_write || 0), 1);
  assert.equal(Number(report?.metadata?.requires_typed_confirmation || 0), 1);
  assert.equal(Number(report?.metadata?.requires_same_cycle_dry_run || 0), 1);
  assert.equal(String(report?.metadata?.capability_readiness || ''), 'ready');
  assert.equal(String(report?.metadata?.capability_policy_key || ''), 'github_repository_policy_controller_apply_v1');
  assert.equal(String(report?.metadata?.migration_authorization_status || ''), 'authorized');
  assert.ok(['0', 'false'].includes(String(report?.metadata?.live_github_policy_apply ?? '').toLowerCase()));
  return { semantic_metadata_verified: true, secrets_included: false };
}
async function loadMetadataReport() {
  const report = JSON.parse(await fs.readFile(path.join(DIR, 'metadata-diagnostic-readback.json'), 'utf8'));
  validateMetadataReport(report);
  return report;
}
async function metadataReadback() {
  const payload = requireSuccess(await requestRaw('/admin/control', buildAdminControlDbReadRequest({ sql: READBACK_SQL, params: [], maxRows: 1, authorityContext: { resource_type: 'database_metadata', resource_uri: 'db-metadata://growth_intelligence_platform/github_repository_policy_live_apply_authority', operation_mode: 'read_only_readiness_probe', required: true } }), 120000), 'github_repository_policy_1051_readback');
  const row = findObject(payload, (candidate) => Array.isArray(candidate.rows))?.rows?.[0];
  assert.equal(row?.adapter_status, 'active');
  assert.ok(['certified','shadow'].includes(String(row?.readback_status || '')));
  assert.equal(row?.apply_policy_status, 'active');
  assert.equal(row?.apply_runtime_surface, 'system_layer');
  assert.equal(Number(row?.allow_external_write || 0), 1);
  assert.equal(Number(row?.requires_typed_confirmation || 0), 1);
  assert.equal(Number(row?.requires_same_cycle_dry_run || 0), 1);
  assert.equal(row?.capability_readiness, 'ready');
  assert.equal(row?.capability_policy_key, 'github_repository_policy_controller_apply_v1');
  assert.equal(row?.authorization_status, 'authorized');
  assert.ok(['0','false'].includes(String(row?.live_github_policy_apply).toLowerCase()));
  metadataReadbackVerified = true;
  return row;
}
async function durableAuthorizationReadback() {
  const payload = requireSuccess(await requestRaw('/admin/control', buildAdminControlDbReadRequest({ sql: `SELECT migration_file, authorization_status, authorization_source, policy_key, requires_preflight, requires_confirmation, allow_apply, metadata_json FROM governed_migration_authorization_registry WHERE migration_file=? LIMIT 2`, params: [MIGRATION], maxRows: 2, authorityContext: { resource_type: 'database_metadata', resource_uri: 'db-metadata://growth_intelligence_platform/governed_migration_authorization_registry/1051', operation_mode: 'read_only_readiness_probe', required: true } }), 120000), 'migration_1051_authorization_readback');
  const rows = findObject(payload, (candidate) => Array.isArray(candidate.rows))?.rows || [];
  assert.equal(rows.length, 1, 'Migration 1051 requires one durable authorization row before Apply');
  const row = rows[0];
  assert.equal(row.authorization_status, 'authorized');
  assert.equal(Number(row.requires_preflight || 0), 1);
  assert.equal(Number(row.requires_confirmation || 0), 1);
  assert.equal(Number(row.allow_apply || 0), 1);
  const metadata = parsed(row.metadata_json) || {};
  assert.equal(String(metadata.migration_checksum_sha256 || '').toLowerCase(), checksum);
  assert.equal(Number(metadata.expected_statement_count || 0), statementCount);
  assert.equal(Number(metadata.pull_request || 0), SOURCE_PR);
  assert.equal(String(metadata.merge_sha || '').toLowerCase(), sourceMergeSha);
  assert.equal(metadata.secrets_included, false);
  return { authorization_status: row.authorization_status, policy_key: row.policy_key, checksum_bound: true, source_bound: true, secrets_included: false };
}
async function ledgerDetail(runId) {
  const payload = requireSuccess(await requestRaw('/admin/control', buildAdminControlDbReadRequest({
    sql: `SELECT run_id, migration_file, migration_checksum_sha256, applied_by, runner_version, mode, statement_count, preflight_status, preflight_risk_count, secrets_included,
      JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.record_only_backfill')) AS record_only_backfill,
      JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.sql_applied_by_this_run')) AS sql_applied_by_this_run
      FROM governed_migration_ledger WHERE run_id=? AND migration_file=? AND migration_checksum_sha256=? LIMIT 1`,
    params: [runId, MIGRATION, checksum], maxRows: 1,
    authorityContext: { resource_type: 'database_metadata', resource_uri: 'db-metadata://growth_intelligence_platform/github_repository_policy_1051_record_only_reconciliation', operation_mode: 'read_only_reconciliation_probe', required: true },
  }), 120000), 'migration_1051_record_only_ledger_detail');
  const rows = findObject(payload, (candidate) => Array.isArray(candidate.rows))?.rows || [];
  assert.equal(rows.length, 1, 'Migration 1051 exact ledger detail row is missing');
  const row = rows[0];
  assert.equal(String(row.mode || '').toLowerCase(), 'record_only');
  assert.equal(String(row.applied_by || ''), 'governed_migration_runner_backfill');
  assert.equal(String(row.preflight_status || ''), 'pass');
  assert.equal(Number(row.preflight_risk_count || 0), 0);
  assert.equal(Number(row.statement_count || 0), EXPECTED_STATEMENT_COUNT);
  assert.equal(Number(row.secrets_included || 0), 0);
  assert.equal(String(row.record_only_backfill || '').toLowerCase(), 'true');
  assert.equal(String(row.sql_applied_by_this_run || '').toLowerCase(), 'false');
  return { run_id: row.run_id, ledger_mode: String(row.mode || '').toLowerCase(), applied_by: row.applied_by, runner_version: row.runner_version, record_only_backfill: true, sql_applied_by_this_run: false, secrets_included: false };
}
async function verifyRecordOnlyLedger() {
  const { result, readback } = await migrationReadback();
  assert.ok(result.transport_ok && result.http_ok, 'Migration 1051 record-only schema readback did not return HTTP success');
  const state = classifyLedgerState(readback, checksum, statementCount);
  assert.equal(state.readback_structured, true, 'Migration 1051 record-only readback is structurally incomplete');
  assert.equal(state.schema_complete, true, 'Migration 1051 schema/metadata tables are incomplete');
  assert.equal(state.record_only_ledger, true, 'Exact Migration 1051 record-only ledger proof is missing');
  const detail = await ledgerDetail(readback.ledger.run_id);
  return { readback, state, detail };
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
  throw new Error('Exact Migration 1051 apply ledger was not proven; Apply was not retried');
}
async function readiness() {
  stage = 'production_identity'; const identity = await verifyProductionMigration(); await writeJson('production-identity.json', identity);
  stage = 'runtime_parity'; await writeJson('runtime-parity.json', await verifyRuntimeParity());
  const existing = await migrationReadback(); await writeJson('pre-readback.json', existing.result);
  if (existing.result.transport_ok && ledgerPass(existing.readback)) {
    exactLedgerVerified = true; const metadata = await metadataReadback();
    await writeJson('summary.json', { result: 'already_applied', ...identity, exact_apply_ledger_verified: true, metadata_readback_verified: true, metadata, apply_sent_by_this_run: false, live_github_policy_apply: false, secrets_included: false }); return;
  }
  stage = 'authorization_envelope';
  const envelopeId = await createEnvelope('governed_migration_authorization_bootstrap', 'governed_migration_authorization_bootstrap', 'github_actions_repository_policy_1051_readiness', 'Approve checksum-bound Migration 1051 authorization only; no SQL or GitHub provider mutation executes in readiness.');
  stage = 'authorization_bootstrap'; await bootstrapAuthorization(envelopeId);
  stage = 'dry_run'; await dryRun();
  stage = 'durable_authorization_readback'; const authorization = await durableAuthorizationReadback();
  await writeJson('summary.json', { result: 'ready_for_apply', ...identity, authorization, dry_run: 'pass', apply_sent_by_this_run: false, live_github_policy_apply: false, secrets_included: false });
}
async function reconcileRecordOnly() {
  stage = 'production_identity'; const identity = await verifyProductionMigration(); await writeJson('record-only-production-identity.json', identity);
  stage = 'runtime_parity'; await writeJson('record-only-runtime-parity.json', await verifyRuntimeParity());
  stage = 'metadata_readback'; const metadata = await loadMetadataReport();
  stage = 'record_only_pre_readback'; const before = await migrationReadback(); await writeJson('record-only-pre-readback.json', before.result);
  assert.ok(before.result.transport_ok, 'Migration 1051 pre-reconciliation schema readback transport failed');
  const beforeState = classifyLedgerState(before.readback, checksum, statementCount);
  assert.equal(beforeState.readback_structured, true, 'Migration 1051 pre-reconciliation readback is structurally incomplete');
  assert.equal(beforeState.schema_complete, true, 'Migration 1051 schema/metadata tables are incomplete; record-only recovery is forbidden');
  if (beforeState.apply_ledger) {
    exactLedgerVerified = true;
    await writeJson('summary.json', { result: 'already_has_apply_ledger', ...identity, semantic_metadata_verified: validateMetadataReport(metadata).semantic_metadata_verified, record_only_mutation_executed: false, sql_applied_by_this_run: false, live_github_policy_apply: false, secrets_included: false });
    return;
  }
  if (beforeState.record_only_ledger) {
    const verified = await verifyRecordOnlyLedger();
    await writeJson('summary.json', { result: 'already_reconciled_record_only', ...identity, semantic_metadata_verified: validateMetadataReport(metadata).semantic_metadata_verified, record_only_ledger_verified: true, detail: verified.detail, record_only_mutation_executed: false, sql_applied_by_this_run: false, live_github_policy_apply: false, secrets_included: false });
    return;
  }
  assert.equal(before.readback.ledger.found, false, 'Migration 1051 has a non-exact or unsupported ledger state');
  stage = 'record_only_apply';
  const applied = await adminShell('migration_ledger_record_apply', [`--migration=${MIGRATION}`, `--confirm=${RECORD_CONFIRM}`], 'migration_1051_record_only_reconciliation');
  const runner = findObject(applied, (candidate) => candidate?.mode === 'record_only' && candidate?.migration === MIGRATION);
  assert.ok(runner, 'Record-only runner did not return the expected Migration 1051 evidence');
  assert.equal(runner.applies_sql, false);
  stage = 'record_only_verify'; const verified = await verifyRecordOnlyLedger();
  await writeJson('summary.json', { result: 'record_only_reconciled', ...identity, semantic_metadata_verified: validateMetadataReport(metadata).semantic_metadata_verified, record_only_ledger_verified: true, detail: verified.detail, runner: { ledger_mode: runner.mode, applies_sql: false, recorded: runner.recorded ?? null, duplicate: runner.duplicate ?? false, secrets_included: false }, record_only_mutation_executed: true, sql_applied_by_this_run: false, provider_call_executed: false, external_write_executed: false, live_github_policy_apply: false, protected_ref_mutation: false, force_push: false, secrets_included: false });
}
async function verifyRecordOnly() {
  stage = 'production_identity'; const identity = await verifyProductionMigration(); await writeJson('record-only-verify-production-identity.json', identity);
  stage = 'runtime_parity'; await writeJson('record-only-verify-runtime-parity.json', await verifyRuntimeParity());
  stage = 'metadata_readback'; const metadata = await loadMetadataReport();
  stage = 'record_only_verify'; const verified = await verifyRecordOnlyLedger();
  await writeJson('record-only-verification.json', verified);
  await writeJson('summary.json', { result: 'record_only_verified', ...identity, semantic_metadata_verified: validateMetadataReport(metadata).semantic_metadata_verified, record_only_ledger_verified: true, detail: verified.detail, sql_applied_by_this_run: false, provider_call_executed: false, external_write_executed: false, live_github_policy_apply: false, protected_ref_mutation: false, force_push: false, secrets_included: false });
}
async function apply() {
  stage = 'production_identity'; const identity = await verifyProductionMigration(); await writeJson('production-identity.json', identity);
  stage = 'runtime_parity'; await writeJson('runtime-parity.json', await verifyRuntimeParity());
  const existing = await migrationReadback();
  if (existing.result.transport_ok && ledgerPass(existing.readback)) {
    exactLedgerVerified = true; const metadata = await metadataReadback();
    await writeJson('summary.json', { result: 'already_applied', ...identity, exact_apply_ledger_verified: true, metadata_readback_verified: true, metadata, apply_sent_by_this_run: false, apply_retried: false, live_github_policy_apply: false, secrets_included: false }); return;
  }
  stage = 'durable_authorization_readback'; await durableAuthorizationReadback();
  stage = 'same_cycle_dry_run'; await dryRun();
  stage = 'execution_envelope';
  const envelopeId = await createEnvelope('governed_migration_execute', 'governed_migration_execute', 'github_actions_repository_policy_1051_apply', 'Authorize exactly one checksum-bound Migration 1051 metadata Apply invocation; live GitHub policy Apply remains separate.', true);
  stage = 'apply_once'; applySent = true; await writeState();
  applyResponse = await requestRaw('/gpt/tools/call', { name: 'governed_migration_execute', tool_args: { migration: MIGRATION, mode: 'apply', confirm: APPLY_CONFIRM, expected_checksum_sha256: checksum, expected_statement_count: statementCount, capability_envelope_id: envelopeId } });
  await writeJson('apply-response.json', applyResponse);
  stage = 'post_apply_reconciliation'; const reconciled = await reconcileAfterApply();
  await writeJson('summary.json', { result: 'applied_and_verified', ...identity, apply_sent_by_this_run: true, apply_transport_ok: applyResponse.transport_ok, apply_http_status: applyResponse.status, apply_retried: false, exact_apply_ledger_verified: true, metadata_readback_verified: true, metadata: reconciled.metadata, live_github_policy_apply: false, secrets_included: false });
}
async function verify() {
  stage = 'production_identity'; const identity = await verifyProductionMigration(); await writeJson('production-identity.json', identity);
  stage = 'runtime_parity'; await writeJson('runtime-parity.json', await verifyRuntimeParity());
  stage = 'ledger_readback'; const { result, readback } = await migrationReadback(); await writeJson('verification-readback.json', result);
  assert.ok(result.transport_ok && ledgerPass(readback), 'Exact Migration 1051 apply ledger is not proven'); exactLedgerVerified = true;
  stage = 'metadata_readback'; const metadata = await metadataReadback();
  await writeJson('summary.json', { result: 'verified', ...identity, exact_apply_ledger_verified: true, metadata_readback_verified: true, metadata, apply_sent_by_this_run: false, apply_retried: false, live_github_policy_apply: false, secrets_included: false });
}

async function main() {
  try {
    assert.ok(['readiness','record_only','verify_record_only','apply','verify'].includes(PHASE), 'ROLLOUT_PHASE must be readiness, record_only, verify_record_only, apply, or verify');
    assert.ok(KEY, 'BACKEND_API_KEY is required'); assert.ok(GH, 'GH_READ_TOKEN is required');
    assert.ok(Number.isInteger(ISSUE) && ISSUE === 6625, 'Migration 1051 rollout is bound to control issue #6625');
    await writeState();
    if (PHASE === 'readiness') await readiness();
    else if (PHASE === 'record_only') await reconcileRecordOnly();
    else if (PHASE === 'verify_record_only') await verifyRecordOnly();
    else if (PHASE === 'apply') await apply();
    else await verify();
  } catch (error) {
    await writeJson('failure.json', { result: 'fail', phase: PHASE, stage, production_sha: productionSha, source_pr: SOURCE_PR || null, source_merge_sha: sourceMergeSha, migration: MIGRATION, migration_blob_sha: MIGRATION_BLOB_SHA, checksum, statement_count: statementCount, apply_sent: applySent, apply_retried: false, exact_apply_ledger_verified: exactLedgerVerified, metadata_readback_verified: metadataReadbackVerified, live_github_policy_apply: false, provider_call_executed: false, external_write_executed: false, error: { name: error?.name || 'Error', code: error?.code || 'rollout_failed', message: error?.message || String(error), details: error?.details || null }, secrets_included: false });
    await writeState({ failed: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();

export const confirmations = Object.freeze({ AUTH_CONFIRM, APPLY_CONFIRM, VERIFY_CONFIRM, RECORD_CONFIRM, RECONCILE_CONFIRM, RECONCILED_APPLY_CONFIRM });
