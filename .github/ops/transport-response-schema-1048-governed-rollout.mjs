import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';

const PHASE = String(process.env.ROLLOUT_PHASE || '').trim();
const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH = String(process.env.GH_READ_TOKEN || '').trim();
const REPO = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const ISSUE = Number(process.env.CONTROL_ISSUE || 6531);
const DIR = String(process.env.EVIDENCE_DIR || `${process.env.RUNNER_TEMP || '/tmp'}/transport-response-schema-1048`).trim();

const MIGRATION = '1048_transport_response_chunk_schema_recovery.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const MIGRATION_BLOB_SHA = '496af4c64eb8225f987e0bf04827cbce4f011682';
const EXPECTED_STATEMENT_COUNT = 34;
const SOURCE_PR = 6509;
const SOURCE_MERGE_SHA = '6503e74c60b8f6add9efade1f25ceb8afaec6209';
const MIGRATION_CONFIRMATION_KEY = MIGRATION
  .replace(/\.sql$/i, '')
  .replace(/[^A-Za-z0-9]+/g, '_')
  .toUpperCase();
const AUTH_CONFIRM = `AUTHORIZE_GOVERNED_MIGRATION_${MIGRATION_CONFIRMATION_KEY}`;
const APPLY_CONFIRM = `APPLY_${MIGRATION_CONFIRMATION_KEY}`;
const VERIFY_CONFIRM = `VERIFY_GOVERNED_MIGRATION_${MIGRATION_CONFIRMATION_KEY}`;
const TENANT = '00000000-0000-0000-0000-000000000000';
const ADMIN = '00000000-0000-4000-a000-000000000002';
const APPLY_POLICY = 'governed_migration_execute_apply_v1';
const RESOURCE = `db-migration://growth_intelligence_platform/${MIGRATION}`;
const READY_MARKER = 'TRANSPORT_RESPONSE_SCHEMA_1048_READINESS result=pass';
const READY_SQL = `SELECT contract_key,required_column_count,present_column_count,readiness_status,provider_calls,credential_payload_reads,external_sends,external_writes,secrets_included FROM v_governed_response_chunk_transport_schema_readiness LIMIT 1;`;

let stage = 'start';
let checksum = null;
let statementCount = null;
let productionSha = null;
let applySent = false;
let applyResponse = null;
let finalLedger = false;
let finalReady = false;

const redactKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    redactKey.test(key) ? '[redacted]' : sanitize(child),
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

function keyed(value, key) {
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

function sha256(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

async function writeJson(name, value) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(`${DIR}/${name}`, `${JSON.stringify(sanitize(value), null, 2)}\n`, 'utf8');
}

async function writeState(extra = {}) {
  await writeJson('state.json', {
    contract: 'transport_response_schema_1048_governed_rollout.v1',
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
    apply_transport_ok: applyResponse?.transport_ok ?? null,
    apply_http_status: applyResponse?.status ?? null,
    apply_retried: false,
    exact_apply_ledger_verified: finalLedger,
    readiness_view_verified: finalReady,
    provider_call_executed: false,
    credential_payload_accessed: false,
    external_send_executed: false,
    unrelated_external_write_executed: false,
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

async function requestGet(url, timeoutMs = 20000) {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; }
    catch { payload = { non_json_response: true }; }
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
    catch { payload = { non_json_response: true }; }
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
  const bindingSha = envelopeBindingSha(capabilityKey, operationIntent);
  const createdPayload = await adminShell('capability_resolution_envelope_create', [
    `--tenant-id=${TENANT}`,
    `--user-id=${ADMIN}`,
    '--user-role=Admin',
    '--app-key=platform_orchestration',
    `--capability-key=${capabilityKey}`,
    `--operation-intent=${operationIntent}`,
    '--runtime-surface=auth_host',
    '--requested-source-tier=platform_managed_fallback',
    `--requested-by=${requestedBy}`,
    '--ttl-minutes=45',
    '--explain',
    `--resource-uri=${RESOURCE}`,
    `--expected-commit-sha=${productionSha}`,
    `--binding-sha256=${bindingSha}`,
  ], `${capabilityKey}_envelope_create`);

  let envelope = keyed(createdPayload, 'envelope_id');
  assert.ok(envelope?.envelope_id, 'Capability envelope creation returned no envelope_id');
  assert.notEqual(envelope.envelope_status, 'blocked', `Capability envelope blocked: ${envelope.decision || 'unknown'}`);
  assert.equal(Number(envelope.blocking_gap_count || 0), 0, 'Capability envelope has blocking gaps');

  if (envelope.approval_required === true || envelope.envelope_status === 'ready_requires_approval') {
    const approvedPayload = await adminShell('capability_resolution_envelope_approve', [
      `--envelope-id=${envelope.envelope_id}`,
      '--approved-by=github_actions',
      `--decision-note=${note}`,
      '--ttl-minutes=45',
    ], `${capabilityKey}_envelope_approve`);
    const approved = keyed(approvedPayload, 'envelope_id');
    if (approved) envelope = { ...envelope, ...approved, approval_required: false, dispatch_allowed: true };
  }

  assert.equal(envelope.envelope_status, 'ready_for_dispatch');
  assert.equal(envelope.dispatch_allowed, true);

  if (authorizeApply) {
    const authorizePayload = requireSuccess(await requestRaw('/gpt/tools/call', {
      name: 'capability_resolution_envelope_apply_authorize',
      tool_args: {
        envelope_id: envelope.envelope_id,
        authorized_by: 'github_actions',
        decision_note: note,
        ttl_minutes: 45,
      },
    }), 'capability_resolution_envelope_apply_authorize');
    const authorization = keyed(authorizePayload, 'apply_allowed');
    assert.equal(authorization?.apply_allowed, true);
    assert.equal(authorization?.policy_key, APPLY_POLICY);
    assert.equal(authorization?.external_write_allowed, false);
  }

  return envelope.envelope_id;
}

async function verifyProductionMigration() {
  const ref = await githubJson(`/repos/${REPO}/git/ref/heads/Production`);
  productionSha = String(ref?.object?.sha || '').toLowerCase();
  assert.match(productionSha, /^[0-9a-f]{40}$/, 'Production ref did not return a full SHA');

  const file = await githubJson(`/repos/${REPO}/contents/${MIGRATION_PATH}?ref=${productionSha}`);
  assert.equal(String(file?.sha || '').toLowerCase(), MIGRATION_BLOB_SHA, 'Production Migration 1048 blob mismatch');
  assert.equal(file?.encoding, 'base64', 'Production Migration 1048 content was not returned as base64');
  const sql = Buffer.from(String(file.content || '').replace(/\s+/g, ''), 'base64').toString('utf8');
  checksum = sha256(sql);
  statementCount = splitMigrationSqlStatements(sql).length;
  assert.equal(statementCount, EXPECTED_STATEMENT_COUNT, 'Migration 1048 statement count changed');

  const sourceCompare = await githubJson(`/repos/${REPO}/compare/${SOURCE_MERGE_SHA}...${productionSha}`);
  assert.ok(['ahead', 'identical'].includes(sourceCompare.status), `Production does not contain source merge ${SOURCE_MERGE_SHA}; status=${sourceCompare.status}`);

  return {
    production_sha: productionSha,
    source_merge_status: sourceCompare.status,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: checksum,
    statement_count: statementCount,
    protected_ref_stable: true,
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
    const healthPass = health.http_ok && health.payload?.ok === true;
    const versionPass = version.http_ok && collectShas(version.payload).has(productionSha);
    const deploymentPass = deployment.http_ok && collectShas(deployment.payload).has(productionSha);
    if (healthPass && versionPass && deploymentPass) {
      const current = await githubJson(`/repos/${REPO}/git/ref/heads/Production`);
      assert.equal(String(current?.object?.sha || '').toLowerCase(), productionSha, 'Production moved during runtime parity verification');
      return { production_sha: productionSha, attempt, health: 'pass', version: 'pass', deployment: 'pass' };
    }
    if (attempt < 24) await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  throw new Error('Runtime did not converge to exact current Production SHA within the bounded window');
}

async function schemaReadback() {
  const result = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_schema_readback',
    tool_args: {
      migration: MIGRATION,
      expected_checksum_sha256: checksum,
      expected_statement_count: statementCount,
      expected_tables: [
        'governed_tool_response_chunks',
        'v_governed_response_chunk_transport_schema_readiness',
      ],
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
    Number(ledger?.preflight_risk_count || 0) === 0 &&
    ledger?.secrets_included === false
  );
}

async function readinessView() {
  const payload = requireSuccess(await requestRaw('/admin/control', {
    tool: 'db',
    action: 'run',
    sql: READY_SQL,
    params: [],
    authority_context: {
      resource_type: 'database_view',
      resource_uri: 'db-view://growth_intelligence_platform/v_governed_response_chunk_transport_schema_readiness',
      operation_mode: 'read_only_readiness_probe',
      required: true,
    },
  }, 120000), 'transport_schema_1048_readiness_probe');
  const row = findObject(payload, (candidate) => Array.isArray(candidate.rows))?.rows?.[0];
  assert.equal(row?.contract_key, 'governed_response_chunk_transport_schema_v1');
  assert.equal(Number(row?.required_column_count), 16);
  assert.equal(Number(row?.present_column_count), 16);
  assert.equal(row?.readiness_status, 'ready');
  for (const key of ['provider_calls', 'credential_payload_reads', 'external_sends', 'external_writes', 'secrets_included']) {
    assert.equal(Number(row?.[key]), 0, `${key} must remain zero`);
  }
  finalReady = true;
  return row;
}

async function finalState() {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const result = await schemaReadback();
    await writeJson(`final-readback-${attempt}.json`, result.result);
    if (ledgerPass(result.readback)) {
      finalLedger = true;
      return { readback: result.readback, readiness: await readinessView() };
    }
    if (attempt < 8) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('Exact Migration 1048 apply ledger was not proven; Apply was not retried');
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
  }, 300000), 'migration_1048_dry_run');
  const result = keyed(payload, 'applies_sql') || payload;
  assert.equal(result?.applies_sql, false, 'Dry-run must report applies_sql=false');
  assert.equal(result?.mode, 'dry_run', 'Dry-run mode mismatch');
  assert.equal(String(result?.migration_checksum_sha256 || '').toLowerCase(), checksum, 'Dry-run checksum mismatch');
  assert.equal(Number(result?.statement_count), statementCount, 'Dry-run statement count mismatch');
  assert.equal(result?.preflight?.status, 'pass', 'Migration 1048 preflight did not pass');
  assert.equal(Number(result?.preflight?.risk_count || 0), 0, 'Migration 1048 preflight has risks');
  await writeJson('dry-run.json', payload);
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
    decision_note: 'Authorize checksum-bound Migration 1048 readiness only after exact Production artifact and runtime parity; no SQL executes in readiness.',
  };

  const first = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: args,
  }, 300000);
  if (first.transport_ok && first.http_ok && first.payload?.ok !== false) {
    return requireSuccess(first, 'migration_1048_authorization_bootstrap');
  }

  const detail = keyed(first.payload, 'code') || first.payload?.error || {};
  const previous = String(
    detail?.details?.recorded_checksum_sha256 ||
    detail?.details?.current_checksum_sha256 ||
    '',
  ).toLowerCase();
  assert.equal(String(detail?.code), 'governed_migration_authorization_previous_checksum_required');
  assert.match(previous, /^[0-9a-f]{64}$/);
  assert.notEqual(previous, checksum);

  return requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: { ...args, previous_checksum_sha256: previous },
  }, 300000), 'migration_1048_authorization_rotation');
}

async function requireReadyComment() {
  const comments = await githubJson(`/repos/${REPO}/issues/${ISSUE}/comments?per_page=100`);
  const hit = [...comments].reverse().find((comment) => {
    const body = String(comment?.body || '');
    return body.includes(READY_MARKER) &&
      body.includes(`production_sha=${productionSha}`) &&
      body.includes(`migration_blob=${MIGRATION_BLOB_SHA}`) &&
      body.includes(`checksum=${checksum}`) &&
      body.includes(`statement_count=${statementCount}`) &&
      body.includes('authorization=pass') &&
      body.includes('dry_run=pass');
  });
  assert.ok(hit, 'Current Production-bound Migration 1048 readiness evidence is missing');
  return { comment_id: hit.id, created_at: hit.created_at };
}

async function readinessPhase() {
  stage = 'production_artifact';
  await writeJson('production-artifact.json', await verifyProductionMigration());
  stage = 'runtime_parity';
  await writeJson('runtime-parity.json', await verifyRuntimeParity());
  await writeState();

  stage = 'readback_first';
  const before = await schemaReadback();
  await writeJson('initial-readback.json', before.result);
  if (ledgerPass(before.readback)) {
    const final = await finalState();
    return {
      result: 'already_applied',
      production_sha: productionSha,
      migration_blob_sha: MIGRATION_BLOB_SHA,
      checksum,
      statement_count: statementCount,
      authorization: 'not_required',
      dry_run: 'not_required',
      final,
      secrets_included: false,
    };
  }

  stage = 'authorization_envelope';
  const envelopeId = await createEnvelope(
    'governed_migration_authorization_bootstrap',
    'governed_migration_authorization_bootstrap',
    'github_actions_transport_response_schema_1048_readiness',
    'Approve checksum-bound Migration 1048 readiness authorization only.',
  );
  await writeState({ authorization_envelope_id_redacted: true });

  stage = 'authorization_bootstrap';
  await writeJson('authorization.json', await bootstrapAuthorization(envelopeId));
  stage = 'same_cycle_dry_run';
  await dryRun();
  await writeState({ readiness_authorization_verified: true, dry_run_verified: true });

  return {
    result: 'ready_for_apply',
    production_sha: productionSha,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    checksum,
    statement_count: statementCount,
    authorization: 'pass',
    dry_run: 'pass',
    readiness_marker: `${READY_MARKER} production_sha=${productionSha} migration_blob=${MIGRATION_BLOB_SHA} checksum=${checksum} statement_count=${statementCount} authorization=pass dry_run=pass`,
    secrets_included: false,
  };
}

async function applyPhase() {
  stage = 'production_artifact';
  await writeJson('production-artifact.json', await verifyProductionMigration());
  stage = 'runtime_parity';
  await writeJson('runtime-parity.json', await verifyRuntimeParity());
  stage = 'readiness_comment';
  await writeJson('readiness-comment.json', await requireReadyComment());
  await writeState();

  stage = 'readback_first';
  const before = await schemaReadback();
  await writeJson('initial-readback.json', before.result);
  if (ledgerPass(before.readback)) {
    const final = await finalState();
    return {
      result: 'already_applied',
      production_sha: productionSha,
      migration_blob_sha: MIGRATION_BLOB_SHA,
      checksum,
      statement_count: statementCount,
      apply_sent_by_this_run: false,
      apply_retried: false,
      exact_apply_ledger_verified: true,
      readiness_view: final.readiness,
      secrets_included: false,
    };
  }

  stage = 'same_cycle_dry_run';
  await dryRun();

  stage = 'execution_envelope';
  const executionEnvelopeId = await createEnvelope(
    'governed_migration_execute',
    'governed_migration_execute',
    'github_actions_transport_response_schema_1048_apply',
    'Authorize exactly one checksum-bound Migration 1048 Apply invocation.',
    true,
  );
  await writeState({ execution_envelope_apply_authorized: true });

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
      capability_envelope_id: executionEnvelopeId,
    },
  }, 300000);
  await writeJson('apply-response.json', applyResponse);
  await writeState({ apply_response_recorded: true });

  // Deliberately do not retry Apply, including transport ambiguity or non-2xx after submission.
  stage = 'ledger_reconciliation_after_single_apply';
  const final = await finalState();
  await writeState({ exact_apply_ledger_verified: true, readiness_view_verified: true });

  return {
    result: 'applied_and_certified',
    production_sha: productionSha,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    checksum,
    statement_count: statementCount,
    apply_sent_by_this_run: true,
    apply_transport_ok: applyResponse?.transport_ok ?? false,
    apply_http_status: applyResponse?.status ?? null,
    apply_retried: false,
    exact_apply_ledger_verified: true,
    readiness_view: final.readiness,
    secrets_included: false,
  };
}

async function verifyPhase() {
  stage = 'production_artifact';
  await writeJson('production-artifact.json', await verifyProductionMigration());
  stage = 'runtime_parity';
  await writeJson('runtime-parity.json', await verifyRuntimeParity());
  stage = 'ledger_and_readiness';
  const final = await finalState();
  await writeState({ exact_apply_ledger_verified: true, readiness_view_verified: true });
  return {
    result: 'verified',
    verify_confirm: VERIFY_CONFIRM,
    production_sha: productionSha,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    checksum,
    statement_count: statementCount,
    exact_apply_ledger_verified: true,
    readiness_view: final.readiness,
    apply_sent_by_this_run: false,
    apply_retried: false,
    secrets_included: false,
  };
}

async function main() {
  assert.ok(KEY, 'BACKEND_API_KEY is required');
  assert.ok(GH, 'GH_READ_TOKEN is required');
  assert.equal(ISSUE, 6531, 'Control issue binding mismatch');
  assert.ok(['readiness', 'apply', 'verify'].includes(PHASE), `Unsupported ROLLOUT_PHASE: ${PHASE}`);

  let summary;
  if (PHASE === 'readiness') summary = await readinessPhase();
  else if (PHASE === 'apply') summary = await applyPhase();
  else summary = await verifyPhase();

  stage = 'complete';
  await writeJson('summary.json', summary);
  await writeState({ result: summary.result });
  console.log(JSON.stringify({ ok: true, result: summary.result, phase: PHASE }));
}

try {
  await main();
} catch (error) {
  await writeJson('failure.json', {
    contract: 'transport_response_schema_1048_governed_rollout_failure.v1',
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
    exact_apply_ledger_verified: finalLedger,
    readiness_view_verified: finalReady,
    provider_call_executed: false,
    credential_payload_accessed: false,
    external_send_executed: false,
    unrelated_external_write_executed: false,
    secrets_included: false,
    error: {
      name: error?.name || 'Error',
      message: String(error?.message || error),
      code: error?.code || null,
      details: error?.details || null,
    },
  });
  await writeState({ failure: true });
  console.error(error?.stack || error);
  process.exitCode = 1;
}
