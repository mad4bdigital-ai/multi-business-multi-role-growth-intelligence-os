#!/usr/bin/env node
import { spawn } from "node:child_process";

const CONFIRM = "INSTALL_SSHPASS_SERVER_DEPENDENCY";
const PACKAGE_NAME = "sshpass";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { apply: false, confirm: "", timeoutMs: 300000 };
  for (let i = 0; i < argv.length; i += 1) {
    const item = String(argv[i] || "");
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item === "--apply") args.apply = true;
    else if (item.startsWith("--confirm")) { args.confirm = String(value || ""); if (consume) i += 1; }
    else if (item.startsWith("--timeout-ms")) { args.timeoutMs = Math.max(30000, Math.min(Number(value || 300000), 600000)); if (consume) i += 1; }
    else throw new Error(`Unsupported argument: ${item}`);
  }
  return args;
}

function sanitize(text = "") {
  return String(text || "")
    .replace(/(password|passphrase|token|secret|private_key)=\S+/gi, "$1=[redacted]")
    .slice(0, 4000);
}

function run(command, args = [], { timeoutMs = 30000, env = process.env } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(command, args, { shell: false, env });
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 1000).unref?.();
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, command, args, error_code: error.code || "spawn_error", message: sanitize(error.message), timed_out: false, stdout: sanitize(stdout), stderr: sanitize(stderr), secrets_included: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && timedOut === false, command, args, exit_code: code, timed_out: timedOut, stdout: sanitize(stdout), stderr: sanitize(stderr), secrets_included: false });
    });
  });
}

async function commandExists(command) {
  const result = await run("/usr/bin/env", ["bash", "-lc", `command -v ${command}`], { timeoutMs: 5000 });
  return { exists: result.ok === true, path: result.stdout.trim() || null, result };
}

async function detectPackageManager() {
  const managers = ["apt-get", "dnf", "yum", "apk"];
  for (const manager of managers) {
    const found = await commandExists(manager);
    if (found.exists) return { manager, path: found.path };
  }
  return { manager: null, path: null };
}

function installPlan(manager) {
  if (manager === "apt-get") return [
    { command: "apt-get", args: ["update"] },
    { command: "apt-get", args: ["install", "-y", PACKAGE_NAME], env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" } },
  ];
  if (manager === "dnf") return [{ command: "dnf", args: ["install", "-y", PACKAGE_NAME] }];
  if (manager === "yum") return [{ command: "yum", args: ["install", "-y", PACKAGE_NAME] }];
  if (manager === "apk") return [{ command: "apk", args: ["add", PACKAGE_NAME] }];
  return [];
}

async function main() {
  const args = parseArgs();
  const before = await commandExists(PACKAGE_NAME);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const isRoot = uid === 0;
  const packageManager = await detectPackageManager();
  const plan = installPlan(packageManager.manager).map((step) => ({ command: step.command, args: step.args }));
  const base = {
    ok: true,
    action: "hostinger-sshpass-dependency-install",
    package_name: PACKAGE_NAME,
    applied: false,
    apply_requested: args.apply,
    confirm_required: CONFIRM,
    already_installed: before.exists,
    existing_path: before.path,
    uid,
    is_root: isRoot,
    package_manager: packageManager.manager,
    package_manager_path: packageManager.path,
    plan,
    deploy_allowed: false,
    restart_allowed: false,
    provider_dispatch_allowed: false,
    executes_hostinger_login: false,
    secrets_included: false,
  };

  if (before.exists) {
    console.log(JSON.stringify({ ...base, ready: true, reason: "sshpass_already_installed" }, null, 2));
    return;
  }

  if (!args.apply) {
    console.log(JSON.stringify({ ...base, ready: false, reason: isRoot && packageManager.manager ? "dry_run_ready_for_apply" : "dry_run_blocked_requires_root_or_supported_package_manager" }, null, 2));
    return;
  }

  if (args.confirm !== CONFIRM) {
    const err = new Error(`--confirm=${CONFIRM} is required for apply.`);
    err.code = "missing_install_confirmation";
    throw err;
  }
  if (!isRoot) {
    const err = new Error("Installing sshpass requires root privileges on the server runtime.");
    err.code = "sshpass_install_requires_root";
    throw err;
  }
  if (!packageManager.manager) {
    const err = new Error("No supported package manager found. Supported: apt-get, dnf, yum, apk.");
    err.code = "unsupported_package_manager";
    throw err;
  }

  const executed = [];
  for (const step of installPlan(packageManager.manager)) {
    const result = await run(step.command, step.args, { timeoutMs: args.timeoutMs, env: step.env || process.env });
    executed.push(result);
    if (!result.ok) {
      const err = new Error(`Failed to install ${PACKAGE_NAME} using ${packageManager.manager}.`);
      err.code = "sshpass_install_failed";
      err.details = { step: { command: step.command, args: step.args }, result };
      throw err;
    }
  }

  const after = await commandExists(PACKAGE_NAME);
  console.log(JSON.stringify({ ...base, applied: true, ready: after.exists, installed_path: after.path, executed, reason: after.exists ? "sshpass_installed" : "sshpass_install_completed_but_binary_not_found" }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: { code: error.code || "sshpass_dependency_install_failed", message: error.message, details: error.details || undefined }, deploy_allowed: false, restart_allowed: false, provider_dispatch_allowed: false, executes_hostinger_login: false, secrets_included: false }, null, 2));
  process.exitCode = 1;
});
