import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ExecutionCapsuleRolloutError,
  createExecutionCapsuleRolloutCoordinator,
} from "./contextKernel/integration/executionCapsuleRolloutCoordinator.js";
import {
  createExecutionCapsuleRolloutEvaluator,
} from "./contextKernel/integration/executionCapsuleRolloutEvaluator.js";

const target = Object.freeze({
  tenantRef: "tenant-a", workspaceRef: "workspace-a", brandRef: "brand-a",
  resourceType: "repository", resourceRef: "repository-a", connectionRef: "connection-a",
});
function input(overrides = {}) {
  return Object.freeze({
    expectedTarget: target,
    contextIdentity: Object.freeze({
      principalType: "tenant_user", principalRef: "principal-a", effectiveSubjectRef: "subject-a",
      ...target, capabilityKey: "repository.read", authorityPathRef: "authority-path-a",
    }),
    revisionVector: Object.freeze({
      contextRevision: "context-revision-a", authorityRevision: "authority-revision-a",
      capabilityRevision: "capability-revision-a", registryRevision: "registry-revision-a",
      credentialReadinessRevision: "credential-readiness-revision-a", resourceVersion: "resource-version-a",
    }),
    ...overrides,
  });
}
function result(label = "capsule", connectionRef = target.connectionRef) {
  return Object.freeze({
    status: "resolved", label,
    context: Object.freeze({
      contextHash: "context-hash-a", contextRevision: "context-revision-a",
      ...target, connectionRef,
      selectedCandidate: Object.freeze({ ...target, connectionRef }),
    }),
  });
}
const lanes = ["tenant_read", "admin_read", "governed_mutation"];
const certificate = createExecutionCapsuleRolloutEvaluator().evaluate({
  samples: lanes.flatMap((lane) => [0, 1].map((index) => ({
    sampleRef: `${lane}-${index}`, lane, legacyDurationMs: 100, capsuleDurationMs: 40,
    legacyCandidateEnumerations: 10, capsuleCandidateEnumerations: 3,
    parityMatch: true, exactTargetRetained: true, authoritySafe: true,
    staleAuthorityAccepted: false, ambiguitySuppressed: false,
    crossTenantAccess: false, connectionSubstituted: false,
  }))),
  rollbackEvidence: {
    exactOwnerIsolationRetained: true, failClosedWhenGuardUnavailable: true,
    legacyResolverRestorable: true, providerDispatchPerformed: false,
    databaseWritePerformed: false, credentialMutationPerformed: false,
  },
});
const request = input();
const legacyResult = result("legacy");
const capsuleResult = result("capsule");
let legacyCalls = 0;
let capsuleCalls = 0;
const legacy = { async resolve(value) { legacyCalls += 1; assert.equal(value, request); return legacyResult; } };
const capsule = { async resolve() { capsuleCalls += 1; return capsuleResult; } };

const disabled = createExecutionCapsuleRolloutCoordinator({ legacyResolutionService: legacy });
assert.equal(await disabled.resolve(request), legacyResult);
assert.equal(legacyCalls, 1);
assert.equal(capsuleCalls, 0);

legacyCalls = 0;
capsuleCalls = 0;
const shadowEvents = [];
const shadow = createExecutionCapsuleRolloutCoordinator({
  mode: "shadow", legacyResolutionService: legacy, capsuleResolutionService: capsule,
  emitTelemetry: async (event) => shadowEvents.push(event),
});
assert.equal(await shadow.resolve(request), legacyResult);
assert.equal(legacyCalls, 1);
assert.equal(capsuleCalls, 1);
assert.equal(shadowEvents[0].legacyAuthoritative, true);
assert.equal(shadowEvents[0].parityMatched, true);
assert(Object.isFrozen(shadowEvents[0]));

assert.throws(() => createExecutionCapsuleRolloutCoordinator({
  mode: "canary", legacyResolutionService: legacy, capsuleResolutionService: capsule,
  certification: { status: "certified", rolloutAllowed: true },
}), (error) => error instanceof ExecutionCapsuleRolloutError &&
  error.code === "execution_capsule_rollout_certificate_untrusted");

legacyCalls = 0;
capsuleCalls = 0;
const canary = createExecutionCapsuleRolloutCoordinator({
  mode: "canary", legacyResolutionService: legacy, capsuleResolutionService: capsule,
  certification: certificate, canarySelector: () => true,
  rollbackIsolationGuard: (evidence) => evidence.exactOwnerIsolationRetained === true,
});
assert.equal(await canary.resolve(request), capsuleResult);
assert.equal(await canary.resolve(request), capsuleResult);
assert.equal(legacyCalls, 0);
assert.equal(capsuleCalls, 1);
assert.equal(canary.snapshot().cacheHits, 1);
const moved = input({ revisionVector: Object.freeze({ ...request.revisionVector, authorityRevision: "authority-revision-b" }) });
assert.equal(await canary.resolve(moved), capsuleResult);
assert.equal(capsuleCalls, 2);
assert.equal(canary.invalidateRevisionVector(moved), true);

let fallbackCalls = 0;
const mismatch = createExecutionCapsuleRolloutCoordinator({
  mode: "canary",
  legacyResolutionService: { async resolve() { fallbackCalls += 1; return legacyResult; } },
  capsuleResolutionService: { async resolve() { return result("mismatch", "connection-b"); } },
  certification: certificate, canarySelector: () => true,
});
await assert.rejects(() => mismatch.resolve(request), (error) =>
  error.code === "context_re_resolution_required" &&
  error.reasonCodes.includes("execution_capsule_rollout_target_substitution_blocked"));
assert.equal(fallbackCalls, 0);

legacyCalls = 0;
capsuleCalls = 0;
const retired = createExecutionCapsuleRolloutCoordinator({
  mode: "retired", legacyResolutionService: legacy, capsuleResolutionService: capsule,
  certification: certificate,
  rollbackIsolationGuard: (evidence) => evidence.exactOwnerIsolationRetained === true,
});
assert.equal(await retired.resolve(request), capsuleResult);
assert.equal(legacyCalls, 0);
assert.equal(capsuleCalls, 1);
assert.equal(retired.legacyRetired, true);
const unsafeRollback = retired.rollback({ exactOwnerIsolationRetained: false });
assert.equal(unsafeRollback.mode, "fail_closed");
await assert.rejects(() => unsafeRollback.resolve(request), (error) =>
  error.code === "execution_capsule_rollout_rollback_isolation_unavailable");
assert.equal(retired.rollback({ exactOwnerIsolationRetained: true }).mode, "canary");

const telemetryOutage = createExecutionCapsuleRolloutCoordinator({
  mode: "canary", legacyResolutionService: legacy, capsuleResolutionService: capsule,
  certification: certificate, canarySelector: () => true,
  emitTelemetry: async () => { throw new Error("unavailable"); },
});
assert.equal(await telemetryOutage.resolve(request), capsuleResult);

const root = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(path.join(root, "contextKernel/integration/executionCapsuleRolloutCoordinator.js"), "utf8");
for (const forbidden of ["process.env", "fetch(", "axios", "mysql", "mariadb"]) {
  assert.equal(source.toLowerCase().includes(forbidden), false, `source must exclude ${forbidden}`);
}
const testManifest = await readFile(path.join(root, "scripts/test-manifest.mjs"), "utf8");
assert.equal(testManifest.split("node test-execution-capsule-rollout-evaluator.mjs").length - 1, 1);
assert.equal(testManifest.split("node test-execution-capsule-rollout-coordinator.mjs").length - 1, 1);
const ec5 = JSON.parse(await readFile(path.join(root, "specs/ec5-execution-capsule-rollout-retirement.manifest.json"), "utf8"));
assert.equal(ec5.status, "in_progress");
assert.equal(ec5.runtime_authority, false);
assert.equal(ec5.rollout_contract.minimum_median_improvement, 0.4);
assert.equal(ec5.rollout_contract.minimum_candidate_enumeration_reduction, 0.6);
const parent = JSON.parse(await readFile(path.join(root, "specs/execution-capsule-runtime-extension.manifest.json"), "utf8"));
assert.equal(parent.slice_status.EC5_rollout_and_duplicate_resolver_retirement, "in_progress");
assert.equal(parent.runtime_authority, false);

console.log("Execution Capsule EC5 rollout coordinator tests passed.");
