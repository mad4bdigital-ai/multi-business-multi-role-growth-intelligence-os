#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadRuntimeRecoverySnapshot,
  resolveRuntimeRecoverySourceMode,
} from '../../http-generic-api/runtimeRecoverySnapshot.js';
import {
  validateFallbackTargetPlan,
  validateProductionBaseUrl,
  validateRecoveryPlan,
} from './production-runtime-recovery-policy.mjs';
import { splitStatements } from '../../http-generic-api/scripts/staging-sql-parser.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS_ROOT = path.join(REPO_ROOT, 'http-generic-api', 'migrations');
const ROUTE_CONTRACT_PATH = path.join(__dirname, 'production-runtime-recovery-routes.json');
const ROUTE_CONTRACT = JSON.parse(fs.readFileSync(ROUTE_CONTRACT_PATH, 'utf8'));
const SHA_RE = /^[0-9a-f]{40}$/;
const IDENTIFIER_RE = /^[A-Za-z0-9_$.-]+$/;
const ACCOUNT_HOST_RE = /^[A-Za-z0-9_$%.:-]+$/;
const SAFE_PRIVILEGES = new Set(['SELECT', 'INSERT', 'UPDATE']);
const DEFAULT_GRANT_TABLES = Object.freeze([
  'customer_sessions',
  'gpt_session_turns',
  'actions',
  'dynamic_audit_scheduler_runs',
  'execution_log',
  'json_assets',
]);

export function typedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

export function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function parseJson(value, fallback, label = 'JSON') {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw typedError('invalid_json', `${label} is not valid JSON`, { label, cause: error.message });
  }
}

export function renderTemplate(value, context) {
  if (typeof value === 'string') {
    return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(context, key) ? String(context[key] ?? '') : match,
    );
  }
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderTemplate(item, context)]));
  }
  return value;
}

export function isSubset(expected, actual) {
  if (expected === actual) return true;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length > actual.length) return false;
    return expected.every((item, index) => isSubset(item, actual[index]));
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected).every(([key, value]) =>
      Object.prototype.hasOwnProperty.call(actual, key) && isSubset(value, actual[key]),
    );
  }
  return false;
}

export function validateSha(value, label = 'expected_sha') {
  const sha = String(value || '').trim().toLowerCase();
  if (!SHA_RE.test(sha)) throw typedError('invalid_sha', `${label} must be a full 40-character commit SHA`, { label });
  return sha;
}

export function requiredConfirmation(strategy, sha) {
  return `RECOVER:${strategy}:${sha}`;
}

export function validateApplyGate({ strategy, sha, applyExecution, confirmation }) {
  if (!applyExecution) return;
  const expected = requiredConfirmation(strategy, sha);
  if (String(confirmation || '') !== expected) {
    throw typedError('confirmation_mismatch', 'Mutation confirmation must bind the exact strategy and Production SHA', {
      expected_confirmation: expected,
    });
  }
}

export function resolveMigrationPath(file) {
  const raw = String(file || '').trim().replace(/\\/g, '/');
  const rel = raw.startsWith('http-generic-api/migrations/')
    ? raw.slice('http-generic-api/migrations/'.length)
    : raw;
  if (!rel || rel.includes('..') || rel.startsWith('/') || !/^[A-Za-z0-9_.\/-]+\.sql$/.test(rel)) {
    throw typedError('unsafe_migration_path', 'Migration must remain inside http-generic-api/migrations', { file: raw });
  }
  const absolute = path.resolve(MIGRATIONS_ROOT, rel);
  if (!absolute.startsWith(`${MIGRATIONS_ROOT}${path.sep}`)) {
    throw typedError('unsafe_migration_path', 'Migration escaped canonical migrations root', { file: raw });
  }
  return { absolute, repoPath: `http-generic-api/migrations/${rel}` };
}

export function validateTargetPlan(target) {
  if (!target || typeof target !== 'object') throw typedError('target_invalid', 'Recovery target must be an object');
  for (const field of ['key', 'database']) {
    if (!target[field] || !IDENTIFIER_RE.test(String(target[field]))) {
      throw typedError('target_invalid', `Target ${field} is missing or unsafe`, { field });
    }
  }
  if (Object.hasOwn(target, 'migrations')) throw typedError('ambiguous_migrations_field', 'Fallback target must separate baseline_bootstrap_migrations from incident_recovery_migrations');
  if (target.principal && !IDENTIFIER_RE.test(String(target.principal))) throw typedError('target_invalid', 'Target principal is unsafe');
  if (target.principal_host && !ACCOUNT_HOST_RE.test(String(target.principal_host))) throw typedError('target_invalid', 'Target principal_host is unsafe');
  for (const entry of Array.isArray(target.baseline_bootstrap_migrations) ? target.baseline_bootstrap_migrations : []) {
    const file = typeof entry === 'string' ? entry : entry?.file;
    if (String(file || '').replaceAll('\\', '/') !== 'http-generic-api/schema.sql') {
      throw typedError('baseline_migration_path_denied', 'Baseline bootstrap must use the canonical schema artifact', { file });
    }
  }
  for (const entry of Array.isArray(target.incident_recovery_migrations) ? target.incident_recovery_migrations : []) {
    resolveMigrationPath(typeof entry === 'string' ? entry : entry?.file);
  }
  return target;
}

export function resolveRoute(routeKey) {
  const key = String(routeKey || '').trim();
  const route = ROUTE_CONTRACT.routes?.[key];
  if (!route) throw typedError('route_key_unknown', 'Configured recovery step references an unknown route_key', { route_key: key });
  if (!ROUTE_CONTRACT.allowed_configured_steps?.includes(key)) {
    throw typedError('route_key_not_allowed', 'Configured recovery step route_key is outside the recovery allow-list', { route_key: key });
  }
  return { key, ...route };
}

export function validateConfiguredStep(step, { allowMutation = false } = {}) {
  if (!step || typeof step !== 'object') throw typedError('step_invalid', 'Configured recovery step must be an object');
  const route = resolveRoute(step.route_key);
  if (step.path !== undefined || step.url !== undefined) {
    throw typedError('arbitrary_route_forbidden', 'Recovery steps must use route_key; arbitrary path/url values are forbidden', { route_key: route.key });
  }
  if (step.method && String(step.method).toUpperCase() !== route.method) {
    throw typedError('route_method_mismatch', 'Configured method does not match canonical route contract', {
      route_key: route.key,
      expected_method: route.method,
      configured_method: String(step.method).toUpperCase(),
    });
  }
  if (step.mutation === true && !allowMutation) {
    throw typedError('mutation_step_blocked', 'Mutation step is not allowed in this phase', { name: step.name || route.key });
  }
  if (route.key === 'gpt_tool_call') {
    if (!step.body || typeof step.body !== 'object' || typeof step.body.name !== 'string' || !step.body.tool_args || typeof step.body.tool_args !== 'object' || Array.isArray(step.body.tool_args)) {
      throw typedError('tool_call_envelope_invalid', 'gpt_tool_call requires {name:string, tool_args:object}', { name: step.name || route.key });
    }
  }
  return route;
}

function cleanError(error) {
  return {
    code: error?.code || 'runtime_recovery_failed',
    message: error?.message || String(error),
    details: error?.details || undefined,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function gitHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim().toLowerCase();
}

function buildContext(sha, env) {
  return {
    repository: env.GITHUB_REPOSITORY || '',
    branch: env.PRODUCTION_SOURCE_BRANCH || 'Production',
    sha,
    run_id: env.GITHUB_RUN_ID || '',
    run_attempt: env.GITHUB_RUN_ATTEMPT || '',
  };
}

async function githubHeadSha(env, branch) {
  if (!env.GITHUB_REPOSITORY || !env.GITHUB_TOKEN) throw typedError('github_identity_missing', 'GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const response = await fetch(`${api}/repos/${env.GITHUB_REPOSITORY}/branches/${encodeURIComponent(branch)}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw typedError('github_head_read_failed', 'Could not read Production branch head', { status: response.status, branch });
  const body = await response.json();
  return validateSha(body?.commit?.sha, 'github_branch_head');
}

async function assertExactGitHubHead(env, sha) {
  const branch = env.PRODUCTION_SOURCE_BRANCH || 'Production';
  const observed = await githubHeadSha(env, branch);
  if (observed !== sha) throw typedError('source_head_moved', 'Expected SHA is no longer exact Production head', { branch, expected_sha: sha, observed_sha: observed });
  return { branch, sha: observed };
}

function validateHttps(urlString, env, label) {
  let parsed;
  try { parsed = new URL(urlString); } catch { throw typedError('invalid_url', `${label} is not a valid URL`); }
  if (parsed.protocol !== 'https:' && !parseBoolean(env.RUNTIME_RECOVERY_ALLOW_INSECURE_HTTP, false)) {
    throw typedError('insecure_url_blocked', `${label} must use HTTPS`);
  }
  return parsed.toString();
}

function routeUrl(env, route) {
  const base = validateProductionBaseUrl(env.PRODUCTION_BASE_URL, ROUTE_CONTRACT).replace(/\/$/, '');
  return validateHttps(`${base}${route.path}`, env, route.key);
}

function requestHeaders(env, route) {
  const headers = { Accept: 'application/json,text/plain;q=0.9' };
  if (route.auth === 'bearer') {
    const token = String(env.PRODUCTION_PROBE_AUTH_VALUE || '');
    if (token) headers[String(env.PRODUCTION_PROBE_AUTH_HEADER || 'Authorization')] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }
  return headers;
}

async function requestJsonish(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs || 30000),
  });
  const text = await response.text();
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch { /* classification handles non-JSON */ } }
  return { status: response.status, ok: response.ok, text, json };
}

function manifestIdentity(response) {
  const body = response?.json;
  return {
    git_commit_full: typeof body?.gitCommitFull === 'string' ? body.gitCommitFull.trim().toLowerCase() : null,
    git_branch: typeof body?.gitBranch === 'string' ? body.gitBranch.trim() : null,
  };
}

export function manifestMatches({ response, sha, branch }) {
  if (!response?.ok || !response?.json) return false;
  const identity = manifestIdentity(response);
  return identity.git_commit_full === sha && identity.git_branch === branch;
}

async function waitForAutoDeployParity(env, sha) {
  const branch = env.PRODUCTION_SOURCE_BRANCH || 'Production';
  const versionRoute = resolveRoute('version');
  const deploymentRoute = resolveRoute('deployment_info');
  const attempts = Math.max(1, Number(env.PRODUCTION_VERIFY_ATTEMPTS || 36));
  const intervalMs = Math.max(1000, Number(env.PRODUCTION_VERIFY_INTERVAL_SECONDS || 10) * 1000);
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const [version, deployment] = await Promise.all([
      requestJsonish(routeUrl(env, versionRoute), { headers: requestHeaders(env, versionRoute), timeoutMs: 15000 }),
      requestJsonish(routeUrl(env, deploymentRoute), { headers: requestHeaders(env, deploymentRoute), timeoutMs: 15000 }),
    ]);
    const versionIdentity = manifestIdentity(version);
    const deploymentIdentity = manifestIdentity(deployment);
    last = {
      attempt,
      version_status: version.status,
      deployment_info_status: deployment.status,
      version_identity: versionIdentity,
      deployment_info_identity: deploymentIdentity,
      version_matches: manifestMatches({ response: version, sha, branch }),
      deployment_info_matches: manifestMatches({ response: deployment, sha, branch }),
    };
    if (last.version_matches && last.deployment_info_matches) {
      return { ok: true, auto_deploy_observed: true, expected_sha: sha, expected_branch: branch, ...last };
    }
    if (attempt < attempts) await sleep(intervalMs);
  }
  throw typedError('autodeploy_runtime_parity_failed', 'Hostinger Auto Deploy did not become exact-SHA/branch current on both provenance routes', {
    expected_sha: sha,
    expected_branch: branch,
    last,
  });
}

function classifyRouteStatus(status) {
  if (status === 404 || status === 405) return 'route_contract_missing';
  if (status === 401 || status === 403) return 'route_present_auth_not_ready';
  if (status >= 500) return 'route_present_runtime_dependency_failed';
  if (status >= 200 && status < 400) return 'route_present';
  return 'route_present_unexpected_status';
}

async function probeRouteTopology(env) {
  const keys = ['health', 'version', 'deployment_info', 'gpt_tools'];
  const evidence = [];
  for (const key of keys) {
    const route = resolveRoute(key);
    const response = await requestJsonish(routeUrl(env, route), {
      method: route.method,
      headers: requestHeaders(env, route),
      timeoutMs: 15000,
    });
    const classification = classifyRouteStatus(response.status);
    if (classification === 'route_contract_missing') {
      throw typedError('runtime_route_contract_missing', 'A canonical Production recovery route is missing or has the wrong method', {
        route_key: key,
        method: route.method,
        path: route.path,
        status: response.status,
      });
    }
    evidence.push({ route_key: key, method: route.method, path: route.path, status: response.status, classification });
  }
  return evidence;
}

async function runConfiguredSteps(env, sha, variableName, { allowMutation = false } = {}) {
  const steps = parseJson(env[variableName], [], variableName);
  if (!Array.isArray(steps)) throw typedError('steps_invalid', `${variableName} must be a JSON array`);
  const context = buildContext(sha, env);
  const results = [];
  for (const rawStep of steps) {
    const step = renderTemplate(rawStep, context);
    const route = validateConfiguredStep(step, { allowMutation });
    const headers = requestHeaders(env, route);
    let body;
    if (Object.prototype.hasOwnProperty.call(step, 'body')) {
      body = JSON.stringify(step.body);
      headers['Content-Type'] = 'application/json';
    }
    const response = await requestJsonish(routeUrl(env, route), {
      method: route.method,
      headers,
      body,
      timeoutMs: Number(step.timeout_ms || 30000),
    });
    const expectedStatus = Number(step.expected_status ?? 200);
    if (response.status !== expectedStatus) {
      throw typedError('http_step_status_mismatch', 'Recovery step returned unexpected status', {
        step: step.name || route.key,
        route_key: route.key,
        expected_status: expectedStatus,
        observed_status: response.status,
        classification: classifyRouteStatus(response.status),
      });
    }
    if (step.expected_json && !isSubset(step.expected_json, response.json)) {
      throw typedError('http_step_contract_mismatch', 'Recovery step response did not match expected_json', {
        step: step.name || route.key,
        route_key: route.key,
      });
    }
    results.push({
      name: step.name || route.key,
      route_key: route.key,
      method: route.method,
      path: route.path,
      status: response.status,
      contract_match: true,
      mutation: step.mutation === true,
    });
  }
  return results;
}

function getTargets(env) {
  const targets = parseJson(env.RUNTIME_RECOVERY_TARGETS_JSON, [], 'RUNTIME_RECOVERY_TARGETS_JSON');
  if (!Array.isArray(targets)) throw typedError('targets_invalid', 'RUNTIME_RECOVERY_TARGETS_JSON must be a JSON array');
  return targets.map(validateTargetPlan);
}

function selectTarget(env) {
  const key = String(env.RECOVERY_TARGET_KEY || '').trim();
  const target = getTargets(env).find((item) => String(item.key) === key);
  if (!target) throw typedError('target_not_found', 'RECOVERY_TARGET_KEY not found in RUNTIME_RECOVERY_TARGETS_JSON', { key });
  validateFallbackTargetPlan(target, ROUTE_CONTRACT);
  return target;
}

function loadMysql() {
  const requireFromRuntime = createRequire(path.join(REPO_ROOT, 'http-generic-api', 'package.json'));
  return requireFromRuntime('mysql2/promise');
}

function quoteIdentifier(value, label) {
  const stringValue = String(value || '');
  if (!IDENTIFIER_RE.test(stringValue)) throw typedError('unsafe_identifier', `${label} is unsafe`);
  return `\`${stringValue.replaceAll('`', '``')}\``;
}

async function databaseExists(connection, database) {
  const [rows] = await connection.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1', [database]);
  return rows.length > 0;
}

async function tableExists(connection, database, table) {
  const [rows] = await connection.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1', [database, table]);
  return rows.length > 0;
}

async function tableCount(connection, database) {
  const [rows] = await connection.execute('SELECT COUNT(*) AS table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [database]);
  return Number(rows[0]?.table_count || 0);
}

async function columnsExist(connection, database, table, columns) {
  if (!(await tableExists(connection, database, table))) return false;
  if (!columns?.length) return true;
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME IN (${columns.map(() => '?').join(',')})`,
    [database, table, ...columns],
  );
  const found = new Set(rows.map((row) => String(row.COLUMN_NAME)));
  return columns.every((column) => found.has(column));
}

async function doneWhenReady(connection, database, doneWhen = []) {
  if (!Array.isArray(doneWhen) || doneWhen.length === 0) return null;
  for (const check of doneWhen) {
    if (!check?.table || !IDENTIFIER_RE.test(String(check.table))) return false;
    const columns = Array.isArray(check.columns) ? check.columns.map(String) : [];
    if (columns.some((column) => !IDENTIFIER_RE.test(column))) return false;
    if (!(await columnsExist(connection, database, String(check.table), columns))) return false;
  }
  return true;
}

async function readLedger(connection, database, ledger) {
  if (!ledger?.migration_id || !(await tableExists(connection, database, 'schema_migrations'))) return { available: false, row: null };
  const required = ['migration_id', 'filename', 'checksum_sha256', 'status', 'error_message', 'applied_at', 'applied_by', 'execution_id'];
  if (!(await columnsExist(connection, database, 'schema_migrations', required))) {
    throw typedError('ledger_contract_incomplete', 'schema_migrations exists but governed ledger columns are incomplete');
  }
  const [rows] = await connection.execute(
    'SELECT migration_id, filename, checksum_sha256, status, error_message, applied_at, applied_by, execution_id FROM schema_migrations WHERE migration_id = ? LIMIT 1',
    [String(ledger.migration_id)],
  );
  return { available: true, row: rows[0] || null };
}

async function writeLedger(connection, database, entry, checksum, env) {
  if (!entry?.ledger?.migration_id) return { recorded: false };
  const state = await readLedger(connection, database, entry.ledger);
  if (!state.available) {
    if (entry.ledger.required !== false) throw typedError('ledger_missing', 'Canonical governed ledger is required before this migration can be recorded', { migration_id: entry.ledger.migration_id });
    return { recorded: false, reason: 'ledger_missing' };
  }
  const executionId = `github:${env.GITHUB_RUN_ID || 'manual'}:${env.GITHUB_RUN_ATTEMPT || '1'}`;
  await connection.execute(
    `INSERT INTO schema_migrations (migration_id, filename, checksum_sha256, status, error_message, applied_at, applied_by, execution_id)
     VALUES (?, ?, ?, 'applied', NULL, CURRENT_TIMESTAMP, ?, ?)
     ON DUPLICATE KEY UPDATE filename = VALUES(filename), checksum_sha256 = VALUES(checksum_sha256), status = 'applied', error_message = NULL, applied_at = VALUES(applied_at), applied_by = VALUES(applied_by), execution_id = VALUES(execution_id)`,
    [String(entry.ledger.migration_id), String(entry.ledger.filename || path.basename(entry.file)), checksum, 'github-actions', executionId],
  );
  return { recorded: true, migration_id: String(entry.ledger.migration_id) };
}

function resolveBaselineSchemaPath(file) {
  const normalized = String(file || '').trim().replaceAll('\\', '/');
  if (normalized !== 'http-generic-api/schema.sql' && normalized !== 'schema.sql') {
    throw typedError('baseline_migration_path_denied', 'Baseline bootstrap must use the canonical schema artifact', { file: normalized });
  }
  return path.join(REPO_ROOT, 'http-generic-api', 'schema.sql');
}

export function assertBaselineSchemaSafety(file, sql, spec) {
  const statements = splitStatements(sql);
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  if (checksum !== String(spec.sha256).toLowerCase()) throw typedError('baseline_migration_checksum_mismatch', 'Canonical baseline checksum differs from reviewed policy', { file });
  if (statements.length !== Number(spec.statement_count)) throw typedError('baseline_migration_statement_count_mismatch', 'Canonical baseline statement count differs from reviewed policy', { file });
  const forbidden = [
    /^\s*(?:GRANT|REVOKE|CREATE\s+USER|ALTER\s+USER|DROP\s+DATABASE|CREATE\s+DATABASE|INSERT|UPDATE|DELETE|LOAD\s+DATA)\b/imu,
    /^\s*SELECT[\s\S]*\bINTO\s+(?:OUTFILE|DUMPFILE)\b/imu,
  ];
  if (forbidden.some((pattern) => pattern.test(statements.join('\n')))) {
    throw typedError('baseline_migration_safety_denied', 'Baseline schema contains forbidden authority or data SQL', { file });
  }
  return statements;
}

async function applyBaselineBootstrap(connection, database, rawEntry) {
  const entry = typeof rawEntry === 'string' ? { file: rawEntry } : { ...rawEntry };
  const policy = ROUTE_CONTRACT.fallback_migration_policy?.baseline_bootstrap_migrations || [];
  const file = String(entry.file || '').replaceAll('\\', '/');
  const spec = policy.find((candidate) => String(candidate?.file || '') === file);
  if (!spec) throw typedError('baseline_migration_denied', 'Baseline bootstrap is outside the reviewed allowlist', { file });
  const absolute = resolveBaselineSchemaPath(file);
  if (!fs.existsSync(absolute)) throw typedError('baseline_migration_file_not_found', 'Canonical baseline schema artifact is missing', { file });
  const sql = fs.readFileSync(absolute, 'utf8');
  const statements = assertBaselineSchemaSafety(file, sql, spec);
  if (entry.expected_checksum && String(entry.expected_checksum).toLowerCase() !== String(spec.sha256).toLowerCase()) {
    throw typedError('baseline_migration_checksum_required', 'Configured baseline checksum does not match reviewed policy', { file });
  }
  if (entry.expected_statement_count !== undefined && Number(entry.expected_statement_count) !== Number(spec.statement_count)) {
    throw typedError('baseline_migration_statement_count_required', 'Configured baseline statement count does not match reviewed policy', { file });
  }
  const immediate = [];
  const deferredForeignKeys = [];
  for (const statement of statements) {
    if (/^\\s*CREATE\\s+TABLE[\\s\\S]*\\bFOREIGN\\s+KEY\\b/imu.test(statement)) deferredForeignKeys.push(statement);
    else immediate.push(statement);
  }
  const orderedSql = [...immediate, ...deferredForeignKeys].join(';\\n');
  await connection.query(`${orderedSql};\\n`);
  return {
    file,
    checksum_sha256: String(spec.sha256).toLowerCase(),
    statement_count: Number(spec.statement_count),
    status: 'baseline_applied',
  };
}

async function applyMigration(connection, database, rawEntry, env) {
  const entry = typeof rawEntry === 'string' ? { file: rawEntry } : { ...rawEntry };
  const { absolute, repoPath } = resolveMigrationPath(entry.file);
  if (!fs.existsSync(absolute)) throw typedError('migration_file_not_found', 'Configured canonical migration file does not exist', { file: repoPath });
  const checksum = hashFile(absolute);
  if (entry.expected_checksum && String(entry.expected_checksum).toLowerCase() !== checksum) {
    throw typedError('migration_checksum_mismatch', 'Configured checksum differs from repository migration', { file: repoPath, expected_checksum: String(entry.expected_checksum).toLowerCase(), observed_checksum: checksum });
  }
  for (const table of Array.isArray(entry.requires_tables) ? entry.requires_tables.map(String) : []) {
    if (!IDENTIFIER_RE.test(table) || !(await tableExists(connection, database, table))) {
      throw typedError('migration_dependency_missing', 'Required base table is missing; canonical baseline migrations must run first', { file: repoPath, table });
    }
  }
  const readyBefore = await doneWhenReady(connection, database, entry.done_when);
  const ledger = await readLedger(connection, database, entry.ledger);
  if (ledger.row) {
    const ledgerChecksum = String(ledger.row.checksum_sha256 || '').toLowerCase();
    if (ledgerChecksum && ledgerChecksum !== checksum) throw typedError('ledger_checksum_mismatch', 'Ledger checksum differs from repository migration', { migration_id: entry.ledger.migration_id });
    if (String(ledger.row.status || '').toLowerCase() === 'applied') {
      if (readyBefore === false) throw typedError('ledger_schema_divergence', 'Ledger says applied but declared schema postconditions are missing', { migration_id: entry.ledger.migration_id, file: repoPath });
      return { file: repoPath, checksum_sha256: checksum, status: 'already_applied', ledger_found: true };
    }
  }
  if (readyBefore === true) {
    const ledgerWrite = entry.ledger?.record_if_schema_ready ? await writeLedger(connection, database, entry, checksum, env) : { recorded: false };
    return { file: repoPath, checksum_sha256: checksum, status: 'schema_already_ready', ledger: ledgerWrite };
  }
  await connection.query(fs.readFileSync(absolute, 'utf8'));
  const readyAfter = await doneWhenReady(connection, database, entry.done_when);
  if (readyAfter === false) throw typedError('migration_postcondition_failed', 'Migration SQL completed but declared schema postconditions are not ready', { file: repoPath });
  const ledgerWrite = await writeLedger(connection, database, entry, checksum, env);
  return { file: repoPath, checksum_sha256: checksum, status: 'applied', ledger: ledgerWrite };
}

function normalizeGrants(target) {
  const source = Array.isArray(target.grants) && target.grants.length
    ? target.grants
    : DEFAULT_GRANT_TABLES.map((table) => ({ table, privileges: ['SELECT', 'INSERT', 'UPDATE'] }));
  return source.map((grant) => {
    const table = String(grant.table || '');
    if (!IDENTIFIER_RE.test(table)) throw typedError('grant_table_invalid', 'Grant table is unsafe', { table });
    const privileges = (grant.privileges || ['SELECT', 'INSERT', 'UPDATE']).map((item) => String(item).toUpperCase());
    if (!privileges.length || privileges.some((item) => !SAFE_PRIVILEGES.has(item))) {
      throw typedError('grant_privilege_invalid', 'Only SELECT, INSERT, UPDATE are allowed by fallback recovery', { table, privileges });
    }
    return { table, privileges: [...new Set(privileges)] };
  });
}

async function applyGrants(connection, target) {
  if (!target.principal || !target.principal_host) throw typedError('grant_principal_incomplete', 'Fallback grants require explicit principal and principal_host');
  const missing = [];
  const applied = [];
  for (const grant of normalizeGrants(target)) {
    if (!(await tableExists(connection, target.database, grant.table))) {
      missing.push(grant.table);
      continue;
    }
    const account = `${connection.escape(String(target.principal))}@${connection.escape(String(target.principal_host))}`;
    try {
      await connection.query(`GRANT ${grant.privileges.join(', ')} ON ${quoteIdentifier(target.database, 'database')}.${quoteIdentifier(grant.table, 'table')} TO ${account}`);
      applied.push(grant);
    } catch (error) {
      throw typedError('grant_authority_unavailable', 'Bootstrap credential could not grant required least privileges', { table: grant.table, mysql_code: error?.code || null });
    }
  }
  if (missing.length && target.require_grant_tables !== false) throw typedError('grant_tables_missing', 'Required grant tables remain missing after canonical bootstrap', { missing_tables: missing });
  return { applied, pending_missing_tables: missing };
}

async function fallbackDatabaseRecovery(env, target) {
  const mysql = loadMysql();
  const host = String(env.MYSQL_BOOTSTRAP_HOST || '').trim();
  const user = String(env.MYSQL_BOOTSTRAP_USER || '').trim();
  const password = String(env.MYSQL_BOOTSTRAP_PASSWORD || '');
  if (!host || !user || !password) throw typedError('bootstrap_credentials_missing', 'MYSQL_BOOTSTRAP_HOST/USER/PASSWORD are required');
  const connection = await mysql.createConnection({ host, port: Number(env.MYSQL_BOOTSTRAP_PORT || 3306), user, password, multipleStatements: true, connectTimeout: 15000 });
  try {
    if (!(await databaseExists(connection, target.database))) {
      const createAllowed = parseBoolean(env.RUNTIME_RECOVERY_ALLOW_CREATE_DATABASE, false) && target.allow_create_database === true;
      if (!createAllowed) throw typedError('database_missing', 'Database is missing and two-gate creation authorization is not present', { database: target.database });
      let sql = `CREATE DATABASE ${quoteIdentifier(target.database, 'database')}`;
      if (target.character_set) {
        if (!IDENTIFIER_RE.test(String(target.character_set))) throw typedError('charset_invalid', 'Configured character_set is unsafe');
        sql += ` CHARACTER SET ${target.character_set}`;
      }
      if (target.collation) {
        if (!IDENTIFIER_RE.test(String(target.collation))) throw typedError('collation_invalid', 'Configured collation is unsafe');
        sql += ` COLLATE ${target.collation}`;
      }
      await connection.query(sql);
    }
    await connection.query(`USE ${quoteIdentifier(target.database, 'database')}`);
    const baselineEntries = Array.isArray(target.baseline_bootstrap_migrations) ? target.baseline_bootstrap_migrations : [];
    const incidentEntries = Array.isArray(target.incident_recovery_migrations) ? target.incident_recovery_migrations : [];
    const beforeTableCount = await tableCount(connection, target.database);
    const migrations = [];
    if (baselineEntries.length) {
      if (beforeTableCount !== 0) throw typedError('baseline_database_not_empty', 'Baseline bootstrap is permitted only for a missing or empty database', { database: target.database, table_count: beforeTableCount });
      for (const entry of baselineEntries) migrations.push(await applyBaselineBootstrap(connection, target.database, entry));
    }
    for (const entry of incidentEntries) migrations.push(await applyMigration(connection, target.database, entry, env));
    const grants = await applyGrants(connection, target);
    return { target_key: target.key, database: target.database, baseline_table_count_before: beforeTableCount, migrations, grants };
  } finally {
    await connection.end();
  }
}

function primaryPlan(env, sha) {
  return {
    strategy: 'primary',
    mutation_performed: false,
    expected_sha: sha,
    source_branch: env.PRODUCTION_SOURCE_BRANCH || 'Production',
    deployment_model: 'hostinger_auto_deploy_observed_not_triggered',
    provider_deploy_credential_required: false,
    canonical_routes: ROUTE_CONTRACT.routes,
    configured_probe_variable: 'RUNTIME_RECOVERY_PROBES_JSON',
    configured_mutation_variable: 'PRIMARY_GOVERNED_STEPS_JSON',
    configured_final_probe_variable: 'RUNTIME_RECOVERY_FINAL_PROBES_JSON',
    confirmation: requiredConfirmation('primary', sha),
  };
}

function fallbackPlan(env, sha, target) {
  return {
    strategy: 'fallback',
    mutation_performed: false,
    expected_sha: sha,
    source_branch: env.PRODUCTION_SOURCE_BRANCH || 'Production',
    deployment_model: 'hostinger_auto_deploy_must_already_match_exact_sha',
    database_registry_required_for_orchestration: false,
    target_key: target.key,
    database: target.database,
    create_database_requested: target.allow_create_database === true,
    create_database_globally_allowed: parseBoolean(env.RUNTIME_RECOVERY_ALLOW_CREATE_DATABASE, false),
    baseline_bootstrap_migrations: (target.baseline_bootstrap_migrations || []).map((entry) => typeof entry === 'string' ? entry : entry.file),
    incident_recovery_migrations: (target.incident_recovery_migrations || []).map((entry) => typeof entry === 'string' ? entry : entry.file),
    grants: normalizeGrants(target),
    confirmation: requiredConfirmation('fallback', sha),
  };
}

async function run(env = process.env) {
  const strategy = String(env.RECOVERY_STRATEGY || 'verify').trim().toLowerCase();
  if (!['verify', 'snapshot', 'primary', 'fallback'].includes(strategy)) throw typedError('strategy_invalid', 'RECOVERY_STRATEGY must be verify, snapshot, primary, or fallback');
  const sha = validateSha(env.EXPECTED_SHA || gitHead());
  const applyExecution = parseBoolean(env.APPLY_EXECUTION, false);
  if (strategy === 'snapshot' && applyExecution) throw typedError('snapshot_mutation_forbidden', 'Snapshot strategy is always read-only');
  validateApplyGate({ strategy, sha, applyExecution, confirmation: env.RECOVERY_CONFIRMATION });
  validateRecoveryPlan(env, ROUTE_CONTRACT);

  if (strategy === 'snapshot') {
    const sourceMode = resolveRuntimeRecoverySourceMode(env);
    if (sourceMode === 'sql') throw typedError('snapshot_sql_source_forbidden', 'Snapshot strategy requires github_snapshot or repository_snapshot');
    const snapshot = loadRuntimeRecoverySnapshot(env);
    return {
      ok: true,
      strategy,
      mutation_performed: false,
      database_connection_performed: false,
      database_mutation_performed: false,
      provider_mutation_performed: false,
      database_required: false,
      persistence: 'unavailable',
      runtime_authority: false,
      expected_sha: sha,
      source_mode: sourceMode,
      snapshot,
    };
  }
  if (strategy === 'primary' && !applyExecution) return primaryPlan(env, sha);
  if (strategy === 'fallback' && !applyExecution) return fallbackPlan(env, sha, selectTarget(env));

  const source = await assertExactGitHubHead(env, sha);
  const parity = await waitForAutoDeployParity(env, sha);
  const topology = await probeRouteTopology(env);

  if (strategy === 'verify') {
    const probes = await runConfiguredSteps(env, sha, 'RUNTIME_RECOVERY_PROBES_JSON', { allowMutation: false });
    return { ok: true, strategy, mutation_performed: false, expected_sha: sha, source, parity, topology, probes };
  }

  if (strategy === 'primary') {
    const preMutationProbes = await runConfiguredSteps(env, sha, 'RUNTIME_RECOVERY_PROBES_JSON', { allowMutation: false });
    const governedSteps = await runConfiguredSteps(env, sha, 'PRIMARY_GOVERNED_STEPS_JSON', { allowMutation: true });
    const finalParity = await waitForAutoDeployParity(env, sha);
    const finalProbes = await runConfiguredSteps(env, sha, 'RUNTIME_RECOVERY_FINAL_PROBES_JSON', { allowMutation: false });
    return {
      ok: true,
      strategy,
      mutation_performed: true,
      expected_sha: sha,
      deployment_triggered_by_workflow: false,
      source,
      parity_before_mutation: parity,
      topology,
      pre_mutation_probes: preMutationProbes,
      governed_steps: governedSteps,
      parity_after_mutation: finalParity,
      final_probes: finalProbes,
    };
  }

  const target = selectTarget(env);
  const database = await fallbackDatabaseRecovery(env, target);
  const finalParity = await waitForAutoDeployParity(env, sha);
  const finalProbes = await runConfiguredSteps(env, sha, 'RUNTIME_RECOVERY_FINAL_PROBES_JSON', { allowMutation: false });
  return {
    ok: true,
    strategy,
    mutation_performed: true,
    expected_sha: sha,
    deployment_triggered_by_workflow: false,
    source,
    parity_before_database_bootstrap: parity,
    topology,
    database,
    parity_after_database_bootstrap: finalParity,
    final_probes: finalProbes,
  };
}

async function main() {
  let result;
  let exitCode = 0;
  try { result = await run(process.env); }
  catch (error) { exitCode = 1; result = { ok: false, error: cleanError(error), mutation_performed: false, deployment_triggered_by_workflow: false }; }
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (process.env.RUNTIME_RECOVERY_RESULT_PATH) fs.writeFileSync(process.env.RUNTIME_RECOVERY_RESULT_PATH, text, 'utf8');
  process.stdout.write(text);
  process.exitCode = exitCode;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) await main();

export { run };
