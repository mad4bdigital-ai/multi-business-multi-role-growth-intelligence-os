import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import {
  createRecoveryExternalAcquisitionAuthority,
  isRecoveryExternalAcquisitionAuthority,
} from "./recoveryExternalAcquisitionAuthority.js";
import {
  buildNetworkIsolationEvidence,
  buildStagingRecoveryExternalObservation,
} from "./stagingRecoveryExternalEvidence.js";
import { recoveryExternalEvidenceHash } from "./recoveryReadinessEvidence.js";
import {
  buildSignedRecoveryExternalAcquisitionReceipt,
  sourceAuthorityReadiness,
} from "../.github/scripts/staging-recovery-sign-acquisition-receipt.mjs";

const SHA = "a".repeat(40);
const TARGET = "b".repeat(64);
const ISSUER = "https://activation-dev.mad4b.com";
const KEY_ID = "staging-recovery-acquisition-test";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" });

function evidenceSet() {
  const registration = buildStagingRecoveryExternalObservation({
    kind: "registration",
    deploymentSha: SHA,
    targetFingerprint: TARGET,
    observationId: "registration-observation-test",
    sourceProofHash: "1".repeat(64),
    payload: {
      observed_in: "chatgpt",
      registration_set: "admin_activation_staging",
      schema_sha256: "2".repeat(64),
      operation_count: 7,
      operation_ids_hash: "3".repeat(64),
      server: "https://activation-dev.mad4b.com",
      auth_profile: "admin_service",
    },
  });
  const oauth = buildStagingRecoveryExternalObservation({
    kind: "oauth",
    deploymentSha: SHA,
    targetFingerprint: TARGET,
    observationId: "oauth-observation-test",
    sourceProofHash: "4".repeat(64),
    payload: {
      issuer: "https://dev.mad4b.com",
      resource: "https://activation-dev.mad4b.com",
      steps: {
        authorize: "pass",
        login_consent: "pass",
        code: "pass",
        callback: "pass",
        token: "pass",
        resource: "pass",
      },
    },
  });
  const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const network = buildNetworkIsolationEvidence({
    deploymentSha: SHA,
    targetFingerprint: TARGET,
    direct: {
      path: "/admin/recovery/staging/contract",
      method: "GET",
      body_sha256: emptyHash,
      status: 403,
      reason: "RECOVERY_TRUSTED_INGRESS_REQUIRED",
    },
    gateway: {
      path: "/admin/recovery/staging/contract",
      method: "GET",
      body_sha256: emptyHash,
      status: 200,
      public_health_status: 200,
    },
  });
  return { registration, oauth, network };
}

function receipt(set = evidenceSet(), times = {}) {
  return buildSignedRecoveryExternalAcquisitionReceipt({
    privateKey: PRIVATE_PEM,
    keyId: KEY_ID,
    issuer: ISSUER,
    acquisitionRunId: "gha:123456:1",
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
    registrationEvidence: set.registration,
    oauthEvidence: set.oauth,
    networkEvidence: set.network,
    issuedAt: times.issuedAt,
    expiresAt: times.expiresAt,
  });
}

test("signed acquisition receipt verifies exact evidence, SHA and target", async () => {
  const set = evidenceSet();
  const signed = receipt(set);
  const authority = createRecoveryExternalAcquisitionAuthority({
    publicKey: PUBLIC_PEM,
    keyId: KEY_ID,
    issuer: ISSUER,
  });
  assert.equal(isRecoveryExternalAcquisitionAuthority(authority), true);
  assert.equal(isRecoveryExternalAcquisitionAuthority({ verify: authority.verify }), false);
  const result = await authority.verify({
    receipt: signed,
    registrationEvidence: set.registration,
    oauthEvidence: set.oauth,
    networkEvidence: set.network,
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
  });
  assert.equal(result.verified, true);
  assert.match(result.receipt_sha256, /^[a-f0-9]{64}$/);
});

test("receipt rejects forged signature and cross-target reuse", async () => {
  const set = evidenceSet();
  const signed = receipt(set);
  const authority = createRecoveryExternalAcquisitionAuthority({
    publicKey: PUBLIC_PEM,
    keyId: KEY_ID,
    issuer: ISSUER,
  });
  const forged = { ...signed, signature_b64url: signed.signature_b64url.slice(0, -1) + (signed.signature_b64url.endsWith("A") ? "B" : "A") };
  assert.equal((await authority.verify({
    receipt: forged,
    registrationEvidence: set.registration,
    oauthEvidence: set.oauth,
    networkEvidence: set.network,
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
  })).reason_code, "RECOVERY_EXTERNAL_ACQUISITION_SIGNATURE_INVALID");
  assert.equal((await authority.verify({
    receipt: signed,
    registrationEvidence: set.registration,
    oauthEvidence: set.oauth,
    networkEvidence: set.network,
    expectedSha: "c".repeat(40),
    expectedTargetFingerprint: TARGET,
  })).reason_code, "RECOVERY_EXTERNAL_ACQUISITION_TARGET_MISMATCH");
  assert.equal((await authority.verify({
    receipt: signed,
    registrationEvidence: set.registration,
    oauthEvidence: set.oauth,
    networkEvidence: set.network,
    expectedSha: SHA,
    expectedTargetFingerprint: "d".repeat(64),
  })).reason_code, "RECOVERY_EXTERNAL_ACQUISITION_TARGET_MISMATCH");
});

test("receipt rejects evidence mutation even when evidence hash is recomputed", async () => {
  const set = evidenceSet();
  const signed = receipt(set);
  const mutatedBase = { ...set.registration, operation_count: 999 };
  delete mutatedBase.evidence_hash;
  const mutated = { ...mutatedBase, evidence_hash: recoveryExternalEvidenceHash(mutatedBase) };
  const authority = createRecoveryExternalAcquisitionAuthority({
    publicKey: PUBLIC_PEM,
    keyId: KEY_ID,
    issuer: ISSUER,
  });
  const result = await authority.verify({
    receipt: signed,
    registrationEvidence: mutated,
    oauthEvidence: set.oauth,
    networkEvidence: set.network,
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
  });
  assert.equal(result.reason_code, "RECOVERY_EXTERNAL_ACQUISITION_EVIDENCE_BINDING_INVALID");
});

test("expired acquisition receipt is rejected", async () => {
  const set = evidenceSet();
  const signed = receipt(set, {
    issuedAt: "2026-09-28T00:00:00.000Z",
    expiresAt: "2026-09-28T00:10:00.000Z",
  });
  const authority = createRecoveryExternalAcquisitionAuthority({
    publicKey: PUBLIC_PEM,
    keyId: KEY_ID,
    issuer: ISSUER,
    now: () => Date.parse("2026-09-29T00:00:00.000Z"),
  });
  const result = await authority.verify({
    receipt: signed,
    registrationEvidence: set.registration,
    oauthEvidence: set.oauth,
    networkEvidence: set.network,
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
  });
  assert.equal(result.reason_code, "RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_EXPIRED");
});

test("source authority registry cannot be activated by caller flags", () => {
  const readiness = sourceAuthorityReadiness({
    sources: {
      registration: {
        source: "chatgpt_live_readback",
        status: "unavailable",
        reason_code: "RECOVERY_REGISTRATION_SOURCE_ATTESTATION_UNAVAILABLE",
      },
      oauth: {
        source: "oauth_server_correlation",
        status: "foundation_only",
        reason_code: "RECOVERY_OAUTH_RUNTIME_CORRELATION_UNAVAILABLE",
      },
      network: {
        source: "independent_network_probe",
        status: "active",
        reason_code: null,
      },
    },
    manual_override_allowed: false,
    caller_assertion_allowed: false,
    environment_flag_can_activate_source: false,
  });
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.blockers.map((item) => item.kind), ["registration", "oauth"]);
  assert.equal(readiness.manual_override_allowed, false);
  assert.equal(readiness.caller_assertion_allowed, false);
  assert.equal(readiness.environment_flag_can_activate_source, false);
});
