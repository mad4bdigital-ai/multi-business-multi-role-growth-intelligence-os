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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS_ROOT = path.join(REPO_ROOT, 'http-generic-api', 'migrations');
const ROUTE_CONTRACT_PATH = path.join(REPO_ROOT, '.github', 'ops', 'production-runtime-recovery-routes.json');
const SHA_RE = /^[0-9a-f]{40}$/;
const IDENTIFIER_RE = /^[A-Za-z0-9_$.-]+$/;
const ACCOUNT_HOST_RE = /^[A-Za-z0-9_$%.:-]+$/;
const SAFE_PRIVILEGES = new Set(['SELECT', 'INSERT', 'UPDATE']);
const DEFAULT_GRANT_TABLES = [
  'customer_sessions',
  'gpt_session_turns',
  'actions',
  'dynamic_audit_scheduler_runs',
  'execution_log',
  'json_assets',
];

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

export function resolveMigrationPath(file) {
  const raw = String(file || '').trim().replace(/\\/g, '/');
  if (!raw) throw typedError('migration_file_missing', 'Migration file is required');
  const rel = raw.startsWith('http-generic-api/migrations/')
    ? raw.slice('http-generic-api/migrations/'.length)
    : raw;
  if (rel.includes('..') || rel.startsWith('/') || !/^[A-Za-z0-9_.\/-]+\.sql$/.test(rel)) {
    throw typedError('unsafe_migration_path', 'Migration path must remain inside http-generic-api/migrations', { file: raw });
  }
  const absolute = path.resolve(MIGRATIONS_ROOT, rel);
  if (!absolute.startsWith(`${MIGRATIONS_ROOT}${path.sep}`)) {
    throw typedError('unsafe_migration_path', 'Migration path escaped the migrations root', { file: raw });
  }
  return { absolute, repoPath: `http-generic-api/migrations/${rel}` };
}

export function requiredConfirmation(strategy, sha) {
  return `RECOVER:${strategy}:${sha}`;
}

export function validateApplyGate({ strategy, sha, applyExecution, confirmation }) {
  if (!applyExecution) return;
  const expected = requiredConfirmation(strategy, sha);
  if (String(confirmation || '') !== expected) {
    throw typedError('confirmation_mismatch', 'Mutation gate confirmation does not match the exact strategy and SHA', {
      expected_confirmation: expected,
    });
  }
}

export function validateTargetPlan(target) {
  if (!target || typeof target !== 'object') throw typedError('target_invalid', 'Recovery target must be an object');
  for (const field of ['key', 'database']) {
    if (!target[field] || !IDENTIFIER_RE.test(String(target[field]))) {
      throw typedError('target_invalid', `Target ${field} is missing or unsafe`, { field });
    }
  }
  if (target.principal && !IDENTIFIER_RE.test(String(target.principal))) {
    throw typedError('target_invalid', 'Target principal contains unsafe characters');
  }
  if (target.principal_host && !ACCOUNT_HOST_RE.test(String(target.principal_host))) {
    throw typedError('target_invalid', 'Target principal_host contains unsafe characters');
  }
  const migrations = Array.isArray(target.migrations) ? target.migrations : [];
  migrations.forEach((entry) => resolveMigrationPath(typeof entry === 'string' ? entry : entry?.file));
  return target;
}

function typedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
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

function buildContext(sha, env = process.env) {
  return {
    repository: env.GITHUB_REPOSITORY || '',
    branch: env.PRODUCTION_SOURCE_BRANCH || 'main',
    sha,
    target_id: env.HOSTINGER_DEPLOYMENT_TARGET_ID || '',
    run_id: env.GITHUB_RUN_ID || '',
    run_attempt: env.GITHUB_RUN_ATTEMPT || '',
  };
}

async function githubHeadSha(env, branch) {
  const repository = env.GITHUB_REPOSITORY;
  if (!repository) throw typedError('github_repository_missing', 'GITHUB_REPOSITORY is required');
  const token = env.GITHUB_TOKEN;
  if (!token) throw typedError('github_token_missing', 'GITHUB_TOKEN is required for exact-head verification');
  const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const response = await fetch(`${api}/repos/${repository}/branches/${encodeURIComponent(branch)}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw typedError('github_head_read_failed', 'Could not read the source branch head from GitHub', {
      branch,
      status: response.status,
    });
  }
  const body = await response.json();
  return validateSha(body?.commit?.sha, 'github_branch_head');
}

async function assertExactGitHubHead(env, sha) {
  const branch = env.PRODUCTION_SOURCE_BRANCH || 'main';
  const remote = await githubHeadSha(env, branch);
  if (remote !== sha) {
    throw typedError('source_head_moved', 'Expected SHA is no longer the exact configured source branch head', {
      branch,
      expected_sha: sha,
      observed_sha: remote,
    });
  }
  return { branch, sha: remote };
}

function validateHttps(urlString, env, label) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw typedError('invalid_url', `${label} is not a valid URL`, { label });
  }
  if (parsed.protocol !== 'https:' && !parseBoolean(env.RUNTIME_RECOVERY_ALLOW_INSECURE_HTTP, false)) {
    throw typedError('insecure_url_blocked', `${label} must use HTTPS`, { label });
  }
  return parsed.toString();
}

export function loadRecoveryRouteContract() {
  if (!fs.existsSync(ROUTE_CONTRACT_PATH)) {
    throw typedError('route_contract_missing', 'Production recovery route contract is missing from the checked-out source.');
  }
  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(ROUTE_CONTRACT_PATH, 'utf8'));
  } catch (error) {
    throw typedError('route_contract_invalid', 'Production recovery route contract is not valid JSON.', { cause: error.message });
  }
  if (!contract || typeof contract !== 'object' || !contract.routes || typeof contract.routes !== 'object') {
    throw typedError('route_contract_invalid', 'Production recovery route contract must expose a routes object.');
  }
  return contract;
}

export function resolveRecoveryRoute(step, contract = loadRecoveryRouteContract()) {
  if (!step || typeof step !== 'object') throw typedError('route_step_invalid', 'Recovery route step must be an object.');
  const requestedKey = String(step.route_key || '').trim();
  const requestedMethod = String(step.method || '').trim().toUpperCase();
  const requestedPath = String(step.path || '').trim();
  let routeKey = requestedKey;
  let route = routeKey ? contract.routes[routeKey] : null;
  if (!route && !routeKey && requestedPath) {
    const match = Object.entries(contract.routes).find(([, candidate]) =>
      String(candidate?.path || '') === requestedPath
      && (!requestedMethod || String(candidate?.method || '').toUpperCase() === requestedMethod),
    );
    if (match) [routeKey, route] = match;
  }
  if (!route || typeof route !== 'object') {
    throw typedError('route_not_allowlisted', 'Recovery step must select a route_key from the canonical route contract.', {
      route_key: requestedKey || null,
      method: requestedMethod || null,
      path: requestedPath || null,
    });
  }
  const method = String(route.method || '').toUpperCase();
  const pathValue = String(route.path || '');
  if (!['GET', 'HEAD', 'POST'].includes(method) || !pathValue.startsWith('/')) {
    throw typedError('route_contract_invalid', 'Canonical recovery route has an unsafe method or path.', { route_key: routeKey });
  }
  if (requestedMethod && requestedMethod !== method) {
    throw typedError('route_method_mismatch', 'Configured method does not match the canonical route contract.', { route_key: routeKey, expected_method: method, observed_method: requestedMethod });
  }
  if (requestedPath && requestedPath !== pathValue) {
    throw typedError('route_path_mismatch', 'Configured path does not match the canonical route contract.', { route_key: routeKey, expected_path: pathValue, observed_path: requestedPath });
  }
  return { ...step, route_key: routeKey, method, path: pathValue };
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
  if (text) {
    try { json = JSON.parse(text); } catch { /* text response is allowed */ }
  }
  return { status: response.status, ok: response.ok, text, json };
}

function responseContainsSha(response, sha) {
  if (response.text?.toLowerCase().includes(sha)) return true;
  return false;
}

async function deployRelease(env, sha) {
  const rawUrl = String(env.PRODUCTION_DEPLOY_URL || '').trim();
  if (!rawUrl) throw typedError('provider_deploy_url_missing', 'PRODUCTION_DEPLOY_URL is required for direct provider rollout');
  const context = buildContext(sha, env);
  const url = validateHttps(renderTemplate(rawUrl, context), env, 'PRODUCTION_DEPLOY_URL');
  const method = String(env.PRODUCTION_DEPLOY_METHOD || 'POST').trim().toUpperCase();
  const headers = { Accept: 'application/json' };
  const authValue = String(env.PRODUCTION_DEPLOY_AUTH_VALUE || '');
  if (authValue) headers[String(env.PRODUCTION_DEPLOY_AUTH_HEADER || 'Authorization')] = authValue;
  const rawBody = String(env.PRODUCTION_DEPLOY_BODY_JSON || '').trim();
  let body;
  if (rawBody) {
    const rendered = renderTemplate(parseJson(rawBody, {}, 'PRODUCTION_DEPLOY_BODY_JSON'), context);
    body = JSON.stringify(rendered);
    headers['Content-Type'] = 'application/json';
  }
  const response = await requestJsonish(url, { method, headers, body, timeoutMs: 60000 });
  if (!response.ok) {
    throw typedError('provider_deploy_failed', 'Direct provider deployment request failed', { status: response.status });
  }
  return { status: response.status, requested_sha: sha, provider_target_id_present: Boolean(context.target_id) };
}

function joinRuntimeUrl(baseUrl, route, env, label) {
  const base = validateHttps(baseUrl, env, 'PRODUCTION_BASE_URL').replace(/\/$/, '');
  const pathPart = String(route || '').startsWith('/') ? route : `/${route}`;
  return validateHttps(`${base}${pathPart}`, env, label);
}

async function verifyRuntimeParity(env, sha) {
  const baseUrl = String(env.PRODUCTION_BASE_URL || '').trim();
  if (!baseUrl) throw typedError('production_base_url_missing', 'PRODUCTION_BASE_URL is required');
  const versionPath = env.PRODUCTION_VERSION_PATH || '/version';
  const deploymentInfoPath = env.PRODUCTION_DEPLOYMENT_INFO_PATH || '/deployment-info';
  const attempts = Math.max(1, Number(env.PRODUCTION_VERIFY_ATTEMPTS || 24));
  const intervalMs = Math.max(1000, Number(env.PRODUCTION_VERIFY_INTERVAL_SECONDS || 10) * 1000);
  const headers = { Accept: 'application/json,text/plain;q=0.9' };
  const authValue = String(env.PRODUCTION_PROBE_AUTH_VALUE || '');
  if (authValue) headers[String(env.PRODUCTION_PROBE_AUTH_HEADER || 'Authorization')] = authValue;
  const versionUrl = joinRuntimeUrl(baseUrl, versionPath, env, 'PRODUCTION_VERSION_PATH');
  const deploymentUrl = joinRuntimeUrl(baseUrl, deploymentInfoPath, env, 'PRODUCTION_DEPLOYMENT_INFO_PATH');
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const [version, deployment] = await Promise.all([
      requestJsonish(versionUrl, { headers, timeoutMs: 15000 }),
      requestJsonish(deploymentUrl, { headers, timeoutMs: 15000 }),
    ]);
    last = {
      attempt,
      version_status: version.status,
      deployment_info_status: deployment.status,
      version_matches: version.ok && responseContainsSha(version, sha),
      deployment_info_matches: deployment.ok && responseContainsSha(deployment, sha),
    };
    if (last.version_matches && last.deployment_info_matches) return { ok: true, expected_sha: sha, ...last };
    if (attempt < attempts) await sleep(intervalMs);
  }
  throw typedError('runtime_sha_parity_failed', 'Production did not prove the exact expected SHA on both version surfaces', {
    expected_sha: sha,
    last,
  });
}

async function runHttpSteps(env, sha, variableName, { allowMutation = false } = {}) {
  const steps = parseJson(env[variableName], [], variableName);
  const routeContract = loadRecoveryRouteContract();
  if (!Array.isArray(steps)) throw typedError('steps_invalid', `${variableName} must be a JSON array`);
  if (!steps.length) return [];
  const baseUrl = String(env.PRODUCTION_BASE_URL || '').trim();
  const context = buildContext(sha, env);
  const authValue = String(env.PRODUCTION_PROBE_AUTH_VALUE || '');
  const authHeader = String(env.PRODUCTION_PROBE_AUTH_HEADER || 'Authorization');
  const results = [];
  for (const rawStep of steps) {
    const step = resolveRecoveryRoute(renderTemplate(rawStep, context), routeContract);
    if (step?.mutation === true && !allowMutation) {
      throw typedError('mutation_step_blocked', `Mutation step ${step?.name || '<unnamed>'} is not allowed in this phase`);
    }
    const url = joinRuntimeUrl(baseUrl, step.path, env, `${variableName}.path`);
    const headers = { Accept: 'application/json', ...(renderTemplate(step.headers || {}, context)) };
    if (authValue) headers[authHeader] = authValue;
    let body;
    if (Object.prototype.hasOwnProperty.call(step, 'body')) {
      body = JSON.stringify(renderTemplate(step.body, context));
      headers['Content-Type'] = 'application/json';
    }
    const response = await requestJsonish(url, {
      method: String(step.method || 'GET').toUpperCase(),
      headers,
      body,
      timeoutMs: Number(step.timeout_ms || 30000),
    });
    const expectedStatus = Number(step.expected_status || 200);
    if (response.status !== expectedStatus) {
      throw typedError('http_step_status_mismatch', `HTTP step ${step.name || step.path} returned an unexpected status`, {
        step: step.name || step.path,
        expected_status: expectedStatus,
        observed_status: response.status,
      });
    }
    if (step.expected_json && !isSubset(renderTemplate(step.expected_json, context), response.json)) {
      throw typedError('http_step_contract_mismatch', `HTTP step ${step.name || step.path} did not match expected_json`, {
        step: step.name || step.path,
      });
    }
    results.push({ name: step.name || step.path, route_key: step.route_key, status: response.status, contract_match: true });
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
  if (!key) throw typedError('target_key_missing', 'RECOVERY_TARGET_KEY is required for fallback recovery');
  const target = getTargets(env).find((item) => String(item.key) === key);
  if (!target) throw typedError('target_not_found', 'RECOVERY_TARGET_KEY was not found in RUNTIME_RECOVERY_TARGETS_JSON', { key });
  return target;
}

function loadMysql() {
  const requireFromRuntime = createRequire(path.join(REPO_ROOT, 'http-generic-api', 'package.json'));
  return requireFromRuntime('mysql2/promise');
}

function quoteIdentifier(value, label) {
  const stringValue = String(value || '');
  if (!IDENTIFIER_RE.test(stringValue)) throw typedError('unsafe_identifier', `${label} is unsafe`, { label });
  return `\`${stringValue.replaceAll('`', '``')}\``;
}

async function databaseExists(connection, database) {
  const [rows] = await connection.execute(
    'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1',
    [database],
  );
  return rows.length > 0;
}

async function tableExists(connection, database, table) {
  const [rows] = await connection.execute(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1',
    [database, table],
  );
  return rows.length > 0;
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
  if (!ledger?.migration_id) return { available: false, row: null };
  if (!(await tableExists(connection, database, 'schema_migrations'))) return { available: false, row: null };
  const required = ['migration_id', 'filename', 'checksum_sha256', 'status', 'error_message', 'applied_at', 'applied_by', 'execution_id'];
  if (!(await columnsExist(connection, database, 'schema_migrations', required))) {
    throw typedError('ledger_contract_incomplete', 'schema_migrations exists but does not expose the governed ledger contract');
  }
  const [rows] = await connection.execute(
    'SELECT migration_id, filename, checksum_sha256, status, error_message, applied_at, applied_by, execution_id FROM schema_migrations WHERE migration_id = ? LIMIT 1',
    [String(ledger.migration_id)],
  );
  return { available: true, row: rows[0] || null };
}

async function writeLedger(connection, entry, checksum, env) {
  const ledger = entry?.ledger;
  if (!ledger?.migration_id) return { recorded: false };
  const state = await readLedger(connection, String(entry.__database), ledger);
  if (!state.available) {
    if (ledger.required !== false) {
      throw typedError('ledger_missing', 'Migration completed but governed ledger is absent; bootstrap its canonical schema first', {
        migration_id: ledger.migration_id,
      });
    }
    return { recorded: false, reason: 'ledger_missing' };
  }
  const filename = String(ledger.filename || path.basename(entry.__repoPath));
  const executionId = `github:${env.GITHUB_RUN_ID || 'manual'}:${env.GITHUB_RUN_ATTEMPT || '1'}`;
  await connection.execute(
    `INSERT INTO schema_migrations (migration_id, filename, checksum_sha256, status, error_message, applied_at, applied_by, execution_id)
     VALUES (?, ?, ?, 'applied', NULL, CURRENT_TIMESTAMP, ?, ?)
     ON DUPLICATE KEY UPDATE filename = VALUES(filename), checksum_sha256 = VALUES(checksum_sha256), status = 'applied', error_message = NULL, applied_at = VALUES(applied_at), applied_by = VALUES(applied_by), execution_id = VALUES(execution_id)`,
    [String(ledger.migration_id), filename, checksum, 'github-actions', executionId],
  );
  return { recorded: true, migration_id: String(ledger.migration_id) };
}

async function applyMigration(connection, database, rawEntry, env) {
  const entry = typeof rawEntry === 'string' ? { file: rawEntry } : { ...rawEntry };
  const { absolute, repoPath } = resolveMigrationPath(entry.file);
  if (!fs.existsSync(absolute)) throw typedError('migration_file_not_found', 'Configured migration file does not exist', { file: repoPath });
  const checksum = hashFile(absolute);
  if (entry.expected_checksum && String(entry.expected_checksum).toLowerCase() !== checksum) {
    throw typedError('migration_checksum_mismatch', 'Configured migration checksum does not match repository content', {
      file: repoPath,
      expected_checksum: String(entry.expected_checksum).toLowerCase(),
      observed_checksum: checksum,
    });
  }
  const requires = Array.isArray(entry.requires_tables) ? entry.requires_tables.map(String) : [];
  for (const table of requires) {
    if (!IDENTIFIER_RE.test(table) || !(await tableExists(connection, database, table))) {
      throw typedError('migration_dependency_missing', 'Migration dependency table is missing', { file: repoPath, table });
    }
  }
  const readyBefore = await doneWhenReady(connection, database, entry.done_when);
  const ledgerState = await readLedger(connection, database, entry.ledger);
  if (ledgerState.row) {
    const ledgerChecksum = String(ledgerState.row.checksum_sha256 || '').toLowerCase();
    if (ledgerChecksum && ledgerChecksum !== checksum) {
      throw typedError('ledger_checksum_mismatch', 'Ledger checksum differs from repository migration', {
        migration_id: entry.ledger.migration_id,
        ledger_checksum: ledgerChecksum,
        repository_checksum: checksum,
      });
    }
    if (String(ledgerState.row.status || '').toLowerCase() === 'applied') {
      if (readyBefore === false) {
        throw typedError('ledger_schema_divergence', 'Ledger says applied but required schema readback is not ready', {
          migration_id: entry.ledger.migration_id,
          file: repoPath,
        });
      }
      return { file: repoPath, checksum_sha256: checksum, status: 'already_applied', ledger_found: true };
    }
  }
  if (readyBefore === true) {
    const decorated = { ...entry, __database: database, __repoPath: repoPath };
    const ledger = entry.ledger?.record_if_schema_ready ? await writeLedger(connection, decorated, checksum, env) : { recorded: false };
    return { file: repoPath, checksum_sha256: checksum, status: 'schema_already_ready', ledger };
  }
  const sql = fs.readFileSync(absolute, 'utf8');
  await connection.query(sql);
  const readyAfter = await doneWhenReady(connection, database, entry.done_when);
  if (readyAfter === false) {
    throw typedError('migration_postcondition_failed', 'Migration SQL completed but declared schema postcondition is not ready', { file: repoPath });
  }
  const decorated = { ...entry, __database: database, __repoPath: repoPath };
  const ledger = await writeLedger(connection, decorated, checksum, env);
  return { file: repoPath, checksum_sha256: checksum, status: 'applied', ledger };
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
      throw typedError('grant_privilege_invalid', 'Only SELECT, INSERT and UPDATE are allowed by this recovery operator', { table, privileges });
    }
    return { table, privileges: [...new Set(privileges)] };
  });
}

async function applyGrants(connection, target) {
  if (!target.principal || !target.principal_host) {
    throw typedError('grant_principal_incomplete', 'Fallback grants require principal and principal_host in the selected GitHub target plan');
  }
  const grants = normalizeGrants(target);
  const missing = [];
  const applied = [];
  for (const grant of grants) {
    if (!(await tableExists(connection, target.database, grant.table))) {
      missing.push(grant.table);
      continue;
    }
    const account = `${connection.escape(String(target.principal))}@${connection.escape(String(target.principal_host))}`;
    const sql = `GRANT ${grant.privileges.join(', ')} ON ${quoteIdentifier(target.database, 'database')}.${quoteIdentifier(grant.table, 'table')} TO ${account}`;
    try {
      await connection.query(sql);
      applied.push({ table: grant.table, privileges: grant.privileges });
    } catch (error) {
      throw typedError('grant_authority_unavailable', 'Bootstrap credential could not grant the required least privileges', {
        table: grant.table,
        mysql_code: error?.code || null,
      });
    }
  }
  if (missing.length && target.require_grant_tables !== false) {
    throw typedError('grant_tables_missing', 'Required grant tables are still missing after bootstrap migrations', { missing_tables: missing });
  }
  return { applied, pending_missing_tables: missing };
}

async function fallbackDatabaseRecovery(env, target) {
  const mysql = loadMysql();
  const host = String(env.MYSQL_BOOTSTRAP_HOST || '').trim();
  const user = String(env.MYSQL_BOOTSTRAP_USER || '').trim();
  const password = String(env.MYSQL_BOOTSTRAP_PASSWORD || '');
  if (!host || !user || !password) {
    throw typedError('bootstrap_credentials_missing', 'MYSQL_BOOTSTRAP_HOST/USER/PASSWORD are required for fallback recovery');
  }
  const connection = await mysql.createConnection({
    host,
    port: Number(env.MYSQL_BOOTSTRAP_PORT || 3306),
    user,
    password,
    multipleStatements: true,
    connectTimeout: 15000,
  });
  try {
    const exists = await databaseExists(connection, target.database);
    if (!exists) {
      const allowed = parseBoolean(env.RUNTIME_RECOVERY_ALLOW_CREATE_DATABASE, false) && target.allow_create_database === true;
      if (!allowed) {
        throw typedError('database_missing', 'Target database does not exist and database creation is not explicitly authorized', {
          database: target.database,
        });
      }
      let sql = `CREATE DATABASE ${quoteIdentifier(target.database, 'database')}`;
      if (target.character_set) {
        if (!IDENTIFIER_RE.test(String(target.character_set))) throw typedError('charset_invalid', 'character_set is unsafe');
        sql += ` CHARACTER SET ${target.character_set}`;
      }
      if (target.collation) {
        if (!IDENTIFIER_RE.test(String(target.collation))) throw typedError('collation_invalid', 'collation is unsafe');
        sql += ` COLLATE ${target.collation}`;
      }
      await connection.query(sql);
    }
    await connection.query(`USE ${quoteIdentifier(target.database, 'database')}`);
    const migrationResults = [];
    for (const entry of target.migrations || []) {
      migrationResults.push(await applyMigration(connection, target.database, entry, env));
    }
    const grants = await applyGrants(connection, target);
    return { target_key: target.key, database: target.database, migrations: migrationResults, grants };
  } finally {
    await connection.end();
  }
}

function primaryPlan(env, sha) {
  return {
    strategy: 'primary',
    mutation_performed: false,
    expected_sha: sha,
    source_branch: env.PRODUCTION_SOURCE_BRANCH || 'main',
    control_plane: 'github_to_provider_direct',
    database_registry_required_for_rollout: false,
    required_variables: [
      'PRODUCTION_BASE_URL',
      'PRODUCTION_DEPLOY_URL',
      'PRODUCTION_DEPLOY_METHOD',
      'PRODUCTION_DEPLOY_BODY_JSON',
      'PRODUCTION_VERSION_PATH',
      'PRODUCTION_DEPLOYMENT_INFO_PATH',
      'RUNTIME_RECOVERY_PROBES_JSON',
      'PRIMARY_GOVERNED_STEPS_JSON',
    ],
    required_secrets: ['PRODUCTION_DEPLOY_AUTH_VALUE', 'PRODUCTION_PROBE_AUTH_VALUE'],
    confirmation: requiredConfirmation('primary', sha),
  };
}

function snapshotPlan(env, sha) {
  const snapshot = loadRuntimeRecoverySnapshot(env);
  return {
    strategy: 'snapshot',
    mutation_performed: false,
    expected_sha: sha,
    source_branch: env.PRODUCTION_SOURCE_BRANCH || 'main',
    source_mode: snapshot.mode,
    database_registry_required_for_orchestration: false,
    database_required: false,
    runtime_authority: false,
    persistence: snapshot.persistence,
    catalog_tool_count: snapshot.catalog.tools.length,
    session_context_read_only: snapshot.sessionContext.read_only === true,
    session_id: snapshot.sessionContext.session_id,
    provider_mutation_performed: false,
    database_mutation_performed: false,
    required_variables: snapshot.mode === 'github_snapshot'
      ? ['RUNTIME_RECOVERY_SOURCE_MODE', 'RUNTIME_RECOVERY_CATALOG_JSON', 'RUNTIME_RECOVERY_SESSION_CONTEXT_JSON']
      : ['RUNTIME_RECOVERY_SOURCE_MODE', 'RUNTIME_RECOVERY_SNAPSHOT_PATH'],
  };
}

function fallbackPlan(env, sha, target) {
  return {
    strategy: 'fallback',
    mutation_performed: false,
    expected_sha: sha,
    source_branch: env.PRODUCTION_SOURCE_BRANCH || 'main',
    target_key: target.key,
    database: target.database,
    database_registry_required_for_orchestration: false,
    create_database_requested: target.allow_create_database === true,
    create_database_globally_allowed: parseBoolean(env.RUNTIME_RECOVERY_ALLOW_CREATE_DATABASE, false),
    migrations: (target.migrations || []).map((entry) => typeof entry === 'string' ? entry : entry.file),
    grants: normalizeGrants(target),
    confirmation: requiredConfirmation('fallback', sha),
  };
}

async function run(env = process.env) {
  const strategy = String(env.RECOVERY_STRATEGY || 'verify').trim().toLowerCase();
  if (!['primary', 'fallback', 'snapshot', 'verify'].includes(strategy)) {
    throw typedError('strategy_invalid', 'RECOVERY_STRATEGY must be primary, fallback, snapshot, or verify');
  }
  const sha = validateSha(env.EXPECTED_SHA || gitHead());
  const applyExecution = parseBoolean(env.APPLY_EXECUTION, false);
  if (strategy === 'snapshot' && applyExecution) {
    throw typedError('snapshot_mutation_forbidden', 'Snapshot strategy is repository/GitHub-variable-only and cannot execute mutations.');
  }
  validateApplyGate({ strategy, sha, applyExecution, confirmation: env.RECOVERY_CONFIRMATION });
  if (strategy === 'snapshot' && resolveRuntimeRecoverySourceMode(env) === 'sql') {
    throw typedError('snapshot_source_required', 'Snapshot strategy requires github_snapshot or repository_snapshot source mode.');
  }

  if (strategy === 'snapshot') return snapshotPlan(env, sha);
  if (strategy === 'primary' && !applyExecution) return primaryPlan(env, sha);
  if (strategy === 'fallback' && !applyExecution) return fallbackPlan(env, sha, selectTarget(env));

  const source = await assertExactGitHubHead(env, sha);
  if (strategy === 'verify') {
    const parity = await verifyRuntimeParity(env, sha);
    const probes = await runHttpSteps(env, sha, 'RUNTIME_RECOVERY_PROBES_JSON', { allowMutation: false });
    return { ok: true, strategy, mutation_performed: false, expected_sha: sha, source, parity, probes };
  }

  const deployment = await deployRelease(env, sha);
  const parity = await verifyRuntimeParity(env, sha);

  if (strategy === 'primary') {
    const preMutationProbes = await runHttpSteps(env, sha, 'RUNTIME_RECOVERY_PROBES_JSON', { allowMutation: false });
    const governedSteps = await runHttpSteps(env, sha, 'PRIMARY_GOVERNED_STEPS_JSON', { allowMutation: true });
    const finalProbes = await runHttpSteps(env, sha, 'RUNTIME_RECOVERY_FINAL_PROBES_JSON', { allowMutation: false });
    return {
      ok: true,
      strategy,
      mutation_performed: true,
      expected_sha: sha,
      source,
      deployment,
      parity,
      pre_mutation_probes: preMutationProbes,
      governed_steps: governedSteps,
      final_probes: finalProbes,
    };
  }

  const target = selectTarget(env);
  if (resolveRuntimeRecoverySourceMode(env) !== 'sql') {
    throw typedError('snapshot_mutation_forbidden', 'A non-SQL runtime recovery source cannot enter database fallback execution.');
  }
  const database = await fallbackDatabaseRecovery(env, target);
  const finalParity = await verifyRuntimeParity(env, sha);
  const finalProbes = await runHttpSteps(env, sha, 'RUNTIME_RECOVERY_FINAL_PROBES_JSON', { allowMutation: false });
  return {
    ok: true,
    strategy,
    mutation_performed: true,
    expected_sha: sha,
    source,
    deployment,
    parity_before_database_bootstrap: parity,
    database,
    parity_after_database_bootstrap: finalParity,
    final_probes: finalProbes,
  };
}

async function main() {
  let result;
  let exitCode = 0;
  try {
    result = await run(process.env);
  } catch (error) {
    exitCode = 1;
    result = { ok: false, error: cleanError(error), mutation_performed: false };
  }
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (process.env.RUNTIME_RECOVERY_RESULT_PATH) fs.writeFileSync(process.env.RUNTIME_RECOVERY_RESULT_PATH, text, 'utf8');
  process.stdout.write(text);
  process.exitCode = exitCode;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) await main();

export { run };
