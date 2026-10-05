#!/usr/bin/env node
import { evaluateImmutableStagingArtifactIntegrity } from "../stagingImmutableArtifactIntegrity.js";

const CONTRACT = "mad4b.staging-certification-runtime-integrity-compat.v1";
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const IMAGE = /^sha256:[0-9a-f]{64}$/u;

function text(value) {
  return String(value || "").trim().toLowerCase();
}

function required(name, pattern) {
  const value = text(process.env[name]);
  if (!pattern.test(value)) {
    console.error(`${name} is missing or invalid`);
    process.exit(2);
  }
  return value;
}

const authorityCommit = required("STAGING_CERT_COMPAT_AUTHORITY_COMMIT", SHA40);
const expectedCommit = required("STAGING_CERT_EXPECTED_COMMIT", SHA40);
const expectedTree = required("STAGING_CERT_EXPECTED_TREE", SHA40);
const expectedContext = required("STAGING_CERT_EXPECTED_CONTEXT_FILE_SET_SHA256", SHA256);
const expectedImage = required("STAGING_CERT_APP_IMAGE_ID", IMAGE);
const baseUrl = new URL(String(process.env.STAGING_CERT_APP_BASE_URL || "http://127.0.0.1:8080"));
const deploymentUrl = new URL("/deployment-info", baseUrl);

let status = 0;
let body = null;
let fetchError = null;
try {
  const response = await fetch(deploymentUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  status = response.status;
  body = await response.json().catch(() => null);
} catch (error) {
  fetchError = String(error?.name || error?.code || "fetch_failed").slice(0, 128);
}

const runtimeIntegrity = body?.runtime_integrity || null;
const appManifest = body?.deployment || {};
const immutable = evaluateImmutableStagingArtifactIntegrity({
  runtimeIntegrity,
  appManifest,
  expectedCommit,
  expectedTree,
  expectedContextFileSet: expectedContext,
  expectedImageDigest: expectedImage,
});

const checks = Object.freeze({
  deployment_info_reachable: status >= 200 && status < 300 && body?.ok === true,
  exact_commit: text(body?.commit_sha || body?.commit) === expectedCommit,
  staging_app_environment: text(body?.app_env) === "staging",
  runtime_integrity_read_only: runtimeIntegrity?.read_only_check === true,
  deployment_evidence_secret_free: body?.evidence?.secrets_included === false,
  immutable_artifact_verified: immutable.verified === true,
});

const verified = Object.values(checks).every(Boolean);
const report = {
  contract: CONTRACT,
  verified,
  authority_mode: "control_plane_current",
  authority_commit: authorityCommit,
  expected: {
    commit_sha: expectedCommit,
    tree_sha: expectedTree,
    context_file_set_sha256: expectedContext,
    image_digest: expectedImage,
  },
  observed: {
    http_status: status || null,
    commit_sha: text(body?.commit_sha || body?.commit) || null,
    app_env: body?.app_env || null,
    runtime_integrity_state: runtimeIntegrity?.state || null,
    runtime_integrity_reason_codes: Array.isArray(runtimeIntegrity?.reason_codes)
      ? runtimeIntegrity.reason_codes
      : [],
    tree_sha: text(appManifest?.tree_sha) || null,
    context_file_set_sha256: text(appManifest?.context_file_set_sha256) || null,
    image_digest: text(appManifest?.image_digest) || null,
  },
  checks,
  immutable_artifact_checks: immutable.checks,
  fetch_error: fetchError,
  read_only: true,
  mutation_performed: false,
  secrets_included: false,
};

console.log(JSON.stringify(report));
if (!verified) process.exitCode = 1;
