import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';
import { buildAdminControlDbReadRequest } from './lib/admin-control-db-request.mjs';

const MIGRATION = '1051_github_repository_policy_live_apply_authority.sql';
const MIGRATION_PATH = new URL(`../../http-generic-api/migrations/${MIGRATION}`, import.meta.url);
const EXPECTED_STATEMENT_COUNT = 6;
const EXPECTED_TABLES = Object.freeze([
  'platform_resource_adapters',
  'platform_capability_readback_contracts',
  'capability_apply_authorization_policy_registry',
  'repository_capability_bindings',
  'repository_capability_policy_layers',
  'governed_migration_authorization_registry',
]);

export const METADATA_STATE_SQL = `SELECT
  (SELECT COUNT(*) FROM platform_resource_adapters WHERE adapter_key='github_repository_policy_v2') AS adapter_count,
  (SELECT COUNT(*) FROM platform_capability_readback_contracts WHERE contract_key='github_repository_policy_controller_readback_v2' AND is_current=1) AS readback_contract_count,
  (SELECT COUNT(*) FROM capability_apply_authorization_policy_registry WHERE policy_key='github_repository_policy_controller_apply_v1') AS apply_policy_count,
  (SELECT COUNT(*) FROM repository_capability_bindings WHERE capability_binding_key='growth_intelligence_platform.github.repository_policy_controller.production') AS capability_binding_count,
  (SELECT COUNT(*) FROM repository_capability_policy_layers layer_row
     JOIN repository_capability_bindings binding ON binding.capability_binding_id=layer_row.capability_binding_id
    WHERE binding.capability_binding_key='growth_intelligence_platform.github.repository_policy_controller.production'
      AND ((layer_row.scope_type='platform' AND layer_row.scope_ref='*')
        OR (layer_row.scope_type='repository' AND layer_row.scope_ref='growth_intelligence_platform.github.primary.production')
        OR (layer_row.scope_type='environment' AND layer_row.scope_ref='production'))) AS expected_policy_layer_count,
  (SELECT COUNT(*) FROM repository_capability_policy_layers layer_row
     JOIN repository_capability_bindings binding ON binding.capability_binding_id=layer_row.capability_binding_id
    WHERE binding.capability_binding_key='growth_intelligence_platform.github.repository_policy_controller.production') AS total_policy_layer_count,
  (SELECT COUNT(*) FROM governed_migration_authorization_registry WHERE migration_file='1051_github_repository_policy_live_apply_authority.sql') AS migration_authorization_count,
  (SELECT status FROM platform_resource_adapters WHERE adapter_key='github_repository_policy_v2' LIMIT 1) AS adapter_status,
  (SELECT status FROM platform_capability_readback_contracts WHERE contract_key='github_repository_policy_controller_readback_v2' AND is_current=1 LIMIT 1) AS readback_status,
  (SELECT status FROM capability_apply_authorization_policy_registry WHERE policy_key='github_repository_policy_controller_apply_v1' LIMIT 1) AS apply_policy_status,
  (SELECT runtime_surface FROM capability_apply_authorization_policy_registry WHERE policy_key='github_repository_policy_controller_apply_v1' LIMIT 1) AS apply_runtime_surface,
  (SELECT allow_external_write FROM capability_apply_authorization_policy_registry WHERE policy_key='github_repository_policy_controller_apply_v1' LIMIT 1) AS allow_external_write,
  (SELECT requires_typed_confirmation FROM capability_apply_authorization_policy_registry WHERE policy_key='github_repository_policy_controller_apply_v1' LIMIT 1) AS requires_typed_confirmation,
  (SELECT requires_same_cycle_dry_run FROM capability_apply_authorization_policy_registry WHERE policy_key='github_repository_policy_controller_apply_v1' LIMIT 1) AS requires_same_cycle_dry_run,
  (SELECT readiness_status FROM v_repository_capability_binding_readiness WHERE capability_binding_key='growth_intelligence_platform.github.repository_policy_controller.production' LIMIT 1) AS capability_readiness,
  (SELECT policy_key FROM v_repository_capability_binding_readiness WHERE capability_binding_key='growth_intelligence_platform.github.repository_policy_controller.production' LIMIT 1) AS capability_policy_key,
  (SELECT authorization_status FROM governed_migration_authorization_registry WHERE migration_file='1051_github_repository_policy_live_apply_authority.sql' LIMIT 1) AS migration_authorization_status,
  (SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.live_github_policy_apply')) FROM governed_migration_authorization_registry WHERE migration_file='1051_github_repository_policy_live_apply_authority.sql' LIMIT 1) AS live_github_policy_apply;`;

const count = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export function classifyMetadataPresence(row = {}) {
  const counts = Object.freeze({
    adapter: count(row.adapter_count),
    readback_contract: count(row.readback_contract_count),
    apply_policy: count(row.apply_policy_count),
    capability_binding: count(row.capability_binding_count),
    expected_policy_layers: count(row.expected_policy_layer_count),
    total_policy_layers: count(row.total_policy_layer_count),
    migration_authorization: count(row.migration_authorization_count),
  });
  const targetAbsent = counts.adapter === 0
    && counts.readback_contract === 0
    && counts.apply_policy === 0
    && counts.capability_binding === 0
    && counts.expected_policy_layers === 0
    && counts.total_policy_layers === 0;
  const targetComplete = counts.adapter === 1
    && counts.readback_contract === 1
    && counts.apply_policy === 1
    && counts.capability_binding === 1
    && counts.expected_policy_layers === 3
    && counts.total_policy_layers === 3;
  const target_metadata_state = targetAbsent ? 'absent' : targetComplete ? 'complete' : 'partial';
  const authorization_state = counts.migration_authorization === 0
    ? 'absent'
    : counts.migration_authorization === 1 ? 'present' : 'invalid_multiple';
  return {
    counts,
    presence: {
      adapter: counts.adapter === 1,
      readback_contract: counts.readback_contract === 1,
      apply_policy: counts.apply_policy === 1,
      capability_binding: counts.capability_binding === 1,
      expected_policy_layers: counts.expected_policy_layers === 3 && counts.total_policy_layers === 3,
      migration_authorization: counts.migration_authorization === 1,
    },
    target_metadata_state,
    authorization_state,
    metadata_present: targetComplete && counts.migration_authorization === 1,
    replay_safe_without_exact_ledger: targetAbsent,
  };
}

const safeMetadata = (row = {}) => ({
  adapter_status: row.adapter_status ?? null,
  readback_status: row.readback_status ?? null,
  apply_policy_status: row.apply_policy_status ?? null,
  apply_runtime_surface: row.apply_runtime_surface ?? null,
  allow_external_write: row.allow_external_write ?? null,
  requires_typed_confirmation: row.requires_typed_confirmation ?? null,
  requires_same_cycle_dry_run: row.requires_same_cycle_dry_run ?? null,
  capability_readiness: row.capability_readiness ?? null,
  capability_policy_key: row.capability_policy_key ?? null,
  migration_authorization_status: row.migration_authorization_status ?? null,
  live_github_policy_apply: row.live_github_policy_apply ?? null,
});

const parsed = (value) => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value;
  try { return JSON.parse(text); } catch { return value; }
};

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

const findRows = (value) => findObject(value, (candidate) => Array.isArray(candidate.rows))?.rows || [];
const keyed = (value, key) => findObject(value, (candidate) => Object.prototype.hasOwnProperty.call(candidate, key));
const sha256 = (value) => createHash('sha256').update(String(value || ''), 'utf8').digest('hex');

async function requestRaw(base, key, pathname, body, timeoutMs = 120000) {
  try {
    const response = await fetch(`${base}${pathname}`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'x-api-key': key, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    return { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  } catch (error) {
    return { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: String(error?.name || 'Error') };
  }
}

function ledgerPass(readback, checksum, statementCount) {
  const ledger = readback?.ledger;
  return Boolean(readback?.readback_status === 'pass'
    && ledger?.found === true
    && ledger?.migration_file === MIGRATION
    && String(ledger?.migration_checksum_sha256 || '').toLowerCase() === checksum
    && String(ledger?.mode || '').toLowerCase() === 'apply'
    && Number(ledger?.statement_count) === statementCount
    && String(ledger?.preflight_status || '').toLowerCase() === 'pass'
    && Number(ledger?.preflight_risk_count || 0) === 0);
}

export async function captureMetadataState({ base, key, evidenceDir, mode = 'verify' }) {
  const body = buildAdminControlDbReadRequest({
    sql: METADATA_STATE_SQL,
    params: [],
    maxRows: 1,
    authorityContext: {
      resource_type: 'database_metadata',
      resource_uri: 'db-metadata://growth_intelligence_platform/github_repository_policy_live_apply_authority',
      operation_mode: 'read_only_readiness_probe',
      required: true,
    },
  });
  const result = await requestRaw(base, key, '/admin/control', body);
  const rows = findRows(result.payload);
  const row = rows[0] || {};
  const classification = classifyMetadataPresence(row);
  let ledger = { checked: false, exact_apply_ledger_verified: false, http_status: null, readback_status: null, found: null };

  if (mode === 'pre_apply') {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    const checksum = sha256(sql);
    const statementCount = splitMigrationSqlStatements(sql).length;
    assert.equal(statementCount, EXPECTED_STATEMENT_COUNT, 'Migration 1051 statement count changed');
    const ledgerResult = await requestRaw(base, key, '/gpt/tools/call', {
      name: 'governed_migration_schema_readback',
      tool_args: {
        migration: MIGRATION,
        expected_checksum_sha256: checksum,
        expected_statement_count: statementCount,
        expected_tables: [...EXPECTED_TABLES],
      },
    }, 180000);
    const readback = keyed(ledgerResult.payload, 'readback_status');
    const exact = ledgerResult.transport_ok && ledgerPass(readback, checksum, statementCount);
    ledger = {
      checked: true,
      exact_apply_ledger_verified: exact,
      http_status: ledgerResult.status,
      readback_status: readback?.readback_status ?? null,
      found: readback?.ledger?.found ?? null,
    };
  }

  const diagnosticCaptured = result.transport_ok && result.http_ok && result.payload?.ok !== false && rows.length === 1;
  const guardAllowed = mode !== 'pre_apply'
    ? true
    : diagnosticCaptured && (ledger.exact_apply_ledger_verified || classification.replay_safe_without_exact_ledger);
  const report = {
    contract: 'github_repository_policy_1051_metadata_diagnostic.v2',
    mode,
    diagnostic_status: diagnosticCaptured ? 'captured' : 'unavailable',
    transport_ok: result.transport_ok,
    http_status: result.status,
    query_row_present: rows.length === 1,
    row_present: classification.metadata_present,
    metadata_present: classification.metadata_present,
    target_metadata_state: classification.target_metadata_state,
    authorization_state: classification.authorization_state,
    replay_safe_without_exact_ledger: classification.replay_safe_without_exact_ledger,
    counts: classification.counts,
    presence: classification.presence,
    metadata: safeMetadata(row),
    ledger,
    pre_apply_guard: mode === 'pre_apply' ? {
      status: guardAllowed ? 'pass' : 'blocked',
      reason: ledger.exact_apply_ledger_verified
        ? 'exact_apply_ledger_already_verified'
        : classification.replay_safe_without_exact_ledger
          ? 'target_metadata_absent'
          : `target_metadata_${classification.target_metadata_state}_without_exact_ledger`,
    } : null,
    metadata_grants_apply_authority: false,
    apply_sent: false,
    provider_call_executed: false,
    external_write_executed: false,
    row_data_read: false,
    freeform_sql_accepted: false,
    secrets_included: false,
  };
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'metadata-diagnostic-readback.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (mode === 'pre_apply') {
    assert.ok(diagnosticCaptured, 'Migration 1051 pre-Apply metadata diagnostic is unavailable');
    assert.ok(guardAllowed, `Migration 1051 replay guard blocked ${classification.target_metadata_state} target metadata without an exact Apply ledger`);
  }
  return report;
}

async function main() {
  const base = String(process.env.RUNTIME_BASE_URL || '').replace(/\/+$/, '');
  const key = String(process.env.BACKEND_API_KEY || '');
  const mode = String(process.env.METADATA_DIAGNOSTIC_MODE || 'verify').trim();
  const evidenceDir = path.resolve(String(process.env.EVIDENCE_DIR || '.artifacts/github-repository-policy-1051-verify'));
  assert.ok(base, 'RUNTIME_BASE_URL is required');
  assert.ok(key, 'BACKEND_API_KEY is required');
  assert.ok(['verify', 'pre_apply'].includes(mode), 'METADATA_DIAGNOSTIC_MODE must be verify or pre_apply');
  const report = await captureMetadataState({ base, key, evidenceDir, mode });
  console.log(JSON.stringify({
    contract: report.contract,
    diagnostic_status: report.diagnostic_status,
    target_metadata_state: report.target_metadata_state,
    authorization_state: report.authorization_state,
    metadata_present: report.metadata_present,
    pre_apply_guard: report.pre_apply_guard?.status ?? null,
    metadata_grants_apply_authority: false,
    secrets_included: false,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
