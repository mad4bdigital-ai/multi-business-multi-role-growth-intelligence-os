/**
 * Route-level runtime tests for degraded/API-only behavior.
 * Run: node test-routes.mjs
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

function skip(label, reason = "") {
  console.log(`  [SKIP] ${label}${reason ? ` (${reason})` : ""}`);
  skipped++;
}

async function waitForServer(baseUrl, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.status > 0) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for runtime to start.");
}

async function main() {
  if (String(process.env.CI || "").trim().toLowerCase() === "true" &&
      String(process.env.FORCE_ROUTE_RUNTIME_TESTS || "").trim().toLowerCase() !== "true") {
    section("route-level runtime");
    skip("runtime spawn-based route checks", "skipped by default in CI; set FORCE_ROUTE_RUNTIME_TESTS=true to enable");
    console.log(`\n${"-".repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    console.log("ROUTE TESTS SKIPPED");
    process.exit(0);
  }

  const port = 18180;
  const baseUrl = `http://127.0.0.1:${port}`;
  const apiKey = "route_test_key";
  const runtimeCwd = fileURLToPath(new URL(".", import.meta.url));
  let child;

  try {
    child = spawn(process.execPath, ["server.js"], {
      cwd: runtimeCwd,
      env: {
        ...process.env,
        PORT: String(port),
        BACKEND_API_KEY: apiKey,
        QUEUE_WORKER_ENABLED: "FALSE",
        REDIS_URL: "redis://127.0.0.1:6399"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (err) {
    if (err?.code === "EPERM") {
      section("route-level runtime");
      skip("runtime spawn-based route checks", "child process spawning is blocked in this environment");
      console.log(`\n${"-".repeat(50)}`);
      console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
      console.log("ROUTE TESTS SKIPPED");
      process.exit(0);
    }
    throw err;
  }

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => {
    stdout += String(chunk || "");
  });
  child.stderr.on("data", chunk => {
    stderr += String(chunk || "");
  });

  try {
    await Promise.race([
      waitForServer(baseUrl),
      new Promise((_, reject) => {
        child.once("exit", code => {
          reject(
            new Error(
              `Runtime exited before becoming healthy (code ${code}).` +
              `${stderr.trim() ? ` stderr: ${stderr.trim()}` : ""}` +
              `${stdout.trim() ? ` stdout: ${stdout.trim()}` : ""}`
            )
          );
        });
      })
    ]);

    section("health route");

    const health = await fetch(`${baseUrl}/health`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(3000)
    });
    const healthBody = await health.json();

    assert("GET /health returns 200", health.status === 200, `got ${health.status}`);
    assert("health reports ok true", healthBody.ok === true, JSON.stringify(healthBody));
    assert("health reports degraded when Redis is unavailable", healthBody.status === "degraded", JSON.stringify(healthBody));
    assert("health reports worker disabled", healthBody?.dependencies?.worker?.enabled === false, JSON.stringify(healthBody?.dependencies?.worker || {}));
    assert("health reports queue disconnected", healthBody?.dependencies?.queue?.connected === false, JSON.stringify(healthBody?.dependencies?.queue || {}));

    section("jobs route");

    const jobsRes = await fetch(`${baseUrl}/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        parent_action_key: "http_generic_api",
        endpoint_key: "github_git_blob_chunk_read",
        owner: "verify-test-owner",
        repo: "verify-test-repo",
        file_sha: "0000000000000000000000000000000000000000",
        byte_offset: 0,
        length: 32,
        async: true
      }),
      signal: AbortSignal.timeout(5000)
    });
    const jobsBody = await jobsRes.json();

    assert("POST /jobs returns 503 when queue unavailable", jobsRes.status === 503, `got ${jobsRes.status}`);
    assert("POST /jobs returns queue_unavailable code", jobsBody?.error?.code === "queue_unavailable", JSON.stringify(jobsBody));

    section("site-migrate route");

    const migrateRes = await fetch(`${baseUrl}/site-migrate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        transport: "wordpress_connector",
        migration: { apply: false, publish_status: "draft" },
        source: { provider_domain: "https://source.example.com" },
        destination: { provider_domain: "https://dest.example.com", target_key: "route_test_target" }
      }),
      signal: AbortSignal.timeout(5000)
    });
    const migrateBody = await migrateRes.json();

    assert("POST /site-migrate returns 503 when queue unavailable", migrateRes.status === 503, `got ${migrateRes.status}`);
    assert("POST /site-migrate returns queue_unavailable code", migrateBody?.error?.code === "queue_unavailable", JSON.stringify(migrateBody));
  } finally {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => child.once("exit", resolve));
    }
    if (stdout.trim()) {
      console.log(`\nCaptured stdout:\n${stdout.trim()}`);
    }
    if (stderr.trim()) {
      console.log(`\nCaptured stderr:\n${stderr.trim()}`);
    }
  }

  console.log(`\n${"-".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
  if (failed === 0) {
    console.log("ALL ROUTE TESTS PASS");
    process.exit(0);
  }

  console.error(`${failed} TEST(S) FAILED`);
  process.exit(1);
}

await main();
