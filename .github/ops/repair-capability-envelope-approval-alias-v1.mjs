import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';

const BASE = String(process.env.RUNTIME_BASE_URL || '').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '');
const EVIDENCE_DIR = `${process.env.RUNNER_TEMP}/hostinger-resync-policy-finalization-v7`;
const CONFIG_KEY = 'capability_resolution_envelope_approval_tool_policy_v1';
const STALE_SCRIPT = 'http-generic-api/scripts/capability-resolution-envelope-approve.mjs';
const CORRECT_SCRIPT = 'scripts/capability-resolution-envelope-approve.mjs';
const SHELL_ALLOWLIST_ENV = 'ADMIN_SHELL_ALLOWLIST';
const APPROVAL_ALIAS = 'capability_resolution_envelope_approve';

function parsedValue(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value;
  try { return JSON.parse(text); } catch { return value; }
}

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

async function writeJson(name, value) {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(`${EVIDENCE_DIR}/${name}`, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function requestAdmin(body) {
  const response = await fetch(`${BASE}/admin/control`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; }
  catch { payload = { raw_preview: text.slice(0, 500) }; }
  const result = { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  if (!response.ok || payload?.ok === false) {
    const error = new Error(`admin control failed with HTTP ${response.status}`);
    error.code = payload?.error?.code || 'admin_control_failed';
    error.result = result;
    throw error;
  }
  return result;
}

function requestDb(sql, params = []) {
  return requestAdmin({ tool: 'db', action: 'run', sql, params });
}

function extractRows(result) {
  const carrier = findObject(result, (candidate) => Array.isArray(candidate?.rows));
  return carrier?.rows || [];
}

function extractMutation(result) {
  return findObject(result, (candidate) => candidate?.statement_result_type === 'mutation' && candidate?.result);
}

function extractEnvResult(result) {
  return findObject(result, (candidate) => candidate?.action && candidate?.name === SHELL_ALLOWLIST_ENV);
}

async function readCurrentRegistry() {
  const result = await requestDb(
    "SELECT config_key, JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.script')) AS script FROM platform_runtime_config WHERE config_key = ? LIMIT 1",
    [CONFIG_KEY],
  );
  const rows = extractRows(result);
  assert.equal(rows.length, 1, 'Approval alias policy row was not found exactly once');
  return { result, row: rows[0] };
}

async function readCurrentShellOverrides() {
  const result = await requestAdmin({
    tool: 'env',
    action: 'get',
    name: SHELL_ALLOWLIST_ENV,
    reveal_values: true,
  });
  const carrier = extractEnvResult(result);
  assert.ok(carrier, 'ADMIN_SHELL_ALLOWLIST env readback was not returned');
  const raw = carrier.exists ? String(carrier.value || '') : '';
  if (!raw.trim()) return { overrides: {}, configured: false };
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Existing ADMIN_SHELL_ALLOWLIST is not valid JSON'); }
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'Existing ADMIN_SHELL_ALLOWLIST must be a JSON object');
  return { overrides: parsed, configured: true };
}

async function setApprovalOverride(existing) {
  const overrideEntry = {
    command: '/proc/self/exe',
    args: [CORRECT_SCRIPT],
    display_name: 'Approve capability resolution envelope',
    allow_extra_args: true,
    max_extra_args: 12,
    timeout_ms: 120000,
  };
  const next = { ...existing, [APPROVAL_ALIAS]: overrideEntry };
  await requestAdmin({
    tool: 'env',
    action: 'set',
    name: SHELL_ALLOWLIST_ENV,
    value: JSON.stringify(next),
    reveal_values: false,
  });
  const after = await readCurrentShellOverrides();
  const entry = after.overrides?.[APPROVAL_ALIAS];
  assert.equal(entry?.command, '/proc/self/exe', 'Approval alias command override mismatch');
  assert.deepEqual(entry?.args, [CORRECT_SCRIPT], 'Approval alias args override mismatch');
  assert.equal(entry?.allow_extra_args, true, 'Approval alias extra args must remain enabled');
  assert.equal(Number(entry?.max_extra_args), 12, 'Approval alias max_extra_args mismatch');
  return {
    previous_override_present: Object.prototype.hasOwnProperty.call(existing, APPROVAL_ALIAS),
    override_count_before: Object.keys(existing).length,
    override_count_after: Object.keys(after.overrides).length,
  };
}

async function main() {
  assert.equal(BASE, 'https://auth.mad4b.com');
  assert.ok(KEY, 'BACKEND_API_KEY is required');

  const before = await readCurrentRegistry();
  assert.equal(before.row.config_key, CONFIG_KEY, 'Approval alias config key mismatch');
  const beforeScript = String(before.row.script || '');
  let registryMutationExecuted = false;
  let affectedRows = 0;

  if (beforeScript === STALE_SCRIPT) {
    const mutation = await requestDb(
      "UPDATE platform_runtime_config SET config_json = JSON_SET(config_json, '$.script', ?), updated_at = CURRENT_TIMESTAMP WHERE config_key = ? AND JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.script')) = ?",
      [CORRECT_SCRIPT, CONFIG_KEY, STALE_SCRIPT],
    );
    const mutationCarrier = extractMutation(mutation);
    affectedRows = Number(mutationCarrier?.result?.affectedRows || 0);
    assert.equal(affectedRows, 1, 'Approval alias path repair did not affect exactly one row');
    registryMutationExecuted = true;
    await writeJson('approval-alias-mutation.json', mutation);
  } else {
    assert.equal(beforeScript, CORRECT_SCRIPT, `Unexpected approval alias script path: ${beforeScript}`);
  }

  const after = await readCurrentRegistry();
  assert.equal(String(after.row.script || ''), CORRECT_SCRIPT, 'Approval alias registry path readback mismatch');

  const shellBefore = await readCurrentShellOverrides();
  const overrideEvidence = await setApprovalOverride(shellBefore.overrides);

  const summary = {
    schema_version: 'capability_resolution_envelope_approval_alias_repair.v2',
    ok: true,
    config_key: CONFIG_KEY,
    script_before: beforeScript,
    script_after: after.row.script,
    registry_mutation_executed: registryMutationExecuted,
    registry_affected_rows: affectedRows,
    process_env_override_set: true,
    approval_alias: APPROVAL_ALIAS,
    approval_alias_command: '/proc/self/exe',
    approval_alias_args: [CORRECT_SCRIPT],
    ...overrideEvidence,
    same_cycle_registry_readback_verified: true,
    same_cycle_process_env_readback_verified: true,
    provider_call_executed: false,
    external_write_executed: false,
    deployment_executed: false,
    restart_executed: false,
    secrets_included: false,
  };
  await writeJson('approval-alias-before.json', before.result);
  await writeJson('approval-alias-after.json', after.result);
  await writeJson('approval-alias-repair-summary.json', summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(async (error) => {
  const failure = {
    schema_version: 'capability_resolution_envelope_approval_alias_repair_failure.v2',
    ok: false,
    error: {
      code: String(error?.code || 'approval_alias_repair_failed'),
      message: String(error?.message || error || 'Unknown failure').slice(0, 1000),
    },
    provider_call_executed: false,
    external_write_executed: false,
    deployment_executed: false,
    restart_executed: false,
    secrets_included: false,
  };
  try { await writeJson('approval-alias-repair-failure.json', failure); } catch { }
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
});
