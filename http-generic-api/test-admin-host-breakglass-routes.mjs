import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { buildAdminHostBreakglassRoutes } from "./routes/adminHostBreakglassRoutes.js";
// frontend-surface-operation: GET /admin/runtime-bootstrap/catalog
// frontend-surface-operation: POST /admin/runtime-bootstrap/plan
// frontend-surface-operation: POST /admin/runtime-bootstrap/runs
// frontend-surface-operation: GET /admin/runtime-bootstrap/runs/{correlation_id}
const SHA = "b".repeat(40);
const TICKET_HASH = "f".repeat(64);
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


test("admin host-local inspection run reaches the host-side executor without GitHub dispatch", async () => {
  let receivedPlan;
  const app = express();
  app.use(express.json());
  app.use(buildAdminHostBreakglassRoutes({
    requireBackendApiKey: guard,
    requireAdminPrincipal: admin,
    broker: {
      hostLocalExecutor: async (plan) => {
        receivedPlan = plan;
        return {
          ok: true,
          status: "host_local_inspection_complete",
          mode: "dry_run",
          operation: "read_only",
          target_source: "host_local_role_env",
          migration: null,
          migration_selected: false,
          migration_selection: "full_inspection_catalog",
          database_connection_performed: true,
          database_mutation_performed: false,
          migration_apply_performed: false,
          grant_mutation_performed: false,
          workflow_dispatch_performed: false,
          secrets_included: false,
        };
      },
    },
  }));
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/admin/runtime-bootstrap/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "key" },
      body: JSON.stringify({
        environment_key: "production_hostinger_autodeploy",
        operation_key: "database.inspect",
        runbook_key: "database.full_inspection",
        action: "dry_run",
        expected_sha: SHA,
        target_source: "host_local_role_env",
        target_key: "production-runtime",
      }),
    });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.status, "host_local_inspection_complete");
    assert.equal(body.target_source, "host_local_role_env");
    assert.equal(body.database_connection_performed, true);
    assert.equal(body.database_mutation_performed, false);
    assert.equal(body.workflow_dispatch_performed, false);
    assert.equal(receivedPlan.operation_key, "database.inspect");
    assert.equal(receivedPlan.runbook_key, "database.full_inspection");
    assert.equal(receivedPlan.action, "dry_run");
    assert.equal(receivedPlan.migration, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Production selected-role apply replaces caller proof with the durable server-resolved artifact proof", async () => {
  const durableProof = {
    contract: "mad4b.host-breakglass-role-selection-proof.v1",
    source: "durable_full_inspection",
    expected_sha: SHA,
    target_key: "production-runtime",
    correlation_id: "inspection-correlation-001",
    workflow_run_id: "12345",
    inspection_run_id: "run:github:12345",
    inspection_evidence_hash: "1".repeat(64),
    finding_ids: [`finding:${"2".repeat(32)}`],
    selected_roles: ["runtime_persistence"],
    role_object_count_fingerprints: { runtime_persistence: "3".repeat(64) },
    composite_target_fingerprint: "4".repeat(64),
    role_database_object_counts: { runtime_persistence: { total: 0 } },
    role_database_object_classifications: { runtime_persistence: "zero_objects" },
    database_mutation_performed: false,
    secrets_included: false,
  };
  const { computeRoleSelectionProofHash } = await import("./roleSelectionProof.js");
  durableProof.selection_hash = computeRoleSelectionProofHash(durableProof);
  let resolverInput;
  const app = express();
  app.use(express.json());
  app.use(buildAdminHostBreakglassRoutes({
    requireBackendApiKey: guard,
    requireAdminPrincipal: admin,
    broker: {
      resolveDurableRoleSelectionProof: async (input) => { resolverInput = structuredClone(input); return durableProof; },
      dispatchHostBreakglassPlan: undefined,
    },
  }));
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/admin/runtime-bootstrap/plan`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "key" },
      body: JSON.stringify({
        environment_key: "production_hostinger_autodeploy",
        operation_key: "database.rebuild_empty",
        runbook_key: "database.empty_rebuild",
        action: "apply_migration",
        expected_sha: SHA,
        target_key: "production-runtime",
        execution_ticket_id: "ticket:production-rebuild-route-001",
        execution_ticket_hash: TICKET_HASH,
        role_selection_proof: { inspection_run_id: "run:github:12345", selected_roles: ["governance"], source: "caller_claim" },
        confirmation: `APPLY_HOSTINGER_RUNTIME_BASELINE_REBUILD:${SHA}:production-runtime:runtime_persistence`,
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.selected_rebuild_roles, ["runtime_persistence"]);
    assert.equal(body.role_selection_proof.source, "durable_full_inspection");
    assert.equal(body.role_selection_proof.inspection_run_id, "run:github:12345");
    assert.equal(resolverInput.role_selection_proof.source, "caller_claim");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Production selected-role apply fails closed when durable proof resolution is unavailable", async () => {
  const app = express();
  app.use(express.json());
  app.use(buildAdminHostBreakglassRoutes({
    requireBackendApiKey: guard,
    requireAdminPrincipal: admin,
    broker: {
      resolveDurableRoleSelectionProof: async () => { const error = new Error("missing artifact"); error.status = 503; error.code = "host_breakglass_role_selection_provenance_unavailable"; throw error; },
    },
  }));
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/admin/runtime-bootstrap/plan`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "key" },
      body: JSON.stringify({
        operation_key: "database.rebuild_empty",
        action: "apply_migration",
        expected_sha: SHA,
        target_key: "production-runtime",
        role_selection_proof: { inspection_run_id: "run:github:999" },
      }),
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "host_breakglass_role_selection_provenance_unavailable");
    assert.equal(body.database_mutation_performed, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
