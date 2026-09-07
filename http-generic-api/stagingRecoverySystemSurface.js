import { createStagingCertificationCanaryPlan } from "./recoveryKernel.js";
import { createStagingAccessRepairTicketAuthority } from "./stagingAccessRepairTicketAuthority.js";
import { stagingRecoveryAuthorityInternals } from "./stagingRecoveryAuthorityBinding.js";

export const STAGING_RECOVERY_SYSTEM_SURFACE_CONTRACT = "mad4b.staging-recovery-system-surface.v1";

const SHA40 = "^[0-9a-fA-F]{40}$";
const SHA256 = "^[0-9a-fA-F]{64}$";
const PLAN_ID = "^plan:[0-9a-f]{16,64}$";
const STEP_ID = "^step:[0-9a-f]{16,64}$";

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function stagingSignals(env = process.env) {
  return [env.DEPLOYMENT_ENVIRONMENT, env.REMOTE_MCP_ENVIRONMENT, env.NODE_ENV]
    .map((value) => text(value, 96).toLowerCase())
    .filter(Boolean);
}

export function isStagingRecoverySystemEnvironment(env = process.env) {
  const values = stagingSignals(env);
  if (values.some((value) => ["production", "prod", "production_hostinger_autodeploy"].includes(value))) return false;
  return values.some((value) => ["staging", "stage", "staging_local_windows_docker"].includes(value));
}

function resolveStagingAuthorityGraph(env = process.env) {
  stagingRecoveryAuthorityInternals.runtime({
    environment: "staging",
    runtime_class: "local_windows_docker",
    requested_mode: "injected_non_live",
    production_live: false,
  }, env);
  const roots = stagingRecoveryAuthorityInternals.roots(env);
  return stagingRecoveryAuthorityInternals.adapters(roots.readiness, env).adapters;
}

function statefulEnvelope(result, action) {
  return {
    ...result,
    system_surface_contract: STAGING_RECOVERY_SYSTEM_SURFACE_CONTRACT,
    system_surface_action: action,
    environment: "staging",
    environment_scope: "staging_only",
    surface_semantics: "staging_governed_control_plane",
    control_plane_state_write_performed: true,
    production_authority: false,
    production_mutation_performed: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    dns_mutation_performed: false,
    secrets_included: false,
  };
}

export const STAGING_RECOVERY_SYSTEM_TOOLS = Object.freeze([
  {
    name: "staging_certification_canary_plan_create",
    description: "Admin-only Staging planner for the exact-main certification canary. Creates the bounded durable Recovery plan only; it does not execute the canary, call a provider, mutate a database, deploy, or authorize Production.",
    source_key: "staging_recovery_system_surface_v1",
    capability_key: "staging.certification.canary.plan_create",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "planning", "control_plane_write", "no_provider_dispatch"],
    environments: ["staging"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["expected_sha"],
      properties: {
        expected_sha: { type: "string", pattern: SHA40 },
      },
    },
  },
  {
    name: "staging_recovery_access_repair_prepare",
    description: "Admin-only Staging access-repair preparation. Resolves the Staging target fingerprint server-side and creates the bounded durable approval plan without accepting SQL, commands, database identifiers, provider controls, or Production targets.",
    source_key: "staging_recovery_system_surface_v1",
    capability_key: "staging_database_access_repair.prepare",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "approval", "control_plane_write", "no_raw_sql"],
    environments: ["staging"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["expected_sha", "grant_binding_hash", "idempotency_key"],
      properties: {
        expected_sha: { type: "string", pattern: SHA40 },
        grant_binding_hash: { type: "string", pattern: SHA256 },
        idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
      },
    },
  },
  {
    name: "staging_recovery_access_repair_approve",
    description: "Admin-only Staging access-repair approval finalizer. Accepts only immutable plan/step references, idempotency, and the exact typed confirmation produced by prepare; the execution ticket remains server-issued and hidden.",
    source_key: "staging_recovery_system_surface_v1",
    capability_key: "staging_database_access_repair.approve",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "approval", "ticket_issue", "control_plane_write"],
    environments: ["staging"],
    requires_admin: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["plan_id", "plan_hash", "step_id", "idempotency_key", "approval_confirmation"],
      properties: {
        plan_id: { type: "string", pattern: PLAN_ID },
        plan_hash: { type: "string", pattern: SHA256 },
        step_id: { type: "string", pattern: STEP_ID },
        idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
        approval_confirmation: { type: "string", minLength: 24, maxLength: 512 },
      },
    },
  },
  {
    name: "staging_recovery_surface_readiness_smoke",
    description: "No-secret readiness contract for the Staging Recovery System Surface. Outside Staging it proves the surface is environment-scoped and must remain hidden; it never creates plans, approvals, tickets, or mutations.",
    source_key: "staging_recovery_system_surface_v1",
    capability_key: "staging_recovery_system_surface.readiness",
    catalog_level: "private_recovery",
    tags: ["recovery", "staging", "readiness", "read_only"],
    environments: ["staging"],
    requires_admin: true,
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
]);

export async function stagingCertificationCanaryPlanCreate(args = {}) {
  const env = process.env;
  const graph = resolveStagingAuthorityGraph(env);
  const plan = await createStagingCertificationCanaryPlan({ expected_sha: args.expected_sha }, {
    env,
    recoveryStore: graph.recoveryStore,
    deploymentIdentityProvider: graph.deploymentIdentityProvider,
  });
  return statefulEnvelope(plan, "certification_canary_plan_create");
}

export async function stagingRecoveryAccessRepairPrepare(args = {}) {
  const env = process.env;
  const graph = resolveStagingAuthorityGraph(env);
  const attestation = await graph.deploymentIdentityProvider.readAttestation();
  const authority = createStagingAccessRepairTicketAuthority({ env });
  const result = await authority.prepare({
    expected_sha: args.expected_sha,
    target_key: "staging-runtime",
    target_fingerprint: attestation.target_fingerprint,
    grant_binding_hash: args.grant_binding_hash,
    idempotency_key: args.idempotency_key,
  });
  return statefulEnvelope(result, "access_repair_prepare");
}

export async function stagingRecoveryAccessRepairApprove(args = {}) {
  const env = process.env;
  resolveStagingAuthorityGraph(env);
  const authority = createStagingAccessRepairTicketAuthority({ env });
  const result = await authority.approveAndIssue({
    plan_id: args.plan_id,
    plan_hash: args.plan_hash,
    step_id: args.step_id,
    idempotency_key: args.idempotency_key,
    approval_confirmation: args.approval_confirmation,
  });
  return statefulEnvelope(result, "access_repair_approve");
}

export async function stagingRecoverySurfaceReadinessSmoke() {
  const staging = isStagingRecoverySystemEnvironment(process.env);
  return {
    ok: true,
    tool: "staging_recovery_surface_readiness_smoke",
    status: "pass",
    classification: staging ? "staging_recovery_surface_environment_active" : "staging_recovery_surface_environment_scoped_hidden",
    environment_scope: "staging_only",
    environment_active: staging,
    descriptor_count: STAGING_RECOVERY_SYSTEM_TOOLS.length,
    control_plane_state_write_performed: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    production_mutation_performed: false,
    secrets_included: false,
  };
}
