#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFileRecoveryEvidenceStore } from "../recoveryReadinessEvidence.js";
import { publishVerifiedStagingRecoveryCertification } from "../stagingRecoveryCertificationProtocol.js";
import { loadStagingRecoveryCertificationPublicTrust } from "../stagingRecoveryCertificationPublicTrust.js";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw Object.assign(new Error(`${key} is required`), { code: "RECOVERY_STAGING_PUBLICATION_INPUT_MISSING" });
  return value;
}

async function json(file) {
  return JSON.parse(await readFile(path.resolve(file), "utf8"));
}

export async function publishStagingRecoveryCountersign({ env = process.env } = {}) {
  const file = required(env, "RECOVERY_STAGING_SIGNED_CERTIFICATION_FILE");
  const expectedSha = required(env, "RECOVERY_STAGING_EXPECTED_SHA").toLowerCase();
  if (!SHA40.test(expectedSha)) throw Object.assign(new Error("RECOVERY_STAGING_EXPECTED_SHA must be a full lowercase SHA."), { code: "RECOVERY_STAGING_PUBLICATION_SHA_INVALID" });

  const signedRecord = await json(file);
  const payload = signedRecord?.payload;
  if (!payload || payload.deployment_sha !== expectedSha || !SHA256.test(payload.target_fingerprint || "")) {
    throw Object.assign(new Error("Signed certification is not bound to the expected Staging deployment."), { code: "RECOVERY_STAGING_PUBLICATION_BINDING_INVALID" });
  }

  const readinessRoot = path.resolve(required(env, "RECOVERY_STAGING_READINESS_DIRECTORY"));
  const replayRoot = path.resolve(required(env, "RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY"));
  if (readinessRoot === replayRoot || readinessRoot.startsWith(`${replayRoot}${path.sep}`) || replayRoot.startsWith(`${readinessRoot}${path.sep}`)) {
    throw Object.assign(new Error("Readiness and ingress replay stores must remain isolated."), { code: "RECOVERY_STAGING_PUBLICATION_STORE_ISOLATION_INVALID" });
  }

  const trust = loadStagingRecoveryCertificationPublicTrust(env);
  if (!trust) throw Object.assign(new Error("Dedicated Staging Recovery certification public trust is not configured."), { code: "RECOVERY_STAGING_PUBLICATION_TRUST_UNAVAILABLE" });
  const evidenceStore = createFileRecoveryEvidenceStore({
    directory: path.join(readinessRoot, "certification-evidence"),
    replayDirectory: replayRoot,
  });
  const result = await publishVerifiedStagingRecoveryCertification({
    signedRecord,
    trust,
    evidenceStore,
    expectedSha,
    expectedTargetFingerprint: payload.target_fingerprint,
    expectedRunId: payload.certification_run_id,
    expectedNonce: payload.nonce,
  });
  return Object.freeze({
    ...result,
    branch: "main",
    production_live_enabled: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await publishStagingRecoveryCountersign();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
