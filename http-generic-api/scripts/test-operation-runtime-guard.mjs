import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createOperationRuntimeErrorHandler,
  createOperationRuntimeGuard,
  _testingOperationRuntimeGuard,
} from "../operationRuntimeGuard.js";

function fakeResponse() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    statusCode: 200,
    headersSent: false,
    headers: {},
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    json(payload) {
      this.payload = payload;
      this.headersSent = true;
      this.emit("finish");
      return this;
    },
    send(payload) {
      this.payload = payload;
      this.headersSent = true;
      this.emit("finish");
      return this;
    },
  });
}

function harness(req, options = {}) {
  let timeoutHandler = null;
  let timeoutMs = null;
  let cleared = false;
  const res = fakeResponse();
  const guard = createOperationRuntimeGuard({
    createRequestId: () => "generated-request-id",
    setTimer(handler, ms) {
      timeoutHandler = handler;
      timeoutMs = ms;
      return { id: 1 };
    },
    clearTimer() {
      cleared = true;
    },
    ...options,
  });
  let nextCalled = false;
  guard(req, res, () => {
    nextCalled = true;
  });
  return {
    res,
    get timeoutHandler() { return timeoutHandler; },
    get timeoutMs() { return timeoutMs; },
    get cleared() { return cleared; },
    get nextCalled() { return nextCalled; },
  };
}

function errorHandlerHarness(error, req = { headers: {}, body: {} }) {
  const res = fakeResponse();
  let forwardedError = null;
  const loggerEntries = [];
  const handler = createOperationRuntimeErrorHandler({
    createRequestId: () => "generated-error-request-id",
    logger: {
      warn(message, context) {
        loggerEntries.push({ message, context });
      },
    },
  });
  handler(error, req, res, (forwarded) => {
    forwardedError = forwarded;
  });
  return { res, loggerEntries, get forwardedError() { return forwardedError; } };
}

assert.equal(
  _testingOperationRuntimeGuard.resolveBudget({
    body: { operation_key: "repo.ci.diagnose" },
  }).max_elapsed_ms,
  20000,
);
assert.equal(_testingOperationRuntimeGuard.resolveBudget({ body: {} }).enforce_budget, false);

{
  const run = harness({
    headers: { "x-request-id": "req-timeout" },
    body: { operation_key: "repo.ci.diagnose" },
  });
  assert.equal(run.nextCalled, true);
  assert.equal(run.timeoutMs, 20000);
  run.timeoutHandler();
  assert.equal(run.res.statusCode, 503);
  assert.equal(run.res.payload.error.code, "OPERATION_TIMEOUT");
  assert.equal(run.res.payload.error.requestId, "req-timeout");
  assert.equal(run.res.payload.error.retryable, true);
  assert.equal(run.res.payload.error.details.retryable, true);
}

{
  const run = harness({
    headers: {},
    body: { operation_key: "platform.surface.inspect" },
  });
  run.res.json({ payload: "x".repeat(25000) });
  assert.equal(run.res.statusCode, 503);
  assert.equal(run.res.payload.error.code, "OPERATION_RESPONSE_BUDGET_EXCEEDED");
  assert.equal(run.res.payload.error.retryable, false);
  assert.equal(run.res.payload.error.details.retryable, false);
}

for (const [statusCode, expectedCode] of [
  [502, "OPERATION_BAD_GATEWAY"],
  [503, "OPERATION_DEPENDENCY_UNAVAILABLE"],
  [504, "OPERATION_GATEWAY_TIMEOUT"],
  [522, "OPERATION_UPSTREAM_CONNECTION_TIMEOUT"],
  [524, "OPERATION_UPSTREAM_RESPONSE_TIMEOUT"],
]) {
  const run = harness({
    headers: {},
    body: { operation_key: "repo.ci.diagnose" },
  });
  run.res.status(statusCode).send("<html>upstream secret-like body</html>");
  assert.equal(run.res.statusCode, statusCode);
  assert.equal(run.res.payload.error.code, expectedCode);
  assert.equal(run.res.payload.error.retryable, true);
  assert.equal(run.res.payload.error.requestId, "req_generated-request-id");
  assert.equal(run.res.payload.error.details.upstream_status, statusCode);
  assert.equal(JSON.stringify(run.res.payload).includes("secret-like body"), false);
  assert.equal(run.res.payload.secrets_included, false);
}

{
  const run = harness({
    headers: { "x-correlation-id": "corr-structured" },
    body: { operation_key: "repo.ci.diagnose" },
  });
  run.res.status(503).json({
    error: {
      code: "UPSTREAM_RATE_LIMITED",
      message: "The upstream service is temporarily unavailable.",
      details: { provider: "example" },
    },
  });
  assert.equal(run.res.statusCode, 503);
  assert.equal(run.res.payload.error.code, "UPSTREAM_RATE_LIMITED");
  assert.equal(run.res.payload.error.requestId, "corr-structured");
  assert.equal(run.res.payload.error.retryable, true);
  assert.equal(run.res.payload.error.details.retryable, true);
}

{
  const run = harness({
    headers: {},
    body: { operation_key: "repo.ci.diagnose" },
  });
  run.res.send("ok");
  assert.equal(run.res.statusCode, 200);
  assert.equal(run.res.payload, "ok");
  assert.equal(run.cleared, true);
  assert.equal(run.res.headers["x-request-id"], "req_generated-request-id");
  assert.ok(Number(run.res.headers["x-operation-response-bytes"]) > 0);
}
{
  const run = harness({ headers: {}, body: {} });
  assert.equal(run.timeoutHandler, null);
  run.res.send("unregistered route response");
  assert.equal(run.res.statusCode, 200);
  assert.equal(run.res.payload, "unregistered route response");
  assert.equal(run.res.headers["x-operation-response-bytes"], undefined);
}
{
  const run = harness({ headers: {}, body: {} });
  assert.equal(run.timeoutHandler, null);
  run.res.status(503).send("<html>generic upstream failure</html>");
  assert.equal(run.res.statusCode, 503);
  assert.equal(run.res.payload.error.code, "OPERATION_DEPENDENCY_UNAVAILABLE");
  assert.equal(run.res.payload.error.retryable, true);
  assert.equal(run.res.payload.error.details.operation_key, null);
  assert.equal(JSON.stringify(run.res.payload).includes("generic upstream failure"), false);
}

{
  const run = errorHandlerHarness(
    Object.assign(new Error("sensitive timeout details"), {
      code: "ETIMEDOUT",
      stack: "sensitive stack trace",
    }),
    {
      headers: { "x-request-id": "req-transport-timeout" },
      body: { operation_key: "repo.ci.diagnose" },
    },
  );
  assert.equal(run.res.statusCode, 504);
  assert.equal(run.res.payload.error.code, "OPERATION_GATEWAY_TIMEOUT");
  assert.equal(run.res.payload.error.requestId, "req-transport-timeout");
  assert.equal(run.res.payload.error.retryable, true);
  assert.equal(run.res.payload.error.details.transport_code, "ETIMEDOUT");
  assert.equal(JSON.stringify(run.res.payload).includes("sensitive"), false);
  assert.equal(run.loggerEntries.length, 1);
  assert.equal(JSON.stringify(run.loggerEntries).includes("sensitive"), false);
}

{
  const run = errorHandlerHarness(Object.assign(new Error("connection reset"), {
    code: "ECONNRESET",
  }));
  assert.equal(run.res.statusCode, 503);
  assert.equal(run.res.payload.error.code, "OPERATION_DEPENDENCY_UNAVAILABLE");
  assert.equal(run.res.payload.error.details.transport_code, "ECONNRESET");
}

{
  const originalError = new Error("programmer failure");
  const run = errorHandlerHarness(originalError);
  assert.equal(run.res.headersSent, false);
  assert.equal(run.forwardedError, originalError);
}

{
  const { readFile } = await import("node:fs/promises");
  const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
  const jsonMiddlewareIndex = serverSource.indexOf("app.use(express.json({");
  const runtimeGuardIndex = serverSource.indexOf("app.use(createOperationRuntimeGuard());");
  const routesIndex = serverSource.indexOf("registerRoutes(app, {");
  const errorHandlerIndex = serverSource.indexOf("app.use(createOperationRuntimeErrorHandler());");

  assert.ok(runtimeGuardIndex >= 0, "server must mount the operation runtime guard");
  assert.ok(errorHandlerIndex >= 0, "server must mount the operation runtime error handler");
  assert.ok(jsonMiddlewareIndex < runtimeGuardIndex, "runtime guard must follow JSON parsing");
  assert.ok(runtimeGuardIndex < routesIndex, "runtime guard must be mounted before routes");
  assert.ok(routesIndex < errorHandlerIndex, "runtime error handler must be mounted after routes");
}

console.log("operation runtime guard tests passed");
