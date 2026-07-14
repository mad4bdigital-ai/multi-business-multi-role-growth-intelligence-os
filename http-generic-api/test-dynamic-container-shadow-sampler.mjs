import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildShadowSampleInput,
  concreteOperationFromBinding,
  runDynamicContainerShadowSampler,
} from "./dynamicContainerShadowSampler.js";

const candidateA = {
  tenant_id: "tenant-1",
  container_id: "container-1",
  principal_type: "service",
  principal_id: "agent-1",
  binding_id: "binding-1",
  dimension_key: "skills",
  resource_type: "skill",
  resource_ref: "skill.research",
  effect: "allow",
  permission_key: "use",
  operation_patterns_json: JSON.stringify(["skill.*"]),
  capability_keys_json: JSON.stringify(["capability.research"]),
};

const candidateB = {
  ...candidateA,
  principal_id: "agent-2",
  binding_id: "binding-2",
  resource_ref: "skill.audit",
  effect: "deny",
  permission_key: "read",
  operation_patterns_json: JSON.stringify(["read"]),
  capability_keys_json: "[]",
};

assert.equal(concreteOperationFromBinding(candidateA), "skill.sample");
assert.equal(concreteOperationFromBinding(candidateB), "read");
assert.equal(concreteOperationFromBinding({ permission_key: "use" }), "use");
assert.equal(concreteOperationFromBinding({}), "read");

{
  const input = buildShadowSampleInput(candidateA, { runId: "run-1", sampleIndex: 2 });
  assert.equal(input.mode, "shadow");
  assert.equal(input.legacyDecision, "allow");
  assert.equal(input.dimensionRequests[0].operation, "skill.sample");
  assert.equal(input.dimensionRequests[0].capabilityKey, "capability.research");
  assert.equal(input.idempotencyKey, "shadow-sample-run-1-2");
  assert.match(input.legacyEvidenceRef, /^dynamic-container-shadow-sampler:run-1:2:/);
}

{
  const calls = [];
  const result = await runDynamicContainerShadowSampler(
    { sampleCount: 3 },
    {
      pool: {},
      runId: "run-success",
      loadCandidates: async () => [candidateA, candidateB],
      resolve: async (input) => {
        calls.push(input);
        return { resolutionId: `resolution-${calls.length}` };
      },
      readEvidence: async () => ({
        comparisonCount: 3,
        matchCount: 2,
        mismatchCount: 1,
        notComparableCount: 0,
        maxLatencyMs: 10,
        avgLatencyMs: 5,
        performanceSampleCount: 3,
        withinBudgetCount: 3,
        maxDurationMs: 11,
        avgDurationMs: 6,
      }),
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.completedSampleCount, 3);
  assert.equal(result.distinctCandidateCount, 2);
  assert.equal(result.repeatedRoundCount, 1);
  assert.equal(result.providerCallMade, false);
  assert.equal(result.credentialPayloadRead, false);
  assert.equal(result.externalWriteMade, false);
  assert.equal(result.enforcementApplied, false);
  assert.equal(result.secretsIncluded, false);
  assert.deepEqual(calls.map((input) => input.mode), ["shadow", "shadow", "shadow"]);
  assert.equal(new Set(calls.map((input) => input.idempotencyKey)).size, 3);
  assert.deepEqual(calls.map((input) => input.legacyDecision), ["allow", "deny", "allow"]);
}

await assert.rejects(
  () => runDynamicContainerShadowSampler(
    { sampleCount: 2 },
    {
      pool: {},
      runId: "run-readback-failure",
      loadCandidates: async () => [candidateA],
      resolve: async (_input) => ({ resolutionId: "resolution-1" }),
      readEvidence: async () => ({
        comparisonCount: 1,
        performanceSampleCount: 1,
      }),
    }
  ),
  (error) => error.code === "dynamic_container_shadow_sampler_readback_failed"
);

await assert.rejects(
  () => runDynamicContainerShadowSampler({ sampleCount: 101 }, { pool: {} }),
  (error) => error.code === "dynamic_container_shadow_sample_count_invalid"
);

await assert.rejects(
  () => runDynamicContainerShadowSampler(
    { sampleCount: 1 },
    { pool: {}, loadCandidates: async () => [] }
  ),
  (error) => error.code === "dynamic_container_shadow_samples_unavailable"
);

{
  const routeSource = readFileSync(new URL("./routes/dynamicContainerAuthorityRoutes.js",import.meta.url),"utf8");
  const openapiSource = readFileSync(new URL("./openapi/container-authority.yaml",import.meta.url),"utf8");
  const migrationSource = readFileSync(new URL("./migrations/1046_sprint69_dynamic_container_shadow_sampler_tool.sql",import.meta.url),"utf8");

  assert(routeSource.includes('router.post("/admin/container-authority/shadow-samples"'));
  assert(routeSource.includes("runDynamicContainerShadowSampler"));
  assert(routeSource.includes('new Set(["sampleCount","tenantId"])'));
  assert(routeSource.includes("requireAdminPrincipal"));

  assert(openapiSource.includes("adminContainerAuthorityShadowSamples:"));
  assert(openapiSource.includes("operationId: createAdminContainerAuthorityShadowSamples"));
  assert(openapiSource.includes("x-registry-tool-key: dynamic_container_shadow_sampler"));
  assert(openapiSource.includes("x-openai-isConsequential: true"));
  assert(openapiSource.includes("ShadowSamplerRequest:"));
  assert(openapiSource.includes("ShadowSamplerResponse:"));

  assert(migrationSource.includes("'dynamic_container_shadow_sampler'"));
  assert(migrationSource.includes("'/admin/container-authority/shadow-samples'"));
  assert(migrationSource.includes("'1046_sprint69_dynamic_container_shadow_sampler_tool.sql'"));
  for (const marker of [
    "no_provider_call",
    "no_credential_payload_read",
    "no_external_write",
    "same_cycle_readback_required",
    "secrets_included=false"
  ]) assert(migrationSource.includes(marker),`shadow sampler migration must include ${marker}`);
}

console.log("dynamic container shadow sampler tests passed");
