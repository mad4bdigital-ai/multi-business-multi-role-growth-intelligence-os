import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  signRecoveryExternalAcquisitionReceipt,
} from "../../http-generic-api/recoveryExternalAcquisitionAuthority.js";
import {
  unavailableRegistrationSourceVerification,
  verifyRecoveryNetworkIsolationSource,
  verifyRecoveryOAuthServerCorrelationSource,
} from "../../http-generic-api/stagingRecoveryExternalEvidence.js";

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) {
    const error = new Error(`${key} is required`);
    error.code = "RECOVERY_ACQUISITION_INPUT_MISSING";
    throw error;
  }
  return value;
}
async function json(file) {
  return JSON.parse(await readFile(path.resolve(file), "utf8"));
}

export async function signStagingRecoveryAcquisitionReceipt({
  env = process.env,
} = {}) {
  const expectedSha = required(env, "RECOVERY_ACQUISITION_EXPECTED_SHA");
  const expectedTargetFingerprint = required(
    env,
    "RECOVERY_ACQUISITION_EXPECTED_TARGET_FINGERPRINT",
  );
  const registrationEvidence = await json(
    required(env, "RECOVERY_ACQUISITION_REGISTRATION_EVIDENCE_FILE"),
  );
  const oauthEvidence = await json(
    required(env, "RECOVERY_ACQUISITION_OAUTH_EVIDENCE_FILE"),
  );
  const networkEvidence = await json(
    required(env, "RECOVERY_ACQUISITION_NETWORK_EVIDENCE_FILE"),
  );

  const registration = unavailableRegistrationSourceVerification(
    registrationEvidence,
  );
  const oauth = verifyRecoveryOAuthServerCorrelationSource(oauthEvidence, {
    expectedSha,
    expectedTargetFingerprint,
  });
  const network = verifyRecoveryNetworkIsolationSource(networkEvidence, {
    expectedSha,
    expectedTargetFingerprint,
  });

  const sourceVerification = { registration, oauth, network };
  const blockers = Object.entries(sourceVerification)
    .filter(([, value]) => value?.verified !== true)
    .map(([kind, value]) => ({
      kind,
      reason_code:
        value?.reason_code || "RECOVERY_EXTERNAL_SOURCE_ATTESTATION_INVALID",
    }));

  const outputDirectory = path.resolve(
    required(env, "RECOVERY_ACQUISITION_OUTPUT_DIRECTORY"),
  );
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

  if (blockers.length) {
    const status = {
      contract: "mad4b.recovery-external-acquisition-status.v1",
      environment: "staging",
      deployment_sha: expectedSha,
      target_fingerprint: expectedTargetFingerprint,
      receipt_signed: false,
      blockers,
      provider_mutation_performed: false,
      database_mutation_performed: false,
      production_mutation_performed: false,
      secrets_included: false,
    };
    await writeFile(
      path.join(outputDirectory, "acquisition-status.json"),
      JSON.stringify(status, null, 2) + "\n",
      { mode: 0o600 },
    );
    return status;
  }

  const receipt = signRecoveryExternalAcquisitionReceipt(
    {
      deploymentSha: expectedSha,
      targetFingerprint: expectedTargetFingerprint,
      acquisitionRunId:
        env.GITHUB_RUN_ID
          ? `github-acquisition:${env.GITHUB_RUN_ID}`
          : required(env, "RECOVERY_ACQUISITION_RUN_ID"),
      registrationEvidence,
      oauthEvidence,
      networkEvidence,
      sourceVerification,
    },
    {
      privateKey: required(
        env,
        "STAGING_RECOVERY_ACQUISITION_PRIVATE_KEY",
      ),
      keyId: required(env, "STAGING_RECOVERY_ACQUISITION_KEY_ID"),
      issuer: required(env, "STAGING_RECOVERY_ACQUISITION_ISSUER"),
    },
  );
  await writeFile(
    path.join(outputDirectory, "acquisition-receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
    { mode: 0o600 },
  );
  const status = {
    contract: "mad4b.recovery-external-acquisition-status.v1",
    environment: "staging",
    deployment_sha: expectedSha,
    target_fingerprint: expectedTargetFingerprint,
    receipt_signed: true,
    blockers: [],
    provider_mutation_performed: false,
    database_mutation_performed: false,
    production_mutation_performed: false,
    secrets_included: false,
  };
  await writeFile(
    path.join(outputDirectory, "acquisition-status.json"),
    JSON.stringify(status, null, 2) + "\n",
    { mode: 0o600 },
  );
  return status;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await signStagingRecoveryAcquisitionReceipt();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
