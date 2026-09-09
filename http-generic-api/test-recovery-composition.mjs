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
const systemLayerSource = readFileSync(new URL("./routes/systemLayerRoutes.js", import.meta.url), "utf8");
const breakglassBrokerSource = readFileSync(new URL("./runtimeBreakglassBroker.js", import.meta.url), "utf8");
const adminRecoveryConnection = JSON.parse(
  readFileSync(new URL("./config/admin-recovery-chatgpt-connection.json", import.meta.url), "utf8"),
);
const customGptSurfaces = readFileSync(
  new URL("../canonicals/openapi/custom-gpt-surfaces.yaml", import.meta.url),
  "utf8",
);

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
    deploymentIdentityProvider: { readAttestation: asyncMethod({ read_only_probe: true, manifest_bound: true, database_mutation_performed: false, provider_mutation_performed: false, secrets_included: false }) },
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
    migrationLedger: { contract: "mad4b.governance-migration-ledger.v1", finalize: asyncMethod({ finalized: true }) },
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
  assert.equal(composition.components.deploymentIdentityProvider, null);
  assert.equal(composition.components.recoveryStore, null);
  assert.equal(composition.hostBreakglassBroker.hostLocalMutationExecutor, null);
  assert.equal(getRecoveryCompositionRouteDependencies(composition).hostBreakglassMutationExecutor, null);
  assert.equal(composition.runtimeBootstrapDependencies.deploymentIdentityProvider, null);
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

test("production_live composition is registered but permanently disabled", () => {
  assert.throws(
    () => createRecoveryComposition({ mode: "production_live", adapters: makeCompleteAdapters(), source: "test_production_live" }),
    (error) => error.code === "RECOVERY_PRODUCTION_LIVE_DISABLED" && error.status === 503,
  );
});

test("complete injected graph remains non-live and is exposed through three bounded route dependency groups", () => {
  const adapters = makeCompleteAdapters();
  const composition = createRecoveryComposition({ mode: "injected_non_live", adapters, source: "test_injected" });
  const routeDeps = getRecoveryCompositionRouteDependencies(composition);
  assert.equal(composition.configured, true);
  assert.equal(composition.mode, "injected_non_live");
  assert.equal(composition.live_activation, false);
  assert.equal(composition.mutation_authority_available, true);
  assert.equal(composition.authority_inventory.all_required_components_configured, true);
  assert.equal(routeDeps.deploymentIdentityProvider, adapters.deploymentIdentityProvider);
  assert.equal(routeDeps.recoveryStore, adapters.recoveryStore);
  assert.equal(routeDeps.approvalVerifier, adapters.approvalVerifier);
  assert.equal(routeDeps.recoveryLock, adapters.recoveryLock);
  assert.equal(routeDeps.mutationExecutor, adapters.mutationExecutor);
  assert.equal(routeDeps.readbackVerifier, adapters.readbackVerifier);
  assert.equal(routeDeps.executionTicketSigner, adapters.executionTicketSigner);
  assert.equal(routeDeps.executionTicketVerifier, adapters.executionTicketVerifier);
  assert.equal(routeDeps.migrationLedger, adapters.migrationLedger);
  assert.equal(routeDeps.broker.hostLocalMutationExecutor, adapters.hostLocalMutationExecutor);
  assert.equal(routeDeps.hostBreakglassMutationExecutor, adapters.hostLocalMutationExecutor);
  assert.equal(routeDeps.runtimeBootstrapDependencies.deploymentIdentityProvider, adapters.deploymentIdentityProvider);
  assert.equal(routeDeps.runtimeBootstrapDependencies.partialReceiptStore, adapters.partialReceiptStore);
  assert.equal(routeDeps.runtimeBootstrapDependencies.executionTicketVerifier, adapters.executionTicketVerifier);
});

test("composition root wires the contract without auto-discovering credentials or providers", () => {
  assert.match(serverSource, /createProductionRecoveryComposition\(\{[\s\S]*source: "server_composition_root"/u);
  assert.match(serverSource, /getServerManagedRecoveryBindingMode/u);
  assert.match(serverSource, /createServerManagedRecoveryBindingProvider/u);
  assert.match(serverSource, /serverManagedBindingProvider: recoveryBindingProvider/u);
  assert.match(serverSource, /\.\.\.recoveryCompositionDependencies/u);
  assert.match(serverSource, /const runtimeBootstrapReader = \(options = \{\}\) => runBootstrap/u);
  assert.match(routesSource, /executionTicketSigner/u);
  assert.match(routesSource, /executionTicketSigner,[\s\S]*hostBreakglassMutationExecutor,[\s\S]*productionActivationReadinessExecutor/u);
  assert.doesNotMatch(serverSource, /RECOVERY_COMPOSITION_LIVE_ENABLED/u);
  assert.doesNotMatch(serverSource, /RUNTIME_BREAKGLASS_GITHUB_TOKEN/u);
});

test("Admin Recovery connection is pinned to the existing embedded Staging Recovery projection", () => {
  assert.equal(adminRecoveryConnection.contract, "mad4b.admin-recovery-chatgpt-connection.v1");
  assert.equal(adminRecoveryConnection.environment, "staging");
  assert.equal(adminRecoveryConnection.server_uri, "https://activation-dev.mad4b.com");
  assert.equal(adminRecoveryConnection.upstream_origin, "https://dev.mad4b.com");
  assert.equal(adminRecoveryConnection.principal_class, "admin_gpt");
  assert.equal(adminRecoveryConnection.projection.surface_key, "admin_recovery_staging");
  assert.equal(adminRecoveryConnection.projection.registration_set, "admin_activation_staging");
  assert.equal(adminRecoveryConnection.projection.action_slot, "admin_activation");
  assert.equal(adminRecoveryConnection.projection.registration_status, "embedded");
  assert.equal(adminRecoveryConnection.projection.embed_into, "activation_admin_staging");
  assert.equal(adminRecoveryConnection.projection.private_only, true);
  assert.equal(adminRecoveryConnection.projection.shared_admin_core_member, false);
  assert.deepEqual(adminRecoveryConnection.allowed_operations, [
    "getStagingRecoveryAdminContract",
    "getStagingRecoveryAdminReadiness",
    "getStagingRecoveryCertificationStatus",
  ]);
  assert.match(customGptSurfaces, /admin_activation_staging:/);
  assert.match(customGptSurfaces, /admin_recovery_staging/);
  assert.match(customGptSurfaces, /server_uri:\s*https:\/\/activation-dev\.mad4b\.com/);
  assert.match(customGptSurfaces, /upstream_origin:\s*https:\/\/dev\.mad4b\.com/);
});

test("Admin Recovery Staging Gateway convergence exposes read/preflight only", () => {
  const gateway = adminRecoveryConnection.gateway_convergence;
  assert.equal(gateway.trusted_ingress, "https://activation-dev.mad4b.com");
  assert.equal(gateway.upstream_origin, "https://dev.mad4b.com");
  assert.equal(gateway.direct_upstream_registration_allowed, false);
  assert.equal(gateway.consequential_apply_exposed, false);
  assert.equal(gateway.apply_authority, "certified_server_side_workflow_only");
  assert.deepEqual(gateway.safe_read_or_preflight_operations, [
    "activation_gateway_rollout_plan",
    "activation_gateway_dark_deploy_dry_run",
    "gateway_exact_sha_verification",
    "gateway_same_cycle_readback",
  ]);
});

test("Admin Recovery connection never exposes generic GitHub dispatch, shell, SQL, tickets, or credentials", () => {
  const boundary = adminRecoveryConnection.execution_boundary;
  assert.equal(boundary.generic_workflow_dispatch_exposed, false);
  assert.equal(boundary.generic_shell_exposed, false);
  assert.equal(boundary.caller_supplied_execution_ticket_allowed, false);
  assert.equal(boundary.caller_supplied_repository_allowed, false);
  assert.equal(boundary.caller_supplied_workflow_allowed, false);
  assert.equal(boundary.caller_supplied_ref_allowed, false);
  assert.equal(boundary.caller_supplied_github_token_allowed, false);
  assert.equal(boundary.caller_supplied_database_identifier_allowed, false);
  assert.equal(boundary.caller_supplied_database_credentials_allowed, false);
  assert.equal(boundary.caller_supplied_sql_allowed, false);
  assert.equal(boundary.caller_supplied_capability_envelope_id_allowed, false);
  assert.equal(boundary.caller_supplied_resource_binding_id_allowed, false);
  assert.equal(boundary.generic_cloudflare_operations_exposed, false);
  assert.equal(boundary.dns_mutation_exposed, false);
  assert.equal(boundary.custom_domain_mutation_exposed, false);
  assert.equal(boundary.production_target_allowed, false);
  assert.equal(boundary.cross_environment_fallback_allowed, false);
});

test("runtime Breakglass broker keeps repo workflow ref and credential fields server-controlled", () => {
  for (const forbidden of [
    "github_token",
    "repository",
    "workflow",
    "workflow_file",
    "ref",
    "dispatch_ref",
    "database",
    "db_user",
    "db_password",
    "credential",
  ]) {
    assert.match(breakglassBrokerSource, new RegExp(`\\"${forbidden}\\"`));
  }
  assert.match(breakglassBrokerSource, /runtime_breakglass_production_sha_mismatch/);
  assert.match(breakglassBrokerSource, /actions\/workflows\/\$\{encodeURIComponent\(canonicalWorkflow\(\)\.file\)\}\/dispatches/);
});

console.log("recovery composition contract tests passed");
