import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import test from "node:test";
import {
  buildStagingRecoveryAdminContract,
  buildStagingRecoveryAdminReadiness,
  buildStagingRecoveryAdminRoutes,
  STAGING_RECOVERY_ADMIN_SERVER_URI,
  STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT,
} from "./routes/stagingRecoveryAdminRoutes.js";
import {
  RECOVERY_CERTIFICATION_TRACE_STEPS,
  certificationPayloadHash,
  evaluateStagingRecoveryCertification,
} from "./recoveryActivationReadiness.js";
import { RECOVERY_COMPOSITION_COMPONENT_KEYS } from "./recoveryComposition.js";
import { validateStagingRecoveryAdminOpenApi } from "./scripts/validate-staging-recovery-admin-openapi.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
// frontend-surface-operation: get /admin/recovery/staging/contract
// frontend-surface-operation: get /admin/recovery/staging/readiness
// frontend-surface-operation: get /admin/recovery/staging/certification
const schemaPath = path.join(apiRoot, "openapi", "openapi.custom-gpt.recovery-admin.staging.yaml");

function completeStagingComposition() {
  const componentStatus = Object.fromEntries(RECOVERY_COMPOSITION_COMPONENT_KEYS.map((key) => [key, { configured: true, missing_methods: [] }]));
  return {
    contract: "mad4b.recovery-composition.v1",
    mode: "injected_non_live",
    configured: true,
    live_activation: false,
    component_status: componentStatus,
    productionRecoveryCompositionFactory: {
      authority_readiness: {
        adapter_present: true,
        durability_capable: true,
        attestation_capable: true,
      },
    },
  };
}

function validCertification() {
  const lifecycleTrace = Object.fromEntries(RECOVERY_CERTIFICATION_TRACE_STEPS.map((step) => [step, { status: "pass" }]));
  const negativeCases = Object.fromEntries([
    "wrong_plan_hash", "wrong_step", "expired_approval", "approval_reuse", "cross_target_approval",
    "cross_sha_approval", "cross_environment_approval", "caller_ticket_fields", "ticket_replay",
    "expired_ticket", "cross_target_ticket", "cross_sha_ticket", "idempotency_race", "restart_durability",
    "lost_fence", "provider_timeout_unknown_outcome", "partial_execution_reconciliation", "readback_failure",
    "artifact_drift", "schema_precondition_drift",
  ].map((key) => [key, { status: "pass" }]));
  const certification = {
    contract: "mad4b.recovery-staging-certification.v1",
    certification_id: "cert:staging:surface-001",
    status: "passed",
    result: "pass",
    environment_key: "staging",
    deployment_sha: "a".repeat(40),
    runtime_sha: "a".repeat(40),
    branch: "main",
    target_fingerprint: "target:" + "b".repeat(64),
    server_identity_fingerprint: "server:" + "c".repeat(64),
    provider_environment: "staging",
    authority_graph: { ready: true, test_or_mock_adapter_detected: false },
    lifecycle_trace: lifecycleTrace,
    negative_tests: { all_passed: true, cases: negativeCases },
    audit_evidence: { durable: true, evidence_hash: "d".repeat(64) },
    artifact_integrity: { valid: true },
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    safety: {
      production_mutation_performed: false,
      secrets_included: false,
      caller_credentials_accepted: false,
      local_connector_production_authority: false,
    },
    secrets_included: false,
  };
  certification.audit_evidence.canonical_payload_hash = certificationPayloadHash(certification);
  return certification;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

test("Staging Recovery OpenAPI is bounded to one staging URI and three GET operations", () => {
  const document = YAML.parse(fs.readFileSync(schemaPath, "utf8"));
  const result = validateStagingRecoveryAdminOpenApi({ document, source: fs.readFileSync(schemaPath, "utf8") });
  assert.equal(result.valid, true);
  assert.equal(result.server_uri, STAGING_RECOVERY_ADMIN_SERVER_URI);
  assert.equal(result.path_count, 3);
  assert.equal(result.operation_count, 3);
  assert.deepEqual(result.methods, ["GET"]);
  assert.equal(result.mutation_advertised, false);
  assert.equal(result.production_authority_allowed, false);
});

test("Staging Recovery contract and default readiness are non-live and certification-gated", async () => {
  const contract = buildStagingRecoveryAdminContract();
  assert.equal(contract.contract, STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT);
  assert.equal(contract.server_uri, STAGING_RECOVERY_ADMIN_SERVER_URI);
  assert.equal(contract.environment, "staging");
  assert.equal(contract.operation_policy.mutation_allowed, false);
  assert.equal(contract.operation_policy.production_live_enabled, false);

  const readiness = await buildStagingRecoveryAdminReadiness({
    recoveryComposition: completeStagingComposition(),
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.certification.valid, false);
  assert.equal(readiness.production_live.requested, false);
  assert.equal(readiness.production_live.eligible, false);
  assert.equal(readiness.production_live.enabled, false);
  assert.equal(readiness.database_mutation_performed, false);
  assert.equal(readiness.provider_mutation_performed, false);
});

test("Staging Recovery readiness accepts only bounded server evidence and never enables Production", async () => {
  const result = await buildStagingRecoveryAdminReadiness({
    recoveryComposition: completeStagingComposition(),
    stagingCertificationReader: async () => validCertification(),
    targetFingerprintReader: async () => "target:" + "b".repeat(64),
    deploymentAttestationReader: async () => ({
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      branch: "main",
      sha: "a".repeat(40),
      environment: "staging",
      target_fingerprint: "target:" + "b".repeat(64),
      repository_match: true,
      branch_match: true,
      sha_match: true,
      manifest_bound: true,
      read_only: true,
      secrets_included: false,
    }),
  });
  assert.equal(result.ready, true);
  assert.equal(result.environment, "staging");
  assert.equal(result.production_live.enabled, false);
  assert.equal(result.production_live.eligible, false);
  assert.equal(result.live_certification.consequential_provider_execution_performed, false);
  assert.equal(result.database_mutation_performed, false);
  assert.equal(result.provider_mutation_performed, false);
});

test("Staging Recovery construction fails closed when either server-managed guard is missing", () => {
  assert.throws(
    () => buildStagingRecoveryAdminRoutes({
      env: { NODE_ENV: "staging" },
      requireAdminPrincipal: (_req, _res, next) => next(),
    }),
    (error) => error?.code === "RECOVERY_STAGING_GUARD_MISSING"
      && error.missing_guards.includes("requireBackendApiKey"),
  );
  assert.throws(
    () => buildStagingRecoveryAdminRoutes({
      env: { NODE_ENV: "staging" },
      requireBackendApiKey: (_req, _res, next) => next(),
    }),
    (error) => error?.code === "RECOVERY_STAGING_GUARD_MISSING"
      && error.missing_guards.includes("requireAdminPrincipal"),
  );
});

test("Staging Recovery routes are reachable only in declared staging runtime", async () => {
  const stagingApp = express();
  stagingApp.use((req, _res, next) => {
    req.activationHostGateway = {
      via_trusted_gateway: true,
      gateway_key: "activation_gateway_staging",
      environment: "staging",
      public_host: "activation-dev.mad4b.com",
    };
    next();
  });
  stagingApp.use(buildStagingRecoveryAdminRoutes({
    env: { NODE_ENV: "staging", REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true" },
    requireBackendApiKey: (_req, _res, next) => next(),
    requireAdminPrincipal: (_req, _res, next) => next(),
    recoveryComposition: completeStagingComposition(),
  }));
  const staging = await listen(stagingApp);
  try {
    const response = await fetch(`${staging.url}/admin/recovery/staging/contract`, { headers: { "x-forwarded-host": "activation-dev.mad4b.com" } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.contract, STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT);
    assert.equal(body.environment, "staging");
    assert.equal(body.production_authority, false);
    assert.equal(body.secrets_included, false);

    const readinessResponse = await fetch(`${staging.url}/admin/recovery/staging/readiness`, { headers: { "x-forwarded-host": "activation-dev.mad4b.com" } });
    const readinessBody = await readinessResponse.json();
    assert.equal(readinessResponse.status, 200);
    assert.equal(readinessBody.production_live.enabled, false);
    assert.equal(readinessBody.database_mutation_performed, false);

    const wrongHostResponse = await fetch(`${staging.url}/admin/recovery/staging/contract`, { headers: { "x-forwarded-host": "dev.mad4b.com" } });
    const wrongHostBody = await wrongHostResponse.json();
    assert.equal(wrongHostResponse.status, 404);
    assert.equal(wrongHostBody.error.code, "RECOVERY_STAGING_HOST_UNAVAILABLE");
  } finally {
    await new Promise((resolve) => staging.server.close(resolve));
  }

  const directOriginApp = express();
  directOriginApp.use(buildStagingRecoveryAdminRoutes({
    env: { NODE_ENV: "staging", REMOTE_MCP_ENVIRONMENT: "staging" },
    requireBackendApiKey: (_req, _res, next) => next(),
    requireAdminPrincipal: (_req, _res, next) => next(),
    recoveryComposition: completeStagingComposition(),
  }));
  const directOrigin = await listen(directOriginApp);
  try {
    const response = await fetch(`${directOrigin.url}/admin/recovery/staging/contract`, { headers: { host: "activation-dev.mad4b.com" } });
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.error.code, "RECOVERY_STAGING_HOST_UNAVAILABLE");
  } finally {
    await new Promise((resolve) => directOrigin.server.close(resolve));
  }

  const productionApp = express();
  productionApp.use(buildStagingRecoveryAdminRoutes({
    env: { NODE_ENV: "production" },
    requireBackendApiKey: (_req, _res, next) => next(),
    requireAdminPrincipal: (_req, _res, next) => next(),
    recoveryComposition: completeStagingComposition(),
  }));
  // The Staging-only guard must not intercept unrelated public health routes.
  productionApp.get("/version", (_req, res) => res.status(200).json({ ok: true, route: "version" }));
  const production = await listen(productionApp);
  try {
    const response = await fetch(`${production.url}/admin/recovery/staging/contract`);
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.error.code, "RECOVERY_STAGING_SURFACE_UNAVAILABLE");
    assert.equal(body.database_mutation_performed, false);

    const versionResponse = await fetch(`${production.url}/version`);
    const versionBody = await versionResponse.json();
    assert.equal(versionResponse.status, 200);
    assert.deepEqual(versionBody, { ok: true, route: "version" });
  } finally {
    await new Promise((resolve) => production.server.close(resolve));
  }
});

console.log("Staging Recovery Admin surface contract tests passed");
