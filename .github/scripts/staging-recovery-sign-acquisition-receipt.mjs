#!/usr/bin/env node
import { createPrivateKey, sign } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_CONTRACT,
  recoveryExternalAcquisitionCanonicalJson,
} from "../../http-generic-api/recoveryExternalAcquisitionAuthority.js";
import {
  recoveryExternalObservationReceiptBinding,
} from "../../http-generic-api/stagingRecoveryExternalEvidence.js";
import {
  verifyRecoveryExternalEvidenceIntegrity,
} from "../../http-generic-api/recoveryReadinessEvidence.js";

const REGISTRY_URL = new URL("../../http-generic-api/config/recovery-external-source-authorities.json", import.meta.url);
const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const EXPECTED_SOURCE = Object.freeze({
  registration: "chatgpt_live_readback",
  oauth: "oauth_server_correlation",
  network: "independent_network_probe",
});

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw Object.assign(new Error(`${key} is required`), { code: "RECOVERY_ACQUISITION_SIGNING_INPUT_MISSING" });
  return value;
}
async function json(file) { return JSON.parse(await readFile(path.resolve(file), "utf8")); }
async function registry() { return JSON.parse(await readFile(REGISTRY_URL, "utf8")); }

export function sourceAuthorityReadiness(config) {
  const blockers = [];
  for (const kind of Object.keys(EXPECTED_SOURCE)) {
    const source = config?.sources?.[kind];
    if (source?.source !== EXPECTED_SOURCE[kind] || source?.status !== "active") {
      blockers.push(Object.freeze({
        kind,
        source: source?.source || EXPECTED_SOURCE[kind],
        status: source?.status || "missing",
        reason_code: source?.reason_code || "RECOVERY_ACQUISITION_SOURCE_AUTHORITY_UNAVAILABLE",
      }));
    }
  }
  return Object.freeze({
    contract: "mad4b.recovery-external-acquisition-source-readiness.v1",
    ready: blockers.length === 0,
    blockers: Object.freeze(blockers),
    manual_override_allowed: config?.manual_override_allowed === false ? false : null,
    caller_assertion_allowed: config?.caller_assertion_allowed === false ? false : null,
    environment_flag_can_activate_source: config?.environment_flag_can_activate_source === false ? false : null,
    receipt_issued: false,
    secrets_included: false,
  });
}

export function buildSignedRecoveryExternalAcquisitionReceipt({
  privateKey,
  keyId,
  issuer,
  acquisitionRunId,
  expectedSha,
  expectedTargetFingerprint,
  registrationEvidence,
  oauthEvidence,
  networkEvidence,
  issuedAt = new Date().toISOString(),
  expiresAt = new Date(Date.now() + 15 * 60_000).toISOString(),
} = {}) {
  if (!SHA40.test(expectedSha || "") || !SHA256.test(expectedTargetFingerprint || "")
    || !keyId || !issuer || !acquisitionRunId) {
    throw Object.assign(new Error("Exact acquisition receipt identity is required."), { code: "RECOVERY_ACQUISITION_RECEIPT_IDENTITY_INVALID" });
  }
  const evidenceByKind = { registration: registrationEvidence, oauth: oauthEvidence, network: networkEvidence };
  const observations = {};
  for (const [kind, evidence] of Object.entries(evidenceByKind)) {
    if (!verifyRecoveryExternalEvidenceIntegrity(evidence, {
      kind,
      expectedSha,
      expectedTargetFingerprint,
    })) {
      throw Object.assign(new Error(`${kind} evidence failed canonical integrity verification.`), { code: "RECOVERY_ACQUISITION_EVIDENCE_INVALID" });
    }
    const binding = recoveryExternalObservationReceiptBinding(evidence);
    if (binding.source !== EXPECTED_SOURCE[kind]) {
      throw Object.assign(new Error(`${kind} source is not canonical.`), { code: "RECOVERY_ACQUISITION_SOURCE_INVALID" });
    }
    observations[kind] = binding;
  }
  const payload = {
    contract: RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_CONTRACT,
    environment: "staging",
    deployment_sha: expectedSha,
    target_fingerprint: expectedTargetFingerprint,
    acquisition_run_id: acquisitionRunId,
    issuer,
    key_id: keyId,
    issued_at: issuedAt,
    expires_at: expiresAt,
    observations,
    secrets_included: false,
  };
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") {
    throw Object.assign(new Error("Acquisition signing key must be Ed25519."), { code: "RECOVERY_ACQUISITION_SIGNING_KEY_INVALID" });
  }
  const signature = sign(null, Buffer.from(recoveryExternalAcquisitionCanonicalJson(payload)), key).toString("base64url");
  return Object.freeze({ ...payload, signature_b64url: signature });
}

export async function runAcquisitionReceiptSigner({ env = process.env } = {}) {
  const config = await registry();
  const readiness = sourceAuthorityReadiness(config);
  const statusFile = path.resolve(required(env, "RECOVERY_STAGING_ACQUISITION_STATUS_FILE"));
  await mkdir(path.dirname(statusFile), { recursive: true, mode: 0o700 });
  if (!readiness.ready) {
    await writeFile(statusFile, JSON.stringify(readiness, null, 2) + "\n", { mode: 0o600 });
    return readiness;
  }

  const expectedSha = required(env, "RECOVERY_STAGING_EXPECTED_SHA").toLowerCase();
  const expectedTargetFingerprint = required(env, "RECOVERY_STAGING_EXPECTED_TARGET_FINGERPRINT").toLowerCase();
  const receipt = buildSignedRecoveryExternalAcquisitionReceipt({
    privateKey: required(env, "STAGING_RECOVERY_ACQUISITION_PRIVATE_KEY"),
    keyId: required(env, "STAGING_RECOVERY_ACQUISITION_KEY_ID"),
    issuer: required(env, "STAGING_RECOVERY_ACQUISITION_ISSUER"),
    acquisitionRunId: required(env, "RECOVERY_STAGING_ACQUISITION_RUN_ID"),
    expectedSha,
    expectedTargetFingerprint,
    registrationEvidence: await json(required(env, "RECOVERY_STAGING_REGISTRATION_EVIDENCE_FILE")),
    oauthEvidence: await json(required(env, "RECOVERY_STAGING_OAUTH_EVIDENCE_FILE")),
    networkEvidence: await json(required(env, "RECOVERY_STAGING_NETWORK_EVIDENCE_FILE")),
  });
  const output = path.resolve(required(env, "RECOVERY_STAGING_ACQUISITION_RECEIPT_FILE"));
  await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  const status = Object.freeze({
    ...readiness,
    receipt_issued: true,
    acquisition_run_id: receipt.acquisition_run_id,
  });
  await writeFile(statusFile, JSON.stringify(status, null, 2) + "\n", { mode: 0o600 });
  return status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runAcquisitionReceiptSigner();
  process.stdout.write(JSON.stringify(result) + "\n");
}
