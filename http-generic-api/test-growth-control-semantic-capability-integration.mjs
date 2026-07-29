import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GROWTH_CONTROL_SEMANTIC_CAPABILITY_READY_STATUSES,
  createGrowthControlSemanticCapabilityAdapter
} from "./src/application/growthControlPlane/semanticCapabilityResolutionAdapter.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function resolvedCapability({ capabilityKey, status, rolloutMode, manifestHash }) {
  return {
    ok: true,
    resolver: "tenant_effective_capability_resolver_v1",
    mode: rolloutMode === "shadow" ? "shadow" : "effective",
    status,
    ready: ["shadow_ready", "canary_ready", "ready"].includes(status),
    capability: { capability_key: capabilityKey },
    binding: {
      app_key: "wordpress",
      parent_action_key: "wordpress_rest",
      configured_endpoint_key: "wordpress_create_post",
      adapter_key: "wordpress_article_draft_adapter_v1",
      policy_key: "wordpress_draft_only_v1",
      rollout_mode: rolloutMode
    },
    endpoint: { endpoint_key: "postWpV2Posts" },
    projection: { tool_name: `capability_${capabilityKey.replaceAll(".", "_")}` },
    checks: {
      workspace_ready: true,
      membership_ready: true,
      connection_ready: true,
      connection_ambiguous: false,
      action_grant_ready: true,
      resource_authority_ready: true,
      canonical_endpoint_ready: true,
      runtime_certification_ready: true,
      export_ready: true,
      shadow_mode: rolloutMode === "shadow"
    },
    obligations: {
      obligations: rolloutMode === "shadow"
        ? ["shadow_compare_only", "provider_apply_forbidden"]
        : ["audit_evidence_required"]
    },
    policy: { provider_apply_allowed: true },
    runtime: { dispatch_allowed: true, apply_allowed: true },
    manifest_hash: manifestHash,
    secrets_included: false
  };
}

const calls = [];
const adapter = createGrowthControlSemanticCapabilityAdapter({
  resolveCapability: async (args, context) => {
    calls.push({ args: structuredClone(args), context: structuredClone(context) });
    if (args.capability_key === "content.article.create_draft") {
      return resolvedCapability({
        capabilityKey: args.capability_key,
        status: "shadow_ready",
        rolloutMode: "shadow",
        manifestHash: HASH_A
      });
    }
    if (args.capability_key === "analytics.read") {
      return resolvedCapability({
        capabilityKey: args.capability_key,
        status: "ready",
        rolloutMode: "active",
        manifestHash: HASH_B
      });
    }
    return {
      ok: false,
      status: "blocked",
      error: {
        code: "CAPABILITY_NOT_REGISTERED",
        message: "The semantic capability is not active in the registry."
      },
      secrets_included: false
    };
  }
});

const input = {
  capabilityKeys: [
    "content.article.create_draft",
    "analytics.read",
    "repository.write"
  ],
  workspaceId: WORKSPACE_ID,
  resourceRef: "brand://example.brand"
};
const context = { tenantId: TENANT_ID, userId: USER_ID };
const preview = await adapter.previewSemanticCapabilities(input, context);

assert.deepEqual(GROWTH_CONTROL_SEMANTIC_CAPABILITY_READY_STATUSES, [
  "shadow_ready",
  "canary_ready",
  "ready"
]);
assert.equal(preview.status, "partial");
assert.equal(preview.ready, false);
assert.equal(preview.items.length, 3);
assert.equal(preview.summary.readyCount, 2);
assert.equal(preview.summary.blockedCount, 1);
assert.equal(preview.summary.shadowReadyCount, 1);
assert.equal(preview.providerCalls, false);
assert.equal(preview.providerDispatchAllowed, false);
assert.equal(preview.providerApplyAllowed, false);
assert.equal(preview.externalWrites, false);
assert.equal(preview.secretsIncluded, false);
assert.match(preview.evidenceSha256, /^[a-f0-9]{64}$/);

assert.equal(preview.items[0].status, "shadow_ready");
assert.equal(preview.items[0].ready, true);
assert.equal(preview.items[0].providerApplyAllowed, false);
assert.equal(preview.items[0].selection.canonicalEndpointKey, "postWpV2Posts");
assert.deepEqual(preview.items[0].obligations, [
  "shadow_compare_only",
  "provider_apply_forbidden"
]);
assert.match(preview.items[0].decisionSha256, /^[a-f0-9]{64}$/);

assert.equal(preview.items[2].ready, false);
assert.equal(preview.items[2].blocker.code, "CAPABILITY_NOT_REGISTERED");
assert.equal(preview.items[2].selection, null);

assert.equal(calls.length, 3);
for (const call of calls) {
  assert.equal(call.args.workspace_id, WORKSPACE_ID);
  assert.equal(call.args.resource_ref, "brand://example.brand");
  assert.equal(call.args.include_candidates, false);
  assert.equal(Object.hasOwn(call.args, "tenant_id"), false);
  assert.equal(Object.hasOwn(call.args, "user_id"), false);
  assert.deepEqual(call.context.auth, {
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    is_admin: false
  });
}

const repeated = await adapter.previewSemanticCapabilities(input, context);
assert.equal(repeated.evidenceSha256, preview.evidenceSha256);
assert.deepEqual(
  repeated.items.map((item) => item.decisionSha256),
  preview.items.map((item) => item.decisionSha256)
);

await assert.rejects(
  () => adapter.previewSemanticCapabilities({
    capabilityKeys: ["analytics.read", "analytics.read"]
  }, context),
  (error) => error.code === "GROWTH_CONTROL_SEMANTIC_CAPABILITY_KEYS_INVALID"
    && error.status === 422
);

await assert.rejects(
  () => adapter.previewSemanticCapabilities({
    capabilityKeys: ["analytics.read"],
    unsupported: true
  }, context),
  (error) => error.code === "GROWTH_CONTROL_SEMANTIC_CAPABILITY_INPUT_INVALID"
    && error.status === 422
);

const secretAdapter = createGrowthControlSemanticCapabilityAdapter({
  resolveCapability: async () => ({
    ok: true,
    status: "ready",
    ready: true,
    capability: { capability_key: "analytics.read" },
    secrets_included: true
  })
});
await assert.rejects(
  () => secretAdapter.previewSemanticCapabilities({ capabilityKeys: ["analytics.read"] }, context),
  (error) => error.code === "GROWTH_CONTROL_SEMANTIC_CAPABILITY_CONTRACT_INVALID"
    && error.status === 502
);

const throwingAdapter = createGrowthControlSemanticCapabilityAdapter({
  resolveCapability: async () => {
    const error = new Error("database unavailable");
    error.code = "ECONNREFUSED";
    throw error;
  }
});
await assert.rejects(
  () => throwingAdapter.previewSemanticCapabilities({ capabilityKeys: ["analytics.read"] }, context),
  (error) => error.code === "GROWTH_CONTROL_SEMANTIC_CAPABILITY_RESOLUTION_FAILED"
    && error.status === 503
    && error.details[0].causeCode === "ECONNREFUSED"
);

const adapterSource = readFileSync(
  "src/application/growthControlPlane/semanticCapabilityResolutionAdapter.js",
  "utf8"
);
const integrationSource = readFileSync(
  "growthControlSemanticCapabilityIntegration.js",
  "utf8"
);

assert.equal(adapterSource.includes("getPool"), false);
assert.equal(adapterSource.includes("/system/tools/call"), false);
assert.equal(adapterSource.includes("/gpt/tools/call"), false);
assert.equal(adapterSource.includes("providerApplyAllowed: true"), false);
assert.equal(adapterSource.includes("providerDispatchAllowed: true"), false);
assert.equal(integrationSource.includes("resolveTenantEffectiveCapability"), true);
assert.equal(integrationSource.includes("tenant_effective_capability_resolver_v1"), true);
assert.equal(integrationSource.includes("previewOnly: true"), true);
assert.equal(integrationSource.includes("providerApplyAllowed: false"), true);
assert.equal(integrationSource.includes("Router("), false);
assert.equal(integrationSource.includes("getPool"), false);

console.log("growth control semantic capability integration tests passed");
