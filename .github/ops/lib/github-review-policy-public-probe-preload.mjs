import assert from "node:assert/strict";

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 2000;
const MAX_RETRY_AFTER_MS = 10000;
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const GOVERNED_PUBLIC_PROBE_PATHS = new Set(["/health", "/version", "/deployment-info"]);

const sleepDefault = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requestUrl(input) {
  if (typeof input === "string" || input instanceof URL) return new URL(String(input));
  if (input && typeof input.url === "string") return new URL(input.url);
  return null;
}

function requestMethod(input, init = {}) {
  return String(init?.method || input?.method || "GET").trim().toUpperCase();
}

function isGovernedPublicProbe(input, init = {}) {
  const url = requestUrl(input);
  return Boolean(
    url &&
    requestMethod(input, init) === "GET" &&
    url.protocol === "https:" &&
    url.hostname === "auth.mad4b.com" &&
    GOVERNED_PUBLIC_PROBE_PATHS.has(url.pathname)
  );
}

function retryAfterMs(response, fallbackMs) {
  const raw = String(response?.headers?.get?.("retry-after") || "").trim();
  if (!raw) return fallbackMs;
  if (/^\d+$/.test(raw)) return Math.min(Number(raw) * 1000, MAX_RETRY_AFTER_MS);
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return fallbackMs;
  return Math.min(Math.max(0, at - Date.now()), MAX_RETRY_AFTER_MS);
}

async function discardIntermediateResponse(response) {
  try {
    await response?.arrayBuffer?.();
  } catch {
    // The response is being discarded before a bounded retry.
  }
}

export function createGovernedPublicProbeFetch({
  fetchImpl,
  sleep = sleepDefault,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
} = {}) {
  assert.equal(typeof fetchImpl, "function", "fetchImpl must be a function");
  assert.ok(Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 8, "maxAttempts must be between 1 and 8");
  assert.ok(Number.isFinite(retryDelayMs) && retryDelayMs >= 0 && retryDelayMs <= MAX_RETRY_AFTER_MS, "retryDelayMs is out of bounds");

  let probeQueue = Promise.resolve();

  const fetchGovernedProbe = async (input, init = {}) => {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchImpl(input, init);
        const transient = TRANSIENT_HTTP_STATUSES.has(Number(response?.status || 0));
        if (!transient || attempt === maxAttempts) return response;
        await discardIntermediateResponse(response);
        await sleep(retryAfterMs(response, retryDelayMs));
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts) throw error;
        await sleep(retryDelayMs);
      }
    }
    throw lastError || new Error("Governed public probe exhausted retries");
  };

  return function governedPublicProbeFetch(input, init = {}) {
    if (!isGovernedPublicProbe(input, init)) return fetchImpl(input, init);
    const task = probeQueue.then(() => fetchGovernedProbe(input, init));
    probeQueue = task.then(() => undefined, () => undefined);
    return task;
  };
}

export function installGovernedPublicProbeFetch(options = {}) {
  const originalFetch = options.fetchImpl || globalThis.fetch;
  const wrapped = createGovernedPublicProbeFetch({ ...options, fetchImpl: originalFetch });
  globalThis.fetch = wrapped;
  return Object.freeze({
    contract: "github_review_policy_public_probe_preload.v1",
    serialized: true,
    transient_statuses: [...TRANSIENT_HTTP_STATUSES],
    max_attempts: options.maxAttempts || DEFAULT_MAX_ATTEMPTS,
    retry_delay_ms: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    secrets_included: false,
  });
}

async function selfTest() {
  const calls = [];
  const active = { count: 0, max: 0 };
  const attempts = new Map();
  const fakeFetch = async (input) => {
    const url = requestUrl(input);
    active.count += 1;
    active.max = Math.max(active.max, active.count);
    calls.push(url?.pathname || "unknown");
    const key = url?.pathname || "unknown";
    const attempt = (attempts.get(key) || 0) + 1;
    attempts.set(key, attempt);
    await Promise.resolve();
    active.count -= 1;
    if (key === "/health" && attempt === 1) return new Response('{"ok":false}', { status: 429 });
    return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
  };
  const wrapped = createGovernedPublicProbeFetch({
    fetchImpl: fakeFetch,
    sleep: async () => {},
    maxAttempts: 3,
    retryDelayMs: 0,
  });
  const [health, version, deployment] = await Promise.all([
    wrapped("https://auth.mad4b.com/health"),
    wrapped("https://auth.mad4b.com/version"),
    wrapped("https://auth.mad4b.com/deployment-info"),
  ]);
  assert.equal(health.status, 200);
  assert.equal(version.status, 200);
  assert.equal(deployment.status, 200);
  assert.equal(attempts.get("/health"), 2);
  assert.equal(active.max, 1, "governed parity probes must be serialized");
  assert.deepEqual(calls, ["/health", "/health", "/version", "/deployment-info"]);

  const passthroughCalls = [];
  const passthrough = createGovernedPublicProbeFetch({
    fetchImpl: async (input) => {
      passthroughCalls.push(String(input));
      return new Response("{}", { status: 503 });
    },
    sleep: async () => {},
    maxAttempts: 3,
    retryDelayMs: 0,
  });
  const unrelated = await passthrough("https://auth.mad4b.com/connector-agent/version");
  assert.equal(unrelated.status, 503);
  assert.equal(passthroughCalls.length, 1, "non-parity endpoints must remain untouched");
  console.log(JSON.stringify({
    ok: true,
    contract: "github_review_policy_public_probe_preload.v1",
    serialized: true,
    bounded_retry: true,
    unrelated_fetch_passthrough: true,
    secrets_included: false,
  }));
}

const directSelfTest = process.argv.includes("--self-test");
if (directSelfTest) {
  await selfTest();
} else {
  installGovernedPublicProbeFetch();
}
