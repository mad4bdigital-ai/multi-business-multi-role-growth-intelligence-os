import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRecoveryReadinessSigningPayload, independentlyVerifyStagingRecoveryCanaryEvidence } from "../../http-generic-api/stagingRecoveryCertificationProtocol.js";
import { signVerifiedRecoveryEvidence } from "./staging-recovery-sign-certification.mjs";

const REQUIRED_FILES = Object.freeze({ plan: "kernel-plan.json", approval: "kernel-approval.json", ticket: "kernel-ticket.json", receipt: "kernel-receipt.json", run: "kernel-run.json" });
async function json(file) { return JSON.parse(await readFile(file, "utf8")); }
function required(env, key) { const value = String(env[key] || "").trim(); if (!value) throw Object.assign(new Error(`${key} is required`), { code: "RECOVERY_COUNTERSIGN_INPUT_MISSING" }); return value; }

export async function verifyAndCountersignStagingRecovery({ evidenceDirectory, outputDirectory, env = process.env } = {}) {
  const root = path.resolve(evidenceDirectory); const output = path.resolve(outputDirectory);
  const envelope = await json(path.join(root, "canary-evidence.json"));
  const artifacts = Object.fromEntries(await Promise.all(Object.entries(REQUIRED_FILES).map(async ([key, file]) => [key, await json(path.join(root, file))])));
  const expectedSha = required(env, "GITHUB_SHA"); const expectedTargetFingerprint = required(env, "RECOVERY_STAGING_EXPECTED_TARGET_FINGERPRINT");
  const report = await independentlyVerifyStagingRecoveryCanaryEvidence(envelope, { expectedSha, expectedTargetFingerprint, workflowSourceSha: expectedSha, loadKernelArtifacts: async (ids) => {
    if (artifacts.plan.plan_id !== ids.plan_id || artifacts.approval.approval_id !== ids.approval_id || artifacts.ticket.ticket_id !== ids.ticket_id || artifacts.run.run_id !== ids.run_id) throw Object.assign(new Error("Kernel artifact identity mismatch"), { code: "RECOVERY_COUNTERSIGN_ARTIFACT_IDENTITY_MISMATCH" });
    return artifacts;
  } });
  const payload = buildRecoveryReadinessSigningPayload(envelope, report, { issuer: required(env, "RECOVERY_STAGING_CERTIFICATION_ISSUER"), keyId: required(env, "RECOVERY_STAGING_CERTIFICATION_KEY_ID") });
  const signed = signVerifiedRecoveryEvidence({ payload, verificationReport: report, env });
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(path.join(output, "verification-report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  await writeFile(path.join(output, "signed-certification.json"), JSON.stringify(signed, null, 2) + "\n", { mode: 0o600 });
  return { verified: true, deployment_sha: expectedSha, target_fingerprint: expectedTargetFingerprint, certification_run_id: envelope.certification_run_id, secrets_included: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyAndCountersignStagingRecovery({ evidenceDirectory: required(process.env, "RECOVERY_STAGING_EVIDENCE_DIRECTORY"), outputDirectory: required(process.env, "RECOVERY_STAGING_COUNTERSIGN_OUTPUT_DIRECTORY") });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
