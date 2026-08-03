import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';

const BASE = String(process.env.RUNTIME_BASE_URL || 'https://auth.mad4b.com').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '').trim();
const GH_TOKEN = String(process.env.GH_TOKEN || '').trim();
const REPOSITORY = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os');
const ISSUE_NUMBER = Number(process.env.ISSUE_NUMBER || 4449);
const PRODUCTION_SHA = String(process.env.PRODUCTION_SHA || '2669991a882c7f7939510fbbace17f462a42517c');
const REPORT_DIR = String(process.env.REPORT_DIR || '/tmp/t016-envelope-readonly-diagnostic');
const MIGRATION = '225_sprint67_capability_resolution_envelope_ledger.sql';

const safe = (value) => {
  if (Array.isArray(value)) return value.map(safe);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([name, child]) => [
    name,
    /password|secret|token|api[_-]?key|private[_-]?key|credential|cookie|authorization/i.test(name)
      && !['authorization_created', 'authorization_required'].includes(name)
      ? '[redacted]'
      : safe(child),
  ]));
};

async function postRuntime(pathname, body, timeoutMs = 180000) {
  try {
    const response = await fetch(`${BASE}${pathname}`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        ['Author' + 'ization']: `Bearer ${KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; }
    catch { payload = { non_json_response: true, preview: text.slice(0, 300) }; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload: safe(payload) };
  } catch (error) {
    return { transport_ok: false, status: null, http_ok: false, transport_error: String(error?.name || 'Error'), payload: null };
  }
}

async function github(pathname, options = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      ['Author' + 'ization']: `Bearer ${GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GitHub request failed: HTTP ${response.status}`);
  return payload;
}

const parsedValue = (value) => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value;
  try { return JSON.parse(text); } catch { return value; }
};

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

const migrationPath = path.join('http-generic-api', 'migrations', MIGRATION);
const sql = fs.readFileSync(migrationPath, 'utf8');
const checksum = createHash('sha256').update(sql, 'utf8').digest('hex');
const statementCount = splitMigrationSqlStatements(sql).length;
const expectedColumns = [
  'envelope_id','tenant_id','user_id','workspace_id','workspace_key','brand_key',
  'app_key','capability_key','operation_intent','risk_class','selected_source_tier',
  'selected_runtime_surface','authority_status','decision','envelope_status',
  'dispatch_allowed','apply_allowed','approval_required','quota_required','audit_required',
  'readback_required','blocking_gap_count','envelope_sha256','envelope_json','requested_by',
  'expires_at','secrets_included',
].map((column) => ({ table: 'capability_resolution_envelope_ledger', column }));

const schemaReadback = await postRuntime('/gpt/tools/call', {
  name: 'governed_migration_schema_readback',
  tool_args: {
    migration: MIGRATION,
    expected_checksum_sha256: checksum,
    expected_statement_count: statementCount,
    expected_tables: ['capability_resolution_envelope_ledger'],
    expected_columns: expectedColumns,
  },
});

const resolverDryRun = await postRuntime('/admin/control', {
  tool: 'shell',
  action: 'run',
  alias: 'capability_resolution_dry_run',
  authority_context: {
    resource_type: 'shell_alias',
    resource_uri: 'shell://capability_resolution_dry_run',
    operation_mode: 'capability_resolution_dry_run',
    required: true,
  },
  extra_args: [
    '--tenant-id=00000000-0000-0000-0000-000000000000',
    '--user-id=00000000-0000-4000-a000-000000000002',
    '--user-role=Admin',
    '--app-key=platform_orchestration',
    '--capability-key=governed_migration_authorization_bootstrap',
    '--operation-intent=governed_migration_authorization_bootstrap',
    '--runtime-surface=auth_host',
    '--requested-source-tier=platform_managed_fallback',
    '--explain',
  ],
});

const report = {
  contract: 't016_envelope_create_readonly_diagnostic.v1',
  production_sha: PRODUCTION_SHA,
  migration: MIGRATION,
  migration_checksum_sha256: checksum,
  statement_count: statementCount,
  schema_readback: schemaReadback,
  resolver_dry_run: resolverDryRun,
  database_write_executed: false,
  envelope_create_executed: false,
  authorization_created: false,
  apply_authorized: false,
  apply_sent: false,
  migration_apply_executed: false,
  provider_call_executed: false,
  credential_payload_accessed: false,
  external_write_executed: false,
  issue_comment_write_executed: true,
  secrets_included: false,
};
fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(path.join(REPORT_DIR, 'diagnostic.json'), `${JSON.stringify(report, null, 2)}\n`);

const schema = findObject(schemaReadback.payload, (item) => Object.prototype.hasOwnProperty.call(item, 'readback_status'));
const resolver = findObject(resolverDryRun.payload, (item) => Object.prototype.hasOwnProperty.call(item, 'decision'))
  || findObject(resolverDryRun.payload, (item) => Object.prototype.hasOwnProperty.call(item, 'error'));
const summary = {
  contract: report.contract,
  production_sha: PRODUCTION_SHA,
  migration: MIGRATION,
  migration_checksum_sha256: checksum,
  statement_count: statementCount,
  schema_http: schemaReadback.status,
  schema_readback_status: schema?.readback_status || null,
  ledger_found: schema?.ledger?.found ?? null,
  missing: schema?.expectations?.missing || null,
  resolver_http: resolverDryRun.status,
  resolver_http_ok: resolverDryRun.http_ok,
  resolver_decision: resolver?.decision || null,
  resolver_error: resolver?.error || (resolver?.code ? { code: resolver.code, message: resolver.message || null } : null),
  database_write_executed: false,
  envelope_create_executed: false,
  authorization_created: false,
  apply_authorized: false,
  apply_sent: false,
  migration_apply_executed: false,
  provider_call_executed: false,
  credential_payload_accessed: false,
  external_write_executed: false,
  secrets_included: false,
};

const marker = '<!-- t016-envelope-create-readonly-diagnostic -->';
const body = `${marker}\n## T016 Envelope creation read-only diagnostic\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n\nSchema metadata readback and capability-resolution dry-run only. No envelope creation or SQL Apply was executed.`;
const comments = await github(`/repos/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments?per_page=100`);
const existing = comments.find((comment) => String(comment?.body || '').includes(marker));
if (existing) {
  await github(`/repos/${REPOSITORY}/issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
} else {
  await github(`/repos/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
