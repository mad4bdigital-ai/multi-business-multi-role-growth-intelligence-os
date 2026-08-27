import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { _testingRecoveryComposition } from "./recoveryComposition.js";
import {
  PRODUCTION_RECOVERY_COMPOSITION_FACTORY_CONTRACT,
  createProductionRecoveryComposition,
} from "./productionRecoveryCompositionFactory.js";

const serverSource = readFileSync(new URL("./server.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("./config/recovery-kernel-manifest.json", import.meta.url), "utf8"));
const runtimeBootstrapContract = JSON.parse(readFileSync(new URL("./config/runtime-bootstrap-contract.json", import.meta.url), "utf8"));

function asyncMethod(value = {}) {
  return async () => value;
}

function makeCompleteAdapters() {
  const executionTicketVerifier = { verify: asyncMethod(true) };
  const recoveryStore = Object.fromEntries(
    _testingRecoveryComposition.STORE_METHODS.map((method) => [method, asyncMethod(true)]),
  );
  recoveryStore.executionTicketVerifier = executionTicketVerifier;
  return {
    deploymentIdentityProvider: { readAttestation: asyncMethod({ manifest_bound: true, secrets_included: false }) },
    recoveryStore,
    approvalIssuer: { createChallenge: asyncMethod({ issued: true }) },
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
    readbackVerifier: { verify: asyncMethod({ postconditions_passed: true }) },
    executionTicketSigner: { sign: asyncMethod("test-signature") },
    executionTicketVerifier,
    partialReceiptStore: { putImmutablePartialRebuildReceipt: asyncMethod({ persisted: true }) },
    proofResolver: () => ({ source: "durable_full_inspection", selected_roles: ["runtime"] }),
    migrationLedger: { finalize: asyncMethod({ finalized: true }) },
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

test("production_live remains hard-denied even when a provider callback is supplied", () => {
  assert.throws(
    () => createProductionRecoveryComposition({
      mode: "production_live",
      serverManagedBindingProvider: () => ({ binding_source: "server_managed", secrets_included: false, adapters: makeCompleteAdapters() }),
    }),
    (error) => error.code === "RECOVERY_PRODUCTION_LIVE_DISABLED" && error.status === 503,
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
      return { binding_source: "server_managed", secrets_included: false, adapters: makeCompleteAdapters() };
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

test("manifest and bootstrap contract distinguish factory wiring from live activation", () => {
  assert.equal(manifest.production_live_composition.enabled, false);
  assert.equal(manifest.production_live_composition.repository_live_adapter_wiring, false);
  assert.equal(manifest.production_live_composition.server_managed_adapter_factory_wired, true);
  assert.equal(manifest.production_live_composition.live_provider_authority_configured, false);
  assert.equal(manifest.production_live_composition.live_authority_readiness_contract, "mad4b.recovery-live-authority-readiness.v1");
  assert.deepEqual(manifest.production_live_composition.required_live_authority_components, [
    "recoveryStore",
    "executionTicketSigner",
    "approvalVerifier",
    "recoveryLock",
    "readbackVerifier",
    "hostLocalMutationExecutor",
    "deploymentIdentityProvider",
  ]);
  assert.equal(runtimeBootstrapContract.mutation_authority.production_live_composition_enabled, false);
  assert.equal(runtimeBootstrapContract.mutation_authority.provider_wiring_in_repository, false);
  assert.equal(runtimeBootstrapContract.mutation_authority.server_managed_adapter_factory_wired, true);
  assert.equal(runtimeBootstrapContract.mutation_authority.live_authority_readiness_contract, "mad4b.recovery-live-authority-readiness.v1");
  assert.deepEqual(runtimeBootstrapContract.mutation_authority.required_live_authority_components, manifest.production_live_composition.required_live_authority_components);
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
  cases: 8,
  live_activation: false,
  provider_accessed: false,
  database_mutation_performed: false,
  secrets_included: false,
}, null, 2));
