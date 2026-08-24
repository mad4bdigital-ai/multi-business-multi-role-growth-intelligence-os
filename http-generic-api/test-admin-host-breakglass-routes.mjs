import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { buildAdminHostBreakglassRoutes } from "./routes/adminHostBreakglassRoutes.js";
// frontend-surface-operation: GET /admin/runtime-bootstrap/catalog
// frontend-surface-operation: POST /admin/runtime-bootstrap/plan
// frontend-surface-operation: POST /admin/runtime-bootstrap/runs
// frontend-surface-operation: GET /admin/runtime-bootstrap/runs/{correlation_id}
const SHA = "b".repeat(40);
function guard(req, res, next) { if (req.headers["x-api-key"] !== "key") return res.status(401).json({ ok: false }); req.auth = { mode: "backend_api_key", is_admin: true }; next(); }
function admin(req, res, next) { return req.auth?.is_admin ? next() : res.status(403).json({ ok: false }); }
test("admin catalog and plan remain reachable without database dependencies", async () => {
  const app = express(); app.use(express.json()); app.use(buildAdminHostBreakglassRoutes({ requireBackendApiKey: guard, requireAdminPrincipal: admin }));
  const server = app.listen(0); const port = server.address().port;
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/admin/runtime-bootstrap/catalog`)).status, 401);
    const catalog = await (await fetch(`http://127.0.0.1:${port}/admin/runtime-bootstrap/catalog`, { headers: { "x-api-key": "key" } })).json();
    assert.equal(catalog.database_independent, true);
    const response = await fetch(`http://127.0.0.1:${port}/admin/runtime-bootstrap/plan`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "key" }, body: JSON.stringify({ operation_key: "database.inspect", action: "plan", expected_sha: SHA }) });
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.database_independent_control_plane, true);
    assert.equal(body.database_mutation_performed, false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
