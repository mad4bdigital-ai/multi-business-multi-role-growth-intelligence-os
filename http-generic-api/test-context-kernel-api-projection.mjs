import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ContextApplicationError } from "./contextKernel/application/index.js";
import {
  CONTEXT_KERNEL_ROUTE_BINDINGS,
  ContextApiValidationError,
  createContextKernelController,
  createContextKernelRouter,
  mapContextKernelError,
  paginateCandidates,
  projectContextResolution,
  validateCandidatePageQuery,
  validateContextResolutionRequest,
} from "./contextKernel/api/index.js";

function captureThrown(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  assert.fail("Expected operation to throw.");
}

function createResponse() {
  return {
    statusCode: null,
    body: undefined,
    sent: false,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return value;
    },
    send(value) {
      this.sent = true;
      this.body = value;
      return value;
    },
    end() {
      this.sent = true;
      return undefined;
    },
  };
}

const validationError = captureThrown(() => validateContextResolutionRequest({
  operationIntent: "resolve_workspace",
  unsupported: true,
}));
assert.ok(validationError instanceof ContextApiValidationError);
assert.equal(validationError.code, "VALIDATION_ERROR");
assert.equal(validationError.status, 400);
assert.deepEqual(validationError.details, [
  { field: "body.unsupported", issue: "unsupported field" },
]);

const validatedRequest = validateContextResolutionRequest({
  operationIntent: " resolve_workspace ",
  explicitContext: {
    tenantRef: " tenant-a ",
    workspaceRef: " workspace-a ",
  },
  riskClass: "read",
});
assert.deepEqual(validatedRequest, {
  operationIntent: "resolve_workspace",
  explicitContext: {
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
  },
  pinRef: null,
  riskClass: "read",
});
assert.throws(() => {
  validatedRequest.operationIntent = "changed";
}, TypeError);

assert.deepEqual(validateCandidatePageQuery({}), { limit: 25, cursor: null });
assert.deepEqual(validateCandidatePageQuery({ candidateLimit: "2" }), { limit: 2, cursor: null });
assert.ok(captureThrown(() => validateCandidatePageQuery({ candidateLimit: "101" })) instanceof ContextApiValidationError);

const candidates = [
  {
    candidateType: "connection",
    stableRef: "candidate-c",
    displayLabel: "Candidate C",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    connectionRef: "connection-c",
    metadata: {
      appKey: "wordpress",
      actionGrantRef: "grant-c",
      accessToken: "remove-me",
      secret: "remove-me",
      arbitraryInternalValue: "remove-me",
    },
  },
  {
    candidateType: "workspace_resource_grant",
    stableRef: "candidate-a",
    displayLabel: "Candidate A",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    metadata: {
      authoritySource: "membership_default",
      permission: "admin",
    },
  },
  {
    candidateType: "workspace_resource_grant",
    stableRef: "candidate-b",
    displayLabel: "Candidate B",
    tenantRef: "tenant-a",
    workspaceRef: "workspace-b",
    metadata: {
      authoritySource: "explicit_grant",
      permission: "read",
    },
  },
];

const firstPage = paginateCandidates(candidates, { limit: 2 });
assert.deepEqual(firstPage.items.map((candidate) => candidate.stableRef), ["candidate-a", "candidate-b"]);
assert.equal(firstPage.page.limit, 2);
assert.equal(firstPage.page.hasMore, true);
assert.equal(typeof firstPage.page.nextCursor, "string");

const secondPage = paginateCandidates(candidates, {
  limit: 2,
  cursor: firstPage.page.nextCursor,
});
assert.deepEqual(secondPage.items.map((candidate) => candidate.stableRef), ["candidate-c"]);
assert.equal(secondPage.page.hasMore, false);
assert.equal(secondPage.page.nextCursor, null);
assert.ok(captureThrown(() => paginateCandidates(candidates, { limit: 2, cursor: "invalid" })) instanceof ContextApiValidationError);

const resolutionFixture = {
  resolutionId: "resolution-a",
  status: "interpretation_required",
  reasonCodes: ["candidate_selection_required", "candidate_selection_required"],
  contextRevision: "revision-a",
  contextHash: "a".repeat(64),
  selectedContext: {
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
  },
  candidates,
  authorityScope: {
    tenantRef: "tenant-a",
    role: "owner",
  },
  capabilityReadiness: {
    capabilityKey: "wordpress.post.publish",
    runtimeStatus: "active",
    operationClass: "mutation",
    riskClass: "high",
    dispatchAllowed: true,
    applyAllowed: false,
    hardBlockCount: 0,
    manifestHash: "manifest-a",
    manifestVersion: 4,
    credentialPayload: "remove-me",
  },
  automaticWritePerformed: false,
  secretsIncluded: false,
};

const tenantProjection = projectContextResolution(resolutionFixture, {
  viewMode: "tenant",
  limit: 2,
});
assert.equal(tenantProjection.status, "interpretation_required");
assert.equal(tenantProjection.candidates.length, 2);
assert.equal(tenantProjection.candidatePage.hasMore, true);
assert.equal(Object.hasOwn(tenantProjection, "authorityScope"), false);
assert.equal(Object.hasOwn(tenantProjection, "capabilityReadiness"), false);
assert.equal(Object.hasOwn(tenantProjection, "diagnostics"), false);
for (const candidate of tenantProjection.candidates) {
  assert.equal(Object.hasOwn(candidate, "tenantRef"), false);
  assert.equal(Object.hasOwn(candidate, "workspaceRef"), false);
  assert.equal(Object.hasOwn(candidate, "metadata"), false);
}

const adminProjection = projectContextResolution(resolutionFixture, {
  viewMode: "admin",
  limit: 100,
});
assert.equal(adminProjection.candidates.length, 3);
assert.equal(adminProjection.authorityScope.role, "owner");
assert.equal(adminProjection.capabilityReadiness.dispatchAllowed, true);
assert.equal(adminProjection.capabilityReadiness.applyAllowed, false);
assert.equal(Object.hasOwn(adminProjection.capabilityReadiness, "credentialPayload"), false);
assert.deepEqual(adminProjection.diagnostics, {
  automaticWritePerformed: false,
  secretsIncluded: false,
});
const adminConnection = adminProjection.candidates.find((candidate) => candidate.stableRef === "candidate-c");
assert.equal(adminConnection.metadata.appKey, "wordpress");
assert.equal(adminConnection.metadata.actionGrantRef, "grant-c");
assert.equal(Object.hasOwn(adminConnection.metadata, "accessToken"), false);
assert.equal(Object.hasOwn(adminConnection.metadata, "secret"), false);
assert.equal(Object.hasOwn(adminConnection.metadata, "arbitraryInternalValue"), false);

const mappedApplicationError = mapContextKernelError(new ContextApplicationError(
  "context_revision_mismatch",
  "The context revision changed.",
  409,
  {
    credentialRef: "credential-a",
    accessToken: "remove-me",
    secretsIncluded: false,
  },
), { requestId: "request-a" });
assert.equal(mappedApplicationError.status, 409);
assert.equal(mappedApplicationError.body.error.code, "context_revision_mismatch");
assert.equal(mappedApplicationError.body.error.requestId, "request-a");
assert.equal(mappedApplicationError.body.error.details[0].credentialRef, "credential-a");
assert.equal(mappedApplicationError.body.error.details[0].secretsIncluded, false);
assert.equal(Object.hasOwn(mappedApplicationError.body.error.details[0], "accessToken"), false);

const capturedCalls = [];
const operations = {
  async createContextResolution(input) {
    capturedCalls.push(["createContextResolution", input]);
    return resolutionFixture;
  },
  async getContextResolution(input) {
    capturedCalls.push(["getContextResolution", input]);
    return resolutionFixture;
  },
  async createContextPin(input) {
    capturedCalls.push(["createContextPin", input]);
    return {
      pinId: "pin-a",
      resolutionId: "resolution-a",
      scope: "workflow",
      status: "active",
      contextRevision: "revision-a",
    };
  },
  async deleteContextPin(input) {
    capturedCalls.push(["deleteContextPin", input]);
  },
  async createExecutionContext(input) {
    capturedCalls.push(["createExecutionContext", input]);
    return {
      contextId: "context-a",
      contextHash: "b".repeat(64),
      planHash: "c".repeat(64),
      status: "ready",
      readiness: {
        contextReady: true,
        operationReady: true,
        blockingGaps: [],
      },
    };
  },
  async validateExecutionContext(input) {
    capturedCalls.push(["validateExecutionContext", input]);
    return {
      valid: true,
      reasonCodes: [],
      contextRevision: "revision-a",
    };
  },
};

const principalContext = {
  principal: { principalType: "tenant_user", principalRef: "user-a" },
  effectiveSubject: { tenantRef: "tenant-a", subjectRef: "user-a" },
};
const controller = createContextKernelController({
  operations,
  resolvePrincipalContext() {
    return principalContext;
  },
  resolveViewMode() {
    return "tenant";
  },
});

const createRequest = {
  body: {
    operationIntent: "resolve_workspace",
    riskClass: "read",
  },
  query: { candidateLimit: "2" },
  headers: { "idempotency-key": "idempotency-a" },
  requestId: "request-controller-a",
};
const createResponseResult = createResponse();
await controller.createContextResolution(createRequest, createResponseResult);
assert.equal(createResponseResult.statusCode, 201);
assert.equal(createResponseResult.body.resolutionId, "resolution-a");
assert.equal(createResponseResult.body.candidates.length, 2);
assert.equal(capturedCalls[0][0], "createContextResolution");
assert.deepEqual(capturedCalls[0][1], {
  input: {
    operationIntent: "resolve_workspace",
    explicitContext: null,
    pinRef: null,
    riskClass: "read",
  },
  page: { limit: 2, cursor: null },
  idempotencyKey: "idempotency-a",
  principalContext,
});
assert.equal(Object.hasOwn(capturedCalls[0][1], "req"), false);

const invalidRequest = {
  body: {
    operationIntent: "resolve_workspace",
    rawCredential: "remove-me",
  },
  query: {},
  requestId: "request-invalid-a",
};
const invalidResponse = createResponse();
await controller.createContextResolution(invalidRequest, invalidResponse);
assert.equal(invalidResponse.statusCode, 400);
assert.equal(invalidResponse.body.error.code, "VALIDATION_ERROR");
assert.equal(invalidResponse.body.error.requestId, "request-invalid-a");
assert.equal(JSON.stringify(invalidResponse.body).includes("remove-me"), false);

const registeredRoutes = [];
function Router() {
  const router = {};
  for (const method of ["get", "post", "delete"]) {
    router[method] = (routePath, handler) => {
      registeredRoutes.push([method, routePath, handler]);
      return router;
    };
  }
  return router;
}
createContextKernelRouter({ Router, controller });
assert.deepEqual(
  registeredRoutes.map(([method, routePath]) => [method, routePath]),
  CONTEXT_KERNEL_ROUTE_BINDINGS.map(([method, routePath]) => [method, routePath]),
);
assert.equal(registeredRoutes.length, 6);

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const routesIndex = await readFile(path.join(currentDirectory, "routes", "index.js"), "utf8");
assert.doesNotMatch(routesIndex, /contextKernel|context-kernel/i, "Phase 5 routes must remain unmounted.");

const openapi = await readFile(path.join(currentDirectory, "openapi", "context-kernel.yaml"), "utf8");
assert.match(openapi, /^openapi: 3\.1\.0/m);
assert.match(openapi, /^x-runtime-mounted: false/m);
for (const operationId of [
  "createContextResolution",
  "getContextResolution",
  "createContextPin",
  "deleteContextPin",
  "createExecutionContext",
  "validateExecutionContext",
]) {
  assert.match(openapi, new RegExp(`operationId: ${operationId}`));
}
assert.match(openapi, /name: candidateLimit/);
assert.match(openapi, /maximum: 100/);
assert.match(openapi, /ErrorEnvelope:/);
assert.match(openapi, /bearerAuth:/);
assert.doesNotMatch(openapi, /unknownOutcome|reconcileUnknownOutcome/i);

console.log("context kernel API projection contract tests passed");
