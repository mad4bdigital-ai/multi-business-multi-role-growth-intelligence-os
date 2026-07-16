import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runDynamicContainerCanaryProbeSampler } from "./dynamicContainerCanaryProbeSampler.js";

const TARGET="container_authority_rollout_readiness_v1";
const CAPABILITY="getContainerAuthorityRolloutReadiness";
const readinessRows=[{ policy_key:"dynamic_container_authority_v1",readiness_code:"ready_for_review" }];

function executor() {
  const calls=[];
  return {
    calls,
    query:async (sql) => {
      calls.push(sql);
      if(sql.includes("v_container_rollout_readiness")) return [readinessRows];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

await assert.rejects(
  runDynamicContainerCanaryProbeSampler({ sampleCount:0 },{ executor:executor() }),
  error => error.code === "dynamic_container_canary_probe_sample_count_invalid" && error.status === 422
);
await assert.rejects(
  runDynamicContainerCanaryProbeSampler({ sampleCount:101 },{ executor:executor() }),
  error => error.code === "dynamic_container_canary_probe_sample_count_invalid" && error.status === 422
);
await assert.rejects(
  runDynamicContainerCanaryProbeSampler({ sampleCount:1,targetCanaryKey:"unsupported" },{ executor:executor() }),
  error => error.code === "dynamic_container_canary_probe_target_invalid" && error.status === 422
);

const successExecutor=executor();
const requestIds=[];
const success=await runDynamicContainerCanaryProbeSampler(
  { sampleCount:3,targetCanaryKey:TARGET },
  {
    executor:successExecutor,
    runId:"11111111-2222-4333-8444-555555555555",
    executeObserved:async ({ canaryKey,capabilityKey,requestId,execute }) => {
      assert.equal(canaryKey,TARGET);
      assert.equal(capabilityKey,CAPABILITY);
      requestIds.push(requestId);
      const response=await execute();
      assert.equal(response.items[0].readiness_code,"ready_for_review");
      return {
        canaryApplied:true,
        observation:{ outcome:"success",readinessCode:"ready_for_review" },
        response
      };
    },
    readEvidence:async (_executor,runId) => {
      assert.equal(runId,"11111111-2222-4333-8444-555555555555");
      return {
        observationCount:3,
        successCount:3,
        failureCount:0,
        averageLatencyMs:4.5,
        maximumLatencyMs:7.5,
        auditCoveragePercent:100,
        lastReadinessCode:"ready_for_review"
      };
    }
  }
);
assert.equal(success.ok,true);
assert.equal(success.requestedSampleCount,3);
assert.equal(success.completedSampleCount,3);
assert.equal(success.evidence.observationCount,3);
assert.equal(success.evidence.failureCount,0);
assert.equal(success.evidence.auditCoveragePercent,100);
assert.equal(success.providerCalls,false);
assert.equal(success.externalWrites,false);
assert.equal(success.enforcementApplied,false);
assert.deepEqual(requestIds,[
  "dynamic-container-canary-probe-sampler:11111111-2222-4333-8444-555555555555:1",
  "dynamic-container-canary-probe-sampler:11111111-2222-4333-8444-555555555555:2",
  "dynamic-container-canary-probe-sampler:11111111-2222-4333-8444-555555555555:3"
]);
assert.equal(successExecutor.calls.filter(sql => sql.includes("v_container_rollout_readiness")).length,3);

await assert.rejects(
  runDynamicContainerCanaryProbeSampler(
    { sampleCount:2,targetCanaryKey:TARGET },
    {
      executor:executor(),
      runId:"inactive-run",
      executeObserved:async () => ({ canaryApplied:false,observation:null }),
      readEvidence:async () => ({
        observationCount:0,successCount:0,failureCount:0,averageLatencyMs:0,maximumLatencyMs:0,auditCoveragePercent:0,lastReadinessCode:null
      })
    }
  ),
  error => error.code === "dynamic_container_canary_probe_readback_failed"
    && error.status === 500
    && error.details[0].failureCount === 2
);

let attempt=0;
await assert.rejects(
  runDynamicContainerCanaryProbeSampler(
    { sampleCount:3,targetCanaryKey:TARGET },
    {
      executor:executor(),
      runId:"partial-run",
      executeObserved:async ({ execute }) => {
        attempt += 1;
        if(attempt === 2) throw Object.assign(new Error("probe failed"),{ code:"probe_failed" });
        await execute();
        return { canaryApplied:true,observation:{ outcome:"success" } };
      },
      readEvidence:async () => ({
        observationCount:2,successCount:2,failureCount:0,averageLatencyMs:5,maximumLatencyMs:8,auditCoveragePercent:100,lastReadinessCode:"ready_for_review"
      })
    }
  ),
  error => error.code === "dynamic_container_canary_probe_readback_failed"
    && error.details[0].completedCount === 2
    && error.details[0].failureCount === 1
    && error.details[0].failures[0].code === "probe_failed"
);

const service=readFileSync(new URL("./dynamicContainerCanaryProbeSampler.js",import.meta.url),"utf8");
const routes=readFileSync(new URL("./routes/dynamicContainerAuthorityRoutes.js",import.meta.url),"utf8");
const fragmentOpenapi=readFileSync(new URL("./openapi/container-authority.yaml",import.meta.url),"utf8");
const rootOpenapi=readFileSync(new URL("./openapi.yaml",import.meta.url),"utf8");
const migration=readFileSync(new URL("./migrations/20260715_dynamic_container_canary_probe_sampler_tool.sql",import.meta.url),"utf8");

assert.match(service,/sampleCount > 100/);
assert.match(service,/dynamic-container-canary-probe-sampler:/);
assert.match(service,/executeObservedReadOnlyCanary/);
assert.match(service,/same-cycle observation evidence/);
assert.match(routes,/router\.post\("\/admin\/container-authority\/canary-probes"/);
assert.match(routes,/runDynamicContainerCanaryProbeSampler/);
assert.match(fragmentOpenapi,/adminContainerAuthorityCanaryProbes:/);
assert.match(fragmentOpenapi,/operationId: createAdminContainerAuthorityCanaryProbes/);
assert.match(fragmentOpenapi,/x-registry-tool-key: dynamic_container_canary_probe_sampler/);
assert.match(fragmentOpenapi,/CanaryProbeSamplerRequest:/);
assert.match(fragmentOpenapi,/CanaryProbeSamplerResponse:/);
assert.match(rootOpenapi,/\/admin\/container-authority\/canary-probes:/);
assert.match(rootOpenapi,/adminContainerAuthorityCanaryProbes/);
assert.match(migration,/dynamic_container_canary_probe_sampler/);
assert.match(migration,/maximum_probe_count/);
assert.match(migration,/same_cycle_observation_readback_required/);
assert.match(migration,/no_provider_call/);
assert.match(migration,/no_external_write/);
assert.match(migration,/secrets_included=false/);

console.log("dynamic container canary probe sampler contracts passed");
