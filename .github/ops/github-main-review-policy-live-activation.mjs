import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';
import { buildGithubRepositoryPolicyCapabilityBinding } from '../../http-generic-api/githubRepositoryPolicyController.js';
import { buildAdminControlDbReadRequest } from './lib/admin-control-db-request.mjs';

const PHASE = String(process.env.POLICY_PHASE || '').trim().toLowerCase();
const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH = String(process.env.GH_READ_TOKEN || '').trim();
const REPO = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const ISSUE = Number(process.env.CONTROL_ISSUE || 6625);
const DIR = String(process.env.EVIDENCE_DIR || `${process.env.RUNNER_TEMP || '/tmp'}/github-main-review-policy`).trim();

const [OWNER, NAME] = REPO.split('/');
const DEFAULT_BRANCH = 'main';
const PRODUCTION_BRANCH = 'Production';
const POLICY_CONFIRM = 'APPLY_GITHUB_MAIN_REVIEW_POLICY';
const READINESS_CONFIRM = 'AUTHORIZE_GITHUB_MAIN_REVIEW_POLICY_READINESS';
const VERIFY_CONFIRM = 'VERIFY_GITHUB_MAIN_REVIEW_POLICY';
const READY_PREFIX = 'GITHUB_MAIN_REVIEW_POLICY_READINESS result=pass ';
const REPOSITORY_BINDING_KEY = 'growth_intelligence_platform.github.primary.production';
const CAPABILITY_KEY = 'repository_policy_controller';
const OPERATION_INTENT = 'github_repository_policy_apply';
const APPLY_POLICY_KEY = 'github_repository_policy_controller_apply_v1';
const ADMIN_USER_ID = '00000000-0000-4000-a000-000000000002';
const MIGRATION = '1050_github_repository_policy_live_apply_authority.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const MIGRATION_BLOB_SHA = '3209f180e500c23a7503edf2609ba076ba33e401';
const ENVELOPE_CREATOR_PATH = 'http-generic-api/scripts/capability-resolution-envelope-create.mjs';
const ENVELOPE_CREATOR_BLOB_SHA = 'ed78843b785ec66b8fb383bdc8ffb8225831a97e';
const EXPECTED_MIGRATION_STATEMENTS = 6;

let stage = 'start';
let mainSha = null;
let productionSha = null;
let migrationChecksum = null;
let policyFingerprint = null;
let binding = null;
let envelopeId = null;
let applySent = false;
let applyResponse = null;
let reconciliationReadback = null;

const sensitiveKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;
const SAFE_EVIDENCE_KEYS = new Set(['apply_allowed','apply_sent','authorization_status','credential_payload_accessed','external_write_executed','provider_call_executed','secrets_included']);
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
    contract: 'github_main_review_policy_live_activation.v1', phase: PHASE, stage,
    main_sha: mainSha, production_sha: productionSha, migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA, migration_checksum_sha256: migrationChecksum,
    expected_policy_fingerprint: policyFingerprint, binding_sha256: binding?.binding_sha256 || null,
    capability_envelope_id: envelopeId, apply_sent: applySent, apply_retried: false,
    apply_transport_ok: applyResponse?.transport_ok ?? null, apply_http_status: applyResponse?.status ?? null,
    provider_call_executed: applySent, external_write_executed: applySent,
    credential_payload_accessed: false, force_push_executed: false, repository_content_mutation_executed: false,
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
async function dbRead(sql, params = [], maxRows = 20) {
  const payload = requireSuccess(await requestRaw('/admin/control', buildAdminControlDbReadRequest({ sql, params, maxRows, authorityContext: { resource_type: 'database_metadata', resource_uri: 'db-metadata://growth_intelligence_platform/github_repository_policy_live_activation', operation_mode: 'read_only_readiness_probe', required: true } }), 120000), 'github_repository_policy_db_readback');
  return findObject(payload, (candidate) => Array.isArray(candidate.rows))?.rows || [];
}
async function currentRefSha(branch) {
  const ref = await githubJson(`/repos/${REPO}/git/ref/heads/${encodeURIComponent(branch)}`);
  const sha = String(ref?.object?.sha || '').toLowerCase();
  assert.match(sha, /^[0-9a-f]{40}$/, `${branch} did not resolve to a full SHA`);
  return sha;
}
async function verifySourceAndRuntimeParity() {
  mainSha = await currentRefSha(DEFAULT_BRANCH);
  productionSha = await currentRefSha(PRODUCTION_BRANCH);
  for (const [path, expectedBlob] of [[MIGRATION_PATH, MIGRATION_BLOB_SHA], [ENVELOPE_CREATOR_PATH, ENVELOPE_CREATOR_BLOB_SHA]]) {
    const file = await githubJson(`/repos/${REPO}/contents/${path}?ref=${productionSha}`);
    assert.equal(String(file?.sha || '').toLowerCase(), expectedBlob, `Production source blob mismatch: ${path}`);
  }
  const migrationFile = await githubJson(`/repos/${REPO}/contents/${MIGRATION_PATH}?ref=${productionSha}`);
  const sql = Buffer.from(String(migrationFile.content || '').replace(/\s+/g, ''), 'base64').toString('utf8');
  migrationChecksum = sha256(sql);
  assert.equal(splitMigrationSqlStatements(sql).length, EXPECTED_MIGRATION_STATEMENTS, 'Migration 1050 statement count drifted');
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const [health, version, deployment] = await Promise.all([requestGet(`${BASE}/health`), requestGet(`${BASE}/version`), requestGet(`${BASE}/deployment-info`)]);
    if (health.http_ok && health.payload?.ok === true && version.http_ok && collectShas(version.payload).has(productionSha) && deployment.http_ok && collectShas(deployment.payload).has(productionSha)) {
      assert.equal(await currentRefSha(PRODUCTION_BRANCH), productionSha, 'Production moved during runtime parity');
      return { main_sha: mainSha, production_sha: productionSha, migration_checksum_sha256: migrationChecksum, attempt, health: 'pass', version: 'pass', deployment: 'pass', secrets_included: false };
    }
    if (attempt < 24) await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  throw new Error('Runtime did not converge to the exact Production SHA within bounded window');
}
async function verifyMigration1050Applied() {
  const result = await requestRaw('/gpt/tools/call', { name: 'governed_migration_schema_readback', tool_args: { migration: MIGRATION, expected_checksum_sha256: migrationChecksum, expected_statement_count: EXPECTED_MIGRATION_STATEMENTS, expected_tables: ['platform_resource_adapters','platform_capability_readback_contracts','capability_apply_authorization_policy_registry','repository_capability_bindings','repository_capability_policy_layers','governed_migration_authorization_registry'] } }, 180000);
  const readback = keyed(result.payload, 'readback_status');
  const ledger = readback?.ledger;
  assert.ok(result.transport_ok && result.http_ok, 'Migration 1050 readback transport failed');
  assert.equal(readback?.readback_status, 'pass', 'Migration 1050 readback is not pass');
  assert.equal(ledger?.found, true, 'Migration 1050 apply ledger is absent');
  assert.equal(ledger?.migration_file, MIGRATION);
  assert.equal(String(ledger?.migration_checksum_sha256 || '').toLowerCase(), migrationChecksum);
  assert.equal(String(ledger?.mode || '').toLowerCase(), 'apply');
  assert.equal(Number(ledger?.statement_count || 0), EXPECTED_MIGRATION_STATEMENTS);
  assert.equal(Number(ledger?.preflight_risk_count || 0), 0);
  const rows = await dbRead(`SELECT
    (SELECT status FROM capability_apply_authorization_policy_registry WHERE policy_key=? LIMIT 1) AS apply_policy_status,
    (SELECT runtime_surface FROM capability_apply_authorization_policy_registry WHERE policy_key=? LIMIT 1) AS runtime_surface,
    (SELECT readiness_status FROM v_repository_capability_binding_readiness WHERE capability_binding_key='growth_intelligence_platform.github.repository_policy_controller.production' LIMIT 1) AS capability_readiness,
    (SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.live_github_policy_apply')) FROM governed_migration_authorization_registry WHERE migration_file=? LIMIT 1) AS live_github_policy_apply`, [APPLY_POLICY_KEY, APPLY_POLICY_KEY, MIGRATION], 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].apply_policy_status, 'active');
  assert.equal(rows[0].runtime_surface, 'system_layer');
  assert.equal(rows[0].capability_readiness, 'ready');
  assert.ok(['0','false'].includes(String(rows[0].live_github_policy_apply).toLowerCase()));
  return { ledger_verified: true, apply_policy_status: 'active', capability_readiness: 'ready', live_github_policy_apply: false, secrets_included: false };
}
async function controller(mode, extra = {}) {
  return requireSuccess(await requestRaw('/admin/repository-automation/policy-controller', { mode, owner: OWNER, repo: NAME, default_branch: DEFAULT_BRANCH, ...extra }), `github_repository_policy_${mode}`);
}
async function exactPlan() {
  const readback = await controller('readback');
  assert.equal(String(readback?.main_sha || '').toLowerCase(), mainSha, 'Controller readback main SHA differs from live GitHub main');
  const plan = await controller('plan');
  assert.equal(String(plan?.readback?.main_sha || '').toLowerCase(), mainSha, 'Controller plan readback main SHA differs from live GitHub main');
  policyFingerprint = String(plan?.policy_fingerprint || '').toLowerCase();
  assert.match(policyFingerprint, /^[0-9a-f]{64}$/, 'Controller plan returned no exact policy fingerprint');
  binding = buildGithubRepositoryPolicyCapabilityBinding({ target: { owner: OWNER, repo: NAME, default_branch: DEFAULT_BRANCH }, expected_main_sha: mainSha, expected_policy_fingerprint: policyFingerprint });
  assert.ok(binding);
  return { readback, plan, binding, secrets_included: false };
}
async function requireReadinessMarker() {
  const comments = await githubJson(`/repos/${REPO}/issues/${ISSUE}/comments?per_page=100`);
  const expected = `${READY_PREFIX}main_sha=${mainSha} policy_fingerprint=${policyFingerprint} binding_sha256=${binding.binding_sha256}`;
  assert.ok(comments.some((comment) => String(comment?.body || '').trim() === expected), 'Exact main/fingerprint readiness marker is missing');
  return expected;
}
async function createApplyEnvelope() {
  const created = await adminShell('capability_resolution_envelope_create', [
    `--user-id=${ADMIN_USER_ID}`, '--user-role=Admin', '--app-key=github', `--capability-key=${CAPABILITY_KEY}`,
    `--operation-intent=${OPERATION_INTENT}`, '--runtime-surface=system_layer', '--requested-source-tier=platform_managed_fallback',
    '--requested-by=github_actions_github_main_review_policy_apply', '--ttl-minutes=30', '--explain',
    `--repository-binding-key=${REPOSITORY_BINDING_KEY}`, `--resource-uri=${binding.resource_uri}`,
    `--expected-commit-sha=${mainSha}`, `--binding-sha256=${binding.binding_sha256}`, `--capability-sha256=${policyFingerprint}`,
  ], 'github_repository_policy_envelope_create');
  let envelope = keyed(created, 'envelope_id');
  assert.ok(envelope?.envelope_id, 'Repository policy envelope creation returned no envelope id');
  assert.equal(envelope.envelope_status, 'ready_requires_approval');
  assert.equal(envelope.dispatch_allowed, true);
  assert.equal(envelope.apply_allowed, false);
  assert.equal(envelope.approval_required, true);
  assert.equal(Number(envelope.blocking_gap_count || 0), 0);
  const approved = await adminShell('capability_resolution_envelope_approve', [`--envelope-id=${envelope.envelope_id}`, '--approved-by=github_actions', '--decision-note=Approve one exact main-SHA and policy-fingerprint bound repository policy dispatch after explicit APPLY_GITHUB_MAIN_REVIEW_POLICY authorization.', '--ttl-minutes=30'], 'github_repository_policy_envelope_approve');
  envelope = { ...envelope, ...(keyed(approved, 'envelope_id') || {}), approval_required: false, dispatch_allowed: true };
  assert.equal(envelope.envelope_status, 'ready_for_dispatch');
  const authorizedPayload = requireSuccess(await requestRaw('/gpt/tools/call', { name: 'capability_resolution_envelope_apply_authorize', tool_args: { envelope_id: envelope.envelope_id, authorized_by: 'github_actions', decision_note: 'Authorize exactly one external GitHub Ruleset Apply bound to current main SHA and policy fingerprint after typed confirmation and same-cycle readback.', ttl_minutes: 30 } }), 'github_repository_policy_envelope_apply_authorize');
  const authorized = keyed(authorizedPayload, 'apply_allowed') || authorizedPayload;
  assert.equal(authorized?.apply_allowed, true);
  assert.equal(authorized?.policy_key, APPLY_POLICY_KEY);
  assert.equal(authorized?.external_write_allowed, true);
  envelopeId = envelope.envelope_id;
  return { envelope_id: envelopeId, apply_allowed: true, policy_key: APPLY_POLICY_KEY, secrets_included: false };
}
function readbackProvesGate(readback) {
  return Boolean(readback && String(readback.main_sha || '').toLowerCase() === mainSha && readback.proof?.server_policy_gate_complete === true && Array.isArray(readback.bypass_actors) && readback.bypass_actors.length === 0);
}
async function readiness() {
  stage = 'source_runtime_parity'; const parity = await verifySourceAndRuntimeParity(); await writeJson('source-runtime-parity.json', parity);
  stage = 'migration_1050_ledger'; const authority = await verifyMigration1050Applied(); await writeJson('migration-1050-authority.json', authority);
  stage = 'policy_readback_plan'; const planned = await exactPlan(); await writeJson('policy-readback.json', planned.readback); await writeJson('policy-plan.json', planned.plan);
  if (planned.readback?.proof?.server_policy_gate_complete === true) {
    await writeJson('summary.json', { result: 'already_enforced', main_sha: mainSha, policy_fingerprint: policyFingerprint, binding_sha256: binding.binding_sha256, server_policy_gate_complete: true, apply_sent_by_this_run: false, secrets_included: false });
    return;
  }
  await writeJson('summary.json', { result: 'ready_for_apply', main_sha: mainSha, production_sha: productionSha, policy_fingerprint: policyFingerprint, binding_sha256: binding.binding_sha256, resource_uri: binding.resource_uri, migration_1050_verified: true, envelope_created_by_this_run: false, apply_sent_by_this_run: false, provider_call_executed: false, external_write_executed: false, secrets_included: false });
}
async function apply() {
  stage = 'source_runtime_parity'; await writeJson('source-runtime-parity.json', await verifySourceAndRuntimeParity());
  stage = 'migration_1050_ledger'; await writeJson('migration-1050-authority.json', await verifyMigration1050Applied());
  stage = 'policy_readback_plan'; const planned = await exactPlan(); await writeJson('policy-readback.json', planned.readback); await writeJson('policy-plan.json', planned.plan);
  if (planned.readback?.proof?.server_policy_gate_complete === true) {
    await writeJson('summary.json', { result: 'already_enforced', main_sha: mainSha, policy_fingerprint: policyFingerprint, server_policy_gate_complete: true, apply_sent_by_this_run: false, secrets_included: false }); return;
  }
  stage = 'readiness_marker'; await requireReadinessMarker();
  stage = 'envelope_create_approve_authorize'; await writeJson('capability-envelope.json', await createApplyEnvelope());
  assert.equal(await currentRefSha(DEFAULT_BRANCH), mainSha, 'main moved after envelope authorization');
  stage = 'apply_once'; applySent = true; await writeState();
  applyResponse = await requestRaw('/admin/repository-automation/policy-controller', { mode: 'apply', owner: OWNER, repo: NAME, default_branch: DEFAULT_BRANCH, expected_main_sha: mainSha, expected_policy_fingerprint: policyFingerprint, confirm: POLICY_CONFIRM, capability_envelope_id: envelopeId }, 300000);
  await writeJson('apply-response.json', applyResponse);
  if (applyResponse.transport_ok && applyResponse.http_ok && applyResponse.payload?.ok !== false) {
    const applied = applyResponse.payload;
    assert.equal(applied?.mutation_executed, true, 'Controller returned success without mutation evidence');
    assert.equal(String(applied?.expected_main_sha || '').toLowerCase(), mainSha);
    assert.equal(String(applied?.policy_fingerprint || '').toLowerCase(), policyFingerprint);
    assert.ok(readbackProvesGate(applied?.readback), 'Same-cycle controller readback did not prove server policy gate');
    await writeJson('summary.json', { result: 'applied_and_verified', main_sha: mainSha, policy_fingerprint: policyFingerprint, binding_sha256: binding.binding_sha256, apply_sent_by_this_run: true, apply_retried: false, server_policy_gate_complete: true, provider_call_executed: true, external_write_executed: true, credential_payload_accessed: false, force_push_executed: false, repository_content_mutation_executed: false, secrets_included: false });
    return;
  }
  stage = 'ambiguous_transport_reconciliation';
  reconciliationReadback = await controller('readback');
  await writeJson('ambiguous-transport-readback.json', reconciliationReadback);
  assert.ok(readbackProvesGate(reconciliationReadback), 'Policy Apply response was unsuccessful/ambiguous and readback does not prove the exact gate; Apply was not retried');
  await writeJson('summary.json', { result: 'reconciled_after_ambiguous_apply_transport', main_sha: mainSha, policy_fingerprint: policyFingerprint, binding_sha256: binding.binding_sha256, apply_sent_by_this_run: true, apply_retried: false, server_policy_gate_complete: true, credential_payload_accessed: false, force_push_executed: false, repository_content_mutation_executed: false, secrets_included: false });
}
async function verify() {
  stage = 'source_runtime_parity'; await writeJson('source-runtime-parity.json', await verifySourceAndRuntimeParity());
  stage = 'migration_1050_ledger'; await writeJson('migration-1050-authority.json', await verifyMigration1050Applied());
  stage = 'policy_readback_plan'; const planned = await exactPlan(); await writeJson('verification-readback.json', planned.readback);
  assert.ok(readbackProvesGate(planned.readback), 'Live GitHub server policy gate is not complete');
  await writeJson('summary.json', { result: 'verified', main_sha: mainSha, policy_fingerprint: policyFingerprint, binding_sha256: binding.binding_sha256, server_policy_gate_complete: true, apply_sent_by_this_run: false, provider_call_executed: false, external_write_executed: false, secrets_included: false });
}

try {
  assert.ok(['readiness','apply','verify'].includes(PHASE), 'POLICY_PHASE must be readiness, apply, or verify');
  assert.ok(KEY, 'BACKEND_API_KEY is required'); assert.ok(GH, 'GH_READ_TOKEN is required');
  assert.equal(ISSUE, 6625, 'Live policy activation is bound to control issue #6625');
  await writeState();
  if (PHASE === 'readiness') await readiness(); else if (PHASE === 'apply') await apply(); else await verify();
} catch (error) {
  await writeJson('failure.json', { result: 'fail', phase: PHASE, stage, main_sha: mainSha, production_sha: productionSha, policy_fingerprint: policyFingerprint, binding_sha256: binding?.binding_sha256 || null, capability_envelope_id: envelopeId, apply_sent: applySent, apply_retried: false, reconciliation_readback_proved_gate: readbackProvesGate(reconciliationReadback), provider_call_executed: applySent, external_write_executed: applySent, credential_payload_accessed: false, force_push_executed: false, repository_content_mutation_executed: false, error: { name: error?.name || 'Error', code: error?.code || 'policy_live_activation_failed', message: error?.message || String(error), details: error?.details || null }, secrets_included: false });
  await writeState({ failed: true }); throw error;
}

export const confirmations = Object.freeze({ READINESS_CONFIRM, POLICY_CONFIRM, VERIFY_CONFIRM });
