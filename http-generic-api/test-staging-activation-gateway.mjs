import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  assertActivationGatewayProfilePolicy,
  classifyEnvironmentCertification,
  getEnvironmentConvergenceProfile,
  loadActivationGatewayProfilePolicy,
  readEnvironmentConvergenceRegistry,
  validateEnvironmentConvergenceRegistry,
} from "./environmentConvergenceRegistry.js";
import { runEnvironmentConvergence } from "./environmentConvergenceEngine.js";

process.env.NODE_ENV = "staging";
process.env.REMOTE_MCP_ENVIRONMENT = "staging";
process.env.ACTIVATION_STAGING_GATEWAY_ENABLED = "true";
process.env.REMOTE_MCP_TRUST_PROXY_HOST_HEADERS = "true";
const { buildActivationHostGatewayRoutes, activationHostGatewayAllowedPaths } = await import("./routes/activationHostGatewayRoutes.js");
const { buildStagingRecoveryAdminRoutes } = await import("./routes/stagingRecoveryAdminRoutes.js");

const app = express();
app.use(buildActivationHostGatewayRoutes({ enabled: true }));
app.use(buildStagingRecoveryAdminRoutes({
  env: process.env,
  requireBackendApiKey: (_req, _res, next) => next(),
  requireAdminPrincipal: (_req, _res, next) => next(),
}));
app.use((req, res) => res.status(404).json({ ok: false, code: "downstream_not_reached" }));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
try {
  const port = server.address().port;
  const get = (pathName, host) => fetch(`http://127.0.0.1:${port}${pathName}`, {
    headers: { "x-forwarded-host": host },
  });
  const getWithHeaders = (pathName, headers) => fetch(`http://127.0.0.1:${port}${pathName}`, { headers });
  const schema = await get("/openapi.tenant-gpt.activation.staging.yaml", "activation-dev.mad4b.com");
  assert.equal(schema.status, 200);
  const schemaText = await schema.text();
  assert.match(schemaText, /https:\/\/activation-dev\.mad4b\.com/);
  assert.doesNotMatch(schemaText, /https:\/\/auth\.mad4b\.com\/(?:auth|oauth)(?:\/|$)|https:\/\/activation\.mad4b\.com(?:\/|$)|https:\/\/mcp\.mad4b\.com(?:\/|$)/);
  const recoveryContract = await get("/admin/recovery/staging/contract", "activation-dev.mad4b.com");
  assert.equal(recoveryContract.status, 403, "host headers alone never prove Gateway ingress");
  const recoveryContractBody = await recoveryContract.json();
  assert.equal(recoveryContractBody.error.code, "RECOVERY_TRUSTED_INGRESS_REQUIRED");
  const directOriginRecovery = await get("/admin/recovery/staging/contract", "dev.mad4b.com");
  assert.equal(directOriginRecovery.status, 404);

  const adminSchema = await get("/openapi.custom-gpt.activation-admin.staging.yaml", "activation-dev.mad4b.com");
  assert.equal(adminSchema.status, 200);
  const adminSchemaText = await adminSchema.text();
  assert.match(adminSchemaText, /getStagingRecoveryAdminContract/);
  assert.match(adminSchemaText, /x-mad4b-registration:/);
  assert.match(adminSchemaText, /registration_set: admin_activation_staging/);
  const retiredRecoverySchema = await get("/openapi.custom-gpt.recovery-admin.staging.yaml", "activation-dev.mad4b.com");
  assert.equal(retiredRecoverySchema.status, 404, "standalone Recovery schema must not remain a public registration artifact");
  const conflictingHostClaims = await getWithHeaders("/openapi.tenant-gpt.activation.staging.yaml", {
    "x-forwarded-host": "untrusted.invalid",
    "x-original-host": "activation-dev.mad4b.com",
  });
  assert.equal(conflictingHostClaims.status, 404, "gateway must reject conflicting trusted host claims");
  const consistentHostClaims = await getWithHeaders("/openapi.tenant-gpt.activation.staging.yaml", {
    "x-forwarded-host": "activation-dev.mad4b.com",
    "x-original-host": "activation-dev.mad4b.com",
  });
  assert.equal(consistentHostClaims.status, 200, "gateway may accept repeated identical trusted host claims");
  const wrongHost = await get("/openapi.tenant-gpt.activation.staging.yaml", "dev.mad4b.com");
  assert.equal(wrongHost.status, 404);
  const forbidden = await get("/auth/login", "activation-dev.mad4b.com");
  assert.equal(forbidden.status, 404);
  const health = await get("/health", "activation-dev.mad4b.com");
  assert.equal(health.status, 503, "gateway must not report origin readiness without server deployment evidence");
  const localDockerEnv = {
    NODE_ENV: "staging",
    REMOTE_MCP_ENVIRONMENT: "staging",
    DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
    ACTIVATION_STAGING_GATEWAY_ENABLED: "true",
    REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
  };
  const localDockerPolicy = activationHostGatewayAllowedPaths({ env: localDockerEnv });
  assert.equal(localDockerPolicy.environment_key, "staging");
  assert.equal(localDockerPolicy.runtime_variant, "staging_local_windows_docker");
  assert.equal(localDockerPolicy.runtime_class, "local_windows_docker");
  assert.equal(localDockerPolicy.gateway_key, "activation_gateway_staging");
  assert(localDockerPolicy.exact_paths.includes("/admin-gpt/activation-openapi"));
  assert(localDockerPolicy.path_prefixes.includes("/admin/recovery/staging/"));

  const localApp = express();
  localApp.use(buildActivationHostGatewayRoutes({ env: localDockerEnv, enabled: true }));
  localApp.use((req, res) => res.status(404).json({ ok: false, code: "downstream_not_reached" }));
  const localServer = localApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => localServer.once("listening", resolve));
  try {
    const localPort = localServer.address().port;
    const localSchema = await fetch(`http://127.0.0.1:${localPort}/openapi.custom-gpt.activation-admin.staging.yaml`, {
      headers: { "x-forwarded-host": "activation-dev.mad4b.com" },
    });
    assert.equal(localSchema.status, 200);
    assert.match(await localSchema.text(), /getStagingRecoveryAdminReadiness/);
  } finally {
    await new Promise((resolve, reject) => localServer.close((error) => error ? reject(error) : resolve()));
  }

  const conflictingEnv = { ...localDockerEnv, DEPLOYMENT_ENVIRONMENT: "production" };
  const conflictingPolicy = activationHostGatewayAllowedPaths({ env: conflictingEnv });
  assert.equal(conflictingPolicy.environment_key, null);
  assert.deepEqual(conflictingPolicy.exact_paths, []);
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath) => JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
const readText = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), "utf8");
const convergenceRegistry = readEnvironmentConvergenceRegistry();
const convergenceValidation = validateEnvironmentConvergenceRegistry(convergenceRegistry);
assert.equal(convergenceValidation.ok, true, convergenceValidation.errors.join(", "));

const stagingConvergenceProfile = getEnvironmentConvergenceProfile("staging", convergenceRegistry);
const productionConvergenceProfile = getEnvironmentConvergenceProfile("production", convergenceRegistry);
assert.equal(stagingConvergenceProfile.state_machine, "environment_convergence.v1");
assert.equal(stagingConvergenceProfile.state_machine, productionConvergenceProfile.state_machine);
assert.equal(stagingConvergenceProfile.source_branch, "main");
assert.equal(productionConvergenceProfile.source_branch, "Production");
assert.equal(productionConvergenceProfile.upstream_branch, "main");
assert.equal(stagingConvergenceProfile.provider_mutation_implementation, null);
assert.equal(productionConvergenceProfile.provider_mutation_implementation, null);
assert.equal(stagingConvergenceProfile.activation_gateway.governed_apply_ready, false);
assert.equal(stagingConvergenceProfile.activation_gateway.apply_capability, null);
assert.equal(productionConvergenceProfile.activation_gateway.governed_apply_ready, true);
assert.equal(productionConvergenceProfile.activation_gateway.apply_capability, "activation_gateway_dark_deploy");

const stagingGatewayPolicy = readJson(stagingConvergenceProfile.activation_gateway.policy_path);
const productionGatewayPolicy = readJson(productionConvergenceProfile.activation_gateway.policy_path);
assert.equal(assertActivationGatewayProfilePolicy("staging", stagingGatewayPolicy, convergenceRegistry).ok, true);
assert.equal(assertActivationGatewayProfilePolicy("production", productionGatewayPolicy, convergenceRegistry).ok, true);
assert.equal(stagingGatewayPolicy.policy_key, "activation_gateway_staging");
assert.equal(stagingGatewayPolicy.public_host, "activation-dev.mad4b.com");
assert.equal(stagingGatewayPolicy.content_hash_sha256, stagingConvergenceProfile.activation_gateway.expected_policy_hash);
assert.equal(productionGatewayPolicy.policy_key, "activation_gateway");
assert.equal(productionGatewayPolicy.public_host, "activation.mad4b.com");
assert.equal(productionGatewayPolicy.content_hash_sha256, productionConvergenceProfile.activation_gateway.expected_policy_hash);
const loadedStagingPolicy = loadActivationGatewayProfilePolicy("staging", { registry: convergenceRegistry, repositoryRoot });
const loadedProductionPolicy = loadActivationGatewayProfilePolicy("production", { registry: convergenceRegistry, repositoryRoot });
assert.equal(loadedStagingPolicy.policy_source, "repository_profile");
assert.equal(loadedStagingPolicy.expected_policy_hash, stagingGatewayPolicy.content_hash_sha256);
assert.equal(loadedProductionPolicy.policy_source, "repository_profile");
assert.equal(loadedProductionPolicy.expected_policy_hash, productionGatewayPolicy.content_hash_sha256);

const desiredCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const observedCommit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const exactCommitReport = {
  outcome: "blocked",
  expected: { commit_sha: desiredCommit },
  gateway: { health: { sourceCommit: observedCommit } },
  integrity_checks: [{
    key: "gateway_exact_commit",
    ok: false,
    severity: "blocking",
    detail: { expected: desiredCommit, observed: observedCommit },
  }],
  readiness_checks: [],
};
const exactCommitClassification = classifyEnvironmentCertification(exactCommitReport, {
  environment: "staging",
  registry: convergenceRegistry,
});
assert.equal(exactCommitClassification.status, "reconciliation_required");
assert.equal(exactCommitClassification.classified_failures[0].failure_kind, "convergence_drift");
assert.equal(exactCommitClassification.classified_failures[0].drift_class, "release_identity_mismatch");
assert.equal(exactCommitClassification.next_governed_handoff.automatic_apply_allowed, false);
assert.equal(exactCommitClassification.next_governed_handoff.execution_ready, false);
assert.equal(exactCommitClassification.next_governed_handoff.plan_capability, "environment_convergence_plan");
assert.equal(exactCommitClassification.next_governed_handoff.apply_capability, null);
assert.equal(exactCommitClassification.next_governed_handoff.apply_block_reason, "server_governed_staging_activation_worker_adapter_required");

const releaseSpec = {
  repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  source_branch: "main",
  commit_sha: desiredCommit,
};
const approvalRequired = runEnvironmentConvergence({
  environment: "staging",
  releaseSpec,
  certificationReport: exactCommitReport,
  registry: convergenceRegistry,
});
assert.equal(approvalRequired.status, "approval_required");
assert.equal(approvalRequired.current_stage, "approval_checkpoint");
assert.equal(approvalRequired.next_stage, "approval_checkpoint");
assert.deepEqual(approvalRequired.stage_trace, ["observe", "classify", "plan", "approval_checkpoint"]);
assert.match(approvalRequired.plan.plan_sha256, /^[0-9a-f]{64}$/u);
assert.equal(Object.isFrozen(approvalRequired.plan), true);
assert.equal(Object.isFrozen(approvalRequired.plan.profile_binding), true);
assert.equal(approvalRequired.plan.release_spec.commit_sha, desiredCommit);
assert.equal(approvalRequired.plan.release_spec.activation_gateway_policy_hash, stagingGatewayPolicy.content_hash_sha256);
assert.equal(approvalRequired.plan.profile_binding.policy_key, "activation_gateway_staging");
assert.equal(approvalRequired.plan.profile_binding.expected_policy_hash, stagingGatewayPolicy.content_hash_sha256);
assert.equal(approvalRequired.plan.governed_handoff.plan_capability, "environment_convergence_plan");
assert.equal(approvalRequired.plan.governed_handoff.apply_capability, null);
assert.equal(approvalRequired.plan.governed_handoff.execution_ready, false);
assert.equal(approvalRequired.plan.governed_handoff.automatic_apply_allowed, false);
assert.equal(approvalRequired.safety.mutation_performed, false);
assert.equal(approvalRequired.safety.workflow_dispatch, false);

const repeatedPlan = runEnvironmentConvergence({
  environment: "staging",
  releaseSpec,
  certificationReport: exactCommitReport,
  registry: convergenceRegistry,
});
assert.equal(repeatedPlan.plan.plan_sha256, approvalRequired.plan.plan_sha256, "same inputs must produce the same immutable plan identity");
const wrongPolicyRelease = runEnvironmentConvergence({
  environment: "staging",
  releaseSpec: { ...releaseSpec, activation_gateway_policy_hash: "0".repeat(64) },
  certificationReport: exactCommitReport,
  registry: convergenceRegistry,
});
assert.equal(wrongPolicyRelease.status, "blocked");
assert.ok(wrongPolicyRelease.errors.includes("release_gateway_policy_hash_profile_mismatch"));

const wrongApproval = runEnvironmentConvergence({
  environment: "staging",
  releaseSpec,
  certificationReport: exactCommitReport,
  approval: {
    contract: "mad4b.environment-convergence-approval.v1",
    plan_sha256: "0".repeat(64),
    environment: "staging",
    commit_sha: desiredCommit,
  },
  registry: convergenceRegistry,
});
assert.equal(wrongApproval.status, "approval_required");
assert.equal(wrongApproval.governed_handoff, null);

const authorityRequired = runEnvironmentConvergence({
  environment: "staging",
  releaseSpec,
  certificationReport: exactCommitReport,
  approval: {
    contract: "mad4b.environment-convergence-approval.v1",
    plan_sha256: approvalRequired.plan.plan_sha256,
    environment: "staging",
    commit_sha: desiredCommit,
  },
  registry: convergenceRegistry,
});
assert.equal(authorityRequired.status, "governed_authority_required");
assert.equal(authorityRequired.next_stage, null);
assert.equal(authorityRequired.governed_handoff.execution_ready, false);
assert.equal(authorityRequired.governed_handoff.execution_performed, false);
assert.equal(authorityRequired.governed_handoff.plan_sha256, approvalRequired.plan.plan_sha256);
assert.equal(authorityRequired.governed_handoff.activation_gateway_policy_hash, stagingGatewayPolicy.content_hash_sha256);
assert.ok(authorityRequired.errors.includes("server_governed_staging_activation_worker_adapter_required"));
assert.equal(authorityRequired.safety.provider_mutation, false);
assert.equal(authorityRequired.safety.production_deploy, false);

const unavailableGateway = runEnvironmentConvergence({
  environment: "staging",
  releaseSpec,
  certificationReport: {
    outcome: "blocked",
    expected: { commit_sha: desiredCommit },
    gateway: { health: { status: 0, error: "fetch_failed" } },
    integrity_checks: [{ key: "gateway_health_reachable", ok: false, severity: "blocking", detail: { status: 0 } }],
    readiness_checks: [],
  },
  registry: convergenceRegistry,
});
assert.equal(unavailableGateway.status, "blocked");
assert.equal(unavailableGateway.plan, null);
assert.equal(unavailableGateway.governed_handoff, null);

const productionReleaseMismatch = runEnvironmentConvergence({
  environment: "production",
  releaseSpec: {
    repository: releaseSpec.repository,
    source_branch: "Production",
    commit_sha: desiredCommit,
  },
  certificationReport: exactCommitReport,
  registry: convergenceRegistry,
});
assert.equal(productionReleaseMismatch.status, "approval_required");
assert.equal(productionReleaseMismatch.profile.runtime_adapter, "hostinger");
assert.equal(productionReleaseMismatch.profile.policy_key, "activation_gateway");
assert.equal(productionReleaseMismatch.profile.expected_policy_hash, productionGatewayPolicy.content_hash_sha256);
assert.equal(productionReleaseMismatch.plan.profile_binding.public_host, "activation.mad4b.com");
assert.equal(productionReleaseMismatch.plan.governed_handoff.apply_capability, "activation_gateway_dark_deploy");
assert.equal(productionReleaseMismatch.plan.governed_handoff.execution_ready, true);
assert.equal(productionReleaseMismatch.safety.production_deploy, false);

const currentCertification = readText("http-generic-api/scripts/staging-live-certification.mjs");
assert.doesNotMatch(currentCertification, /STAGING_CERT_GATEWAY_POLICY_PATH/);
assert.match(currentCertification, /loadActivationGatewayProfilePolicy\("staging"/);
for (const checkKey of Object.keys(convergenceRegistry.dependencies.activation_gateway.checks)) {
  assert.match(currentCertification, new RegExp(`\\b${checkKey}\\b`), `Certification dependency ${checkKey} is absent`);
}
for (const orchestratorPath of convergenceRegistry.orchestrator_boundary.orchestrators) {
  const orchestrator = readText(orchestratorPath);
  for (const forbiddenToken of convergenceRegistry.orchestrator_boundary.forbidden_implementation_tokens) {
    assert.equal(
      orchestrator.toLowerCase().includes(forbiddenToken.toLowerCase()),
      false,
      `${orchestratorPath} contains forbidden provider-mutation implementation token: ${forbiddenToken}`,
    );
  }
}

console.log("staging_activation_gateway=PASS");
