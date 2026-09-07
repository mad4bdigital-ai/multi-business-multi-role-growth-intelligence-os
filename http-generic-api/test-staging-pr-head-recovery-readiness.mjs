import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createFileRecoveryEvidenceStore,
} from "./recoveryReadinessEvidence.js";
import {
  createRecoveryReadinessAuthorities,
} from "./stagingRecoveryAuthorityBindingPhaseB.js";
import { runProductionActivationReadiness } from "./productionActivationReadiness.js";

const REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const PR_NUMBER = "7942";
const REF = "feat/runtime-composition-x0-evidence-baseline-test";
const SHA = "a".repeat(40);
const TREE = "b".repeat(40);
const CONTEXT = "c".repeat(64);

const envKeys = [
  "NODE_ENV",
  "DEPLOYMENT_ENVIRONMENT",
  "REMOTE_MCP_ENVIRONMENT",
  "RECOVERY_SERVER_MANAGED_BINDING_MODE",
  "RECOVERY_SERVER_MANAGED_BINDING_MODULE",
  "RECOVERY_STAGING_READINESS_DIRECTORY",
  "RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY",
  "DEPLOYMENT_MANIFEST_JSON",
  "DEPLOYMENT_MANIFEST_PATH",
  "DEPLOY_BRANCH",
  "DEPLOY_COMMIT",
  "DEPLOYMENT_EXPECTED_COMMIT_SHA",
  "STAGING_CERT_AUTHORITY_MODE",
  "STAGING_CERT_PR_NUMBER",
  "STAGING_CERT_PR_REPOSITORY",
];
const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

function restoreEnvironment() {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function readyDimension(overrides = {}) {
  return {
    status: "ready",
    ok: true,
    ready: true,
    read_only_probe: true,
    database_connection_performed: true,
    sql_readback_performed: true,
    sql_mutation_performed: false,
    migration_apply_performed: false,
    provider_mutation_performed: false,
    deployment_performed: false,
    secrets_included: false,
    ...overrides,
  };
}

const root = await mkdtemp(path.join(os.tmpdir(), "staging-pr-head-recovery-readiness-"));
try {
  const readinessRoot = path.join(root, "recovery-readiness");
  const replayRoot = path.join(root, "recovery-ingress");
  Object.assign(process.env, {
    NODE_ENV: "staging",
    DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
    REMOTE_MCP_ENVIRONMENT: "staging",
    RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live",
    RECOVERY_SERVER_MANAGED_BINDING_MODULE: "./stagingRecoveryAuthorityBindingPhaseB.js",
    RECOVERY_STAGING_READINESS_DIRECTORY: readinessRoot,
    RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY: replayRoot,
    DEPLOY_BRANCH: REF,
    DEPLOY_COMMIT: SHA,
    DEPLOYMENT_EXPECTED_COMMIT_SHA: SHA,
    STAGING_CERT_AUTHORITY_MODE: "pull_request_head",
    STAGING_CERT_PR_NUMBER: PR_NUMBER,
    STAGING_CERT_PR_REPOSITORY: REPOSITORY,
    DEPLOYMENT_MANIFEST_JSON: JSON.stringify({
      repository: REPOSITORY,
      branch: REF,
      commit_sha: SHA,
      tree_sha: TREE,
      context_file_set_sha256: CONTEXT,
      build_source: "portable_staging_docker_build",
      secrets_included: false,
    }),
  });
  delete process.env.DEPLOYMENT_MANIFEST_PATH;

  // A stale or invalid release-certification pointer must not poison bounded
  // PR-head readiness. PR-head certification is not release certification.
  const persistentStore = createFileRecoveryEvidenceStore({
    directory: path.join(readinessRoot, "certification-evidence"),
    replayDirectory: replayRoot,
  });
  const staleId = await persistentStore.putCertification({
    payload: { contract: "stale-main-release-certification" },
    signature: "invalid",
  });
  await persistentStore.setCurrentCertification(staleId);

  const authority = createRecoveryReadinessAuthorities({
    environment: "staging",
    runtime_class: "local_windows_docker",
    read_only: true,
    production_live: false,
  });
  const snapshot = await authority.readSnapshot();

  assert.equal(snapshot.pre_certification, true);
  assert.equal(snapshot.authenticity_verified, false);
  assert.equal(snapshot.stagingCertification, null);
  assert.equal(snapshot.candidateSha, SHA);
  assert.match(snapshot.candidateTargetFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(snapshot.deploymentAttestation.repository, REPOSITORY);
  assert.equal(snapshot.deploymentAttestation.branch, REF);
  assert.equal(snapshot.deploymentAttestation.sha, SHA);
  assert.equal(snapshot.deploymentAttestation.manifest_bound, true);
  assert.equal(snapshot.deploymentAttestation.read_only, true);
  assert.equal(snapshot.deploymentAttestation.pr_head_certification_only, true);
  assert.equal(snapshot.deploymentAttestation.production_authority_eligible, false);
  assert.equal(snapshot.deploymentAttestation.branch_match, false);
  assert.equal(snapshot.deploymentAttestation.database_mutation_performed, false);
  assert.equal(snapshot.deploymentAttestation.provider_mutation_performed, false);
  assert.equal(snapshot.deploymentAttestation.secrets_included, false);
  assert.equal(snapshot.adapterProvenance.deployment_sha, SHA);
  assert.deepEqual(snapshot.unresolvedRecoveryIncidents, ["certification_not_issued"]);

  const combined = await runProductionActivationReadiness({
    mcpCatalogReader: async () => readyDimension(),
    governanceDbReader: async () => readyDimension({ ready: true }),
    runtimePersistenceReader: async () => readyDimension(),
    ...snapshot,
    recoveryComposition: null,
    productionLiveRequested: false,
    productionLiveEnabled: false,
    env: process.env,
  });

  assert.equal(combined.status, "ready");
  assert.equal(combined.ok, true);
  assert.equal(combined.ready, true);
  assert.equal(combined.read_only_probe, true);
  assert.equal(combined.sql_mutation_performed, false);
  assert.equal(combined.migration_apply_performed, false);
  assert.equal(combined.provider_mutation_performed, false);
  assert.equal(combined.deployment_performed, false);
  assert.equal(combined.secrets_included, false);
  assert.equal(combined.production_authority_readiness.activation_eligible, false);
  assert.equal(combined.production_live.enabled, false);

  console.log(JSON.stringify({
    ok: true,
    contract: "mad4b.staging-pr-head-recovery-readiness-isolation.v1",
    exact_pr_head_manifest_bound: true,
    stale_release_pointer_ignored: true,
    database_readiness_read_only: true,
    production_authority_expanded: false,
    secrets_included: false,
  }));
} finally {
  restoreEnvironment();
  await rm(root, { recursive: true, force: true });
}
