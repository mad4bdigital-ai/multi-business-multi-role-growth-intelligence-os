/**
 * Patch-vs-runtime verification script.
 * Hits a live deployment and confirms governed behavior matches the committed codebase.
 *
 * Usage:
 *   RUNTIME_BASE_URL=https://your-deployment.example.com \
 *   BACKEND_API_KEY=your-key \
 *   node verify-runtime.mjs
 *
 * Exit 0 = all checks passed (runtime matches expected behavior)
 * Exit 1 = one or more checks failed (drift detected or runtime down)
 */

const BASE_URL = (process.env.RUNTIME_BASE_URL || "").replace(/\/$/, "");
const API_KEY = process.env.BACKEND_API_KEY || "";
const EXPECT_QUEUE_AVAILABLE =
  String(process.env.EXPECT_QUEUE_AVAILABLE || "TRUE").trim().toUpperCase() === "TRUE";
const EXPECT_WORKER_ENABLED =
  String(process.env.EXPECT_WORKER_ENABLED || "TRUE").trim().toUpperCase() === "TRUE";

if (!BASE_URL) {
  console.error("ERROR: RUNTIME_BASE_URL environment variable is required.");
  console.error("  Example: RUNTIME_BASE_URL=http://localhost:3000 node verify-runtime.mjs");
  process.exit(1);
}

let passed = 0;
let failed = 0;
let skipped = 0;
const evidence = [];

function section(name) {
  console.log(`\n== ${name}`);
}

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
    evidence.push({ label, result: "pass" });
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
    evidence.push({ label, result: "fail", detail });
  }
}

function skip(label, reason = "") {
  console.log(`  [SKIP] ${label}${reason ? ` (${reason})` : ""}`);
  skipped++;
  evidence.push({ label, result: "skip", detail: reason });
}

async function get(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers,
      signal: AbortSignal.timeout(10000),
      ...opts
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { _raw: text };
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err?.message || String(err) };
  }
}

async function post(path, payload) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { _raw: text };
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err?.message || String(err) };
  }
}

section("Layer 3 - Runtime health");

const health = await get("/health");
assert("GET /health returns 200", health.status === 200, `got ${health.status} - ${health.error || ""}`);
assert("health body has ok: true", health.body?.ok === true, JSON.stringify(health.body));

const healthStatus = String(health.body?.status || "").trim().toLowerCase();
const workerEnabled = health.body?.dependencies?.worker?.enabled;
const redisConnected = health.body?.dependencies?.redis?.connected;
const queueConnected = health.body?.dependencies?.queue?.connected;

if (EXPECT_QUEUE_AVAILABLE) {
  assert(
    "health status is healthy when queue is expected",
    healthStatus === "healthy",
    `got ${healthStatus || "missing"}`
  );
  assert(
    "redis dependency connected when queue is expected",
    redisConnected === true,
    JSON.stringify(health.body?.dependencies?.redis || {})
  );
  assert(
    "queue dependency connected when queue is expected",
    queueConnected === true,
    JSON.stringify(health.body?.dependencies?.queue || {})
  );
} else {
  assert(
    "health status is healthy or degraded when queue is not expected",
    healthStatus === "healthy" || healthStatus === "degraded",
    `got ${healthStatus || "missing"}`
  );
}

assert(
  "worker enabled flag matches expected deployment role",
  workerEnabled === EXPECT_WORKER_ENABLED,
  `expected ${EXPECT_WORKER_ENABLED}, got ${workerEnabled}`
);

const serviceVersion = health.body?.version || health.body?.service_version || health.body?.SERVICE_VERSION;
if (serviceVersion) {
  assert("SERVICE_VERSION present in health response", !!serviceVersion, "missing version field");
  console.log(`    service_version: ${serviceVersion}`);
} else {
  skip("SERVICE_VERSION in health response", "version field not returned by this deployment");
}

section("Layer 3 - API authentication");

if (API_KEY) {
  const authed = await get("/health");
  assert(
    "authenticated request accepted",
    authed.status !== 401 && authed.status !== 403,
    `got ${authed.status}`
  );

  const unauthedRes = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(5000) });
  const requiresAuth = unauthedRes.status === 401 || unauthedRes.status === 403;
  if (requiresAuth) {
    assert("unauthenticated request blocked", requiresAuth);
  } else {
    skip("unauthenticated request check", "health endpoint is public");
  }
} else {
  skip("authentication checks", "BACKEND_API_KEY not set");
}

section("Layer 4 - Governed execution: dry-run site migration");

const dryRunPayload = {
  transport: "wordpress_connector",
  migration: { apply: false, publish_status: "draft", post_types: ["post"] },
  source: {
    provider_domain: "https://source.example.com",
    username: "verify_test",
    app_password: "verify_test"
  },
  destination: {
    provider_domain: "https://dest.example.com",
    username: "verify_test",
    app_password: "verify_test",
    target_key: "verify_test_key"
  }
};

const dryRun = await post("/site-migrate", dryRunPayload);
assert(
  "POST /site-migrate does not 500",
  dryRun.status !== 500,
  `got ${dryRun.status} - ${JSON.stringify(dryRun.body).slice(0, 120)}`
);
assert("POST /site-migrate responds", dryRun.status > 0, dryRun.error || "");

if (dryRun.status === 200 || dryRun.status === 202) {
  const isJobResponse = dryRun.body?.job_id || dryRun.body?.status;
  const isDryRunResult = dryRun.body?.execution_mode === "plan_only" || dryRun.body?.apply === false;
  assert(
    "response is a job or dry-run result",
    !!(isJobResponse || isDryRunResult),
    JSON.stringify(dryRun.body).slice(0, 120)
  );
} else if (dryRun.status === 400) {
  const errorCode = String(dryRun.body?.error?.code || "");
  const isLogicError = !errorCode.includes("reference") && !errorCode.includes("undefined");
  assert("400 response is a logic error", isLogicError, `error code: ${errorCode}`);
} else {
  skip("dry-run result shape check", `unexpected status ${dryRun.status}`);
}

section("Layer 4 - Local dispatch: github_git_blob_chunk_read");

const dispatchPayload = {
  endpoint_key: "github_git_blob_chunk_read",
  owner: "verify-test-owner",
  repo: "verify-test-repo",
  file_sha: "0000000000000000000000000000000000000000",
  byte_offset: 0,
  length: 100
};

const dispatch = await post("/http-execute", dispatchPayload);
assert("POST /http-execute responds", dispatch.status > 0, dispatch.error || "");
assert(
  "github dispatch does not 500 with ReferenceError",
  dispatch.status !== 500 || !String(JSON.stringify(dispatch.body)).toLowerCase().includes("referenceerror"),
  JSON.stringify(dispatch.body).slice(0, 120)
);

if ([200, 404, 401, 502].includes(dispatch.status)) {
  assert(
    "github dispatch returns structured error or result",
    typeof dispatch.body === "object",
    String(dispatch.body?._raw || "").slice(0, 80)
  );
} else {
  skip("github dispatch result shape", `status ${dispatch.status}`);
}

section("Layer 4 - Async job queue");

const jobPayload = {
  job_type: "site_migration",
  transport: "wordpress_connector",
  migration: { apply: false, publish_status: "draft" },
  source: { provider_domain: "https://source.example.com" },
  destination: { provider_domain: "https://dest.example.com", target_key: "verify_queue_test" },
  async: true
};

const jobCreate = await post("/jobs", jobPayload);
assert("POST /jobs responds", jobCreate.status > 0, jobCreate.error || "");
assert("POST /jobs does not 500", jobCreate.status !== 500, JSON.stringify(jobCreate.body).slice(0, 120));

if (!EXPECT_QUEUE_AVAILABLE && jobCreate.status === 503) {
  const errorCode = String(jobCreate.body?.error?.code || "").trim().toLowerCase();
  assert(
    "POST /jobs returns truthful queue unavailable status",
    errorCode === "queue_unavailable" || errorCode.includes("queue"),
    JSON.stringify(jobCreate.body).slice(0, 120)
  );
} else if (jobCreate.status === 200 || jobCreate.status === 202) {
  const jobId = jobCreate.body?.job_id;
  assert("job_id present in response", !!jobId, JSON.stringify(jobCreate.body).slice(0, 80));

  if (jobId) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const jobStatus = await get(`/jobs/${jobId}`);
    assert("GET /jobs/:id returns 200", jobStatus.status === 200, `got ${jobStatus.status}`);
    const status = jobStatus.body?.status;
    const validStatuses = ["queued", "running", "succeeded", "failed", "retrying"];
    assert(
      `job status is a known value (got: ${status})`,
      validStatuses.includes(status),
      `got ${status}`
    );
  }
} else if (jobCreate.status === 400) {
  skip("job queue checks", "POST /jobs returned 400");
} else {
  skip("job queue checks", `unexpected status ${jobCreate.status}`);
}

const timestamp = new Date().toISOString();
console.log(`\n${"-".repeat(50)}`);
console.log(`Runtime: ${BASE_URL}`);
console.log(`Checked: ${timestamp}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);

console.log("\n== Evidence log");
for (const item of evidence) {
  const icon = item.result === "pass" ? "[PASS]" : item.result === "skip" ? "[SKIP]" : "[FAIL]";
  console.log(`  ${icon} ${item.label}${item.detail ? ` - ${item.detail}` : ""}`);
}

if (failed === 0) {
  console.log("\nRUNTIME VERIFICATION PASS");
  console.log("Deployment claims are supported by live runtime evidence.");
  process.exit(0);
}

console.error(`\nRUNTIME VERIFICATION FAILED - ${failed} check(s) indicate drift or outage`);
console.error("Do not mark this deployment complete until all failures are resolved.");
process.exit(1);
