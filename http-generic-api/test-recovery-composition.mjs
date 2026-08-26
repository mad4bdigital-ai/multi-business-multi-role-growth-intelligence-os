import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  RECOVERY_COMPOSITION_CONTRACT,
  createRecoveryComposition,
  getRecoveryCompositionRouteDependencies,
  validateRecoveryCompositionAdapters,
  _testingRecoveryComposition,
} from "./recoveryComposition.js";

const serverSource = readFileSync(new URL("./server.js", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("./routes/recoveryKernelRoutes.js", import.meta.url), "utf8");

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
    recoveryStore,
    approvalIssuer: { createChallenge: asyncMethod({ issued: true }) },
    approvalVerifier: { verify: asyncMethod(true) },
    approvalStore: { putChallenge: asyncMethod(true), getChallenge: asyncMethod(null) },
    recoveryLock: {
      acquire: asyncMethod({ acquired: true, lease_id: "lease:test", fencing_token: "fence:test", expires_at: new Date(Date.now() + 60_000).toISOString() }),
      heartbeat: asyncMethod({ renewed: true }),
      assertFence: asyncMethod({ valid: true }),
      release: asyncMethod({ released: true }),
    },
    mutationExecutor: { execute: asyncMethod({ database_mutation_performed: false, provider_mutation_performed: false }) },
    hostLocalMutationExecutor: asyncMethod({ database_mutation_performed: false, provider_mutation_performed: false }),
    readbackVerifier: { verify: asyncMethod({ postconditions_passed: true, behavioral_probe_passed: true }) },
    executionTicketSigner: { sign: asyncMethod("test-signature") },
    executionTicketVerifier,
    partialReceiptStore: { putImmutablePartialRebuildReceipt: asyncMethod({ persisted: true }) },
    proofResolver: () => ({ source: "durable_full_inspection", selected_roles: ["runtime"] }),
  };
}

test("default Recovery composition is explicitly fail-closed and provider-free", () => {
  const composition = createRecoveryComposition({ source: "test_default" });
  assert.equal(composition.contract, RECOVERY_COMPOSITION_CONTRACT);
  assert.equal(composition.mode, "fail_closed");
  assert.equal(composition.configured, false);
  assert.equal(composition.live_activation, false);
  assert.equal(composition.provider_accessed, false);
  assert.equal(composition.database_connection_performed, false);
  assert.equal(composition.database_mutation_performed, false);
  assert.equal(composition.mutation_authority_available, false);
  assert.equal(composition.components.recoveryStore, null);
  assert.equal(composition.hostBreakglassBroker.hostLocalMutationExecutor, null);
  assert.equal(getRecoveryCompositionRouteDependencies(composition).hostBreakglassMutationExecutor, null);
  assert.equal(composition.runtimeBootstrapDependencies.partialReceiptStore, null);
  assert.equal(composition.runtimeBootstrapDependencies.executionTicketVerifier, null);
});

test("partial authority graphs are rejected before they can reach a route", () => {
  assert.throws(
    () => createRecoveryComposition({ mode: "injected_non_live", adapters: { recoveryStore: {} } }),
    (error) => error.code === "RECOVERY_COMPOSITION_INCOMPLETE" && error.status === 503,
  );
});

test("execution-ticket verifier must be the same object bound into the durable store", () => {
  const adapters = makeCompleteAdapters();
  adapters.recoveryStore.executionTicketVerifier = { verify: asyncMethod(true) };
  assert.throws(
    () => validateRecoveryCompositionAdapters(adapters),
    (error) => error.code === "RECOVERY_COMPOSITION_INCOMPLETE"
      && error.details?.missing_components?.some((entry) => entry.component === "recoveryStore.executionTicketVerifier"),
  );
});

test("complete injected graph remains non-live and is exposed through three bounded route dependency groups", () => {
  const adapters = makeCompleteAdapters();
  const composition = createRecoveryComposition({ mode: "injected_non_live", adapters, source: "test_injected" });
  const routeDeps = getRecoveryCompositionRouteDependencies(composition);
  assert.equal(composition.configured, true);
  assert.equal(composition.mode, "injected_non_live");
  assert.equal(composition.live_activation, false);
  assert.equal(composition.provider_accessed, false);
  assert.equal(routeDeps.recoveryStore, adapters.recoveryStore);
  assert.equal(routeDeps.approvalVerifier, adapters.approvalVerifier);
  assert.equal(routeDeps.recoveryLock, adapters.recoveryLock);
  assert.equal(routeDeps.mutationExecutor, adapters.mutationExecutor);
  assert.equal(routeDeps.readbackVerifier, adapters.readbackVerifier);
  assert.equal(routeDeps.executionTicketSigner, adapters.executionTicketSigner);
  assert.equal(routeDeps.executionTicketVerifier, adapters.executionTicketVerifier);
  assert.equal(routeDeps.broker.hostLocalMutationExecutor, adapters.hostLocalMutationExecutor);
  assert.equal(routeDeps.hostBreakglassMutationExecutor, adapters.hostLocalMutationExecutor);
  assert.equal(routeDeps.runtimeBootstrapDependencies.partialReceiptStore, adapters.partialReceiptStore);
  assert.equal(routeDeps.runtimeBootstrapDependencies.executionTicketVerifier, adapters.executionTicketVerifier);
});

test("composition root wires the contract without auto-discovering credentials or providers", () => {
  assert.match(serverSource, /createRecoveryComposition\(\{[\s\S]*source: "server_composition_root"/u);
  assert.match(serverSource, /\.\.\.recoveryCompositionDependencies/u);
  assert.match(serverSource, /const runtimeBootstrapReader = \(options = \{\}\) => runBootstrap/u);
  assert.match(routesSource, /executionTicketSigner/u);
  assert.match(routesSource, /executionTicketSigner,[\s\S]*hostBreakglassMutationExecutor,[\s\S]*productionActivationReadinessExecutor/u);
  assert.doesNotMatch(serverSource, /RECOVERY_COMPOSITION_LIVE_ENABLED/u);
  assert.doesNotMatch(serverSource, /RUNTIME_BREAKGLASS_GITHUB_TOKEN/u);
});

console.log("recovery composition contract tests passed");
