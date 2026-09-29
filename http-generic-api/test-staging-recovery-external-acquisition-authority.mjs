import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import test from "node:test";
import {
  createRecoveryExternalAcquisitionAuthority,
  RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_CONTRACT,
  recoveryExternalAcquisitionCanonicalPayload,
  recoveryExternalSourceProofHash,
  signRecoveryExternalAcquisitionReceipt,
  verifyRecoveryExternalAcquisitionAuthority,
} from "./recoveryExternalAcquisitionAuthority.js";
import {
  createRecoveryReadinessAuthorities,
  expectedStagingGatewayDeployment,
  recoveryExternalEvidenceHash,
  RECOVERY_CERTIFICATION_STORE_CONTRACT,
  RECOVERY_EXTERNAL_EVIDENCE_CONTRACT,
} from "./recoveryReadinessEvidence.js";
import { _testingStagingRecoveryAuthorityBinding } from "./stagingRecoveryAuthorityBinding.js";
import {
  RECOVERY_OAUTH_CORRELATION_EVENT_SEQUENCE,
  classifyRecoveryDirectDenial,
  buildRecoveryNetworkIsolationEvidence,
  buildRecoveryOAuthServerCorrelationEvidence,
  unavailableRegistrationSourceVerification,
  verifyRecoveryNetworkIsolationSource,
  verifyRecoveryOAuthServerCorrelationSource,
} from "./stagingRecoveryExternalEvidence.js";

const SHA = "a".repeat(40);
const TARGET = "b".repeat(64);
const ISSUER = "https://activation-dev.mad4b.com";
const KEY_ID = "staging-recovery-acquisition-test-key";
const EMPTY_HASH = createHash("sha256").update("").digest("hex");
const REDIRECT_HASH = createHash("sha256")
  .update("https://chat.openai.com/aip/callback")
  .digest("hex");

function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }),
  };
}

async function gatewayHealthIdentity(overrides = {}) {
  const gateway = await expectedStagingGatewayDeployment();
  return {
    status: 200,
    ok: true,
    source_commit: SHA,
    worker_build_sha: SHA,
    worker_bundle_sha256: "9".repeat(64),
    policy_hash: gateway.policy_hash,
    secrets_included: false,
    ...overrides,
  };
}

function registrationEvidence({
  sha = SHA,
  target = TARGET,
  source = "chatgpt_live_readback",
  expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(),
} = {}) {
  const base = {
    contract: RECOVERY_EXTERNAL_EVIDENCE_CONTRACT,
    evidence_kind: "chatgpt_registration",
    source_provenance: {
      source,
      observation_id: "test-registration-observation",
    },
    deployment_sha: sha,
    target_fingerprint: target,
    observed_at: new Date().toISOString(),
    expires_at: expiresAt,
    observed_in: "chatgpt",
    registration_parity_verified: true,
    secrets_included: false,
  };
  return { ...base, evidence_hash: recoveryExternalEvidenceHash(base) };
}

function oauthEvents({
  correlation = "oauth-correlation-test-0001",
  session = "oauth-session-test-0001",
  client = "mad4b-tenant-gpt-staging",
  redirectHash = REDIRECT_HASH,
} = {}) {
  const baseTime = Date.now() - 30_000;
  return RECOVERY_OAUTH_CORRELATION_EVENT_SEQUENCE.map((event, index) => ({
    event,
    correlation_id: correlation,
    session_id: session,
    client_id: client,
    occurred_at: new Date(baseTime + index * 1000).toISOString(),
    result: "pass",
    environment: "staging",
    issuer: "https://dev.mad4b.com",
    resource: "https://activation-dev.mad4b.com",
    redirect_uri_hash: redirectHash,
  }));
}

async function validEvidence() {
  const registration = registrationEvidence();
  const oauth = buildRecoveryOAuthServerCorrelationEvidence({
    events: oauthEvents(),
    deploymentSha: SHA,
    targetFingerprint: TARGET,
    observationId: "test-oauth-observation-0001",
  });
  const network = await buildRecoveryNetworkIsolationEvidence({
    deploymentSha: SHA,
    targetFingerprint: TARGET,
    observationId: "test-network-observation-0001",
    direct: {
      method: "GET",
      path: "/admin/recovery/staging/contract",
      body_sha256: EMPTY_HASH,
      status: 403,
      reason: "RECOVERY_TRUSTED_INGRESS_REQUIRED",
    },
    gateway: {
      method: "GET",
      path: "/admin/recovery/staging/contract",
      body_sha256: EMPTY_HASH,
      status: 200,
      public_health_identity: await gatewayHealthIdentity(),
    },
  });
  return { registration, oauth, network };
}

async function signedFixture(overrides = {}) {
  const keys = keyPair();
  const evidence = await validEvidence();
  const issuedAt = overrides.issuedAt || new Date().toISOString();
  const expiresAt =
    overrides.expiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const unsigned = {
    contract: RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_CONTRACT,
    environment: "staging",
    deployment_sha: SHA,
    target_fingerprint: TARGET,
    acquisition_run_id: "github-acquisition:test-0001",
    issuer: ISSUER,
    key_id: KEY_ID,
    issued_at: issuedAt,
    expires_at: expiresAt,
    observations: {
      registration: {
        observation_id: evidence.registration.source_provenance.observation_id,
        source: "chatgpt_live_readback",
        evidence_hash: evidence.registration.evidence_hash,
        source_proof_hash: recoveryExternalSourceProofHash(evidence.registration),
        verified: true,
      },
      oauth: {
        observation_id: evidence.oauth.source_provenance.observation_id,
        source: "oauth_server_correlation",
        evidence_hash: evidence.oauth.evidence_hash,
        source_proof_hash: recoveryExternalSourceProofHash(evidence.oauth),
        verified: true,
      },
      network: {
        observation_id: evidence.network.source_provenance.observation_id,
        source: "independent_network_probe",
        evidence_hash: evidence.network.evidence_hash,
        source_proof_hash: recoveryExternalSourceProofHash(evidence.network),
        verified: true,
      },
    },
    secrets_included: false,
  };
  const receipt = Object.freeze({
    ...unsigned,
    signature_b64url: cryptoSign(
      null,
      Buffer.from(recoveryExternalAcquisitionCanonicalPayload(unsigned)),
      keys.privateKey,
    ).toString("base64url"),
  });
  const authority = createRecoveryExternalAcquisitionAuthority({
    publicKey: keys.publicKey,
    keyId: KEY_ID,
    issuer: ISSUER,
  });
  return { keys, evidence, receipt, authority };
}

test("signed acquisition receipt verifies only through a branded server authority", async () => {
  const { evidence, receipt, authority } = await signedFixture();
  const result = await verifyRecoveryExternalAcquisitionAuthority(authority, {
    receipt,
    registrationEvidence: evidence.registration,
    oauthEvidence: evidence.oauth,
    networkEvidence: evidence.network,
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
  });
  assert.equal(result.verified, true);
  assert.match(result.receipt_digest, /^[a-f0-9]{64}$/u);

  const forgedCallerAuthority = {
    contract: "mad4b.recovery-external-acquisition-authority.v1",
    verified: true,
    async verify() {
      return { verified: true };
    },
  };
  const forged = await verifyRecoveryExternalAcquisitionAuthority(
    forgedCallerAuthority,
    {
      receipt,
      registrationEvidence: evidence.registration,
      oauthEvidence: evidence.oauth,
      networkEvidence: evidence.network,
      expectedSha: SHA,
      expectedTargetFingerprint: TARGET,
    },
  );
  assert.equal(forged.verified, false);
  assert.equal(
    forged.reason_code,
    "RECOVERY_EXTERNAL_ACQUISITION_AUTHORITY_UNTRUSTED",
  );
});

test("readiness rejects a caller-fabricated acquisition authority before verification", () => {
  const fakeAuthority = {
    contract: "mad4b.recovery-external-acquisition-authority.v1",
    async verify() {
      return { verified: true };
    },
  };
  assert.throws(
    () =>
      createRecoveryReadinessAuthorities({
        evidenceStore: {
          contract: RECOVERY_CERTIFICATION_STORE_CONTRACT,
          async getCertification() { return null; },
          async putCertification() { return "unused"; },
          replayStore: { scope: "single_filesystem" },
        },
        deploymentIdentityProvider: {
          async readAttestation() {
            return { environment: "staging", sha: SHA, target_fingerprint: TARGET };
          },
        },
        targetIdentityProvider: {
          async readIdentity() {
            return { environment: "staging", runtime_class: "local_windows_docker", target_fingerprint: TARGET };
          },
        },
        env: {
          NODE_ENV: "staging",
          DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
          REMOTE_MCP_ENVIRONMENT: "staging",
        },
        externalAcquisitionAuthority: fakeAuthority,
      }),
    (error) =>
      error.code === "RECOVERY_EXTERNAL_ACQUISITION_AUTHORITY_UNTRUSTED",
  );
});

test("receipt rejects forged signature, evidence mutation, source drift, SHA, target and expiry", async () => {
  const { evidence, receipt, authority } = await signedFixture();
  const verify = (candidateReceipt = receipt, candidateEvidence = evidence, options = {}) =>
    verifyRecoveryExternalAcquisitionAuthority(authority, {
      receipt: candidateReceipt,
      registrationEvidence: candidateEvidence.registration,
      oauthEvidence: candidateEvidence.oauth,
      networkEvidence: candidateEvidence.network,
      expectedSha: options.sha || SHA,
      expectedTargetFingerprint: options.target || TARGET,
      now: options.now,
    });

  assert.equal(
    (await verify({ ...receipt, signature_b64url: "A".repeat(86) })).verified,
    false,
  );

  const mutatedRegistration = {
    ...evidence.registration,
    registration_parity_verified: false,
  };
  assert.equal(
    (await verify(receipt, { ...evidence, registration: mutatedRegistration }))
      .verified,
    false,
  );

  const sourceDrift = registrationEvidence({ source: "caller_flags" });
  assert.equal(
    (await verify(receipt, { ...evidence, registration: sourceDrift })).verified,
    false,
  );

  assert.equal((await verify(receipt, evidence, { sha: "c".repeat(40) })).verified, false);
  assert.equal((await verify(receipt, evidence, { target: "d".repeat(64) })).verified, false);

  const expiredFixture = await signedFixture({
    issuedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  });
  const expired = await verifyRecoveryExternalAcquisitionAuthority(
    expiredFixture.authority,
    {
      receipt: expiredFixture.receipt,
      registrationEvidence: expiredFixture.evidence.registration,
      oauthEvidence: expiredFixture.evidence.oauth,
      networkEvidence: expiredFixture.evidence.network,
      expectedSha: SHA,
      expectedTargetFingerprint: TARGET,
    },
  );
  assert.equal(expired.verified, false);
  assert.equal(
    expired.reason_code,
    "RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_EXPIRED",
  );
});

test("network acquisition accepts only the two canonical direct-denial pairs", async () => {
  const build = async ({ status, reason, gatewayStatus = 200 } = {}) =>
    buildRecoveryNetworkIsolationEvidence({
      deploymentSha: SHA,
      targetFingerprint: TARGET,
      observationId: `test-network-denial-${status}-${String(reason).toLowerCase()}`,
      direct: {
        method: "GET",
        path: "/admin/recovery/staging/contract",
        body_sha256: EMPTY_HASH,
        status,
        reason,
      },
      gateway: {
        method: "GET",
        path: "/admin/recovery/staging/contract",
        body_sha256: EMPTY_HASH,
        status: gatewayStatus,
        public_health_identity: await gatewayHealthIdentity(),
      },
    });

  assert.deepEqual(
    classifyRecoveryDirectDenial({
      status: 403,
      reason: "RECOVERY_TRUSTED_INGRESS_REQUIRED",
    }),
    {
      status: 403,
      reason: "RECOVERY_TRUSTED_INGRESS_REQUIRED",
      denial_class: "trusted_ingress_required",
    },
  );
  assert.deepEqual(
    classifyRecoveryDirectDenial({
      status: 404,
      reason: "RECOVERY_STAGING_HOST_UNAVAILABLE",
    }),
    {
      status: 404,
      reason: "RECOVERY_STAGING_HOST_UNAVAILABLE",
      denial_class: "staging_host_unavailable",
    },
  );

  const trustedIngress = await build({
    status: 403,
    reason: "RECOVERY_TRUSTED_INGRESS_REQUIRED",
  });
  assert.equal(
    trustedIngress.direct_recovery_surface_denial_class,
    "trusted_ingress_required",
  );
  assert.equal(
    verifyRecoveryNetworkIsolationSource(trustedIngress, {
      expectedSha: SHA,
      expectedTargetFingerprint: TARGET,
    }).verified,
    true,
  );

  const unavailableHost = await build({
    status: 404,
    reason: "RECOVERY_STAGING_HOST_UNAVAILABLE",
  });
  assert.equal(
    unavailableHost.direct_recovery_surface_denial_class,
    "staging_host_unavailable",
  );
  assert.equal(
    verifyRecoveryNetworkIsolationSource(unavailableHost, {
      expectedSha: SHA,
      expectedTargetFingerprint: TARGET,
    }).verified,
    true,
  );

  for (const [status, reason] of [
    [404, "NOT_FOUND"],
    [403, "FORBIDDEN"],
    [401, "RECOVERY_TRUSTED_INGRESS_REQUIRED"],
    [500, "RECOVERY_STAGING_HOST_UNAVAILABLE"],
  ]) {
    await assert.rejects(
      () => build({ status, reason }),
      (error) => error.code === "RECOVERY_NETWORK_SOURCE_INVALID",
    );
  }

  await assert.rejects(
    () =>
      build({
        status: 404,
        reason: "RECOVERY_STAGING_HOST_UNAVAILABLE",
        gatewayStatus: 503,
      }),
    (error) => error.code === "RECOVERY_NETWORK_SOURCE_INVALID",
  );

  const forgedClass = {
    ...unavailableHost,
    direct_recovery_surface_denial_class: "trusted_ingress_required",
  };
  forgedClass.evidence_hash = recoveryExternalEvidenceHash(forgedClass);
  assert.equal(
    verifyRecoveryNetworkIsolationSource(forgedClass, {
      expectedSha: SHA,
      expectedTargetFingerprint: TARGET,
    }).verified,
    false,
  );

  await assert.rejects(
    async () =>
      buildRecoveryNetworkIsolationEvidence({
        deploymentSha: SHA,
        targetFingerprint: TARGET,
        direct: {
          method: "GET",
          path: "/admin/recovery/staging/contract",
          body_sha256: EMPTY_HASH,
          status: 403,
          reason: "RECOVERY_TRUSTED_INGRESS_REQUIRED",
        },
        gateway: {
          method: "POST",
          path: "/admin/recovery/staging/readiness",
          body_sha256: "f".repeat(64),
          status: 200,
          public_health_identity: await gatewayHealthIdentity(),
        },
      }),
    (error) => error.code === "RECOVERY_NETWORK_SOURCE_INVALID",
  );
});

test("network acquisition binds exact live Gateway health identity into the evidence hash", async () => {
  const base = {
    deploymentSha: SHA,
    targetFingerprint: TARGET,
    direct: {
      method: "GET",
      path: "/admin/recovery/staging/contract",
      body_sha256: EMPTY_HASH,
      status: 403,
      reason: "RECOVERY_TRUSTED_INGRESS_REQUIRED",
    },
    gateway: {
      method: "GET",
      path: "/admin/recovery/staging/contract",
      body_sha256: EMPTY_HASH,
      status: 200,
    },
  };

  await assert.rejects(
    async () =>
      buildRecoveryNetworkIsolationEvidence({
        ...base,
        gateway: {
          ...base.gateway,
          public_health_identity: await gatewayHealthIdentity({
            source_commit: "c".repeat(40),
          }),
        },
      }),
    (error) => error.code === "RECOVERY_NETWORK_SOURCE_INVALID",
  );

  await assert.rejects(
    async () =>
      buildRecoveryNetworkIsolationEvidence({
        ...base,
        gateway: {
          ...base.gateway,
          public_health_identity: await gatewayHealthIdentity({
            policy_hash: "d".repeat(64),
          }),
        },
      }),
    (error) => error.code === "RECOVERY_NETWORK_SOURCE_INVALID",
  );

  const evidence = await validEvidence();
  const mutated = {
    ...evidence.network,
    public_health_identity: {
      ...evidence.network.public_health_identity,
      worker_build_sha: "e".repeat(40),
    },
  };
  mutated.evidence_hash = recoveryExternalEvidenceHash(mutated);
  const verification = verifyRecoveryNetworkIsolationSource(mutated, {
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
  });
  assert.equal(verification.verified, false);
  assert.equal(verification.reason_code, "RECOVERY_NETWORK_SOURCE_INVALID");

  const policyMutated = {
    ...evidence.network,
    public_health_identity: {
      ...evidence.network.public_health_identity,
      policy_hash: "d".repeat(64),
    },
  };
  policyMutated.evidence_hash = recoveryExternalEvidenceHash(policyMutated);
  const policyVerification = verifyRecoveryNetworkIsolationSource(policyMutated, {
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
  });
  assert.equal(policyVerification.verified, false);
  assert.equal(
    policyVerification.reason_code,
    "RECOVERY_NETWORK_SOURCE_INVALID",
  );
});

test("OAuth source requires complete ordered server correlation without secret-bearing fields", () => {
  const base = {
    deploymentSha: SHA,
    targetFingerprint: TARGET,
    observationId: "test-oauth-sequence-0001",
  };
  assert.throws(
    () =>
      buildRecoveryOAuthServerCorrelationEvidence({
        ...base,
        events: oauthEvents().slice(0, -1),
      }),
    (error) => error.code === "RECOVERY_OAUTH_CORRELATION_SEQUENCE_INVALID",
  );

  const outOfOrder = oauthEvents();
  [outOfOrder[1], outOfOrder[2]] = [outOfOrder[2], outOfOrder[1]];
  assert.throws(
    () =>
      buildRecoveryOAuthServerCorrelationEvidence({
        ...base,
        events: outOfOrder,
      }),
    (error) => error.code === "RECOVERY_OAUTH_CORRELATION_SEQUENCE_INVALID",
  );

  const secretBearing = oauthEvents();
  secretBearing[4] = { ...secretBearing[4], access_token: "forbidden" };
  assert.throws(
    () =>
      buildRecoveryOAuthServerCorrelationEvidence({
        ...base,
        events: secretBearing,
      }),
    (error) => error.code === "RECOVERY_OAUTH_CORRELATION_SECRET_FIELD_FORBIDDEN",
  );

  const crossCorrelation = oauthEvents();
  crossCorrelation[5] = {
    ...crossCorrelation[5],
    correlation_id: "oauth-correlation-test-9999",
  };
  assert.throws(
    () =>
      buildRecoveryOAuthServerCorrelationEvidence({
        ...base,
        events: crossCorrelation,
      }),
    (error) => error.code === "RECOVERY_OAUTH_CORRELATION_BINDING_INVALID",
  );

  const redirectDrift = oauthEvents();
  redirectDrift[3] = { ...redirectDrift[3], redirect_uri_hash: "e".repeat(64) };
  assert.throws(
    () =>
      buildRecoveryOAuthServerCorrelationEvidence({
        ...base,
        events: redirectDrift,
      }),
    (error) => error.code === "RECOVERY_OAUTH_CORRELATION_BINDING_INVALID",
  );
});

test("OAuth correlation structure cannot become source authority from a caller-provided events file", async () => {
  const evidence = await validEvidence();
  const result = verifyRecoveryOAuthServerCorrelationSource(evidence.oauth, {
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
  });
  assert.equal(result.verified, false);
  assert.equal(
    result.reason_code,
    "RECOVERY_OAUTH_SERVER_CORRELATION_SOURCE_UNAVAILABLE",
  );
  assert.equal(result.source, "oauth_server_correlation");
  assert.equal(result.secrets_included, false);
});

test("server binding enforces acquisition-key separation from ingress and certification trust", () => {
  const acquisition = keyPair();
  const ingress = keyPair();
  const certification = keyPair();
  const base = {
    STAGING_RECOVERY_ACQUISITION_PUBLIC_KEY: acquisition.publicKey,
    STAGING_RECOVERY_ACQUISITION_KEY_ID: KEY_ID,
    STAGING_RECOVERY_ACQUISITION_ISSUER: ISSUER,
    REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY: ingress.publicKey,
    RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY: certification.publicKey,
  };
  const authority = _testingStagingRecoveryAuthorityBinding.externalAcquisitionAuthority(base);
  assert.equal(authority.contract, "mad4b.recovery-external-acquisition-authority.v1");

  assert.throws(
    () =>
      _testingStagingRecoveryAuthorityBinding.externalAcquisitionAuthority({
        ...base,
        REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY: acquisition.publicKey,
      }),
    (error) => error.code === "RECOVERY_EXTERNAL_ACQUISITION_KEY_REUSE_FORBIDDEN",
  );

  assert.throws(
    () =>
      _testingStagingRecoveryAuthorityBinding.externalAcquisitionAuthority({
        ...base,
        RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY: acquisition.publicKey,
      }),
    (error) => error.code === "RECOVERY_EXTERNAL_ACQUISITION_KEY_REUSE_FORBIDDEN",
  );
});

test("registration parity without provider source attestation can never sign an acquisition receipt", async () => {
  const keys = keyPair();
  const evidence = await validEvidence();
  const registration = unavailableRegistrationSourceVerification(
    evidence.registration,
  );
  assert.equal(registration.verified, false);
  assert.equal(
    registration.reason_code,
    "RECOVERY_REGISTRATION_SOURCE_ATTESTATION_UNAVAILABLE",
  );

  const forgedRegistrationVerification = {
    verified: true,
    evidence_hash: evidence.registration.evidence_hash,
    source_proof_hash: recoveryExternalSourceProofHash(evidence.registration),
    source: "chatgpt_live_readback",
    secrets_included: false,
  };
  assert.throws(
    () =>
      signRecoveryExternalAcquisitionReceipt(
        {
          deploymentSha: SHA,
          targetFingerprint: TARGET,
          acquisitionRunId: "github-acquisition:test-forged-registration",
          registrationEvidence: evidence.registration,
          oauthEvidence: evidence.oauth,
          networkEvidence: evidence.network,
          sourceVerification: {
            registration: forgedRegistrationVerification,
            oauth: verifyRecoveryOAuthServerCorrelationSource(evidence.oauth, {
              expectedSha: SHA,
              expectedTargetFingerprint: TARGET,
            }),
            network: verifyRecoveryNetworkIsolationSource(evidence.network, {
              expectedSha: SHA,
              expectedTargetFingerprint: TARGET,
            }),
          },
        },
        {
          privateKey: keys.privateKey,
          keyId: KEY_ID,
          issuer: ISSUER,
        },
      ),
    (error) =>
      error.code ===
      "RECOVERY_REGISTRATION_SOURCE_ATTESTATION_UNAVAILABLE",
  );

  assert.throws(
    () =>
      signRecoveryExternalAcquisitionReceipt(
        {
          deploymentSha: SHA,
          targetFingerprint: TARGET,
          acquisitionRunId: "github-acquisition:test-blocked",
          registrationEvidence: evidence.registration,
          oauthEvidence: evidence.oauth,
          networkEvidence: evidence.network,
          sourceVerification: {
            registration,
            oauth: verifyRecoveryOAuthServerCorrelationSource(evidence.oauth, {
              expectedSha: SHA,
              expectedTargetFingerprint: TARGET,
            }),
            network: verifyRecoveryNetworkIsolationSource(evidence.network, {
              expectedSha: SHA,
              expectedTargetFingerprint: TARGET,
            }),
          },
        },
        {
          privateKey: keys.privateKey,
          keyId: KEY_ID,
          issuer: ISSUER,
        },
      ),
    (error) =>
      error.code ===
      "RECOVERY_REGISTRATION_SOURCE_ATTESTATION_UNAVAILABLE",
  );
});
