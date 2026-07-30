import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getEngineRuntimeCoverage,
  getLogicRuntimeCoverage,
  summarizeCapabilityCoverage,
} from "./capabilityCoverageRuntime.js";

const sampleRows = [
  {
    logic_key: "seo_article_v3",
    usage_status: "verified",
    evidence_event_count: "5",
    retrieval_count: "1",
    selected_count: "1",
    dispatch_count: "1",
    success_count: "1",
    verified_count: "1",
  },
  {
    logic_key: "unused_logic",
    usage_status: "never_retrieved",
    evidence_event_count: 0,
    retrieval_count: 0,
    selected_count: 0,
    dispatch_count: 0,
    success_count: 0,
    verified_count: 0,
  },
];

const summary = summarizeCapabilityCoverage(sampleRows);
assert.equal(summary.total, 2);
assert.equal(summary.evidence_event_count, 5);
assert.equal(summary.verified_count, 1);
assert.equal(summary.never_used_count, 1);
assert.equal(summary.usage_status_counts.verified, 1);
assert.equal(summary.usage_status_counts.never_retrieved, 1);

const calls = [];
const logicPool = {
  async query(sql, params) {
    calls.push({ sql, params });
    return [[sampleRows[0]]];
  },
};
const logicCoverage = await getLogicRuntimeCoverage({
  logic_key: "seo_article_v3",
  registry_status: "active",
  usage_status: "verified",
  limit: 25,
}, { pool: logicPool });
assert.match(calls[0].sql, /FROM v_logic_runtime_coverage/);
assert.match(calls[0].sql, /logic_key = \?/);
assert.match(calls[0].sql, /registry_status = \?/);
assert.deepEqual(calls[0].params, ["seo_article_v3", "verified", "active", 25]);
assert.equal(logicCoverage.summary.verified_count, 1);
assert.equal(logicCoverage.evidence_contract.inventory_is_not_usage, true);

const engineCalls = [];
const enginePool = {
  async query(sql, params) {
    engineCalls.push({ sql, params });
    return [[{
      engine_key: "wordpress_create_post",
      usage_status: "dispatched_never_succeeded",
      evidence_event_count: 1,
      retrieval_count: 0,
      selected_count: 0,
      dispatch_count: 1,
      success_count: 0,
      verified_count: 0,
    }]];
  },
};
const engineCoverage = await getEngineRuntimeCoverage({
  engine_key: "wordpress_create_post",
  usage_status: "dispatched_never_succeeded",
}, { pool: enginePool });
assert.match(engineCalls[0].sql, /FROM v_engine_runtime_coverage/);
assert.deepEqual(engineCalls[0].params, ["wordpress_create_post", "dispatched_never_succeeded", 100]);
assert.equal(engineCoverage.summary.dispatch_count, 1);

await assert.rejects(
  () => getLogicRuntimeCoverage({ usage_status: "active" }, { pool: logicPool }),
  (error) => error.code === "agent_capability_coverage_usage_status_invalid" && error.status === 400
);
await assert.rejects(
  () => getEngineRuntimeCoverage({ engine_key: "bad key with spaces" }, { pool: enginePool }),
  (error) => error.code === "agent_capability_coverage_engine_key_invalid" && error.status === 400
);

console.log("agent capability coverage tests passed");
