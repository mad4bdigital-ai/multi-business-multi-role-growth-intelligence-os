import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { _testingRecoveryComposition } from "./recoveryComposition.js";
import {
  PRODUCTION_RECOVERY_COMPOSITION_FACTORY_CONTRACT,
  PRODUCTION_RECOVERY_LIVE_AUTHORIZATION_CONTRACT,
  createProductionRecoveryComposition,
} from "./productionRecoveryCompositionFactory.js";

const serverSource = readFileSync(new URL("./server.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("./config/recovery-kernel-manifest.json", import.meta.url), "utf8"));
const runtimeBootstrapContract = JSON.parse(readFileSync(new URL("./config/runtime-bootstrap-contract.json", import.meta.url), "utf8"));

function asyncMethod(value = {}) {
  return async () => value;
}

function makeCompleteAdapters({ independentStore = true } = {}) {
  const executionTicketVerifier = { verify: asyncMethod(true) };
  const recoveryStore = Object.fromEntries(
    _testingRecoveryComposition.STORE_METHODS.map((method) => [method, asyncMethod(true)]),
  );
  recoveryStore.executionTicketVerifier = executionTicketVerifier;
  recoveryStore.recovery_store_contract = "mad4b.recovery-durable-store.v1";
  recoveryStore.independent_of_target_databases = independentStore;
  recoveryStore.target_database_binding = independentStore ? "forbidden" : "runtime_persistence";
  return {
    deploymentIdentityProvider: { readAttestation: asyncMethod({ manifest_bound: true, secrets_included: false }) },
    recoveryStore,
    approvalIssuer: {
      createChallenge: asyncMethod({ issued: true }),
      resolveApprovedToken: asyncMethod({ approval_token: "server-internal-test-token" }),
    },
    approvalVerifier: { verify: asyncMethod(true) },
    approvalStore: { putChallenge: asyncMethod(true), getChallenge: asyncMethod(null) },
    recoveryLock: {
      acquire: asyncMethod({ acquired: true }),
      heartbeat: asyncMethod({ renewed: true }),
      assertFence: asyncMethod({ valid: true }),
      release: asyncMethod({ released: true }),
    },
    mutationExecutor: { execute: asyncMethod({ provider_mutation_performed: false }) },
    hostLocalMutationExecutor: asyncMethod({ provider_mutation_performed: false }),
    readbackVerifier: {
      independent_authority: true,
      role_aware: true,
      mutation_authority: false,
      verify: asyncMethod({ postconditions_passed: true }),
    },
    executionTicketSigner: { sign: asyncMethod("test-signature") },
    executionTicketVerifier,
    partialReceiptStore: { putImmutablePartialRebuildReceipt: asyncMethod({ persisted: true }) },
    proofResolver: () => ({ source: "durable_full_inspection", selected_roles: ["runtime"] }),
    migrationLedger: { finalize: asyncMethod({ finalized: true }) },
  };
}

function liveAuthorization(overrides = {}) {
  return {
    contract: PRODUCTION_RECOVERY_LIVE_AUTHORIZATION_CONTRACT,
    authorized: true,
    environment: "production",
    runtime_class: "hostinger_autodeploy",
    admin_surface: "auth.mad4b.com",
    exact_sha_bound: true,
    single_use_approval: true,
    same_cycle_readback_required: true,
    server_side_approval_token_resolution: true,
    bootstrap_evidence_independent: true,
    secrets_included: false,
    ...overrides,
  };
}

function liveEnvelope({ adapters = makeCompleteAdapters(), authorization = liveAuthorization() } = {}) {
  return {
    binding_source: "server_managed",
    secrets_included: false,
    requested_mode: "production_live",
    adapters,
    capabilities: {
      adapter_present: true,
      durability_capable: true,
      attestation_capable: true,
    },
    live_authorization: authorization,
  };
}

test("default factory is wired at the server boundary but remains fail-closed", () => {
  const composition = createProductionRecoveryComposition({ source: "test_default" });
  assert.equal(composition.mode, "fail_closed");
  assert.equal(composition.live_activation, false);
  assert.equal(composition.productionRecoveryCompositionFactory.contract, PRODUCTION_RECOVERY_COMPOSITION_FACTORY_CONTRACT);
  assert.equal(composition.productionRecoveryCompositionFactory.mode, "disabled");
  assert.equal(composition.productionRecoveryCompositionFactory.adapter_factory_wired, true);
  assert.equal(composition.productionRecoveryCompositionFactory.server_managed_binding_resolved, false);
  assert.deepEqual(composition.productionRecoveryCompositionFactory.authority_readiness.missing_components, [
    "recoveryStore",
    "executionTicketSigner",
    "approvalVerifier",
    "recoveryLock",
    "readbackVerifier",
    "hostLocalMutationExecutor",
    "deploymentIdentityProvider",
  ]);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.activation_eligible, false);
  assert.equal(composition.provider_accessed, false);
  assert.equal(composition.database_mutation_performed, false);
});

test("missing server-managed binding provider fails closed rather than discovering anything", () => {
  const composition = createProductionRecoveryComposition({
    mode: "injected_non_live",
    source: "test_missing_provider",
  });
  assert.equal(composition.mode, "fail_closed");
  assert.equal(composition.productionRecoveryCompositionFactory.denial_reason, "server_managed_binding_provider_not_configured");
  assert.equal(composition.productionRecoveryCompositionFactory.provider_accessed, false);
});

test("direct production_live construction remains forbidden even with adapters", () => {
  assert.throws(
    () => createProductionRecoveryComposition({
      mode: "production_live",
      serverManagedBindingProvider: () => liveEnvelope(),
    }),
    (error) => error.code === "RECOVERY_PRODUCTION_LIVE_DIRECT_CONSTRUCTION_FORBIDDEN" && error.status === 503,
  );
});

test("only a server-managed, secret-free envelope can resolve the non-live graph", () => {
  let providerCalls = 0;
  let receivedContext = null;
  const composition = createProductionRecoveryComposition({
    mode: "injected_non_live",
    source: "test_server_managed_provider",
    serverManagedBindingProvider: (context) => {
      providerCalls += 1;
      receivedContext = context;
      return {
        binding_source: "server_managed",
        secrets_included: false,
        requested_mode: "injected_non_live",
        adapters: makeCompleteAdapters(),
        capabilities: { adapter_present: true, durability_capable: true, attestation_capable: true },
      };
    },
  });
  assert.equal(providerCalls, 1);
  assert.equal(receivedContext.contract, PRODUCTION_RECOVERY_COMPOSITION_FACTORY_CONTRACT);
  assert.equal(receivedContext.requested_by_caller, false);
  assert.equal(receivedContext.gpt_credentials_accepted, false);
  assert.equal(receivedContext.local_connector_accepted, false);
  assert.equal(composition.mode, "injected_non_live");
  assert.equal(composition.live_activation, false);
  assert.equal(composition.productionRecoveryCompositionFactory.server_managed_binding_resolved, true);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.all_required_components_configured, true);
  assert.deepEqual(composition.productionRecoveryCompositionFactory.authority_readiness.missing_components, []);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.activation_eligible, false);
  assert.equal(composition.mutation_authority_available, true);
  assert.equal(composition.provider_accessed, false);
  assert.equal(composition.database_connection_performed, false);
});

test("Production candidate without explicit live authorization remains fail-closed", () => {
  const composition = createProductionRecoveryComposition({
    mode: "injected_non_live",
    source: "test_uncertified_production_candidate",
    serverManagedBindingProvider: () => liveEnvelope({ authorization: null }),
  });
  assert.equal(composition.mode, "fail_closed");
  assert.equal(composition.live_activation, false);
  assert.equal(composition.productionRecoveryCompositionFactory.activation_requested, true);
  assert.equal(composition.productionRecoveryCompositionFactory.denial_reason, "production_live_authorization_incomplete");
  assert.equal(composition.productionRecoveryCompositionFactory.live_authorization.ok, false);
  assert.equal(composition.productionRecoveryCompositionFactory.live_authorization.problems.includes("live_authorization_missing"), true);
});

test("certified Production candidate activates only with independent bootstrap evidence and server-side approval resolution", () => {
  const composition = createProductionRecoveryComposition({
    mode: "injected_non_live",
    source: "test_certified_production_candidate",
    serverManagedBindingProvider: () => liveEnvelope(),
  });
  assert.equal(composition.mode, "production_live");
  assert.equal(composition.live_activation, true);
  assert.equal(composition.mutation_authority_available, true);
  assert.equal(composition.productionRecoveryCompositionFactory.denial_reason, null);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.live_ready, true);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.activation_eligible, true);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.bootstrap_evidence_independent, true);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.server_side_approval_token_resolution, true);
  assert.equal(composition.provider_accessed, false);
  assert.equal(composition.database_connection_performed, false);
  assert.equal(composition.database_mutation_performed, false);
});

test("runtime_persistence-coupled recovery store cannot authorize the bootstrap path", () => {
  const composition = createProductionRecoveryComposition({
    mode: "injected_non_live",
    source: "test_coupled_bootstrap_store",
    serverManagedBindingProvider: () => liveEnvelope({ adapters: makeCompleteAdapters({ independentStore: false }) }),
  });
  assert.equal(composition.mode, "fail_closed");
  assert.equal(composition.live_activation, false);
  assert.equal(composition.productionRecoveryCompositionFactory.denial_reason, "production_live_authorization_incomplete");
  assert.equal(composition.productionRecoveryCompositionFactory.live_authorization.problems.includes("bootstrap_evidence_store_not_independent"), true);
});

test("caller-sourced binding metadata is rejected", () => {
  assert.throws(
    () => createProductionRecoveryComposition({
      mode: "injected_non_live",
      serverManagedBindingProvider: () => ({ binding_source: "caller", secrets_included: false, adapters: makeCompleteAdapters() }),
    }),
    (error) => error.code === "RECOVERY_SERVER_MANAGED_BINDING_SOURCE_INVALID" && error.status === 503,
  );
});

test("secret-bearing binding metadata is rejected before adapter validation", () => {
  assert.throws(
    () => createProductionRecoveryComposition({
      mode: "injected_non_live",
      serverManagedBindingProvider: () => ({ binding_source: "server_managed", secrets_included: true, adapters: makeCompleteAdapters() }),
    }),
    (error) => error.code === "RECOVERY_SERVER_MANAGED_BINDING_SECRETS_FORBIDDEN" && error.status === 503,
  );
});

test("manifest keeps Production disabled by default while the certified server-managed path is repository-supported", () => {
  assert.equal(manifest.production_live_composition.enabled, false);
  assert.equal(manifest.production_live_composition.repository_live_adapter_wiring, false);
  assert.equal(manifest.production_live_composition.server_managed_adapter_factory_wired, true);
  assert.equal(manifest.production_live_composition.live_provider_authority_configured, false);
  assert.equal(runtimeBootstrapContract.mutation_authority.production_live_composition_enabled, false);
  assert.equal(runtimeBootstrapContract.mutation_authority.provider_wiring_in_repository, false);
  assert.equal(runtimeBootstrapContract.mutation_authority.server_managed_adapter_factory_wired, true);
});

test("server composition root uses the factory without caller or credential discovery", () => {
  assert.match(serverSource, /createProductionRecoveryComposition\(\{/u);
  assert.doesNotMatch(serverSource, /RECOVERY_COMPOSITION_LIVE_ENABLED/u);
  assert.doesNotMatch(serverSource, /RUNTIME_BREAKGLASS_GITHUB_TOKEN/u);
  assert.doesNotMatch(serverSource, /process\.env\.(DB_PASSWORD|DATABASE_URL|MYSQL_BOOTSTRAP_PASSWORD)/u);
});

console.log(JSON.stringify({
  ok: true,
  contract: PRODUCTION_RECOVERY_COMPOSITION_FACTORY_CONTRACT,
  cases: 11,
  default_live_activation: false,
  certified_server_managed_activation_supported: true,
  provider_accessed: false,
  database_mutation_performed: false,
  secrets_included: false,
}, null, 2));
