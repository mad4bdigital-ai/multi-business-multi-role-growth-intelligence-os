import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { getRecoveryTrustModel, readRuntimeAttestation } from "./recoveryTrustModel.js";

const SHA = "049bdfaff24966843cc1c55c9b61431d788acd60";
const REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";

function deploymentManifest() {
  return {
    repository: REPOSITORY,
    branch: "Production",
    commit_sha: SHA,
    secrets_included: false,
  };
}

test("runtime attestation resolves DEPLOYMENT_MANIFEST_PATH through the canonical identity source", () => {
  const dir = mkdtempSync(join(tmpdir(), "mad4b-recovery-identity-"));
  const path = join(dir, "deployment-manifest.json");
  try {
    writeFileSync(path, JSON.stringify(deploymentManifest()));
    const env = {
      DEPLOYMENT_MANIFEST_PATH: path,
      DEPLOYMENT_ENVIRONMENT: "production",
      GITHUB_REPOSITORY: "wrong/repository",
      GITHUB_REF_NAME: "main",
      GITHUB_SHA: "1".repeat(40),
    };
    const attestation = readRuntimeAttestation({ env, expectedSha: SHA });
    assert.equal(attestation.parity, true);
    assert.equal(attestation.manifest_bound, true);
    assert.equal(attestation.repository, REPOSITORY);
    assert.equal(attestation.branch, "Production");
    assert.equal(attestation.deployment_sha, SHA);
    assert.equal(attestation.identity_source, path);
    assert.equal(attestation.deployment_identity_manifest_bound, true);

    const model = getRecoveryTrustModel({ env, expectedSha: SHA });
    assert.equal(model.ok, true);
    assert.equal(model.identity.repository, REPOSITORY);
    assert.equal(model.identity.branch, "Production");
    assert.equal(model.identity.sha, SHA);
    assert.equal(model.identity.source, path);
    assert.equal(model.identity.manifest_bound, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compatibility DEPLOYMENT_COMMIT_JSON is canonical for trust when no manifest JSON is present", () => {
  const env = {
    DEPLOYMENT_COMMIT_JSON: JSON.stringify(deploymentManifest()),
    DEPLOYMENT_ENVIRONMENT: "production",
  };
  const attestation = readRuntimeAttestation({ env, expectedSha: SHA });
  assert.equal(attestation.parity, true);
  assert.equal(attestation.manifest_bound, true);
  assert.equal(attestation.identity_source, "env:DEPLOYMENT_COMMIT_JSON");
  assert.equal(attestation.deployment_sha, SHA);
});

console.log(JSON.stringify({
  ok: true,
  manifest_path_identity_shared: true,
  compatibility_commit_json_shared: true,
  divergent_fallback_identity_blocked: true,
  database_mutation_performed: false,
  secrets_included: false
}, null, 2));
