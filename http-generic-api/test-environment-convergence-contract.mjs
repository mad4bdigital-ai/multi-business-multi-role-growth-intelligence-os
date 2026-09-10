#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertActivationGatewayProfilePolicy,
  classifyEnvironmentCertification,
  getEnvironmentConvergenceProfile,
  readEnvironmentConvergenceRegistry,
  validateEnvironmentConvergenceRegistry,
} from "./environmentConvergenceRegistry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
const readText = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

const registry = readEnvironmentConvergenceRegistry();
const validation = validateEnvironmentConvergenceRegistry(registry);
assert.equal(validation.ok, true, validation.errors.join(", "));
assert.equal(registry.state_machine.key, "environment_convergence.v1");
assert.deepEqual(registry.state_machine.stages, [
  "observe",
  "classify",
  "plan",
  "approval_checkpoint",
  "apply",
  "verify",
  "certify",
]);
assert.equal(registry.state_machine.certification_is_final_judge, true);
assert.equal(registry.state_machine.certification_may_mutate, false);
assert.equal(registry.release_spec.ready_requires_all_required_components_same_release_identity, true);
assert.equal(registry.release_spec.credentials_allowed, false);
assert.equal(registry.release_spec.provider_commands_allowed, false);

const staging = getEnvironmentConvergenceProfile("staging", registry);
const production = getEnvironmentConvergenceProfile("production", registry);
assert.equal(staging.state_machine, production.state_machine);
assert.equal(staging.source_branch, "main");
assert.equal(production.source_branch, "Production");
assert.equal(production.upstream_branch, "main");
assert.equal(staging.provider_mutation_implementation, null);
assert.equal(production.provider_mutation_implementation, null);

const deploymentBranchPolicy = readJson("http-generic-api/config/deployment-branch-policy.json");
assert.equal(staging.source_branch, deploymentBranchPolicy.staging.source_branch);
assert.equal(production.source_branch, deploymentBranchPolicy.production.source_branch);
assert.equal(production.upstream_branch, deploymentBranchPolicy.production.upstream_branch);

const stagingPolicy = readJson(staging.activation_gateway.policy_path);
const productionPolicy = readJson(production.activation_gateway.policy_path);
const stagingProfileCheck = assertActivationGatewayProfilePolicy("staging", stagingPolicy, registry);
const productionProfileCheck = assertActivationGatewayProfilePolicy("production", productionPolicy, registry);
assert.equal(stagingProfileCheck.ok, true, JSON.stringify(stagingProfileCheck));
assert.equal(productionProfileCheck.ok, true, JSON.stringify(productionProfileCheck));
assert.equal(stagingPolicy.policy_key, "activation_gateway_staging");
assert.equal(stagingPolicy.public_host, "activation-dev.mad4b.com");
assert.equal(productionPolicy.policy_key, "activation_gateway");
assert.equal(productionPolicy.public_host, "activation.mad4b.com");
assert.notEqual(stagingPolicy.policy_key, productionPolicy.policy_key);
assert.notEqual(stagingPolicy.public_host, productionPolicy.public_host);

const exactCommitDrift = classifyEnvironmentCertification({
  outcome: "blocked",
  expected: { commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  gateway: { health: { sourceCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } },
  integrity_checks: [
    {
      key: "gateway_exact_commit",
      ok: false,
      severity: "blocking",
      detail: {
        expected: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        observed: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    },
  ],
  readiness_checks: [],
}, { environment: "staging", registry });
assert.equal(exactCommitDrift.status, "reconciliation_required");
assert.equal(exactCommitDrift.classified_failures.length, 1);
assert.equal(exactCommitDrift.unclassified_failures.length, 0);
assert.equal(exactCommitDrift.classified_failures[0].failure_kind, "convergence_drift");
assert.equal(exactCommitDrift.classified_failures[0].drift_class, "release_identity_mismatch");
assert.equal(exactCommitDrift.classified_failures[0].handoff.plan_capability, "activation_gateway_rollout_plan");
assert.equal(exactCommitDrift.classified_failures[0].handoff.apply_capability, "activation_gateway_dark_deploy");
assert.equal(exactCommitDrift.classified_failures[0].handoff.profile_binding_required, true);
assert.equal(exactCommitDrift.classified_failures[0].handoff.automatic_apply_allowed, false);
assert.equal(exactCommitDrift.safety.mutation_performed, false);

const unavailableGateway = classifyEnvironmentCertification({
  outcome: "blocked",
  expected: { commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  gateway: { health: { status: 0, error: "fetch_failed" } },
  integrity_checks: [
    { key: "gateway_health_reachable", ok: false, severity: "blocking", detail: { status: 0 } },
  ],
  readiness_checks: [],
}, { environment: "staging", registry });
assert.equal(unavailableGateway.status, "blocked");
assert.equal(unavailableGateway.classified_failures[0].failure_kind, "availability_failure");
assert.equal(unavailableGateway.classified_failures[0].repairability, "manual_or_external");
assert.equal(unavailableGateway.next_governed_handoff, null);

const currentCertification = readText("http-generic-api/scripts/staging-live-certification.mjs");
for (const checkKey of Object.keys(registry.dependencies.activation_gateway.checks)) {
  assert.match(currentCertification, new RegExp(`\\b${checkKey}\\b`), `Certification dependency ${checkKey} is not present in the live certification contract`);
}

for (const orchestratorPath of registry.orchestrator_boundary.orchestrators) {
  const orchestrator = readText(orchestratorPath);
  for (const forbiddenToken of registry.orchestrator_boundary.forbidden_implementation_tokens) {
    assert.equal(orchestrator.toLowerCase().includes(forbiddenToken.toLowerCase()), false, `${orchestratorPath} contains forbidden provider-mutation implementation token: ${forbiddenToken}`);
  }
}

const gatewayConverger = readText("autopilot-portable-staging/Converge-StagingActivationGateway.ps1");
assert.match(gatewayConverger, /operation=deploy_activation_worker/);
assert.equal(staging.activation_gateway.current_authority_adapter, "staging_activation_worker_workflow");
assert.equal(staging.activation_gateway.target_authority_model, "server_governed");

console.log(JSON.stringify({
  ok: true,
  contract: registry.contract,
  state_machine: registry.state_machine.key,
  profiles: ["staging", "production"],
  gateway_exact_commit: "convergence_drift",
  staging_policy: {
    policy_key: stagingPolicy.policy_key,
    public_host: stagingPolicy.public_host,
  },
  production_policy: {
    policy_key: productionPolicy.policy_key,
    public_host: productionPolicy.public_host,
  },
  orchestrator_provider_mutation_implementation: false,
  secrets_included: false,
}));
