#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCustomGptLiveRegistrationReadback } from "../customGptLiveRegistrationReadback.js";
import { expectedStagingRegistration } from "../recoveryReadinessEvidence.js";
import { buildStagingRecoveryExternalObservation } from "../stagingRecoveryExternalEvidence.js";

const REGISTRY_URL = new URL("../config/recovery-external-source-authorities.json", import.meta.url);
async function registry() { return JSON.parse(await readFile(REGISTRY_URL, "utf8")); }
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const hash = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

function statusPayload(source) {
  return {
    contract: "mad4b.recovery-external-acquisition-source-status.v1",
    evidence_kind: "registration",
    source: source?.source || "chatgpt_live_readback",
    status: source?.status || "unknown",
    verified: false,
    reason_code: source?.reason_code || "RECOVERY_REGISTRATION_SOURCE_ATTESTATION_UNAVAILABLE",
    secrets_included: false,
  };
}

export async function buildAttestedRegistrationEvidence({
  observed,
  sourceProofHash,
  deploymentSha,
  targetFingerprint,
} = {}) {
  const parity = verifyCustomGptLiveRegistrationReadback({ observed, expectedHeadSha: deploymentSha });
  if (parity.ready !== true) {
    throw Object.assign(new Error("Custom GPT live registration parity failed."), { code: "RECOVERY_REGISTRATION_PARITY_INVALID" });
  }
  const expected = await expectedStagingRegistration();
  return buildStagingRecoveryExternalObservation({
    kind: "registration",
    deploymentSha,
    targetFingerprint,
    sourceProofHash,
    observationId: `registration-${hash(parity).slice(0, 32)}`,
    payload: {
      ...expected,
      observed_in: "chatgpt",
      parity_evidence_sha256: hash(parity),
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = await registry();
  const source = config?.sources?.registration;
  const output = path.resolve(String(process.env.RECOVERY_STAGING_REGISTRATION_STATUS_FILE || "registration-source-status.json"));
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const status = statusPayload(source);
  await writeFile(output, JSON.stringify(status, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify(status) + "\n");
  if (source?.status === "active") {
    throw Object.assign(new Error("Registration source is marked active but no provider-backed source attestation verifier is registered in PR-B1."), {
      code: "RECOVERY_REGISTRATION_SOURCE_VERIFIER_NOT_REGISTERED",
    });
  }
}
