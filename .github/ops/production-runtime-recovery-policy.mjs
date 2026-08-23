#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const requireFromApi = createRequire(path.join(REPO_ROOT, 'http-generic-api', 'package.json'));
const ROUTE_CONTRACT = JSON.parse(
  fs.readFileSync(path.join(HERE, 'production-runtime-recovery-routes.json'), 'utf8'),
);
const DEPLOYMENT_POLICY_PATH = path.join(REPO_ROOT, 'http-generic-api', 'config', 'deployment-branch-policy.json');
const DEPLOYMENT_POLICY = JSON.parse(fs.readFileSync(DEPLOYMENT_POLICY_PATH, 'utf8'));

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

export function arrayFromEnv(env, name) {
  const raw = String(env[name] || '').trim();
  if (!raw) return [];
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    fail('RECOVERY_POLICY_JSON_INVALID', { variable: name, message: error.message });
  }
  if (!Array.isArray(value)) fail('RECOVERY_POLICY_ARRAY_REQUIRED', { variable: name });
  return value;
}

export function exactSet(actual, expected) {
  const left = [...new Set(actual.map(String))].sort();
  const right = [...new Set(expected.map(String))].sort();
  return JSON.stringify(left) === JSON.stringify(right);
}

export function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  fail('RECOVERY_INVALID_BOOLEAN', { value: String(value).slice(0, 80) });
}

export function validateProductionBaseUrl(raw = '', contract = ROUTE_CONTRACT, deploymentPolicy = DEPLOYMENT_POLICY) {
  const binding = contract.production_origin_binding;
  const canonical = String(deploymentPolicy.production?.hostname || '').trim().toLowerCase();
  if (!binding || binding.source_policy !== 'http-generic-api/config/deployment-branch-policy.json'
      || binding.hostname_field !== 'production.hostname'
      || binding.require_exact_hostname !== true || binding.require_https !== true
      || !canonical) {
    fail('RECOVERY_PRODUCTION_ORIGIN_POLICY_MISSING');
  }

  const candidate = String(raw || '').trim();
  if (!candidate) fail('RECOVERY_PRODUCTION_ORIGIN_REQUIRED');
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    fail('RECOVERY_PRODUCTION_ORIGIN_INVALID');
  }
  if (parsed.protocol !== 'https:') fail('RECOVERY_PRODUCTION_ORIGIN_HTTPS_REQUIRED');
  if (parsed.hostname.toLowerCase() !== canonical) {
    fail('RECOVERY_PRODUCTION_ORIGIN_HOST_DENIED', { expected_host: canonical });
  }
  if (parsed.username || parsed.password) fail('RECOVERY_PRODUCTION_ORIGIN_USERINFO_DENIED');
  if (parsed.port) fail('RECOVERY_PRODUCTION_ORIGIN_PORT_DENIED');
  if (binding.allow_path_prefix === false && parsed.pathname !== '/') fail('RECOVERY_PRODUCTION_ORIGIN_PATH_DENIED');
  if (parsed.search || parsed.hash) fail('RECOVERY_PRODUCTION_ORIGIN_QUERY_DENIED');
  return parsed.origin;
}

export function assertMigration(args, mode, contract = ROUTE_CONTRACT) {
  const migration = String(args?.migration || '');
  const spec = contract.recovery_migrations?.[migration];
  if (!spec || !Array.isArray(spec.allowed_modes) || !spec.allowed_modes.includes(mode)) {
    fail('RECOVERY_MIGRATION_MODE_DENIED', { migration, mode });
  }
  if (String(args?.expected_checksum_sha256 || '').toLowerCase() !== String(spec.sha256).toLowerCase()) {
    fail('RECOVERY_MIGRATION_CHECKSUM_REQUIRED', { migration });
  }
  if (Number(args?.expected_statement_count) !== Number(spec.statement_count)) {
    fail('RECOVERY_MIGRATION_STATEMENT_COUNT_REQUIRED', { migration });
  }
  if (mode === 'apply' && spec.incident_role !== 'only_current_apply_candidate') {
    fail('RECOVERY_APPLY_MIGRATION_DENIED', { migration });
  }
  return spec;
}

export function validateFallbackTargetPlan(target, contract = ROUTE_CONTRACT) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) fail('RECOVERY_TARGET_INVALID');
  if (Object.hasOwn(target, 'migrations')) fail('RECOVERY_AMBIGUOUS_MIGRATIONS_FIELD');

  const migrationPolicy = contract.fallback_migration_policy;
  if (!migrationPolicy || !Array.isArray(migrationPolicy.baseline_bootstrap_migrations)
      || !Array.isArray(migrationPolicy.incident_recovery_allowlist)
      || !Array.isArray(migrationPolicy.verification_only_allowlist)) {
    fail('RECOVERY_FALLBACK_MIGRATION_POLICY_MISSING');
  }

  if (Object.hasOwn(target, 'baseline_bootstrap_migrations') && !Array.isArray(target.baseline_bootstrap_migrations)) {
    fail('RECOVERY_BASELINE_MIGRATIONS_ARRAY_REQUIRED');
  }
  if (Object.hasOwn(target, 'incident_recovery_migrations') && !Array.isArray(target.incident_recovery_migrations)) {
    fail('RECOVERY_INCIDENT_MIGRATIONS_ARRAY_REQUIRED');
  }
  const baselineEntries = Array.isArray(target.baseline_bootstrap_migrations)
    ? target.baseline_bootstrap_migrations : [];
  const incidentEntries = Array.isArray(target.incident_recovery_migrations)
    ? target.incident_recovery_migrations : [];

  for (const rawEntry of baselineEntries) {
    const entry = typeof rawEntry === 'string' ? { file: rawEntry } : rawEntry;
    const file = String(entry?.file || '');
    const spec = migrationPolicy.baseline_bootstrap_migrations.find((item) => String(item?.file || '') === file);
    if (!spec) fail('RECOVERY_BASELINE_MIGRATION_DENIED', { file });
    if (entry.kind && String(entry.kind) !== String(spec.kind)) fail('RECOVERY_BASELINE_MIGRATION_KIND_DENIED', { file });
    if (String(entry.expected_checksum || entry.expected_checksum_sha256 || '').toLowerCase() !== String(spec.sha256).toLowerCase()) {
      fail('RECOVERY_BASELINE_MIGRATION_CHECKSUM_REQUIRED', { file });
    }
    if (Number(entry.expected_statement_count) !== Number(spec.statement_count)) {
      fail('RECOVERY_BASELINE_MIGRATION_STATEMENT_COUNT_REQUIRED', { file });
    }
    if (entry.data_statements_allowed === true || spec.data_statements_allowed !== false) {
      fail('RECOVERY_BASELINE_DATA_STATEMENTS_DENIED', { file });
    }
  }

  for (const rawEntry of incidentEntries) {
    const entry = typeof rawEntry === 'string' ? { file: rawEntry } : rawEntry;
    const normalized = String(entry?.file || '').trim().replaceAll('\\', '/');
    const migration = path.basename(normalized);
    if (normalized !== migration && normalized !== `http-generic-api/migrations/${migration}`) {
      fail('RECOVERY_INCIDENT_MIGRATION_PATH_DENIED', { migration });
    }
    if (!migrationPolicy.incident_recovery_allowlist.includes(migration)) {
      fail('RECOVERY_INCIDENT_MIGRATION_DENIED', { migration });
    }
    const migrationSpec = contract.recovery_migrations?.[migration];
    if (!migrationSpec || migrationSpec.incident_role !== 'only_current_apply_candidate') {
      fail('RECOVERY_INCIDENT_MIGRATION_ROLE_DENIED', { migration });
    }
    if (migrationSpec.direct_fallback_authorized !== true || migrationSpec.direct_fallback_idempotent !== true) {
      fail('RECOVERY_INCIDENT_DIRECT_FALLBACK_AUTHORIZATION_REQUIRED', { migration });
    }
    if (entry.kind && String(entry.kind) !== 'migration') fail('RECOVERY_INCIDENT_MIGRATION_KIND_DENIED', { migration });
    assertMigration({
      migration,
      expected_checksum_sha256: entry.expected_checksum_sha256 || entry.expected_checksum,
      expected_statement_count: entry.expected_statement_count,
    }, 'apply', contract);
  }

  return { baselineEntries, incidentEntries };
}

export function validateConfiguredRecoveryStep(step, phase, contract = ROUTE_CONTRACT) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) fail('RECOVERY_STEP_INVALID', { phase });
  if (Object.hasOwn(step, 'path') || Object.hasOwn(step, 'url')) fail('RECOVERY_ARBITRARY_ROUTE_DENIED', { phase });

  const routeKey = String(step.route_key || '');
  const route = contract.routes?.[routeKey];
  if (!route || !contract.allowed_configured_steps?.includes(routeKey)) {
    fail('RECOVERY_ROUTE_KEY_DENIED', { phase, route_key: routeKey });
  }
  if (step.method && String(step.method).toUpperCase() !== String(route.method).toUpperCase()) {
    fail('RECOVERY_ROUTE_METHOD_DENIED', { phase, route_key: routeKey });
  }

  if (routeKey !== 'gpt_tool_call') {
    if (step.mutation === true) fail('RECOVERY_NON_TOOL_MUTATION_FLAG_DENIED', { phase, route_key: routeKey });
    return { route_key: routeKey, tool: null, mode: 'route' };
  }

  const body = step.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.name !== 'string'
      || !body.tool_args || typeof body.tool_args !== 'object' || Array.isArray(body.tool_args)) {
    fail('RECOVERY_TOOL_ENVELOPE_INVALID', { phase });
  }

  const name = body.name;
  const args = body.tool_args;
  const policy = route.tool_policy || {};
  if (policy.dedicated_post_apply_tools?.[name]) {
    fail('RECOVERY_DEDICATED_TOOL_GENERIC_DISPATCH_DENIED', { phase, tool: name });
  }

  if (phase === 'probe' || phase === 'final') {
    if (step.mutation === true) fail('RECOVERY_READ_PHASE_MUTATION_DENIED', { phase, tool: name });
    if (policy.read_only_tools?.includes(name)) {
      if (args.migration && !contract.recovery_migrations?.[String(args.migration)]) {
        fail('RECOVERY_SCHEMA_READBACK_MIGRATION_DENIED', { migration: String(args.migration) });
      }
      return { route_key: routeKey, tool: name, mode: 'read_only' };
    }
    if (name === 'governed_migration_execute') {
      if (String(args.mode || '') !== 'dry_run') fail('RECOVERY_DRY_RUN_REQUIRED', { phase });
      assertMigration(args, 'dry_run', contract);
      return { route_key: routeKey, tool: name, mode: 'dry_run' };
    }
    fail('RECOVERY_READ_PHASE_TOOL_DENIED', { phase, tool: name });
  }

  if (phase === 'mutation') {
    if (step.mutation !== true) fail('RECOVERY_MUTATION_FLAG_REQUIRED', { tool: name });
    if (name === 'governed_migration_execute') {
      if (String(args.mode || '') !== 'apply') fail('RECOVERY_APPLY_MODE_REQUIRED');
      assertMigration(args, 'apply', contract);
      return { route_key: routeKey, tool: name, mode: 'apply' };
    }
    if (!policy.mutation_tools?.includes(name)) fail('RECOVERY_MUTATION_TOOL_DENIED', { tool: name });
    if (name === 'governed_migration_authorization_bootstrap') {
      const migration = String(args.migration || '');
      if (contract.recovery_migrations?.[migration]?.incident_role !== 'only_current_apply_candidate') {
        fail('RECOVERY_AUTHORIZATION_MIGRATION_DENIED', { migration });
      }
    }
    return { route_key: routeKey, tool: name, mode: 'mutation' };
  }

  fail('RECOVERY_PHASE_INVALID', { phase });
}

export function validateRecoveryPlan(env = process.env, contract = ROUTE_CONTRACT) {
  const strategy = String(env.RECOVERY_STRATEGY || 'verify');
  if (!['verify', 'snapshot', 'primary', 'fallback'].includes(strategy)) fail('RECOVERY_STRATEGY_INVALID', { strategy });
  const applyExecution = parseBoolean(env.APPLY_EXECUTION, false);

  if (strategy !== 'snapshot') {
    validateProductionBaseUrl(env.PRODUCTION_BASE_URL, contract);
    const configuredBranch = String(env.PRODUCTION_SOURCE_BRANCH || '').trim();
    const canonicalBranch = String(DEPLOYMENT_POLICY.production?.source_branch || 'Production');
    if (configuredBranch && configuredBranch !== canonicalBranch) fail('RECOVERY_PRODUCTION_BRANCH_DENIED', { expected_branch: canonicalBranch });
  }

  if (strategy === 'snapshot') {
    if (!['github_snapshot', 'repository_snapshot'].includes(String(env.RUNTIME_RECOVERY_SOURCE_MODE || ''))) {
      fail('RECOVERY_SNAPSHOT_SOURCE_REQUIRED');
    }
    if (applyExecution) fail('RECOVERY_SNAPSHOT_MUTATION_DENIED');
  }

  const probes = arrayFromEnv(env, 'RUNTIME_RECOVERY_PROBES_JSON');
  const finalProbes = arrayFromEnv(env, 'RUNTIME_RECOVERY_FINAL_PROBES_JSON');
  const primary = arrayFromEnv(env, 'PRIMARY_GOVERNED_STEPS_JSON');
  for (const step of probes) validateConfiguredRecoveryStep(step, 'probe', contract);
  for (const step of finalProbes) validateConfiguredRecoveryStep(step, 'final', contract);
  if (strategy === 'primary') {
    for (const step of primary) validateConfiguredRecoveryStep(step, 'mutation', contract);
  } else if (primary.length > 0 && strategy !== 'verify') {
    fail('RECOVERY_PRIMARY_STEPS_STRATEGY_MISMATCH', { strategy });
  }

  let fallbackTarget = null;
  if (strategy === 'fallback') {
    const targets = arrayFromEnv(env, 'RUNTIME_RECOVERY_TARGETS_JSON');
    fallbackTarget = targets.find((item) => String(item?.key || '') === String(env.RECOVERY_TARGET_KEY || 'runtime'));
    if (!fallbackTarget) fail('RECOVERY_TARGET_NOT_FOUND');
    validateFallbackTargetPlan(fallbackTarget, contract);

    const grantPolicy = contract.grant_policy || {};
    const expectedTables = grantPolicy.required_tables || [];
    const expectedOps = (grantPolicy.required_operations || []).map((item) => String(item).toUpperCase());
    const grants = Array.isArray(fallbackTarget.grants) && fallbackTarget.grants.length
      ? fallbackTarget.grants
      : expectedTables.map((table) => ({ table, privileges: expectedOps }));
    if (!exactSet(grants.map((entry) => entry.table), expectedTables)) fail('RECOVERY_GRANT_TABLE_SET_DENIED');
    for (const grant of grants) {
      const observed = Array.isArray(grant.privileges)
        ? grant.privileges.map((item) => String(item).toUpperCase())
        : [];
      if (!exactSet(observed, expectedOps)) fail('RECOVERY_GRANT_OPERATION_SET_DENIED', { table: grant.table });
    }
  }

  return {
    ok: true,
    contract: 'production-runtime-recovery-config-policy.v2',
    strategy,
    source_mode: String(env.RUNTIME_RECOVERY_SOURCE_MODE || 'sql'),
    unknown_tool_policy: contract.routes?.gpt_tool_call?.tool_policy?.unknown_tool_policy || null,
    verification_only_migrations: Object.entries(contract.recovery_migrations || {})
      .filter(([, spec]) => spec.incident_role === 'verification_only')
      .map(([name]) => name),
    apply_candidates: Object.entries(contract.recovery_migrations || {})
      .filter(([, spec]) => spec.incident_role === 'only_current_apply_candidate')
      .map(([name]) => name),
    grant_table_count: contract.grant_policy?.required_tables?.length || 0,
    fallback_target: fallbackTarget?.key || null,
    baseline_bootstrap_count: fallbackTarget?.baseline_bootstrap_migrations?.length || 0,
    incident_recovery_count: fallbackTarget?.incident_recovery_migrations?.length || 0,
    secrets_included: false,
  };
}

function requireEvidenceDir(env) {
  const dir = String(env.EVIDENCE_DIR || '').trim();
  if (!dir) fail('RECOVERY_EVIDENCE_DIR_REQUIRED');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function verifyGrantReadback(env = process.env, contract = ROUTE_CONTRACT) {
  const targets = arrayFromEnv(env, 'RUNTIME_RECOVERY_TARGETS_JSON');
  const target = targets.find((item) => String(item?.key || '') === String(env.RECOVERY_TARGET_KEY || 'runtime'));
  if (!target?.database || !target?.principal || !target?.principal_host) fail('RECOVERY_GRANT_READBACK_TARGET_INCOMPLETE');
  for (const key of ['MYSQL_BOOTSTRAP_HOST', 'MYSQL_BOOTSTRAP_USER', 'MYSQL_BOOTSTRAP_PASSWORD']) {
    if (!String(env[key] || '').trim()) fail('RECOVERY_GRANT_READBACK_CREDENTIAL_MISSING', { key });
  }

  const mysql = requireFromApi('mysql2/promise');
  const connection = await mysql.createConnection({
    host: env.MYSQL_BOOTSTRAP_HOST,
    port: Number(env.MYSQL_BOOTSTRAP_PORT || 3306),
    user: env.MYSQL_BOOTSTRAP_USER,
    password: env.MYSQL_BOOTSTRAP_PASSWORD,
    connectTimeout: 15000,
  });

  try {
    const grantee = `'${target.principal}'@'${target.principal_host}'`;
    const [userRows] = await connection.execute(
      'SELECT PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ?',
      [grantee],
    );
    const [schemaRows] = await connection.execute(
      'SELECT TABLE_SCHEMA, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA = ?',
      [grantee, target.database],
    );
    const [tableRows] = await connection.execute(
      'SELECT TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA = ?',
      [grantee, target.database],
    );

    const policy = contract.grant_policy || {};
    const requiredTables = new Set(policy.required_tables || []);
    const requiredOps = new Set((policy.required_operations || []).map((item) => String(item).toUpperCase()));
    const broadWrite = new Set([
      'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'INDEX', 'TRIGGER', 'REFERENCES',
      'EXECUTE', 'EVENT', 'CREATE ROUTINE', 'ALTER ROUTINE', 'CREATE VIEW', 'CREATE TEMPORARY TABLES', 'LOCK TABLES',
    ]);
    const broadGlobal = userRows.filter((row) => broadWrite.has(String(row.PRIVILEGE_TYPE).toUpperCase()));
    const broadSchema = schemaRows.filter((row) => broadWrite.has(String(row.PRIVILEGE_TYPE).toUpperCase()));
    const grantOptions = [...userRows, ...schemaRows, ...tableRows]
      .filter((row) => String(row.IS_GRANTABLE || 'NO').toUpperCase() === 'YES');
    const outsideTableWrites = tableRows.filter(
      (row) => !requiredTables.has(String(row.TABLE_NAME)) && broadWrite.has(String(row.PRIVILEGE_TYPE).toUpperCase()),
    );
    const tableEvidence = [...requiredTables].map((table) => {
      const rows = tableRows.filter((row) => String(row.TABLE_NAME) === table);
      const observed = new Set(rows.map((row) => String(row.PRIVILEGE_TYPE).toUpperCase()));
      return {
        table,
        missing: [...requiredOps].filter((op) => !observed.has(op)),
        forbidden: [...observed].filter((op) => !requiredOps.has(op)),
        grant_option: rows.some((row) => String(row.IS_GRANTABLE || 'NO').toUpperCase() === 'YES'),
      };
    });
    const ready = broadGlobal.length === 0 && broadSchema.length === 0 && grantOptions.length === 0
      && outsideTableWrites.length === 0
      && tableEvidence.every((item) => item.missing.length === 0 && item.forbidden.length === 0 && !item.grant_option);
    const evidence = {
      contract: 'production-runtime-recovery-grant-readback.v1',
      ready,
      database: target.database,
      table_evidence: tableEvidence,
      broad_global_write_privilege_count: broadGlobal.length,
      broad_schema_write_privilege_count: broadSchema.length,
      outside_allowlist_table_write_count: outsideTableWrites.length,
      grant_option_count: grantOptions.length,
      secrets_included: false,
    };
    fs.writeFileSync(path.join(requireEvidenceDir(env), 'grant-readback.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    if (!ready) fail('RECOVERY_GRANT_SAME_CYCLE_READBACK_FAILED', evidence);
    return evidence;
  } finally {
    await connection.end();
  }
}

function locate(value, predicate, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    const found = locate(child, predicate, seen);
    if (found) return found;
  }
  return null;
}

export async function verifyPersistenceReadback(env = process.env, contract = ROUTE_CONTRACT) {
  const route = contract.routes?.gpt_tool_call;
  const smokePolicy = route?.tool_policy?.dedicated_post_apply_tools?.response_chunk_durable_recovery_smoke;
  if (!route || !smokePolicy) fail('RECOVERY_DURABLE_SMOKE_POLICY_MISSING');
  const token = String(env.PRODUCTION_PROBE_AUTH_VALUE || '');
  if (!token) fail('RECOVERY_DURABLE_SMOKE_AUTH_MISSING');
  const base = validateProductionBaseUrl(env.PRODUCTION_BASE_URL, contract).replace(/\/$/, '');
  const response = await fetch(`${base}${route.path}`, {
    method: route.method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      [String(env.PRODUCTION_PROBE_AUTH_HEADER || 'Authorization')]: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: 'response_chunk_durable_recovery_smoke',
      tool_args: { [smokePolicy.confirmation_field]: smokePolicy.confirmation_value },
    }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.json().catch(() => null);
  const smoke = locate(body, (value) => value.smoke_contract === 'response_chunk_durable_recovery_smoke_v1');
  const ready = response.ok && smoke?.ok === true
    && smoke?.persistence?.durable_row_present_immediately_after_chunk_id_return === true
    && smoke?.persistence?.memory_cache_evicted === true
    && smoke?.persistence?.recovery_source === 'governed_tool_response_chunk_store'
    && smoke?.integrity?.persisted_sha256_match === true
    && smoke?.integrity?.persisted_utf8_byte_length_match === true
    && smoke?.integrity?.exact_unicode_reconstruction === true
    && smoke?.integrity?.reconstructed_sha256_match === true
    && smoke?.integrity?.reconstructed_utf8_byte_length_match === true
    && smoke?.integrity?.no_secret_policy_passed === true
    && smoke?.expiry?.sliding_extension_verified === true;
  const evidence = {
    contract: 'production-runtime-recovery-live-persistence-readback.v1',
    ready,
    http_status: response.status,
    smoke_contract: smoke?.smoke_contract || null,
    durable_row_present: smoke?.persistence?.durable_row_present_immediately_after_chunk_id_return === true,
    memory_cache_evicted: smoke?.persistence?.memory_cache_evicted === true,
    recovery_source: smoke?.persistence?.recovery_source || null,
    exact_unicode_reconstruction: smoke?.integrity?.exact_unicode_reconstruction === true,
    sliding_extension_verified: smoke?.expiry?.sliding_extension_verified === true,
    provider_calls: smoke?.provider_calls ?? null,
    external_writes: smoke?.external_writes ?? null,
    secrets_included: false,
  };
  fs.writeFileSync(path.join(requireEvidenceDir(env), 'response-chunk-live-binding.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  if (!ready) fail('RECOVERY_LIVE_PERSISTENCE_READBACK_FAILED', { http_status: response.status });
  return evidence;
}

function fallbackMysqlConfig(env, target) {
  for (const key of ['MYSQL_BOOTSTRAP_HOST', 'MYSQL_BOOTSTRAP_USER', 'MYSQL_BOOTSTRAP_PASSWORD']) {
    if (!String(env[key] || '').trim()) fail('RECOVERY_FALLBACK_CREDENTIAL_MISSING', { key });
  }
  return {
    host: env.MYSQL_BOOTSTRAP_HOST,
    port: Number(env.MYSQL_BOOTSTRAP_PORT || 3306),
    user: env.MYSQL_BOOTSTRAP_USER,
    password: env.MYSQL_BOOTSTRAP_PASSWORD,
    connectTimeout: 15000,
  };
}

function fallbackMigrationPolicy(contract) {
  const policy = contract.fallback_migration_policy;
  if (!policy || policy.canonical_governed_ledger !== 'governed_migration_ledger'
      || policy.canonical_governed_ledger_required !== true
      || policy.conflicting_apply_checksum_fails_even_with_matching_record !== true
      || policy.schema_ready_without_apply_ledger_requires_authorized_idempotent_flow !== true
      || policy.record_only_reconciliation_allowed !== false) {
    fail('RECOVERY_GOVERNED_MIGRATION_LEDGER_POLICY_MISSING');
  }
  return policy;
}

function assertSafeIdentifier(value, label) {
  const normalized = String(value || '');
  if (!/^[A-Za-z0-9_$.-]+$/u.test(normalized)) {
    fail('RECOVERY_FALLBACK_POSTCONDITION_IDENTIFIER_DENIED', { label, value: normalized });
  }
  return normalized;
}

export async function assertIncidentPostconditions(connection, database, migration, contract = ROUTE_CONTRACT) {
  const checks = fallbackMigrationPolicy(contract).incident_postconditions?.[migration] || [];
  if (!Array.isArray(checks) || checks.length === 0) {
    fail('RECOVERY_FALLBACK_POSTCONDITIONS_MISSING', { migration });
  }
  const evidence = [];
  for (const check of checks) {
    const type = String(check?.type || '');
    const table = assertSafeIdentifier(check?.table, 'table');
    if (type === 'column') {
      const column = assertSafeIdentifier(check?.column, 'column');
      const [rows] = await connection.execute(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
        [database, table, column],
      );
      evidence.push({ ...check, ready: rows.length === 1 });
    } else if (type === 'index') {
      const index = assertSafeIdentifier(check?.index, 'index');
      const [rows] = await connection.execute(
        'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
        [database, table, index],
      );
      evidence.push({ ...check, ready: rows.length >= 1 });
    } else if (type === 'row') {
      const keyColumn = assertSafeIdentifier(check?.key_column, 'key_column');
      const valueColumn = assertSafeIdentifier(check?.value_column, 'value_column');
      const [rows] = await connection.execute(
        `SELECT \`${valueColumn}\` AS observed_value FROM \`${table}\` WHERE \`${keyColumn}\` = ? LIMIT 1`,
        [check.key_value],
      );
      evidence.push({ ...check, ready: rows.length === 1 && String(rows[0].observed_value) === String(check.expected_value) });
    } else {
      fail('RECOVERY_FALLBACK_POSTCONDITION_TYPE_DENIED', { migration, type });
    }
  }
  return { ready: evidence.every((item) => item.ready), checks: evidence };
}

function normalizeLedgerChecksum(value) {
  return String(value || '').trim().toLowerCase();
}

export function selectCanonicalLedgerApplyRecord(rows, migration, checksum) {
  const expected = normalizeLedgerChecksum(checksum);
  const safeRows = Array.isArray(rows) ? rows : [];
  const conflicting = safeRows.filter(
    (row) => normalizeLedgerChecksum(row?.migration_checksum_sha256 ?? row?.checksum_sha256) !== expected,
  );
  if (conflicting.length > 0) {
    fail('RECOVERY_GOVERNED_LEDGER_CHECKSUM_DIVERGENCE', {
      migration,
      expected_checksum_sha256: expected,
      observed_checksum_sha256: normalizeLedgerChecksum(
        conflicting[0]?.migration_checksum_sha256 ?? conflicting[0]?.checksum_sha256,
      ),
      conflicting_record_count: conflicting.length,
    });
  }
  return safeRows.find(
    (row) => normalizeLedgerChecksum(row?.migration_checksum_sha256 ?? row?.checksum_sha256) === expected,
  ) || null;
}

async function readCanonicalGovernedLedger(connection, database, migration, checksum) {
  const required = [
    'run_id', 'migration_file', 'migration_checksum_sha256', 'applied_at', 'applied_by', 'runner_version',
    'mode', 'statement_count', 'preflight_status', 'preflight_risk_count', 'requirements_json', 'results_json',
    'before_schema_objects_json', 'after_schema_objects_json', 'metadata_json', 'secrets_included',
  ];
  const [tableRows] = await connection.execute(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'governed_migration_ledger' LIMIT 1",
    [database],
  );
  if (tableRows.length !== 1) fail('RECOVERY_GOVERNED_MIGRATION_LEDGER_REQUIRED', { migration });
  const [columnRows] = await connection.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'governed_migration_ledger' AND COLUMN_NAME IN (${required.map(() => '?').join(',')})`,
    [database, ...required],
  );
  const present = new Set(columnRows.map((row) => String(row.COLUMN_NAME)));
  const missing = required.filter((column) => !present.has(column));
  if (missing.length) fail('RECOVERY_GOVERNED_MIGRATION_LEDGER_CONTRACT_INCOMPLETE', { migration, missing });
  const [rows] = await connection.execute(
    "SELECT run_id, migration_checksum_sha256, mode, applied_at FROM governed_migration_ledger WHERE migration_file = ? AND mode = 'apply' ORDER BY applied_at DESC",
    [migration],
  );
  return selectCanonicalLedgerApplyRecord(rows, migration, checksum);
}

async function insertCanonicalGovernedLedger(connection, {
  migration,
  checksum,
  statementCount,
  result,
  expectedSha,
}) {
  const runId = crypto.randomUUID();
  const executionResultStatus = String(result?.status || '');
  if (!['applied', 'schema_already_ready'].includes(executionResultStatus)) {
    fail('RECOVERY_FALLBACK_INCIDENT_APPLY_READBACK_REQUIRED', {
      migration,
      observed_status: executionResultStatus || null,
    });
  }
  const metadata = {
    source: 'github_production_runtime_recovery_fallback',
    exact_production_sha: expectedSha,
    authorized_apply_execution: true,
    sql_applied_by_this_run: executionResultStatus === 'applied',
    execution_result_status: executionResultStatus,
    provider_mutation_performed: false,
    secrets_included: false,
  };
  const results = {
    recovery_strategy: 'fallback',
    canonical_postconditions_ready: true,
    fallback_result_status: executionResultStatus,
    canonical_evidence_mode: 'apply',
    secrets_included: false,
  };
  await connection.execute(
    `INSERT INTO governed_migration_ledger
      (run_id, migration_file, migration_checksum_sha256, applied_by, runner_version, mode,
       statement_count, preflight_status, preflight_risk_count, requirements_json, results_json,
       before_schema_objects_json, after_schema_objects_json, metadata_json, secrets_included)
     VALUES (?, ?, ?, ?, ?, 'apply', ?, 'pass', 0, ?, ?, ?, ?, ?, 0)`,
    [
      runId,
      migration,
      checksum,
      'github_runtime_recovery_fallback',
      'github-runtime-recovery-fallback-v2',
      statementCount,
      JSON.stringify({ source: 'reviewed_recovery_contract', secrets_included: false }),
      JSON.stringify(results),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify(metadata),
    ],
  );
  return { run_id: runId, mode: 'apply', recorded: true, execution_result_status: executionResultStatus };
}

export async function prepareFallbackCanonicalLedger(env, contract = ROUTE_CONTRACT) {
  const targets = arrayFromEnv(env, 'RUNTIME_RECOVERY_TARGETS_JSON');
  const targetIndex = targets.findIndex((item) => String(item?.key || '') === String(env.RECOVERY_TARGET_KEY || 'runtime'));
  if (targetIndex < 0) fail('RECOVERY_TARGET_NOT_FOUND');
  const target = targets[targetIndex];
  const incidentEntries = Array.isArray(target.incident_recovery_migrations) ? target.incident_recovery_migrations : [];
  if (!incidentEntries.length) return { env, target, incident: [], connection: null };
  const mysql = requireFromApi('mysql2/promise');
  const connection = await mysql.createConnection(fallbackMysqlConfig(env, target));
  const incident = [];
  const retained = [];
  try {
    for (const rawEntry of incidentEntries) {
      const entry = typeof rawEntry === 'string' ? { file: rawEntry } : rawEntry;
      const migration = path.basename(String(entry.file || '').replaceAll('\\', '/'));
      const spec = contract.recovery_migrations?.[migration];
      if (!spec || spec.incident_role !== 'only_current_apply_candidate') {
        fail('RECOVERY_INCIDENT_MIGRATION_ROLE_DENIED', { migration });
      }
      if (spec.direct_fallback_authorized !== true || spec.direct_fallback_idempotent !== true) {
        fail('RECOVERY_INCIDENT_DIRECT_FALLBACK_AUTHORIZATION_REQUIRED', { migration });
      }
      const checksum = String(spec.sha256).toLowerCase();
      const ledger = await readCanonicalGovernedLedger(connection, target.database, migration, checksum);
      const postconditions = await assertIncidentPostconditions(connection, target.database, migration, contract);
      if (ledger && !postconditions.ready) {
        fail('RECOVERY_GOVERNED_LEDGER_SCHEMA_DIVERGENCE', { migration, run_id: ledger.run_id || null, postconditions });
      }
      if (ledger) {
        incident.push({ migration, state: 'already_applied', ledger_run_id: ledger.run_id || null, postconditions });
        continue;
      }

      retained.push(entry);
      incident.push({
        migration,
        state: 'apply_required',
        ledger_run_id: null,
        schema_ready_before: postconditions.ready,
        authorization_reason: postconditions.ready
          ? 'canonical_apply_ledger_missing_idempotent_reexecution_required'
          : 'canonical_apply_ledger_missing_schema_not_ready',
        postconditions,
      });
    }
    targets[targetIndex] = { ...target, incident_recovery_migrations: retained };
    return {
      env: { ...env, RUNTIME_RECOVERY_TARGETS_JSON: JSON.stringify(targets) },
      target,
      incident,
      connection,
    };
  } catch (error) {
    await connection.end().catch(() => {});
    throw error;
  }
}

export async function finalizeFallbackCanonicalLedger(prepared, recoveryResult, env, contract = ROUTE_CONTRACT) {
  if (!prepared?.connection) return { incident: prepared?.incident || [], ledger_recorded: [] };
  const recorded = [];
  try {
    const migrationResults = Array.isArray(recoveryResult?.database?.migrations) ? recoveryResult.database.migrations : [];
    for (const state of prepared.incident.filter((item) => item.state === 'apply_required')) {
      const spec = contract.recovery_migrations?.[state.migration];
      const result = migrationResults.find((item) => String(item.file || '').endsWith(`/${state.migration}`));
      const observedStatus = String(result?.status || '');
      if (!result || !['applied', 'schema_already_ready'].includes(observedStatus)) {
        fail('RECOVERY_FALLBACK_INCIDENT_APPLY_READBACK_REQUIRED', {
          migration: state.migration,
          observed_status: observedStatus || null,
        });
      }
      const postconditions = await assertIncidentPostconditions(prepared.connection, prepared.target.database, state.migration, contract);
      if (!postconditions.ready) fail('RECOVERY_FALLBACK_INCIDENT_POSTCONDITION_FAILED', { migration: state.migration, postconditions });
      const ledger = await readCanonicalGovernedLedger(prepared.connection, prepared.target.database, state.migration, spec.sha256);
      if (ledger) {
        recorded.push({
          migration: state.migration,
          run_id: ledger.run_id || null,
          mode: 'apply',
          preexisting: true,
          execution_result_status: observedStatus,
        });
      } else {
        const entry = await insertCanonicalGovernedLedger(prepared.connection, {
          migration: state.migration,
          checksum: spec.sha256,
          statementCount: spec.statement_count,
          result,
          expectedSha: String(env.EXPECTED_SHA || ''),
        });
        recorded.push({
          migration: state.migration,
          run_id: entry.run_id,
          mode: 'apply',
          preexisting: false,
          execution_result_status: observedStatus,
        });
      }
    }
    return { incident: prepared.incident, ledger_recorded: recorded };
  } finally {
    await prepared.connection.end().catch(() => {});
  }
}

export async function executeRecovery(env = process.env, contract = ROUTE_CONTRACT) {
  const plan = validateRecoveryPlan(env, contract);
  const operator = await import('./production-runtime-recovery-autodeploy.mjs');
  let result;
  let canonicalGovernedLedger = null;
  if (plan.strategy === 'fallback' && parseBoolean(env.APPLY_EXECUTION, false)) {
    const prepared = await prepareFallbackCanonicalLedger(env, contract);
    try {
      result = await operator.run(prepared.env);
    } catch (error) {
      if (prepared.connection) await prepared.connection.end().catch(() => {});
      throw error;
    }
    canonicalGovernedLedger = await finalizeFallbackCanonicalLedger(prepared, result, env, contract);
  } else {
    result = await operator.run(env);
  }
  return {
    ...result,
    ...(canonicalGovernedLedger ? { canonical_governed_ledger: canonicalGovernedLedger } : {}),
    centralized_policy: {
      contract: plan.contract,
      strategy: plan.strategy,
      production_origin: plan.strategy === 'snapshot'
        ? null
        : validateProductionBaseUrl(env.PRODUCTION_BASE_URL, contract),
      fallback_target: plan.fallback_target,
      secrets_included: false,
    },
  };
}

async function main() {
  const mode = String(process.argv[2] || 'preflight');
  let result;
  if (mode === 'preflight') result = validateRecoveryPlan(process.env);
  else if (mode === 'execute') result = await executeRecovery(process.env);
  else if (mode === 'grant-readback') result = await verifyGrantReadback(process.env);
  else if (mode === 'persistence-readback') result = await verifyPersistenceReadback(process.env);
  else fail('RECOVERY_POLICY_MODE_INVALID', { mode });
  if (mode === 'execute' && process.env.RUNTIME_RECOVERY_RESULT_PATH) {
    fs.writeFileSync(process.env.RUNTIME_RECOVERY_RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || error.message, details: error.details || null })}\n`);
    process.exitCode = 1;
  });
}
