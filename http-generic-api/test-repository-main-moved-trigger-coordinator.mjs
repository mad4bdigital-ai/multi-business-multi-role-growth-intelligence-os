import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRepositoryMainMovedFingerprint,
  deriveRepositoryMainMovedOutcome,
  normalizeRepositoryMainMovedEvent,
  resolveConfiguredReleaseBranch,
  resolveConfiguredSourceBranch,
} from "./repositoryMainMovedTriggerService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repository = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const beforeSha = "a".repeat(40);
const afterSha = "b".repeat(40);
const env = { RELEASE_TRIGGER_REPOSITORY: repository };

assert.equal(resolveConfiguredReleaseBranch({}), "main");
assert.equal(resolveConfiguredReleaseBranch({ ACTIVATION_GITHUB_BRANCH: "Production" }), "Production");
assert.equal(resolveConfiguredReleaseBranch({ GITHUB_DEFAULT_BRANCH: "stable" }), "stable");
assert.equal(resolveConfiguredReleaseBranch({
  RELEASE_TRIGGER_BRANCH: "release/candidate",
  ACTIVATION_GITHUB_BRANCH: "Production",
}), "release/candidate");

const normalized = normalizeRepositoryMainMovedEvent({
  source_event_id: "delivery-1",
  repository,
  branch: "refs/heads/main",
  before_sha: beforeSha,
  after_sha: afterSha,
  environment_key: "production",
  occurred_at: "2026-07-16T12:00:00.000Z",
}, { env });
assert.equal(normalized.repository, repository);
assert.equal(normalized.branch, "main");
assert.equal(normalized.before_sha, beforeSha);
assert.equal(normalized.after_sha, afterSha);
assert.equal(normalized.deleted, false);

const productionEnv = {
  RELEASE_TRIGGER_REPOSITORY: repository,
  ACTIVATION_GITHUB_BRANCH: "Production",
};
const productionNormalized = normalizeRepositoryMainMovedEvent({
  ...normalized,
  branch: "refs/heads/Production",
  source_event_id: "delivery-production",
}, { env: productionEnv });
assert.equal(productionNormalized.branch, "Production");

assert.throws(
  () => normalizeRepositoryMainMovedEvent({ ...productionNormalized, branch: "main" }, { env: productionEnv }),
  (error) => error.code === "repository_main_moved_branch_not_supported"
    && error.status === 400
    && error.details?.expected_branch === "Production",
);

assert.throws(
  () => normalizeRepositoryMainMovedEvent({ ...normalized, repository: "other/repository" }, { env }),
  (error) => error.code === "repository_main_moved_repository_not_allowed" && error.status === 403,
);
assert.throws(
  () => normalizeRepositoryMainMovedEvent({ ...normalized, branch: "develop" }, { env }),
  (error) => error.code === "repository_main_moved_branch_not_supported" && error.status === 400,
);
assert.throws(
  () => normalizeRepositoryMainMovedEvent({ ...normalized, after_sha: beforeSha }, { env }),
  (error) => error.code === "repository_main_moved_no_change" && error.status === 409,
);
assert.throws(
  () => normalizeRepositoryMainMovedEvent({ ...normalized, deleted: true }, { env }),
  (error) => error.code === "repository_main_moved_deleted_ref_blocked" && error.status === 409,
);
assert.throws(
  () => normalizeRepositoryMainMovedEvent({ ...normalized, environment_key: "development" }, { env }),
  (error) => error.code === "repository_main_moved_environment_invalid" && error.status === 400,
);

const fingerprintA = buildRepositoryMainMovedFingerprint(normalized);
const fingerprintB = buildRepositoryMainMovedFingerprint({ ...normalized, source_event_id: "delivery-2" });
assert.equal(fingerprintA, fingerprintB, "source delivery retries must deduplicate by repository, branch, and after SHA");
assert.match(fingerprintA, /^[0-9a-f]{64}$/);

const noAction = deriveRepositoryMainMovedOutcome({
  verification: { production_parity: "verified" },
  advisor: { advisor_run: { advisor_status: "no_action", requires_approval: false } },
});
assert.equal(noAction.coordination_status, "no_action");
assert.equal(noAction.next_action_key, "release.no_action");

const approvalRequired = deriveRepositoryMainMovedOutcome({
  verification: { production_parity: "degraded" },
  advisor: { advisor_run: { advisor_status: "review_required", requires_approval: true } },
});
assert.equal(approvalRequired.coordination_status, "approval_required");
assert.equal(approvalRequired.next_action_key, "release.await_typed_approval");

const blocked = deriveRepositoryMainMovedOutcome({
  verification: { production_parity: "degraded" },
  advisor: { advisor_run: { advisor_status: "blocked", requires_approval: false } },
});
assert.equal(blocked.coordination_status, "blocked");

for (const result of [noAction, approvalRequired, blocked]) {
  assert.equal(result.execution_allowed, false);
  assert.equal(result.release_operation_created, false);
  assert.equal(result.gate_opened, false);
  assert.equal(result.capability_envelope_created, false);
  assert.equal(result.job_enqueued, false);
  assert.equal(result.deploy_executed, false);
  assert.equal(result.restart_executed, false);
  assert.equal(result.provider_call_performed, false);
  assert.equal(result.external_write_performed, false);
  assert.equal(result.secrets_included, false);
}

const service = fs.readFileSync(path.join(__dirname, "repositoryMainMovedTriggerService.js"), "utf8");
for (const required of [
  "enqueuePlatformOutboxEvent",
  "createRuntimeVerificationRun",
  "createReleaseAdvisorRun",
  "REPOSITORY_MAIN_MOVED_EVENT_TYPE",
  "release.await_typed_approval",
]) assert.match(service, new RegExp(required));
for (const forbidden of [
  "createReleaseOperation(",
  "openReleaseGate(",
  "createCapabilityEnvelopeFromTemplate(",
  "submitHostingerAsyncDeploy(",
  "runHostingerAsyncDeployJob(",
]) assert.equal(service.includes(forbidden), false, `coordinator must not call ${forbidden}`);
const metadataSlice = service.slice(service.indexOf("metadata: {"), service.indexOf("sourceEnvironment:", service.indexOf("metadata: {")));
assert.doesNotMatch(metadataSlice, /secrets_included/);
assert.match(service, /execution_allowed: false/);
assert.match(service, /job_enqueued: false/);

const migration = fs.readFileSync(path.join(__dirname, "migrations", "20260716_repository_main_moved_trigger_coordinator.sql"), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS repository_main_moved_trigger_events/);
assert.match(migration, /'repository\.main_moved'/);
assert.match(migration, /repository_main_moved_event_create/);
assert.match(migration, /repository_main_moved_event_get/);
assert.match(migration, /repository_main_moved_trigger_policy_v1/);
for (const marker of [
  "mutation_policy_required",
  "capability_envelope",
  "approval_required",
  "readback",
  "same_cycle_readback",
]) assert.match(migration, new RegExp(marker));
assert.match(migration, /transactional_outbox_required',true/);
assert.match(migration, /release_operation_creation_forbidden',true/);
assert.match(migration, /job_enqueue_forbidden',true/);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE)\b/i);

const openapi = fs.readFileSync(path.join(__dirname, "openapi", "repository-main-moved-trigger.yaml"), "utf8");
assert.match(openapi, /openapi: 3\.1\.0/);
assert.match(openapi, /operationId: createRepositoryMainMovedEvent/);
assert.match(openapi, /operationId: getRepositoryMainMovedEvent/);
assert.match(openapi, /\/admin\/repository-main-moved-events/);
assert.match(openapi, /execution_allowed: \{ type: boolean, const: false \}/);

const activation = JSON.parse(fs.readFileSync(
  path.join(__dirname, "activation-surfaces", "repository_main_moved_trigger_events.json"),
  "utf8",
));
assert.equal(activation.source_table, "repository_main_moved_trigger_events");
assert.equal(activation.result_columns.includes("summary_json"), false);
assert.equal(activation.result_columns.includes("error_message"), false);

const route = fs.readFileSync(path.join(__dirname, "routes", "repositoryMainMovedTriggerRoutes.js"), "utf8");
assert.match(route, /POST|post/);
assert.match(route, /repository-main-moved-events/);

const routesIndex = fs.readFileSync(path.join(__dirname, "routes", "index.js"), "utf8");
assert.match(routesIndex, /buildRepositoryMainMovedTriggerRoutes/);
assert.match(routesIndex, /app\.use\(buildRepositoryMainMovedTriggerRoutes/);

const testManifest = fs.readFileSync(path.join(__dirname, "scripts", "test-manifest.mjs"), "utf8");
assert.match(testManifest, /test-repository-main-moved-trigger-coordinator\.mjs/);

console.log("repository main moved trigger coordinator tests passed");
