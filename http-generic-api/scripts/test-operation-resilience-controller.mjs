import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createOperationResilienceController,
  resetOperationResilienceState,
  _testingOperationResilienceController,
} from "../operationResilienceController.js";

const {
  consumeRateLimit,
  checkCircuit,
  recordCircuitOutcome,
  principalIdentity,
  operationIdentity,
} = _testingOperationResilienceController;

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
      this.headers[String(name).toLowerCase()] = String(value);
    },
    json(payload) {
      this.payload = payload;
      this.headersSent = true;
      this.emit("finish");
      return this;
    },
  });
}

resetOperationResilienceState();

assert.equal(
  principalIdentity({ auth: { mode: "user_jwt", tenant_id: "tenant-a", user_id: "user-a" } }),
  "tenant:tenant-a:user:user-a",
);
assert.equal(
  operationIdentity({ method: "POST", body: { operation_key: "ci_diagnose" } }),
  "repo.ci.diagnose",
);

{
  const args = {
    principal: "tenant:t:user:u",
    operationKey: "repo.ci.diagnose",
    limit: 2,
    windowMs: 1_000,
    redisClient: null,
    maxEntries: 100,
  };
  const first = await consumeRateLimit({ ...args, now: 0 });
  const second = await consumeRateLimit({ ...args, now: 1 });
  const third = await consumeRateLimit({ ...args, now: 2 });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.retry_after_seconds, 1);
}

resetOperationResilienceState();

{
  const operationKey = "repo.change.execute";
  const common = {
    operationKey,
    threshold: 2,
    cooldownMs: 5_000,
    redisClient: null,
    maxEntries: 100,
  };
  assert.equal(
    (await checkCircuit({
      operationKey,
      now: 0,
      cooldownMs: 5_000,
      redisClient: null,
      maxEntries: 100,
    })).allowed,
    true,
  );
  await recordCircuitOutcome({ ...common, statusCode: 503, now: 1 });
  const opened = await recordCircuitOutcome({ ...common, statusCode: 503, now: 2 });
  assert.equal(opened.state, "open");

  const denied = await checkCircuit({
    operationKey,
    now: 3,
    cooldownMs: 5_000,
    redisClient: null,
    maxEntries: 100,
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.state, "open");

  const probe = await checkCircuit({
    operationKey,
    now: 5_002,
    cooldownMs: 5_000,
    redisClient: null,
    maxEntries: 100,
  });
  assert.equal(probe.allowed, true);
  assert.equal(probe.state, "half_open_probe");

  const secondProbe = await checkCircuit({
    operationKey,
    now: 5_003,
    cooldownMs: 5_000,
    redisClient: null,
    maxEntries: 100,
  });
  assert.equal(secondProbe.allowed, false);
  assert.equal(secondProbe.state, "half_open");

  await recordCircuitOutcome({ ...common, statusCode: 200, now: 5_004 });
  const closed = await checkCircuit({
    operationKey,
    now: 5_005,
    cooldownMs: 5_000,
    redisClient: null,
    maxEntries: 100,
  });
  assert.equal(closed.allowed, true);
  assert.equal(closed.state, "closed");
}

resetOperationResilienceState();

{
  let currentTime = 10_000;
  const middleware = createOperationResilienceController({
    redisClient: null,
    now: () => currentTime,
    rateLimitRead: 1,
    rateLimitMutation: 1,
    rateWindowMs: 1_000,
    circuitFailureThreshold: 2,
    circuitCooldownMs: 5_000,
    localEntryLimit: 100,
  });
  const req = {
    method: "POST",
    originalUrl: "/tenant/operations/ci-diagnose",
    headers: { "x-request-id": "req-rate-limit" },
    auth: { mode: "user_jwt", tenant_id: "tenant-a", user_id: "user-a" },
    body: { operation_key: "repo.ci.diagnose" },
  };

  const firstRes = fakeResponse();
  let firstNext = 0;
  await middleware(req, firstRes, () => { firstNext += 1; });
  assert.equal(firstNext, 1);
  firstRes.status(200).json({ ok: true, secrets_included: false });

  currentTime += 1;
  const secondRes = fakeResponse();
  let secondNext = 0;
  await middleware(req, secondRes, () => { secondNext += 1; });
  assert.equal(secondNext, 0);
  assert.equal(secondRes.statusCode, 429);
  assert.equal(secondRes.payload.error.code, "OPERATION_RATE_LIMITED");
  assert.equal(secondRes.headers["retry-after"], "1");
  assert.equal(secondRes.payload.secrets_included, false);
}

console.log("operation resilience controller tests passed");
