import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from './http-generic-api/migrationSqlStatements.js';

const BASE = String(process.env.RUNTIME_BASE_URL || '').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '');
const PRODUCTION_SHA = '2669991a882c7f7939510fbbace17f462a42517c';
const MIGRATION = '20260730_hostinger_production_resync_policy.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const CHECKSUM = '320581d0adf690f6ef4cf09d4ecd6dbcd5b6625743a529fbf0bc10a4948b41a6';
const STATEMENT_COUNT = 10;
const MIGRATION_BLOB_SHA = '553e0ab987e04009ddced67c3ef986a2669a0f8b';
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const PLATFORM_ADMIN_USER_ID = '00000000-0000-4000-a000-000000000002';
const RESOURCE_URI = `db-migration://growth_intelligence_platform/${MIGRATION}`;
const EVIDENCE_DIR = `${process.env.RUNNER_TEMP}/hostinger-resync-policy-finalization-v7`;
const POLICY_KEY = 'governed_migration_execute_apply_v1';
const TARGET_POLICY_KEY = 'repository_main_moved_trigger_policy_v1';
const AUTHORIZATION_REFERENCE = 'chatgpt-user-explicit-fix-and-continue-2026-08-03';
const R6 = Object.freeze({
  run_id: 30821248381,
  artifact_id: 8859067071,
  artifact_digest: 'sha256:a6a6bc7a22405937e5d5f4be2c2505f738beea47b4043a3a08d5b69a93f91c39',
  classification: 'production_current',
});

let stage = 'program_start';
let applySent = false;
let applyAttempt = null;
let executionEnvelopeId = null;
let finalReadback = null;
let runtimeEvidence = null;

const sensitiveKey = /(password|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (key === 'secrets_included' && typeof child === 'boolean') return [key, child];
    return [key, sensitiveKey.test(key) ? '[redacted]' : sanitize(child)];
  }));
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

async function writeJson(name, value) {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(`${EVIDENCE_DIR}/${name}`, `${JSON.stringify(sanitize(value), null, 2)}\n`, 'utf8');
}

async function writeState(extra = {}) {
  await writeJson('state.json', {
    schema_version: 'hostinger_production_resync_policy_state.v7',
    stage,
    migration: MIGRATION,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    production_sha: PRODUCTION_SHA,
    runtime_parity_verified: Boolean(runtimeEvidence),
    apply_sent: applySent,
    apply_transport_ok: applyAttempt?.transport_ok ?? null,
    apply_http_status: applyAttempt?.status ?? null,
    execution_envelope_id: executionEnvelopeId,
    exact_apply_ledger_verified: Boolean(finalReadback),
    apply_retry_allowed: false,
    provider_call_executed: false,
    external_write_executed: false,
    deployment_executed: false,
    restart_executed: false,
    secrets_included: false,
    ...extra,
  });
}

async function publicGet(pathname, timeoutMs = 30000) {
  try {
    const response = await fetch(`${BASE}${pathname}`, {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; }
    catch { payload = { raw_preview: text.slice(0, 500) }; }
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

async function verifyRuntimeParity() {
  const deploymentInfo = await publicGet('/deployment-info');
  const health = await publicGet('/health');
  await writeJson('runtime-deployment-info.json', deploymentInfo);
  await writeJson('runtime-health.json', health);

  assert.equal(deploymentInfo.transport_ok, true, '/deployment-info transport failed');
  assert.equal(deploymentInfo.status, 200, '/deployment-info did not return HTTP 200');
  assert.equal(deploymentInfo.payload?.ok, true, '/deployment-info did not return ok=true');
  assert.equal(deploymentInfo.payload?.branch, 'Production', 'same-response deployment branch mismatch');
  assert.equal(String(deploymentInfo.payload?.commit_sha || '').toLowerCase(), PRODUCTION_SHA, 'same-response deployment SHA mismatch');
  assert.equal(deploymentInfo.payload?.deployment?.branch, 'Production', 'canonical deployment manifest branch mismatch');
  assert.equal(String(deploymentInfo.payload?.deployment?.commit_sha || '').toLowerCase(), PRODUCTION_SHA, 'canonical deployment manifest SHA mismatch');
  assert.equal(deploymentInfo.payload?.evidence?.canonical_manifest_detected, true, 'canonical deployment manifest not detected');
  assert.equal(deploymentInfo.payload?.evidence?.secrets_included, false, 'deployment evidence is not secret-free');
  assert.equal(health.transport_ok, true, '/health transport failed');
  assert.equal(health.status, 200, '/health did not return HTTP 200');
  assert.equal(health.payload?.ok, true, '/health did not return ok=true');
  assert.equal(health.payload?.dependencies?.db?.connected, true, 'Production database is not connected');

  runtimeEvidence = {
    deployment_branch: deploymentInfo.payload.branch,
    deployment_commit_sha: deploymentInfo.payload.commit_sha,
    canonical_manifest_detected: true,
    manifest_secret_free: true,
    database_connected: true,
    r6: R6,
    secrets_included: false,
  };
  await writeJson('runtime-parity.json', runtimeEvidence);
}

async function requestRaw(pathname, body, timeoutMs = 300000) {
  let response;
  try {
    response = await fetch(`${BASE}${pathname}`, {
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
    catch { payload = { raw_preview: text.slice(0, 500) }; }
    const result = { transport_ok: true, status: response.status, http_ok: response.ok, payload };
    console.log(JSON.stringify(sanitize(result), null, 2));
    return result;
  } catch (error) {
    const result = {
      transport_ok: false,
      status: null,
      http_ok: false,
      payload: null,
      transport_error: String(error?.name || 'Error'),
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
}

function requireSuccess(result, label) {
  if (!result.transport_ok || !result.http_ok || result.payload?.ok === false) {
    const error = new Error(`${label} failed with HTTP ${result.status ?? 'transport_error'}`);
    error.code = result.payload?.error?.code || result.payload?.error_code || `${label}_failed`;
    throw error;
  }
  return result.payload;
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

async function createReadyExecutionEnvelope(bindingSha) {
  const created = requireSuccess(await requestRaw('/admin/control', shellInvocation(
    'capability_resolution_envelope_create', [
      `--tenant-id=${PLATFORM_TENANT_ID}`,
      `--user-id=${PLATFORM_ADMIN_USER_ID}`,
      '--user-role=Admin',
      '--app-key=platform_orchestration',
      '--capability-key=governed_migration_execute',
      '--operation-intent=governed_migration_execute',
      '--runtime-surface=auth_host',
      '--requested-source-tier=platform_managed_fallback',
      '--requested-by=github_actions_hostinger_resync_policy_v7',
      '--ttl-minutes=30',
      '--explain',
      `--resource-uri=${RESOURCE_URI}`,
      `--expected-commit-sha=${PRODUCTION_SHA}`,
      `--binding-sha256=${bindingSha}`,
    ],
  )), 'governed_migration_execute_envelope_create');

  let envelope = findObjectWithKey(created, 'envelope_id');
  assert.ok(envelope?.envelope_id, 'Execution envelope creation returned no envelope_id');
  assert.notEqual(envelope.envelope_status, 'blocked', `Execution envelope blocked: ${envelope.decision || 'unknown'}`);
  assert.equal(Number(envelope.blocking_gap_count || 0), 0, 'Execution envelope has blocking gaps');

  if (envelope.approval_required === true || envelope.envelope_status === 'ready_requires_approval') {
    const approved = requireSuccess(await requestRaw('/admin/control', shellInvocation(
      'capability_resolution_envelope_approve', [
        `--envelope-id=${envelope.envelope_id}`,
        '--approved-by=github_actions',
        '--decision-note=Approve one checksum-bound Production migration apply explicitly requested by the user, with mandatory same-cycle readback and no retry.',
        '--ttl-minutes=30',
      ],
    )), 'governed_migration_execute_envelope_approve');
    const approvedEnvelope = findObjectWithKey(approved, 'envelope_id');
    if (approvedEnvelope) envelope = { ...envelope, ...approvedEnvelope, approval_required: false };
  }

  assert.equal(envelope.envelope_status, 'ready_for_dispatch', 'Execution envelope is not ready_for_dispatch');
  assert.equal(envelope.dispatch_allowed, true, 'Execution envelope dispatch_allowed is not true');
  return envelope;
}

async function exactReadback() {
  const result = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_schema_readback',
    tool_args: {
      migration: MIGRATION,
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
      expected_columns: [
        { table: 'repository_main_moved_trigger_events', column: 'coordination_status' },
      ],
    },
  }, 180000);
  return {
    result,
    readback: findObjectWithKey(result.payload, 'ledger'),
  };
}

function exactApplyLedger(readback) {
  const ledger = readback?.ledger;
  return Boolean(
    ledger?.found === true
    && ledger?.migration_file === MIGRATION
    && String(ledger?.migration_checksum_sha256 || '').toLowerCase() === CHECKSUM
    && ledger?.mode === 'apply'
    && Number(ledger?.statement_count) === STATEMENT_COUNT
    && ledger?.preflight_status === 'pass'
    && Number(ledger?.preflight_risk_count || 0) === 0
    && ledger?.secrets_included === false
  );
}

function enumAligned(readback) {
  const columns = Array.isArray(readback?.schema?.columns) ? readback.schema.columns : [];
  const row = columns.find((entry) => entry.TABLE_NAME === 'repository_main_moved_trigger_events' && entry.COLUMN_NAME === 'coordination_status');
  return Boolean(row && String(row.COLUMN_TYPE || '').includes("'production_sync_required'"));
}

function requirePolicyReadback(payload) {
  const policy = findObject(payload, (candidate) => candidate?.policy_key === TARGET_POLICY_KEY);
  assert.ok(policy, `Apply response did not expose ${TARGET_POLICY_KEY}`);
  assert.equal(String(policy.source_branch), 'main', 'Policy source_branch mismatch');
  assert.equal(String(policy.deployment_branch), 'Production', 'Policy deployment_branch mismatch');
  assert.equal(Number(policy.production_sync_required_after_main_movement), 1, 'Policy production sync requirement mismatch');
  assert.equal(Number(policy.fresh_hostinger_build_required), 1, 'Policy fresh Hostinger build requirement mismatch');
  assert.equal(Number(policy.exact_production_merge_sha_readback_required), 1, 'Policy exact SHA readback requirement mismatch');
  assert.equal(Number(policy.active), 1, 'Policy active flag mismatch');
  assert.equal(Number(policy.blocking), 1, 'Policy blocking flag mismatch');
  return policy;
}

async function main() {
  assert.equal(BASE, 'https://auth.mad4b.com');
  assert.ok(KEY, 'BACKEND_API_KEY is required');
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await writeState();

  stage = 'runtime_parity';
  await verifyRuntimeParity();
  await writeState();

  stage = 'local_contract_verified';
  const sql = await fs.readFile(MIGRATION_PATH, 'utf8');
  const actualChecksum = createHash('sha256').update(sql, 'utf8').digest('hex');
  const actualStatementCount = splitMigrationSqlStatements(sql).length;
  assert.equal(actualChecksum, CHECKSUM, 'Pinned migration checksum changed');
  assert.equal(actualStatementCount, STATEMENT_COUNT, 'Pinned migration statement count changed');
  const bindingSha = createHash('sha256').update(JSON.stringify({
    schema_version: 'governed_migration_envelope_binding.v1',
    app_key: 'platform_orchestration',
    capability_key: 'governed_migration_execute',
    operation_intent: 'governed_migration_execute',
    resource_uri: RESOURCE_URI,
    migration_file: MIGRATION,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
  })).digest('hex');
  await writeState({ binding_sha256: bindingSha, migration_blob_sha: MIGRATION_BLOB_SHA });

  stage = 'initial_readback';
  const initial = await exactReadback();
  await writeJson('initial-readback.json', initial.result);
  const ledgerAlreadyApplied = exactApplyLedger(initial.readback);
  await writeState({ ledger_already_applied: ledgerAlreadyApplied, enum_aligned: enumAligned(initial.readback) });
  if (ledgerAlreadyApplied) {
    assert.equal(enumAligned(initial.readback), true, 'Exact ledger exists but production_sync_required enum readback failed');
    const error = new Error('Exact apply ledger already exists. No duplicate Apply was sent; direct policy-row readback is still required before terminal closure.');
    error.code = 'exact_ledger_exists_policy_readback_required';
    throw error;
  }

  stage = 'same_cycle_dry_run';
  const dryRunPayload = requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_execute',
    tool_args: {
      migration: MIGRATION,
      mode: 'dry_run',
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
    },
  }), 'same_cycle_governed_migration_dry_run');
  const dryRun = findObjectWithKey(dryRunPayload, 'applies_sql');
  assert.equal(dryRun?.applies_sql, false, 'Same-cycle dry-run must report applies_sql=false');
  assert.equal(dryRun?.mode, 'dry_run', 'Same-cycle dry-run mode mismatch');
  assert.equal(dryRun?.migration_checksum_sha256, CHECKSUM, 'Same-cycle dry-run checksum mismatch');
  assert.equal(Number(dryRun?.statement_count), STATEMENT_COUNT, 'Same-cycle dry-run statement count mismatch');
  assert.equal(dryRun?.preflight?.status, 'pass', 'Same-cycle migration preflight did not pass');
  assert.equal(Number(dryRun?.preflight?.risk_count || 0), 0, 'Same-cycle migration preflight has risks');
  await writeJson('dry-run.json', dryRunPayload);
  await writeState({ dry_run_verified: true });

  stage = 'execution_envelope';
  const executionEnvelope = await createReadyExecutionEnvelope(bindingSha);
  executionEnvelopeId = executionEnvelope.envelope_id;
  await writeJson('execution-envelope.json', executionEnvelope);
  await writeState();

  stage = 'apply_authorization';
  const authorizationPayload = requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'capability_resolution_envelope_apply_authorize',
    tool_args: {
      envelope_id: executionEnvelopeId,
      authorized_by: 'github_actions',
      decision_note: 'Authorize one checksum-bound apply for the user-requested Hostinger Production resynchronization policy migration; runtime parity and same-cycle dry-run passed, and exact readback is mandatory.',
      ttl_minutes: 30,
    },
  }), 'capability_resolution_envelope_apply_authorize');
  const applyAuthorization = findObjectWithKey(authorizationPayload, 'apply_allowed') || authorizationPayload;
  assert.equal(applyAuthorization?.apply_allowed, true, 'Execution envelope was not apply-authorized');
  assert.equal(applyAuthorization?.policy_key, POLICY_KEY, 'Execution envelope used unexpected apply policy');
  assert.equal(applyAuthorization?.external_write_allowed, false, 'Execution envelope must not allow external writes');
  await writeJson('apply-authorization.json', applyAuthorization);
  await writeState({ apply_policy_verified: POLICY_KEY });

  stage = 'apply_request';
  applySent = true;
  await writeState();
  applyAttempt = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_execute',
    tool_args: {
      migration: MIGRATION,
      mode: 'apply',
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
      confirm: 'APPLY_20260730_HOSTINGER_PRODUCTION_RESYNC_POLICY',
      capability_envelope_id: executionEnvelopeId,
      applied_by: 'github_actions_hostinger_production_resync_policy_v7',
      authorization_reference: AUTHORIZATION_REFERENCE,
    },
  }, 360000);
  await writeJson('apply-attempt.json', applyAttempt);
  await writeState();
  // Never retry Apply. Any transport or HTTP ambiguity is reconciled only through readback.

  stage = 'final_readback';
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const candidate = await exactReadback();
    await writeJson(`final-readback-${attempt}.json`, candidate.result);
    if (exactApplyLedger(candidate.readback) && enumAligned(candidate.readback)) {
      finalReadback = candidate.readback;
      break;
    }
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  assert.ok(finalReadback, 'Exact apply ledger and enum readback were not proven; Apply was not retried');

  stage = 'policy_readback';
  const policy = requirePolicyReadback(applyAttempt?.payload);
  const enumResponse = findObjectWithKey(applyAttempt?.payload, 'production_sync_status_registered');
  assert.ok(enumResponse, 'Apply response did not expose production_sync_status_registered');
  assert.equal(Number(enumResponse.production_sync_status_registered), 1, 'Apply response enum readback failed');

  const runnerResult = findObjectWithKey(applyAttempt?.payload, 'applies_sql');
  if (applyAttempt?.transport_ok && applyAttempt?.http_ok && applyAttempt?.payload?.ok !== false) {
    assert.equal(runnerResult?.mode, 'apply', 'Apply runner mode mismatch');
    assert.equal(runnerResult?.applies_sql, true, 'Apply runner did not report applies_sql=true');
    assert.equal(Number(runnerResult?.statements_executed), STATEMENT_COUNT, 'Apply runner statements_executed mismatch');
    assert.equal(runnerResult?.ledger?.recorded, true, 'Apply runner did not record ledger');
  }

  stage = 'complete';
  const summary = {
    schema_version: 'hostinger_production_resync_policy_apply.v7',
    ok: true,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    production_sha: PRODUCTION_SHA,
    runtime_parity: runtimeEvidence,
    apply_sent_by_this_workflow: applySent,
    apply_transport_ok: applyAttempt?.transport_ok ?? null,
    apply_http_status: applyAttempt?.status ?? null,
    exact_apply_ledger_verified: true,
    ledger: finalReadback.ledger,
    policy,
    production_sync_status_registered: true,
    apply_policy: {
      policy_key: POLICY_KEY,
      verified_via_apply_authorization: true,
      external_write_allowed: false,
    },
    execution_envelope_id: executionEnvelopeId,
    authorization_reference: AUTHORIZATION_REFERENCE,
    apply_retried: false,
    provider_call_executed: false,
    credential_payload_read: false,
    external_send_executed: false,
    external_write_executed: false,
    deployment_executed: false,
    restart_executed: false,
    secrets_included: false,
  };
  await writeJson('summary.json', summary);
  await writeState({ ok: true });
  console.log(JSON.stringify(sanitize(summary), null, 2));
}

main().catch(async (error) => {
  const failure = {
    schema_version: 'hostinger_production_resync_policy_failure.v7',
    ok: false,
    stage,
    error: {
      code: String(error?.code || 'hostinger_production_resync_policy_finalize_v7_failed'),
      message: String(error?.message || error || 'Unknown failure').slice(0, 1200),
    },
    migration: MIGRATION,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    production_sha: PRODUCTION_SHA,
    runtime_parity_verified: Boolean(runtimeEvidence),
    apply_sent: applySent,
    apply_transport_ok: applyAttempt?.transport_ok ?? null,
    apply_http_status: applyAttempt?.status ?? null,
    execution_envelope_id: executionEnvelopeId,
    exact_apply_ledger_verified: Boolean(finalReadback),
    apply_retry_allowed: false,
    provider_call_executed: false,
    external_write_executed: false,
    deployment_executed: false,
    restart_executed: false,
    secrets_included: false,
  };
  try {
    await writeJson('failure.json', failure);
    await writeState({ failure: failure.error });
  } catch { }
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
});
