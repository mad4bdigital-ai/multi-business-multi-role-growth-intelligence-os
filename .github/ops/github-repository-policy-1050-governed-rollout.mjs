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
const ISSUE = Number(process.env.CONTROL_ISSUE || 6628);
const SOURCE_PR = Number(process.env.SOURCE_PR || 6629);
const DIR = String(process.env.EVIDENCE_DIR || `${process.env.RUNNER_TEMP || '/tmp'}/github-repository-policy-1050`).trim();

const MIGRATION = '1050_github_repository_policy_controller_bootstrap_repair.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const MIGRATION_BLOB_SHA = '571fab72a305a209fa19e7b0711d87cd4eae483c';
const SOURCE_MERGE_SHA = '5505adde1bf29125c56d8588cf8de3ee956c819c';
const EXPECTED_STATEMENT_COUNT = 7;
const CONFIRMATION_KEY = MIGRATION.replace(/\.sql$/i, '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
const AUTH_CONFIRM = `AUTHORIZE_GOVERNED_MIGRATION_${CONFIRMATION_KEY}`;
const APPLY_CONFIRM = `APPLY_${CONFIRMATION_KEY}`;
const VERIFY_CONFIRM = `VERIFY_GOVERNED_MIGRATION_${CONFIRMATION_KEY}`;
const TENANT = '00000000-0000-0000-0000-000000000000';
const ADMIN = '00000000-0000-4000-a000-000000000002';
const APPLY_POLICY = 'governed_migration_execute_apply_v1';
const RESOURCE = `db-migration://growth_intelligence_platform/${MIGRATION}`;
const EXPECTED_TABLES = Object.freeze([
  'execution_policies',
  'admin_platform_endpoint_tools',
  'platform_plugin_capabilities',
  'platform_plugin_bindings',
  'platform_plugin_capability_exports',
  'governed_migration_authorization_registry',
]);
const READBACK_SQL = `SELECT
  (SELECT active FROM execution_policies WHERE policy_group='Repository Automation Governance' AND policy_key='github_repository_policy_controller_v1' LIMIT 1) AS policy_active,
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(policy_value,'$.review_policy_mode')) FROM execution_policies WHERE policy_group='Repository Automation Governance' AND policy_key='github_repository_policy_controller_v1' LIMIT 1) AS review_policy_mode,
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(policy_value,'$.single_owner_gate_check')) FROM execution_policies WHERE policy_group='Repository Automation Governance' AND policy_key='github_repository_policy_controller_v1' LIMIT 1) AS single_owner_gate_check,
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(policy_value,'$.single_owner_exact_head_attestation_required')) FROM execution_policies WHERE policy_group='Repository Automation Governance' AND policy_key='github_repository_policy_controller_v1' LIMIT 1) AS single_owner_exact_head_attestation_required,
  (SELECT is_enabled FROM admin_platform_endpoint_tools WHERE tool_key='github_repository_policy_controller' LIMIT 1) AS virtual_tool_enabled,
  (SELECT is_enabled FROM admin_platform_endpoint_tools WHERE tool_key='repository_automation_policy_controller' LIMIT 1) AS http_tool_enabled,
  (SELECT status FROM platform_plugin_capabilities WHERE capability_key='repository_policy_controller' LIMIT 1) AS capability_status,
  (SELECT dispatch_allowed FROM platform_plugin_capabilities WHERE capability_key='repository_policy_controller' LIMIT 1) AS capability_dispatch_allowed,
  (SELECT apply_allowed FROM platform_plugin_capabilities WHERE capability_key='repository_policy_controller' LIMIT 1) AS capability_apply_allowed,
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.live_apply_authorized')) FROM platform_plugin_capabilities WHERE capability_key='repository_policy_controller' LIMIT 1) AS capability_live_apply_authorized,
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.review_policy_mode')) FROM platform_plugin_capabilities WHERE capability_key='repository_policy_controller' LIMIT 1) AS capability_review_policy_mode,
  (SELECT binding_status FROM platform_plugin_bindings WHERE binding_key='binding:admin:github_repository_policy_controller' LIMIT 1) AS binding_status,
  (SELECT dispatch_allowed FROM platform_plugin_bindings WHERE binding_key='binding:admin:github_repository_policy_controller' LIMIT 1) AS binding_dispatch_allowed,
  (SELECT apply_allowed FROM platform_plugin_bindings WHERE binding_key='binding:admin:github_repository_policy_controller' LIMIT 1) AS binding_apply_allowed,
  (SELECT export_status FROM platform_plugin_capability_exports WHERE export_key='export:admin:github_repository_policy_controller' LIMIT 1) AS export_status,
  (SELECT authorization_status FROM governed_migration_authorization_registry WHERE migration_file='1050_github_repository_policy_controller_bootstrap_repair.sql' LIMIT 1) AS authorization_status,
  (SELECT allow_apply FROM governed_migration_authorization_registry WHERE migration_file='1050_github_repository_policy_controller_bootstrap_repair.sql' LIMIT 1) AS authorization_allow_apply,
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.live_github_policy_apply')) FROM governed_migration_authorization_registry WHERE migration_file='1050_github_repository_policy_controller_bootstrap_repair.sql' LIMIT 1) AS live_github_policy_apply,
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.repairs_migration')) FROM governed_migration_authorization_registry WHERE migration_file='1050_github_repository_policy_controller_bootstrap_repair.sql' LIMIT 1) AS repairs_migration;`;

let stage = 'start';
let checksum = null;
let statementCount = null;
let productionSha = null;
let applySent = false;
let applyResponse = null;
let exactLedgerVerified = false;
let metadataReadbackVerified = false;

const sensitiveKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;
const SAFE_EVIDENCE_KEYS = new Set(['authorization_status','apply_authorized','apply_sent','credential_payload_accessed','external_write_executed','live_github_policy_apply','provider_call_executed','secrets_included']);
const sha256Bytes = (value) => createHash('sha256').update(value).digest('hex');

function gitBlobSha(bytes) {
  return createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
}
function sha256(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}
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
function falseLike(value) {
  return ['0', 'false'].includes(String(value).toLowerCase());
}
async function writeJson(name, value) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(`${DIR}/${name}`, `${JSON.stringify(sanitize(value), null, 2)}\n`, 'utf8');
}
async function writeState(extra = {}) {
  await writeJson('state.json', {
    contract: 'github_repository_policy_1050_governed_rollout.v1',
    phase: PHASE,
    stage,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: checksum,
    statement_count: statementCount,
    source_pr: SOURCE_PR,
    source_merge_sha: SOURCE_MERGE_SHA,
    production_sha: productionSha,
    apply_sent: applySent,
    apply_retried: false,
    apply_transport_ok: applyResponse?.transport_ok ?? null,
    apply_http_status: applyResponse?.status ?? null,
    exact_apply_ledger_verified: exactLedgerVerified,
    metadata_readback_verified: metadataReadbackVerified,
    migration_1049_retry_executed: false,
    live_github_policy_apply: false,
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
async function requestGet(url, timeoutMs = 20000) {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let payload; try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
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
      headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload; try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
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
    authority_context: { resource_type: 'shell_alias', resource_uri: `shell://${alias}`, operation_mode: alias, required: true },
  }), label);
}
function envelopeBindingSha(capabilityKey, operationIntent) {
  return sha256(JSON.stringify({
    schema_version: 'governed_migration_envelope_binding.v1',
    app_key: 'platform_orchestration',
    capability_key: capabilityKey,
    operation_intent: operationIntent,
    resource_uri: RESOURCE,
    migration_file: MIGRATION,
    migration_checksum_sha256: checksum,
    statement_count: statementCount,
    production_sha: productionSha,
  }));
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
    const approved = await adminShell('capability_resolution_envelope_approve', [
      `--envelope-id=${envelope.envelope_id}`,
      '--approved-by=github_actions',
      `--decision-note=${note}`,
      '--ttl-minutes=45',
    ], `${capabilityKey}_envelope_approve`);
    envelope = { ...envelope, ...(keyed(approved, 'envelope_id') || {}), approval_required: false, dispatch_allowed: true };
  }
  assert.equal(envelope.envelope_status, 'ready_for_dispatch');
  assert.equal(envelope.dispatch_allowed, true);
  if (authorizeApply) {
    const auth = requireSuccess(await requestRaw('/gpt/tools/call', {
      name: 'capability_resolution_envelope_apply_authorize',
      tool_args: { envelope_id: envelope.envelope_id, authorized_by: 'github_actions', decision_note: note, ttl_minutes: 45 },
    }), 'capability_resolution_envelope_apply_authorize');
    const row = keyed(auth, 'apply_allowed');
    assert.equal(row?.apply_allowed, true);
    assert.equal(row?.policy_key, APPLY_POLICY);
    assert.equal(row?.external_write_allowed, false);
  }
  return envelope.envelope_id;
}
async function sourceMerge() {
  assert.equal(SOURCE_PR, 6629, 'Migration 1050 rollout must remain bound to source PR #6629');
  const pr = await githubJson(`/repos/${REPO}/pulls/${SOURCE_PR}`);
  assert.ok(pr?.merged_at, `Source PR #${SOURCE_PR} is not merged`);
  const actual = String(pr?.merge_commit_sha || '').toLowerCase();
  assert.equal(actual, SOURCE_MERGE_SHA, 'Source PR merge SHA differs from canonical Migration 1050 merge SHA');
  return actual;
}
async function verifyProductionMigration() {
  await sourceMerge();
  const ref = await githubJson(`/repos/${REPO}/git/ref/heads/Production`);
  productionSha = String(ref?.object?.sha || '').toLowerCase();
  assert.match(productionSha, /^[0-9a-f]{40}$/);

  const compare = await githubJson(`/repos/${REPO}/compare/${SOURCE_MERGE_SHA}...${productionSha}`);
  assert.ok(['ahead', 'identical'].includes(compare.status), `Production does not contain canonical Migration 1050 source merge ${SOURCE_MERGE_SHA}; status=${compare.status}`);

  const file = await githubJson(`/repos/${REPO}/contents/${MIGRATION_PATH}?ref=${productionSha}`);
  assert.equal(String(file?.sha || '').toLowerCase(), MIGRATION_BLOB_SHA, 'Production Migration 1050 blob mismatch');
  assert.equal(String(file?.encoding || '').toLowerCase(), 'base64', 'GitHub Contents must provide base64 migration bytes');

  const bytes = Buffer.from(String(file.content || '').replace(/\s+/g, ''), 'base64');
  assert.equal(gitBlobSha(bytes), MIGRATION_BLOB_SHA, 'Decoded Migration 1050 bytes do not reproduce canonical Git blob SHA');
  checksum = sha256Bytes(bytes);
  const sql = bytes.toString('utf8');
  statementCount = splitMigrationSqlStatements(sql).length;
  assert.equal(statementCount, EXPECTED_STATEMENT_COUNT, 'Migration 1050 statement count changed');

  return {
    production_sha: productionSha,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: checksum,
    statement_count: statementCount,
    source_pr: SOURCE_PR,
    source_merge_sha: SOURCE_MERGE_SHA,
    source_merge_status: compare.status,
    raw_bytes_checksum: true,
    secrets_included: false,
  };
}
async function verifyRuntimeParity() {
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const [health, version, deployment] = await Promise.all([
      requestGet(`${BASE}/health`),
      requestGet(`${BASE}/version`),
      requestGet(`${BASE}/deployment-info`),
    ]);
    if (health.http_ok && health.payload?.ok === true &&
        version.http_ok && collectShas(version.payload).has(productionSha) &&
        deployment.http_ok && collectShas(deployment.payload).has(productionSha)) {
      const current = await githubJson(`/repos/${REPO}/git/ref/heads/Production`);
      assert.equal(String(current?.object?.sha || '').toLowerCase(), productionSha, 'Production moved during runtime parity');
      return { production_sha: productionSha, attempt, health: 'pass', version: 'pass', deployment: 'pass', secrets_included: false };
    }
    if (attempt < 24) await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  throw new Error('Runtime did not converge to exact Production SHA within bounded window');
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
  }), 'migration_1050_dry_run');
  const result = keyed(payload, 'applies_sql') || payload;
  assert.equal(result?.applies_sql, false);
  assert.equal(result?.mode, 'dry_run');
  assert.equal(String(result?.migration_checksum_sha256 || '').toLowerCase(), checksum);
  assert.equal(Number(result?.statement_count), statementCount);
  assert.equal(Number(result?.preflight_risk_count || 0), 0);
  return result;
}
async function bootstrapAuthorization(envelopeId) {
  const args = {
    migration: MIGRATION,
    expected_checksum_sha256: checksum,
    expected_statement_count: statementCount,
    pull_request: SOURCE_PR,
    merge_sha: SOURCE_MERGE_SHA,
    confirm: AUTH_CONFIRM,
    capability_envelope_id: envelopeId,
    decision_note: 'Authorize checksum-bound Migration 1050 bootstrap repair only. Migration 1049 must not be retried and GitHub Ruleset Apply remains separate.',
  };
  const first = await requestRaw('/gpt/tools/call', { name: 'governed_migration_authorization_bootstrap', tool_args: args });
  if (first.transport_ok && first.http_ok && first.payload?.ok !== false) return requireSuccess(first, 'migration_1050_authorization_bootstrap');

  const detail = keyed(first.payload, 'code') || first.payload?.error || {};
  if (String(detail?.code) === 'governed_migration_authorization_confirmation_required') {
    const required = String(detail?.details?.required_confirmation || detail?.details?.confirmation || '');
    assert.equal(required, AUTH_CONFIRM, 'Runtime authorization challenge differs from canonical Migration 1050 confirmation');
    return requireSuccess(await requestRaw('/gpt/tools/call', {
      name: 'governed_migration_authorization_bootstrap',
      tool_args: { ...args, confirm: required },
    }), 'migration_1050_authorization_confirmed');
  }

  const previous = String(detail?.details?.recorded_checksum_sha256 || detail?.details?.current_checksum_sha256 || '').toLowerCase();
  assert.equal(String(detail?.code), 'governed_migration_authorization_previous_checksum_required');
  assert.match(previous, /^[0-9a-f]{64}$/);
  assert.notEqual(previous, checksum);
  return requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: { ...args, previous_checksum_sha256: previous },
  }), 'migration_1050_authorization_rotation');
}
async function migrationReadback() {
  const result = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_schema_readback',
    tool_args: {
      migration: MIGRATION,
      expected_checksum_sha256: checksum,
      expected_statement_count: statementCount,
      expected_tables: [...EXPECTED_TABLES],
    },
  }, 180000);
  return { result, readback: keyed(result.payload, 'readback_status') };
}
function ledgerPass(readback) {
  const ledger = readback?.ledger;
  return Boolean(
    readback?.readback_status === 'pass' &&
    ledger?.found === true &&
    ledger?.migration_file === MIGRATION &&
    String(ledger?.migration_checksum_sha256 || '').toLowerCase() === checksum &&
    String(ledger?.mode || '').toLowerCase() === 'apply' &&
    Number(ledger?.statement_count) === statementCount &&
    String(ledger?.preflight_status || '').toLowerCase() === 'pass' &&
    Number(ledger?.preflight_risk_count || 0) === 0
  );
}
async function metadataReadback() {
  const payload = requireSuccess(await requestRaw('/admin/control', buildAdminControlDbReadRequest({
    sql: READBACK_SQL,
    params: [],
    maxRows: 1,
    authorityContext: {
      resource_type: 'database_metadata',
      resource_uri: 'db-metadata://growth_intelligence_platform/github_repository_policy_controller_bootstrap_repair',
      operation_mode: 'read_only_readiness_probe',
      required: true,
    },
  }), 120000), 'github_repository_policy_1050_readback');
  const row = findObject(payload, (candidate) => Array.isArray(candidate.rows))?.rows?.[0];

  assert.equal(Number(row?.policy_active || 0), 1);
  assert.equal(row?.review_policy_mode, 'auto_single_owner_or_independent');
  assert.equal(row?.single_owner_gate_check, 'Single Owner Review Gate');
  assert.ok(['1', 'true'].includes(String(row?.single_owner_exact_head_attestation_required).toLowerCase()));

  assert.equal(Number(row?.virtual_tool_enabled || 0), 1);
  assert.equal(Number(row?.http_tool_enabled || 0), 1);
  assert.equal(row?.capability_status, 'active');
  assert.equal(Number(row?.capability_dispatch_allowed || 0), 1);
  assert.equal(Number(row?.capability_apply_allowed || 0), 0);
  assert.ok(falseLike(row?.capability_live_apply_authorized));
  assert.equal(row?.capability_review_policy_mode, 'auto_single_owner_or_independent');

  assert.equal(row?.binding_status, 'active');
  assert.equal(Number(row?.binding_dispatch_allowed || 0), 1);
  assert.equal(Number(row?.binding_apply_allowed || 0), 0);
  assert.equal(row?.export_status, 'active');

  assert.equal(row?.authorization_status, 'authorized');
  assert.equal(Number(row?.authorization_allow_apply || 0), 1);
  assert.ok(falseLike(row?.live_github_policy_apply));
  assert.equal(row?.repairs_migration, '1049_github_repository_policy_single_owner_mode.sql');

  metadataReadbackVerified = true;
  return row;
}
async function durableAuthorizationReadback() {
  const payload = requireSuccess(await requestRaw('/admin/control', buildAdminControlDbReadRequest({
    sql: `SELECT migration_file, authorization_status, authorization_source, policy_key, requires_preflight, requires_confirmation, allow_apply, metadata_json
          FROM governed_migration_authorization_registry WHERE migration_file=? LIMIT 2`,
    params: [MIGRATION],
    maxRows: 2,
    authorityContext: {
      resource_type: 'database_metadata',
      resource_uri: 'db-metadata://growth_intelligence_platform/governed_migration_authorization_registry/1050',
      operation_mode: 'read_only_readiness_probe',
      required: true,
    },
  }), 120000), 'migration_1050_authorization_readback');
  const rows = findObject(payload, (candidate) => Array.isArray(candidate.rows))?.rows || [];
  assert.equal(rows.length, 1, 'Migration 1050 requires one durable authorization row before Apply');
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
    checksum_bound: true,
    source_bound: true,
    migration_1049_retry_authorized: false,
    secrets_included: false,
  };
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
  throw new Error('Exact Migration 1050 apply ledger was not proven; Apply was not retried');
}
async function readiness() {
  stage = 'production_identity';
  const identity = await verifyProductionMigration();
  await writeJson('production-identity.json', identity);

  stage = 'runtime_parity';
  await writeJson('runtime-parity.json', await verifyRuntimeParity());

  const existing = await migrationReadback();
  await writeJson('pre-readback.json', existing.result);
  if (existing.result.transport_ok && ledgerPass(existing.readback)) {
    exactLedgerVerified = true;
    const metadata = await metadataReadback();
    await writeJson('summary.json', {
      result: 'already_applied',
      ...identity,
      exact_apply_ledger_verified: true,
      metadata_readback_verified: true,
      metadata,
      apply_sent_by_this_run: false,
      migration_1049_retry_executed: false,
      live_github_policy_apply: false,
      secrets_included: false,
    });
    return;
  }

  stage = 'authorization_envelope';
  const envelopeId = await createEnvelope(
    'governed_migration_authorization_bootstrap',
    'governed_migration_authorization_bootstrap',
    'github_actions_repository_policy_1050_readiness',
    'Approve checksum-bound Migration 1050 authorization only; no SQL, Migration 1049 retry, or GitHub provider mutation executes in readiness.'
  );

  stage = 'authorization_bootstrap';
  await bootstrapAuthorization(envelopeId);

  stage = 'dry_run';
  const dryRunResult = await dryRun();
  await writeJson('dry-run.json', dryRunResult);

  stage = 'durable_authorization_readback';
  const authorization = await durableAuthorizationReadback();

  await writeJson('summary.json', {
    result: 'ready_for_apply',
    ...identity,
    authorization,
    dry_run: 'pass',
    apply_sent_by_this_run: false,
    migration_1049_retry_executed: false,
    live_github_policy_apply: false,
    secrets_included: false,
  });
}
async function apply() {
  stage = 'production_identity';
  const identity = await verifyProductionMigration();
  await writeJson('production-identity.json', identity);

  stage = 'runtime_parity';
  await writeJson('runtime-parity.json', await verifyRuntimeParity());

  const existing = await migrationReadback();
  if (existing.result.transport_ok && ledgerPass(existing.readback)) {
    exactLedgerVerified = true;
    const metadata = await metadataReadback();
    await writeJson('summary.json', {
      result: 'already_applied',
      ...identity,
      exact_apply_ledger_verified: true,
      metadata_readback_verified: true,
      metadata,
      apply_sent_by_this_run: false,
      apply_retried: false,
      migration_1049_retry_executed: false,
      live_github_policy_apply: false,
      secrets_included: false,
    });
    return;
  }

  stage = 'durable_authorization_readback';
  await durableAuthorizationReadback();

  stage = 'same_cycle_dry_run';
  await dryRun();

  stage = 'execution_envelope';
  const envelopeId = await createEnvelope(
    'governed_migration_execute',
    'governed_migration_execute',
    'github_actions_repository_policy_1050_apply',
    'Authorize exactly one checksum-bound Migration 1050 bootstrap-repair Apply invocation. Migration 1049 retry and live GitHub policy Apply remain prohibited.',
    true
  );

  stage = 'apply_once';
  applySent = true;
  await writeState();
  applyResponse = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_execute',
    tool_args: {
      migration: MIGRATION,
      mode: 'apply',
      confirm: APPLY_CONFIRM,
      expected_checksum_sha256: checksum,
      expected_statement_count: statementCount,
      capability_envelope_id: envelopeId,
    },
  });
  await writeJson('apply-response.json', applyResponse);

  stage = 'post_apply_reconciliation';
  const reconciled = await reconcileAfterApply();

  await writeJson('summary.json', {
    result: 'applied_and_verified',
    ...identity,
    apply_sent_by_this_run: true,
    apply_transport_ok: applyResponse.transport_ok,
    apply_http_status: applyResponse.status,
    apply_retried: false,
    exact_apply_ledger_verified: true,
    metadata_readback_verified: true,
    metadata: reconciled.metadata,
    migration_1049_retry_executed: false,
    live_github_policy_apply: false,
    secrets_included: false,
  });
}
async function verify() {
  stage = 'production_identity';
  const identity = await verifyProductionMigration();
  await writeJson('production-identity.json', identity);

  stage = 'runtime_parity';
  await writeJson('runtime-parity.json', await verifyRuntimeParity());

  stage = 'ledger_readback';
  const { result, readback } = await migrationReadback();
  await writeJson('verification-readback.json', result);
  assert.ok(result.transport_ok && ledgerPass(readback), 'Exact Migration 1050 apply ledger is not proven');
  exactLedgerVerified = true;

  stage = 'metadata_readback';
  const metadata = await metadataReadback();

  await writeJson('summary.json', {
    result: 'verified',
    ...identity,
    exact_apply_ledger_verified: true,
    metadata_readback_verified: true,
    metadata,
    apply_sent_by_this_run: false,
    apply_retried: false,
    migration_1049_retry_executed: false,
    live_github_policy_apply: false,
    secrets_included: false,
  });
}

try {
  assert.ok(['readiness', 'apply', 'verify'].includes(PHASE), 'ROLLOUT_PHASE must be readiness, apply, or verify');
  assert.ok(KEY, 'BACKEND_API_KEY is required');
  assert.ok(GH, 'GH_READ_TOKEN is required');
  assert.equal(ISSUE, 6628, 'Migration 1050 rollout is bound to control issue #6628');
  assert.equal(SOURCE_PR, 6629, 'Migration 1050 rollout is bound to source PR #6629');
  await writeState();
  if (PHASE === 'readiness') await readiness();
  else if (PHASE === 'apply') await apply();
  else await verify();
} catch (error) {
  await writeJson('failure.json', {
    result: 'fail',
    phase: PHASE,
    stage,
    production_sha: productionSha,
    source_pr: SOURCE_PR,
    source_merge_sha: SOURCE_MERGE_SHA,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: checksum,
    statement_count: statementCount,
    apply_sent: applySent,
    apply_retried: false,
    exact_apply_ledger_verified: exactLedgerVerified,
    metadata_readback_verified: metadataReadbackVerified,
    migration_1049_retry_executed: false,
    live_github_policy_apply: false,
    provider_call_executed: false,
    external_write_executed: false,
    error: {
      name: error?.name || 'Error',
      code: error?.code || 'rollout_failed',
      message: error?.message || String(error),
      details: error?.details || null,
    },
    secrets_included: false,
  });
  await writeState({ failed: true });
  throw error;
}

export const confirmations = Object.freeze({ AUTH_CONFIRM, APPLY_CONFIRM, VERIFY_CONFIRM });
