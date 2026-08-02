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
const backendApiKey = "startup_smoke_key";

// Emulate Hostinger's platform loader: the root entrypoint is required by a
// wrapper instead of being the process main module.
const child = spawn(
  process.execPath,
  ["-e", "require(process.argv[1]);", rootEntrypoint],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DEPLOYMENT_BRANCH: deploymentBranch,
      PORT: String(port),
      BACKEND_API_KEY: backendApiKey,
      JWT_SECRET: "",
      USER_JWT_SECRET: "",
      AUTH_JWT_SECRET: "",
      HEALTH_DEPENDENCY_TIMEOUT_MS: "500",
      QUEUE_WORKER_ENABLED: "FALSE",
      REDIS_URL: "redis://127.0.0.1:6399",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }
);

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

async function fetchJson(path, options = {}, timeoutMs = 5000) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

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
      const result = await fetchJson("/version", {}, 1000);
      if (result.response.status === 200) return result;
    } catch {
      // The listener may not be ready yet.
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out waiting for /version.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
  );
}

function assertProtectedSurface({ label, response, body }) {
  assert.ok(
    [401, 403].includes(response.status),
    `${label} must be mounted and protected, not unavailable; received ${response.status}: ${JSON.stringify(body)}`
  );
  assert.notEqual(body?.error?.code, "user_jwt_verifier_unavailable", `${label} must have an initialized JWT verifier`);
  assert.notEqual(response.status, 503, `${label} must not return Service Unavailable`);
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

  const healthStartedAt = Date.now();
  const health = await fetchJson("/health");
  const healthElapsedMs = Date.now() - healthStartedAt;
  assert.equal(health.response.status, 200, "health remains an HTTP 200 liveness surface while dependencies are degraded");
  assert.equal(health.body?.ok, true);
  assert.ok(["healthy", "degraded"].includes(health.body?.status));
  assert.ok(healthElapsedMs < 5000, `health must be bounded; elapsed ${healthElapsedMs}ms`);
  assert.equal(health.body?.health_probe_timeout_ms, 500);

  const deploymentInfo = await fetchJson("/deployment-info");
  assert.equal(deploymentInfo.response.status, 200, "deployment-info remains available without Admin or Tenant credentials");
  assert.equal(deploymentInfo.body?.ok, true);
  assert.equal(deploymentInfo.body?.evidence?.secrets_included, false);

  const surfaces = [
    {
      label: "Admin system tool catalog",
      path: "/admin/system/tools",
      options: {},
    },
    {
      label: "Admin control dispatcher",
      path: "/admin/control",
      options: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    },
    {
      label: "Tenant-capable system tool catalog",
      path: "/system/tools",
      options: {},
    },
    {
      label: "Tenant documentation catalog",
      path: "/tenant/docs",
      options: {},
    },
    {
      label: "Admin invalid bearer rejection",
      path: "/admin/system/tools",
      options: { headers: { authorization: "Bearer invalid-startup-smoke-token" } },
    },
    {
      label: "Tenant invalid bearer rejection",
      path: "/system/tools",
      options: { headers: { authorization: "Bearer invalid-startup-smoke-token" } },
    },
  ];

  for (const surface of surfaces) {
    assertProtectedSurface({
      label: surface.label,
      ...(await fetchJson(surface.path, surface.options)),
    });
  }
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

console.log("server startup Admin/Tenant auth-surface smoke passed");
