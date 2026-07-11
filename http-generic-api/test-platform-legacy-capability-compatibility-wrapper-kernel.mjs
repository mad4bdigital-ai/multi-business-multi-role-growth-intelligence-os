import assert from "node:assert/strict";
import fs from "node:fs";
import {
  LEGACY_COMPATIBILITY_WRAPPER_VERSION,
  runLegacyCapabilityCompatibilityWrapper,
} from "./platformLegacyCapabilityCompatibilityWrapperKernel.js";

const docs = fs.readFileSync(
  new URL("../docs/platform-legacy-capability-compatibility-wrapper.md", import.meta.url),
  "utf8",
);
const tasks = fs.readFileSync(
  new URL(
    "../specs/006-adaptive-authorization-execution-governance/tasks.md",
    import.meta.url,
  ),
  "utf8",
);

const baseAlias = {
  id: "alias-legacy-read",
  selector_type: "tool_key",
  selector_value: "legacy.skills.read",
  canonical_capability_id: "cap-activation-skills-read",
  capability_key: "activation.skills.read",
  surface: "tenant",
  status: "active",
  registry_version: "capability-registry-2026-07-11",
};

const legacyResponse = Object.freeze({
  status: 200,
  body: Object.freeze({ skills: ["seo", "analytics"] }),
});

let resolverCalls = 0;
const matched = await runLegacyCapabilityCompatibilityWrapper(
  {
    selectorType: "tool_key",
    selectorValue: "legacy.skills.read",
    surface: "tenant",
    aliasResolution: baseAlias,
    legacyResponse,
    legacyDecision: "allow",
    decisionInput: {
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      resourceRefHash: "f".repeat(64),
    },
    observedAt: "2026-07-11T12:00:00Z",
    requestShapeHash: "a".repeat(64),
    revisionVectorHash: "b".repeat(64),
    measurements: {
      observedCallCount: 25,
      parityMatchCount: 25,
      criticalMismatchCount: 0,
      adaptiveErrorCount: 0,
      activeLegacyConsumerCount: 2,
      rollbackReadbackApproved: false,
    },
  },
  {
    resolveAdaptiveDecision: async (request) => {
      resolverCalls += 1;
      assert.equal(request.capabilityKey, "activation.skills.read");
      assert.equal(request.selectorValue, "legacy.skills.read");
      assert.equal(request.decisionInput.tenantId, "tenant-1");
      return { decision: "allow", reasonCodes: ["grant_active"] };
    },
  },
);

assert.equal(resolverCalls, 1);
assert.strictEqual(matched.legacyResponse, legacyResponse);
assert.equal(
  matched.compatibilityMetadata.schema_version,
  LEGACY_COMPATIBILITY_WRAPPER_VERSION,
);
assert.equal(matched.compatibilityMetadata.parity.mismatchCategory, "match");
assert.equal(
  matched.compatibilityMetadata.usageMeasurement.legacyCallCountIncrement,
  1,
);
assert.equal(matched.compatibilityMetadata.routeRemovalAllowed, false);
assert.equal(matched.compatibilityMetadata.canaryActivationAllowed, false);
assert.equal(matched.compatibilityMetadata.providerApplyAllowed, false);
assert.equal(matched.compatibilityMetadata.rawPayloadIncluded, false);

const deprecatedAlias = {
  ...baseAlias,
  id: "alias-legacy-write",
  selector_value: "legacy.output.write",
  canonical_capability_id: "cap-output-write",
  capability_key: "platform.output-artifact.write",
  status: "deprecated",
};

const measured = await runLegacyCapabilityCompatibilityWrapper(
  {
    selectorType: "tool_key",
    selectorValue: "legacy.output.write",
    surface: "tenant",
    aliasResolution: deprecatedAlias,
    legacyResponse: { status: 202, body: { accepted: true } },
    legacyDecision: "allow",
    decisionInput: {
      tenantId: "tenant-1",
      outputArtifactRefHash: "c".repeat(64),
    },
    observedAt: "2026-08-15T12:00:00Z",
    requestShapeHash: "d".repeat(64),
    revisionVectorHash: "e".repeat(64),
    deprecationPolicy: {
      announcedAt: "2026-07-01T00:00:00Z",
      removalNotBefore: "2026-08-01T00:00:00Z",
      policyHash: "9".repeat(64),
      minimumObservationCount: 1000,
      minimumParityRate: 0.999,
    },
    measurements: {
      observedCallCount: 2000,
      parityMatchCount: 2000,
      criticalMismatchCount: 0,
      adaptiveErrorCount: 0,
      activeLegacyConsumerCount: 1,
      rollbackReadbackApproved: true,
    },
  },
  {
    resolveAdaptiveDecision: async () => ({
      decision: "deny",
      reasonCodes: ["approval_required"],
    }),
  },
);

assert.equal(
  measured.compatibilityMetadata.parity.mismatchCategory,
  "policy_difference",
);
assert.equal(
  measured.compatibilityMetadata.deprecation.deprecationEvidenceComplete,
  false,
);
assert.equal(
  measured.compatibilityMetadata.deprecation.checks.noActiveLegacyConsumers,
  false,
);
assert.equal(measured.compatibilityMetadata.deprecation.routeRemovalAllowed, false);

const completeEvidence = await runLegacyCapabilityCompatibilityWrapper(
  {
    selectorType: "tool_key",
    selectorValue: "legacy.output.write",
    surface: "tenant",
    aliasResolution: deprecatedAlias,
    legacyResponse: { status: 200 },
    legacyDecision: "allow",
    decisionInput: { tenantId: "tenant-1" },
    observedAt: "2026-08-15T12:00:00Z",
    requestShapeHash: "1".repeat(64),
    revisionVectorHash: "2".repeat(64),
    deprecationPolicy: {
      announcedAt: "2026-07-01T00:00:00Z",
      removalNotBefore: "2026-08-01T00:00:00Z",
      policyHash: "3".repeat(64),
      minimumObservationCount: 1000,
      minimumParityRate: 0.999,
    },
    measurements: {
      observedCallCount: 2000,
      parityMatchCount: 2000,
      criticalMismatchCount: 0,
      adaptiveErrorCount: 0,
      activeLegacyConsumerCount: 0,
      rollbackReadbackApproved: true,
    },
  },
  {
    resolveAdaptiveDecision: async () => ({
      decision: "allow",
      reasonCodes: ["same_decision_path"],
    }),
  },
);

assert.equal(
  completeEvidence.compatibilityMetadata.deprecation.deprecationEvidenceComplete,
  true,
);
assert.equal(
  completeEvidence.compatibilityMetadata.deprecation.nextRequiredAction,
  "separate_explicit_route_removal_authority_required",
);
assert.equal(completeEvidence.compatibilityMetadata.routeRemovalAllowed, false);

await assert.rejects(
  () =>
    runLegacyCapabilityCompatibilityWrapper(
      {
        selectorType: "tool_key",
        selectorValue: "legacy.skills.read",
        surface: "tenant",
        aliasResolution: { ...baseAlias, status: "disabled" },
        legacyDecision: "deny",
        observedAt: "2026-07-11T12:00:00Z",
        requestShapeHash: "4".repeat(64),
        revisionVectorHash: "5".repeat(64),
        measurements: {},
      },
      { resolveAdaptiveDecision: async () => ({ decision: "deny" }) },
    ),
  (error) => error.code === "legacy_compatibility_alias_not_routable",
);

await assert.rejects(
  () =>
    runLegacyCapabilityCompatibilityWrapper(
      {
        selectorType: "tool_key",
        selectorValue: "different.selector",
        surface: "tenant",
        aliasResolution: baseAlias,
        legacyDecision: "deny",
        observedAt: "2026-07-11T12:00:00Z",
        requestShapeHash: "6".repeat(64),
        revisionVectorHash: "7".repeat(64),
        measurements: {},
      },
      { resolveAdaptiveDecision: async () => ({ decision: "deny" }) },
    ),
  (error) => error.code === "legacy_compatibility_alias_binding_mismatch",
);

await assert.rejects(
  () =>
    runLegacyCapabilityCompatibilityWrapper(
      {
        selectorType: "tool_key",
        selectorValue: "legacy.skills.read",
        surface: "tenant",
        aliasResolution: baseAlias,
        legacyDecision: "allow",
        decisionInput: { credentialToken: "forbidden" },
        observedAt: "2026-07-11T12:00:00Z",
        requestShapeHash: "8".repeat(64),
        revisionVectorHash: "9".repeat(64),
        measurements: {},
      },
      { resolveAdaptiveDecision: async () => ({ decision: "allow" }) },
    ),
  (error) => error.code === "legacy_compatibility_sensitive_field_forbidden",
);

assert(
  tasks.includes(
    "- [x] T043 Add compatibility wrappers and measured deprecation metadata.",
  ),
);
assert(docs.includes("legacy response remains unchanged"));
assert(docs.includes("routeRemovalAllowed: false"));
assert(docs.includes("separate explicit route-removal authority"));

console.log("platform legacy compatibility wrapper kernel tests passed");
