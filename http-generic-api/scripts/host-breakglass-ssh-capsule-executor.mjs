#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sanitizeBootstrapError } from "../runtimeBootstrapContract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const CAPSULE_RE = /^\.github\/breakglass\/shell\/[A-Za-z0-9._-]+\.sh$/u;
const EVIDENCE_RE = /^\.github\/breakglass\/evidence\/[A-Za-z0-9._-]+\.json$/u;
const HOST_RE = /^[A-Za-z0-9.-]{1,255}$/u;
const USER_RE = /^[A-Za-z0-9._-]{1,64}$/u;
const SHA_RE = /^[0-9a-f]{40}$/u;
const HASH_RE = /^[0-9a-f]{64}$/u;

function deny(code, message) { throw Object.assign(new Error(message), { code, status: 400 }); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function same(a, b) { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function inside(relativePath) { const absolute = path.resolve(REPO_ROOT, relativePath); if (!absolute.startsWith(`${REPO_ROOT}${path.sep}`)) deny("host_breakglass_capsule_escape_denied", "Capsule path escapes the repository."); return absolute; }
function required(value, code) { const normalized = String(value || "").trim(); if (!normalized) deny(code, "Required Hostinger SSH Breakglass configuration is missing."); return normalized; }

function validateEvidence(relativePath, expectedSha, targetKey) {
  if (!EVIDENCE_RE.test(relativePath)) deny("host_breakglass_backup_evidence_invalid", "Production shell requires repository-owned backup evidence.");
  const evidence = JSON.parse(fs.readFileSync(inside(relativePath), "utf8"));
  if (evidence?.contract !== "mad4b.host-breakglass-backup-evidence.v1" || evidence?.environment !== "production" || evidence?.status !== "verified" || evidence?.source_sha !== expectedSha || evidence?.target_key !== targetKey || evidence?.restore_test?.status !== "pass" || evidence?.secrets_included !== false || Date.parse(evidence?.expires_at || 0) <= Date.now()) deny("host_breakglass_backup_evidence_not_ready", "Backup evidence is expired or does not prove an exact-SHA, exact-target restore test.");
  return hash(JSON.stringify(evidence));
}

export function runProductionShellCapsule({ env = process.env, spawnSyncImpl = spawnSync, repoRoot = REPO_ROOT } = {}) {
  const envelopeJson = required(env.HOST_BREAKGLASS_CAPSULE_JSON, "host_breakglass_capsule_missing");
  if (envelopeJson.length > 4096) deny("host_breakglass_capsule_envelope_too_large", "Capsule envelope exceeds the bounded input size.");
  const envelope = JSON.parse(envelopeJson);
  if (Object.keys(envelope).some((key) => !["path", "sha256", "confirmation", "backup_evidence_path"].includes(key))) deny("host_breakglass_capsule_envelope_field_denied", "Capsule envelope contains unsupported fields.");
  const expectedSha = String(env.BOOTSTRAP_EXPECTED_SHA || "").toLowerCase();
  const capsulePath = String(envelope.path || "");
  const capsuleSha256 = String(envelope.sha256 || "").toLowerCase();
  const targetKey = String(env.BOOTSTRAP_TARGET_KEY || "production-runtime");
  if (!SHA_RE.test(expectedSha) || !CAPSULE_RE.test(capsulePath) || !HASH_RE.test(capsuleSha256)) deny("host_breakglass_capsule_binding_invalid", "Production shell capsule binding is invalid.");
  const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim().toLowerCase();
  if (!same(checkoutSha, expectedSha)) deny("host_breakglass_capsule_source_mismatch", "Checkout SHA does not match the approved shell capsule SHA.");
  const capsule = fs.readFileSync(inside(capsulePath), "utf8");
  if (!same(hash(capsule), capsuleSha256)) deny("host_breakglass_capsule_hash_mismatch", "Shell capsule does not match capsule_sha256.");
  const confirmation = `EXECUTE_HOST_BREAKGLASS_CAPSULE:production_hostinger_autodeploy:${expectedSha}:${capsuleSha256}`;
  if (!same(String(envelope.confirmation || ""), confirmation)) deny("host_breakglass_capsule_confirmation_required", "Exact Production shell capsule confirmation is required.");
  const backupEvidenceSha256 = validateEvidence(String(envelope.backup_evidence_path || ""), expectedSha, targetKey);
  const host = required(env.HOSTINGER_PROD_SSH_HOST, "host_breakglass_ssh_host_missing");
  const user = required(env.HOSTINGER_PROD_SSH_USER, "host_breakglass_ssh_user_missing");
  const privateKey = required(env.HOSTINGER_PROD_SSH_PRIVATE_KEY, "host_breakglass_ssh_key_missing");
  const knownHosts = required(env.HOSTINGER_PROD_SSH_KNOWN_HOSTS, "host_breakglass_ssh_known_hosts_missing");
  const port = Number(env.HOSTINGER_PROD_SSH_PORT || 22);
  if (!HOST_RE.test(host) || !USER_RE.test(user) || !Number.isInteger(port) || port < 1 || port > 65535) deny("host_breakglass_ssh_target_invalid", "Hostinger SSH target is invalid.");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-host-breakglass-"));
  const keyPath = path.join(tempDir, "id");
  const knownHostsPath = path.join(tempDir, "known_hosts");
  try {
    fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
    fs.writeFileSync(knownHostsPath, knownHosts, { mode: 0o600 });
    const args = ["300", "ssh", "-T", "-p", String(port), "-i", keyPath, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${knownHostsPath}`, "-o", "ConnectTimeout=10", "-o", "ConnectionAttempts=1", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=1", `${user}@${host}`, "sh", "-s"];
    const result = spawnSyncImpl("timeout", args, { input: capsule, encoding: "utf8", shell: false, timeout: 310000, maxBuffer: 1024 * 1024, windowsHide: true });
    if (result.error || result.status !== 0) throw Object.assign(new Error("Production Hostinger shell capsule failed."), { code: "host_breakglass_ssh_capsule_failed", status: 502, details: { exit_code: result.status ?? null, signal: result.signal || null } });
    return { ok: true, contract: "mad4b.host-breakglass-ssh-capsule-result.v1", environment_key: "production_hostinger_autodeploy", expected_sha: expectedSha, capsule_path: capsulePath, capsule_sha256: capsuleSha256, backup_evidence_sha256: backupEvidenceSha256, exit_code: result.status, stdout_sha256: hash(result.stdout || ""), stdout_bytes: Buffer.byteLength(result.stdout || ""), stderr_sha256: hash(result.stderr || ""), stderr_bytes: Buffer.byteLength(result.stderr || ""), shell_exception_used: true, hostinger_remote_exec_performed: true, database_mutation_performed: "unknown", secrets_included: false };
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(runProductionShellCapsule())}\n`); } catch (error) { process.stdout.write(`${JSON.stringify({ ok: false, error: sanitizeBootstrapError(error), hostinger_remote_exec_performed: "unknown", secrets_included: false })}\n`); process.exitCode = 1; }
}
