import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';

const BASE = String(process.env.RUNTIME_BASE_URL || '').replace(/\/+$/, '');
const KEY = String(process.env.BACKEND_API_KEY || '');
const EVIDENCE_DIR = `${process.env.RUNNER_TEMP}/hostinger-resync-policy-finalization-v7`;
const CONFIG_KEY = 'capability_resolution_envelope_approval_tool_policy_v1';
const STALE_SCRIPT = 'http-generic-api/scripts/capability-resolution-envelope-approve.mjs';
const CORRECT_SCRIPT = 'scripts/capability-resolution-envelope-approve.mjs';

function findObject(value, predicate, seen = new Set()) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.startsWith('{') || text.startsWith('[')) {
      try { value = JSON.parse(text); } catch { return null; }
    } else return null;
  }
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

async function requestDb(sql, params = []) {
  const response = await fetch(`${BASE}/admin/control`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tool: 'db', action: 'run', sql, params }),
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; }
  catch { payload = { raw_preview: text.slice(0, 500) }; }
  const result = { transport_ok: true, status: response.status, http_ok: response.ok, payload };
  if (!response.ok || payload?.ok === false) {
    const error = new Error(`admin db control failed with HTTP ${response.status}`);
    error.code = payload?.error?.code || 'admin_db_control_failed';
    error.result = result;
    throw error;
  }
  return result;
}

function extractRows(result) {
  const carrier = findObject(result, (candidate) => Array.isArray(candidate?.rows));
  return carrier?.rows || [];
}

function extractMutation(result) {
  return findObject(result, (candidate) => candidate?.statement_result_type === 'mutation' && candidate?.result);
}

async function readCurrent() {
  const result = await requestDb(
    "SELECT config_key, JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.script')) AS script FROM platform_runtime_config WHERE config_key = ? LIMIT 1",
    [CONFIG_KEY],
  );
  const rows = extractRows(result);
  assert.equal(rows.length, 1, 'Approval alias policy row was not found exactly once');
  return { result, row: rows[0] };
}

async function main() {
  assert.equal(BASE, 'https://auth.mad4b.com');
  assert.ok(KEY, 'BACKEND_API_KEY is required');

  const before = await readCurrent();
  assert.equal(before.row.config_key, CONFIG_KEY, 'Approval alias config key mismatch');
  const beforeScript = String(before.row.script || '');
  let mutationExecuted = false;
  let affectedRows = 0;

  if (beforeScript === STALE_SCRIPT) {
    const mutation = await requestDb(
      "UPDATE platform_runtime_config SET config_json = JSON_SET(config_json, '$.script', ?), updated_at = CURRENT_TIMESTAMP WHERE config_key = ? AND JSON_UNQUOTE(JSON_EXTRACT(config_json, '$.script')) = ?",
      [CORRECT_SCRIPT, CONFIG_KEY, STALE_SCRIPT],
    );
    const mutationCarrier = extractMutation(mutation);
    affectedRows = Number(mutationCarrier?.result?.affectedRows || 0);
    assert.equal(affectedRows, 1, 'Approval alias path repair did not affect exactly one row');
    mutationExecuted = true;
    await writeJson('approval-alias-mutation.json', mutation);
  } else {
    assert.equal(beforeScript, CORRECT_SCRIPT, `Unexpected approval alias script path: ${beforeScript}`);
  }

  const after = await readCurrent();
  assert.equal(String(after.row.script || ''), CORRECT_SCRIPT, 'Approval alias path readback mismatch');
  const summary = {
    schema_version: 'capability_resolution_envelope_approval_alias_repair.v1',
    ok: true,
    config_key: CONFIG_KEY,
    script_before: beforeScript,
    script_after: after.row.script,
    mutation_executed: mutationExecuted,
    affected_rows: affectedRows,
    same_cycle_readback_verified: true,
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
    schema_version: 'capability_resolution_envelope_approval_alias_repair_failure.v1',
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
