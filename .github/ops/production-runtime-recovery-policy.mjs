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
const DEPLOYMENT_BRANCH_POLICY = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'http-generic-api', 'config', 'deployment-branch-policy.json'), 'utf8'),
);

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

export function validateProductionBaseUrl(env = process.env, deploymentPolicy = DEPLOYMENT_BRANCH_POLICY) {
  const configured = String(env.PRODUCTION_BASE_URL || 'https://auth.mad4b.com').trim();
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    fail('RECOVERY_PRODUCTION_BASE_URL_INVALID');
  }
  const allowedHosts = new Set([deploymentPolicy.production?.hostname]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase()));
  const expectedBranch = String(deploymentPolicy.production?.source_branch || 'Production');
  const configuredBranch = String(env.PRODUCTION_SOURCE_BRANCH || expectedBranch);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    fail('RECOVERY_PRODUCTION_ORIGIN_TRANSPORT_DENIED', { protocol: parsed.protocol, port: parsed.port || null });
  }
  if (!allowedHosts.has(parsed.hostname.toLowerCase())) {
    fail('RECOVERY_PRODUCTION_ORIGIN_HOST_DENIED', { hostname: parsed.hostname, allowed_hosts: [...allowedHosts] });
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    fail('RECOVERY_PRODUCTION_BASE_URL_MUST_BE_ORIGIN', { pathname: parsed.pathname, has_query: Boolean(parsed.search), has_hash: Boolean(parsed.hash) });
  }
  if (configuredBranch !== expectedBranch) {
    fail('RECOVERY_PRODUCTION_SOURCE_BRANCH_DENIED', { configured_branch: configuredBranch, expected_branch: expectedBranch });
  }
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

function canonicalMigrationFile(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('RECOVERY_FALLBACK_MIGRATION_OBJECT_REQUIRED');
  const file = String(entry.file || '').replaceAll('\\', '/');
  const prefix = 'http-generic-api/migrations/';
  if (!file.startsWith(prefix) || file.includes('..') || file.slice(prefix.length).includes('/')) {
    fail('RECOVERY_FALLBACK_MIGRATION_PATH_DENIED', { file });
  }
  return { file, migration: file.slice(prefix.length) };
}

export function assertFallbackMigration(entry, contract = ROUTE_CONTRACT) {
  const { file, migration } = canonicalMigrationFile(entry);
  const fallbackPolicy = contract.fallback_sql_policy || {};
  const inferredIncident = fallbackPolicy.incident_apply_migrations?.includes(migration) === true;
  const role = String(entry.recovery_role || (inferredIncident ? 'incident' : ''));
  if (fallbackPolicy.require_explicit_recovery_role !== false && !entry.recovery_role) {
    fail('RECOVERY_FALLBACK_MIGRATION_ROLE_REQUIRED', { migration });
  }

  if (role === 'incident') {
    if (!inferredIncident) {
      fail('RECOVERY_FALLBACK_INCIDENT_MIGRATION_DENIED', { migration });
    }
    const reviewedSpec = contract.recovery_migrations?.[migration];
    const spec = assertMigration({
      migration,
      expected_checksum_sha256: entry.expected_checksum,
      expected_statement_count: entry.expected_statement_count ?? reviewedSpec?.statement_count,
    }, 'apply', contract);
    if (spec.direct_fallback_idempotent !== true) {
      fail('RECOVERY_FALLBACK_IDEMPOTENCY_NOT_REVIEWED', { migration });
    }
    return { file, migration, role, spec };
  }

  if (role === 'baseline') {
    const baseline = fallbackPolicy.baseline_bootstrap_migrations?.[file];
    if (!baseline) fail('RECOVERY_FALLBACK_BASELINE_MIGRATION_DENIED', { file });
    if (String(entry.expected_checksum || '').toLowerCase() !== String(baseline.sha256 || '').toLowerCase()) {
      fail('RECOVERY_FALLBACK_BASELINE_CHECKSUM_REQUIRED', { file });
    }
    if (Number(entry.expected_statement_count) !== Number(baseline.statement_count)) {
      fail('RECOVERY_FALLBACK_BASELINE_STATEMENT_COUNT_REQUIRED', { file });
    }
    return { file, migration, role, spec: baseline };
  }

  fail('RECOVERY_FALLBACK_MIGRATION_ROLE_DENIED', { migration, role });
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

  if (strategy === 'snapshot') {
    if (!['github_snapshot', 'repository_snapshot'].includes(String(env.RUNTIME_RECOVERY_SOURCE_MODE || ''))) {
      fail('RECOVERY_SNAPSHOT_SOURCE_REQUIRED');
    }
    if (String(env.APPLY_EXECUTION || '').toLowerCase() === 'true') fail('RECOVERY_SNAPSHOT_MUTATION_DENIED');
  } else {
    validateProductionBaseUrl(env);
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
  let fallbackMigrations = [];
  if (strategy === 'fallback') {
    const targets = arrayFromEnv(env, 'RUNTIME_RECOVERY_TARGETS_JSON');
    fallbackTarget = targets.find((item) => String(item?.key || '') === String(env.RECOVERY_TARGET_KEY || 'runtime'));
    if (!fallbackTarget) fail('RECOVERY_TARGET_NOT_FOUND');
    fallbackMigrations = (fallbackTarget.migrations || []).map((entry) => assertFallbackMigration(entry, contract));

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
    contract: 'production-runtime-recovery-config-policy.v3',
    strategy,
    source_mode: String(env.RUNTIME_RECOVERY_SOURCE_MODE || 'sql'),
    production_origin: strategy === 'snapshot' ? null : validateProductionBaseUrl(env),
    unknown_tool_policy: contract.routes?.gpt_tool_call?.tool_policy?.unknown_tool_policy || null,
    verification_only_migrations: Object.entries(contract.recovery_migrations || {})
      .filter(([, spec]) => spec.incident_role === 'verification_only')
      .map(([name]) => name),
    apply_candidates: Object.entries(contract.recovery_migrations || {})
      .filter(([, spec]) => spec.incident_role === 'only_current_apply_candidate')
      .map(([name]) => name),
    fallback_migrations: fallbackMigrations.map(({ migration, role }) => ({ migration, role })),
    grant_table_count: contract.grant_policy?.required_tables?.length || 0,
    fallback_target: fallbackTarget?.key || null,
    secrets_included: false,
  };
}

function requireEvidenceDir(env) {
  const dir = String(env.EVIDENCE_DIR || '').trim();
  if (!dir) fail('RECOVERY_EVIDENCE_DIR_REQUIRED');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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
    database: target.database,
    connectTimeout: 15000,
  };
}

async function assertIncidentPostconditions(connection, database, migration, contract = ROUTE_CONTRACT) {
  const checks = contract.fallback_sql_policy?.incident_postconditions?.[migration] || [];
  const evidence = [];
  for (const check of checks) {
    if (check.type === 'column') {
      const [rows] = await connection.execute(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
        [database, check.table, check.column],
      );
      evidence.push({ ...check, ready: rows.length === 1 });
    } else if (check.type === 'index') {
      const [rows] = await connection.execute(
        'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
        [database, check.table, check.index],
      );
      evidence.push({ ...check, ready: rows.length >= 1 });
    } else if (check.type === 'row') {
      const table = String(check.table || '');
      const keyColumn = String(check.key_column || '');
      const valueColumn = String(check.value_column || '');
      if (!/^[A-Za-z0-9_$.-]+$/u.test(table) || !/^[A-Za-z0-9_$.-]+$/u.test(keyColumn) || !/^[A-Za-z0-9_$.-]+$/u.test(valueColumn)) {
        fail('RECOVERY_FALLBACK_POSTCONDITION_IDENTIFIER_DENIED', { migration });
      }
      const [rows] = await connection.execute(
        `SELECT \`${valueColumn}\` AS observed_value FROM \`${table}\` WHERE \`${keyColumn}\` = ? LIMIT 1`,
        [check.key_value],
      );
      evidence.push({ ...check, ready: rows.length === 1 && String(rows[0].observed_value) === String(check.expected_value) });
    } else {
      fail('RECOVERY_FALLBACK_POSTCONDITION_TYPE_DENIED', { migration, type: check.type });
    }
  }
  return { ready: evidence.length > 0 && evidence.every((item) => item.ready), checks: evidence };
}

async function readCanonicalGovernedLedger(connection, migration, checksum) {
  const [tableRows] = await connection.execute(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'governed_migration_ledger' LIMIT 1",
  );
  if (tableRows.length !== 1) fail('RECOVERY_GOVERNED_MIGRATION_LEDGER_REQUIRED', { migration });
  const [conflicts] = await connection.execute(
    "SELECT run_id, migration_checksum_sha256, mode, applied_at FROM governed_migration_ledger WHERE migration_file = ? AND mode = 'apply' ORDER BY applied_at DESC LIMIT 10",
    [migration],
  );
  const exact = conflicts.find((row) => String(row.migration_checksum_sha256 || '').toLowerCase() === checksum.toLowerCase()) || null;
  const checksumConflict = conflicts.find((row) => String(row.migration_checksum_sha256 || '').toLowerCase() !== checksum.toLowerCase()) || null;
  if (!exact && checksumConflict) {
    fail('RECOVERY_GOVERNED_LEDGER_CHECKSUM_DIVERGENCE', {
      migration,
      observed_checksum_sha256: String(checksumConflict.migration_checksum_sha256 || '').toLowerCase(),
      expected_checksum_sha256: checksum.toLowerCase(),
    });
  }
  return exact;
}

async function insertCanonicalGovernedLedger(connection, {
  migration,
  checksum,
  statementCount,
  mode,
  result,
  expectedSha,
}) {
  const runId = crypto.randomUUID();
  const metadata = {
    source: 'github_production_runtime_recovery_fallback',
    exact_production_sha: expectedSha,
    sql_applied_by_this_run: mode === 'apply',
    provider_mutation_performed: false,
    secrets_included: false,
  };
  const results = {
    recovery_strategy: 'fallback',
    canonical_postconditions_ready: true,
    fallback_result_status: result?.status || null,
    secrets_included: false,
  };
  await connection.execute(
    `INSERT INTO governed_migration_ledger
      (run_id, migration_file, migration_checksum_sha256, applied_by, runner_version, mode,
       statement_count, preflight_status, preflight_risk_count, requirements_json, results_json,
       before_schema_objects_json, after_schema_objects_json, metadata_json, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pass', 0, ?, ?, ?, ?, ?, 0)`,
    [
      runId,
      migration,
      checksum,
      'github_runtime_recovery_fallback',
      'github-runtime-recovery-fallback-v1',
      mode,
      statementCount,
      JSON.stringify({ source: 'reviewed_recovery_contract', secrets_included: false }),
      JSON.stringify(results),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify(metadata),
    ],
  );
  return { run_id: runId, mode, recorded: true };
}

async function prepareFallbackCanonicalLedger(env, contract = ROUTE_CONTRACT) {
  const targets = arrayFromEnv(env, 'RUNTIME_RECOVERY_TARGETS_JSON');
  const targetIndex = targets.findIndex((item) => String(item?.key || '') === String(env.RECOVERY_TARGET_KEY || 'runtime'));
  if (targetIndex < 0) fail('RECOVERY_TARGET_NOT_FOUND');
  const target = targets[targetIndex];
  const incidentEntries = (target.migrations || [])
    .map((entry) => ({ entry, validated: assertFallbackMigration(entry, contract) }))
    .filter(({ validated }) => validated.role === 'incident');
  if (!incidentEntries.length) return { env, target, incident: [], connection: null };

  const mysql = requireFromApi('mysql2/promise');
  const connection = await mysql.createConnection(fallbackMysqlConfig(env, target));
  const incident = [];
  const retainedMigrations = [];
  try {
    for (const { entry, validated } of incidentEntries) {
      const migration = validated.migration;
      const checksum = String(validated.spec.sha256).toLowerCase();
      const ledger = await readCanonicalGovernedLedger(connection, migration, checksum);
      const postconditions = await assertIncidentPostconditions(connection, target.database, migration, contract);
      if (ledger && !postconditions.ready) {
        fail('RECOVERY_GOVERNED_LEDGER_SCHEMA_DIVERGENCE', { migration, run_id: ledger.run_id || null, postconditions });
      }
      if (ledger) {
        incident.push({ migration, state: 'already_applied', ledger_run_id: ledger.run_id || null, postconditions });
        continue;
      }
      if (postconditions.ready) {
        const recorded = await insertCanonicalGovernedLedger(connection, {
          migration,
          checksum,
          statementCount: validated.spec.statement_count,
          mode: 'record_only',
          result: { status: 'schema_already_ready' },
          expectedSha: String(env.EXPECTED_SHA || ''),
        });
        incident.push({ migration, state: 'schema_already_ready', ledger_run_id: recorded.run_id, postconditions });
        continue;
      }
      retainedMigrations.push({ ...entry, done_when: [] });
      incident.push({ migration, state: 'apply_required', ledger_run_id: null, postconditions });
    }
    const nonIncident = (target.migrations || []).filter((entry) => assertFallbackMigration(entry, contract).role !== 'incident');
    targets[targetIndex] = { ...target, migrations: [...nonIncident, ...retainedMigrations] };
    return {
      env: { ...env, RUNTIME_RECOVERY_TARGETS_JSON: JSON.stringify(targets) },
      target,
      incident,
      connection,
    };
  } catch (error) {
    await connection.end();
    throw error;
  }
}

async function finalizeFallbackCanonicalLedger(prepared, recoveryResult, env, contract = ROUTE_CONTRACT) {
  if (!prepared?.connection) return { incident: prepared?.incident || [], ledger_recorded: [] };
  const recorded = [];
  try {
    const migrationResults = Array.isArray(recoveryResult?.database?.migrations) ? recoveryResult.database.migrations : [];
    for (const state of prepared.incident.filter((item) => item.state === 'apply_required')) {
      const spec = contract.recovery_migrations?.[state.migration];
      const result = migrationResults.find((item) => String(item.file || '').endsWith(`/${state.migration}`));
      if (!result || result.status !== 'applied') {
        fail('RECOVERY_FALLBACK_INCIDENT_APPLY_READBACK_REQUIRED', { migration: state.migration, observed_status: result?.status || null });
      }
      const postconditions = await assertIncidentPostconditions(prepared.connection, prepared.target.database, state.migration, contract);
      if (!postconditions.ready) fail('RECOVERY_FALLBACK_INCIDENT_POSTCONDITION_FAILED', { migration: state.migration, postconditions });
      const ledger = await readCanonicalGovernedLedger(prepared.connection, state.migration, spec.sha256);
      if (ledger) {
        recorded.push({ migration: state.migration, run_id: ledger.run_id || null, mode: 'apply', preexisting: true });
        continue;
      }
      const entry = await insertCanonicalGovernedLedger(prepared.connection, {
        migration: state.migration,
        checksum: spec.sha256,
        statementCount: spec.statement_count,
        mode: 'apply',
        result,
        expectedSha: String(env.EXPECTED_SHA || ''),
      });
      recorded.push({ migration: state.migration, run_id: entry.run_id, mode: 'apply', preexisting: false });
    }
    return { incident: prepared.incident, ledger_recorded: recorded };
  } finally {
    await prepared.connection.end();
  }
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
  const base = validateProductionBaseUrl(env);
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

export async function executeRecovery(env = process.env, contract = ROUTE_CONTRACT) {
  const plan = validateRecoveryPlan(env, contract);
  const module = await import('./production-runtime-recovery-autodeploy.mjs');
  if (plan.strategy !== 'fallback' || String(env.APPLY_EXECUTION || '').toLowerCase() !== 'true') {
    return module.run(env);
  }

  const prepared = await prepareFallbackCanonicalLedger(env, contract);
  let result;
  try {
    result = await module.run(prepared.env);
  } catch (error) {
    if (prepared.connection) await prepared.connection.end().catch(() => {});
    throw error;
  }
  const canonicalLedger = await finalizeFallbackCanonicalLedger(prepared, result, env, contract);
  return { ...result, canonical_governed_ledger: canonicalLedger };
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
