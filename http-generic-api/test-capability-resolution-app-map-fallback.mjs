import assert from "node:assert/strict";
import {
  isMissingAppCapabilityMapError,
  loadAppMap,
} from "./scripts/capability-resolution-dry-run.mjs";

assert.equal(isMissingAppCapabilityMapError({
  code: "ER_NO_SUCH_TABLE",
  message: "Table 'growthOS_dev.v_app_integration_capability_map' doesn't exist",
}), true);
assert.equal(isMissingAppCapabilityMapError({
  code: "ER_VIEW_INVALID",
  message: "View v_app_integration_capability_map references invalid objects",
}), true);
assert.equal(isMissingAppCapabilityMapError({
  code: "ER_NO_SUCH_TABLE",
  message: "Table 'growthOS_dev.other_table' doesn't exist",
}), false);
assert.equal(isMissingAppCapabilityMapError({
  code: "ER_ACCESS_DENIED_ERROR",
  message: "Access denied for v_app_integration_capability_map",
}), false);

let emptyQueryCount = 0;
assert.deepEqual(await loadAppMap({
  async query() {
    emptyQueryCount += 1;
    return [[]];
  },
}, ""), []);
assert.equal(emptyQueryCount, 0);

const fallbackCalls = [];
const fallbackPool = {
  async query(sql, params) {
    fallbackCalls.push({ sql, params });
    if (fallbackCalls.length === 1) {
      const error = new Error("Table 'growthOS_dev.v_app_integration_capability_map' doesn't exist");
      error.code = "ER_NO_SUCH_TABLE";
      throw error;
    }
    return [[{
      app_key: "platform_orchestration",
      action_key: "internal_platform_api",
      credential_source: "none",
      active_tool_exports: 1,
    }]];
  },
};
const fallbackRows = await loadAppMap(fallbackPool, "platform_orchestration");
assert.equal(fallbackCalls.length, 2);
assert.match(fallbackCalls[0].sql, /FROM v_app_integration_capability_map/);
assert.match(fallbackCalls[1].sql, /FROM app_integrations ai/);
assert.match(fallbackCalls[1].sql, /LEFT JOIN app_integration_action_bindings b/);
assert.match(fallbackCalls[1].sql, /LEFT JOIN platform_endpoint_tool_exports/);
assert.deepEqual(fallbackCalls[1].params, ["platform_orchestration"]);
assert.equal(fallbackRows[0].credential_source, "none");

let nonMissingCalls = 0;
const permissionError = new Error("Access denied");
permissionError.code = "ER_ACCESS_DENIED_ERROR";
await assert.rejects(
  () => loadAppMap({
    async query() {
      nonMissingCalls += 1;
      throw permissionError;
    },
  }, "platform_orchestration"),
  (error) => error === permissionError
);
assert.equal(nonMissingCalls, 1);

console.log("capability resolution app-map fallback tests passed");
