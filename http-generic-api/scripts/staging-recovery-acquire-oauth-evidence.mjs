#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOAuthServerCorrelationEvidence } from "../stagingRecoveryExternalEvidence.js";

const REGISTRY_URL = new URL("../config/recovery-external-source-authorities.json", import.meta.url);
const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

async function registry() { return JSON.parse(await readFile(REGISTRY_URL, "utf8")); }
function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw Object.assign(new Error(`${key} is required`), { code: "RECOVERY_OAUTH_ACQUISITION_INPUT_MISSING" });
  return value;
}
function statusPayload(source, extra = {}) {
  return {
    contract: "mad4b.recovery-external-acquisition-source-status.v1",
    evidence_kind: "oauth",
    source: source?.source || "oauth_server_correlation",
    status: source?.status || "unknown",
    verified: false,
    reason_code: source?.reason_code || "RECOVERY_OAUTH_SOURCE_UNAVAILABLE",
    ...extra,
    secrets_included: false,
  };
}

export async function acquireStagingRecoveryOAuthEvidence({
  expectedSha,
  expectedTargetFingerprint,
  correlationUrl,
  backendApiKey,
  fetchImpl = fetch,
} = {}) {
  const config = await registry();
  const source = config?.sources?.oauth;
  if (source?.status !== "active") {
    return { evidence: null, status: statusPayload(source) };
  }
  if (!SHA40.test(expectedSha || "") || !SHA256.test(expectedTargetFingerprint || "")) {
    throw Object.assign(new Error("Exact SHA and target fingerprint are required."), { code: "RECOVERY_OAUTH_ACQUISITION_BINDING_INVALID" });
  }
  const url = new URL(correlationUrl);
  if (url.protocol !== "https:" || !["dev.mad4b.com", "activation-dev.mad4b.com"].includes(url.hostname)) {
    throw Object.assign(new Error("OAuth correlation source must be a registered Staging HTTPS host."), { code: "RECOVERY_OAUTH_CORRELATION_SOURCE_INVALID" });
  }
  const headers = backendApiKey ? { authorization: `Bearer ${backendApiKey}` } : {};
  const response = await fetchImpl(url, { method: "GET", headers, redirect: "error" });
  if (!response.ok) {
    throw Object.assign(new Error(`OAuth correlation source returned HTTP ${response.status}.`), { code: "RECOVERY_OAUTH_CORRELATION_SOURCE_UNAVAILABLE" });
  }
  const payload = await response.json();
  if (payload?.contract !== "mad4b.tenant-gpt-oauth-correlation-chain.v1"
    || payload.environment !== "staging"
    || payload.deployment_sha !== expectedSha
    || payload.target_fingerprint !== expectedTargetFingerprint
    || payload.server_derived !== true
    || payload.secrets_included !== false
    || !Array.isArray(payload.chain)) {
    throw Object.assign(new Error("OAuth correlation source response is not server-derived exact-target evidence."), { code: "RECOVERY_OAUTH_CORRELATION_SOURCE_INVALID" });
  }
  const evidence = buildOAuthServerCorrelationEvidence({
    chain: payload.chain,
    deploymentSha: expectedSha,
    targetFingerprint: expectedTargetFingerprint,
  });
  return { evidence, status: { ...statusPayload(source), status: "active", verified: true, reason_code: null } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = await registry();
  const source = config?.sources?.oauth;
  const probeOnly = String(process.env.RECOVERY_STAGING_SOURCE_PROBE_ONLY || "").toLowerCase() === "true";
  const outputStatus = path.resolve(required(process.env, "RECOVERY_STAGING_OAUTH_STATUS_FILE"));
  await mkdir(path.dirname(outputStatus), { recursive: true, mode: 0o700 });
  if (probeOnly || source?.status !== "active") {
    const status = statusPayload(source);
    await writeFile(outputStatus, JSON.stringify(status, null, 2) + "\n", { mode: 0o600 });
    process.stdout.write(JSON.stringify(status) + "\n");
  } else {
    const result = await acquireStagingRecoveryOAuthEvidence({
      expectedSha: required(process.env, "RECOVERY_STAGING_EXPECTED_SHA").toLowerCase(),
      expectedTargetFingerprint: required(process.env, "RECOVERY_STAGING_EXPECTED_TARGET_FINGERPRINT").toLowerCase(),
      correlationUrl: required(process.env, "RECOVERY_STAGING_OAUTH_CORRELATION_URL"),
      backendApiKey: process.env.BACKEND_API_KEY || "",
    });
    await writeFile(path.resolve(required(process.env, "RECOVERY_STAGING_OAUTH_EVIDENCE_FILE")), JSON.stringify(result.evidence, null, 2) + "\n", { mode: 0o600 });
    await writeFile(outputStatus, JSON.stringify(result.status, null, 2) + "\n", { mode: 0o600 });
    process.stdout.write(JSON.stringify(result.status) + "\n");
  }
}
