import {
  createServerManagedRecoveryAuthorityBinding,
  createServerManagedRecoveryBindingEnvelope,
} from "./serverManagedRecoveryAuthorityBinding.js";
import { createProductionRecoveryComposition } from "./productionRecoveryCompositionFactory.js";
import { PRODUCTION_RECOVERY_AUTHORITY_FOUNDATION_CONTRACT } from "./productionRecoveryAuthorityFoundation.js";

export const PRODUCTION_RECOVERY_OPERATIONAL_ADAPTERS_CONTRACT =
  "mad4b.production-recovery-operational-adapters.v1";

const sha40 = /^[0-9a-f]{40}$/u;
const sha256 = /^[0-9a-f]{64}$/u;
const deniedInputKeys = new Set([
  "repository",
  "repo",
  "workflow",
  "workflow_id",
  "ref",
  "branch",
  "host",
  "hostname",
  "port",
  "path",
  "cwd",
  "command",
  "shell",
  "ssh",
  "credentials",
  "credential",
  "password",
  "private_key",
  "token",
  "github_token",
  "provider_token",
]);

const executionKeys = Object.freeze([
  "plan_id",
  "plan_hash",
  "step_id",
  "step_hash",
  "capability_key",
  "operation",
  "authority_ref",
  "expected_sha",
  "target_key",
  "target_fingerprint",
  "target_role",
  "idempotency_key",
  "execution_ticket_id",
  "execution_ticket_hash",
  "lease_id",
  "fencing_token",
  "role_selection_proof_hash",
  "deployment_attestation_hash",
  "role_bundle_binding",
  "grant_binding_hash",
]);

function bounded(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function operationalError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = {
    contract: PRODUCTION_RECOVERY_OPERATIONAL_ADAPTERS_CONTRACT,
    production_live_enabled: false,
    activation_eligible: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    provider_accessed: false,
    workflow_dispatch_performed: false,
    secrets_included: false,
    ...details,
  };
  throw error;
}

function requireFn(value, label) {
  if (typeof value !== "function") {
    operationalError(
      "RECOVERY_PRODUCTION_OPERATIONAL_AUTHORITY_MISSING",
      `Deployment-owned authority is missing: ${label}.`,
      { authority: label },
    );
  }
  return value;
}

function assertFoundation(core) {
  if (!core || core.contract !== PRODUCTION_RECOVERY_AUTHORITY_FOUNDATION_CONTRACT) {
    operationalError(
      "RECOVERY_PRODUCTION_FOUNDATION_INVALID",
      "Operational Recovery adapters require the canonical Production authority foundation.",
    );
  }
  if (core.production_live_enabled !== false || core.activation_eligible !== false) {
    operationalError(
      "RECOVERY_PRODUCTION_FOUNDATION_LIVE_STATE_FORBIDDEN",
      "Operational Recovery composition cannot consume an already-live foundation.",
    );
  }
  const needed = [
    "deploymentIdentityProvider",
    "recoveryStore",
    "approvalIssuer",
    "approvalVerifier",
    "approvalStore",
    "recoveryLock",
    "executionTicketSigner",
    "executionTicketVerifier",
  ];
  const missing = needed.filter((key) => !core[key]);
  if (missing.length) {
    operationalError(
      "RECOVERY_PRODUCTION_FOUNDATION_INCOMPLETE",
      "Operational Recovery adapters require every foundation authority.",
      { missing_components: missing },
    );
  }
  if (core.recoveryStore.executionTicketVerifier !== core.executionTicketVerifier) {
    operationalError(
      "RECOVERY_PRODUCTION_TICKET_VERIFIER_IDENTITY_MISMATCH",
      "Recovery Store must retain the exact execution-ticket verifier from the foundation.",
    );
  }
  return core;
}

function assertNoRoutingOverride(input = {}) {
  const found = Object.keys(input || {}).filter((key) => deniedInputKeys.has(String(key).toLowerCase()));
  if (found.length) {
    operationalError(
      "RECOVERY_PRODUCTION_CALLER_ROUTING_OVERRIDE_FORBIDDEN",
      "Production Recovery execution routing is deployment-owned and cannot be selected by the caller.",
      { forbidden_fields: found.sort() },
    );
  }
}

function normalizeExecution(input = {}) {
  assertNoRoutingOverride(input);
  const out = Object.fromEntries(executionKeys
    .filter((key) => input[key] !== undefined && input[key] !== null)
    .map((key) => [key, typeof input[key] === "string" ? bounded(input[key], 4096) : input[key]]));

  if (!sha40.test(bounded(out.expected_sha, 40).toLowerCase())) {
    operationalError("RECOVERY_PRODUCTION_EXPECTED_SHA_INVALID", "Operational execution requires an exact 40-character deployment SHA.");
  }
  if (!sha256.test(bounded(out.plan_hash, 64).toLowerCase())
    || !sha256.test(bounded(out.step_hash, 64).toLowerCase())
    || !sha256.test(bounded(out.target_fingerprint, 64).toLowerCase())
    || !sha256.test(bounded(out.execution_ticket_hash, 64).toLowerCase())) {
    operationalError("RECOVERY_PRODUCTION_EXECUTION_BINDING_INVALID", "Operational execution is missing a canonical SHA-256 binding.");
  }
  for (const key of ["plan_id", "step_id", "capability_key", "operation", "target_key", "target_role", "idempotency_key", "execution_ticket_id", "lease_id", "fencing_token"]) {
    if (!bounded(out[key], 4096)) {
      operationalError("RECOVERY_PRODUCTION_EXECUTION_BINDING_INVALID", "Operational execution is missing an immutable Recovery binding.", { field: key });
    }
  }
  return Object.freeze({ ...out, secrets_included: false });
}

function validateExecutionReceipt(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    operationalError("RECOVERY_PRODUCTION_EXECUTION_RECEIPT_INVALID", "Deployment-owned execution did not return a structured receipt.");
  }
  if (result.secrets_included === true) {
    operationalError("RECOVERY_PRODUCTION_EXECUTION_RECEIPT_SECRET_FORBIDDEN", "Execution receipts must not contain secrets.");
  }
  return Object.freeze({
    ...result,
    execution_ticket_returned: false,
    caller_routing_override_used: false,
    secrets_included: false,
  });
}

export function createProductionRecoveryOperationalAdapters({
  foundation,
  executeDeploymentOwnedMutation,
  verifyIndependentReadback,
  persistImmutablePartialReceipt,
  resolveDurableInspectionProof,
  finalizeGovernanceMigrationLedger,
} = {}) {
  const core = assertFoundation(foundation);
  const executeOwned = requireFn(executeDeploymentOwnedMutation, "executeDeploymentOwnedMutation");
  const verifyReadback = requireFn(verifyIndependentReadback, "verifyIndependentReadback");
  const persistReceipt = requireFn(persistImmutablePartialReceipt, "persistImmutablePartialReceipt");
  const resolveProof = requireFn(resolveDurableInspectionProof, "resolveDurableInspectionProof");
  const finalizeLedger = requireFn(finalizeGovernanceMigrationLedger, "finalizeGovernanceMigrationLedger");

  const hostLocalMutationExecutor = async (input = {}) => {
    const request = normalizeExecution(input);
    const result = await executeOwned(request);
    return validateExecutionReceipt(result);
  };

  const mutationExecutor = Object.freeze({
    contract: "mad4b.production-recovery-deployment-owned-mutation-executor.v1",
    execute: hostLocalMutationExecutor,
  });

  const readbackVerifier = Object.freeze({
    contract: "mad4b.production-recovery-independent-readback.v1",
    independent_authority: true,
    role_aware: true,
    mutation_authority: false,
    async verify(input = {}) {
      assertNoRoutingOverride(input);
      const targetRole = bounded(input.target_role || input.step?.target_role, 64);
      const expectedSha = bounded(input.plan?.expected_sha || input.expected_sha, 40).toLowerCase();
      if (!targetRole || !sha40.test(expectedSha)) {
        operationalError("RECOVERY_PRODUCTION_READBACK_BINDING_INVALID", "Independent readback requires the exact target role and deployment SHA.");
      }
      const result = await verifyReadback(Object.freeze({
        plan: input.plan || null,
        step: input.step || null,
        run: input.run || null,
        target_role: targetRole,
        expected_sha: expectedSha,
        fencing_token: bounded(input.fencing_token, 1024) || null,
        same_cycle: input.same_cycle !== false,
        reconciliation: input.reconciliation === true,
        mutation_authority: false,
        secrets_included: false,
      }));
      const ok = result?.ok === true || result?.verified === true;
      if (!ok || result?.secrets_included === true) {
        operationalError("RECOVERY_PRODUCTION_READBACK_FAILED", "Independent role-aware readback did not prove the requested postcondition.");
      }
      return Object.freeze({
        ...result,
        ok: true,
        verified: true,
        independent_authority: true,
        role_aware: true,
        mutation_authority: false,
        secrets_included: false,
      });
    },
  });

  const partialReceiptStore = Object.freeze({
    contract: "mad4b.production-recovery-partial-receipt-store.v1",
    independent_of_target_databases: true,
    async putImmutablePartialRebuildReceipt(receipt = {}) {
      assertNoRoutingOverride(receipt);
      const result = await persistReceipt(Object.freeze({ ...receipt, automatic_rerun_allowed: false, reconciliation_required: true, secrets_included: false }));
      if (result?.persisted !== true || result?.durable !== true || result?.secrets_included === true) {
        operationalError("RECOVERY_PRODUCTION_PARTIAL_RECEIPT_NOT_DURABLE", "Partial mutation receipt was not durably persisted.");
      }
      return Object.freeze({ ...result, persisted: true, durable: true, automatic_rerun_allowed: false, reconciliation_required: true, secrets_included: false });
    },
  });

  const proofResolver = async (input = {}) => {
    assertNoRoutingOverride(input);
    const result = await resolveProof(Object.freeze({ ...input, mutation_authority: false, secrets_included: false }));
    if (!result || result.server_derived !== true || result.durable !== true || !Array.isArray(result.selected_roles) || result.selected_roles.length === 0 || result.secrets_included === true) {
      operationalError("RECOVERY_PRODUCTION_DURABLE_PROOF_INVALID", "Durable full-inspection proof is unavailable or not server-derived.");
    }
    return Object.freeze({ ...result, server_derived: true, durable: true, mutation_authority: false, secrets_included: false });
  };

  const migrationLedger = Object.freeze({
    contract: "mad4b.governance-migration-ledger.v1",
    independent_authority: true,
    async finalize(input = {}) {
      assertNoRoutingOverride(input);
      const result = await finalizeLedger(Object.freeze({ ...input, secrets_included: false }));
      if (result?.finalized !== true || result?.durable !== true || result?.secrets_included === true) {
        operationalError("RECOVERY_PRODUCTION_MIGRATION_LEDGER_FINALIZE_FAILED", "Governance Migration Ledger did not durably finalize.");
      }
      return Object.freeze({ ...result, finalized: true, durable: true, secrets_included: false });
    },
  });

  return Object.freeze({
    deploymentIdentityProvider: core.deploymentIdentityProvider,
    recoveryStore: core.recoveryStore,
    approvalIssuer: core.approvalIssuer,
    approvalVerifier: core.approvalVerifier,
    approvalStore: core.approvalStore,
    recoveryLock: core.recoveryLock,
    mutationExecutor,
    hostLocalMutationExecutor,
    readbackVerifier,
    executionTicketSigner: core.executionTicketSigner,
    executionTicketVerifier: core.executionTicketVerifier,
    partialReceiptStore,
    proofResolver,
    migrationLedger,
  });
}

export function createProductionRecoveryOperationalComposition(options = {}) {
  const adapters = createProductionRecoveryOperationalAdapters(options);
  const binding = createServerManagedRecoveryAuthorityBinding({
    adapters,
    adapterOrigin: "server_managed_concrete",
    capabilities: {
      adapter_present: true,
      durability_capable: true,
      attestation_capable: true,
    },
    authorityHandles: { deployment_owned: true, operational_only: true },
  });
  const envelope = createServerManagedRecoveryBindingEnvelope({
    binding,
    readiness: {
      adapter_present: true,
      durability_capable: true,
      attestation_capable: true,
    },
    source: "production_recovery_operational_authority",
  });
  const composition = createProductionRecoveryComposition({
    mode: "injected_non_live",
    serverManagedBindingProvider: () => envelope,
    source: "production_recovery_operational_authority",
  });
  if (composition.configured !== true || composition.live_activation === true || composition.mutation_authority_available !== true) {
    operationalError("RECOVERY_PRODUCTION_OPERATIONAL_COMPOSITION_INVALID", "Operational composition did not resolve to the expected non-live complete graph.");
  }
  return Object.freeze({
    ...composition,
    operational_authority: Object.freeze({
      contract: PRODUCTION_RECOVERY_OPERATIONAL_ADAPTERS_CONTRACT,
      complete_adapter_graph: true,
      production_live_enabled: false,
      activation_eligible: false,
      deployment_binding_configured: false,
      live_certification_present: false,
      database_connection_performed: false,
      database_mutation_performed: false,
      provider_accessed: false,
      workflow_dispatch_performed: false,
      secrets_included: false,
    }),
  });
}

export const _testingProductionRecoveryOperationalAdapters = Object.freeze({
  executionKeys,
  deniedInputKeys,
  normalizeExecution,
  assertNoRoutingOverride,
});
