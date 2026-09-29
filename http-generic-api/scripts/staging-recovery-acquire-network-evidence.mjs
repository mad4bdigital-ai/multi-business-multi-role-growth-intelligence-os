#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNetworkIsolationEvidence } from "../stagingRecoveryExternalEvidence.js";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ROUTE = "/admin/recovery/staging/contract";

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw Object.assign(new Error(`${key} is required`), { code: "RECOVERY_NETWORK_ACQUISITION_INPUT_MISSING" });
  return value;
}
async function responseShape(response) {
  let body = null;
  try { body = await response.clone().json(); } catch {}
  return {
    status: response.status,
    reason: body?.error?.code || body?.code || body?.reason || null,
  };
}
function bodyHash() { return createHash("sha256").update("").digest("hex"); }

export async function acquireStagingRecoveryNetworkEvidence({
  expectedSha,
  expectedTargetFingerprint,
  directBaseUrl = "https://dev.mad4b.com",
  gatewayBaseUrl = "https://activation-dev.mad4b.com",
  fetchImpl = fetch,
} = {}) {
  if (!SHA40.test(expectedSha || "") || !SHA256.test(expectedTargetFingerprint || "")) {
    throw Object.assign(new Error("Exact SHA and target fingerprint are required."), { code: "RECOVERY_NETWORK_ACQUISITION_BINDING_INVALID" });
  }
  const method = "GET";
  const body_sha256 = bodyHash();
  const [directResponse, gatewayResponse, healthResponse] = await Promise.all([
    fetchImpl(new URL(ROUTE, directBaseUrl), { method, redirect: "manual" }),
    fetchImpl(new URL(ROUTE, gatewayBaseUrl), { method, redirect: "manual" }),
    fetchImpl(new URL("/health", gatewayBaseUrl), { method: "GET", redirect: "manual" }),
  ]);
  const directShape = await responseShape(directResponse);
  const gatewayShape = await responseShape(gatewayResponse);
  const direct = { path: ROUTE, method, body_sha256, ...directShape };
  const gateway = { path: ROUTE, method, body_sha256, status: gatewayShape.status, public_health_status: healthResponse.status };
  return buildNetworkIsolationEvidence({
    direct,
    gateway,
    deploymentSha: expectedSha,
    targetFingerprint: expectedTargetFingerprint,
    gatewayHost: new URL(gatewayBaseUrl).host,
    upstreamOrigin: new URL(directBaseUrl).origin,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evidence = await acquireStagingRecoveryNetworkEvidence({
    expectedSha: required(process.env, "RECOVERY_STAGING_EXPECTED_SHA").toLowerCase(),
    expectedTargetFingerprint: required(process.env, "RECOVERY_STAGING_EXPECTED_TARGET_FINGERPRINT").toLowerCase(),
    directBaseUrl: process.env.RECOVERY_STAGING_DIRECT_BASE_URL || "https://dev.mad4b.com",
    gatewayBaseUrl: process.env.RECOVERY_STAGING_GATEWAY_BASE_URL || "https://activation-dev.mad4b.com",
  });
  const output = path.resolve(required(process.env, "RECOVERY_STAGING_NETWORK_EVIDENCE_FILE"));
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify({ ok: true, evidence_hash: evidence.evidence_hash, source_proof_hash: evidence.source_proof_hash, secrets_included: false }) + "\n");
}
