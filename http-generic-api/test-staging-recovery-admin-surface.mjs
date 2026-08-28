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
import { webcrypto, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { createFileRecoveryEvidenceStore, createRecoveryReadinessAuthorities, readinessEvidencePayload, recoveryReadinessRouteDependencies, expectedStagingRegistration, expectedStagingGatewayDeployment, RECOVERY_READINESS_EVIDENCE_CONTRACT } from "./recoveryReadinessEvidence.js";
import { buildActivationHostGatewayRoutes } from "./routes/activationHostGatewayRoutes.js";
import { createActivationGateway, stableJson } from "../edge/activation-gateway/src/gateway.mjs";

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
// frontend-surface-operation: get /admin/recovery/staging/contract
// frontend-surface-operation: get /admin/recovery/staging/readiness
// frontend-surface-operation: get /admin/recovery/staging/certification
const schemaPath = path.join(apiRoot, "openapi", "openapi.custom-gpt.activation-admin.staging.yaml");

function completeStagingComposition() {
  const componentStatus = Object.fromEntries(RECOVERY_COMPOSITION_COMPONENT_KEYS.map((key) => [key, { configured: true, missing_methods: [] }]));
  return {
    contract: "mad4b.recovery-composition.v1",
    mode: "injected_non_live",
    configured: true,
    live_activation: false,
    adapter_provenance: {
      contract: "mad4b.recovery-adapter-provenance.v1", environment: "staging",
      deployment_sha: "a".repeat(40),
      components: Object.fromEntries(RECOVERY_COMPOSITION_COMPONENT_KEYS.map((key) => [key, {
        authority_class: "server_managed", implementation_id: `server-adapter:${key}`,
        artifact_sha256: "d".repeat(64), storage_class: "durable",
      }])),
    },
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

test("Staging Recovery is embedded in the bounded Staging Admin Activation schema", () => {
  const document = YAML.parse(fs.readFileSync(schemaPath, "utf8"));
  const result = validateStagingRecoveryAdminOpenApi({ document, source: fs.readFileSync(schemaPath, "utf8") });
  assert.equal(result.valid, true);
  assert.equal(result.server_uri, STAGING_RECOVERY_ADMIN_SERVER_URI);
  assert.equal(result.operation_count, 12);
  assert.equal(result.embedded_recovery_operation_count, 3);
  assert.deepEqual(result.recovery_methods, ["GET"]);
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
  assert.equal(result.ready, false, "module-only certification cannot stand in for signed external registration and OAuth evidence");
  assert(result.external_evidence.blocking_failures.includes("actual_chatgpt_registration"));
  assert(result.external_evidence.blocking_failures.includes("origin_network_isolation"));
  assert(result.external_evidence.blocking_failures.includes("deployed_worker_provenance"));
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

test("Staging Recovery rejects self-asserted Gateway identity and isolates Production", async () => {
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
    assert.equal(response.status, 404);
    assert.equal(body.error.code, "RECOVERY_STAGING_HOST_UNAVAILABLE");

    const readinessResponse = await fetch(`${staging.url}/admin/recovery/staging/readiness`, { headers: { "x-forwarded-host": "activation-dev.mad4b.com" } });
    const readinessBody = await readinessResponse.json();
    assert.equal(readinessResponse.status, 404);
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

test("real signed Worker to origin rejects forgery, substitution, replay and missing build authority", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "recovery-ingress-"));
  const store = createFileRecoveryEvidenceStore({ directory });
  const policy = JSON.parse(fs.readFileSync(path.join(apiRoot, "activation-gateway-runtime/generated/route-policy.staging.json")));
  const policyKeys = generateKeyPairSync("ed25519");
  const ingressKeys = generateKeyPairSync("ed25519");
  const identity = { source_sha: "a".repeat(40), bundle_sha256: "b".repeat(64) };
  const payload = {
    content_hash_sha256: policy.content_hash_sha256, deployment_id: "isolated-test",
    expires_at: new Date(Date.now() + 60000).toISOString(), source_commit: identity.source_sha,
    surface_registry_version: Number(policy.surface_registry_version),
    worker_build_sha: identity.source_sha, worker_bundle_sha256: identity.bundle_sha256,
  };
  const workerEnv = {
    ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK: JSON.stringify(policyKeys.publicKey.export({ format: "jwk" })),
    ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON: JSON.stringify({ ...payload, signature_b64url: sign(null, Buffer.from(stableJson(payload)), policyKeys.privateKey).toString("base64url") }),
    ACTIVATION_GATEWAY_INGRESS_PRIVATE_KEY_JWK: JSON.stringify(ingressKeys.privateKey.export({ format: "jwk" })),
    ACTIVATION_GATEWAY_INGRESS_KEY_ID: "isolated-ingress-key",
  };
  const env = {
    NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
    ACTIVATION_STAGING_GATEWAY_ENABLED: "true", REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
    REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY: ingressKeys.publicKey.export({ format: "pem", type: "spki" }),
    REMOTE_MCP_TRUSTED_INGRESS_KEY_ID: "isolated-ingress-key",
    REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST: policy.public_host,
    REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE: policy.upstream_origin,
    REMOTE_MCP_TRUSTED_INGRESS_ISSUER: `https://${policy.public_host}`,
    REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA: identity.source_sha,
  };
  const app = express();
  let replayClaims = 0;
  app.use(buildActivationHostGatewayRoutes({ env,
    deploymentAttestationReader: async () => ({ environment: "staging", branch: "main", sha: identity.source_sha,
      manifest_bound: true, read_only: true, secrets_included: false }),
    ingressReplayStore: {
    ...store.replayStore, claim: (...args) => { replayClaims++; return store.replayStore.claim(...args); },
  } }));
  let guards = 0;
  app.use(buildStagingRecoveryAdminRoutes({ env,
    requireBackendApiKey: (_req, _res, next) => { guards++; next(); },
    requireAdminPrincipal: (_req, _res, next) => { guards++; next(); },
  }));
  const origin = await listen(app);
  let captured;
  const handler = createActivationGateway({ policy, workerBuildIdentity: identity, cryptoImpl: webcrypto,
    logger: { info() {} }, fetchImpl: async (url, options) => {
      captured = options.headers;
      return fetch(`${origin.url}${url.pathname}`, options);
    },
  });
  const pathname = "/admin/recovery/staging/contract";
  try {
    const response = await handler(new Request(`https://${policy.public_host}${pathname}`, { headers: { "x-mad4b-ingress-attestation": "caller-forgery" } }), workerEnv);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).production_authority, false);
    assert.equal(guards, 2);
    assert.notEqual(captured.get("x-mad4b-ingress-attestation"), "caller-forgery");
    const replay = await fetch(`${origin.url}${pathname}`, { headers: captured });
    assert.equal(replay.status, 403);
    const anotherStore = createFileRecoveryEvidenceStore({ directory });
    const encoded = captured.get("x-mad4b-ingress-attestation").split(".")[0];
    const claims = JSON.parse(Buffer.from(encoded, "base64url"));
    assert.equal(await anotherStore.replayStore.claim({ issuer: claims.iss, key_id: claims.key_id, jti: claims.jti, expires_at: claims.exp }), false, "claim survives store recreation");
    for (const [suffix, header] of [["/admin/recovery/staging/readiness", {}], [pathname, { "x-request-id": "different-request" }], [pathname, { authorization: "Bearer different-principal" }], [pathname, { "x-mad4b-ingress-attestation": "forged.signature" }]]) {
      const substituted = new Headers(captured);
      for (const [key, value] of Object.entries(header)) substituted.set(key, value);
      assert.equal((await fetch(`${origin.url}${suffix}`, { headers: substituted })).status, 403);
    }
    assert.equal(guards, 2, "rejected requests never reach either auth guard or readiness");
    assert.equal(replayClaims, 2, "request substitutions are rejected before replay storage, not merely because the proof was consumed");
    const invalidSignedClaims = [
      { iss: "https://wrong.invalid" }, { aud: "https://auth.mad4b.com" }, { host: "activation.mad4b.com" },
      { deployment_sha: "f".repeat(40) }, { policy_hash: "f".repeat(64) }, { key_id: "different-key" },
      { method: "POST" }, { path: "/admin/recovery/staging/readiness" }, { request_id: "wrong-id" },
      { worker_build_sha: "f".repeat(40) }, { worker_bundle_sha256: "invalid" },
      { auth_digest: "f".repeat(64) }, { body_digest: "f".repeat(64) },
      { exp: Math.floor(Date.now() / 1000) - 1 }, { exp: claims.iat + 301 },
    ];
    for (const patch of invalidSignedClaims) {
      const changed = Buffer.from(JSON.stringify({ ...claims, ...patch, jti: webcrypto.randomUUID() }));
      const headers = new Headers(captured);
      headers.set("x-mad4b-ingress-attestation", `${changed.toString("base64url")}.${sign(null, changed, ingressKeys.privateKey).toString("base64url")}`);
      assert.equal((await fetch(`${origin.url}${pathname}`, { headers })).status, 403, JSON.stringify(patch));
    }
    assert.equal(replayClaims, 2, "invalid signed claims are rejected before consuming replay storage");
    const readiness = await handler(new Request(`https://${policy.public_host}/ready`), workerEnv);
    assert.equal(readiness.status, 200);
    assert.equal((await readiness.json()).upstreamEvidenceVerified, true);
    const noBuild = createActivationGateway({ policy, logger: { info() {} }, fetchImpl: () => assert.fail("must not contact origin") });
    assert.equal((await noBuild(new Request(`https://${policy.public_host}${pathname}`), workerEnv)).status, 503);
    const changedBuild = createActivationGateway({ policy, workerBuildIdentity: { ...identity, source_sha: "c".repeat(40) }, logger: { info() {} }, fetchImpl: () => assert.fail("must not contact origin") });
    assert.equal((await changedBuild(new Request(`https://${policy.public_host}${pathname}`), workerEnv)).status, 503);
  } finally { await new Promise((resolve) => origin.server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});

test("readiness consumes one signed snapshot; every external pre-live proof is mandatory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "recovery-readiness-"));
  try {
    const store = createFileRecoveryEvidenceStore({ directory });
    const keys = generateKeyPairSync("ed25519");
    const cert = validCertification();
    const gateway = await expectedStagingGatewayDeployment();
    const binding = { deployment_sha: cert.deployment_sha, target_fingerprint: cert.target_fingerprint,
      evidence_hash: "e".repeat(64), expires_at: cert.expires_at };
    const payload = {
      contract: RECOVERY_READINESS_EVIDENCE_CONTRACT, issuer: "isolated-test-signer", key_id: "test-key",
      environment: "staging", ...binding, stagingCertification: cert,
      adapterProvenance: completeStagingComposition().adapter_provenance,
      registrationEvidence: { ...await expectedStagingRegistration(), ...binding, observed_in: "chatgpt" },
      oauthEvidence: { ...binding, issuer: "https://dev.mad4b.com", resource: "https://activation-dev.mad4b.com",
        steps: Object.fromEntries(["authorize", "login_consent", "code", "callback", "token", "resource"].map((key) => [key, "pass"])) },
      networkEvidence: { ...binding, environment: "staging", gateway_host: gateway.gateway_host,
        upstream_origin: gateway.upstream_origin, gateway_only: true, signed_ingress_required: true,
        network_restriction_verified: true, direct_origin_publicly_reachable: false },
      workerDeploymentEvidence: { ...binding, observed_in: "cloudflare_workers", deployment_verified: true,
        gateway_host: gateway.gateway_host, policy_hash: gateway.policy_hash,
        worker_build_sha: cert.deployment_sha, policy_source_sha: cert.deployment_sha,
        worker_bundle_sha256: "1".repeat(64), deployed_bundle_sha256: "1".repeat(64) },
      unresolvedRecoveryIncidents: [], secrets_included: false,
    };
    async function read(value) {
      const id = await store.putCertification({ payload: value, signature: sign(null, Buffer.from(readinessEvidencePayload(value)), keys.privateKey).toString("base64url") });
      const authority = createRecoveryReadinessAuthorities({ evidenceStore: store, recordId: id,
        publicKey: keys.publicKey.export({ format: "pem", type: "spki" }), keyId: payload.key_id, issuer: payload.issuer,
        env: { NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker" },
        deploymentIdentityProvider: { readAttestation: async () => ({ sha: cert.deployment_sha, branch: "main", environment: "staging",
          repository_match: true, branch_match: true, sha_match: true, manifest_bound: true, read_only: true,
          target_fingerprint: cert.target_fingerprint, secrets_included: false }) },
        targetIdentityProvider: { readIdentity: async () => ({ environment: "staging", runtime_class: "local_windows_docker", target_fingerprint: cert.target_fingerprint }) },
      });
      return buildStagingRecoveryAdminReadiness({ recoveryComposition: completeStagingComposition(), ...recoveryReadinessRouteDependencies(authority) });
    }
    const ready = await read(payload);
    assert.equal(ready.ready, true, JSON.stringify(ready));
    assert.equal(ready.production_live.enabled, false);
    for (const patch of [
      { registrationEvidence: null }, { oauthEvidence: null }, { networkEvidence: null }, { workerDeploymentEvidence: null },
      { registrationEvidence: { ...payload.registrationEvidence, schema_sha256: "f".repeat(64) } },
      { oauthEvidence: { ...payload.oauthEvidence, resource: "https://activation.mad4b.com" } },
      { networkEvidence: { ...payload.networkEvidence, direct_origin_publicly_reachable: true } },
      { workerDeploymentEvidence: { ...payload.workerDeploymentEvidence, deployed_bundle_sha256: "2".repeat(64) } },
      { adapterProvenance: { durability_capable: true } },
      { adapterProvenance: { ...payload.adapterProvenance, deployment_sha: "f".repeat(40) } },
    ]) assert.equal((await read({ ...payload, ...patch })).ready, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});