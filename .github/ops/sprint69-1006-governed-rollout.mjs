import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';
import { checkGovernedMigrationDependencies } from '../../http-generic-api/scripts/governed-migration-dependency-gate.mjs';

const PHASE = String(process.env.ROLLOUT_PHASE || '').trim().toLowerCase();
const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH_TOKEN = String(process.env.GH_READ_TOKEN || '').trim();
const REPOSITORY = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const CONTROL_ISSUE = Number(process.env.CONTROL_ISSUE || 4122);
const EVIDENCE_DIR = String(process.env.EVIDENCE_DIR || `${process.env.RUNNER_TEMP || '/tmp'}/sprint69-1006-rollout`);

const MIGRATION = '1006_sprint69_agent_capability_evidence_coverage.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const CHECKSUM = '995c657922413f9917fd4d93ac1213e76bc66b077c68646e4f5572c62c744374';
const STATEMENT_COUNT = 5;
const SOURCE_PR = 3371;
const SOURCE_MERGE_SHA = 'd14234a6ca478aa6c47e4c561c83a24063789d83';
const PRODUCTION_PROMOTION_SHA = 'abdeed2c5a588c19a2d1f2e35046e7b120d97016';
const AUTH_CONFIRM = 'AUTHORIZE_GOVERNED_MIGRATION_1006_SPRINT69_AGENT_CAPABILITY_EVIDENCE_COVERAGE';
const APPLY_CONFIRM = 'APPLY_1006_SPRINT69_AGENT_CAPABILITY_EVIDENCE_COVERAGE';
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const PLATFORM_ADMIN_USER_ID = '00000000-0000-4000-a000-000000000002';
const RESOURCE_URI = `db-migration://growth_intelligence_platform/${MIGRATION}`;
const APPLY_POLICY_KEY = 'governed_migration_execute_apply_v1';
const EXPECTED_OBJECTS = Object.freeze([
  'agent_logic_definition_evidence',
  'agent_engine_capability_evidence',
  'agent_os_capability_evidence',
  'v_agent_logic_live_coverage',
  'v_agent_engine_live_coverage',
]);
const VIEW_PROBES = Object.freeze([
  'v_agent_logic_live_coverage',
  'v_agent_engine_live_coverage',
]);
const READINESS_MARKER = 'GOVERNED_MIGRATION_1006_READINESS result=pass';

let stage = 'program_start';
let productionSha = null;
let authorizationEnvelopeId = null;
let executionEnvelopeId = null;
let applySent = false;
let applyAttempt = null;
let finalReadback = null;
let finalViewProbes = null;

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
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(`${EVIDENCE_DIR}/${name}`, `${JSON.stringify(sanitize(value), null, 2)}\n`, 'utf8');
}

async function writeState(extra = {}) {
  await writeJson('state.json', {
    schema_version: 'sprint69_1006_governed_rollout_state.v1',
    phase: PHASE,
    stage,
    migration: MIGRATION,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    production_sha: productionSha,
    authorization_envelope_id: authorizationEnvelopeId,
    execution_envelope_id: executionEnvelopeId,
    apply_sent: applySent,
    apply_transport_ok: applyAttempt?.transport_ok ?? null,
    apply_http_status: applyAttempt?.status ?? null,
    exact_apply_ledger_verified: Boolean(finalReadback),
    view_probes_verified: Boolean(finalViewProbes),
    provider_call_executed: false,
    external_write_executed: false,
    secrets_included: false,
    ...extra,
  });
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
    catch { payload = { non_json_response: true, raw_preview: text.slice(0, 500) }; }
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

async function requestGet(url, { timeoutMs = 20000 } = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; }
  catch { payload = { non_json_response: true }; }
  return { status: response.status, ok: response.ok, payload };
}

async function githubJson(pathname) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json();
  assert.ok(response.ok, `GitHub read failed for ${pathname}: HTTP ${response.status}`);
  return payload;
}

function requireSuccess(result, label) {
  if (!result.transport_ok || !result.http_ok || result.payload?.ok === false) {
    const errorObject = findObjectWithKey(result.payload, 'code') || result.payload?.error || {};
    const error = new Error(`${label} failed with HTTP ${result.status ?? 'transport_error'}`);
    error.code = String(errorObject?.code || result.payload?.error_code || `${label}_failed`);
    error.details = errorObject?.details || result.payload?.error?.details || null;
    error.result = result;
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

async function adminShell(alias, extraArgs, label) {
  return requireSuccess(await requestRaw('/admin/control', shellInvocation(alias, extraArgs)), label);
}

function envelopeBindingSha(capabilityKey, operationIntent, productionCommitSha) {
  return createHash('sha256').update(JSON.stringify({
    schema_version: 'governed_migration_envelope_binding.v1',
    app_key: 'platform_orchestration',
    capability_key: capabilityKey,
    operation_intent: operationIntent,
    resource_uri: RESOURCE_URI,
    migration_file: MIGRATION,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    production_sha: productionCommitSha,
  })).digest('hex');
}

async function createReadyEnvelope({ capabilityKey, operationIntent, requestedBy, decisionNote, applyAuthorize = false }) {
  const bindingSha = envelopeBindingSha(capabilityKey, operationIntent, productionSha);
  const createdPayload = await adminShell('capability_resolution_envelope_create', [
    `--tenant-id=${PLATFORM_TENANT_ID}`,
    `--user-id=${PLATFORM_ADMIN_USER_ID}`,
    '--user-role=Admin',
    '--app-key=platform_orchestration',
    `--capability-key=${capabilityKey}`,
    `--operation-intent=${operationIntent}`,
    '--runtime-surface=auth_host',
    '--requested-source-tier=platform_managed_fallback',
    `--requested-by=${requestedBy}`,
    '--ttl-minutes=45',
    '--explain',
    `--resource-uri=${RESOURCE_URI}`,
    `--expected-commit-sha=${productionSha}`,
    `--binding-sha256=${bindingSha}`,
  ], `${capabilityKey}_envelope_create`);
  let envelope = findObjectWithKey(createdPayload, 'envelope_id');
  assert.ok(envelope?.envelope_id, 'Capability envelope creation returned no envelope_id');
  assert.notEqual(envelope.envelope_status, 'blocked', `Capability envelope blocked: ${envelope.decision || 'unknown'}`);
  assert.equal(Number(envelope.blocking_gap_count || 0), 0, 'Capability envelope has blocking gaps');

  if (envelope.approval_required === true || envelope.envelope_status === 'ready_requires_approval') {
    const approvedPayload = await adminShell('capability_resolution_envelope_approve', [
      `--envelope-id=${envelope.envelope_id}`,
      '--approved-by=github_actions',
      `--decision-note=${decisionNote}`,
      '--ttl-minutes=45',
    ], `${capabilityKey}_envelope_approve`);
    const approved = findObjectWithKey(approvedPayload, 'envelope_id');
    if (approved) envelope = { ...envelope, ...approved, approval_required: false, dispatch_allowed: true };
  }

  assert.equal(envelope.envelope_status, 'ready_for_dispatch', 'Capability envelope is not ready_for_dispatch');
  assert.equal(envelope.dispatch_allowed, true, 'Capability envelope dispatch_allowed is not true');

  if (applyAuthorize) {
    const authorizationPayload = requireSuccess(await requestRaw('/gpt/tools/call', {
      name: 'capability_resolution_envelope_apply_authorize',
      tool_args: {
        envelope_id: envelope.envelope_id,
        authorized_by: 'github_actions',
        decision_note: decisionNote,
        ttl_minutes: 45,
      },
    }), 'capability_resolution_envelope_apply_authorize');
    const authorization = findObjectWithKey(authorizationPayload, 'apply_allowed') || authorizationPayload;
    assert.equal(authorization?.apply_allowed, true, 'Capability envelope was not apply-authorized');
    assert.equal(authorization?.policy_key, APPLY_POLICY_KEY, 'Unexpected governed migration apply policy');
    assert.equal(authorization?.external_write_allowed, false, 'Apply envelope must not allow external writes');
    return { envelope, apply_authorization: authorization, binding_sha256: bindingSha };
  }

  return { envelope, binding_sha256: bindingSha };
}

async function currentProductionSha() {
  const ref = await githubJson(`/repos/${REPOSITORY}/git/ref/heads/Production`);
  const sha = String(ref?.object?.sha || '').toLowerCase();
  assert.match(sha, /^[0-9a-f]{40}$/, 'Production ref did not return a full SHA');
  return sha;
}

async function assertProductionContains(commitSha, currentSha) {
  const comparison = await githubJson(`/repos/${REPOSITORY}/compare/${commitSha}...${currentSha}`);
  assert.ok(['ahead', 'identical'].includes(comparison.status), `Production does not contain ${commitSha}; status=${comparison.status}`);
  return { status: comparison.status, ahead_by: Number(comparison.ahead_by || 0), behind_by: Number(comparison.behind_by || 0) };
}

async function waitForRuntimeParity() {
  for (let convergence = 1; convergence <= 2; convergence += 1) {
    const targetSha = await currentProductionSha();
    const [promotionCompare, sourceCompare] = await Promise.all([
      assertProductionContains(PRODUCTION_PROMOTION_SHA, targetSha),
      assertProductionContains(SOURCE_MERGE_SHA, targetSha),
    ]);
    for (let attempt = 1; attempt <= 24; attempt += 1) {
      const [health, version, deployment] = await Promise.all([
        requestGet(`${BASE}/health`),
        requestGet(`${BASE}/version`),
        requestGet(`${BASE}/deployment-info`),
      ]);
      const healthPass = health.ok && health.payload?.ok === true;
      const versionPass = version.ok && collectShas(version.payload).has(targetSha);
      const deploymentPass = deployment.ok && collectShas(deployment.payload).has(targetSha);
      console.log(`RUNTIME_PARITY attempt=${attempt} health=${healthPass} version=${versionPass} deployment=${deploymentPass}`);
      if (healthPass && versionPass && deploymentPass) {
        const latest = await currentProductionSha();
        if (latest !== targetSha) break;
        productionSha = targetSha;
        return {
          production_sha: targetSha,
          promotion_compare: promotionCompare,
          source_compare: sourceCompare,
          health_http: health.status,
          version_http: version.status,
          deployment_info_http: deployment.status,
          verified_at: new Date().toISOString(),
          secrets_included: false,
        };
      }
      if (attempt < 24) await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }
  throw new Error('Runtime did not converge to the current Production SHA within the bounded window');
}

async function exactReadback() {
  const result = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_schema_readback',
    tool_args: {
      migration: MIGRATION,
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
      expected_tables: [...EXPECTED_OBJECTS],
    },
  }, 180000);
  const readback = findObjectWithKey(result.payload, 'readback_status') || null;
  return { result, readback };
}

function exactApplyLedger(readback) {
  const ledger = readback?.ledger;
  return Boolean(
    ledger?.found === true
    && String(ledger?.migration_file || '') === MIGRATION
    && String(ledger?.migration_checksum_sha256 || '').toLowerCase() === CHECKSUM
    && String(ledger?.mode || '').toLowerCase() === 'apply'
    && Number(ledger?.statement_count) === STATEMENT_COUNT
    && String(ledger?.preflight_status || '').toLowerCase() === 'pass'
    && Number(ledger?.preflight_risk_count || 0) === 0
    && ledger?.secrets_included === false
  );
}

function completeReadback(readback) {
  const missing = readback?.expectations?.missing || {};
  return Boolean(
    readback?.readback_status === 'pass'
    && exactApplyLedger(readback)
    && Array.isArray(missing.tables)
    && missing.tables.length === 0
    && Array.isArray(missing.columns)
    && missing.columns.length === 0
    && Array.isArray(missing.indexes)
    && missing.indexes.length === 0
    && Array.isArray(missing.rule_conditions)
    && missing.rule_conditions.length === 0
  );
}

async function fixedViewProbe(viewName) {
  assert.ok(VIEW_PROBES.includes(viewName), `View probe is not allowlisted: ${viewName}`);
  const sql = `SELECT COUNT(*) AS row_count FROM \`${viewName}\``;
  const allowedSql = new Set(VIEW_PROBES.map((view) => `SELECT COUNT(*) AS row_count FROM \`${view}\`;`));
  assert.ok(allowedSql.has(sql), 'View probe SQL is not the exact checked-in read-only statement');
  const payload = requireSuccess(await requestRaw('/admin/control', {
    tool: 'db',
    action: 'run',
    sql,
    params: [],
    authority_context: {
      resource_type: 'database_view',
      resource_uri: `db-view://growth_intelligence_platform/${viewName}`,
      operation_mode: 'read_only_count_probe',
      required: true,
    },
  }, 120000), `view_probe_${viewName}`);
  const rowsObject = findObject(payload, (candidate) => Array.isArray(candidate?.rows));
  const row = rowsObject?.rows?.[0] || null;
  const rowCount = Number(row?.row_count ?? row?.ROW_COUNT ?? row?.['COUNT(*)']);
  assert.ok(Number.isFinite(rowCount) && rowCount >= 0, `View probe ${viewName} returned no non-negative count`);
  return {
    view: viewName,
    query_kind: 'fixed_count_only',
    query_ok: true,
    row_count: rowCount,
    row_values_returned: false,
    mutation_sql_allowed: false,
    secrets_included: false,
  };
}

async function verifyFinalState() {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const candidate = await exactReadback();
    await writeJson(`final-readback-${attempt}.json`, candidate.result);
    if (completeReadback(candidate.readback)) {
      finalReadback = candidate.readback;
      break;
    }
    if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  assert.ok(finalReadback, 'Exact ledger and five schema objects were not proven; Apply was not retried');
  finalViewProbes = [];
  for (const view of VIEW_PROBES) finalViewProbes.push(await fixedViewProbe(view));
  await writeJson('view-probes.json', finalViewProbes);
  return { readback: finalReadback, view_probes: finalViewProbes };
}

async function dryRun() {
  const payload = requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_execute',
    tool_args: {
      migration: MIGRATION,
      mode: 'dry_run',
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
    },
  }, 300000), 'governed_migration_1006_dry_run');
  const result = findObjectWithKey(payload, 'applies_sql') || payload;
  assert.equal(result?.applies_sql, false, 'Dry-run must report applies_sql=false');
  assert.equal(result?.mode, 'dry_run', 'Dry-run mode mismatch');
  assert.equal(String(result?.migration_checksum_sha256 || '').toLowerCase(), CHECKSUM, 'Dry-run checksum mismatch');
  assert.equal(Number(result?.statement_count), STATEMENT_COUNT, 'Dry-run statement count mismatch');
  assert.equal(result?.preflight?.status, 'pass', 'Migration preflight did not pass');
  assert.equal(Number(result?.preflight?.risk_count || 0), 0, 'Migration preflight has risks');
  await writeJson('dry-run.json', payload);
  return result;
}

async function bootstrapAuthorization(envelopeId) {
  const baseArgs = {
    migration: MIGRATION,
    expected_checksum_sha256: CHECKSUM,
    expected_statement_count: STATEMENT_COUNT,
    pull_request: SOURCE_PR,
    merge_sha: SOURCE_MERGE_SHA,
    confirm: AUTH_CONFIRM,
    capability_envelope_id: envelopeId,
    decision_note: 'Authorize the reviewed additive Migration 1006 after current Production runtime parity, exact checksum validation, zero-risk preflight, and same-cycle readback. This action does not execute migration SQL.',
  };

  const first = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: baseArgs,
  }, 300000);
  if (first.transport_ok && first.http_ok && first.payload?.ok !== false) return requireSuccess(first, 'governed_migration_1006_authorization_bootstrap');

  const errorObject = findObjectWithKey(first.payload, 'code') || first.payload?.error || {};
  const code = String(errorObject?.code || first.payload?.error?.code || '');
  const details = errorObject?.details || first.payload?.error?.details || {};
  const recorded = String(details?.recorded_checksum_sha256 || details?.current_checksum_sha256 || '').toLowerCase();
  assert.equal(code, 'governed_migration_authorization_previous_checksum_required', `Authorization bootstrap failed unexpectedly: ${code || 'unknown'}`);
  assert.match(recorded, /^[0-9a-f]{64}$/, 'Bootstrap did not expose a valid recorded checksum for one exact rotation retry');
  assert.notEqual(recorded, CHECKSUM, 'Recorded checksum unexpectedly equals the target checksum');
  await writeJson('authorization-rotation-discovery.json', { code, recorded_checksum_sha256: recorded, secrets_included: false });

  return requireSuccess(await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_authorization_bootstrap',
    tool_args: { ...baseArgs, previous_checksum_sha256: recorded },
  }, 300000), 'governed_migration_1006_authorization_rotation');
}

async function requireReadinessEvidence() {
  const comments = await githubJson(`/repos/${REPOSITORY}/issues/${CONTROL_ISSUE}/comments?per_page=100`);
  const candidates = comments.filter((comment) => String(comment?.body || '').includes(READINESS_MARKER));
  const matching = candidates.reverse().find((comment) => {
    const body = String(comment.body || '');
    return body.includes(`checksum=${CHECKSUM}`)
      && body.includes(`statement_count=${STATEMENT_COUNT}`)
      && body.includes(`production_sha=${productionSha}`)
      && body.includes('dry_run=pass')
      && body.includes('authorization=pass');
  });
  assert.ok(matching, 'No current checksum- and Production-bound readiness evidence exists on control issue #4122');
  return { comment_id: matching.id, created_at: matching.created_at, author: matching.user?.login || null };
}

async function runReadiness() {
  stage = 'runtime_parity';
  const runtime = await waitForRuntimeParity();
  await writeJson('runtime-parity.json', runtime);
  await writeState();

  stage = 'pre_authorization_readback';
  const initial = await exactReadback();
  await writeJson('pre-authorization-readback.json', initial.result);
  if (exactApplyLedger(initial.readback)) {
    const final = await verifyFinalState();
    const dependency = await checkGovernedMigrationDependencies({
      migration: '1007_sprint69_agent_capability_coverage_admin_tools.sql',
      expected_checksum_sha256: '11b93401bbd0ed64e3e564d183c5a5d9775bcabbe3ccd7002d97e38b0d107a40',
      expected_statement_count: 1,
    }, { runtimeBaseUrl: BASE, backendApiKey: KEY });
    return {
      schema_version: 'sprint69_1006_readiness.v1',
      result: 'already_applied',
      production_sha: productionSha,
      migration: MIGRATION,
      checksum: CHECKSUM,
      statement_count: STATEMENT_COUNT,
      authorization: 'not_required',
      dry_run: 'not_required',
      final_readback: sanitize(final),
      dependency_gate_1007: sanitize(dependency),
      database_mutation_executed: false,
      secrets_included: false,
    };
  }

  stage = 'authorization_envelope';
  const authorizationEnvelope = await createReadyEnvelope({
    capabilityKey: 'governed_migration_authorization_bootstrap',
    operationIntent: 'governed_migration_authorization_bootstrap',
    requestedBy: 'github_actions_sprint69_1006_readiness',
    decisionNote: 'Approve the checksum-bound authorization-bootstrap envelope for Migration 1006 readiness only; migration SQL is not executed in this phase.',
  });
  authorizationEnvelopeId = authorizationEnvelope.envelope.envelope_id;
  await writeJson('authorization-envelope.json', authorizationEnvelope);
  await writeState();

  stage = 'authorization_bootstrap';
  const authorization = await bootstrapAuthorization(authorizationEnvelopeId);
  await writeJson('authorization-bootstrap.json', authorization);
  await writeState({ authorization_bootstrap_verified: true });

  stage = 'governed_dry_run';
  await dryRun();
  await writeState({ dry_run_verified: true });

  stage = 'readiness_complete';
  return {
    schema_version: 'sprint69_1006_readiness.v1',
    result: 'pass',
    production_sha: productionSha,
    migration: MIGRATION,
    checksum: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    source_pr: SOURCE_PR,
    source_merge_sha: SOURCE_MERGE_SHA,
    authorization: 'pass',
    dry_run: 'pass',
    apply_executed: false,
    database_mutation_executed: false,
    provider_call_executed: false,
    external_write_executed: false,
    secrets_included: false,
  };
}

async function runApply() {
  stage = 'runtime_parity';
  const runtime = await waitForRuntimeParity();
  await writeJson('runtime-parity.json', runtime);
  await writeState();

  stage = 'readiness_evidence';
  const readiness = await requireReadinessEvidence();
  await writeJson('readiness-evidence.json', readiness);

  stage = 'readback_first';
  const initial = await exactReadback();
  await writeJson('initial-readback.json', initial.result);
  if (exactApplyLedger(initial.readback)) {
    const final = await verifyFinalState();
    const dependency = await checkGovernedMigrationDependencies({
      migration: '1007_sprint69_agent_capability_coverage_admin_tools.sql',
      expected_checksum_sha256: '11b93401bbd0ed64e3e564d183c5a5d9775bcabbe3ccd7002d97e38b0d107a40',
      expected_statement_count: 1,
    }, { runtimeBaseUrl: BASE, backendApiKey: KEY });
    return {
      schema_version: 'sprint69_1006_apply.v1',
      result: 'already_applied',
      production_sha: productionSha,
      checksum: CHECKSUM,
      statement_count: STATEMENT_COUNT,
      apply_sent_by_this_run: false,
      final_readback: sanitize(final),
      dependency_gate_1007: sanitize(dependency),
      secrets_included: false,
    };
  }

  stage = 'same_cycle_dry_run';
  await dryRun();

  stage = 'execution_envelope';
  const execution = await createReadyEnvelope({
    capabilityKey: 'governed_migration_execute',
    operationIntent: 'governed_migration_execute',
    requestedBy: 'github_actions_sprint69_1006_apply_once',
    decisionNote: 'Authorize one checksum-bound Apply for Migration 1006 after current runtime parity, current readiness evidence, same-cycle zero-risk dry-run, and readback-first duplicate prevention.',
    applyAuthorize: true,
  });
  executionEnvelopeId = execution.envelope.envelope_id;
  await writeJson('execution-envelope.json', execution);
  await writeState();

  stage = 'single_apply_request';
  applySent = true;
  await writeState();
  applyAttempt = await requestRaw('/gpt/tools/call', {
    name: 'governed_migration_execute',
    tool_args: {
      migration: MIGRATION,
      mode: 'apply',
      expected_checksum_sha256: CHECKSUM,
      expected_statement_count: STATEMENT_COUNT,
      confirm: APPLY_CONFIRM,
      capability_envelope_id: executionEnvelopeId,
      applied_by: 'github_actions_sprint69_1006_authorized',
      authorization_reference: `control-issue-${CONTROL_ISSUE}-exact-apply-confirmation`,
    },
  }, 360000);
  await writeJson('apply-attempt.json', applyAttempt);
  await writeState();
  // Deliberately no Apply retry. Any transport or HTTP ambiguity is reconciled through readback only.

  stage = 'final_readback';
  const final = await verifyFinalState();

  stage = 'dependency_gate_1007';
  const dependency = await checkGovernedMigrationDependencies({
    migration: '1007_sprint69_agent_capability_coverage_admin_tools.sql',
    expected_checksum_sha256: '11b93401bbd0ed64e3e564d183c5a5d9775bcabbe3ccd7002d97e38b0d107a40',
    expected_statement_count: 1,
  }, { runtimeBaseUrl: BASE, backendApiKey: KEY });
  await writeJson('dependency-gate-1007.json', dependency);

  stage = 'apply_complete';
  return {
    schema_version: 'sprint69_1006_apply.v1',
    result: 'pass',
    production_sha: productionSha,
    migration: MIGRATION,
    checksum: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    apply_sent_by_this_run: true,
    apply_retried: false,
    apply_transport_ok: applyAttempt?.transport_ok ?? null,
    apply_http_status: applyAttempt?.status ?? null,
    exact_apply_ledger_verified: true,
    expected_objects_verified: EXPECTED_OBJECTS,
    view_probes: sanitize(final.view_probes),
    dependency_gate_1007: sanitize(dependency),
    provider_call_executed: false,
    external_write_executed: false,
    secrets_included: false,
  };
}

async function verifyLocalContract() {
  assert.ok(['readiness', 'apply'].includes(PHASE), 'ROLLOUT_PHASE must be readiness or apply');
  assert.equal(BASE, 'https://auth.mad4b.com', 'Runtime base URL must remain the canonical auth host');
  assert.ok(KEY, 'BACKEND_API_KEY is required');
  assert.ok(GH_TOKEN, 'GH_READ_TOKEN is required');
  assert.equal(REPOSITORY, 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os');
  assert.equal(CONTROL_ISSUE, 4122);
  const sql = await fs.readFile(MIGRATION_PATH, 'utf8');
  assert.equal(createHash('sha256').update(sql, 'utf8').digest('hex'), CHECKSUM, 'Pinned Migration 1006 checksum changed');
  assert.equal(splitMigrationSqlStatements(sql).length, STATEMENT_COUNT, 'Pinned Migration 1006 statement count changed');
  const forbidden = /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|REPLACE)\b/i;
  for (const view of VIEW_PROBES) {
    const sqlProbe = `SELECT COUNT(*) AS row_count FROM \`${view}\`;`;
    assert.equal(forbidden.test(sqlProbe), false, 'View probe must be read-only');
  }
}

async function main() {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await verifyLocalContract();
  await writeState({ local_contract_verified: true });
  const summary = PHASE === 'readiness' ? await runReadiness() : await runApply();
  await writeJson('summary.json', summary);
  await writeState({ ok: true, result: summary.result });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(async (error) => {
  const failure = {
    schema_version: 'sprint69_1006_governed_rollout_failure.v1',
    ok: false,
    phase: PHASE,
    stage,
    error: {
      code: String(error?.code || 'sprint69_1006_governed_rollout_failed'),
      message: String(error?.message || error || 'Unknown failure').slice(0, 1000),
      details: sanitize(error?.details || undefined),
    },
    production_sha: productionSha,
    migration: MIGRATION,
    checksum: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    apply_sent: applySent,
    apply_transport_ok: applyAttempt?.transport_ok ?? null,
    apply_http_status: applyAttempt?.status ?? null,
    exact_apply_ledger_verified: Boolean(finalReadback),
    view_probes_verified: Boolean(finalViewProbes),
    provider_call_executed: false,
    external_write_executed: false,
    secrets_included: false,
  };
  try {
    await writeJson('failure.json', failure);
    await writeState({ failure: failure.error });
  } catch { }
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
});
