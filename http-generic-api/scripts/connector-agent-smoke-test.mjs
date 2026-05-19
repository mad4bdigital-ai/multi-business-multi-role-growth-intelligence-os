#!/usr/bin/env node
const DEFAULT_BASE = "https://auth.mad4b.com";

function parseArgs(argv = process.argv.slice(2)) {
  const out = { base_url: DEFAULT_BASE };
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1].replace(/-/g, "_")] = m[2];
  }
  return out;
}

async function request(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const buffer = Buffer.from(await res.arrayBuffer());
  let body = null;
  try { body = JSON.parse(buffer.toString("utf8")); } catch { body = { raw_preview: buffer.toString("utf8", 0, Math.min(buffer.length, 200)) }; }
  return { status: res.status, ok: res.ok, body, headers: res.headers, buffer };
}

function assertOk(condition, code, details = {}) {
  if (condition) return;
  const err = new Error(code);
  err.code = code;
  err.details = details;
  throw err;
}

async function sha256Hex(buffer) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyManifestFile(name, file) {
  assertOk(file?.url && file?.sha256, "manifest_file_entry_incomplete", { name });
  const response = await request(file.url);
  assertOk(response.status === 200, "manifest_file_request_failed", { name, status: response.status });
  const headerHash = response.headers.get("x-mad4b-sha256");
  const actualHash = await sha256Hex(response.buffer);
  assertOk(actualHash === file.sha256, "manifest_file_hash_mismatch", { name, actualHashPrefix: actualHash.slice(0, 12), manifestHashPrefix: file.sha256.slice(0, 12) });
  if (headerHash) {
    assertOk(headerHash === file.sha256, "manifest_file_header_hash_mismatch", { name, headerHashPrefix: headerHash.slice(0, 12), manifestHashPrefix: file.sha256.slice(0, 12) });
  }
  return {
    name,
    status: response.status,
    content_type: response.headers.get("content-type") || null,
    cache_control: response.headers.get("cache-control") || null,
    size: response.buffer.length,
    hash_prefix: file.sha256.slice(0, 12),
  };
}

async function main() {
  const args = parseArgs();
  const base = String(args.base_url || DEFAULT_BASE).replace(/\/$/, "");
  const manifest = await request(`${base}/connector-agent/manifest.json`);
  assertOk(manifest.status === 200 && manifest.body?.ok === true, "manifest_request_failed", { status: manifest.status, body: manifest.body });
  assertOk(manifest.body.agent === "mad4b-local-connector", "manifest_agent_mismatch", { body: manifest.body });

  const requiredFiles = ["server.mjs", "connector-watchdog.ps1", "connector-safe-upgrade.ps1", "db-restore-certifier.mjs"];
  for (const name of requiredFiles) {
    assertOk(manifest.body.files?.[name]?.sha256, "manifest_missing_required_file_hash", { name });
  }

  const verifiedFiles = [];
  for (const name of requiredFiles) {
    verifiedFiles.push(await verifyManifestFile(name, manifest.body.files[name]));
  }

  const unsignedInstaller = await request(`${base}/connector-agent/installer.ps1`);
  assertOk([400, 401].includes(unsignedInstaller.status), "unsigned_installer_should_be_rejected", { status: unsignedInstaller.status, code: unsignedInstaller.body?.error?.code || null });

  const unauthHeartbeat = await fetch(`${base}/connector-agent/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ device_id: "smoke-test" }),
    signal: AbortSignal.timeout(30000),
  });
  const unauthHeartbeatText = await unauthHeartbeat.text();
  let unauthHeartbeatBody = null;
  try { unauthHeartbeatBody = JSON.parse(unauthHeartbeatText); } catch { unauthHeartbeatBody = {}; }
  assertOk(unauthHeartbeat.status === 401, "unauthenticated_heartbeat_should_be_401", { status: unauthHeartbeat.status, code: unauthHeartbeatBody?.error?.code || null });

  console.log(JSON.stringify({
    ok: true,
    base_url: base,
    manifest_status: manifest.status,
    version: manifest.body.version,
    file_count: Object.keys(manifest.body.files || {}).length,
    verified_files: verifiedFiles,
    unsigned_installer_status: unsignedInstaller.status,
    unsigned_installer_code: unsignedInstaller.body?.error?.code || null,
    unauthenticated_heartbeat_status: unauthHeartbeat.status,
    unauthenticated_heartbeat_code: unauthHeartbeatBody?.error?.code || null,
    secrets_included: false,
    bodies_printed: false,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "connector_agent_smoke_failed", message: err.message, details: err.details || undefined }, secrets_included: false, bodies_printed: false }, null, 2));
  process.exitCode = 1;
});
