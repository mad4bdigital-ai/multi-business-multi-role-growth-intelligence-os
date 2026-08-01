import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = 18181;
const baseUrl = `http://127.0.0.1:${port}`;
const testFile = fileURLToPath(import.meta.url);
const runtimeCwd = dirname(testFile);
const repositoryRoot = resolve(runtimeCwd, "..");
const rootEntrypoint = resolve(repositoryRoot, "server.js");
const deploymentBranch = String(
  process.env.DEPLOYMENT_BRANCH ||
  process.env.GITHUB_REF_NAME ||
  "Production"
).trim();

const child = spawn(process.execPath, [rootEntrypoint], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    NODE_ENV: "production",
    DEPLOYMENT_BRANCH: deploymentBranch,
    PORT: String(port),
    BACKEND_API_KEY: "startup_smoke_key",
    QUEUE_WORKER_ENABLED: "FALSE",
    REDIS_URL: "redis://127.0.0.1:6399",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
let spawnError = null;

child.stdout.on("data", chunk => {
  stdout += String(chunk || "");
});
child.stderr.on("data", chunk => {
  stderr += String(chunk || "");
});
child.once("error", error => {
  spawnError = error;
});

async function waitForVersion(timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (spawnError) {
      throw new Error(`Runtime spawn failed: ${spawnError.stack || spawnError.message}`);
    }
    if (child.exitCode !== null) {
      throw new Error(
        `Runtime exited before /version became ready (code ${child.exitCode}).\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
      );
    }

    try {
      const response = await fetch(`${baseUrl}/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.status === 200) {
        return {
          response,
          body: await response.json(),
        };
      }
    } catch {
      // The listener may not be ready yet.
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out waiting for /version.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
  );
}

try {
  const { response, body } = await waitForVersion();
  assert.equal(response.status, 200, "runtime version endpoint responds after startup");
  assert.equal(body?.service, "http_generic_api_connector", "runtime identifies the expected service");
  assert.ok(body?.deployment?.deployed_commit_sha, "runtime exposes generated deployment commit evidence");
  assert.equal(
    body?.deployment?.manifest?.branch,
    deploymentBranch,
    "runtime preserves explicit deployment branch evidence through the root entrypoint"
  );
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

console.log("server startup smoke passed");
