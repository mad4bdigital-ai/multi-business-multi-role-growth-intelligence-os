import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductionRecoveryComposition,
} from "./productionRecoveryCompositionFactory.js";
import {
  createServerManagedRecoveryBindingProvider,
  getServerManagedRecoveryBindingMode,
  getServerManagedRecoveryBindingStatus,
} from "./serverManagedRecoveryBindingProvider.js";
import {
  createServerManagedRecoveryAuthorityBinding,
  createServerManagedRecoveryBindingEnvelope,
  evaluateServerManagedRecoveryBindingReadiness,
} from "./serverManagedRecoveryAuthorityBinding.js";
import {
  createServerManagedDeploymentIdentityProvider,
} from "./serverManagedDeploymentIdentityProvider.js";
import { validateDeploymentIdentityAttestation } from "./recoveryExecutionBinding.js";
import {
  RECOVERY_BRANCH,
  RECOVERY_REPOSITORY,
} from "./recoveryTrustModel.js";

const STORE_METHODS = [
  "putRun", "getRun", "putPlan", "getPlan", "putFinding", "getFinding", "getRunByIdempotency",
  "appendEvidenceEvent", "putIdempotencyReceipt", "putApproval", "getApprovalByPlanStep", "claimExecution",
  "reserveApproval", "getExecutionTicket", "putExecutionTicket", "reserveExecutionTicket",
  "releaseExecutionTicket", "finalizeExecutionTicket", "releaseExecutionClaim", "releaseApprovalReservation",
];

function createTestAdapters() {
  const calls = [];
  const verifier = { verify: () => ({ ok: true }) };
  const store = Object.fromEntries(STORE_METHODS.map((method) => [method, (...args) => { calls.push([method, args]); return null; }]));
  store.executionTicketVerifier = verifier;
  const adapters = {
    deploymentIdentityProvider: { readAttestation: async () => ({}) },
    recoveryStore: store,
    approvalIssuer: { createChallenge: () => ({}) },
    approvalVerifier: { verify: () => ({ ok: true }) },
    approvalStore: { putChallenge: () => null, getChallenge: () => null },
    recoveryLock: { acquire: () => ({}), heartbeat: () => ({}), assertFence: () => true, release: () => true },
    mutationExecutor: { execute: () => ({}) },
    hostLocalMutationExecutor: () => ({}),
    readbackVerifier: { verify: () => ({ ok: true }) },
    executionTicketSigner: { sign: () => "signature" },
    executionTicketVerifier: verifier,
    partialReceiptStore: { putImmutablePartialRebuildReceipt: () => null },
    proofResolver: () => ({}),
    migrationLedger: { finalize: () => ({}) },
  };
  return { adapters, calls };
}

function createValidEnvelope() {
  const { adapters } = createTestAdapters();
  const binding = createServerManagedRecoveryAuthorityBinding({
    adapters,
    adapterOrigin: "server_managed_concrete",
    capabilities: {
      adapter_present: true,
      durability_capable: true,
      attestation_capable: true,
    },
    authorityHandles: { handles_are_opaque: true },
  });
  return createServerManagedRecoveryBindingEnvelope({ binding });
}

function validAttestation(sha = "a".repeat(40)) {
  return {
    contract: "mad4b.recovery-runtime-attestation.v1",
    repository: RECOVERY_REPOSITORY,
    branch: RECOVERY_BRANCH,
    deployment_sha: sha,
    repository_sha: sha,
    recovery_manifest_hash: "b".repeat(64),
    attestation_hash: "c".repeat(64),
    manifest_bound: true,
    read_only_probe: true,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  };
}

test("default server-managed mode remains disabled and exposes no binding", () => {
  assert.equal(getServerManagedRecoveryBindingMode({ NODE_ENV: "production", RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live" }), "disabled");
  assert.equal(getServerManagedRecoveryBindingMode({ NODE_ENV: "unknown", RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live" }), "disabled");
  assert.equal(getServerManagedRecoveryBindingMode({ NODE_ENV: "staging", REMOTE_MCP_ENVIRONMENT: "staging", RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live" }), "injected_non_live");
  assert.equal(getServerManagedRecoveryBindingMode({ NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker", RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live" }), "injected_non_live");
  assert.equal(getServerManagedRecoveryBindingMode({ NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "production", RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live" }), "disabled");
  assert.equal(getServerManagedRecoveryBindingMode({ DEPLOYMENT_ENVIRONMENT: "unknown", RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live" }), "disabled");
  const status = getServerManagedRecoveryBindingStatus({ env: {} });
  assert.equal(status.module_configured, false);
  assert.equal(status.secrets_included, false);
});

test("valid concrete server-managed bundle becomes complete non-live composition", () => {
  let resolverCalls = 0;
  let resolverContext = null;
  const provider = createServerManagedRecoveryBindingProvider({ resolver: (context) => { resolverCalls += 1; resolverContext = context; return createValidEnvelope(); } });
  const composition = createProductionRecoveryComposition({ mode: "injected_non_live", serverManagedBindingProvider: provider, source: "test_server_root" });
  assert.equal(resolverCalls, 1);
  assert.equal(resolverContext.binding_source, "server_managed");
  assert.equal(resolverContext.caller_credentials_accepted, false);
  assert.equal(resolverContext.gpt_credentials_accepted, false);
  assert.equal(resolverContext.local_connector_accepted, false);
  assert.equal(resolverContext.provider_discovery, false);
  assert.equal(resolverContext.database_discovery, false);
  assert.equal(resolverContext.secrets_included, false);
  assert.equal(composition.configured, true);
  assert.equal(composition.live_activation, false);
  assert.equal(composition.provider_accessed, false);
  assert.equal(composition.database_connection_performed, false);
  assert.equal(composition.database_mutation_performed, false);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.all_required_components_configured, true);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.adapter_present, true);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.durability_capable, true);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.attestation_capable, true);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.live_ready, false);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.activation_eligible, false);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.secrets_included, false);
  assert.deepEqual(evaluateServerManagedRecoveryBindingReadiness({ binding: createValidEnvelope() }), {
    contract: "mad4b.recovery-server-managed-authority-readiness.v1",
    adapter_present: true,
    durability_capable: true,
    attestation_capable: true,
    live_ready: false,
    activation_eligible: false,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  });
});

test("every missing live authority fails closed and is reported", () => {
  const liveAuthorities = [
    "recoveryStore",
    "executionTicketSigner",
    "approvalVerifier",
    "recoveryLock",
    "readbackVerifier",
    "hostLocalMutationExecutor",
    "deploymentIdentityProvider",
  ];
  for (const component of liveAuthorities) {
    const envelope = createValidEnvelope();
    const missing = { ...envelope, adapters: { ...envelope.adapters, [component]: null } };
    const provider = createServerManagedRecoveryBindingProvider({ resolver: () => missing });
    assert.throws(
      () => createProductionRecoveryComposition({ mode: "injected_non_live", serverManagedBindingProvider: provider }),
      (error) => error.code === "RECOVERY_SERVER_MANAGED_BINDING_ADAPTERS_INVALID"
        && error.details.missing_components.some((item) => item.component === component),
      component,
    );
  }
});

test("recoveryStore must retain the exact injected executionTicketVerifier object", () => {
  const envelope = createValidEnvelope();
  const wrongVerifier = { verify: () => ({ ok: true }) };
  const invalid = { ...envelope, adapters: { ...envelope.adapters, executionTicketVerifier: wrongVerifier } };
  const provider = createServerManagedRecoveryBindingProvider({ resolver: () => invalid });
  assert.throws(
    () => createProductionRecoveryComposition({ mode: "injected_non_live", serverManagedBindingProvider: provider }),
    (error) => error.code === "RECOVERY_SERVER_MANAGED_BINDING_ADAPTERS_INVALID"
      && error.details.missing_components.some((item) => item.component === "recoveryStore.executionTicketVerifier"),
  );
});

test("caller/GPT/local connector inputs and credential-shaped fields are rejected", () => {
  const valid = createValidEnvelope();
  assert.throws(() => createServerManagedRecoveryBindingProvider({ resolver: () => ({ binding_source: "caller", secrets_included: false, adapters: valid.adapters }) })({}), (error) => error.code === "RECOVERY_SERVER_MANAGED_BINDING_SOURCE_INVALID");
  assert.throws(() => createServerManagedRecoveryBindingProvider({ resolver: () => ({ ...valid, password: "must-not-appear" }) })({}), (error) => error.code === "RECOVERY_SERVER_MANAGED_BINDING_SECRET_FIELD_FORBIDDEN");
  assert.throws(() => createServerManagedRecoveryBindingProvider({ resolver: () => ({ ...valid, local_connector: {} }) })({}), (error) => error.code === "RECOVERY_SERVER_MANAGED_BINDING_CALLER_INPUT_FORBIDDEN");
  assert.throws(() => createServerManagedRecoveryBindingProvider({ resolver: () => ({ ...valid, raw_sql: "SELECT 1" }) })({}), (error) => error.code === "RECOVERY_SERVER_MANAGED_BINDING_CALLER_INPUT_FORBIDDEN");
});

test("test or dummy adapter origins are rejected before binding", () => {
  const { adapters } = createTestAdapters();
  assert.throws(
    () => createServerManagedRecoveryAuthorityBinding({ adapters, adapterOrigin: "test_double", capabilities: { adapter_present: true, durability_capable: true, attestation_capable: true } }),
    (error) => error.code === "RECOVERY_SERVER_MANAGED_CONCRETE_ORIGIN_INVALID",
  );
  assert.throws(
    () => createServerManagedRecoveryAuthorityBinding({ adapters, adapterOrigin: "mock", capabilities: { adapter_present: true, durability_capable: true, attestation_capable: true } }),
    (error) => error.code === "RECOVERY_SERVER_MANAGED_CONCRETE_ORIGIN_INVALID",
  );
});

test("unresolved deployment identity cannot satisfy the authority binding", () => {
  const { adapters } = createTestAdapters();
  adapters.deploymentIdentityProvider = null;
  assert.throws(
    () => createServerManagedRecoveryAuthorityBinding({ adapters, capabilities: { adapter_present: true, durability_capable: true, attestation_capable: true } }),
    (error) => error.code === "RECOVERY_COMPOSITION_INCOMPLETE",
  );
});

test("server-derived deployment identity ignores caller expected_sha and rejects scope or integrity drift", async () => {
  let receivedArguments = null;
  const provider = createServerManagedDeploymentIdentityProvider({
    readServerAttestation: (...args) => { receivedArguments = args; return validAttestation(); },
  });
  const attestation = await provider.readAttestation({ expected_sha: "f".repeat(40), target_key: "caller-controlled" });
  assert.deepEqual(receivedArguments, []);
  assert.equal(attestation.repository, RECOVERY_REPOSITORY);
  assert.equal(attestation.branch, RECOVERY_BRANCH);
  assert.equal(attestation.deployment_sha, "a".repeat(40));
  const mismatch = validateDeploymentIdentityAttestation({
    attestation,
    expectedSha: "d".repeat(40),
    expectedRepository: RECOVERY_REPOSITORY,
    expectedBranch: RECOVERY_BRANCH,
    expectedManifestHash: "b".repeat(64),
  });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.problems.includes("deployment_sha_mismatch"));
  await assert.rejects(
    () => createServerManagedDeploymentIdentityProvider({ readServerAttestation: () => validAttestation().constructor === Object ? { ...validAttestation(), branch: "main" } : null }).readAttestation(),
    (error) => error.code === "RECOVERY_SERVER_DEPLOYMENT_IDENTITY_SCOPE_MISMATCH",
  );
});

test("production_live remains explicitly hard-denied", () => {
  assert.throws(() => createProductionRecoveryComposition({ mode: "production_live", serverManagedBindingProvider: () => createValidEnvelope() }), (error) => error.code === "RECOVERY_PRODUCTION_LIVE_DISABLED");
});

test("readiness construction performs no adapter, provider, database, or mutation calls", () => {
  const { adapters, calls } = createTestAdapters();
  const envelope = createServerManagedRecoveryBindingEnvelope({
    binding: createServerManagedRecoveryAuthorityBinding({
      adapters,
      capabilities: { adapter_present: true, durability_capable: true, attestation_capable: true },
    }),
  });
  assert.equal(calls.length, 0);
  assert.equal(envelope.provider_accessed, false);
  assert.equal(envelope.database_connection_performed, false);
  assert.equal(envelope.database_mutation_performed, false);
});
