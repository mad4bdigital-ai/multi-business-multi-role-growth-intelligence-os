import {
  createProductionRecoveryAuthorityFoundation,
} from "./productionRecoveryAuthorityFoundation.js";
import {
  createProductionRecoveryControlStore,
} from "./productionRecoveryControlStore.js";
import {
  createProductionRecoveryDurableEvidenceAdapters,
} from "./productionRecoveryDurableEvidenceAdapters.js";
import {
  createProductionRecoveryOperationalAdapters,
} from "./productionRecoveryOperationalAdapters.js";
import {
  createServerManagedRecoveryAuthorityBinding,
  createServerManagedRecoveryBindingEnvelope,
} from "./serverManagedRecoveryAuthorityBinding.js";
import {
  PRODUCTION_RECOVERY_LIVE_AUTHORIZATION_CONTRACT,
} from "./productionRecoveryCompositionFactory.js";
import {
  readRuntimeAttestation,
  RECOVERY_BRANCH,
  RECOVERY_REPOSITORY,
} from "./recoveryTrustModel.js";
import { readDeploymentManifest } from "./deploymentManifest.js";
import { runBootstrap } from "./runtimeBootstrapContract.js";
import { verifyExecutionTicket } from "./recoveryExecutionTicket.js";

export const PRODUCTION_RECOVERY_AUTHORITY_BINDING_CONTRACT =
  "mad4b.production-recovery-authority-binding.v1";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ROLES = new Set(["runtime", "governance", "runtime_persistence"]);

function text(value, max = 4096) {
  return String(value ?? "").trim().slice(0, max);
}

function fail(code, message, details = {}, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = {
    contract: PRODUCTION_RECOVERY_AUTHORITY_BINDING_CONTRACT,
    database_connection_performed: false,
    database_mutation_performed: false,
    provider_accessed: false,
    workflow_dispatch_performed: false,
    secrets_included: false,
    ...details,
  };
  throw error;
}

function requireSecret(env, key) {
  const value = text(env[key], 20000);
  if (!value) fail("RECOVERY_PRODUCTION_AUTHORITY_CONFIG_MISSING", "Production Recovery authority configuration is incomplete.", { missing_key: key });
  return value;
}

function productionSha(env = process.env) {
  const result = readDeploymentManifest(env);
  const manifest = result?.ok ? result.manifest : null;
  const sha = text(manifest?.commit_sha, 64).toLowerCase();
  if (!manifest || manifest.repository !== RECOVERY_REPOSITORY || manifest.branch !== RECOVERY_BRANCH || !SHA40.test(sha) || manifest.secrets_included !== false) {
    fail("RECOVERY_PRODUCTION_DEPLOYMENT_MANIFEST_INVALID", "Production Recovery authority requires the exact canonical deployment manifest.");
  }
  return sha;
}

function readServerAttestation(env = process.env) {
  const sha = productionSha(env);
  const attestation = readRuntimeAttestation({ env, expectedSha: sha });
  if (attestation.parity !== true || attestation.manifest_bound !== true) {
    fail("RECOVERY_PRODUCTION_DEPLOYMENT_ATTESTATION_INVALID", "Production Recovery deployment attestation is not exact-SHA and manifest bound.");
  }
  return Object.freeze({
    ...attestation,
    environment: "production",
    sha,
    deployment_sha: sha,
    repository_sha: sha,
    secrets_included: false,
  });
}

function ticketBootstrapVerifier({ recoveryStore, executionTicketVerifier }) {
  return Object.freeze({
    contract: "mad4b.production-recovery-bootstrap-ticket-verifier.v1",
    async verifyForBootstrap({ ticket_id, ticket_hash, expected = {} } = {}) {
      const ticketId = text(ticket_id, 180);
      const ticketHash = text(ticket_hash, 128).toLowerCase();
      if (!ticketId || !SHA256.test(ticketHash)) return { valid: false, secrets_included: false };
      const ticket = await recoveryStore.getExecutionTicket(ticketId);
      if (!ticket || text(ticket.ticket_hash, 128).toLowerCase() !== ticketHash) return { valid: false, secrets_included: false };
      let verified;
      try {
        verified = await verifyExecutionTicket(ticket, { verifier: executionTicketVerifier });
      } catch {
        return { valid: false, secrets_included: false };
      }
      const payload = verified.payload || {};
      const expectedComposite = text(expected.target_fingerprint, 128).toLowerCase();
      const valid = payload.production_sha === expected.production_sha
        && payload.target_key === expected.target_key
        && payload.operation === expected.operation
        && text(payload.role_selection_hash, 128).toLowerCase() === text(expected.role_selection_hash, 128).toLowerCase()
        && (!expected.grant_binding_hash || payload.grant_binding_hash === expected.grant_binding_hash)
        && (!expectedComposite || text(payload.target_fingerprints?.composite, 128).toLowerCase() === expectedComposite);
      return { valid, ticket_id: ticketId, ticket_hash: ticketHash, secrets_included: false };
    },
  });
}

function assertBaselineExecution(input = {}) {
  const role = text(input.target_role, 64);
  const proof = input.role_selection_proof;
  const bundle = input.role_bundle_binding;
  if (!ROLES.has(role)
    || input.capability_key !== `${role}.baseline.rebuild_empty`
    || input.operation !== "database.rebuild_empty"
    || input.target_key !== "production-runtime"
    || !SHA40.test(text(input.expected_sha, 64).toLowerCase())
    || !SHA256.test(text(input.plan_hash, 128).toLowerCase())
    || !SHA256.test(text(input.step_hash, 128).toLowerCase())
    || !proof
    || proof.source !== "durable_full_inspection"
    || proof.expected_sha !== input.expected_sha
    || JSON.stringify(proof.selected_roles) !== JSON.stringify([role])
    || !SHA256.test(text(proof.selection_hash, 128).toLowerCase())
    || !SHA256.test(text(proof.role_object_count_fingerprints?.[role], 128).toLowerCase())
    || !bundle
    || bundle.role !== role
    || !SHA256.test(text(bundle.binding_hash, 128).toLowerCase())) {
    fail("RECOVERY_PRODUCTION_BASELINE_EXECUTION_DENIED", "Production Recovery live binding permits only one exact approved baseline-rebuild role step.", { target_role: role || null }, 403);
  }
  return { role, proof, bundle };
}

function bootstrapEnvForExecution(input, env = process.env) {
  const { role, proof, bundle } = assertBaselineExecution(input);
  return {
    ...env,
    BOOTSTRAP_MODE: "apply_migration",
    BOOTSTRAP_TARGET_SOURCE: "host_local_role_env",
    BOOTSTRAP_EXPECTED_SHA: input.expected_sha,
    BOOTSTRAP_EXPECTED_BRANCH: RECOVERY_BRANCH,
    BOOTSTRAP_EXPECTED_REPOSITORY: RECOVERY_REPOSITORY,
    BOOTSTRAP_TARGET_KEY: "production-runtime",
    HOST_BREAKGLASS_OPERATION: "database.rebuild_empty",
    HOST_BREAKGLASS_ENVIRONMENT_KEY: "production_hostinger_autodeploy",
    HOST_BREAKGLASS_HOST_LOCAL_ROLE_CREDENTIALS: "true",
    BOOTSTRAP_HOST_LOCAL_ROLE_IDENTITY: "true",
    BOOTSTRAP_ROLE_SELECTION: role,
    HOST_BREAKGLASS_TARGET_ROLES: role,
    BOOTSTRAP_INSPECTION_RUN_ID: proof.inspection_run_id,
    BOOTSTRAP_PLAN_SHA256: input.plan_hash,
    BOOTSTRAP_ROLE_SELECTION_HASH: proof.selection_hash,
    BOOTSTRAP_ROLE_OBJECT_COUNT_FINGERPRINTS: JSON.stringify(proof),
    BOOTSTRAP_ROLE_BUNDLE_BINDINGS_JSON: JSON.stringify(input.role_bundle_bindings || { [role]: bundle }),
    BOOTSTRAP_EXECUTION_TICKET_ID: input.execution_ticket_id,
    BOOTSTRAP_EXECUTION_TICKET_HASH: input.execution_ticket_hash,
    BOOTSTRAP_REBUILD_CONFIRMATION: `APPLY_HOSTINGER_RUNTIME_BASELINE_REBUILD:${input.expected_sha}:production-runtime:${role}`,
  };
}

function readbackEnv(expectedSha, env = process.env) {
  return {
    ...env,
    BOOTSTRAP_MODE: "dry_run",
    BOOTSTRAP_TARGET_SOURCE: "host_local_role_env",
    BOOTSTRAP_EXPECTED_SHA: expectedSha,
    BOOTSTRAP_EXPECTED_BRANCH: RECOVERY_BRANCH,
    BOOTSTRAP_EXPECTED_REPOSITORY: RECOVERY_REPOSITORY,
    BOOTSTRAP_TARGET_KEY: "production-runtime",
    HOST_BREAKGLASS_OPERATION: "database.inspect",
    HOST_BREAKGLASS_ENVIRONMENT_KEY: "production_hostinger_autodeploy",
    HOST_BREAKGLASS_HOST_LOCAL_ROLE_CREDENTIALS: "true",
    BOOTSTRAP_HOST_LOCAL_ROLE_IDENTITY: "true",
  };
}

function liveAuthorization(env, authorized) {
  return Object.freeze({
    contract: PRODUCTION_RECOVERY_LIVE_AUTHORIZATION_CONTRACT,
    authorized,
    environment: "production",
    runtime_class: "hostinger_autodeploy",
    admin_surface: "auth.mad4b.com",
    exact_sha_bound: true,
    single_use_approval: true,
    same_cycle_readback_required: true,
    server_side_approval_resolution: true,
    bootstrap_evidence_independent: true,
    baseline_rebuild_only: true,
    ordinary_migration_enabled: false,
    grants_enabled: false,
    raw_sql_enabled: false,
    shell_enabled: false,
    kill_switch_enabled: text(env.RECOVERY_MUTATIONS_ENABLED, 16).toLowerCase() === "true",
    secrets_included: false,
  });
}

export function createProductionRecoveryBindingForEnv({
  env = process.env,
  bootstrapRunner = runBootstrap,
  foundationFactory = createProductionRecoveryAuthorityFoundation,
  controlStoreFactory = createProductionRecoveryControlStore,
  durableEvidenceFactory = createProductionRecoveryDurableEvidenceAdapters,
  operationalAdaptersFactory = createProductionRecoveryOperationalAdapters,
} = {}) {
  const privateJwk = requireSecret(env, "RECOVERY_PRODUCTION_EXECUTION_PRIVATE_JWK");
  const approvalSecret = requireSecret(env, "RECOVERY_PRODUCTION_APPROVAL_HMAC_SECRET");
  const publicJwk = text(env.RECOVERY_PRODUCTION_EXECUTION_PUBLIC_JWK, 20000) || null;

  const foundation = foundationFactory({
    recoveryStoreFactory: ({ executionTicketVerifier }) => controlStoreFactory({ executionTicketVerifier, env }),
    approvalSecret,
    executionPrivateKeyJwk: privateJwk,
    executionPublicKeyJwk: publicJwk,
    readServerAttestation: async () => readServerAttestation(env),
  });

  const durable = durableEvidenceFactory({ recoveryStore: foundation.recoveryStore });
  const bootstrapTicketAuthority = ticketBootstrapVerifier({
    recoveryStore: foundation.recoveryStore,
    executionTicketVerifier: foundation.executionTicketVerifier,
  });

  const executeDeploymentOwnedMutation = async (input = {}) => {
    assertBaselineExecution(input);
    if (text(env.RECOVERY_MUTATIONS_ENABLED, 16).toLowerCase() !== "true") {
      fail("RECOVERY_MUTATIONS_DISABLED", "Production Recovery mutation kill-switch is disabled.", {}, 423);
    }
    const result = await bootstrapRunner({
      env: bootstrapEnvForExecution(input, env),
      partialReceiptStore: durable.partialReceiptStore,
      executionTicketVerifier: bootstrapTicketAuthority,
    });
    return Object.freeze({
      ...result,
      execution_transport: "production_host_local_recovery_binding",
      caller_routing_override_used: false,
      provider_accessed: false,
      workflow_dispatch_performed: false,
      secrets_included: false,
    });
  };

  const verifyIndependentReadback = async (input = {}) => {
    const expectedSha = text(input.expected_sha || input.plan?.expected_sha, 64).toLowerCase();
    const role = text(input.target_role || input.step?.target_role, 64);
    if (!SHA40.test(expectedSha) || !ROLES.has(role) || input.same_cycle !== true || !text(input.fencing_token, 1024)) {
      fail("RECOVERY_PRODUCTION_READBACK_BINDING_INVALID", "Same-cycle baseline readback requires exact SHA, role, and active Recovery fence.", {}, 409);
    }
    const result = await bootstrapRunner({ env: readbackEnv(expectedSha, env) });
    const classification = result.role_database_object_classifications?.[role] || null;
    const tableEvidence = Array.isArray(result.role_table_evidence?.[role]) ? result.role_table_evidence[role] : [];
    const requiredTablesReady = tableEvidence.length > 0 && tableEvidence.every((entry) => entry?.present === true);
    const verified = result.database_mutation_performed === false
      && result.migration_apply_performed === false
      && result.grant_mutation_performed === false
      && classification === "nonempty_objects"
      && requiredTablesReady;
    return Object.freeze({
      ok: verified,
      verified,
      contract: "mad4b.production-recovery-baseline-readback.v1",
      target_role: role,
      exact_sha: expectedSha,
      same_fence: true,
      structural_postconditions_passed: verified,
      data_postconditions_passed: true,
      postconditions_passed: verified,
      behavioral_probe_passed: verified,
      role_classification: classification,
      required_tables_ready: requiredTablesReady,
      database_connection_performed: result.database_connection_performed === true,
      database_mutation_performed: false,
      mutation_authority: false,
      secrets_included: false,
    });
  };

  const adapters = operationalAdaptersFactory({
    foundation,
    executeDeploymentOwnedMutation,
    verifyIndependentReadback,
    persistImmutablePartialReceipt: (receipt) => durable.partialReceiptStore.putImmutablePartialRebuildReceipt(receipt),
    resolveDurableInspectionProof: async (input = {}) => {
      const proof = await durable.proofResolver({
        ...input,
        operation_key: "database.rebuild_empty",
        action: "apply_migration",
      });
      return Object.freeze({ ...proof, server_derived: true, durable: true, secrets_included: false });
    },
    finalizeGovernanceMigrationLedger: async () => {
      fail("RECOVERY_PRODUCTION_ORDINARY_MIGRATION_DISABLED", "This Production Recovery binding is baseline-rebuild-only; ordinary migration ledger finalization is intentionally unavailable.", {}, 403);
    },
  });

  const binding = createServerManagedRecoveryAuthorityBinding({
    adapters,
    capabilities: { adapter_present: true, durability_capable: true, attestation_capable: true },
    authorityHandles: { deployment_owned: true, baseline_rebuild_only: true },
  });
  const baseEnvelope = createServerManagedRecoveryBindingEnvelope({
    binding,
    readiness: { adapter_present: true, durability_capable: true, attestation_capable: true },
    source: "production_recovery_baseline_only_authority",
  });
  const authorized = text(env.RECOVERY_MUTATIONS_ENABLED, 16).toLowerCase() === "true";
  return Object.freeze({
    ...baseEnvelope,
    live_authorization: liveAuthorization(env, authorized),
    contract: PRODUCTION_RECOVERY_AUTHORITY_BINDING_CONTRACT,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  });
}

export function createServerManagedRecoveryBinding(context = {}) {
  if (context?.requested_mode !== "production_live" || context?.binding_source !== "server_managed") {
    fail("RECOVERY_PRODUCTION_BINDING_MODE_DENIED", "Production Recovery authority binding resolves only for the explicit server-managed production_live composition.", {}, 403);
  }
  return createProductionRecoveryBindingForEnv({ env: process.env });
}

export default createServerManagedRecoveryBinding;

export const _testingProductionRecoveryAuthorityBinding = Object.freeze({
  productionSha,
  readServerAttestation,
  ticketBootstrapVerifier,
  assertBaselineExecution,
  bootstrapEnvForExecution,
  readbackEnv,
  liveAuthorization,
});
