import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
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
  });
}

function harness(req, options = {}) {
  let timeoutHandler = null;
  let timeoutMs = null;
  let cleared = false;
  const res = fakeResponse();
  const guard = createOperationRuntimeGuard({
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

assert.equal(
  _testingOperationRuntimeGuard.resolveBudget({
    body: { operation_key: "repo.ci.diagnose" },
  }).max_elapsed_ms,
  20000,
);

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
}

{
  const run = harness({
    headers: {},
    body: { operation_key: "platform.surface.inspect" },
  });
  run.res.json({ payload: "x".repeat(25000) });
  assert.equal(run.res.statusCode, 503);
  assert.equal(run.res.payload.error.code, "OPERATION_RESPONSE_BUDGET_EXCEEDED");
  assert.equal(run.res.payload.error.details.retryable, false);
}

{
  const run = harness({
    headers: {},
    body: { operation_key: "repo.ci.diagnose" },
  });
  run.res.status(503).json("<html>upstream unavailable</html>");
  assert.equal(run.res.statusCode, 503);
  assert.equal(run.res.payload.error.code, "OPERATION_DEPENDENCY_UNAVAILABLE");
  assert.equal(run.res.payload.secrets_included, false);
}

{
  const run = harness({
    headers: {},
    body: { operation_key: "repo.ci.diagnose" },
  });
  run.res.json({ ok: true, secrets_included: false });
  assert.equal(run.res.statusCode, 200);
  assert.equal(run.res.payload.ok, true);
  assert.equal(run.cleared, true);
  assert.ok(Number(run.res.headers["x-operation-response-bytes"]) > 0);
}

console.log("operation runtime guard tests passed");
