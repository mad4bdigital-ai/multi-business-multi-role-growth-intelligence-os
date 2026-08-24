import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { runProductionShellCapsule } from "./scripts/host-breakglass-ssh-capsule-executor.mjs";

const root = path.resolve(process.cwd(), "..");
const capsuleRelative = ".github/breakglass/shell/test-ssh-capsule.sh";
const evidenceRelative = ".github/breakglass/evidence/test-ssh-capsule.json";
const capsulePath = path.join(root, capsuleRelative);
const evidencePath = path.join(root, evidenceRelative);
const capsule = "set -eu\nprintf ready\n";
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const capsuleHash = createHash("sha256").update(capsule).digest("hex");

test.before(() => {
  fs.mkdirSync(path.dirname(capsulePath), { recursive: true });
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(capsulePath, capsule);
  fs.writeFileSync(evidencePath, JSON.stringify({ contract: "mad4b.host-breakglass-backup-evidence.v1", environment: "production", status: "verified", target_key: "production-runtime", source_sha: sha, expires_at: new Date(Date.now() + 3600000).toISOString(), restore_test: { status: "pass" }, secrets_included: false }));
});

test("Production shell capsule uses pinned known-hosts, argv SSH, and bounded hash-only output", () => {
  let observed;
  const env = { BOOTSTRAP_EXPECTED_SHA: sha, HOSTINGER_PROD_SSH_HOST: "host.example", HOSTINGER_PROD_SSH_PORT: "65002", HOSTINGER_PROD_SSH_USER: "operator", HOSTINGER_PROD_SSH_PRIVATE_KEY: "private-key-value", HOSTINGER_PROD_SSH_KNOWN_HOSTS: "[host.example]:65002 ssh-ed25519 AAAATEST", HOST_BREAKGLASS_CAPSULE_JSON: JSON.stringify({ path: capsuleRelative, sha256: capsuleHash, confirmation: `EXECUTE_HOST_BREAKGLASS_CAPSULE:production_hostinger_autodeploy:${sha}:${capsuleHash}`, backup_evidence_path: evidenceRelative }) };
  const result = runProductionShellCapsule({ env, spawnSyncImpl: (command, args, options) => { observed = { command, args, options }; return { status: 0, signal: null, stdout: "ready", stderr: "" }; } });
  assert.equal(result.ok, true);
  assert.equal(result.hostinger_remote_exec_performed, true);
  assert.equal(Object.hasOwn(result, "stdout"), false);
  assert.equal(observed.command, "timeout");
  assert.equal(observed.options.shell, false);
  assert.equal(observed.options.input, capsule);
  assert.equal(observed.args.includes("StrictHostKeyChecking=yes"), true);
  assert.equal(observed.args.join(" ").includes("private-key-value"), false);
});

test("Production shell capsule refuses an unpinned host before SSH", () => {
  const env = { BOOTSTRAP_EXPECTED_SHA: sha, HOSTINGER_PROD_SSH_HOST: "host.example", HOSTINGER_PROD_SSH_PORT: "65002", HOSTINGER_PROD_SSH_USER: "operator", HOSTINGER_PROD_SSH_PRIVATE_KEY: "private-key-value", HOST_BREAKGLASS_CAPSULE_JSON: JSON.stringify({ path: capsuleRelative, sha256: capsuleHash, confirmation: `EXECUTE_HOST_BREAKGLASS_CAPSULE:production_hostinger_autodeploy:${sha}:${capsuleHash}`, backup_evidence_path: evidenceRelative }) };
  assert.throws(() => runProductionShellCapsule({ env, spawnSyncImpl: () => { throw new Error("must not spawn"); } }), /configuration is missing/u);
});

test.after(() => { fs.rmSync(capsulePath, { force: true }); fs.rmSync(evidencePath, { force: true }); });
