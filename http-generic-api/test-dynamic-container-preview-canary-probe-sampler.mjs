import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runDynamicContainerPreviewCanaryProbeSampler } from "./dynamicContainerPreviewCanaryProbeSampler.js";

const TARGET_CANARY="container_authority_preview_resolution_v1";
const CAPABILITY="createContainerContextResolution";
const cases=[
  {
    bindingId:"binding-1",
    tenantId:"00000000-0000-4000-a000-000000000001",
    targetContainerId:"11111111-1111-4111-8111-111111111111",
    principal:{ type:"user",id:"user-1" },
    dimensionRequest:{
      dimension:"skills",
      resourceType:"skill",
      resourceRef:"skill-1",
      operation:"use",
      capabilityKey:CAPABILITY
    }
  },
  {
    bindingId:"binding-2",
    tenantId:"00000000-0000-4000-a000-000000000001",
    targetContainerId:"22222222-2222-4222-8222-222222222222",
    principal:{ type:"service",id:"service-1" },
    dimensionRequest:{
      dimension:"data",
      resourceType:"dataset",
      resourceRef:"dataset-1",
      operation:"read",
      capabilityKey:CAPABILITY
    }
  }
];

function executor() {
  return { query:async () => { throw new Error("Unexpected direct SQL in injected sampler test."); } };
}

await assert.rejects(
  runDynamicContainerPreviewCanaryProbeSampler({ sampleCount:0 },{ executor:executor(),loadCases:async () => cases }),
  error => error.code === "dynamic_container_preview_canary_sample_count_invalid" && error.status === 422
);
await assert.rejects(
  runDynamicContainerPreviewCanaryProbeSampler({ sampleCount:101 },{ executor:executor(),loadCases:async () => cases }),
  error => error.code === "dynamic_container_preview_canary_sample_count_invalid" && error.status === 422
);
await assert.rejects(
  runDynamicContainerPreviewCanaryProbeSampler({ sampleCount:1 },{ executor:executor(),loadCases:async () => [] }),
  error => error.code === "dynamic_container_preview_canary_cases_unavailable" && error.status === 422
);

const successExecutor=executor();
const requestIds=[];
const idempotencyKeys=[];
const candidateContainers=[];
const success=await runDynamicContainerPreviewCanaryProbeSampler(
  { sampleCount:3 },
  {
    executor:successExecutor,
    runId:"33333333-4444-4555-8666-777777777777",
    loadCases:async () => cases,
    executeObserved:async ({ executor:receivedExecutor,canaryKey,capabilityKey,requestId,execute }) => {
      assert.equal(receivedExecutor,successExecutor);
      assert.equal(canaryKey,TARGET_CANARY);
      assert.equal(capabilityKey,CAPABILITY);
      requestIds.push(requestId);
      const response=await execute();
      return {
        canaryApplied:true,
        observation:{ outcome:"success" },
        response
      };
    },
    resolvePreview:async (input,receivedExecutor) => {
      assert.equal(receivedExecutor,successExecutor);
      assert.equal(input.mode,"preview");
      assert.equal(input.legacyDecision,"unknown");
      assert.equal(input.dimensionRequests.length,1);
      assert.equal(input.dimensionRequests[0].capabilityKey,CAPABILITY);
      assert.equal(input.requestId,input.idempotencyKey.replace("preview-canary-","dynamic-container-preview-canary-probe:").replace(/-([0-9]+)$/,
        ":$1"));
      idempotencyKeys.push(input.idempotencyKey);
      candidateContainers.push(input.targetContainerId);
      return { decision:candidateContainers.length % 2 === 1 ? "allow" : "deny" };
    },
    readEvidence:async (_executor,runId) => {
      assert.equal(runId,"33333333-4444-4555-8666-777777777777");
      return {
        observationCount:3,
        successCount:3,
        failureCount:0,
        resolutionCount:3,
        allowCount:2,
        denyCount:1,
        restrictCount:0,
        ambiguousCount:0,
        averageLatencyMs:6.25,
        maximumLatencyMs:9.5,
        auditCoveragePercent:100
      };
    }
  }
);
assert.equal(success.ok,true);
assert.equal(success.requestedSampleCount,3);
assert.equal(success.completedSampleCount,3);
assert.equal(success.distinctCaseCount,2);
assert.equal(success.evidence.observationCount,3);
assert.equal(success.evidence.resolutionCount,3);
assert.equal(success.evidence.failureCount,0);
assert.equal(success.evidence.auditCoveragePercent,100);
assert.equal(success.providerCalls,false);
assert.equal(success.credentialPayloadReads,false);
assert.equal(success.externalWrites,false);
assert.equal(success.enforcementApplied,false);
assert.deepEqual(requestIds,[
  "dynamic-container-preview-canary-probe:33333333-4444-4555-8666-777777777777:1",
  "dynamic-container-preview-canary-probe:33333333-4444-4555-8666-777777777777:2",
  "dynamic-container-preview-canary-probe:33333333-4444-4555-8666-777777777777:3"
]);
assert.deepEqual(idempotencyKeys,[
  "preview-canary-33333333-4444-4555-8666-777777777777-1",
  "preview-canary-33333333-4444-4555-8666-777777777777-2",
  "preview-canary-33333333-4444-4555-8666-777777777777-3"
]);
assert.deepEqual(candidateContainers,[cases[0].targetContainerId,cases[1].targetContainerId,cases[0].targetContainerId]);

await assert.rejects(
  runDynamicContainerPreviewCanaryProbeSampler(
    { sampleCount:2 },
    {
      executor:executor(),
      runId:"inactive-preview-run",
      loadCases:async () => cases,
      executeObserved:async () => ({ canaryApplied:false,observation:null }),
      resolvePreview:async () => ({ decision:"allow" }),
      readEvidence:async () => ({
        observationCount:0,successCount:0,failureCount:0,resolutionCount:0,
        allowCount:0,denyCount:0,restrictCount:0,ambiguousCount:0,
        averageLatencyMs:0,maximumLatencyMs:0,auditCoveragePercent:0
      })
    }
  ),
  error => error.code === "dynamic_container_preview_canary_readback_failed"
    && error.status === 500
    && error.details[0].failureCount === 2
);

let attempt=0;
await assert.rejects(
  runDynamicContainerPreviewCanaryProbeSampler(
    { sampleCount:3 },
    {
      executor:executor(),
      runId:"partial-preview-run",
      loadCases:async () => cases,
      executeObserved:async ({ execute }) => {
        attempt += 1;
        if(attempt === 2) throw Object.assign(new Error("preview probe failed"),{ code:"preview_probe_failed" });
        await execute();
        return { canaryApplied:true,observation:{ outcome:"success" } };
      },
      resolvePreview:async () => ({ decision:"allow" }),
      readEvidence:async () => ({
        observationCount:2,successCount:2,failureCount:0,resolutionCount:2,
        allowCount:2,denyCount:0,restrictCount:0,ambiguousCount:0,
        averageLatencyMs:7,maximumLatencyMs:10,auditCoveragePercent:100
      })
    }
  ),
  error => error.code === "dynamic_container_preview_canary_readback_failed"
    && error.details[0].completedCount === 2
    && error.details[0].failureCount === 1
    && error.details[0].failures[0].code === "preview_probe_failed"
);

await assert.rejects(
  runDynamicContainerPreviewCanaryProbeSampler(
    { sampleCount:2 },
    {
      executor:executor(),
      runId:"parity-preview-run",
      loadCases:async () => cases,
      executeObserved:async ({ execute }) => {
        await execute();
        return { canaryApplied:true,observation:{ outcome:"success" } };
      },
      resolvePreview:async () => ({ decision:"allow" }),
      readEvidence:async () => ({
        observationCount:2,successCount:2,failureCount:0,resolutionCount:1,
        allowCount:1,denyCount:0,restrictCount:0,ambiguousCount:0,
        averageLatencyMs:5,maximumLatencyMs:8,auditCoveragePercent:100
      })
    }
  ),
  error => error.code === "dynamic_container_preview_canary_readback_failed"
    && error.details[0].evidence.observationCount === 2
    && error.details[0].evidence.resolutionCount === 1
);

const sampler=readFileSync(new URL("./dynamicContainerPreviewCanaryProbeSampler.js",import.meta.url),"utf8");
const resolverExecutor=readFileSync(new URL("./dynamicContainerResolverExecutor.js",import.meta.url),"utf8");
const routes=readFileSync(new URL("./routes/dynamicContainerAuthorityRoutes.js",import.meta.url),"utf8");
const fragmentOpenapi=readFileSync(new URL("./openapi/container-authority.yaml",import.meta.url),"utf8");
const rootOpenapi=readFileSync(new URL("./openapi.yaml",import.meta.url),"utf8");
const migration=readFileSync(new URL("./migrations/20260716_dynamic_container_preview_canary_probe_sampler_tool.sql",import.meta.url),"utf8");

assert.match(sampler,/sampleCount > 100/);
assert.match(sampler,/dynamic-container-preview-canary-probe:/);
assert.match(sampler,/executeObservedReadOnlyCanary/);
assert.match(sampler,/resolveContainerContextWithExecutor/);
assert.match(sampler,/LEFT JOIN container_effective_context_ledger l/);
assert.match(sampler,/l\.request_id=o\.request_id/);
assert.match(sampler,/l\.mode='preview'/);
assert.match(sampler,/evidence\.resolutionCount === sampleCount/);
assert.match(resolverExecutor,/loadContainerAuthorityState\(input,executor\)/);
assert.match(resolverExecutor,/persistContainerResolution\(resolution,executor\)/);
assert.match(resolverExecutor,/readIdempotentResult\(scopeKey,idempotencyKey,executor\)/);
assert.match(routes,/executeObservedReadOnlyCanary/);
assert.match(routes,/container_authority_preview_resolution_v1/);
assert.match(routes,/createContainerContextResolution/);
assert.match(routes,/if\(input\.mode !== "preview"\)/);
assert.match(routes,/router\.post\("\/admin\/container-authority\/preview-canary-probes"/);
assert.match(routes,/runDynamicContainerPreviewCanaryProbeSampler/);
assert.match(fragmentOpenapi,/adminContainerAuthorityPreviewCanaryProbes:/);
assert.match(fragmentOpenapi,/operationId: createAdminContainerAuthorityPreviewCanaryProbes/);
assert.match(fragmentOpenapi,/x-registry-tool-key: dynamic_container_preview_canary_probe_sampler/);
assert.match(fragmentOpenapi,/PreviewCanaryProbeSamplerRequest:/);
assert.match(fragmentOpenapi,/PreviewCanaryProbeSamplerResponse:/);
assert.match(rootOpenapi,/\/admin\/container-authority\/preview-canary-probes:/);
assert.match(rootOpenapi,/adminContainerAuthorityPreviewCanaryProbes/);
assert.match(migration,/dynamic_container_preview_canary_probe_sampler/);
assert.match(migration,/resolution_ledger_parity_required/);
assert.match(migration,/same_cycle_observation_readback_required/);
assert.match(migration,/no_provider_call/);
assert.match(migration,/no_external_write/);
assert.match(migration,/secrets_included=false/);

console.log("dynamic container preview canary runtime and probe sampler contracts passed");
