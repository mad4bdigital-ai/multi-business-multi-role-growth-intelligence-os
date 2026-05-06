/**
 * Live scoped-subdomain smoke checks.
 *
 * This is opt-in because it reaches deployed hosts.
 * Run with:
 *   LIVE_SCOPED_SMOKE=TRUE BACKEND_API_KEY=... node test-live-scoped-subdomains.mjs
 */

const ENABLED = String(process.env.LIVE_SCOPED_SMOKE || "").trim().toUpperCase() === "TRUE";
const API_KEY = process.env.BACKEND_API_KEY || "";
const TIMEOUT_MS = Number(process.env.LIVE_SCOPED_SMOKE_TIMEOUT_MS || 10000);

const SCOPES = [
  {
    scope: "runtime",
    baseUrl: "https://api.mad4b.com",
    publicPaths: ["/", "/health", "/status", "/privacy-policy"],
    authenticatedPaths: ["/activation/session-context"]
  },
  {
    scope: "identity",
    baseUrl: "https://identity.mad4b.com",
    publicPaths: ["/", "/privacy-policy"],
    authenticatedPaths: ["/users"]
  },
  {
    scope: "customers",
    baseUrl: "https://customers.mad4b.com",
    publicPaths: ["/", "/privacy-policy"],
    authenticatedPaths: ["/customers"]
  },
  {
    scope: "systems",
    baseUrl: "https://systems.mad4b.com",
    publicPaths: ["/", "/privacy-policy"],
    authenticatedPaths: ["/workspaces"]
  },
  {
    scope: "logic",
    baseUrl: "https://logic.mad4b.com",
    publicPaths: ["/", "/privacy-policy"],
    authenticatedPaths: ["/logic-definitions"]
  },
  {
    scope: "observability",
    baseUrl: "https://observability.mad4b.com",
    publicPaths: ["/", "/privacy-policy"],
    authenticatedPaths: ["/status"]
  },
  {
    scope: "developer",
    baseUrl: "https://developer.mad4b.com",
    publicPaths: ["/", "/privacy-policy"],
    authenticatedPaths: ["/webhooks"]
  },
  {
    scope: "admin-cli",
    baseUrl: "https://dev.mad4b.com",
    publicPaths: ["/", "/privacy-policy"],
    authenticatedPaths: []
  },
  {
    scope: "ops",
    baseUrl: "https://ops.mad4b.com",
    publicPaths: ["/", "/privacy-policy"],
    authenticatedPaths: ["/release/readiness"]
  },
  {
    scope: "status",
    baseUrl: "https://status.mad4b.com",
    publicPaths: ["/", "/status.html", "/privacy-policy"],
    authenticatedPaths: []
  }
];

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(label) {
  console.log(`  [PASS] ${label}`);
  passed++;
}

function fail(label, detail = "") {
  console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
  failed++;
}

function skip(label, reason = "") {
  console.log(`  [SKIP] ${label}${reason ? ` (${reason})` : ""}`);
  skipped++;
}

async function request(url, headers = {}) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  return { status: response.status, contentType, text };
}

function isJsonOrHtml(contentType) {
  return contentType.includes("application/json") || contentType.includes("text/html");
}

if (!ENABLED) {
  skip("live scoped subdomain smoke", "set LIVE_SCOPED_SMOKE=TRUE to run");
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(0);
}

for (const scope of SCOPES) {
  console.log(`\n== ${scope.scope} (${scope.baseUrl})`);

  for (const path of scope.publicPaths) {
    try {
      const result = await request(`${scope.baseUrl}${path}`);
      if (result.status >= 200 && result.status < 500) {
        pass(`${path} returns non-5xx`);
      } else {
        fail(`${path} returns non-5xx`, `status ${result.status}`);
      }
      if (isJsonOrHtml(result.contentType)) {
        pass(`${path} returns JSON or HTML`);
      } else {
        fail(`${path} returns JSON or HTML`, result.contentType);
      }
    } catch (error) {
      fail(`${path} reachable`, error.message);
    }
  }

  for (const path of scope.authenticatedPaths) {
    if (!API_KEY) {
      skip(`${path} authenticated smoke`, "BACKEND_API_KEY not set");
      continue;
    }

    try {
      const result = await request(`${scope.baseUrl}${path}`, {
        Authorization: `Bearer ${API_KEY}`
      });
      if (result.status !== 404) {
        pass(`${path} is mounted`);
      } else {
        fail(`${path} is mounted`, "status 404");
      }
      if (result.status < 500) {
        pass(`${path} avoids 5xx`);
      } else {
        fail(`${path} avoids 5xx`, `status ${result.status}`);
      }
    } catch (error) {
      fail(`${path} reachable`, error.message);
    }
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) process.exit(1);
console.log("LIVE SCOPED SUBDOMAIN SMOKE PASS");
