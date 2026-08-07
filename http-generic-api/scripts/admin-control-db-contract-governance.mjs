import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '../..');
const DEFAULT_MANIFEST = '.github/contracts/admin-control-db.v1.json';
const BUILDER_IMPORT_TOKEN = 'admin-control-db-request.mjs';

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, manifest: DEFAULT_MANIFEST, ci: false, selfTest: false };
  for (const arg of argv) {
    if (arg === '--ci') options.ci = true;
    else if (arg === '--self-test') options.selfTest = true;
    else if (arg.startsWith('--root=')) options.root = path.resolve(arg.slice('--root='.length));
    else if (arg.startsWith('--manifest=')) options.manifest = arg.slice('--manifest='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function listCodeFiles(rootDir) {
  const output = [];
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) output.push(absolute);
    }
  }
  await visit(rootDir);
  return output.sort();
}

function normalizeRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function quoted(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function objectFieldPattern(field) {
  return new RegExp(`(?:^|[{,])\\s*${quoted(field)}\\s*(?::|(?=[,}]))`);
}

function providerEntrypointIndex(source) {
  const declaration = /\b(?:export\s+)?(?:async\s+)?function\s+executeDbControl\s*\(|\b(?:const|let|var)\s+executeDbControl\s*=/.exec(source);
  return declaration?.index ?? -1;
}

export function scanRawDbCallerSource(source, contract, file = '<fixture>') {
  const findings = [];
  const marker = new RegExp(`tool\\s*:\\s*['\"]${quoted(contract.tool)}['\"]`, 'g');
  const positions = [...source.matchAll(marker)].map((match) => match.index ?? 0);
  for (let index = 0; index < positions.length; index += 1) {
    const start = positions[index];
    const next = positions[index + 1] ?? Math.min(source.length, start + 2200);
    const segment = source.slice(start, Math.min(next, start + 2200));
    const actionMatch = /(?:^|[{,])\s*action\s*:\s*['\"]([^'\"]+)['\"]/.exec(segment);
    if (!actionMatch) {
      findings.push({ code: 'admin_db_raw_caller_missing_action', file, offset: start });
      continue;
    }
    if (actionMatch[1] !== contract.request.action) {
      findings.push({
        code: 'admin_db_action_contract_mismatch',
        file,
        offset: start,
        actual: actionMatch[1],
        expected: contract.request.action,
      });
    }
    const sqlField = objectFieldPattern(contract.request.sql_field);
    if (!sqlField.test(segment)) {
      findings.push({
        code: 'admin_db_sql_field_contract_mismatch',
        file,
        offset: start,
        expected: contract.request.sql_field,
      });
    }
    for (const alias of contract.legacy_aliases?.sql_fields || []) {
      const aliasField = objectFieldPattern(alias);
      if (aliasField.test(segment)) {
        findings.push({ code: 'admin_db_legacy_sql_alias_forbidden', file, offset: start, alias });
      }
    }
  }
  return { raw_call_count: positions.length, findings };
}

function verifyProviderSource(source, contract) {
  const findings = [];
  const start = providerEntrypointIndex(source);
  if (start < 0) return [{ code: 'admin_db_provider_entrypoint_missing', file: contract.provider_path }];
  const provider = source.slice(start, start + 6000);
  const expectedAction = contract.request.action;
  const sqlField = contract.request.sql_field;

  const requiredPatterns = [
    [new RegExp(`body\\.action\\s*\\|\\|\\s*['\"]${quoted(expectedAction)}['\"]`), 'admin_db_provider_default_action_drift'],
    [new RegExp(`action\\s*!==\\s*['\"]${quoted(expectedAction)}['\"]`), 'admin_db_provider_action_guard_drift'],
    [new RegExp(`body\\.${quoted(sqlField)}\\b`), 'admin_db_provider_sql_field_drift'],
    [new RegExp(quoted(contract.provider_error_codes.unsupported_action)), 'admin_db_provider_action_error_drift'],
    [new RegExp(quoted(contract.provider_error_codes.missing_sql)), 'admin_db_provider_sql_error_drift'],
  ];
  for (const [pattern, code] of requiredPatterns) {
    if (!pattern.test(provider)) findings.push({ code, file: contract.provider_path });
  }

  if (contract.ratchet?.provider_compatibility_aliases_allowed === false) {
    for (const alias of contract.legacy_aliases?.sql_fields || []) {
      if (new RegExp(`body\\.${quoted(alias)}\\b`).test(provider)) {
        findings.push({ code: 'admin_db_provider_legacy_sql_alias_forbidden', file: contract.provider_path, alias });
      }
    }
    for (const alias of contract.legacy_aliases?.actions || []) {
      if (new RegExp(`action\\s*===?\\s*['\"]${quoted(alias)}['\"]`).test(provider)) {
        findings.push({ code: 'admin_db_provider_legacy_action_alias_forbidden', file: contract.provider_path, alias });
      }
    }
  }
  return findings;
}

function readBaseManifest(root, manifestRelative) {
  const candidates = [];
  const baseRef = String(process.env.GITHUB_BASE_REF || '').trim();
  if (baseRef) candidates.push(`origin/${baseRef}`);
  candidates.push('HEAD^');
  for (const ref of candidates) {
    try {
      const text = execFileSync('git', ['show', `${ref}:${manifestRelative}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return { ref, manifest: JSON.parse(text) };
    } catch {}
  }
  return null;
}

function verifyMonotonicRatchet(current, baseInfo) {
  const findings = [];
  if (!baseInfo?.manifest) return findings;
  const previous = new Set(baseInfo.manifest.legacy_raw_callers || []);
  for (const file of current.legacy_raw_callers || []) {
    if (!previous.has(file)) {
      findings.push({
        code: 'admin_db_legacy_raw_caller_allowlist_may_only_shrink',
        file,
        base_ref: baseInfo.ref,
      });
    }
  }
  if (current.ratchet?.new_raw_callers_allowed !== false) {
    findings.push({ code: 'admin_db_new_raw_callers_must_remain_forbidden' });
  }
  if (current.ratchet?.provider_compatibility_aliases_allowed !== false) {
    findings.push({ code: 'admin_db_provider_aliases_must_remain_forbidden' });
  }
  return findings;
}

async function verifyBuilder(root, contract) {
  const findings = [];
  const builderPath = path.join(root, contract.shared_builder_path);
  try {
    const moduleUrl = `${pathToFileURL(builderPath).href}?governance=${Date.now()}`;
    const builder = await import(moduleUrl);
    const request = builder.buildAdminControlDbReadRequest({
      sql: 'SELECT 1',
      params: [],
      maxRows: 1,
      authorityContext: { resource_type: 'database_query', resource_uri: 'db://governance/self-test', operation_mode: 'read_only', required: true },
    });
    if (request.tool !== contract.tool) findings.push({ code: 'admin_db_builder_tool_drift', file: contract.shared_builder_path });
    if (request.action !== contract.request.action) findings.push({ code: 'admin_db_builder_action_drift', file: contract.shared_builder_path });
    if (request[contract.request.sql_field] !== 'SELECT 1') findings.push({ code: 'admin_db_builder_sql_field_drift', file: contract.shared_builder_path });
    for (const alias of contract.legacy_aliases?.sql_fields || []) {
      if (Object.prototype.hasOwnProperty.call(request, alias)) {
        findings.push({ code: 'admin_db_builder_legacy_alias_forbidden', file: contract.shared_builder_path, alias });
      }
    }
  } catch (error) {
    findings.push({ code: 'admin_db_builder_unloadable', file: contract.shared_builder_path, detail: String(error?.message || error) });
  }
  return findings;
}

export async function runGovernance({ root = DEFAULT_ROOT, manifest = DEFAULT_MANIFEST, ci = false } = {}) {
  const manifestPath = path.join(root, manifest);
  const contract = await readJson(manifestPath);
  const findings = [];

  if (contract.schema_version !== 1) findings.push({ code: 'admin_db_contract_schema_version_unsupported' });
  if (contract.endpoint !== '/admin/control') findings.push({ code: 'admin_db_contract_endpoint_drift' });
  if (contract.tool !== 'db') findings.push({ code: 'admin_db_contract_tool_drift' });
  if (contract.request?.action !== 'run') findings.push({ code: 'admin_db_contract_action_drift' });
  if (contract.request?.sql_field !== 'sql') findings.push({ code: 'admin_db_contract_sql_field_drift' });
  if (contract.ratchet?.new_raw_callers_allowed !== false) findings.push({ code: 'admin_db_new_raw_callers_not_forbidden' });
  if (contract.ratchet?.provider_compatibility_aliases_allowed !== false) findings.push({ code: 'admin_db_provider_aliases_not_forbidden' });

  const providerPath = path.join(root, contract.provider_path);
  findings.push(...verifyProviderSource(await fs.readFile(providerPath, 'utf8'), contract));
  findings.push(...await verifyBuilder(root, contract));

  const legacy = new Set(contract.legacy_raw_callers || []);
  const rawCallers = new Set();
  const builderConsumers = new Set();
  for (const governedRoot of contract.governed_roots || []) {
    const absoluteRoot = path.join(root, governedRoot);
    for (const absoluteFile of await listCodeFiles(absoluteRoot)) {
      const relative = normalizeRelative(root, absoluteFile);
      if (relative === contract.shared_builder_path) continue;
      const source = await fs.readFile(absoluteFile, 'utf8');
      if (source.includes(BUILDER_IMPORT_TOKEN)) builderConsumers.add(relative);
      const scan = scanRawDbCallerSource(source, contract, relative);
      if (scan.raw_call_count > 0) {
        rawCallers.add(relative);
        findings.push(...scan.findings);
        if (!legacy.has(relative)) {
          findings.push({
            code: 'admin_db_new_raw_caller_forbidden_use_shared_builder',
            file: relative,
            builder: contract.shared_builder_path,
          });
        }
      }
    }
  }

  for (const legacyFile of legacy) {
    if (!rawCallers.has(legacyFile)) {
      findings.push({
        code: 'admin_db_stale_legacy_raw_caller_allowlist_entry',
        file: legacyFile,
        remediation: 'remove_the_entry_to_tighten_the_ratchet',
      });
    }
  }

  if (ci) findings.push(...verifyMonotonicRatchet(contract, readBaseManifest(root, manifest)));

  return {
    ok: findings.length === 0,
    contract: contract.contract_key,
    endpoint: contract.endpoint,
    canonical_action: contract.request?.action,
    canonical_sql_field: contract.request?.sql_field,
    raw_callers: [...rawCallers].sort(),
    builder_consumers: [...builderConsumers].sort(),
    legacy_raw_caller_count: legacy.size,
    findings,
  };
}

function runSelfTest() {
  const contract = {
    tool: 'db',
    request: { action: 'run', sql_field: 'sql' },
    legacy_aliases: { sql_fields: ['query'] },
  };
  const good = scanRawDbCallerSource("const body = { tool: 'db', action: 'run', sql: query, params: [] };", contract);
  assert.equal(good.findings.length, 0);
  const shorthand = scanRawDbCallerSource("const sql = 'SELECT 1'; const body = { tool: 'db', action: 'run', sql, params: [] };", contract);
  assert.equal(shorthand.findings.length, 0);
  const wrongAction = scanRawDbCallerSource("const body = { tool: 'db', action: 'query', sql: query };", contract);
  assert.ok(wrongAction.findings.some((finding) => finding.code === 'admin_db_action_contract_mismatch'));
  const wrongField = scanRawDbCallerSource("const body = { tool: 'db', action: 'run', query: sql };", contract);
  assert.ok(wrongField.findings.some((finding) => finding.code === 'admin_db_sql_field_contract_mismatch'));
  assert.ok(wrongField.findings.some((finding) => finding.code === 'admin_db_legacy_sql_alias_forbidden'));
  const shorthandWrongField = scanRawDbCallerSource("const query = 'SELECT 1'; const body = { tool: 'db', action: 'run', query };", contract);
  assert.ok(shorthandWrongField.findings.some((finding) => finding.code === 'admin_db_sql_field_contract_mismatch'));
  assert.ok(shorthandWrongField.findings.some((finding) => finding.code === 'admin_db_legacy_sql_alias_forbidden'));
  const missingAction = scanRawDbCallerSource("const body = { tool: 'db', sql: query };", contract);
  assert.ok(missingAction.findings.some((finding) => finding.code === 'admin_db_raw_caller_missing_action'));

  const providerContract = {
    ...contract,
    provider_path: '<provider-fixture>',
    provider_error_codes: {
      unsupported_action: 'unsupported_db_action',
      missing_sql: 'missing_sql',
    },
    legacy_aliases: { sql_fields: ['query'], actions: ['query'] },
    ratchet: { provider_compatibility_aliases_allowed: false },
  };
  const exportedProvider = `
    export async function executeDbControl(body = {}) {
      const action = String(body.action || 'run').trim().toLowerCase();
      if (action !== 'run') {
        const err = new Error('Unsupported db action. Use run.');
        err.code = 'unsupported_db_action';
        throw err;
      }
      const sql = typeof body.sql === 'string' ? body.sql : '';
      if (!sql.trim()) {
        const err = new Error('sql is required');
        err.code = 'missing_sql';
        throw err;
      }
      return { sql };
    }
  `;
  assert.equal(verifyProviderSource(exportedProvider, providerContract).length, 0);
  const constProvider = exportedProvider.replace('export async function executeDbControl(body = {}) {', 'const executeDbControl = async (body = {}) => {');
  assert.equal(verifyProviderSource(constProvider, providerContract).length, 0);

  return { ok: true, contract: 'admin_control_db_contract_governance_self_test.v1' };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.selfTest) {
      console.log(JSON.stringify(runSelfTest(), null, 2));
    } else {
      const report = await runGovernance(options);
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      contract: 'admin_control_db_contract_governance.v1',
      error: String(error?.message || error),
    }, null, 2));
    process.exitCode = 1;
  }
}
