import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';

const PHASE = String(process.env.ROLLOUT_PHASE || '').trim();
const BASE = 'https://auth.mad4b.com';
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH = String(process.env.GH_READ_TOKEN || '').trim();
const REPO = 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os';
const ISSUE = 4191;
const DIR = String(process.env.EVIDENCE_DIR || `${process.env.RUNNER_TEMP || '/tmp'}/response-chunk-ownership`);
const MIGRATION = '20260728_governed_response_chunk_ownership.sql';
const PATH = `http-generic-api/migrations/${MIGRATION}`;
const MIGRATION_BLOB_SHA = '930b29dbf9f3d360ef6f76b52427585c31fa37a0';
const SOURCE_PR = 3247;
const SOURCE_MERGE_SHA = 'd21c26fbb94a857b4727b583df74e2aab54303cc';
const AUTH_CONFIRM = 'AUTHORIZE_GOVERNED_RESPONSE_CHUNK_OWNERSHIP_ROLLOUT';
const APPLY_CONFIRM = 'APPLY_GOVERNED_RESPONSE_CHUNK_OWNERSHIP_ROLLOUT';
const TENANT = '00000000-0000-0000-0000-000000000000';
const ADMIN = '00000000-0000-4000-a000-000000000002';
const APPLY_POLICY = 'governed_migration_execute_apply_v1';
const RESOURCE = `db-migration://growth_intelligence_platform/${MIGRATION}`;
const READY_MARKER = 'GOVERNED_RESPONSE_CHUNK_OWNERSHIP_READINESS result=pass';
const READY_SQL = `SELECT contract_key,required_column_count,present_column_count,required_index_count,present_index_count,readiness_status,legacy_rows_backfilled,provider_calls,credential_payload_reads,external_sends,external_writes,secrets_included FROM v_governed_response_chunk_ownership_readiness LIMIT 1;`;

let stage = 'start';
let checksum = null;
let statements = null;
let productionSha = null;
let applySent = false;
let applyResponse = null;
let finalLedger = false;
let finalReady = false;

const redactKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key)/i;
function sanitize(v) {
  if (Array.isArray(v)) return v.map(sanitize);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactKey.test(k) ? '[redacted]' : sanitize(x)]));
}
function parse(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}
function find(v, predicate, seen = new Set()) {
  v = parse(v);
  if (!v || typeof v !== 'object' || seen.has(v)) return null;
  seen.add(v);
  if (predicate(v)) return v;
  for (const x of Object.values(v)) { const hit = find(x, predicate, seen); if (hit) return hit; }
  return null;
}
function keyed(v, key) { return find(v, (x) => Object.prototype.hasOwnProperty.call(x, key)); }
function shas(v, out = new Set()) {
  if (typeof v === 'string') for (const m of v.matchAll(/\b[0-9a-f]{40}\b/ig)) out.add(m[0].toLowerCase());
  else if (Array.isArray(v)) v.forEach((x) => shas(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => shas(x, out));
  return out;
}
async function write(name, v) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(`${DIR}/${name}`, `${JSON.stringify(sanitize(v), null, 2)}\n`);
}
async function state(extra = {}) {
  await write('state.json', { phase: PHASE, stage, migration: MIGRATION, migration_blob_sha: MIGRATION_BLOB_SHA, checksum, statement_count: statements, production_sha: productionSha, apply_sent: applySent, apply_http_status: applyResponse?.status ?? null, exact_apply_ledger_verified: finalLedger, readiness_view_verified: finalReady, provider_call_executed: false, external_business_write_executed: false, secrets_included: false, ...extra });
}
async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${GH}`, 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000) });
  const body = await r.json();
  assert.ok(r.ok, `GitHub read failed HTTP ${r.status}: ${path}`);
  return body;
}
async function post(path, body, timeout = 300000) {
  try {
    const r = await fetch(`${BASE}${path}`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    const text = await r.text();
    let payload; try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
    return { transport_ok: true, status: r.status, http_ok: r.ok, payload };
  } catch (e) { return { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: String(e?.name || e) }; }
}
async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let payload; try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  return { ok: r.ok, status: r.status, payload };
}
function ok(result, label) {
  if (!result.transport_ok || !result.http_ok || result.payload?.ok === false) {
    const detail = keyed(result.payload, 'code') || result.payload?.error || {};
    const e = new Error(`${label} failed: HTTP ${result.status ?? 'transport'}`);
    e.code = String(detail?.code || `${label}_failed`); e.details = detail?.details; throw e;
  }
  return result.payload;
}
async function shell(alias, args) {
  return ok(await post('/admin/control', { tool: 'shell', action: 'run', alias, extra_args: args, authority_context: { resource_type: 'shell_alias', resource_uri: `shell://${alias}`, operation_mode: alias, required: true } }), alias);
}
function binding(capability, intent) {
  return createHash('sha256').update(JSON.stringify({ schema_version: 'governed_migration_envelope_binding.v1', app_key: 'platform_orchestration', capability_key: capability, operation_intent: intent, resource_uri: RESOURCE, migration_file: MIGRATION, migration_checksum_sha256: checksum, statement_count: statements, production_sha: productionSha })).digest('hex');
}
async function envelope(capability, intent, requestedBy, note, apply = false) {
  const bind = binding(capability, intent);
  let env = keyed(await shell('capability_resolution_envelope_create', [`--tenant-id=${TENANT}`, `--user-id=${ADMIN}`, '--user-role=Admin', '--app-key=platform_orchestration', `--capability-key=${capability}`, `--operation-intent=${intent}`, '--runtime-surface=auth_host', '--requested-source-tier=platform_managed_fallback', `--requested-by=${requestedBy}`, '--ttl-minutes=45', '--explain', `--resource-uri=${RESOURCE}`, `--expected-commit-sha=${productionSha}`, `--binding-sha256=${bind}`]), 'envelope_id');
  assert.ok(env?.envelope_id); assert.notEqual(env.envelope_status, 'blocked'); assert.equal(Number(env.blocking_gap_count || 0), 0);
  if (env.approval_required === true || env.envelope_status === 'ready_requires_approval') {
    const approved = keyed(await shell('capability_resolution_envelope_approve', [`--envelope-id=${env.envelope_id}`, '--approved-by=github_actions', `--decision-note=${note}`, '--ttl-minutes=45']), 'envelope_id');
    if (approved) env = { ...env, ...approved, approval_required: false, dispatch_allowed: true };
  }
  assert.equal(env.envelope_status, 'ready_for_dispatch'); assert.equal(env.dispatch_allowed, true);
  if (apply) {
    const auth = keyed(ok(await post('/gpt/tools/call', { name: 'capability_resolution_envelope_apply_authorize', tool_args: { envelope_id: env.envelope_id, authorized_by: 'github_actions', decision_note: note, ttl_minutes: 45 } }), 'apply_authorize'), 'apply_allowed');
    assert.equal(auth?.apply_allowed, true); assert.equal(auth?.policy_key, APPLY_POLICY); assert.equal(auth?.external_write_allowed, false);
  }
  return env.envelope_id;
}
async function verifyProductionMigrationBlob() {
  const ref = await gh(`/repos/${REPO}/git/ref/heads/Production`);
  productionSha = String(ref.object.sha).toLowerCase();
  const file = await gh(`/repos/${REPO}/contents/${PATH}?ref=${productionSha}`);
  assert.equal(String(file.sha).toLowerCase(), MIGRATION_BLOB_SHA, 'Production migration blob mismatch');
  const cmp = await gh(`/repos/${REPO}/compare/${SOURCE_MERGE_SHA}...${productionSha}`);
  return { production_sha: productionSha, source_merge_status: cmp.status, migration_blob_sha: file.sha };
}
async function runtimeParity() {
  for (let i = 1; i <= 24; i += 1) {
    const [health, version, deploy] = await Promise.all([get('/health'), get('/version'), get('/deployment-info')]);
    if (health.ok && health.payload?.ok === true && shas(version.payload).has(productionSha) && shas(deploy.payload).has(productionSha)) return { production_sha: productionSha, attempt: i, health: 'pass', version: 'pass', deployment: 'pass' };
    if (i < 24) await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error('Runtime did not converge to current Production SHA');
}
async function schemaReadback() {
  const result = await post('/gpt/tools/call', { name: 'governed_migration_schema_readback', tool_args: { migration: MIGRATION, expected_checksum_sha256: checksum, expected_statement_count: statements, expected_tables: ['governed_tool_response_chunks', 'v_governed_response_chunk_ownership_readiness'] } }, 180000);
  return { result, readback: keyed(result.payload, 'readback_status') };
}
function ledgerPass(r) {
  const l = r?.ledger;
  return Boolean(r?.readback_status === 'pass' && l?.found === true && l?.migration_file === MIGRATION && String(l?.migration_checksum_sha256).toLowerCase() === checksum && String(l?.mode).toLowerCase() === 'apply' && Number(l?.statement_count) === statements && String(l?.preflight_status).toLowerCase() === 'pass' && Number(l?.preflight_risk_count || 0) === 0 && l?.secrets_included === false);
}
async function readinessView() {
  const payload = ok(await post('/admin/control', { tool: 'db', action: 'run', sql: READY_SQL, params: [], authority_context: { resource_type: 'database_view', resource_uri: 'db-view://growth_intelligence_platform/v_governed_response_chunk_ownership_readiness', operation_mode: 'read_only_readiness_probe', required: true } }, 120000), 'ownership_readiness_probe');
  const row = find(payload, (x) => Array.isArray(x.rows))?.rows?.[0];
  assert.equal(row?.contract_key, 'governed_response_chunk_ownership_v1');
  assert.equal(Number(row.required_column_count), 6); assert.equal(Number(row.present_column_count), 6);
  assert.equal(Number(row.required_index_count), 2); assert.equal(Number(row.present_index_count), 2);
  assert.equal(row.readiness_status, 'ready'); assert.equal(Number(row.legacy_rows_backfilled), 0);
  for (const k of ['provider_calls','credential_payload_reads','external_sends','external_writes','secrets_included']) assert.equal(Number(row[k]), 0);
  finalReady = true; return row;
}
async function finalState() {
  for (let i = 1; i <= 6; i += 1) {
    const x = await schemaReadback(); await write(`final-readback-${i}.json`, x.result);
    if (ledgerPass(x.readback)) { finalLedger = true; return { readback: x.readback, readiness: await readinessView() }; }
    if (i < 6) await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Exact apply ledger was not proven; Apply was not retried');
}
async function dryRun() {
  const payload = ok(await post('/gpt/tools/call', { name: 'governed_migration_execute', tool_args: { migration: MIGRATION, mode: 'dry_run', expected_checksum_sha256: checksum, expected_statement_count: statements } }, 300000), 'dry_run');
  const r = keyed(payload, 'applies_sql') || payload;
  assert.equal(r.applies_sql, false); assert.equal(r.mode, 'dry_run'); assert.equal(String(r.migration_checksum_sha256).toLowerCase(), checksum); assert.equal(Number(r.statement_count), statements); assert.equal(r.preflight?.status, 'pass'); assert.equal(Number(r.preflight?.risk_count || 0), 0);
  await write('dry-run.json', payload);
}
async function bootstrap(envId) {
  const args = { migration: MIGRATION, expected_checksum_sha256: checksum, expected_statement_count: statements, pull_request: SOURCE_PR, merge_sha: SOURCE_MERGE_SHA, confirm: AUTH_CONFIRM, capability_envelope_id: envId, decision_note: 'Authorize the reviewed additive response-chunk ownership migration after exact Production artifact parity and zero-risk dry-run; no SQL executes in readiness.' };
  const first = await post('/gpt/tools/call', { name: 'governed_migration_authorization_bootstrap', tool_args: args }, 300000);
  if (first.transport_ok && first.http_ok && first.payload?.ok !== false) return ok(first, 'authorization_bootstrap');
  const detail = keyed(first.payload, 'code') || first.payload?.error || {}; const previous = String(detail?.details?.recorded_checksum_sha256 || detail?.details?.current_checksum_sha256 || '').toLowerCase();
  assert.equal(String(detail?.code), 'governed_migration_authorization_previous_checksum_required'); assert.match(previous, /^[0-9a-f]{64}$/); assert.notEqual(previous, checksum);
  return ok(await post('/gpt/tools/call', { name: 'governed_migration_authorization_bootstrap', tool_args: { ...args, previous_checksum_sha256: previous } }, 300000), 'authorization_rotation');
}
async function requireReadyComment() {
  const comments = await gh(`/repos/${REPO}/issues/${ISSUE}/comments?per_page=100`);
  const hit = [...comments].reverse().find((c) => { const b = String(c.body || ''); return b.includes(READY_MARKER) && b.includes(`production_sha=${productionSha}`) && b.includes(`migration_blob=${MIGRATION_BLOB_SHA}`) && b.includes(`checksum=${checksum}`) && b.includes(`statement_count=${statements}`) && b.includes('authorization=pass') && b.includes('dry_run=pass'); });
  assert.ok(hit, 'Current Production-bound readiness evidence is missing');
}
async function readiness() {
  stage = 'production_artifact_and_runtime_parity'; await write('production-artifact.json', await verifyProductionMigrationBlob()); await write('runtime-parity.json', await runtimeParity());
  stage = 'readback_first'; const before = await schemaReadback(); await write('initial-readback.json', before.result);
  if (ledgerPass(before.readback)) return { result: 'already_applied', production_sha: productionSha, migration_blob_sha: MIGRATION_BLOB_SHA, checksum, statement_count: statements, authorization: 'not_required', dry_run: 'not_required', final: await finalState(), secrets_included: false };
  stage = 'authorization'; const env = await envelope('governed_migration_authorization_bootstrap', 'governed_migration_authorization_bootstrap', 'github_actions_response_chunk_ownership_readiness', 'Approve checksum-bound readiness authorization only.'); await write('authorization.json', await bootstrap(env));
  stage = 'governed_dry_run'; await dryRun();
  return { result: 'pass', production_sha: productionSha, migration_blob_sha: MIGRATION_BLOB_SHA, checksum, statement_count: statements, source_pr: SOURCE_PR, source_merge_sha: SOURCE_MERGE_SHA, authorization: 'pass', dry_run: 'pass', apply_executed: false, database_mutation_executed: false, provider_call_executed: false, external_business_write_executed: false, secrets_included: false };
}
async function apply() {
  stage = 'production_artifact_and_runtime_parity'; await write('production-artifact.json', await verifyProductionMigrationBlob()); await write('runtime-parity.json', await runtimeParity());
  stage = 'readiness_evidence'; await requireReadyComment();
  stage = 'readback_first'; const before = await schemaReadback(); await write('initial-readback.json', before.result);
  if (ledgerPass(before.readback)) return { result: 'already_applied', production_sha: productionSha, migration_blob_sha: MIGRATION_BLOB_SHA, checksum, statement_count: statements, apply_sent_by_this_run: false, final: await finalState(), secrets_included: false };
  stage = 'same_cycle_dry_run'; await dryRun();
  stage = 'execution_envelope'; const env = await envelope('governed_migration_execute', 'governed_migration_execute', 'github_actions_response_chunk_ownership_apply_once', 'Authorize one checksum-bound Apply after readback-first and same-cycle dry-run.', true);
  stage = 'single_apply_request'; applySent = true; await state();
  applyResponse = await post('/gpt/tools/call', { name: 'governed_migration_execute', tool_args: { migration: MIGRATION, mode: 'apply', expected_checksum_sha256: checksum, expected_statement_count: statements, confirm: APPLY_CONFIRM, capability_envelope_id: env, applied_by: 'github_actions_response_chunk_ownership_authorized', authorization_reference: `control-issue-${ISSUE}-exact-apply-confirmation` } }, 360000);
  await write('apply-attempt.json', applyResponse);
  // Deliberately no Apply retry. Reconcile transport or HTTP ambiguity through exact readback only.
  stage = 'final_readback'; const final = await finalState();
  return { result: 'pass', production_sha: productionSha, migration_blob_sha: MIGRATION_BLOB_SHA, checksum, statement_count: statements, apply_sent_by_this_run: true, apply_retried: false, apply_transport_ok: applyResponse.transport_ok, apply_http_status: applyResponse.status, exact_apply_ledger_verified: true, readiness_view: final.readiness, provider_call_executed: false, external_business_write_executed: false, secrets_included: false };
}
async function main() {
  assert.ok(['readiness','apply'].includes(PHASE)); assert.ok(KEY); assert.ok(GH); assert.equal(Number(process.env.CONTROL_ISSUE || ISSUE), ISSUE);
  const sql = await fs.readFile(PATH, 'utf8'); checksum = createHash('sha256').update(sql).digest('hex'); statements = splitMigrationSqlStatements(sql).length;
  assert.match(sql, /requires_migration_first_rollout/); assert.match(sql, /legacy_backfill',FALSE/); assert.match(sql, /'high',0,1,1/); assert.ok(statements > 0 && statements <= 64);
  await state({ local_contract_verified: true });
  const summary = PHASE === 'readiness' ? await readiness() : await apply(); await write('summary.json', summary); await state({ ok: true, result: summary.result }); console.log(JSON.stringify(summary, null, 2));
}
main().catch(async (e) => { const failure = { ok: false, phase: PHASE, stage, error: { code: String(e?.code || 'response_chunk_ownership_rollout_failed'), message: String(e?.message || e).slice(0, 1000), details: sanitize(e?.details) }, production_sha: productionSha, migration_blob_sha: MIGRATION_BLOB_SHA, checksum, statement_count: statements, apply_sent: applySent, apply_http_status: applyResponse?.status ?? null, exact_apply_ledger_verified: finalLedger, readiness_view_verified: finalReady, provider_call_executed: false, external_business_write_executed: false, secrets_included: false }; try { await write('failure.json', failure); await state({ failure: failure.error }); } catch {} console.error(JSON.stringify(failure, null, 2)); process.exitCode = 1; });
