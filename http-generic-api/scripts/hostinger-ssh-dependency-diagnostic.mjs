#!/usr/bin/env node
import { spawn } from "node:child_process";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { timeoutMs: 5000 };
  for (let i = 0; i < argv.length; i += 1) {
    const item = String(argv[i] || "");
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--timeout-ms")) { args.timeoutMs = Math.max(1000, Math.min(Number(value || 5000), 15000)); if (consume) i += 1; }
    else throw new Error(`Unsupported argument: ${item}`);
  }
  return args;
}

function sanitize(text = "") {
  return String(text || "")
    .replace(/(password|passphrase|token|secret|private_key)=\S+/gi, "$1=[redacted]")
    .slice(0, 2000);
}

function run(command, args = [], { timeoutMs = 5000, stdin = null, fd3 = null } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const stdio = fd3 === null ? [stdin === null ? "ignore" : "pipe", "pipe", "pipe"] : [stdin === null ? "ignore" : "pipe", "pipe", "pipe", "pipe"];
    const child = spawn(command, args, { shell: false, stdio, detached: true });
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} }
      setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} } }, 1000).unref?.();
    }, timeoutMs);

    if (stdin !== null && child.stdin) child.stdin.end(String(stdin));
    if (fd3 !== null && child.stdio?.[3]) child.stdio[3].end(String(fd3));
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ command, args: args.slice(0, 3), ok: false, error_code: error.code || "spawn_error", message: sanitize(error.message), timed_out: false, stdout: sanitize(stdout), stderr: sanitize(stderr), secrets_included: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ command, args: args.slice(0, 3), ok: code === 0 && timedOut === false, exit_code: code, timed_out: timedOut, stdout: sanitize(stdout), stderr: sanitize(stderr), secrets_included: false });
    });
  });
}

async function main() {
  const args = parseArgs();
  const checks = {};
  checks.node = await run(process.execPath, ["--version"], { timeoutMs: args.timeoutMs });
  checks.ssh = await run("ssh", ["-V"], { timeoutMs: args.timeoutMs });
  checks.sshpass = await run("sshpass", ["-V"], { timeoutMs: args.timeoutMs });
  checks.timeout = await run("timeout", ["--version"], { timeoutMs: args.timeoutMs });
  checks.fd3_pipe = await run(process.execPath, ["-e", "const fs=require('fs'); const data=fs.readFileSync(3,'utf8'); console.log('fd3_len='+data.length)"], { timeoutMs: args.timeoutMs, fd3: "probe-placeholder-not-a-secret\n" });
  const ok = checks.node.ok === true && checks.ssh.ok === true && checks.sshpass.ok === true && checks.timeout.ok === true && checks.fd3_pipe.ok === true;
  process.stdout.write(`${JSON.stringify({ ok, mode: "dependency_diagnostic_only", checks, executes_ssh_network: false, executes_hostinger_login: false, deploy_allowed: false, restart_allowed: false, provider_dispatch_allowed: false, secrets_included: false }, null, 2)}\n`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: error.code || "hostinger_ssh_dependency_diagnostic_failed", message: error.message }, secrets_included: false }, null, 2)}\n`);
  process.exitCode = 1;
});
