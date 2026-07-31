import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from './http-generic-api/migrationSqlStatements.js';

const BASE = String(process.env.RUNTIME_BASE_URL || '').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '');
const PRODUCTION_SHA = String(process.env.EXPECTED_PRODUCTION_SHA || '').trim().toLowerCase();
const MIGRATION = '20260730_hostinger_production_resync_policy.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const CHECKSUM = '320581d0adf690f6ef4cf09d4ecd6dbcd5b6625743a529fbf0bc10a4948b41a6';
const STATEMENT_COUNT = 8;
const MIGRATION_BLOB_SHA = '553e0ab987e04009ddced67c3ef986a2669a0f8b';
const SOURCE_PR = 3265;
const SOURCE_MERGE_SHA = '1b1cb8ef7ab5f91e57828469a7c0275351765bb5';
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const PLATFORM_ADMIN_USER_ID = '00000000-0000-4000-a000-000000000002';
const RESOURCE_URI = `db-migration://growth_intelligence_platform/${MIGRATION}`;
const EVIDENCE_DIR = `${process.env.RUNNER_TEMP}/hostinger-resync-policy-apply`;
const POLICY_KEY = 'governed_migration_execute_apply_v1';

let stage = 'program_start';
let applySent = false;
let applyAttempt = null;
let executionEnvelopeId = null;
let applyAuthorizationEvidence = null;
let finalReadback = null;

const sensitiveKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    sensitiveKey.test(key) ? '[redacted]' : sanitize(child),
  ]));
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
    schema_version: 'hostinger_production_resync_policy_state.v1',
    stage,
    migration: MIGRATION,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    production_sha: PRODUCTION_SHA,
    apply_sent: applySent,
    apply_transport_ok: applyAttempt?.transport_ok ?? null,
    apply_http_status: applyAttempt?.status ?? null,
    execution_envelope_id: executionEnvelopeId,
    exact_apply_ledger_verified: Boolean(finalReadback),
    provider_call_executed: false,
    external_write_executed: false,
    deployment_executed: false,
    restart_executed: false,
    secrets_included: false,
    ...extra,
  });
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
  const args = [
    `--tenant-id=${PLATFORM_TENANT_ID}`,
    `--user-id=${PLATFORM_ADMIN_USER_ID}`,
    '--user-role=Admin',
    '--app-key=platform_orchestration',
    '--capability-key=governed_migration_execute',
    '--operation-intent=governed_migration_execute',
    '--runtime-surface=auth_host',
    '--requested-source-tier=platform_managed_fallback',
    '--requested-by=github_actions_hostinger_resync_policy_apply_once',
    '--ttl-minutes=30',
    '--explain',
    `--resource-uri=${RESOURCE_URI}`,
    `--expected-commit-sha=${PRODUCTION_SHA}`,
    `--binding-sha256=${bindingSha}`,
  ];

  const created = requireSuccess(await requestRaw('/admin/control', shellInvocation(
    'capability_resolution_envelope_create', args,
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
        '--decision-note=Approve the checksum-bound governed migration execution envelope for the explicitly authorized Production migration.',
        '--ttl-minutes=30',
      ],
    )), 'governed_migration_execute_envelope_approve');
    const approvedEnvelope = findObjectWithKey(approved, 'envelope_id');
    if (approvedEnvelope) {
      envelope = {
        ...envelope,
        ...approvedEnvelope,
        dispatch_allowed: approvedEnvelope.dispatch_allowed ?? envelope.dispatch_allowed,
        approval_required: false,
      };
    }
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
    },
  }, 180000);
  if (!result.transport_ok || result.status !== 200 || result.payload?.ok !== true) {
    return { result, readback: null };
  }
  return {
    result,
    readback: findObjectWithKey(result.payload, 'readback_status') || result.payload,
  };
}

function exactApplyLedger(readback) {
  const ledger = readback?.ledger;
  return Boolean(
    readback?.readback_status === 'pass'
    && ledger?.found === true
    && ledger?.migration_file === MIGRATION
    && ledger?.migration_checksum_sha256 === CHECKSUM
    && ledger?.mode === 'apply'
    && Number(ledger?.statement_count) === STATEMENT_COUNT
    && ledger?.preflight_status === 'pass'
    && Number(ledger?.preflight_risk_count || 0) === 0
    && ledger?.secrets_included === false
  );
}

async function main() {
  assert.equal(BASE, 'https://auth.mad4b.com');
  assert.ok(KEY, 'BACKEND_API_KEY is required');
  assert.match(PRODUCTION_SHA, /^[0-9a-f]{40}$/, 'EXPECTED_PRODUCTION_SHA must be an exact commit SHA');
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
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
  await writeState({ binding_sha256: bindingSha });

  stage = 'initial_readback';
  const initial = await exactReadback();
  const ledgerAlreadyApplied = exactApplyLedger(initial.readback);
  await writeJson('initial-readback.json', initial.result);
  await writeState({ ledger_already_applied: ledgerAlreadyApplied });
  assert.equal(ledgerAlreadyApplied, false, 'Exact apply ledger already exists; this program will not send a duplicate Apply');

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
  await writeState();

  stage = 'apply_authorization';
  const authorizationPayload = requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'capability_resolution_envelope_apply_authorize',
    tool_args: {
      envelope_id: executionEnvelopeId,
      authorized_by: 'github_actions',
      decision_note: 'Authorize one checksum-bound apply for the reviewed Hostinger Production resynchronization policy migration; same-cycle dry-run passed and exact ledger readback is mandatory.',
      ttl_minutes: 30,
    },
  }), 'capability_resolution_envelope_apply_authorize');
  applyAuthorizationEvidence = findObjectWithKey(authorizationPayload, 'apply_allowed') || authorizationPayload;
  assert.equal(applyAuthorizationEvidence?.apply_allowed, true, 'Execution envelope was not apply-authorized');
  assert.equal(applyAuthorizationEvidence?.policy_key, POLICY_KEY, 'Execution envelope used unexpected apply policy');
  assert.equal(applyAuthorizationEvidence?.external_write_allowed, false, 'Execution envelope must not allow external writes');
  await writeJson('apply-authorization.json', applyAuthorizationEvidence);
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
      applied_by: 'github_actions_hostinger_production_resync_policy_authorized',
      authorization_reference: 'user-authorized-pr3265-production-policy-20260731',
    },
  }, 360000);
  await writeJson('apply-attempt.json', applyAttempt);
  await writeState();
  // Deliberately no Apply retry. Transport or HTTP ambiguity is reconciled only through readback.

  stage = 'final_readback';
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const candidate = await exactReadback();
    await writeJson(`final-readback-${attempt}.json`, candidate.result);
    if (exactApplyLedger(candidate.readback)) {
      finalReadback = candidate.readback;
      break;
    }
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  assert.ok(finalReadback, 'Exact apply ledger/schema readback was not proven; Apply was not retried');

  const applyResult = applyAttempt?.payload || null;
  const runnerResult = applyResult ? findObjectWithKey(applyResult, 'applies_sql') : null;
  if (applyAttempt?.transport_ok && applyAttempt?.http_ok && applyAttempt?.payload?.ok !== false) {
    assert.equal(runnerResult?.mode, 'apply', 'Apply runner mode mismatch');
    assert.equal(runnerResult?.applies_sql, true, 'Apply runner did not report applies_sql=true');
    assert.equal(Number(runnerResult?.statements_executed), STATEMENT_COUNT, 'Apply runner statements_executed mismatch');
    assert.equal(runnerResult?.ledger?.recorded, true, 'Apply runner did not record ledger');
  }

  stage = 'policy_and_enum_readback';
  const policyRow = applyResult
    ? findObject(applyResult, (candidate) => candidate?.policy_key === 'repository_main_moved_trigger_policy_v1')
    : null;
  assert.ok(policyRow, 'Apply response did not expose repository_main_moved_trigger_policy_v1 readback');
  assert.equal(String(policyRow.source_branch), 'main', 'Policy source_branch mismatch');
  assert.equal(String(policyRow.deployment_branch), 'Production', 'Policy deployment_branch mismatch');
  assert.equal(Number(policyRow.production_sync_required_after_main_movement), 1, 'Policy production sync requirement mismatch');
  assert.equal(Number(policyRow.fresh_hostinger_build_required), 1, 'Policy fresh Hostinger build requirement mismatch');
  assert.equal(Number(policyRow.exact_production_merge_sha_readback_required), 1, 'Policy exact SHA readback requirement mismatch');
  assert.equal(Number(policyRow.active), 1, 'Policy active flag mismatch');
  assert.equal(Number(policyRow.blocking), 1, 'Policy blocking flag mismatch');

  const enumReadback = applyResult ? findObjectWithKey(applyResult, 'production_sync_status_registered') : null;
  assert.ok(enumReadback, 'Apply response did not expose coordination_status readback');
  assert.equal(Number(enumReadback.production_sync_status_registered), 1, 'production_sync_required enum status was not registered');

  stage = 'complete';
  const summary = {
    schema_version: 'hostinger_production_resync_policy_apply.v2',
    ok: true,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    production_sha: PRODUCTION_SHA,
    source_pr: SOURCE_PR,
    source_merge_sha: SOURCE_MERGE_SHA,
    apply_sent_by_this_workflow: applySent,
    apply_transport_ok: applyAttempt?.transport_ok ?? null,
    apply_http_status: applyAttempt?.status ?? null,
    exact_apply_ledger_verified: true,
    ledger: sanitize(finalReadback.ledger),
    policy: sanitize(policyRow),
    production_sync_status_registered: true,
    apply_policy: {
      policy_key: POLICY_KEY,
      verified_via_apply_authorization: true,
      external_write_allowed: false,
    },
    apply_authorization: sanitize(applyAuthorizationEvidence),
    execution_envelope_id: executionEnvelopeId,
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
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(async (error) => {
  const failure = {
    schema_version: 'hostinger_production_resync_policy_failure.v1',
    ok: false,
    stage,
    error: {
      code: String(error?.code || 'hostinger_production_resync_policy_finalize_failed'),
      message: String(error?.message || error || 'Unknown failure').slice(0, 1000),
    },
    migration: MIGRATION,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    production_sha: PRODUCTION_SHA,
    apply_sent: applySent,
    apply_transport_ok: applyAttempt?.transport_ok ?? null,
    apply_http_status: applyAttempt?.status ?? null,
    execution_envelope_id: executionEnvelopeId,
    exact_apply_ledger_verified: Boolean(finalReadback),
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
