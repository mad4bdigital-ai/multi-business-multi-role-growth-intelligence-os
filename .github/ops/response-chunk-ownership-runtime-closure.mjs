import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';

const BASE = 'https://auth.mad4b.com';
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH = String(process.env.GH_READ_TOKEN || '').trim();
const REPO = 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os';
const DIR = String(process.env.EVIDENCE_DIR || `${process.env.RUNNER_TEMP || '/tmp'}/response-chunk-runtime-closure`);
const MIGRATION = '20260728_governed_response_chunk_ownership.sql';
const PATH = `http-generic-api/migrations/${MIGRATION}`;
const BLOB = '930b29dbf9f3d360ef6f76b52427585c31fa37a0';
const SOURCE_MERGE = 'd21c26fbb94a857b4727b583df74e2aab54303cc';
const READY_SQL = `SELECT contract_key,required_column_count,present_column_count,required_index_count,present_index_count,readiness_status,legacy_rows_backfilled,provider_calls,credential_payload_reads,external_sends,external_writes,secrets_included FROM v_governed_response_chunk_ownership_readiness LIMIT 1;`;
let stage = 'start';
let productionSha = null;

function parse(v) { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } }
function find(v, predicate, seen = new Set()) { v = parse(v); if (!v || typeof v !== 'object' || seen.has(v)) return null; seen.add(v); if (predicate(v)) return v; for (const x of Object.values(v)) { const hit = find(x, predicate, seen); if (hit) return hit; } return null; }
function keyed(v, key) { return find(v, (x) => Object.prototype.hasOwnProperty.call(x, key)); }
function shas(v, out = new Set()) { if (typeof v === 'string') for (const m of v.matchAll(/\b[0-9a-f]{40}\b/ig)) out.add(m[0].toLowerCase()); else if (Array.isArray(v)) v.forEach((x) => shas(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => shas(x, out)); return out; }
async function write(name, value) { await fs.mkdir(DIR, { recursive: true }); await fs.writeFile(`${DIR}/${name}`, `${JSON.stringify(value, null, 2)}\n`); }
async function gh(path) { const r = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${GH}`, 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000) }); const body = await r.json(); assert.ok(r.ok, `GitHub read failed HTTP ${r.status}`); return body; }
async function get(path) { const r = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) }); const text = await r.text(); let payload; try { payload = text ? JSON.parse(text) : null; } catch { payload = null; } return { ok: r.ok, status: r.status, payload }; }
async function post(path, body, timeout = 300000) { const r = await fetch(`${BASE}${path}`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) }); const text = await r.text(); let payload; try { payload = text ? JSON.parse(text) : null; } catch { payload = null; } assert.ok(r.ok && payload?.ok !== false, `Runtime call failed HTTP ${r.status}`); return payload; }
async function stableRuntime() { for (let i = 1; i <= 30; i += 1) { const [health, version, deploy, ref] = await Promise.all([get('/health'), get('/version'), get('/deployment-info'), gh(`/repos/${REPO}/git/ref/heads/Production`)]); const current = String(ref.object.sha).toLowerCase(); if (current !== productionSha) throw new Error(`Production moved during runtime closure: ${productionSha} -> ${current}`); if (health.ok && health.payload?.ok === true && shas(version.payload).has(productionSha) && shas(deploy.payload).has(productionSha)) return { production_sha: productionSha, attempt: i, health: 'pass', version: 'pass', deployment: 'pass', protected_ref_stable: true }; if (i < 30) await new Promise((r) => setTimeout(r, 15000)); } throw new Error('Runtime did not converge to exact Production SHA'); }
async function main() {
  assert.ok(KEY); assert.ok(GH);
  const sql = await fs.readFile(PATH, 'utf8'); const checksum = createHash('sha256').update(sql).digest('hex'); const statements = splitMigrationSqlStatements(sql).length;
  stage = 'production_source_and_blob';
  const ref = await gh(`/repos/${REPO}/git/ref/heads/Production`); productionSha = String(ref.object.sha).toLowerCase();
  const file = await gh(`/repos/${REPO}/contents/${PATH}?ref=${productionSha}`); assert.equal(String(file.sha).toLowerCase(), BLOB);
  const cmp = await gh(`/repos/${REPO}/compare/${SOURCE_MERGE}...${productionSha}`); assert.ok(['ahead','identical'].includes(cmp.status), `Production does not contain source merge ${SOURCE_MERGE}`);
  stage = 'runtime_parity'; const runtime = await stableRuntime(); await write('runtime-parity.json', runtime);
  stage = 'schema_and_ledger';
  const schema = await post('/gpt/tools/call', { name: 'governed_migration_schema_readback', tool_args: { migration: MIGRATION, expected_checksum_sha256: checksum, expected_statement_count: statements, expected_tables: ['governed_tool_response_chunks','v_governed_response_chunk_ownership_readiness'] } }, 180000);
  const readback = keyed(schema, 'readback_status'); const ledger = readback?.ledger;
  assert.equal(readback?.readback_status, 'pass'); assert.equal(ledger?.found, true); assert.equal(String(ledger?.mode).toLowerCase(), 'apply'); assert.equal(String(ledger?.migration_checksum_sha256).toLowerCase(), checksum); assert.equal(Number(ledger?.statement_count), statements);
  stage = 'readiness_view';
  const readyPayload = await post('/admin/control', { tool: 'db', action: 'run', sql: READY_SQL, params: [], authority_context: { resource_type: 'database_view', resource_uri: 'db-view://growth_intelligence_platform/v_governed_response_chunk_ownership_readiness', operation_mode: 'read_only_runtime_closure', required: true } }, 120000);
  const ready = find(readyPayload, (x) => Array.isArray(x.rows))?.rows?.[0];
  assert.equal(ready?.contract_key, 'governed_response_chunk_ownership_v1'); assert.equal(Number(ready.present_column_count), 6); assert.equal(Number(ready.present_index_count), 2); assert.equal(ready.readiness_status, 'ready'); assert.equal(Number(ready.legacy_rows_backfilled), 0);
  for (const k of ['provider_calls','credential_payload_reads','external_sends','external_writes','secrets_included']) assert.equal(Number(ready[k]), 0);
  stage = 'durable_runtime_smoke';
  const smokePayload = await post('/gpt/tools/call', { name: 'response_chunk_durable_recovery_smoke', tool_args: { confirm: 'RUN_RESPONSE_CHUNK_DURABLE_RECOVERY_SMOKE', repeat_count: 40, chunk_ttl_minutes: 5 } }, 300000);
  const smoke = keyed(smokePayload, 'smoke_contract');
  assert.equal(smoke?.ok, true); assert.equal(smoke?.smoke_contract, 'response_chunk_durable_recovery_smoke_v1'); assert.equal(smoke?.persistence?.recovery_source, 'governed_tool_response_chunk_store'); assert.equal(smoke?.integrity?.exact_unicode_reconstruction, true); assert.equal(smoke?.integrity?.no_secret_policy_passed, true); assert.equal(smoke?.expiry?.sliding_extension_verified, true); assert.equal(Number(smoke?.provider_calls), 0); assert.equal(Number(smoke?.external_writes), 0); assert.equal(smoke?.secrets_included, false);
  const summary = { ok: true, schema_version: 'response_chunk_ownership_runtime_closure.v1', production_sha: productionSha, source_merge_sha: SOURCE_MERGE, migration_blob_sha: BLOB, checksum, statement_count: statements, runtime_parity: runtime, ledger: 'pass', readiness: 'pass', durable_recovery_smoke: 'pass', legacy_rows_backfilled: 0, provider_calls: 0, external_business_writes: 0, secrets_included: false };
  await write('schema-readback.json', schema); await write('readiness.json', ready); await write('smoke.json', smoke); await write('summary.json', summary); console.log(JSON.stringify(summary, null, 2));
}
main().catch(async (error) => { const failure = { ok: false, stage, production_sha: productionSha, error: String(error?.message || error).slice(0, 1000), provider_calls: 0, external_business_writes: 0, secrets_included: false }; try { await write('failure.json', failure); } catch {} console.error(JSON.stringify(failure, null, 2)); process.exitCode = 1; });
