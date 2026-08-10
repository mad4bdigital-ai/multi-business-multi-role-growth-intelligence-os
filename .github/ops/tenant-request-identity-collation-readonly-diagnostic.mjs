import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { buildAdminControlDbReadRequest } from './lib/admin-control-db-request.mjs';

const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH_TOKEN = String(process.env.GH_READ_TOKEN || '').trim();
const REPOSITORY = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const EVIDENCE_DIR = String(process.env.EVIDENCE_DIR || '.artifacts/tenant-request-identity-collation-readonly-diagnostic').trim();

const MIGRATION = '20260808_tenant_request_identity_collation_alignment.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const MIGRATION_BLOB_SHA = '5f68a02f351a4cf80fa89a826abe3c92412f7079';
const RESOURCE_URI = `db-migration://growth_intelligence_platform/${MIGRATION}`;
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const PLATFORM_ADMIN_USER_ID = '00000000-0000-4000-a000-000000000002';
const DIAGNOSTIC_TRIGGER = 'RUN_READ_ONLY_DIAGNOSTIC_20260808_TENANT_REQUEST_IDENTITY_COLLATION_ALIGNMENT';

const SENSITIVE_KEY = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;
const SAFE_FALSE_EVIDENCE_KEYS = new Set([
  'mutation_requested',
  'envelope_write_attempted',
  'authorization_bootstrap_attempted',
  'governed_migration_execute_attempted',
  'migration_sql_executed',
  'apply_authorized',
  'apply_sent',
  'provider_call_executed',
  'credential_payload_accessed',
  'external_business_write_executed',
  'secrets_included',
]);
const SECRET_TEXT_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
];

function sanitizeText(value = '') {
  let text = String(value || '').slice(0, 16000);
  for (const pattern of SECRET_TEXT_PATTERNS) text = text.replace(pattern, '[redacted]');
  return text;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? sanitizeText(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const preserveFalse = child === false && SAFE_FALSE_EVIDENCE_KEYS.has(key);
    return [
      key,
      preserveFalse ? false : (SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(child)),
    ];
  }));
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return sanitizeText(value);
  try { return JSON.parse(text); } catch { return sanitizeText(value); }
}

async function writeJson(name, value) {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(`${EVIDENCE_DIR}/${name}`, `${JSON.stringify(sanitize(value), null, 2)}\n`, 'utf8');
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

async function currentRefSha(branch) {
  const ref = await githubJson(`/repos/${REPOSITORY}/git/ref/heads/${branch}`);
  const sha = String(ref?.object?.sha || '').toLowerCase();
  assert.match(sha, /^[0-9a-f]{40}$/, `${branch} ref did not return a full SHA`);
  return sha;
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
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { non_json_response: true }; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  } catch (error) {
    return { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: String(error?.name || 'Error') };
  }
}

async function requestRaw(pathname, body, timeoutMs = 180000) {
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
    catch { payload = { non_json_response: true, raw_preview: sanitizeText(text.slice(0, 3000)) }; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  } catch (error) {
    return { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: String(error?.name || 'Error') };
  }
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

function dbReadInvocation(sql, params = [], maxRows = 100, resourceSuffix = 'readback') {
  assert.match(sql.trim(), /^SELECT\b/i, 'Diagnostic DB query must be SELECT-only');
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE)\b/i, 'Diagnostic DB query contains a mutating keyword');
  return buildAdminControlDbReadRequest({
    sql,
    params,
    maxRows,
    authorityContext: {
      resource_type: 'database_query',
      resource_uri: `db://growth_intelligence_platform/tenant_request_identity_collation_readonly_diagnostic/${resourceSuffix}`,
      operation_mode: 'read_only',
      required: true,
    },
  });
}

function commandEvidence(result) {
  const error = result?.payload?.error || null;
  return {
    transport_ok: result?.transport_ok === true,
    http_status: result?.status ?? null,
    http_ok: result?.http_ok === true,
    response_ok: result?.payload?.ok ?? null,
    error_code: error?.code || result?.payload?.error_code || null,
    error_message: error?.message || result?.payload?.message || null,
    exit_code: error?.exit_code ?? error?.exitCode ?? null,
    stdout: parseMaybeJson(error?.stdout ?? result?.payload?.stdout ?? null),
    stderr: parseMaybeJson(error?.stderr ?? result?.payload?.stderr ?? null),
    payload: result?.payload || null,
  };
}

function skippedCommandEvidence(reason) {
  return {
    skipped: true,
    reason,
  };
}

function safetyBoundaryEvidence() {
  return {
    mutation_requested: false,
    envelope_write_attempted: false,
    authorization_bootstrap_attempted: false,
    governed_migration_execute_attempted: false,
    migration_sql_executed: false,
    apply_authorized: false,
    apply_sent: false,
    provider_call_executed: false,
    credential_payload_accessed: false,
    external_business_write_executed: false,
    secrets_included: false,
  };
}

async function main() {
  assert.ok(KEY, 'BACKEND_API_KEY is required');
  assert.ok(GH_TOKEN, 'GH_READ_TOKEN is required');

  const [mainSha, productionSha] = await Promise.all([
    currentRefSha('main'),
    currentRefSha('Production'),
  ]);
  const productionFile = await githubJson(`/repos/${REPOSITORY}/contents/${MIGRATION_PATH}?ref=${productionSha}`);
  assert.equal(String(productionFile?.sha || '').toLowerCase(), MIGRATION_BLOB_SHA, 'Production migration blob does not match reviewed source');

  const [health, version, deployment] = await Promise.all([
    requestGet(`${BASE}/health`),
    requestGet(`${BASE}/version`),
    requestGet(`${BASE}/deployment-info`),
  ]);

  const runtimeCommitSha = String(deployment?.payload?.commit_sha || deployment?.payload?.commit || '').trim().toLowerCase();
  const runtimeDeploymentHealthy = deployment?.transport_ok === true
    && deployment?.http_ok === true
    && deployment?.payload?.ok === true;
  const runtimeCommitValid = /^[0-9a-f]{40}$/.test(runtimeCommitSha);
  const runtimeConverged = runtimeDeploymentHealthy
    && runtimeCommitValid
    && runtimeCommitSha === productionSha;
  const runtime = {
    health: { status: health.status, ok: health.http_ok && health.payload?.ok === true },
    version: { status: version.status, ok: version.http_ok },
    deployment_info: {
      status: deployment.status,
      ok: runtimeDeploymentHealthy,
      commit_sha: runtimeCommitValid ? runtimeCommitSha : null,
      matches_production_ref: runtimeConverged,
    },
  };

  if (!runtimeConverged) {
    const skipped = skippedCommandEvidence('runtime_not_converged');
    const evidence = {
      contract: 'tenant_request_identity_collation_readonly_diagnostic.v1',
      diagnostic_trigger: DIAGNOSTIC_TRIGGER,
      diagnostic_classification: 'runtime_not_converged',
      main_sha: mainSha,
      production_sha: productionSha,
      migration: MIGRATION,
      migration_blob_sha: MIGRATION_BLOB_SHA,
      runtime,
      capability_resolution_dry_run: skipped,
      ledger_schema_readback: skipped,
      tool_registry_readback: skipped,
      policy_readback: skipped,
      recent_matching_envelopes_readback: skipped,
      ...safetyBoundaryEvidence(),
    };
    await writeJson('diagnostic.json', evidence);
    throw new Error('Runtime deployment is not converged to the current Production ref; resolver diagnostic was not executed');
  }

  const resolverResult = await requestRaw('/admin/control', shellInvocation('capability_resolution_dry_run', [
    `--tenant-id=${PLATFORM_TENANT_ID}`,
    `--user-id=${PLATFORM_ADMIN_USER_ID}`,
    '--user-role=Admin',
    '--app-key=platform_orchestration',
    '--capability-key=governed_migration_authorization_bootstrap',
    '--operation-intent=governed_migration_authorization_bootstrap',
    '--runtime-surface=auth_host',
    '--requested-source-tier=platform_managed_fallback',
    '--explain',
    `--resource-uri=${RESOURCE_URI}`,
    `--expected-commit-sha=${runtimeCommitSha}`,
  ]));

  const ledgerSchemaResult = await requestRaw('/admin/control', dbReadInvocation(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLLATION_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'capability_resolution_envelope_ledger'
      ORDER BY ORDINAL_POSITION`,
    [],
    100,
    'capability_resolution_envelope_ledger_schema'
  ));

  const registryResult = await requestRaw('/admin/control', dbReadInvocation(
    `SELECT tool_key, http_method, http_path, is_enabled
       FROM admin_platform_endpoint_tools
      WHERE tool_key IN ('capability_resolution_envelope_create','capability_resolution_dry_run')
      ORDER BY tool_key`,
    [],
    10,
    'capability_tool_registry'
  ));

  const policyResult = await requestRaw('/admin/control', dbReadInvocation(
    `SELECT config_key, status
       FROM platform_runtime_config
      WHERE config_key IN ('capability_resolution_envelope_ledger_policy_v1','dynamic_capability_resolution_policy_v1','dynamic_capability_source_tiers_v1')
      ORDER BY config_key`,
    [],
    10,
    'capability_runtime_policy'
  ));

  const recentLedgerResult = await requestRaw('/admin/control', dbReadInvocation(
    `SELECT envelope_id, app_key, capability_key, operation_intent, envelope_status,
            dispatch_allowed, apply_allowed, approval_required, quota_required,
            blocking_gap_count, execution_status, secrets_included, created_at
       FROM capability_resolution_envelope_ledger
      WHERE app_key = 'platform_orchestration'
        AND capability_key = 'governed_migration_authorization_bootstrap'
      ORDER BY id DESC
      LIMIT 5`,
    [],
    5,
    'recent_matching_envelopes'
  ));

  const evidence = {
    contract: 'tenant_request_identity_collation_readonly_diagnostic.v1',
    diagnostic_trigger: DIAGNOSTIC_TRIGGER,
    diagnostic_classification: 'resolver_diagnostic_executed',
    main_sha: mainSha,
    production_sha: productionSha,
    migration: MIGRATION,
    migration_blob_sha: MIGRATION_BLOB_SHA,
    runtime,
    capability_resolution_dry_run: commandEvidence(resolverResult),
    ledger_schema_readback: commandEvidence(ledgerSchemaResult),
    tool_registry_readback: commandEvidence(registryResult),
    policy_readback: commandEvidence(policyResult),
    recent_matching_envelopes_readback: commandEvidence(recentLedgerResult),
    ...safetyBoundaryEvidence(),
  };

  await writeJson('diagnostic.json', evidence);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    contract: evidence.contract,
    diagnostic_classification: evidence.diagnostic_classification,
    runtime_commit_sha: runtimeCommitSha,
    resolver_http_status: resolverResult.status,
    resolver_http_ok: resolverResult.http_ok,
    ledger_schema_http_status: ledgerSchemaResult.status,
    mutation_requested: false,
    migration_sql_executed: false,
    apply_authorized: false,
    secrets_included: false,
  }, null, 2)}\n`);
}

await main();
