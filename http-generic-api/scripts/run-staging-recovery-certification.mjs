#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { certifyStagingRecovery } from "../stagingRecoveryCertification.js";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CONFIRMATION = "RUN_STAGING_RECOVERY_CERTIFICATION";

function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) throw new Error(`Unexpected argument: ${raw}`);
    const index = raw.indexOf("=");
    const key = (index === -1 ? raw.slice(2) : raw.slice(2, index)).replaceAll("-", "_");
    out[key] = index === -1 ? "true" : raw.slice(index + 1);
  }
  return out;
}

function required(args, key) {
  const value = String(args[key] || "").trim();
  if (!value) throw new Error(`--${key.replaceAll("_", "-")} is required`);
  return value;
}

function readJson(file) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file} must contain one JSON object`);
  return value;
}

async function fetchJson(url, { apiKey = null, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: apiKey ? { "x-api-key": apiKey, accept: "application/json" } : { accept: "application/json" },
    });
    let body = null;
    try { body = await response.json(); } catch { }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: null, error: String(error?.name || error?.code || "fetch_failed").slice(0, 128) };
  } finally {
    clearTimeout(timer);
  }
}

function safeObservation(value, allowedKeys, label) {
  const unexpected = Object.keys(value || {}).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length) throw new Error(`${label} contains non-evidence fields: ${unexpected.join(", ")}`);
  return value;
}

const args = parseArgs();
if (required(args, "confirmation") !== CONFIRMATION) throw new Error(`Explicit confirmation ${CONFIRMATION} is required`);
const expectedSha = required(args, "expected_sha").toLowerCase();
if (!SHA40.test(expectedSha)) throw new Error("--expected-sha must be an exact lowercase 40-character SHA");
const manifestFile = path.resolve(required(args, "deployment_manifest_file"));
const privateKeyFile = path.resolve(required(args, "private_key_file"));
const registrationFile = path.resolve(required(args, "registration_evidence"));
const oauthFile = path.resolve(required(args, "oauth_evidence"));
const dataRoot = path.resolve(required(args, "data_root"));
const manifest = readJson(manifestFile);
if (manifest.repository !== "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"
  || manifest.branch !== "main" || manifest.commit_sha !== expectedSha
  || !SHA40.test(manifest.tree_sha || "") || !SHA256.test(manifest.context_file_set_sha256 || "")
  || manifest.secrets_included !== false) {
  throw new Error("The deployed Staging manifest is not exact-main, exact-SHA, secret-free provenance");
}

process.env.NODE_ENV = "staging";
process.env.DEPLOYMENT_ENVIRONMENT = "staging_local_windows_docker";
process.env.REMOTE_MCP_ENVIRONMENT = "staging";
process.env.RECOVERY_SERVER_MANAGED_BINDING_MODE = "injected_non_live";
process.env.RECOVERY_STAGING_READINESS_DIRECTORY = path.join(dataRoot, "app", "recovery-readiness");
process.env.RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY = path.join(dataRoot, "app", "recovery-ingress");
process.env.DEPLOYMENT_MANIFEST_JSON = JSON.stringify(manifest);

const backendApiKey = String(process.env.BACKEND_API_KEY || "").trim();
if (!backendApiKey) throw new Error("BACKEND_API_KEY must be available only to the host certification process for public admin readback");
const privateKeyPem = fs.readFileSync(privateKeyFile, "utf8");
const registrationEvidence = safeObservation(readJson(registrationFile), [
  "observed_in", "registration_set", "schema_sha256", "operation_count", "operation_ids_hash", "server", "auth_profile", "observed_at",
], "registration evidence");
const oauthEvidence = safeObservation(readJson(oauthFile), ["issuer", "resource", "steps", "observed_at"], "OAuth evidence");

const gatewayHealth = await fetchJson("https://activation-dev.mad4b.com/health");
if (!gatewayHealth.ok || gatewayHealth.body?.ok !== true || gatewayHealth.body?.stale !== false
  || gatewayHealth.body?.sourceCommit !== expectedSha || gatewayHealth.body?.workerBuildSha !== expectedSha
  || !SHA256.test(gatewayHealth.body?.workerBundleSha256 || "") || gatewayHealth.body?.secretsIncluded !== false) {
  throw new Error(`Staging Worker exact-SHA health evidence is unavailable (HTTP ${gatewayHealth.status})`);
}
const directOrigin = await fetchJson("https://dev.mad4b.com/admin/recovery/staging/readiness", { apiKey: backendApiKey });
const networkEvidence = {
  environment: "staging",
  gateway_host: "activation-dev.mad4b.com",
  upstream_origin: "https://dev.mad4b.com",
  gateway_only: true,
  signed_ingress_required: true,
  network_restriction_verified: directOrigin.status !== 200,
  direct_origin_publicly_reachable: directOrigin.status === 200,
  gateway_health_status: gatewayHealth.status,
  direct_origin_status: directOrigin.status,
};
if (networkEvidence.network_restriction_verified !== true) throw new Error("Direct Staging Recovery origin unexpectedly accepted a public request without signed ingress");
const bundleSha = gatewayHealth.body.workerBundleSha256;
const workerDeploymentEvidence = {
  observed_in: "cloudflare_workers",
  deployment_verified: true,
  gateway_host: "activation-dev.mad4b.com",
  policy_hash: gatewayHealth.body.policyHash,
  worker_build_sha: gatewayHealth.body.workerBuildSha,
  policy_source_sha: gatewayHealth.body.sourceCommit,
  worker_bundle_sha256: bundleSha,
  release_bundle_sha256: bundleSha,
  deployed_bundle_sha256: bundleSha,
  deployment_id: gatewayHealth.body.deploymentId || null,
};

const promoted = await certifyStagingRecovery({
  privateKeyPem,
  registrationEvidence,
  oauthEvidence,
  networkEvidence,
  workerDeploymentEvidence,
});

const readiness = await fetchJson("https://activation-dev.mad4b.com/admin/recovery/staging/readiness", { apiKey: backendApiKey });
if (!readiness.ok || readiness.body?.ready !== true || readiness.body?.status !== "ready"
  || readiness.body?.authority_graph?.ready !== true || readiness.body?.certification?.valid !== true
  || readiness.body?.external_evidence?.ready !== true || readiness.body?.production_live?.enabled !== false
  || readiness.body?.database_mutation_performed !== false || readiness.body?.provider_mutation_performed !== false
  || readiness.body?.secrets_included !== false) {
  throw new Error(`Public signed-ingress Staging Recovery readiness did not certify after promotion (HTTP ${readiness.status})`);
}
const certification = await fetchJson("https://activation-dev.mad4b.com/admin/recovery/staging/certification", { apiKey: backendApiKey });
if (!certification.ok || certification.body?.ok !== true || certification.body?.certification?.valid !== true
  || certification.body?.production_live?.enabled !== false || certification.body?.database_mutation_performed !== false
  || certification.body?.provider_mutation_performed !== false || certification.body?.secrets_included !== false) {
  throw new Error(`Public signed-ingress certification readback failed (HTTP ${certification.status})`);
}

console.log(JSON.stringify({
  contract: "mad4b.staging-recovery-certification-live-run.v1",
  status: "certified",
  evidence_id: promoted.evidence_id,
  certification_id: promoted.certification_id,
  deployment_sha: promoted.deployment_sha,
  target_fingerprint: promoted.target_fingerprint,
  expires_at: promoted.expires_at,
  authority_graph_ready: readiness.body.authority_graph.ready,
  certification_valid: readiness.body.certification.valid,
  external_evidence_ready: readiness.body.external_evidence.ready,
  public_signed_ingress_readback: true,
  production_live_enabled: false,
  production_mutation_performed: false,
  database_mutation_performed: false,
  provider_mutation_performed: false,
  secrets_included: false,
}));
