#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServerManagedRecoveryBinding } from "../stagingRecoveryAuthorityBindingPhaseB.js";
import { readDeploymentManifest } from "../deploymentManifest.js";
import { runGenuineStagingRecoveryCanary } from "../stagingRecoveryCertificationProtocol.js";

const SHA40 = /^[a-f0-9]{40}$/u;
const REQUIRED_EVIDENCE = Object.freeze({
  registrationEvidence: "RECOVERY_STAGING_REGISTRATION_EVIDENCE_FILE",
  oauthEvidence: "RECOVERY_STAGING_OAUTH_EVIDENCE_FILE",
  networkEvidence: "RECOVERY_STAGING_NETWORK_EVIDENCE_FILE",
  workerDeploymentEvidence: "RECOVERY_STAGING_WORKER_EVIDENCE_FILE",
  ingressBuildIdentity: "RECOVERY_STAGING_INGRESS_BUILD_IDENTITY_FILE",
});

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw Object.assign(new Error(`${key} is required`), { code: "RECOVERY_STAGING_CANARY_INPUT_MISSING" });
  return value;
}

async function jsonFile(file) {
  const raw = await readFile(path.resolve(file), "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error(`Evidence file must contain one JSON object: ${file}`), { code: "RECOVERY_STAGING_CANARY_EVIDENCE_INVALID" });
  }
  return parsed;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function manifestIntegrity(env) {
  const result = readDeploymentManifest(env);
  if (!result?.ok || !result?.manifest) {
    throw Object.assign(new Error("A verified deployment manifest is required before Staging recovery certification."), { code: "RECOVERY_STAGING_CANARY_DEPLOYMENT_MANIFEST_INVALID" });
  }
  const payload = JSON.stringify(canonical(result.manifest));
  return Object.freeze({
    valid: true,
    manifest_sha256: createHash("sha256").update(payload).digest("hex"),
    repository: result.manifest.repository || null,
    branch: result.manifest.branch || null,
    deployment_sha: result.manifest.commit_sha || null,
    manifest_bound: true,
    secrets_included: false,
  });
}

export async function produceStagingRecoveryCanaryArtifacts({ env = process.env } = {}) {
  const expectedSha = required(env, "RECOVERY_STAGING_EXPECTED_SHA").toLowerCase();
  if (!SHA40.test(expectedSha)) throw Object.assign(new Error("RECOVERY_STAGING_EXPECTED_SHA must be a full lowercase 40-character SHA."), { code: "RECOVERY_STAGING_CANARY_SHA_INVALID" });
  const outputDirectory = path.resolve(required(env, "RECOVERY_STAGING_CANARY_OUTPUT_DIRECTORY"));
  const externalEvidence = {};
  for (const [field, envKey] of Object.entries(REQUIRED_EVIDENCE)) externalEvidence[field] = await jsonFile(required(env, envKey));

  const binding = createServerManagedRecoveryBinding(Object.freeze({
    environment: "staging",
    runtime_class: "local_windows_docker",
    requested_mode: "injected_non_live",
    production_live: false,
    read_only: false,
  }));
  const result = await runGenuineStagingRecoveryCanary({
    expectedSha,
    externalEvidence,
    artifactIntegrity: manifestIntegrity(env),
  }, { env, adapters: binding.adapters });

  if (result.approval_token_returned !== false || result.production_live_enabled !== false || result.secrets_included !== false) {
    throw Object.assign(new Error("The Staging canary crossed its no-secret/no-Production boundary."), { code: "RECOVERY_STAGING_CANARY_BOUNDARY_INVALID" });
  }

  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const files = Object.freeze({
    "canary-evidence.json": result.envelope,
    "kernel-plan.json": result.artifacts.plan,
    "kernel-approval.json": result.artifacts.approval,
    "kernel-ticket.json": result.artifacts.ticket,
    "kernel-receipt.json": result.artifacts.receipt,
    "kernel-run.json": result.artifacts.run,
  });
  for (const [name, value] of Object.entries(files)) {
    await writeFile(path.join(outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }
  const summary = {
    contract: "mad4b.staging-recovery-canary-artifact-bundle.v1",
    deployment_sha: result.envelope.deployment_sha,
    target_fingerprint: result.envelope.target_fingerprint,
    certification_run_id: result.envelope.certification_run_id,
    evidence_envelope_sha256: result.envelope.evidence_envelope_sha256,
    approval_token_returned: false,
    production_live_enabled: false,
    secrets_included: false,
  };
  await writeFile(path.join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const summary = await produceStagingRecoveryCanaryArtifacts();
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
