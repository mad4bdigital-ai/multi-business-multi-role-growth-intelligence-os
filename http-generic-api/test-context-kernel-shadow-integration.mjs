import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildResourceApiShadowEvidence,
  createResourceApiContextShadowMiddleware,
} from "./contextKernel/integration/index.js";
import { buildResourceApiRoutes } from "./routes/resourceApiRoutes.js";

class FakeResponse extends EventEmitter {
  constructor(statusCode = 200) {
    super();
    this.statusCode = statusCode;
  }
}

function createControllerProxy() {
  return new Proxy({}, {
    get(target, property) {
      if (!target[property]) {
        target[property] = function resourceApiControllerHandler(_req, _res) {};
      }
      return target[property];
    },
  });
}

async function runScheduled(queue) {
  while (queue.length > 0) await queue.shift()();
}

const brandEvidence = buildResourceApiShadowEvidence({
  auth: { mode: "user_jwt", user_id: "user-a", tenant_id: "tenant-a" },
  params: { tenant_id: "tenant-a", resourceKey: "brands", resourceId: "brand-a" },
});
assert.equal(brandEvidence.brandScoped, true);
assert.equal(brandEvidence.resourceType, "brand");
assert.equal(brandEvidence.resourceRef, "brand-a");
assert.equal(brandEvidence.routeKey, "tenant_resource_get");
assert.equal(brandEvidence.operationIntent, "resource_item_read");
assert.equal(brandEvidence.resolutionInput.explicitRef, "brand-a");
assert.equal(brandEvidence.resolutionInput.operationKind, "read");
assert.equal(brandEvidence.resolutionInput.riskClass, "read");
assert.equal(brandEvidence.resolutionInput.allowLowRiskFallback, false);
assert.deepEqual(brandEvidence.resolutionInput.principal.authorizedTenantRefs, ["tenant-a"]);

const collectionEvidence = buildResourceApiShadowEvidence({
  auth: { user_id: "user-a", tenant_id: "tenant-a" },
  params: { tenant_id: "tenant-a", resourceKey: "campaigns" },
});
assert.equal(collectionEvidence.routeKey, "tenant_resource_list");
assert.equal(collectionEvidence.resourceType, "campaigns");
assert.equal(collectionEvidence.resourceRef, null);
assert.equal(collectionEvidence.resolutionInput.explicitRef, null);

let disabledResolveCalls = 0;
const disabled = createResourceApiContextShadowMiddleware({
  enabled: false,
  resolutionService: { async resolve() { disabledResolveCalls += 1; } },
  emitTelemetry() { throw new Error("disabled telemetry must not run"); },
});
const disabledResponse = new FakeResponse();
let disabledNextCalls = 0;
disabled({}, disabledResponse, () => { disabledNextCalls += 1; });
disabledResponse.emit("finish");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(disabledNextCalls, 1);
assert.equal(disabledResponse.listenerCount("finish"), 0);
assert.equal(disabledResolveCalls, 0);

const scheduled = [];
const resolutionCalls = [];
const telemetryEvents = [];
let clockValue = 1000;
const middleware = createResourceApiContextShadowMiddleware({
  enabled: true,
  resolutionService: {
    async resolve(input) {
      resolutionCalls.push(input);
      return {
        status: "resolved",
        reasonCodes: [],
        candidates: [{ stableRef: "brand-a", resourceRef: "brand-a" }],
        selectedCandidate: { stableRef: "brand-a", resourceRef: "brand-a" },
      };
    },
  },
  async emitTelemetry(event) { telemetryEvents.push(event); },
  clock() { const value = clockValue; clockValue += 8; return value; },
  schedule(task) { scheduled.push(task); },
});
const response = new FakeResponse(206);
let nextCalls = 0;
middleware({
  auth: { user_id: "user-a", tenant_id: "tenant-a" },
  params: { tenant_id: "tenant-a", resourceKey: "brands", resourceId: "brand-a" },
  headers: { authorization: "Bearer must-not-leak" },
  body: { accessToken: "must-not-leak" },
}, response, () => { nextCalls += 1; });
assert.equal(nextCalls, 1);
assert.equal(resolutionCalls.length, 0);
assert.equal(telemetryEvents.length, 0);
assert.equal(response.statusCode, 206);
response.emit("finish");
assert.equal(resolutionCalls.length, 0, "finish must only schedule shadow work");
await runScheduled(scheduled);
assert.equal(resolutionCalls.length, 1);
assert.equal(response.statusCode, 206);
assert.equal(telemetryEvents.length, 1);
assert.deepEqual(telemetryEvents[0], {
  eventType: "context_kernel_resource_shadow",
  shadowMode: true,
  routeKey: "tenant_resource_get",
  operationIntent: "resource_item_read",
  tenantRef: "tenant-a",
  resourceType: "brand",
  resourceRef: "brand-a",
  brandScoped: true,
  legacyStatusCode: 206,
  durationMs: 8,
  providerDispatchPerformed: false,
  legacyResponseModified: false,
  secretsIncluded: false,
  outcome: "matched",
  kernelStatus: "resolved",
  reasonCodes: [],
  candidateCount: 1,
  selectedStableRef: "brand-a",
});
const serializedTelemetry = JSON.stringify(telemetryEvents[0]);
assert.equal(serializedTelemetry.includes("must-not-leak"), false);
assert.equal(serializedTelemetry.includes("user-a"), false);
assert.throws(() => { telemetryEvents[0].outcome = "changed"; }, TypeError);

const crossTenantQueue = [];
const crossTenantEvents = [];
let crossTenantResolveCalls = 0;
const crossTenant = createResourceApiContextShadowMiddleware({
  enabled: true,
  resolutionService: { async resolve() { crossTenantResolveCalls += 1; } },
  async emitTelemetry(event) { crossTenantEvents.push(event); },
  clock: () => 100,
  schedule(task) { crossTenantQueue.push(task); },
});
const crossTenantResponse = new FakeResponse(403);
crossTenant({
  auth: { user_id: "user-a", tenant_id: "tenant-a" },
  params: { tenant_id: "tenant-b", resourceKey: "campaigns", resourceId: "campaign-a" },
}, crossTenantResponse, () => {});
crossTenantResponse.emit("finish");
await runScheduled(crossTenantQueue);
assert.equal(crossTenantResolveCalls, 0);
assert.equal(crossTenantEvents[0].outcome, "cross_tenant_rejected");
assert.deepEqual(crossTenantEvents[0].reasonCodes, ["cross_tenant_scope_mismatch"]);
assert.equal(crossTenantEvents[0].legacyStatusCode, 403);

const failureQueue = [];
const failureEvents = [];
const failure = createResourceApiContextShadowMiddleware({
  enabled: true,
  resolutionService: {
    async resolve() {
      const error = new Error("provider details must not leak");
      error.code = "authorized_scope_not_found";
      throw error;
    },
  },
  async emitTelemetry(event) {
    failureEvents.push(event);
    throw new Error("telemetry outage must be isolated");
  },
  clock: () => 50,
  schedule(task) { failureQueue.push(task); },
});
const failureResponse = new FakeResponse(200);
failure({
  auth: { user_id: "user-a", tenant_id: "tenant-a" },
  params: { tenant_id: "tenant-a", resourceKey: "campaigns", resourceId: "campaign-a" },
}, failureResponse, () => {});
failureResponse.emit("finish");
await runScheduled(failureQueue);
assert.equal(failureEvents.length, 1);
assert.equal(failureEvents[0].outcome, "shadow_resolution_error");
assert.deepEqual(failureEvents[0].reasonCodes, ["authorized_scope_not_found"]);
assert.equal(JSON.stringify(failureEvents[0]).includes("provider details"), false);

const shadowMiddleware = function contextKernelResourceShadowMiddleware(_req, _res, next) { next(); };
const routerWithShadow = buildResourceApiRoutes({
  resourceApiService: {},
  resourceApiController: createControllerProxy(),
  contextKernelResourceShadowMiddleware: shadowMiddleware,
});
function routeStack(router, routePath, method) {
  const layer = router.stack.find((entry) => entry.route?.path === routePath && entry.route.methods?.[method]);
  assert.ok(layer, `${method.toUpperCase()} ${routePath} must be registered.`);
  return layer.route.stack.map((entry) => entry.handle);
}
for (const routePath of [
  "/me/workspaces/:tenant_id/resources",
  "/me/workspaces/:tenant_id/resources/:resourceKey",
  "/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId",
]) {
  const handlers = routeStack(routerWithShadow, routePath, "get");
  assert.equal(handlers.length, 3);
  assert.equal(handlers[1], shadowMiddleware);
}
const writeHandlers = routeStack(routerWithShadow, "/me/workspaces/:tenant_id/resources/:resourceKey", "post");
assert.equal(writeHandlers.includes(shadowMiddleware), false);
assert.equal(writeHandlers.length, 2);

const routerWithoutShadow = buildResourceApiRoutes({
  resourceApiService: {},
  resourceApiController: createControllerProxy(),
});
for (const routePath of [
  "/me/workspaces/:tenant_id/resources",
  "/me/workspaces/:tenant_id/resources/:resourceKey",
  "/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId",
]) {
  assert.equal(routeStack(routerWithoutShadow, routePath, "get").length, 2);
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const integrationSource = await readFile(
  path.join(currentDirectory, "contextKernel", "integration", "resourceApiShadow.js"),
  "utf8",
);
assert.doesNotMatch(integrationSource, /process\.env|\bfetch\s*\(|axios|mysql2|@google|@aws-sdk|openai/i);
assert.doesNotMatch(integrationSource, /authorization|cookie|accessToken|refreshToken|credentialPayload/i);
assert.match(integrationSource, /providerDispatchPerformed: false/);
assert.match(integrationSource, /legacyResponseModified: false/);

console.log("context kernel shadow integration tests passed");
