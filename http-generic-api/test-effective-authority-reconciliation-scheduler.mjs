import assert from "node:assert/strict";
import {
  _testingEffectiveAuthorityReconciliationScheduler,
  createEffectiveAuthorityReconciliationScheduler,
} from "./src/application/effectiveAuthority/effectiveAuthorityReconciliationScheduler.js";

const disabled = createEffectiveAuthorityReconciliationScheduler({
  runReconciliation: async () => ({ status: "aligned" }),
  env: {},
}).start();
assert.equal(disabled.status, "disabled");
assert.equal(disabled.enabled, false);
assert.equal(disabled.secrets_included, false);

let intervalCallback = null;
let intervalDelay = null;
let cleared = false;
const timer = { unrefCalled: false, unref() { this.unrefCalled = true; } };
let releaseRun;
let runCount = 0;
const logs = [];
const scheduler = createEffectiveAuthorityReconciliationScheduler({
  runReconciliation: async ({ limit, persist }) => {
    runCount += 1;
    assert.equal(limit, 7);
    assert.equal(persist, false);
    await new Promise((resolve) => {
      releaseRun = resolve;
    });
    return {
      ok: true,
      status: "aligned",
      mode: "preview",
      summary: { scope_count: 1 },
      secrets_included: false,
    };
  },
  env: {
    UEACP_RECONCILIATION_ENABLED: "true",
    UEACP_RECONCILIATION_INTERVAL_SECONDS: "1",
    UEACP_RECONCILIATION_LIMIT: "7",
  },
  logger: {
    info: (entry) => logs.push(entry),
    error: (entry) => logs.push(entry),
  },
  setIntervalFn(callback, delay) {
    intervalCallback = callback;
    intervalDelay = delay;
    return timer;
  },
  clearIntervalFn(value) {
    assert.equal(value, timer);
    cleared = true;
  },
  now: () => new Date("2026-07-24T00:00:00.000Z"),
});
const scheduled = scheduler.start();
assert.equal(scheduled.status, "scheduled");
assert.equal(scheduled.enabled, true);
assert.equal(scheduled.persist, false);
assert.equal(scheduled.interval_seconds, 300);
assert.equal(intervalDelay, 300000);
assert.equal(timer.unrefCalled, true);
assert.equal(typeof intervalCallback, "function");

const firstRun = scheduled.runOnce();
const overlapping = await scheduled.runOnce();
assert.deepEqual(overlapping, { status: "skipped", reason: "overlap_prevented" });
assert.equal(runCount, 1);
releaseRun();
const completed = await firstRun;
assert.equal(completed.status, "aligned");
assert.equal(logs[0].event, "ueacp_reconciliation_tick");
assert.equal(logs[0].secretsIncluded, false);

const stopped = scheduled.stop();
assert.equal(stopped.status, "stopped");
assert.equal(cleared, true);
assert.deepEqual(await scheduled.runOnce(), {
  status: "skipped",
  reason: "scheduler_stopped",
});

assert.equal(
  _testingEffectiveAuthorityReconciliationScheduler.boundedIntervalSeconds(999999),
  86400
);
assert.equal(
  _testingEffectiveAuthorityReconciliationScheduler.truthy("enabled"),
  true
);

console.log("effective authority reconciliation scheduler tests passed");
