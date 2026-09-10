import { promises as fs } from 'node:fs';

const PHASE = String(process.env.ROLLOUT_PHASE || '').trim();
const DIR = String(process.env.EVIDENCE_DIR || `${process.env.RUNNER_TEMP || '/tmp'}/github-repository-policy-1050`).trim();
const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH = String(process.env.GH_READ_TOKEN || '').trim();
const REPO = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const originalFetch = globalThis.fetch;
const ROLE_ORDER = Object.freeze(['runtime', 'governance', 'runtime_persistence']);
const OBJECT_KINDS = Object.freeze(['total', 'tables', 'views', 'triggers', 'routines', 'events']);
let adminControlFailureCount = 0;
let foundationInspectionAttempted = false;

function safeCode(value) {
  const code = String(value || '').trim();
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(code) ? code : null;
}

function safeText(value, max = 128) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return typeof input?.url === 'string' ? input.url : '';
}

function containsText(value, needle, seen = new Set()) {
  if (typeof value === 'string') return value.includes(needle);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((child) => containsText(child, needle, seen));
  return Object.values(value).some((child) => containsText(child, needle, seen));
}

function findObject(value, predicate, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    const found = findObject(child, predicate, seen);
    if (found) return found;
  }
  return null;
}

function parseChildErrorCode(payload) {
  const adminError = payload?.error && typeof payload.error === 'object' ? payload.error : null;
  const stdout = typeof adminError?.stdout === 'string' ? adminError.stdout.trim() : '';
  if (!stdout) return { parseable: false, code: null, child_secrets_included: null, foundation_ledger_missing: false };
  try {
    const parsed = JSON.parse(stdout);
    const code = safeCode(parsed?.error?.code);
    return {
      parseable: true,
      code,
      child_secrets_included: parsed?.secrets_included === false ? false : null,
      foundation_ledger_missing: code === 'ER_NO_SUCH_TABLE' && containsText(parsed, 'capability_resolution_envelope_ledger'),
    };
  } catch {
    return { parseable: false, code: null, child_secrets_included: null, foundation_ledger_missing: false };
  }
}

function boundedRoleEvidence(payload) {
  const source = findObject(payload, (candidate) =>
    candidate && typeof candidate === 'object' && (
      candidate.role_database_object_classifications ||
      candidate.role_database_object_counts ||
      candidate.selected_rebuild_roles
    ));
  if (!source) return {
    selected_rebuild_roles: [],
    role_database_object_classifications: {},
    role_database_object_counts: {},
    role_database_object_count_fingerprints: {},
    target_fingerprint: null,
  };

  const selected = Array.isArray(source.selected_rebuild_roles)
    ? source.selected_rebuild_roles.map((role) => String(role)).filter((role) => ROLE_ORDER.includes(role))
    : [];
  const classifications = {};
  const counts = {};
  const fingerprints = {};
  for (const role of ROLE_ORDER) {
    const classification = safeText(source.role_database_object_classifications?.[role], 64);
    if (classification) classifications[role] = classification;
    const roleCounts = source.role_database_object_counts?.[role];
    if (roleCounts && typeof roleCounts === 'object') {
      counts[role] = Object.fromEntries(OBJECT_KINDS.map((kind) => [kind, Number.isFinite(Number(roleCounts[kind])) ? Number(roleCounts[kind]) : null]));
    }
    const fingerprint = String(source.role_database_object_count_fingerprints?.[role] || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(fingerprint)) fingerprints[role] = fingerprint;
  }
  const targetFingerprint = String(source.target_binding?.target_fingerprint || '').trim().toLowerCase();
  return {
    selected_rebuild_roles: selected,
    role_database_object_classifications: classifications,
    role_database_object_counts: counts,
    role_database_object_count_fingerprints: fingerprints,
    target_fingerprint: /^[0-9a-f]{64}$/.test(targetFingerprint) ? targetFingerprint : null,
  };
}

async function writeBoundedJson(name, value) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(`${DIR}/${name}`, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readProductionHead() {
  if (!GH) {
    const error = new Error('GitHub read token unavailable');
    error.code = 'foundation_inspection_github_token_unavailable';
    throw error;
  }
  const response = await originalFetch(`https://api.github.com/repos/${REPO}/git/ref/heads/Production`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GH}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => null);
  const sha = String(payload?.object?.sha || '').trim().toLowerCase();
  if (!response.ok || !/^[0-9a-f]{40}$/.test(sha)) {
    const error = new Error('Production head readback failed');
    error.code = 'foundation_inspection_production_head_unavailable';
    throw error;
  }
  return sha;
}

async function runGovernanceFoundationInspection() {
  if (foundationInspectionAttempted || PHASE !== 'readiness') return;
  foundationInspectionAttempted = true;

  let report = {
    contract: 'github_repository_policy_1050_governance_foundation_inspection.v1',
    phase: PHASE,
    trigger: 'capability_resolution_envelope_ledger_missing',
    attempted: true,
    result: 'inspection_failed',
    production_sha: null,
    environment_key: 'production_hostinger_autodeploy',
    operation_key: 'database.inspect',
    runbook_key: 'database.full_inspection',
    action: 'dry_run',
    target_source: 'host_local_role_env',
    target_key: 'production-runtime',
    migration_selected: false,
    http_status: null,
    response_error_code: null,
    database_connection_performed: false,
    database_mutation_performed: false,
    migration_apply_performed: false,
    grant_mutation_performed: false,
    workflow_dispatch_performed: false,
    read_only: true,
    selected_rebuild_roles: [],
    role_database_object_classifications: {},
    role_database_object_counts: {},
    role_database_object_count_fingerprints: {},
    target_fingerprint: null,
    raw_stdout_included: false,
    raw_stderr_included: false,
    error_message_included: false,
    request_headers_included: false,
    response_headers_included: false,
    credentials_included: false,
    secrets_included: false,
  };

  try {
    if (!KEY) {
      const error = new Error('Backend service key unavailable');
      error.code = 'foundation_inspection_backend_key_unavailable';
      throw error;
    }
    const productionSha = await readProductionHead();
    report.production_sha = productionSha;
    const response = await originalFetch(`${BASE}/admin/runtime-bootstrap/runs`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        environment_key: 'production_hostinger_autodeploy',
        operation_key: 'database.inspect',
        runbook_key: 'database.full_inspection',
        action: 'dry_run',
        expected_sha: productionSha,
        target_source: 'host_local_role_env',
        target_key: 'production-runtime',
      }),
      signal: AbortSignal.timeout(180000),
    });
    const text = await response.text();
    if (text.length > 262144) {
      const error = new Error('Inspection response exceeded bounded size');
      error.code = 'foundation_inspection_response_too_large';
      throw error;
    }
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    report.http_status = Number(response.status || 0) || null;
    report.response_error_code = safeCode(payload?.error?.code);
    report.database_connection_performed = payload?.database_connection_performed === true;
    report.database_mutation_performed = payload?.database_mutation_performed === true;
    report.migration_apply_performed = payload?.migration_apply_performed === true;
    report.grant_mutation_performed = payload?.grant_mutation_performed === true;
    report.workflow_dispatch_performed = payload?.workflow_dispatch_performed === true;

    if (!response.ok || payload?.ok === false) {
      report.result = 'inspection_request_failed';
    } else if (
      payload?.database_mutation_performed !== false ||
      payload?.migration_apply_performed !== false ||
      payload?.grant_mutation_performed !== false ||
      payload?.workflow_dispatch_performed !== false
    ) {
      report.result = 'unsafe_inspection_receipt_rejected';
    } else {
      const evidence = boundedRoleEvidence(payload);
      report = {
        ...report,
        ...evidence,
        result: 'inspection_complete',
        database_connection_performed: payload?.database_connection_performed === true,
        database_mutation_performed: false,
        migration_apply_performed: false,
        grant_mutation_performed: false,
        workflow_dispatch_performed: false,
        read_only: true,
      };
    }
  } catch (error) {
    report.response_error_code = safeCode(error?.code) || 'foundation_inspection_failed';
  }

  await writeBoundedJson('governance-foundation-inspection.json', report);
}

async function recordAdminControlFailure(response) {
  if (PHASE !== 'readiness' || response.ok) return;
  try {
    const payload = await response.clone().json();
    const adminError = payload?.error && typeof payload.error === 'object' ? payload.error : null;
    const child = parseChildErrorCode(payload);
    adminControlFailureCount += 1;
    await writeBoundedJson(
      `admin-control-failure-diagnostic-${adminControlFailureCount}.json`,
      {
        contract: 'github_repository_policy_1050_readiness_failure_diagnostic.v2',
        phase: PHASE,
        transport: 'admin_control',
        http_status: Number(response.status || 0) || null,
        admin_error_code: safeCode(adminError?.code),
        exit_code: Number.isInteger(adminError?.exit_code) ? adminError.exit_code : null,
        child_error_json_parseable: child.parseable,
        child_error_code: child.code,
        child_secrets_included: child.child_secrets_included,
        governance_foundation_ledger_missing: child.foundation_ledger_missing,
        read_only_foundation_inspection_triggered: child.foundation_ledger_missing,
        raw_stdout_included: false,
        raw_stderr_included: false,
        error_message_included: false,
        request_body_included: false,
        response_headers_included: false,
        request_headers_included: false,
        request_retried: false,
        secrets_included: false,
      }
    );
    if (child.foundation_ledger_missing) await runGovernanceFoundationInspection();
  } catch {
    // Diagnostic capture must never alter or retry the governed request.
  }
}

globalThis.fetch = async (input, init) => {
  const response = await originalFetch(input, init);
  const url = requestUrl(input);
  if (PHASE === 'readiness' && /\/admin\/control(?:$|[?#])/.test(url) && !response.ok) {
    await recordAdminControlFailure(response);
  }
  return response;
};

await import('./github-repository-policy-1050-governed-rollout.mjs');
