import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateDevDbStatus,
  unauthenticatedHeartbeatRequestOptions,
} from "./scripts/dev-autopilot-smoke.mjs";

assert.deepEqual(
  evaluateDevDbStatus({
    health: { db_connected: true },
    dbStatus: { status: 200, ok: true },
  }),
  { directStatusOk: true, policyGoverned: false, passed: true },
);

assert.deepEqual(
  evaluateDevDbStatus({
    health: { db_connected: true },
    dbStatus: { status: 403, ok: false, error_code: "dev_db_status_not_allowed" },
  }),
  { directStatusOk: false, policyGoverned: true, passed: true },
);

assert.equal(
  evaluateDevDbStatus({
    health: { db_connected: false },
    dbStatus: { status: 403, ok: false, error_code: "dev_db_status_not_allowed" },
  }).passed,
  false,
);

assert.deepEqual(unauthenticatedHeartbeatRequestOptions(), {
  method: "POST",
  timeout_ms: 60000,
});
assert.equal("body" in unauthenticatedHeartbeatRequestOptions(), false);
assert.equal("headers" in unauthenticatedHeartbeatRequestOptions(), false);

const connectorRoutes = readFileSync(
  new URL("./routes/connectorAgentRoutes.js", import.meta.url),
  "utf8",
);
assert(connectorRoutes.includes('import { fileURLToPath } from "node:url";'));
assert(connectorRoutes.includes("const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));"));
assert(connectorRoutes.includes('const ROOT = path.resolve(MODULE_DIR, "..");'));
assert(!connectorRoutes.includes("const ROOT = process.cwd();"));

const approvalOpenApi = readFileSync(
  new URL("./openapi/agent-skill-grant-approvals.yaml", import.meta.url),
  "utf8",
);
assert(approvalOpenApi.includes('description: "Agent, skill, or request not found"'));
assert(approvalOpenApi.includes('description: "Approval lifecycle, scope, idempotency, or readback conflict"'));
assert(!approvalOpenApi.includes("description: Agent, skill, or request not found"));
assert(!approvalOpenApi.includes("description: Approval lifecycle, scope, idempotency, or readback conflict"));

console.log("post merge gate repair tests passed");
