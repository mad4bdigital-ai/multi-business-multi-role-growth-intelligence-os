import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildActivationDeploymentObservation,
  correlateActivationDeploymentObservation,
} from "./activationDeploymentObservationService.js";
import {
  ACTIVATION_DEPLOYMENT_EXPOSURE_LEVELS,
  ACTIVATION_DEPLOYMENT_FRESHNESS_BOUNDS_MS,
  ACTIVATION_DEPLOYMENT_PRINCIPAL_CEILINGS,
  ACTIVATION_DEPLOYMENT_STATES,
  classifyActivationDeployment,
  createActivationDeploymentProjectionService,
  deriveOpaqueDeploymentReleaseId,
  projectActivationDeploymentEvidence,
} from "./activationDeploymentProjectionService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const expectedSha = "a".repeat(40);
const staleSha = "b".repeat(40);
const futureSha = "c".repeat(40);
const observationTime = "2026-07-30T10:00:00.000Z";
const requestTime = "2026-07-30T10:05:00.000Z";
const freshnessWindowMs = 15 * 60 * 1000;

function sourceEvidence(value, sourceRef, observedAt = observationTime) {
  return {
    value,
    source_type: "governed_test_evidence",
    source_ref: sourceRef,
    observed_at: observedAt,
  };
}

function baseObservation({
  observation_id = "11111111-1111-4111-8111-111111111111",
  expected_sha = expectedSha,
  deployed_sha = expectedSha,
  observed_at = observationTime,
  health = "pass",
  contract = "pass",
  omit = [],
} = {}) {
  const value = {
    observation_id,
    environment_key: "production",
    observed_at,
    expected_release: {
      commit_sha: expected_sha,
      release_id: `reviewed_${expected_sha.slice(0, 8)}`,
      source_type: "github_main_readback",
      source_ref: `github:main:${expected_sha}`,
      observed_at,
    },
    deployed_release: {
      commit_sha: deployed_sha,
      release_id: `deployed_${deployed_sha.slice(0, 8)}`,
      source_type: "runtime_manifest",
      source_ref: `runtime:manifest:${deployed_sha}`,
      observed_at,
      deployed_at: observed_at,
    },
    health: {
      value: health,
      source_type: "runtime_health_probe",
      source_ref: "health:probe:run-100",
      observed_at,
    },
    contract: {
      version: "activation-contract-v3",
      status: contract,
      source_type: "contract_guard",
      source_ref: "contract:guard:run-200",
      observed_at,
    },
    migration: {
      value: "pass",
      source_type: "migration_ledger_readback",
      source_ref: "migration:ledger:run-300",
      observed_at,
    },
    metadata: {},
  };
  for (const field of omit) delete value[field];
  return buildActivationDeploymentObservation(value);
}

function correlation(observation, request_time = requestTime) {
  return correlateActivationDeploymentObservation([observation], {
    environment_key: "production",
    request_time,
  });
}

function classify(observation, options = {}, request_time = requestTime) {
  return classifyActivationDeployment(correlation(observation, request_time), {
    freshness_window_ms: freshnessWindowMs,
    ...options,
  });
}

assert.deepEqual(ACTIVATION_DEPLOYMENT_STATES, [
  "current",
  "deploying",
  "stale",
  "diverged",
  "unknown",
]);
assert.deepEqual(ACTIVATION_DEPLOYMENT_EXPOSURE_LEVELS, [
  "none",
  "opaque",
  "diagnostic",
  "admin_full",
]);
assert.deepEqual(ACTIVATION_DEPLOYMENT_PRINCIPAL_CEILINGS, {
  public: "diagnostic",
  tenant: "diagnostic",
  admin: "admin_full",
  service: "admin_full",
});
assert.equal(Object.isFrozen(ACTIVATION_DEPLOYMENT_PRINCIPAL_CEILINGS), true);
assert.equal(ACTIVATION_DEPLOYMENT_FRESHNESS_BOUNDS_MS.min, 1000);
assert(ACTIVATION_DEPLOYMENT_FRESHNESS_BOUNDS_MS.max >= freshnessWindowMs);

const currentObservation = baseObservation();
const current = classify(currentObservation, {
  authorized_lineage_match: sourceEvidence(true, "lineage:check:current"),
  environment_match: sourceEvidence(true, "environment:check:current"),
});
assert.equal(current.status, "current");
assert.equal(current.reason_code, "deployment_expected_runtime_health_contract_match");
assert.equal(current.runtime_version, current.expected_version);
assert.match(current.runtime_version, /^rel_[0-9a-f]{24}$/);
assert.equal(current.reconnect_required, false);
assert.equal(current.recommended_http_status, 200);
assert.equal(current.fresh, true);

const stableOpaqueA = deriveOpaqueDeploymentReleaseId({
  environment_key: "production",
  release: currentObservation.deployed_release,
});
const stableOpaqueB = deriveOpaqueDeploymentReleaseId({
  environment_key: "production",
  release: { ...currentObservation.deployed_release, release_id: "different_internal_id" },
});
const otherEnvironmentOpaque = deriveOpaqueDeploymentReleaseId({
  environment_key: "staging",
  release: currentObservation.deployed_release,
});
assert.equal(stableOpaqueA, stableOpaqueB);
assert.notEqual(stableOpaqueA, otherEnvironmentOpaque);
assert.equal(stableOpaqueA.includes(expectedSha), false);

const deployingObservation = baseObservation({
  observation_id: "22222222-2222-4222-8222-222222222222",
  deployed_sha: staleSha,
});
const deploying = classify(deployingObservation, {
  deployment_in_progress: sourceEvidence(true, "deployment:progress:run-1", requestTime),
  authorized_lineage_match: sourceEvidence(true, "lineage:check:deploying"),
  environment_match: sourceEvidence(true, "environment:check:deploying"),
});
assert.equal(deploying.status, "deploying");
assert.equal(deploying.reason_code, "deployment_reviewed_release_in_progress");
assert.equal(deploying.recommended_http_status, 202);
assert.equal(deploying.reconnect_required, false);

const stale = classify(deployingObservation, {
  deployment_in_progress: sourceEvidence(false, "deployment:progress:run-2"),
  authorized_lineage_match: sourceEvidence(true, "lineage:check:stale"),
  environment_match: sourceEvidence(true, "environment:check:stale"),
  expected_release_sequence: sourceEvidence(20, "release:sequence:expected"),
  deployed_release_sequence: sourceEvidence(19, "release:sequence:deployed"),
});
assert.equal(stale.status, "stale");
assert.equal(stale.reason_code, "deployment_runtime_older_than_expected");
assert.equal(stale.recommended_http_status, 202);
assert.equal(stale.reconnect_required, false);

const divergedLineage = classify(deployingObservation, {
  authorized_lineage_match: sourceEvidence(false, "lineage:check:diverged"),
  environment_match: sourceEvidence(true, "environment:check:diverged"),
});
assert.equal(divergedLineage.status, "diverged");
assert.equal(divergedLineage.reason_code, "deployment_release_lineage_mismatch");
assert.equal(divergedLineage.reconnect_required, false);
assert.equal(divergedLineage.recommended_http_status, 503);

const divergedEnvironment = classify(deployingObservation, {
  authorized_lineage_match: sourceEvidence(true, "lineage:check:environment"),
  environment_match: sourceEvidence(false, "environment:check:diverged"),
});
assert.equal(divergedEnvironment.status, "diverged");
assert.equal(divergedEnvironment.reason_code, "deployment_environment_mismatch");

const divergedNewer = classify(
  baseObservation({
    observation_id: "33333333-3333-4333-8333-333333333333",
    deployed_sha: futureSha,
  }),
  {
    authorized_lineage_match: sourceEvidence(true, "lineage:check:newer"),
    environment_match: sourceEvidence(true, "environment:check:newer"),
    expected_release_sequence: sourceEvidence(20, "release:sequence:expected-newer"),
    deployed_release_sequence: sourceEvidence(21, "release:sequence:deployed-newer"),
  },
);
assert.equal(divergedNewer.status, "diverged");
assert.equal(divergedNewer.reason_code, "deployment_runtime_newer_than_expected_state");

const unknownNoOrdering = classify(deployingObservation, {
  authorized_lineage_match: sourceEvidence(true, "lineage:check:unknown"),
  environment_match: sourceEvidence(true, "environment:check:unknown"),
});
assert.equal(unknownNoOrdering.status, "unknown");
assert.equal(unknownNoOrdering.reason_code, "deployment_release_ordering_evidence_unavailable");
assert.equal(unknownNoOrdering.reconnect_required, false);

const unknownContract = classify(
  baseObservation({
    observation_id: "44444444-4444-4444-8444-444444444444",
    contract: "fail",
  }),
);
assert.equal(unknownContract.status, "unknown");
assert.equal(unknownContract.reason_code, "deployment_contract_evidence_invalid");

const unknownHealth = classify(
  baseObservation({
    observation_id: "55555555-5555-4555-8555-555555555555",
    health: "fail",
  }),
);
assert.equal(unknownHealth.status, "unknown");
assert.equal(unknownHealth.reason_code, "deployment_health_evidence_not_pass");

const oldObservation = baseObservation({
  observation_id: "66666666-6666-4666-8666-666666666666",
  observed_at: "2026-07-30T09:00:00.000Z",
});
const unknownFreshness = classifyActivationDeployment(
  correlation(oldObservation, requestTime),
  { freshness_window_ms: freshnessWindowMs },
);
assert.equal(unknownFreshness.status, "unknown");
assert.equal(
  unknownFreshness.reason_code,
  "deployment_observation_outside_freshness_window",
);

const unknownNoObservation = classifyActivationDeployment(
  {
    correlation_status: "not_found",
    environment_key: "production",
    request_time: requestTime,
    observation: null,
    future_observations_ignored: 0,
    historical_correlation: true,
    classification_status: "not_computed",
    secrets_included: false,
  },
  { freshness_window_ms: freshnessWindowMs },
);
assert.equal(unknownNoObservation.status, "unknown");
assert.equal(unknownNoObservation.reason_code, "deployment_observation_unavailable");
assert.equal(unknownNoObservation.runtime_version, null);

assert.throws(
  () => classifyActivationDeployment(correlation(currentObservation), {}),
  (error) => error?.code === "activation_deployment_freshness_window_invalid",
);
assert.throws(
  () =>
    classify(currentObservation, {
      authorized_lineage_match: sourceEvidence(
        true,
        "lineage:future:evidence",
        "2026-07-30T10:06:00.000Z",
      ),
    }),
  (error) =>
    error?.code === "activation_deployment_authorized_lineage_match_after_request_time" &&
    error?.status === 409,
);
assert.throws(
  () =>
    classify(currentObservation, {
      expected_release_sequence: sourceEvidence(-1, "release:sequence:negative"),
    }),
  (error) => error?.code === "activation_deployment_expected_release_sequence_invalid",
);

const noneProjection = projectActivationDeploymentEvidence(current, {
  principal_type: "tenant",
  exposure_level: "none",
  include_revision_header: true,
});
assert.equal(noneProjection.deployment, null);
assert.deepEqual(noneProjection.headers, {});

const opaqueProjection = projectActivationDeploymentEvidence(stale, {
  principal_type: "tenant",
  exposure_level: "opaque",
  include_revision_header: true,
});
assert.deepEqual(opaqueProjection.deployment, {
  status: "stale",
  runtime_version: stale.runtime_version,
});
assert.equal(opaqueProjection.headers["Deployment-Revision"], stale.runtime_version);
assert.equal(Object.hasOwn(opaqueProjection.deployment, "observed_at"), false);
assert.equal(Object.hasOwn(opaqueProjection.deployment, "expected_version"), false);

const diagnosticProjection = projectActivationDeploymentEvidence(stale, {
  principal_type: "tenant",
  exposure_level: "diagnostic",
  include_revision_header: true,
});
assert.equal(diagnosticProjection.deployment.status, "stale");
assert.equal(diagnosticProjection.deployment.runtime_version, stale.runtime_version);
assert.equal(diagnosticProjection.deployment.expected_version, stale.expected_version);
assert.equal(diagnosticProjection.deployment.reconnect_required, false);
assert.equal(
  diagnosticProjection.headers["Deployment-Revision"],
  diagnosticProjection.deployment.runtime_version,
);
const diagnosticJson = JSON.stringify(diagnosticProjection);
assert.equal(diagnosticJson.includes(expectedSha), false);
assert.equal(diagnosticJson.includes(staleSha), false);
assert.doesNotMatch(
  diagnosticJson,
  /source_ref|commit_sha|repository|branch|filesystem|credential|authorization|token/i,
);

assert.throws(
  () =>
    projectActivationDeploymentEvidence(current, {
      principal_type: "tenant",
      exposure_level: "admin_full",
    }),
  (error) =>
    error?.code === "activation_deployment_exposure_not_allowed" && error?.status === 403,
);
assert.throws(
  () =>
    projectActivationDeploymentEvidence(current, {
      principal_type: "public",
      exposure_level: "admin_full",
    }),
  (error) =>
    error?.code === "activation_deployment_exposure_not_allowed" && error?.status === 403,
);

const adminProjection = projectActivationDeploymentEvidence(stale, {
  principal_type: "admin",
  exposure_level: "admin_full",
  include_revision_header: true,
});
assert.equal(adminProjection.deployment.expected_release.commit_sha, expectedSha);
assert.equal(adminProjection.deployment.deployed_release.commit_sha, staleSha);
assert.match(adminProjection.deployment.expected_release.source_ref, /^github:/);
assert.equal(adminProjection.deployment.secrets_included, false);
assert.equal(
  adminProjection.headers["Deployment-Revision"],
  adminProjection.deployment.runtime_version,
);

for (const classification of [
  current,
  deploying,
  stale,
  divergedLineage,
  divergedEnvironment,
  divergedNewer,
  unknownNoOrdering,
  unknownContract,
  unknownHealth,
  unknownFreshness,
  unknownNoObservation,
]) {
  assert.equal(classification.reconnect_required, false);
}

const service = createActivationDeploymentProjectionService();
assert.equal(Object.isFrozen(service), true);
const combined = service.classifyAndProject(
  correlation(currentObservation),
  {
    freshness_window_ms: freshnessWindowMs,
    authorized_lineage_match: sourceEvidence(true, "lineage:combined"),
    environment_match: sourceEvidence(true, "environment:combined"),
  },
  {
    principal_type: "tenant",
    exposure_level: "diagnostic",
    include_revision_header: true,
  },
);
assert.equal(combined.classification.status, "current");
assert.equal(
  combined.projection.headers["Deployment-Revision"],
  combined.projection.deployment.runtime_version,
);

const serviceSource = fs.readFileSync(
  path.join(__dirname, "activationDeploymentProjectionService.js"),
  "utf8",
);
assert.doesNotMatch(
  serviceSource,
  /deployment_evidence_exposure_policy|questionnaire|registry_readback|cache_invalidation/i,
  "T024A must not implement T024B policy registry behavior",
);
assert.doesNotMatch(serviceSource, /oauth_reconnect|reconnect_required:\s*true/i);

for (const runtimeFile of [
  "server.js",
  "routes/releaseRoutes.js",
  "runtimeVerificationService.js",
]) {
  const runtimeSource = fs.readFileSync(path.join(__dirname, runtimeFile), "utf8");
  assert.doesNotMatch(
    runtimeSource,
    /activationDeploymentProjectionService/,
    `${runtimeFile} must not wire T024A before interface and policy integration`,
  );
}

console.log("activation deployment projection service tests passed");
