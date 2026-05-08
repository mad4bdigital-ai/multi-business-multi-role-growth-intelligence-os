/**
 * test-platform-routes.mjs
 *
 * HTTP smoke tests for platform route modules introduced in Sprints 02-09.
 * Tests input validation (400 responses — no DB call needed) and route
 * registration (route exists → status != 404, even if DB is unavailable → 500).
 *
 * Run: node test-platform-routes.mjs
 */

import assert from "node:assert/strict";
import express from "express";
import { buildTenantsRoutes }          from "./routes/tenantsRoutes.js";
import { buildAccessRoutes }           from "./routes/accessRoutes.js";
import { buildPlannerRoutes }          from "./routes/plannerRoutes.js";
import { buildConnectorRoutes }        from "./routes/connectorRoutes.js";
import { buildIdentityRoutes }         from "./routes/identityRoutes.js";
import { buildCustomerRoutes }         from "./routes/customerRoutes.js";
import { buildConnectedSystemsRoutes } from "./routes/connectedSystemsRoutes.js";
import { buildBootstrapRoutes }        from "./routes/bootstrapRoutes.js";
import { buildObservabilityRoutes }    from "./routes/observabilityRoutes.js";
import { buildStatusRoutes }           from "./routes/statusRoutes.js";
import { buildBatchRoutes }            from "./routes/batchRoutes.js";
import { buildHealthRoutes }           from "./routes/healthRoutes.js";
import { buildLegalRoutes }            from "./routes/legalRoutes.js";
import { buildRootDiscoveryRoutes }    from "./routes/rootDiscoveryRoutes.js";
import { buildSystemLayerRoutes }      from "./routes/systemLayerRoutes.js";

let passed = 0;
let failed = 0;

function ok(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}
function section(name) { console.log(`\n== ${name}`); }

// ── Build Express app with all tested routers ─────────────────────────────────

const DEPS = { requireBackendApiKey: (_req, _res, next) => next() };
const HEALTH_DEPS = {
  jobRepository: {
    values: () => [],
    size: () => 0,
  },
  normalizeJobStatus: (status) => status,
  getWaitingCountSafe: async () => ({ ok: true, count: 0 }),
  getRedisRuntimeStatus: () => ({ connected: true }),
  testDbConnection: async () => {},
  SERVICE_VERSION: "test",
  QUEUE_WORKER_ENABLED: false,
};

const app = express();
app.use(express.json());
app.use(buildRootDiscoveryRoutes());
app.use(buildHealthRoutes(HEALTH_DEPS));
app.use((req, _res, next) => {
  req.auth = { is_admin: true };
  next();
});
app.use(buildTenantsRoutes(DEPS));
app.use(buildAccessRoutes(DEPS));
app.use(buildPlannerRoutes(DEPS));
app.use(buildConnectorRoutes(DEPS));
app.use(buildIdentityRoutes(DEPS));
app.use(buildCustomerRoutes(DEPS));
app.use(buildConnectedSystemsRoutes(DEPS));
app.use(buildBootstrapRoutes(DEPS));
app.use(buildObservabilityRoutes(DEPS));
app.use(buildStatusRoutes(DEPS));
app.use(buildBatchRoutes(DEPS));
app.use(buildLegalRoutes(DEPS));
app.use(buildSystemLayerRoutes(DEPS));

const server = app.listen(0);
await new Promise(resolve => server.once("listening", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

async function post(path, body, query = "") {
  const res = await fetch(`${base}${path}${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function getWithHost(path, host) {
  const res = await fetch(`${base}${path}`, { headers: { "x-forwarded-host": host } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function postWithHost(path, host, body = {}) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-host": host },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function patch(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ── 1. POST /tenants — input validation ───────────────────────────────────────

section("GET / - scoped root discovery JSON");
{
  const checks = [
    ["admin.mad4b.com", "admin-cli", "/admin/control"],
    ["ops.mad4b.com", "ops", "/release/readiness"],
    ["logic.mad4b.com", "logic", "/logic-definitions"],
    ["identity.mad4b.com", "identity", "/users"],
    ["api.mad4b.com", "runtime", "/activation/session-context"],
  ];

  for (const [host, scope, expectedPath] of checks) {
    const r = await getWithHost("/", host);
    ok(`${host} root returns 200`, r.status === 200, `got ${r.status}`);
    ok(`${host} root has ok=true`, r.body.ok === true, `body: ${JSON.stringify(r.body)}`);
    ok(`${host} root scope is ${scope}`, r.body.scope === scope, `got ${r.body.scope}`);
    ok(`${host} root includes ${expectedPath}`, r.body.primary_paths?.includes(expectedPath), `body: ${JSON.stringify(r.body)}`);
  }
}

section("POST / - root discovery stays non-mutating JSON");
{
  const r = await postWithHost("/", "admin.mad4b.com", { accidental: true });
  ok("POST dev root returns 200 discovery", r.status === 200, `got ${r.status}`);
  ok("POST dev root points to /admin/control", r.body.primary_paths?.includes("/admin/control"), `body: ${JSON.stringify(r.body)}`);
}

section("POST /tenants — input validation");

{
  const r = await post("/tenants", {});
  ok("missing tenant_type → 400", r.status === 400, `got ${r.status}`);
  ok("missing tenant_type → code missing_fields", r.body.error?.code === "missing_fields",
    `got ${r.body.error?.code}`);
}
{
  const r = await post("/tenants", { tenant_type: "brand" });
  ok("missing display_name → 400", r.status === 400, `got ${r.status}`);
}
{
  const r = await post("/tenants", { tenant_type: "invalid_type", display_name: "X" });
  ok("invalid tenant_type → 400", r.status === 400, `got ${r.status}`);
  ok("invalid tenant_type → code invalid_tenant_type", r.body.error?.code === "invalid_tenant_type",
    `got ${r.body.error?.code}`);
}

section("POST /tenants — route registered");
{
  const r = await post("/tenants", { tenant_type: "brand", display_name: "Test Brand" });
  ok("valid input → not 404 (route registered)", r.status !== 404, `got ${r.status}`);
  ok("valid input → response has ok field", "ok" in r.body, `body: ${JSON.stringify(r.body)}`);
}

// ── 2. POST /access/resolve — input validation ────────────────────────────────

section("POST /access/resolve — input validation");

{
  const r = await post("/access/resolve", {});
  ok("missing tenant_id → 400", r.status === 400, `got ${r.status}`);
  ok("missing tenant_id → code missing_tenant_id", r.body.error?.code === "missing_tenant_id",
    `got ${r.body.error?.code}`);
}
{
  const r = await post("/access/resolve", { tenant_id: "t1", risk_level: "extreme" });
  ok("invalid risk_level → 400", r.status === 400, `got ${r.status}`);
  ok("invalid risk_level → code invalid_risk_level", r.body.error?.code === "invalid_risk_level",
    `got ${r.body.error?.code}`);
}

section("POST /access/resolve — route registered");
{
  const r = await post("/access/resolve", {
    tenant_id: "t1",
    user_id: "test_recheck_actor",
    risk_level: "low",
    intent_flags: ["public_scope"],
  });
  ok("valid input → not 404", r.status !== 404, `got ${r.status}`);
  ok("response has ok field", "ok" in r.body);
}

// ── 3. POST /planner/resolve-intent — input validation ───────────────────────

section("POST /planner/resolve-intent — input validation");

{
  const r = await post("/planner/resolve-intent", {});
  ok("missing tenant_id + raw_input → 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_fields", r.body.error?.code === "missing_fields");
}
{
  const r = await post("/planner/resolve-intent", { tenant_id: "t1" });
  ok("missing raw_input → 400", r.status === 400, `got ${r.status}`);
}
{
  const r = await post("/planner/resolve-intent", { raw_input: "publish a post" });
  ok("missing tenant_id → 400", r.status === 400, `got ${r.status}`);
}

section("POST /planner/resolve-intent — route registered");
{
  const r = await post("/planner/resolve-intent", { tenant_id: "t1", raw_input: "publish post" });
  ok("valid input → not 404", r.status !== 404, `got ${r.status}`);
}

// ── 4. POST /planner/create-plan — input validation ──────────────────────────

section("POST /planner/create-plan — input validation");

{
  const r = await post("/planner/create-plan", {});
  ok("missing tenant_id → 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_fields", r.body.error?.code === "missing_fields");
}

// ── 5. PATCH /planner/plans/:id/status — validation ──────────────────────────

section("PATCH /planner/plans/:id/status — input validation");

{
  const r = await patch("/planner/plans/test-plan-123/status", { status: "flying" });
  ok("invalid status → 400", r.status === 400, `got ${r.status}`);
  ok("code = invalid_status", r.body.error?.code === "invalid_status",
    `got ${r.body.error?.code}`);
}
{
  const r = await patch("/planner/plans/test-plan-123/status", { status: "validated" });
  ok("valid status → not 404 (route registered)", r.status !== 404, `got ${r.status}`);
}

// ── 6. POST /connector/dispatch — input validation ────────────────────────────

section("POST /connector/dispatch — input validation");

{
  const r = await post("/connector/dispatch", {});
  ok("missing plan_id and tenant_id → 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_fields", r.body.error?.code === "missing_fields",
    `got ${r.body.error?.code}`);
}

section("POST /connector/dispatch — route registered");
{
  const r = await post("/connector/dispatch", { plan_id: "00000000-0000-0000-0000-000000000001" });
  ok("plan_id provided → not 404 (route registered)", r.status !== 404, `got ${r.status}`);
  ok("response has ok field", "ok" in r.body);
}

// ── 7. GET /connector/dispatch/status/:run_id — route registration ────────────

section("GET /connector/dispatch/status/:run_id — route registered");

{
  const r = await get("/connector/dispatch/status/00000000-0000-0000-0000-999999999999");
  ok("not 404 (route registered)", r.status !== 404, `got ${r.status}`);
}

// ── 8. GET /connector/history — route registration ───────────────────────────

section("GET /connector/history — route registered");

{
  const r = await get("/connector/history?tenant_id=t1");
  ok("not 404 (route registered)", r.status !== 404, `got ${r.status}`);
}

section("Admin system layer connector facade");

{
  const r = await get("/admin/system/tools");
  ok("system tools returns 200", r.status === 200, `got ${r.status}`);
  ok("system tools exposes connector registry list", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "connector_registry_list"));
  ok("system tools exposes connector registry get", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "connector_registry_get"));
  ok("system tools exposes provider bootstrap chain", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "activation_provider_bootstrap_validate"));
  ok("system tools exposes Drive probe", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "activation_drive_probe"));
  ok("system tools exposes Sheets bootstrap read", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "activation_sheets_bootstrap_read"));
  ok("system tools exposes GitHub validation", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "activation_github_validate"));
  ok("system tools exposes bootstrap config upsert", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "activation_bootstrap_config_upsert"));
}
{
  const r = await post("/admin/system/tools/call", {});
  ok("system tool call validates name", r.status === 400, `got ${r.status}`);
  ok("system tool call missing name code", r.body.error?.code === "missing_tool_name", `got ${r.body.error?.code}`);
}
{
  const r = await get("/admin/system/connectors?status=flying");
  ok("system connector list validates status", r.status === 400, `got ${r.status}`);
  ok("system connector invalid status code", r.body.error?.code === "invalid_status", `got ${r.body.error?.code}`);
}
{
  const r = await get("/system/tools");
  ok("shared system tools returns 200", r.status === 200, `got ${r.status}`);
  ok("shared system tools exposes MCP facade protocol", r.body.protocol === "openapi-mcp-facade", `got ${r.body.protocol}`);
  ok("shared system tools exposes provider bootstrap chain to admin", Array.isArray(r.body.tools) && r.body.tools.some((tool) => tool.name === "activation_provider_bootstrap_validate"));
}
{
  const r = await post("/system/tools/call", {});
  ok("shared system tool call validates name", r.status === 400, `got ${r.status}`);
  ok("shared system tool call missing name code", r.body.error?.code === "missing_tool_name", `got ${r.body.error?.code}`);
}
{
  const r = await post("/admin/system/tools/call", {
    name: "activation_bootstrap_config_upsert",
    arguments: {}
  });
  ok("bootstrap config upsert validates required fields before DB write", r.status === 400, `got ${r.status}`);
  ok("bootstrap config upsert missing fields code", r.body.error?.code === "missing_required_activation_bootstrap_fields", `got ${r.body.error?.code}`);
}

// ── 9. GET /planner/plans/:id — route registration ───────────────────────────

section("GET /planner/plans/:id — route registered");

{
  const r = await get("/planner/plans/00000000-0000-0000-0000-000000000001");
  ok("not 404 (route registered)", r.status !== 404, `got ${r.status}`);
}

// ── 10. POST /planner/plans/:id/execute — route registration ─────────────────

section("POST /planner/plans/:id/execute — route registered");

{
  const r = await post("/planner/plans/00000000-0000-0000-0000-000000000001/execute", {});
  ok("not 404 (route registered)", r.status !== 404, `got ${r.status}`);
}

// ── 11. GET /tenants — route registered ──────────────────────────────────────

section("GET /tenants — route registered");

{
  const r = await get("/tenants");
  ok("not 404", r.status !== 404, `got ${r.status}`);
}

// ── 11a. GET /health — DB dependency visible ───────────────────────────────

section("GET /health — DB dependency visible");

{
  const r = await get("/health");
  ok("returns 200", r.status === 200, `got ${r.status}`);
  ok("reports DB connected", r.body?.dependencies?.db?.connected === true,
    JSON.stringify(r.body?.dependencies?.db || {}));
}

// ── 12. POST /customers — route registered ───────────────────────────────────

section("POST /customers — route registered");

{
  const r = await post("/customers", {});
  ok("not 404", r.status !== 404, `got ${r.status}`);
}

section("POST /tickets - Custom GPT subject compatibility");

{
  const r = await post("/tickets", {});
  ok("missing tenant_id + subject -> 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_fields", r.body.error?.code === "missing_fields");
}
{
  const r = await post("/tickets", { tenant_id: "t1", subject: "Custom GPT smoke ticket" });
  ok("subject-only ticket payload -> not 400 missing_fields", !(r.status === 400 && r.body.error?.code === "missing_fields"),
    `got ${r.status} ${JSON.stringify(r.body.error || {})}`);
  ok("subject-only ticket payload -> not 404", r.status !== 404, `got ${r.status}`);
}

// ── 13. GET /tenants/:id/connected-systems — route registered ────────────────

section("GET /tenants/:id/connected-systems — route registered");

{
  const r = await get("/tenants/t1/connected-systems");
  ok("not 404", r.status !== 404, `got ${r.status}`);
}

// ── 14. contacts — input validation + registration ────────────────────────────

section("POST /contacts — input validation");

{
  const r = await post("/contacts", {});
  ok("missing tenant_id + name → 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_fields", r.body.error?.code === "missing_fields");
}
{
  const r = await get("/customers/c1/contacts");
  ok("GET /customers/:id/contacts → not 404", r.status !== 404, `got ${r.status}`);
}

// ── 15. threads — input validation + registration ─────────────────────────────

section("POST /threads — input validation");

{
  const r = await post("/threads", {});
  ok("missing tenant_id + subject → 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_fields", r.body.error?.code === "missing_fields");
}
{
  const r = await get("/threads/t1");
  ok("GET /threads/:id → not 404", r.status !== 404, `got ${r.status}`);
}
{
  const r = await get("/tenants/t1/threads");
  ok("GET /tenants/:id/threads → not 404", r.status !== 404, `got ${r.status}`);
}

// ── 16. entitlements — input validation + registration ───────────────────────

section("POST /entitlements — input validation");

{
  const r = await post("/entitlements", {});
  ok("missing tenant_id + key → 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_fields", r.body.error?.code === "missing_fields");
}
{
  const r = await get("/tenants/t1/entitlements");
  ok("GET /tenants/:id/entitlements → not 404", r.status !== 404, `got ${r.status}`);
}

// ── 17. installations GET routes ──────────────────────────────────────────────

section("GET /installations/:id — route registered");

{
  const r = await get("/installations/00000000-0000-0000-0000-000000000001");
  ok("not 404", r.status !== 404, `got ${r.status}`);
}
{
  const r = await get("/tenants/t1/installations");
  ok("GET /tenants/:id/installations → not 404", r.status !== 404, `got ${r.status}`);
}

// ── 18. permission-grants — input validation + registration ───────────────────

section("POST /permission-grants — input validation");

{
  const r = await post("/permission-grants", {});
  ok("missing required fields → 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_fields", r.body.error?.code === "missing_fields");
}
{
  const r = await get("/installations/i1/permission-grants");
  ok("GET /installations/:id/permission-grants → not 404", r.status !== 404, `got ${r.status}`);
}

// ── 19. tracking workspaces — input validation + registration ─────────────────

section("POST /tracking/workspaces — input validation");

{
  const r = await post("/tracking/workspaces", {});
  ok("missing required fields → 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_fields", r.body.error?.code === "missing_fields");
}
{
  const r = await get("/tenants/t1/tracking/workspaces");
  ok("GET /tenants/:id/tracking/workspaces → not 404", r.status !== 404, `got ${r.status}`);
}
{
  const r = await get("/tracking/workspaces/w1");
  ok("GET /tracking/workspaces/:id → not 404", r.status !== 404, `got ${r.status}`);
}

// ── 20. tracked events — input validation + registration ──────────────────────

section("POST /tracking/events — input validation");

{
  const r = await post("/tracking/events", {});
  ok("missing tenant_id + event_type → 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_fields", r.body.error?.code === "missing_fields");
}
{
  const r = await get("/tracking/workspaces/w1/events");
  ok("GET /tracking/workspaces/:id/events → not 404", r.status !== 404, `got ${r.status}`);
}

// ── 21. reporting views — input validation + registration ─────────────────────

section("POST /reporting/views — input validation");

{
  const r = await post("/reporting/views", {});
  ok("missing required fields → 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_fields", r.body.error?.code === "missing_fields");
}
{
  const r = await get("/tenants/t1/reporting/views");
  ok("GET /tenants/:id/reporting/views → not 404", r.status !== 404, `got ${r.status}`);
}
{
  const r = await get("/reporting/views/v1");
  ok("GET /reporting/views/:id → not 404", r.status !== 404, `got ${r.status}`);
}

// ── 22. Status endpoints — public, no auth ────────────────────────────────────

section("GET /status — public JSON");

{
  const r = await get("/status");
  ok("returns 200 or 503", r.status === 200 || r.status === 503, `got ${r.status}`);
  ok("has status field", typeof r.body.status === "string", `body: ${JSON.stringify(r.body).slice(0,80)}`);
  ok("has components array", Array.isArray(r.body.components));
  ok("has 8 components", r.body.components?.length === 8, `got ${r.body.components?.length}`);
  ok("has updated_at", typeof r.body.updated_at === "string");
}

section("GET /status.html — HTML page");

{
  const res = await fetch(`${base}/status.html`);
  ok("returns 200", res.status === 200, `got ${res.status}`);
  ok("content-type is text/html", (res.headers.get("content-type") || "").includes("text/html"));
  const html = await res.text();
  ok("contains Components section", html.includes("Components"));
  ok("contains Status in title", html.includes("System Status"));
}

section("GET /status/incidents — incident history");

{
  const r = await get("/status/incidents?days=30");
  ok("returns 200 or 500", r.status === 200 || r.status === 500, `got ${r.status}`);
  if (r.status === 200) ok("has incidents array", Array.isArray(r.body.incidents));
}

// ── 23. POST /batch — validation ──────────────────────────────────────────────

section("POST /batch — input validation");

{
  const r = await post("/batch", {});
  ok("missing requests → 400", r.status === 400, `got ${r.status}`);
  ok("code = missing_requests", r.body.error?.code === "missing_requests");
}
{
  const r = await post("/batch", { requests: Array(51).fill({ method: "GET", path: "/status" }) });
  ok("51 requests → 400 batch_too_large", r.status === 400, `got ${r.status}`);
  ok("code = batch_too_large", r.body.error?.code === "batch_too_large");
}
{
  const r = await post("/batch", { requests: [{ method: "GET", path: "/batch" }] });
  ok("/batch in sub-request → 400 batch_loop", r.status === 400, `got ${r.status}`);
  ok("code = batch_loop", r.body.error?.code === "batch_loop");
}
{
  const r = await post("/batch", { requests: [{ method: "INVALID", path: "/status" }] });
  ok("invalid method → 400", r.status === 400, `got ${r.status}`);
}

section("POST /batch — execution");

{
  const r = await post("/batch", {
    requests: [
      { method: "GET", path: "/status" },
      { method: "GET", path: "/status/incidents" },
    ]
  });
  ok("2-request batch returns 200", r.status === 200, `got ${r.status}`);
  ok("results array has 2 entries", r.body.results?.length === 2, `got ${r.body.results?.length}`);
  ok("results[0].index === 0", r.body.results?.[0]?.index === 0);
  ok("results[1].index === 1", r.body.results?.[1]?.index === 1);
  ok("results have status field", typeof r.body.results?.[0]?.status === "number");
}

// ── Summary ───────────────────────────────────────────────────────────────────

section("GET /privacy-policy - public HTML page on scoped subdomains");

{
  const hosts = [
    "api.mad4b.com",
    "identity.mad4b.com",
    "customers.mad4b.com",
    "systems.mad4b.com",
    "logic.mad4b.com",
    "observability.mad4b.com",
    "developer.mad4b.com",
    "admin.mad4b.com",
    "ops.mad4b.com",
    "status.mad4b.com",
  ];

  for (const host of hosts) {
    const res = await fetch(`${base}/privacy-policy`, { headers: { "x-forwarded-host": host } });
    const html = await res.text();
    ok(`${host} privacy policy returns 200`, res.status === 200, `got ${res.status}`);
    ok(`${host} privacy policy is HTML`, (res.headers.get("content-type") || "").includes("text/html"));
    ok(`${host} privacy policy includes host`, html.includes(`Applies to ${host}`));
    ok(`${host} privacy policy includes title`, html.includes("<h1>Privacy Policy</h1>"));
  }
}

section("GET /terms-of-use - public HTML page");

{
  const res = await fetch(`${base}/terms-of-use`, { headers: { "x-forwarded-host": "auth.mad4b.com" } });
  const html = await res.text();
  ok("terms of use returns 200", res.status === 200, `got ${res.status}`);
  ok("terms of use is HTML", (res.headers.get("content-type") || "").includes("text/html"));
  ok("terms of use includes host", html.includes("Applies to auth.mad4b.com"));
  ok("terms of use links privacy policy", html.includes("/privacy-policy"));
}

server.close();

console.log(`\n── Results ──`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll tests passed.");
