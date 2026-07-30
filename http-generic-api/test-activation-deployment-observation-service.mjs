import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVATION_DEPLOYMENT_CORRELATION_STATUS,
  ACTIVATION_DEPLOYMENT_EVIDENCE_MAX_BYTES,
  ACTIVATION_DEPLOYMENT_OBSERVATION_MAX_ITEMS,
  buildActivationDeploymentObservation,
  correlateActivationDeploymentObservation,
  createActivationDeploymentObservationService,
} from "./activationDeploymentObservationService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const expectedSha = "a".repeat(40);
const deployedSha = "b".repeat(40);

function observation(overrides = {}) {
  const observedAt = overrides.observed_at || "2026-07-30T10:00:00.000Z";
  return {
    observation_id: overrides.observation_id || "11111111-1111-4111-8111-111111111111",
    environment_key: overrides.environment_key || "production",
    observed_at: observedAt,
    expected_release: {
      commit_sha: expectedSha,
      release_id: "rel_expected",
      source_type: "github_main_readback",
      source_ref: `github:main:${expectedSha}`,
      observed_at: observedAt,
      ...(overrides.expected_release || {}),
    },
    deployed_release: {
      commit_sha: deployedSha,
      release_id: "rel_deployed",
      source_type: "runtime_manifest",
      source_ref: `runtime:manifest:${deployedSha}`,
      observed_at: observedAt,
      deployed_at: "2026-07-30T09:55:00.000Z",
      ...(overrides.deployed_release || {}),
    },
    health: {
      value: "pass",
      source_type: "runtime_health_probe",
      source_ref: "health:probe:run-100",
      observed_at: observedAt,
      ...(overrides.health || {}),
    },
    contract: {
      version: "activation-contract-v3",
      status: "pass",
      source_type: "contract_guard",
      source_ref: "contract:guard:run-200",
      observed_at: observedAt,
      ...(overrides.contract || {}),
    },
    migration: {
      value: "warn",
      source_type: "migration_ledger_readback",
      source_ref: "migration:ledger:run-300",
      observed_at: observedAt,
      ...(overrides.migration || {}),
    },
    metadata: overrides.metadata || { request_scope: "activation" },
  };
}

const complete = buildActivationDeploymentObservation(observation());
assert.equal(complete.environment_key, "production");
assert.equal(complete.evidence_complete, true);
assert.deepEqual(complete.missing_evidence, []);
assert.equal(complete.classification_status, "not_computed");
assert.equal(complete.classification_authority_required, true);
assert.equal(complete.secrets_included, false);
assert.match(complete.evidence_sha256, /^[0-9a-f]{64}$/);
assert(complete.evidence_bytes <= ACTIVATION_DEPLOYMENT_EVIDENCE_MAX_BYTES);
assert.equal(Object.isFrozen(complete), true);
assert.equal(Object.isFrozen(complete.expected_release), true);

const stableHashA = buildActivationDeploymentObservation(
  observation({ metadata: { b: 2, a: 1 } }),
);
const stableHashB = buildActivationDeploymentObservation(
  observation({ metadata: { a: 1, b: 2 } }),
);
assert.equal(stableHashA.evidence_sha256, stableHashB.evidence_sha256);

const sanitized = buildActivationDeploymentObservation(
  observation({
    metadata: {
      status: "bounded",
      authorization: "Bearer must disappear",
      nested: {
        password: "drop",
        token: "drop",
        api_key: "drop",
        retained: 2,
      },
    },
  }),
);
assert.equal(sanitized.metadata.authorization, undefined);
assert.equal(sanitized.metadata.nested.password, undefined);
assert.equal(sanitized.metadata.nested.token, undefined);
assert.equal(sanitized.metadata.nested.api_key, undefined);
assert.equal(sanitized.metadata.nested.retained, 2);

const incomplete = buildActivationDeploymentObservation({
  observation_id: "22222222-2222-4222-8222-222222222222",
  environment_key: "production",
  observed_at: "2026-07-30T10:00:00.000Z",
  expected_release: {
    release_id: "rel_expected_only",
    source_type: "release_registry",
    source_ref: "release:registry:expected",
    observed_at: "2026-07-30T10:00:00.000Z",
  },
  metadata: {},
});
assert.equal(incomplete.evidence_complete, false);
assert.deepEqual(incomplete.missing_evidence, [
  "expected_release.commit_sha",
  "deployed_release.commit_sha_or_release_id",
  "health",
  "contract",
]);
assert.equal(incomplete.classification_status, "not_computed");
assert.equal(Object.hasOwn(incomplete, "status"), false);

assert.throws(
  () =>
    buildActivationDeploymentObservation(
      observation({
        expected_release: {
          source_ref: "github:main:readback?token=secret",
        },
      }),
    ),
  (error) => error?.code === "activation_deployment_expected_release_source_ref_invalid",
);
assert.throws(
  () =>
    buildActivationDeploymentObservation(
      observation({ expected_release: { commit_sha: "short" } }),
    ),
  (error) => error?.code === "activation_deployment_expected_release_commit_sha_invalid",
);
assert.throws(
  () =>
    buildActivationDeploymentObservation(
      observation({ health: { value: "healthy_enough" } }),
    ),
  (error) => error?.code === "activation_deployment_health_value_invalid",
);
assert.throws(
  () =>
    buildActivationDeploymentObservation(
      observation({
        observed_at: "2026-07-30T10:00:00.000Z",
        health: { observed_at: "2026-07-30T10:00:01.000Z" },
      }),
    ),
  (error) =>
    error?.code === "activation_deployment_health_observed_at_after_observed_at" &&
    error?.status === 409,
);
assert.throws(
  () =>
    buildActivationDeploymentObservation(
      observation({
        deployed_release: {
          observed_at: "2026-07-30T10:00:00.000Z",
          deployed_at: "2026-07-30T10:00:01.000Z",
        },
      }),
    ),
  (error) =>
    error?.code ===
      "activation_deployment_deployed_release_deployed_at_after_deployed_release_observed_at" &&
    error?.status === 409,
);
assert.throws(
  () =>
    buildActivationDeploymentObservation(
      observation({ metadata: { values: Array.from({ length: 50 }, () => "x".repeat(1000)) } }),
    ),
  (error) =>
    error?.code === "activation_deployment_evidence_too_large" && error?.status === 413,
);

const historical = correlateActivationDeploymentObservation(
  [
    observation({
      observation_id: "33333333-3333-4333-8333-333333333333",
      observed_at: "2026-07-30T10:00:00.000Z",
    }),
    observation({
      observation_id: "44444444-4444-4444-8444-444444444444",
      observed_at: "2026-07-30T10:20:00.000Z",
      deployed_release: {
        commit_sha: "c".repeat(40),
        release_id: "rel_request_time",
        source_ref: `runtime:manifest:${"c".repeat(40)}`,
      },
    }),
    observation({
      observation_id: "55555555-5555-4555-8555-555555555555",
      observed_at: "2026-07-30T11:00:00.000Z",
      deployed_release: {
        commit_sha: "d".repeat(40),
        release_id: "rel_future",
        source_ref: `runtime:manifest:${"d".repeat(40)}`,
      },
    }),
    observation({
      observation_id: "66666666-6666-4666-8666-666666666666",
      environment_key: "dev",
      observed_at: "2026-07-30T10:25:00.000Z",
    }),
  ],
  {
    environment_key: "production",
    request_time: "2026-07-30T10:30:00.000Z",
  },
);
assert.equal(historical.correlation_status, ACTIVATION_DEPLOYMENT_CORRELATION_STATUS.FOUND);
assert.equal(historical.observation.observation_id, "44444444-4444-4444-8444-444444444444");
assert.equal(historical.observation.deployed_release.release_id, "rel_request_time");
assert.equal(historical.future_observations_ignored, 1);
assert.equal(historical.historical_correlation, true);
assert.equal(historical.observation_age_ms, 10 * 60 * 1000);
assert.equal(historical.classification_status, "not_computed");

const noHistoricalObservation = correlateActivationDeploymentObservation(
  [observation({ observed_at: "2026-07-30T11:00:00.000Z" })],
  {
    environment_key: "production",
    request_time: "2026-07-30T10:30:00.000Z",
  },
);
assert.deepEqual(noHistoricalObservation, {
  correlation_status: "not_found",
  environment_key: "production",
  request_time: "2026-07-30T10:30:00.000Z",
  observation: null,
  future_observations_ignored: 1,
  historical_correlation: true,
  classification_status: "not_computed",
  secrets_included: false,
});

assert.throws(
  () =>
    correlateActivationDeploymentObservation(
      Array.from({ length: ACTIVATION_DEPLOYMENT_OBSERVATION_MAX_ITEMS + 1 }, () =>
        observation(),
      ),
      {
        environment_key: "production",
        request_time: "2026-07-30T10:30:00.000Z",
      },
    ),
  (error) =>
    error?.code === "activation_deployment_observation_set_too_large" &&
    error?.status === 413,
);

const calls = [];
const repository = {
  async appendObservation(value) {
    calls.push({ type: "append", value });
    return { inserted: true, observation_id: value.observation_id };
  },
  async listObservations(filter) {
    calls.push({ type: "list", filter });
    return [
      observation({
        observation_id: "77777777-7777-4777-8777-777777777777",
        observed_at: "2026-07-30T10:15:00.000Z",
      }),
      observation({
        observation_id: "88888888-8888-4888-8888-888888888888",
        observed_at: "2026-07-30T10:45:00.000Z",
      }),
    ];
  },
};
const service = createActivationDeploymentObservationService({ repository });
assert.equal(Object.isFrozen(service), true);
const recorded = await service.recordObservation(
  observation({ observation_id: "99999999-9999-4999-8999-999999999999" }),
);
assert.equal(recorded.persistence.inserted, true);
assert.equal(calls[0].type, "append");
assert.equal(calls[0].value.classification_status, "not_computed");
const correlated = await service.correlateAtRequestTime({
  environment_key: "production",
  request_time: "2026-07-30T10:30:00.000Z",
});
assert.equal(correlated.observation.observation_id, "77777777-7777-4777-8777-777777777777");
assert.deepEqual(calls[1], {
  type: "list",
  filter: {
    environment_key: "production",
    observed_at_lte: "2026-07-30T10:30:00.000Z",
    limit: ACTIVATION_DEPLOYMENT_OBSERVATION_MAX_ITEMS,
  },
});

assert.throws(
  () => createActivationDeploymentObservationService({ repository: {} }),
  (error) => error?.code === "activation_deployment_repository_invalid" && error?.status === 500,
);

const source = fs.readFileSync(
  path.join(__dirname, "activationDeploymentObservationService.js"),
  "utf8",
);
for (const deploymentState of ["current", "deploying", "stale", "diverged"]) {
  assert.doesNotMatch(
    source,
    new RegExp(`classification_status:\\s*[\"']${deploymentState}[\"']`),
    `T024 must not implement T024A classification state ${deploymentState}`,
  );
}
assert.doesNotMatch(source, /Deployment-Revision|admin_full|tenant_projection/);

for (const runtimeFile of [
  "server.js",
  "routes/releaseRoutes.js",
  "runtimeVerificationService.js",
]) {
  const runtimeSource = fs.readFileSync(path.join(__dirname, runtimeFile), "utf8");
  assert.doesNotMatch(
    runtimeSource,
    /activationDeploymentObservationService/,
    `${runtimeFile} must not wire T024 before repository persistence and later exposure slices`,
  );
}

const taskSource = fs.readFileSync(
  path.join(__dirname, "..", "specs", "012-tenant-activation-lifecycle", "tasks.md"),
  "utf8",
);
assert.match(taskSource, /T024.*deployment observation adapter\/projection/i);
assert.match(taskSource, /T024A.*current.*deploying.*stale.*diverged.*unknown/i);

console.log("activation deployment observation service tests passed");
