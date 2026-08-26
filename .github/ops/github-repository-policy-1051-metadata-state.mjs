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
const ENVELOPE_DEPENDENCY_MIGRATION = '225_sprint67_capability_resolution_envelope_ledger.sql';
const ENVELOPE_DEPENDENCY_PATH = new URL(`../../http-generic-api/migrations/${ENVELOPE_DEPENDENCY_MIGRATION}`, import.meta.url);
const ENVELOPE_DEPENDENCY_EXPECTED_CHECKSUM = '35b034940c2be63d9bf8a8099573cac1c5a75b5fffd8ccfad60a453ed3cf7419';
const ENVELOPE_DEPENDENCY_EXPECTED_STATEMENT_COUNT = 3;
const ENVELOPE_DEPENDENCY_EXPECTED_TABLES = Object.freeze(['capability_resolution_envelope_ledger']);

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

async function requestReadinessProjection(base, key, timeoutMs = 120000) {
  try {
    const response = await fetch(`${base}/deployment-info?include_governance_db_readiness=1`, {
      method: 'GET',
      redirect: 'error',
      headers: { 'x-api-key': key, Accept: 'application/json' },
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

function ledgerPass(readback, checksum, statementCount, migration = MIGRATION) {
  const ledger = readback?.ledger;
  return Boolean(readback?.readback_status === 'pass'
    && ledger?.found === true
    && ledger?.migration_file === migration
    && String(ledger?.migration_checksum_sha256 || '').toLowerCase() === checksum
    && String(ledger?.mode || '').toLowerCase() === 'apply'
    && Number(ledger?.statement_count) === statementCount
    && String(ledger?.preflight_status || '').toLowerCase() === 'pass'
    && Number(ledger?.preflight_risk_count || 0) === 0);
}

async function captureGovernanceWriterReadiness({ base, key }) {
  const result = await requestReadinessProjection(base, key);
  const readiness = result.payload?.governance_db_privilege_readiness;
  const runtimeBranch = String(result.payload?.branch || result.payload?.gitBranch || '').trim();
  const ready = Boolean(
    result.transport_ok
    && result.http_ok
    && result.payload?.ok !== false
    && runtimeBranch === 'Production'
    && readiness?.status === 'ready'
    && readiness?.ready === true
    && readiness?.production_preflight_ready === true
    && readiness?.production_branch_exact === true
    && readiness?.promotion_target_branch_exact === true
    && readiness?.governance_identity_configured === true
    && readiness?.schema_objects_ready === true
    && Number(readiness?.missing_required_schema_table_count) === 0
    && readiness?.table_names_exposed === false
    && readiness?.privilege_matrix_exact === true
    && readiness?.database_connection_performed === true
    && readiness?.sql_readback_performed === true
    && readiness?.read_only_probe === true
    && readiness?.sql_mutation_performed === false
    && readiness?.migration_apply_performed === false
    && readiness?.provider_mutation_performed === false
    && readiness?.deployment_performed === false
    && readiness?.secrets_included === false
  );
  return {
    contract: 'github_repository_policy_1051_governance_writer_readiness.v2',
    transport_ok: result.transport_ok,
    http_status: result.status,
    runtime_branch: runtimeBranch || null,
    status: readiness?.status ?? null,
    ready,
    code: readiness?.code ?? null,
    production_preflight_ready: readiness?.production_preflight_ready === true,
    production_branch_exact: readiness?.production_branch_exact === true,
    promotion_target_branch_exact: readiness?.promotion_target_branch_exact === true,
    governance_identity_configured: readiness?.governance_identity_configured === true,
    schema_objects_ready: readiness?.schema_objects_ready === true,
    required_schema_table_count: count(readiness?.required_schema_table_count),
    observed_required_schema_table_count: count(readiness?.observed_required_schema_table_count),
    missing_required_schema_table_count: count(readiness?.missing_required_schema_table_count),
    table_names_exposed: readiness?.table_names_exposed === true,
    privilege_matrix_exact: readiness?.privilege_matrix_exact === true,
    database_connection_performed: readiness?.database_connection_performed === true,
    sql_readback_performed: readiness?.sql_readback_performed === true,
    read_only_probe: readiness?.read_only_probe === true,
    sql_mutation_performed: false,
    migration_apply_performed: false,
    provider_mutation_performed: false,
    deployment_performed: false,
    secrets_included: false,
  };
}

async function captureEnvelopeDependency225({ base, key, evidenceDir }) {
  const sql = fs.readFileSync(ENVELOPE_DEPENDENCY_PATH, 'utf8');
  const checksum = sha256(sql);
  const statementCount = splitMigrationSqlStatements(sql).length;
  assert.equal(checksum, ENVELOPE_DEPENDENCY_EXPECTED_CHECKSUM, 'Migration 225 checksum changed');
  assert.equal(statementCount, ENVELOPE_DEPENDENCY_EXPECTED_STATEMENT_COUNT, 'Migration 225 statement count changed');
  const result = await requestRaw(base, key, '/gpt/tools/call', {
    name: 'governed_migration_schema_readback',
    tool_args: {
      migration: ENVELOPE_DEPENDENCY_MIGRATION,
      expected_checksum_sha256: checksum,
      expected_statement_count: statementCount,
      expected_tables: [...ENVELOPE_DEPENDENCY_EXPECTED_TABLES],
    },
  }, 180000);
  const readback = keyed(result.payload, 'readback_status');
  const schemaTables = Array.isArray(readback?.schema?.tables) ? readback.schema.tables : [];
  const missingTables = Array.isArray(readback?.expectations?.missing?.tables) ? readback.expectations.missing.tables : [];
  const tablePresent = schemaTables.some((row) => String(row?.TABLE_NAME || row?.table_name || '') === ENVELOPE_DEPENDENCY_EXPECTED_TABLES[0])
    && !missingTables.includes(ENVELOPE_DEPENDENCY_EXPECTED_TABLES[0]);
  const exactLedgerVerified = result.transport_ok && ledgerPass(readback, checksum, statementCount, ENVELOPE_DEPENDENCY_MIGRATION);
  const runtimeDependencyReady = exactLedgerVerified && tablePresent;
  const governanceWriter = await captureGovernanceWriterReadiness({ base, key });
  const dependencyReady = runtimeDependencyReady && governanceWriter.ready;
  const dependencyBlockReason = !runtimeDependencyReady
    ? 'migration_225_runtime_dependency_not_ready'
    : !governanceWriter.ready
      ? 'governance_writer_readiness_not_ready'
      : null;
  const report = {
    contract: 'github_repository_policy_1051_envelope_dependency_225.v3',
    migration: ENVELOPE_DEPENDENCY_MIGRATION,
    migration_checksum_sha256: checksum,
    statement_count: statementCount,
    transport_ok: result.transport_ok,
    http_status: result.status,
    readback_status: readback?.readback_status ?? null,
    ledger_found: readback?.ledger?.found ?? null,
    exact_apply_ledger_verified: exactLedgerVerified,
    table: ENVELOPE_DEPENDENCY_EXPECTED_TABLES[0],
    table_present: tablePresent,
    missing_tables: missingTables,
    runtime_dependency_ready: runtimeDependencyReady,
    governance_writer_readiness: governanceWriter,
    governance_writer_ready: governanceWriter.ready,
    dependency_block_reason: dependencyBlockReason,
    dependency_ready: dependencyReady,
    dependency_grants_apply_authority: false,
    apply_sent: false,
    provider_call_executed: false,
    external_write_executed: false,
    row_data_read: false,
    freeform_sql_accepted: false,
    secrets_included: false,
  };
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'dependency-225-readback.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

export async function captureMetadataState({ base, key, evidenceDir, mode = 'verify' }) {
  const dependency225 = await captureEnvelopeDependency225({ base, key, evidenceDir });
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
  const metadataReplayAllowed = diagnosticCaptured && (ledger.exact_apply_ledger_verified || classification.replay_safe_without_exact_ledger);
  const dependencyGuardRequired = mode === 'readiness' || mode === 'pre_apply';
  const dependencyGuardAllowed = dependency225.dependency_ready === true;
  const guardAllowed = mode !== 'pre_apply'
    ? true
    : metadataReplayAllowed && dependencyGuardAllowed;
  const report = {
    contract: 'github_repository_policy_1051_metadata_diagnostic.v5',
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
    envelope_dependency_225: dependency225,
    ledger,
    readiness_dependency_guard: mode === 'readiness' ? {
      status: dependencyGuardAllowed ? 'pass' : 'blocked',
      reason: dependencyGuardAllowed ? 'migration_225_runtime_and_governance_writer_schema_verified' : dependency225.dependency_block_reason,
    } : null,
    pre_apply_guard: mode === 'pre_apply' ? {
      status: guardAllowed ? 'pass' : 'blocked',
      reason: !dependencyGuardAllowed
        ? dependency225.dependency_block_reason
        : ledger.exact_apply_ledger_verified
          ? 'exact_apply_ledger_already_verified'
          : classification.replay_safe_without_exact_ledger
            ? 'target_metadata_absent'
            : `target_metadata_${classification.target_metadata_state}_without_exact_ledger`,
    } : null,
    dependency_guard_required: dependencyGuardRequired,
    metadata_grants_apply_authority: false,
    dependency_grants_apply_authority: false,
    apply_sent: false,
    provider_call_executed: false,
    external_write_executed: false,
    row_data_read: false,
    freeform_sql_accepted: false,
    secrets_included: false,
  };
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'metadata-diagnostic-readback.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (mode === 'readiness') {
    if (!dependencyGuardAllowed) {
      const writerBlocked = dependency225.runtime_dependency_ready === true && dependency225.governance_writer_ready !== true;
      const error = new Error(writerBlocked
        ? 'Migration 1051 readiness blocked: Governance DB writer schema and privilege readiness are not proven on the same Production runtime that will persist the capability envelope'
        : 'Migration 1051 readiness blocked: Migration 225 runtime dependency requires an exact Apply ledger and capability_resolution_envelope_ledger table');
      error.code = writerBlocked
        ? 'migration_1051_governance_writer_dependency_not_ready'
        : 'migration_1051_dependency_225_not_ready';
      throw error;
    }
  }
  if (mode === 'pre_apply') {
    assert.ok(diagnosticCaptured, 'Migration 1051 pre-Apply metadata diagnostic is unavailable');
    if (!dependencyGuardAllowed) {
      const writerBlocked = dependency225.runtime_dependency_ready === true && dependency225.governance_writer_ready !== true;
      const error = new Error(writerBlocked
        ? 'Migration 1051 pre-Apply blocked: Governance DB writer schema and privilege readiness are not proven'
        : 'Migration 1051 pre-Apply blocked: Migration 225 runtime dependency is not ready');
      error.code = writerBlocked
        ? 'migration_1051_governance_writer_dependency_not_ready'
        : 'migration_1051_dependency_225_not_ready';
      throw error;
    }
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
  assert.ok(['verify', 'readiness', 'pre_apply'].includes(mode), 'METADATA_DIAGNOSTIC_MODE must be verify, readiness, or pre_apply');
  const report = await captureMetadataState({ base, key, evidenceDir, mode });
  console.log(JSON.stringify({
    contract: report.contract,
    diagnostic_status: report.diagnostic_status,
    target_metadata_state: report.target_metadata_state,
    authorization_state: report.authorization_state,
    metadata_present: report.metadata_present,
    dependency_225_runtime_ready: report.envelope_dependency_225?.runtime_dependency_ready ?? false,
    governance_writer_schema_ready: report.envelope_dependency_225?.governance_writer_readiness?.schema_objects_ready ?? false,
    governance_writer_ready: report.envelope_dependency_225?.governance_writer_ready ?? false,
    dependency_225_ready: report.envelope_dependency_225?.dependency_ready ?? false,
    readiness_dependency_guard: report.readiness_dependency_guard?.status ?? null,
    pre_apply_guard: report.pre_apply_guard?.status ?? null,
    metadata_grants_apply_authority: false,
    dependency_grants_apply_authority: false,
    secrets_included: false,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
