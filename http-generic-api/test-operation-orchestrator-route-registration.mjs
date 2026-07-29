import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildOperationOrchestratorRoutes,
  _testingOperationOrchestratorRoutes,
} from "./routes/operationOrchestratorRoutes.js";

const routesIndex = await readFile(new URL("./routes/index.js", import.meta.url), "utf8");

assert.match(
  routesIndex,
  /import \{ buildOperationOrchestratorRoutes \} from "\.\/operationOrchestratorRoutes\.js";/,
  "the operation orchestrator route builder must be imported by the route registry",
);
assert.match(
  routesIndex,
  /app\.use\(buildOperationOrchestratorRoutes\(\{ \.\.\.deps, requireAdminPrincipal \}\)\);/,
  "the operation orchestrator routes must be mounted by registerRoutes",
);

assert.throws(
  () => buildOperationOrchestratorRoutes(),
  (error) => error?.code === "OPERATION_ROUTE_SECURITY_MIDDLEWARE_REQUIRED",
  "operation routes must fail closed when security middleware is absent",
);

const passThrough = (_req, _res, next) => next();
const router = buildOperationOrchestratorRoutes({
  requireBackendApiKey: passThrough,
  requireAdminPrincipal: passThrough,
});
assert.equal(typeof router, "function");

const { operationLifecycleNeedsAttention } = _testingOperationOrchestratorRoutes;
assert.equal(operationLifecycleNeedsAttention({ workerResult: { status: "cleanup_failed" } }), true);
assert.equal(operationLifecycleNeedsAttention({ lifecycleResult: { status: "consume_failed" } }), true);
assert.equal(operationLifecycleNeedsAttention({ ownership: { status: "unavailable" } }), true);
assert.equal(operationLifecycleNeedsAttention({ artifactRegistry: { status: "unavailable" } }), true);
assert.equal(
  operationLifecycleNeedsAttention({
    workerResult: { status: "released" },
    lifecycleResult: { status: "consumed" },
    ownership: { recorded: true },
    artifactRegistry: { recorded: true },
  }),
  false,
);

console.log("operation orchestrator route registration tests passed");
