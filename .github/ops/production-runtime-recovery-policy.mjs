#!/usr/bin/env node

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
  const base = String(env.PRODUCTION_BASE_URL || 'https://auth.mad4b.com').replace(/\/$/, '');
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

async function main() {
  const mode = String(process.argv[2] || 'preflight');
  let result;
  if (mode === 'preflight') result = validateRecoveryPlan(process.env);
  else if (mode === 'grant-readback') result = await verifyGrantReadback(process.env);
  else if (mode === 'persistence-readback') result = await verifyPersistenceReadback(process.env);
  else fail('RECOVERY_POLICY_MODE_INVALID', { mode });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || error.message, details: error.details || null })}\n`);
    process.exitCode = 1;
  });
}
