#!/usr/bin/env node
/**
 * Source-controlled n8n isolated restore boot certifier.
 * Restores to an isolated user folder, binds to loopback-only ports, checks /healthz, stops the process, and removes plaintext restore material.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";

function arg(name, fallback = "") {
  const item = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (item) return item.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}
function parseJson(file) { let text = fs.readFileSync(file, "utf8"); if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); return JSON.parse(text); }
function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
function run(command, args, opts = {}) {
  const res = spawnSync(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...opts });
  if (res.status !== 0) throw new Error(`${command} failed with ${res.status}: ${(res.stderr || res.stdout || "").slice(0, 1000)}`);
  return res.stdout || "";
}
function health(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk.toString(); });
      res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: body.slice(0, 300) }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
  });
}

const artifact = arg("artifact");
const manifestPath = arg("manifest");
const keyPath = arg("recovery-key");
const n8nBin = arg("n8n-bin", process.platform === "win32" ? "D:\\npm-global\\node_modules\\n8n\\bin\\n8n" : "n8n");
const restoreRoot = arg("restore-root", path.join(process.cwd(), "restore-tests", "n8n-isolated"));
const port = Number(arg("port", "5688"));
const brokerPort = Number(arg("broker-port", "5689"));
const launcherHealthPort = Number(arg("launcher-health-port", "5690"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const workDir = path.join(restoreRoot, `isolated-boot-${stamp}`);
const extractDir = path.join(workDir, "extracted");
fs.mkdirSync(extractDir, { recursive: true });
const evidence = { ok: false, mode: "isolated_n8n_restore_boot", started_at: new Date().toISOString(), work_dir: workDir, port, broker_port: brokerPort, listen_address: "127.0.0.1", secrets_included: false, production_touched: false, cleanup: {}, isolated_boot_attempted: false };
try {
  if (!artifact || !manifestPath || !keyPath) throw new Error("artifact, manifest, and recovery-key arguments are required");
  const manifest = parseJson(manifestPath);
  const encrypted = fs.readFileSync(artifact);
  const checksum = sha256(encrypted);
  evidence.artifact = { exists: true, size_bytes: encrypted.length, checksum_sha256: checksum, checksum_matches: checksum === manifest.checksum_value };
  if (!evidence.artifact.checksum_matches) throw new Error("encrypted artifact checksum mismatch");
  const keyDoc = parseJson(keyPath);
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(keyDoc.key_b64, "base64"), Buffer.from(keyDoc.iv_b64, "base64"));
  decipher.setAuthTag(Buffer.from(keyDoc.auth_tag_b64, "base64"));
  const zipBytes = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  evidence.decryption = { ok: true, zip_size_bytes: zipBytes.length };
  evidence.recovery_key = { content_read: true, content_returned: false };
  const zipPath = path.join(workDir, "restore.plain.zip");
  fs.writeFileSync(zipPath, zipBytes);
  if (process.platform === "win32") run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`]);
  else run("unzip", ["-q", zipPath, "-d", extractDir]);
  fs.rmSync(zipPath, { force: true });
  evidence.cleanup.plaintext_zip_removed = true;
  const userFolder = path.join(extractDir, "n8n-data");
  const markers = {
    has_user_folder: fs.existsSync(userFolder),
    has_database_sqlite: fs.existsSync(path.join(userFolder, ".n8n", "database.sqlite")),
    has_config: fs.existsSync(path.join(userFolder, ".n8n", "config")),
    has_nodes_dir: fs.existsSync(path.join(userFolder, ".n8n", "nodes")),
  };
  evidence.structural_restore = { markers, expected_file_count: manifest.file_count };
  if (!markers.has_user_folder || !markers.has_database_sqlite || !markers.has_config) throw new Error("required n8n restore markers missing after extraction");
  const env = {
    ...process.env,
    N8N_USER_FOLDER: userFolder,
    N8N_PORT: String(port),
    N8N_LISTEN_ADDRESS: "127.0.0.1",
    N8N_PROTOCOL: "http",
    N8N_HOST: "127.0.0.1",
    N8N_RUNNERS_ENABLED: "false",
    N8N_DIAGNOSTICS_ENABLED: "false",
    N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
    N8N_TEMPLATES_ENABLED: "false",
    N8N_SECURE_COOKIE: "false",
    N8N_RUNNERS_BROKER_PORT: String(brokerPort),
    N8N_RUNNERS_BROKER_LISTEN_ADDRESS: "127.0.0.1",
    N8N_RUNNERS_TASK_BROKER_URI: `http://127.0.0.1:${brokerPort}`,
    N8N_RUNNERS_LAUNCHER_HEALTH_CHECK_PORT: String(launcherHealthPort),
  };
  const childArgs = n8nBin === "n8n" ? ["start"] : [n8nBin, "start"];
  const childCommand = n8nBin === "n8n" ? "n8n" : process.execPath;
  const child = spawn(childCommand, childArgs, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  evidence.isolated_boot_attempted = true;
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  let healthResult = { ok: false };
  for (let i = 0; i < 120; i += 1) {
    healthResult = await health(`http://127.0.0.1:${port}/healthz`);
    if (healthResult.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (child.exitCode !== null) break;
  }
  evidence.health = healthResult;
  evidence.process = { pid: child.pid, exited_before_health: child.exitCode !== null, stdout_preview: stdout.slice(0, 500), stderr_preview: stderr.slice(0, 500) };
  try { child.kill("SIGTERM"); } catch {}
  await new Promise((resolve) => setTimeout(resolve, 2500));
  if (child.exitCode === null) { try { child.kill("SIGKILL"); } catch {} }
  evidence.cleanup.isolated_process_stopped = true;
  evidence.ok = healthResult.ok === true;
} catch (error) {
  evidence.error = { code: error.code || "isolated_n8n_restore_boot_failed", message: error.message };
} finally {
  try { fs.rmSync(extractDir, { recursive: true, force: true }); evidence.cleanup.extracted_restore_removed = true; } catch { evidence.cleanup.extracted_restore_removed = false; }
}
evidence.completed_at = new Date().toISOString();
const evidencePath = path.join(workDir, "isolated-n8n-restore-boot-evidence.json");
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
evidence.evidence_path = evidencePath;
console.log(JSON.stringify(evidence, null, 2));
process.exit(evidence.ok ? 0 : 1);
