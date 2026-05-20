#!/usr/bin/env node
import { fetchDevStatus } from "./dev-db-status-client.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const out = { base_url: "https://dev.mad4b.com" };
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1].replace(/-/g, "_")] = m[2];
  }
  return out;
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(Number(options.timeout_ms || 60000)),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw_preview: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body };
}

function assertCheck(checks, name, passed, details = {}) {
  checks.push({ name, passed: Boolean(passed), details });
}

async function main() {
  const args = parseArgs();
  const base = String(args.base_url || "https://dev.mad4b.com").replace(/\/$/, "");
  const expectedBranch = String(args.expected_branch || process.env.DEV_DEPLOYMENT_BRANCH || process.env.GOVERNED_DEV_BRANCH || "dev").trim();
  const checks = [];

  const status = await fetchDevStatus({ base_url: base });
  assertCheck(checks, "dev health is OK", status.summary.health.status === 200 && status.summary.health.ok, status.summary.health);
  assertCheck(checks, "deployment-info is OK", status.summary.deployment.status === 200 && status.summary.deployment.ok, status.summary.deployment);
  assertCheck(checks, `deployment branch is ${expectedBranch}`, status.summary.deployment.branch === expectedBranch, status.summary.deployment);
  assertCheck(checks, "dev db status is OK", status.summary.db_status.status === 200 && status.summary.db_status.ok, status.summary.db_status);
  assertCheck(checks, "dev db clone has expected minimum table count", Number(status.summary.db_status.table_count || 0) >= 160, status.summary.db_status);
  assertCheck(checks, "dev db clone has expected minimum row count", Number(status.summary.db_status.row_count || 0) >= 40000, status.summary.db_status);

  const unauthDb = await requestJson(`${base}/dev/db/status`, { timeout_ms: 60000 });
  assertCheck(checks, "dev db status rejects unauthenticated access", unauthDb.status === 401 || unauthDb.status === 403, { status: unauthDb.status, code: unauthDb.body?.error?.code || null });

  const version = await requestJson(`${base}/connector-agent/version`, { timeout_ms: 60000 });
  assertCheck(checks, "connector-agent version is available", version.status === 200 && version.body?.ok === true, { status: version.status, version: version.body?.agent?.version || null, has_n8n_lifecycle: version.body?.agent?.has_n8n_lifecycle ?? null });

  const manifest = await requestJson(`${base}/connector-agent/manifest.json`, { timeout_ms: 60000 });
  assertCheck(checks, "connector-agent manifest is available", manifest.status === 200 && manifest.body?.ok === true, { status: manifest.status, version: manifest.body?.version || null, file_count: Object.keys(manifest.body?.files || {}).length });
  for (const name of ["server.mjs", "connector-watchdog.ps1", "connector-safe-upgrade.ps1"]) {
    assertCheck(checks, `manifest has hash for ${name}`, Boolean(manifest.body?.files?.[name]?.sha256), { name });
  }

  const unauthHeartbeat = await requestJson(`${base}/connector-agent/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: "smoke-test" }),
    timeout_ms: 60000,
  });
  assertCheck(checks, "heartbeat rejects unauthenticated access", unauthHeartbeat.status === 401 || unauthHeartbeat.status === 403, { status: unauthHeartbeat.status, code: unauthHeartbeat.body?.error?.code || null });

  const passed = checks.filter((check) => check.passed).length;
  const failed = checks.length - passed;
  console.log(JSON.stringify({
    ok: failed === 0,
    base_url: base,
    passed,
    failed,
    checks,
    secrets_included: false,
    destructive_actions_attempted: false,
  }, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "dev_autopilot_smoke_failed", message: err.message }, secrets_included: false, destructive_actions_attempted: false }, null, 2));
  process.exitCode = 1;
});
