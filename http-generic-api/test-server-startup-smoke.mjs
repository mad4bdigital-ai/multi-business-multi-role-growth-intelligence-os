import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = 18181;
const baseUrl = `http://127.0.0.1:${port}`;
const runtimeCwd = fileURLToPath(new URL(".", import.meta.url));
const child = spawn(process.execPath, ["server.js"], {
  cwd: runtimeCwd,
  env: {
    ...process.env,
    PORT: String(port),
    BACKEND_API_KEY: "startup_smoke_key",
    QUEUE_WORKER_ENABLED: "FALSE",
    REDIS_URL: "redis://127.0.0.1:6399",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.on("data", chunk => {
  stdout += String(chunk || "");
});
child.stderr.on("data", chunk => {
  stderr += String(chunk || "");
});

async function waitForListening(timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (stdout.includes(`listening on port ${port}`)) return;
    if (child.exitCode !== null) {
      throw new Error(`Runtime exited before listening (code ${child.exitCode}). stderr: ${stderr}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for runtime listener. stdout: ${stdout} stderr: ${stderr}`);
}

try {
  await waitForListening();
  const response = await fetch(`${baseUrl}/version`, { signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  assert.equal(response.status, 200, "runtime version endpoint responds after startup");
  assert.equal(body?.service, "http_generic_api_connector", "runtime identifies the expected service");
  assert.ok(body?.deployment?.deployed_commit_sha, "runtime exposes generated deployment commit evidence");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

console.log("server startup smoke passed");
