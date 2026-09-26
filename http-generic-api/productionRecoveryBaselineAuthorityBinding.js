import path from "node:path";
import { createPublicKey } from "node:crypto";
import {
  createServerManagedRecoveryAuthorityBinding,
  createServerManagedRecoveryBindingEnvelope,
} from "./serverManagedRecoveryAuthorityBinding.js";
import { createProductionRecoveryAuthorityFoundation } from "./productionRecoveryAuthorityFoundation.js";
import { createProductionRecoveryControlStore } from "./productionRecoveryControlStore.js";
import { createProductionRecoveryDurableEvidenceAdapters } from "./productionRecoveryDurableEvidenceAdapters.js";
import { createProductionRecoveryOperationalAdapters } from "./productionRecoveryOperationalAdapters.js";
import {
  createProductionRecoveryHostLocalBaselineRebuildExecutor,
  createProductionRecoveryIndependentBaselineReadback,
} from "./productionRecoveryHostLocalBaselineRebuild.js";
import { readDeploymentManifest } from "./deploymentManifest.js";
import {
  deriveRoleTargetFingerprints,
  readRuntimeAttestation,
} from "./recoveryTrustModel.js";
import { resolveRuntimeEnvironmentStrict } from "./runtimeEnvironmentResolver.js";
import { PRODUCTION_RECOVERY_LIVE_AUTHORIZATION_CONTRACT } from "./productionRecoveryCompositionFactory.js";
import {
  createFileRecoveryEvidenceStore,
  createRecoveryReadinessAuthorities as createCanonicalRecoveryReadinessAuthorities,
} from "./recoveryReadinessEvidence.js";

export const PRODUCTION_RECOVERY_BASELINE_AUTHORITY_BINDING_CONTRACT =
  "mad4b.production-recovery-baseline-authority-binding.v1";

const REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const BRANCH = "Production";
const SHA40 = /^[0-9a-f]{40}$/u;

const REQUIRED_SERVER_ENV = Object.freeze([
  "RECOVERY_PRODUCTION_APPROVAL_SECRET",
  "RECOVERY_PRODUCTION_EXECUTION_PRIVATE_KEY_JWK",
]);
const REQUIRED_READINESS_ENV = Object.freeze([
  "RECOVERY_PRODUCTION_READINESS_DIRECTORY",
  "RECOVERY_PRODUCTION_CERTIFICATION_PUBLIC_KEY",
  "RECOVERY_PRODUCTION_CERTIFICATION_KEY_ID",
  "RECOVERY_PRODUCTION_CERTIFICATION_ISSUER",
]);
const SAFE_TRUST_ID = /^[A-Za-z0-9._:-]{8,160}$/u;

function text(value, max = 4096) {
  return String(value ?? "").trim().slice(0, max);
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = {
    contract: PRODUCTION_RECOVERY_BASELINE_AUTHORITY_BINDING_CONTRACT,
    production_live_enabled: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    provider_accessed: false,
    secrets_included: false,
    ...details,
  };
  throw error;
}

function assertRuntime(context = {}, env = process.env) {
  const runtime = resolveRuntimeEnvironmentStrict(env);
  if (!runtime?.ok
    || runtime.environment_key !== "production"
    || runtime.runtime_class !== "hostinger_autodeploy"
    || runtime.runtime_class_explicit !== true) {
    fail("RECOVERY_PRODUCTION_BASELINE_RUNTIME_DENIED", "Production Recovery baseline authority requires the explicit Hostinger Production runtime.");
  }
  if (context.environment && context.environment !== "production") {
    fail("RECOVERY_PRODUCTION_BASELINE_CONTEXT_DENIED", "Production Recovery baseline authority environment context is invalid.");
  }
  if (context.runtime_class && context.runtime_class !== "hostinger_autodeploy") {
    fail("RECOVERY_PRODUCTION_BASELINE_CONTEXT_DENIED", "Production Recovery baseline authority runtime class is invalid.");
  }
  if (context.requested_mode && context.requested_mode !== "production_live") {
    fail("RECOVERY_PRODUCTION_BASELINE_MODE_DENIED", "Production Recovery baseline authority is available only through the explicit production_live server-managed binding intent.");
  }
  return runtime;
}

function assertServerSecrets(env = process.env) {
  const missing = REQUIRED_SERVER_ENV.filter((key) => !text(env[key]));
  if (missing.length) {
    fail("RECOVERY_PRODUCTION_BASELINE_SERVER_SECRET_MISSING", "Production Recovery baseline authority server material is not configured.", {
      missing_fields: missing,
    });
  }
}

function assertReadinessContext(context = {}, env = process.env) {
  const runtime = assertRuntime({
    environment: context.environment,
    runtime_class: context.runtime_class,
  }, env);
  if (context.read_only !== true || context.production_live !== false) {
    fail(
      "RECOVERY_PRODUCTION_READINESS_CONTEXT_DENIED",
      "Production Recovery readiness authority requires read_only=true and production_live=false.",
    );
  }
  return runtime;
}

function resolveProductionReadinessConfiguration(env = process.env) {
  const missing = REQUIRED_READINESS_ENV.filter((key) => !text(env[key]));
  if (missing.length) {
    fail(
      "RECOVERY_PRODUCTION_READINESS_CONFIGURATION_MISSING",
      "Production Recovery readiness persistence and public certification trust must be configured atomically.",
      { missing_fields: missing },
    );
  }

  const rootValue = text(env.RECOVERY_PRODUCTION_READINESS_DIRECTORY);
  if (!path.isAbsolute(rootValue)) {
    fail(
      "RECOVERY_PRODUCTION_READINESS_DIRECTORY_INVALID",
      "Production Recovery readiness directory must be an absolute deployment-owned persistent path.",
    );
  }

  const publicKeyPem = String(env.RECOVERY_PRODUCTION_CERTIFICATION_PUBLIC_KEY).trim();
  const keyId = text(env.RECOVERY_PRODUCTION_CERTIFICATION_KEY_ID, 160);
  const issuer = text(env.RECOVERY_PRODUCTION_CERTIFICATION_ISSUER, 512);
  if (!SAFE_TRUST_ID.test(keyId) || !issuer) {
    fail(
      "RECOVERY_PRODUCTION_CERTIFICATION_TRUST_INVALID",
      "Production Recovery certification trust identity is invalid.",
    );
  }

  let verificationKey;
  try {
    verificationKey = createPublicKey(publicKeyPem);
  } catch {
    fail(
      "RECOVERY_PRODUCTION_CERTIFICATION_PUBLIC_KEY_INVALID",
      "Production Recovery certification public key is invalid.",
    );
  }
  if (verificationKey.asymmetricKeyType !== "ed25519") {
    fail(
      "RECOVERY_PRODUCTION_CERTIFICATION_PUBLIC_KEY_INVALID",
      "Production Recovery certification trust must use Ed25519.",
    );
  }

  return Object.freeze({
    root: path.resolve(rootValue),
    publicKey: publicKeyPem,
    keyId,
    issuer,
  });
}

function readExactProductionAttestation(env = process.env) {
  const deployment = readDeploymentManifest(env);
  const manifest = deployment?.ok ? deployment.manifest : null;
  const sha = text(manifest?.commit_sha, 40).toLowerCase();
  if (!manifest
    || manifest.repository !== REPOSITORY
    || manifest.branch !== BRANCH
    || !SHA40.test(sha)
    || manifest.secrets_included !== false) {
    fail("RECOVERY_PRODUCTION_BASELINE_DEPLOYMENT_MANIFEST_INVALID", "Production Recovery baseline authority requires an exact canonical deployment manifest.");
  }
  const attestation = readRuntimeAttestation({ env, expectedSha: sha });
  const fingerprints = deriveRoleTargetFingerprints({ env });
  if (attestation?.parity !== true
    || attestation?.manifest_bound !== true
    || attestation?.repository !== REPOSITORY
    || attestation?.branch !== BRANCH
    || attestation?.deployment_sha !== sha
    || attestation?.secrets_included !== false) {
    fail("RECOVERY_PRODUCTION_BASELINE_DEPLOYMENT_ATTESTATION_INVALID", "Production Recovery baseline deployment attestation is not exact and manifest-bound.");
  }
  return Object.freeze({
    repository: REPOSITORY,
    branch: BRANCH,
    environment: "production",
    sha,
    target_fingerprint: fingerprints.composite,
    target_fingerprints: Object.freeze({
      runtime: fingerprints.runtime,
      governance: fingerprints.governance,
      runtime_persistence: fingerprints.runtime_persistence,
    }),
    recovery_manifest_hash: attestation.recovery_manifest_hash,
    attestation_hash: attestation.attestation_hash,
    manifest_bound: true,
    read_only_probe: true,
    database_connection_performed: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  });
}

export function createProductionRecoveryReadinessAuthoritiesForEnv(
  context = {},
  env = process.env,
  {
    attestationReader = readExactProductionAttestation,
    evidenceStoreFactory = createFileRecoveryEvidenceStore,
    readinessAuthorityFactory = createCanonicalRecoveryReadinessAuthorities,
  } = {},
) {
  const runtime = assertReadinessContext(context, env);
  const configuration = resolveProductionReadinessConfiguration(env);

  const evidenceStore = evidenceStoreFactory({
    directory: path.join(configuration.root, "certification-evidence"),
    replayDirectory: path.join(configuration.root, "replay"),
  });

  const deploymentIdentityProvider = Object.freeze({
    contract: "mad4b.production-recovery-readiness-deployment-identity.v1",
    async readAttestation() {
      const attestation = await attestationReader(env);
      return Object.freeze({
        ...attestation,
        environment: "production",
        sha: attestation.sha,
        deployment_sha: attestation.sha,
        target_fingerprint: attestation.target_fingerprint,
        read_only: true,
        read_only_probe: true,
        database_connection_performed: false,
        database_mutation_performed: false,
        provider_mutation_performed: false,
        secrets_included: false,
      });
    },
  });

  const targetIdentityProvider = Object.freeze({
    contract: "mad4b.production-recovery-readiness-target-identity.v1",
    async readIdentity() {
      const attestation = await attestationReader(env);
      return Object.freeze({
        contract: "mad4b.recovery-target-identity.v1",
        environment: "production",
        runtime_class: runtime.runtime_class,
        target_fingerprint: attestation.target_fingerprint,
        read_only: true,
        database_connection_performed: false,
        database_mutation_performed: false,
        provider_mutation_performed: false,
        secrets_included: false,
      });
    },
  });

  return readinessAuthorityFactory({
    evidenceStore,
    deploymentIdentityProvider,
    targetIdentityProvider,
    publicKey: configuration.publicKey,
    keyId: configuration.keyId,
    issuer: configuration.issuer,
    env,
  });
}

function denyGovernanceMigrationLedgerFinalize() {
  fail(
    "RECOVERY_PRODUCTION_ORDINARY_MIGRATION_NOT_ENABLED",
    "This Production Recovery authority slice permits only approved baseline.rebuild_empty role steps; ordinary migration ledger finalization is not enabled.",
  );
}

export function createProductionRecoveryBaselineBindingForEnv(
  context = {},
  env = process.env,
  {
    controlStoreFactory = createProductionRecoveryControlStore,
    foundationFactory = createProductionRecoveryAuthorityFoundation,
    durableEvidenceFactory = createProductionRecoveryDurableEvidenceAdapters,
    operationalAdaptersFactory = createProductionRecoveryOperationalAdapters,
    baselineExecutorFactory = createProductionRecoveryHostLocalBaselineRebuildExecutor,
    baselineReadbackFactory = createProductionRecoveryIndependentBaselineReadback,
    attestationReader = readExactProductionAttestation,
  } = {},
) {
  assertRuntime(context, env);
  assertServerSecrets(env);

  const foundation = foundationFactory({
    recoveryStoreFactory: ({ executionTicketVerifier }) => controlStoreFactory({
      executionTicketVerifier,
      env,
    }),
    approvalSecret: env.RECOVERY_PRODUCTION_APPROVAL_SECRET,
    executionPrivateKeyJwk: env.RECOVERY_PRODUCTION_EXECUTION_PRIVATE_KEY_JWK,
    executionPublicKeyJwk: text(env.RECOVERY_PRODUCTION_EXECUTION_PUBLIC_KEY_JWK) || null,
    readServerAttestation: async () => attestationReader(env),
  });

  const durable = durableEvidenceFactory({
    recoveryStore: foundation.recoveryStore,
  });

  const baselineExecutor = baselineExecutorFactory({
    env,
    recoveryStore: foundation.recoveryStore,
    executionTicketVerifier: foundation.executionTicketVerifier,
    partialReceiptStore: durable.partialReceiptStore,
  });
  const independentReadback = baselineReadbackFactory({ env });

  const adapters = operationalAdaptersFactory({
    foundation,
    executeDeploymentOwnedMutation: baselineExecutor,
    verifyIndependentReadback: independentReadback,
    persistImmutablePartialReceipt: durable.partialReceiptStore.putImmutablePartialRebuildReceipt.bind(durable.partialReceiptStore),
    resolveDurableInspectionProof: durable.proofResolver,
    finalizeGovernanceMigrationLedger: denyGovernanceMigrationLedgerFinalize,
  });

  const binding = createServerManagedRecoveryAuthorityBinding({
    adapters,
    adapterOrigin: "server_managed_concrete",
    capabilities: {
      adapter_present: true,
      durability_capable: true,
      attestation_capable: true,
    },
    authorityHandles: {
      deployment_owned: true,
      baseline_rebuild_only: true,
      ordinary_migration_enabled: false,
      grant_repair_enabled: false,
      shell_enabled: false,
    },
  });

  const envelope = createServerManagedRecoveryBindingEnvelope({
    binding,
    readiness: {
      adapter_present: true,
      durability_capable: true,
      attestation_capable: true,
    },
    source: "production_recovery_baseline_authority_binding",
  });

  return Object.freeze({
    ...envelope,
    live_authorization: Object.freeze({
      contract: PRODUCTION_RECOVERY_LIVE_AUTHORIZATION_CONTRACT,
      authorized: true,
      environment: "production",
      runtime_class: "hostinger_autodeploy",
      admin_surface: "auth.mad4b.com",
      exact_sha_bound: true,
      single_use_approval: true,
      same_cycle_readback_required: true,
      server_side_approval_resolution: true,
      bootstrap_evidence_independent: true,
      authority_scope: "baseline_rebuild_only",
      ordinary_migration_enabled: false,
      grant_repair_enabled: false,
      shell_enabled: false,
      production_auto_apply: false,
      secrets_included: false,
    }),
    production_live_enabled_by_module: false,
    activation_requires_external_runtime_configuration: true,
    database_connection_performed: false,
    database_mutation_performed: false,
    provider_accessed: false,
    secrets_included: false,
  });
}

export function createServerManagedRecoveryBinding(context = {}) {
  return createProductionRecoveryBaselineBindingForEnv(context, process.env);
}

export function createRecoveryReadinessAuthorities(context = {}) {
  return createProductionRecoveryReadinessAuthoritiesForEnv(context, process.env);
}

export const _testingProductionRecoveryBaselineAuthorityBinding = Object.freeze({
  assertRuntime,
  assertServerSecrets,
  assertReadinessContext,
  resolveProductionReadinessConfiguration,
  readExactProductionAttestation,
  denyGovernanceMigrationLedgerFinalize,
  REQUIRED_SERVER_ENV,
  REQUIRED_READINESS_ENV,
});
