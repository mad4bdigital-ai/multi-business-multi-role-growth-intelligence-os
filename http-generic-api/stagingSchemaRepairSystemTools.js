import { createHash, randomUUID } from "node:crypto";
import { createApprovalChallenge } from "./recoveryKernel.js";
import { buildApprovalBinding } from "./recoveryExecutionBinding.js";
import { issueExecutionTicket, verifyExecutionTicket } from "./recoveryExecutionTicket.js";
import { stagingRecoveryAuthorityInternals } from "./stagingRecoveryAuthorityBinding.js";
import { readStagingRuntimeBootstrapContract } from "./stagingRuntimeBootstrapContract.js";

export const STAGING_SCHEMA_REPAIR_TICKET_AUTHORITY_CONTRACT = "mad4b.staging-schema-repair-ticket-authority.v1";
export const STAGING_SCHEMA_REPAIR_CAPABILITY = "staging_database_schema_repair";
export const STAGING_SCHEMA_REPAIR_SYSTEM_SOURCE_KEY = "staging_recovery_system_surface_v1";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const PLAN_ID = /^plan:[0-9a-f]{32}$/u;
const STEP_ID = /^step:[0-9a-f]{32}$/u;
const SAFE_MIGRATION = /^[0-9][A-Za-z0-9._-]{1,190}\.sql$/u;

const text = (value, max = 512) => String(value ?? "").trim().slice(0, max);
const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

function fail(code, message, details = {}, status = 409) {
  throw Object.assign(new Error(message), { code, status, details: { ...details, secrets_included: false } });
}

function sha(value, field, pattern = SHA256) {
  const normalized = text(value, 128).toLowerCase();
  if (!pattern.test(normalized)) fail(field === "expected_sha" ? "STAGING_SHA_MISMATCH" : "RECOVERY_TICKET_BINDING_MISMATCH", `${field} is invalid.`, { field }, 400);
  return normalized;
}

function assertExactKeys(input, allowed, label) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("RECOVERY_SCHEMA_REPAIR_INPUT_INVALID", `${label} requires an object.`, {}, 400);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length) fail("RECOVERY_SCHEMA_REPAIR_FIELD_FORBIDDEN", `${label} accepts only bounded schema-repair references.`, { fields: unexpected }, 400);
}

function graphFor(env = process.env) {
  stagingRecoveryAuthorityInternals.runtime({ environment: "staging", runtime_class: "local_windows_docker", requested_mode: "injected_non_live", production_live: false }, env);
  const roots = stagingRecoveryAuthorityInternals.roots(env);
  return stagingRecoveryAuthorityInternals.adapters(roots.readiness, env).adapters;
}

function resolveMigration(migration) {
  const file = text(migration, 220);
  if (!SAFE_MIGRATION.test(file) || file.includes("..") || file.includes("/") || file.includes("\\")) {
    fail("RECOVERY_SCHEMA_REPAIR_MIGRATION_INVALID", "Schema repair requires one canonical migration filename.", { migration: file || null }, 400);
  }
  const contract = readStagingRuntimeBootstrapContract();
  const declared = Array.isArray(contract.staging_readiness_remediation?.schema_repair_migrations)
    ? contract.staging_readiness_remediation.schema_repair_migrations.find((entry) => entry?.file === file)
    : null;
  const spec = contract.migrations?.[file];
  if (!declared || !spec || !Array.isArray(spec.allowed_modes) || !spec.allowed_modes.includes("apply_migration")) {
    fail("RECOVERY_SCHEMA_REPAIR_MIGRATION_NOT_ALLOWLISTED", "Migration is not in the repository-owned Staging schema-repair allowlist.", { migration: file }, 403);
  }
  if (!SHA256.test(text(spec.sha256, 128).toLowerCase()) || !Number.isInteger(Number(spec.statement_count)) || Number(spec.statement_count) < 1) {
    fail("RECOVERY_SCHEMA_REPAIR_MIGRATION_CONTRACT_INVALID", "The repository-owned migration contract is incomplete.", { migration: file }, 500);
  }
  const role = text(spec.role, 64);
  if (!new Set(["runtime", "governance", "runtime_persistence"]).has(role)) {
    fail("RECOVERY_SCHEMA_REPAIR_MIGRATION_ROLE_INVALID", "The migration target role is not registered.", { migration: file }, 500);
  }
  const migrationBinding = {
    contract: "mad4b.staging-schema-repair-migration-binding.v1",
    file,
    sha256: text(spec.sha256, 128).toLowerCase(),
    statement_count: Number(spec.statement_count),
    role,
    requires_tables: Array.isArray(spec.requires_tables) ? [...spec.requires_tables] : [],
    postconditions: Array.isArray(contract.postconditions?.[file]) ? structuredClone(contract.postconditions[file]) : [],
    allowed_mode: "apply_migration",
    server_derived: true,
    raw_sql_allowed: false,
    caller_database_allowed: false,
    secrets_included: false,
  };
  return { contract, migration: migrationBinding, migration_binding_hash: digest(migrationBinding) };
}

async function attestExactDeployment(graph, expectedSha, targetFingerprint = null) {
  if (!graph.deploymentIdentityProvider?.readAttestation) fail("RECOVERY_DEPLOYMENT_ATTESTATION_UNAVAILABLE", "Staging deployment attestation is unavailable.", {}, 503);
  const attestation = await graph.deploymentIdentityProvider.readAttestation();
  const deploymentSha = text(attestation.sha || attestation.deployment_sha || attestation.repository_sha, 64).toLowerCase();
  const target = text(attestation.target_fingerprint, 128).toLowerCase();
  if (attestation.environment !== "staging" || attestation.branch !== "main" || deploymentSha !== expectedSha || !SHA256.test(target)) {
    fail(deploymentSha !== expectedSha ? "STAGING_SHA_MISMATCH" : "RECOVERY_TICKET_BINDING_MISMATCH", "Staging schema repair is not bound to the exact main deployment and target.", { deployment_sha: deploymentSha || null }, 412);
  }
  if (targetFingerprint && target !== targetFingerprint) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Staging schema-repair target changed after planning.", { target_match: false }, 412);
  const manifestHash = text(attestation.recovery_manifest_hash, 128).toLowerCase();
  if (attestation.manifest_bound !== true || !SHA256.test(manifestHash)) {
    fail("RECOVERY_MANIFEST_BINDING_MISSING", "Staging schema repair requires a valid repository-owned Recovery Manifest binding.", { manifest_bound: attestation.manifest_bound === true }, 412);
  }
  return { ...attestation, sha: deploymentSha, target_fingerprint: target, recovery_manifest_hash: manifestHash };
}

function approvalConfirmation(plan) {
  const contract = readStagingRuntimeBootstrapContract();
  const prefix = text(contract.execution_policy?.apply_migration_confirmation_prefix, 128);
  if (!prefix) fail("RECOVERY_SCHEMA_REPAIR_CONFIRMATION_CONTRACT_INVALID", "Staging migration confirmation prefix is unavailable.", {}, 500);
  return `${prefix}:${plan.expected_sha}:${plan.target_key}:${plan.migration.file}`;
}

function buildPlan({ expectedSha, idempotencyKey, targetFingerprint, attestation, migration, migrationBindingHash }) {
  const findingBase = {
    contract: "mad4b.staging-schema-repair-finding.v1",
    category: "staging_schema_repair_required",
    classification: "allowlisted_migration",
    capability_key: STAGING_SCHEMA_REPAIR_CAPABILITY,
    expected_sha: expectedSha,
    target_key: "staging-runtime",
    target_fingerprint: targetFingerprint,
    target_role: migration.role,
    migration: migration.file,
    migration_sha256: migration.sha256,
    migration_binding_hash: migrationBindingHash,
    statement_count: migration.statement_count,
    mutation_required: true,
    mutation_class: "C3",
    repairability: "deterministic",
    server_derived: true,
    raw_sql_allowed: false,
    caller_command_allowed: false,
    caller_database_allowed: false,
    production_authority: false,
    secrets_included: false,
  };
  const findingId = `finding:${digest(findingBase).slice(0, 32)}`;
  const stepBase = {
    ordinal: 1,
    finding_id: findingId,
    classification: "staging_schema_repair_migration",
    capability_key: STAGING_SCHEMA_REPAIR_CAPABILITY,
    operation: "migration",
    action: "apply_migration",
    authority_ref: migration.file,
    migration: migration.file,
    migration_sha256: migration.sha256,
    migration_binding_hash: migrationBindingHash,
    statement_count: migration.statement_count,
    target_role: migration.role,
    target_fingerprint: targetFingerprint,
    mutation_class: "C3",
    consequential: true,
    approval_required: true,
    execution_ticket_required: true,
    verification_before_finalization: true,
    required_postconditions: structuredClone(migration.postconditions),
    raw_sql_allowed: false,
    caller_command_allowed: false,
    caller_database_allowed: false,
    rollback: "forward_only_same_cycle_readback_required",
  };
  const stepHash = digest(stepBase);
  const step = { ...stepBase, step_id: `step:${stepHash.slice(0, 32)}`, step_hash: stepHash };
  const findingHash = digest([findingId]);
  const planIdentity = { expected_sha: expectedSha, target_fingerprint: targetFingerprint, migration_binding_hash: migrationBindingHash, finding_id: findingId, step_hash: stepHash, nonce: randomUUID() };
  const planId = `plan:${digest(planIdentity).slice(0, 32)}`;
  const base = {
    contract: "mad4b.recovery-remediation-plan.v1",
    plan_id: planId,
    environment: "staging",
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "main",
    expected_sha: expectedSha,
    expected_sha_at_creation: expectedSha,
    target_key: "staging-runtime",
    target_fingerprint: targetFingerprint,
    target_fingerprint_at_creation: targetFingerprint,
    target_fingerprints: { composite: targetFingerprint, [migration.role]: targetFingerprint },
    manifest_hash: attestation.recovery_manifest_hash,
    runtime_attestation_hash: attestation.attestation_hash,
    finding_ids: [findingId],
    finding_hash: findingHash,
    role_selection_hash: null,
    role_bundle_bindings: {},
    migration,
    migration_binding_hash: migrationBindingHash,
    steps: [step],
    status: "planned",
    repair_key: STAGING_SCHEMA_REPAIR_CAPABILITY,
    required_approval: "server_managed_staging_schema_repair",
    execution_allowed: false,
    database_independent_control_plane: true,
    production_live_enabled: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    raw_sql_allowed: false,
    caller_command_allowed: false,
    caller_database_allowed: false,
    idempotency_key: idempotencyKey,
    proof: { manifest_bound: true, target_fingerprint_bound: true, deployment_attestation_bound: true, authority_resolved: true, preconditions_satisfied: true, unknown_drift: false },
    secrets_included: false,
  };
  const plan = { ...base, plan_hash: digest(base) };
  return { finding: { finding_id: findingId, ...findingBase }, step, plan };
}

export function createStagingSchemaRepairTicketAuthority({ env = process.env, adapters = null } = {}) {
  const injected = Object.fromEntries(Object.entries(adapters || {}).filter(([, value]) => value !== undefined && value !== null));
  const graph = { ...graphFor(env), ...injected };
  const store = graph.recoveryStore;
  if (!store?.putPlan || !store?.getPlan || !store?.putFinding || !store?.getApprovalByPlanStep || !store?.putExecutionTicket || !store?.reserveApproval || !store?.releaseApprovalReservation || !store?.markApprovalUsed || !graph.approvalIssuer?.createChallenge || !graph.approvalVerifier?.verify || !graph.executionTicketSigner?.sign || !graph.executionTicketVerifier?.verify) {
    fail("RECOVERY_APPROVAL_CHALLENGE_AUTHORITY_UNAVAILABLE", "Staging schema-repair approval/ticket authorities are incomplete.", {}, 503);
  }
  return Object.freeze({
    contract: STAGING_SCHEMA_REPAIR_TICKET_AUTHORITY_CONTRACT,
    capability: STAGING_SCHEMA_REPAIR_CAPABILITY,
    production_authority: false,

    async prepare(input = {}) {
      assertExactKeys(input, new Set(["expected_sha", "migration", "idempotency_key"]), "Schema-repair prepare");
      const expectedSha = sha(input.expected_sha, "expected_sha", SHA40);
      const idempotencyKey = text(input.idempotency_key, 160);
      if (!SAFE_ID.test(idempotencyKey)) fail("RECOVERY_TICKET_BINDING_MISMATCH", "A bounded idempotency key is required.", {}, 400);
      const resolved = resolveMigration(input.migration);
      const attestation = await attestExactDeployment(graph, expectedSha);
      const { finding, step, plan } = buildPlan({ expectedSha, idempotencyKey, targetFingerprint: attestation.target_fingerprint, attestation, migration: resolved.migration, migrationBindingHash: resolved.migration_binding_hash });
      await store.putFinding(finding);
      await store.putPlan(plan);
      const challenge = await createApprovalChallenge({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id }, { approvalIssuer: graph.approvalIssuer, approvalStore: graph.approvalStore, recoveryStore: store });
      return {
        ok: true,
        contract: STAGING_SCHEMA_REPAIR_TICKET_AUTHORITY_CONTRACT,
        status: "approval_required",
        capability: STAGING_SCHEMA_REPAIR_CAPABILITY,
        plan_id: plan.plan_id,
        plan_hash: plan.plan_hash,
        step_id: step.step_id,
        step_hash: step.step_hash,
        approval_id: challenge.approval_id,
        approval_hash: challenge.challenge_hash,
        approval_confirmation: approvalConfirmation(plan),
        expected_sha: plan.expected_sha,
        target_key: plan.target_key,
        target_fingerprint: plan.target_fingerprint,
        migration: plan.migration.file,
        migration_sha256: plan.migration.sha256,
        migration_binding_hash: plan.migration_binding_hash,
        statement_count: plan.migration.statement_count,
        target_role: plan.migration.role,
        server_derived_migration_contract: true,
        approval_token_not_returned: true,
        execution_ticket_not_returned: true,
        raw_sql_allowed: false,
        caller_command_allowed: false,
        caller_database_allowed: false,
        database_mutation_performed: false,
        production_authority: false,
        secrets_included: false,
      };
    },

    async approveAndIssue(input = {}) {
      assertExactKeys(input, new Set(["plan_id", "plan_hash", "step_id", "idempotency_key", "approval_confirmation"]), "Schema-repair approval");
      const planId = text(input.plan_id, 160);
      const planHash = sha(input.plan_hash, "plan_hash");
      const stepId = text(input.step_id, 160);
      const idempotencyKey = text(input.idempotency_key, 160);
      if (!PLAN_ID.test(planId) || !STEP_ID.test(stepId) || !SAFE_ID.test(idempotencyKey)) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Approval references are invalid.", {}, 400);
      const plan = await store.getPlan(planId);
      if (!plan || plan.plan_hash !== planHash || plan.repair_key !== STAGING_SCHEMA_REPAIR_CAPABILITY || plan.environment !== "staging" || plan.branch !== "main" || plan.target_key !== "staging-runtime" || plan.raw_sql_allowed !== false || plan.caller_database_allowed !== false) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Approval does not resolve to the fixed Staging schema-repair plan.", {}, 409);
      if (plan.execution_ticket_id || plan.status === "approved") fail("RECOVERY_APPROVAL_INVALID", "This schema-repair approval has already issued its single-use execution ticket.", {}, 409);
      const step = plan.steps?.find((entry) => entry.step_id === stepId);
      if (!step || step.capability_key !== STAGING_SCHEMA_REPAIR_CAPABILITY || step.operation !== "migration" || step.action !== "apply_migration" || step.migration_binding_hash !== plan.migration_binding_hash) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Approval step is not the fixed schema-repair migration capability.", {}, 409);
      const canonical = resolveMigration(plan.migration.file);
      if (canonical.migration_binding_hash !== plan.migration_binding_hash || canonical.migration.sha256 !== plan.migration.sha256 || canonical.migration.statement_count !== plan.migration.statement_count) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Repository migration contract changed after planning.", {}, 409);
      if (text(input.approval_confirmation, 1024) !== approvalConfirmation(plan)) fail("RECOVERY_APPROVAL_INVALID", "Exact Staging migration typed confirmation is required.", { confirmation_formula: "APPLY_STAGING_RUNTIME_MIGRATION:<expected_sha>:staging-runtime:<migration>" }, 401);
      const attestation = await attestExactDeployment(graph, plan.expected_sha, plan.target_fingerprint);
      const approval = await store.getApprovalByPlanStep(plan.plan_id, step.step_id);
      if (!approval || approval.used === true || Date.parse(approval.expires_at || 0) <= Date.now()) fail("RECOVERY_APPROVAL_INVALID", "The plan-bound approval challenge is absent, expired, or already used.", {}, 401);
      const issuedApproval = await graph.approvalIssuer.createChallenge(approval);
      const approvalToken = issuedApproval?.server_token;
      const approvalContext = {
        plan_hash: plan.plan_hash,
        step_id: step.step_id,
        step_hash: step.step_hash,
        expected_sha: plan.expected_sha,
        target_key: plan.target_key,
        target_fingerprint: plan.target_fingerprint,
        composite_target_fingerprint: plan.target_fingerprint,
        step_target_fingerprint: step.target_fingerprint,
        target_role: step.target_role,
        operation: step.operation,
        approval_id: approval.approval_id,
        approval_hash: approval.challenge_hash,
      };
      if ((await graph.approvalVerifier.verify({ token: approvalToken, approval, context: approvalContext })) !== true) fail("RECOVERY_APPROVAL_INVALID", "Server-managed schema-repair approval verification failed closed.", {}, 401);
      const approvalBinding = buildApprovalBinding({ approvalId: approval.approval_id, approvalHash: approval.challenge_hash, approvalVersion: approval.approval_version || "v1", planHash: plan.plan_hash, stepId: step.step_id, stepHash: step.step_hash, targetKey: plan.target_key, targetFingerprint: plan.target_fingerprint, targetRole: step.target_role, operation: step.operation });
      const reservationContext = { ...approvalContext, approval_hash: approvalBinding.approval_hash, approval_binding_hash: approvalBinding.binding_hash, idempotency_key: idempotencyKey, execution_ticket_id: null };
      const reserved = await store.reserveApproval(reservationContext);
      if (reserved?.reserved !== true) fail("RECOVERY_APPROVAL_INVALID", "The approval challenge is already reserved or consumed.", { reconciliation_required: true }, 409);
      let persisted = false;
      try {
        const ticket = await issueExecutionTicket({
          inspection_run_id: `run:${digest({ plan_hash: plan.plan_hash, approval_id: approval.approval_id }).slice(0, 32)}`,
          inspection_evidence_hash: plan.finding_hash,
          finding_ids: plan.finding_ids,
          selected_roles: [step.target_role],
          role_selection_required: false,
          role_object_count_fingerprints: {},
          target_fingerprints: { composite: plan.target_fingerprint },
          role_selection_hash: null,
          role_bundle_bindings: {},
          deployment_attestation_hash: attestation.attestation_hash,
          approval_id: approvalBinding.approval_id,
          approval_hash: approvalBinding.approval_hash,
          approval_version: approvalBinding.approval_version,
          approval_binding: approvalBinding,
          production_sha: plan.expected_sha,
          target_key: plan.target_key,
          target_fingerprint: plan.target_fingerprint,
          plan_hash: plan.plan_hash,
          step_hash: step.step_hash,
          step_id: step.step_id,
          target_role: step.target_role,
          operation: "migration",
          idempotency_key: idempotencyKey,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          nonce: randomUUID(),
        }, { signer: graph.executionTicketSigner });
        await store.putExecutionTicket(ticket);
        persisted = true;
        await store.putPlan({ ...plan, execution_ticket_id: ticket.ticket_id, execution_ticket_hash: ticket.ticket_hash, execution_idempotency_key: idempotencyKey, status: "approved" });
        await store.releaseApprovalReservation(reservationContext);
        await store.appendEvidenceEvent?.(idempotencyKey, { event: "staging_schema_repair_ticket_issued", phase: "issued", ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, migration: plan.migration.file, migration_binding_hash: plan.migration_binding_hash, expected_sha: plan.expected_sha, single_use: true, automatic_rerun_allowed: false, secrets_included: false }).catch(() => {});
        return {
          ok: true,
          contract: STAGING_SCHEMA_REPAIR_TICKET_AUTHORITY_CONTRACT,
          status: "ticket_issued_server_side",
          capability: STAGING_SCHEMA_REPAIR_CAPABILITY,
          plan_id: plan.plan_id,
          plan_hash: plan.plan_hash,
          step_id: step.step_id,
          expected_sha: plan.expected_sha,
          target_key: plan.target_key,
          migration: plan.migration.file,
          migration_binding_hash: plan.migration_binding_hash,
          single_use: true,
          execution_ticket_held_server_side: true,
          execution_ticket_not_returned: true,
          signature_not_returned: true,
          approval_token_not_returned: true,
          raw_sql_allowed: false,
          caller_command_allowed: false,
          caller_database_allowed: false,
          database_mutation_performed: false,
          production_authority: false,
          secrets_included: false,
        };
      } catch (error) {
        if (!persisted) await store.releaseApprovalReservation(reservationContext).catch(() => {});
        throw error;
      }
    },

    async resolveExecution(input = {}) {
      assertExactKeys(input, new Set(["plan_id", "plan_hash", "step_id", "idempotency_key"]), "Schema-repair execution");
      const planId = text(input.plan_id, 160);
      const planHash = sha(input.plan_hash, "plan_hash");
      const stepId = text(input.step_id, 160);
      const idempotencyKey = text(input.idempotency_key, 160);
      if (!PLAN_ID.test(planId) || !STEP_ID.test(stepId) || !SAFE_ID.test(idempotencyKey)) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Execution references are invalid.", {}, 400);
      const plan = await store.getPlan(planId);
      if (!plan || plan.plan_hash !== planHash || plan.environment !== "staging" || plan.branch !== "main" || plan.target_key !== "staging-runtime" || plan.repair_key !== STAGING_SCHEMA_REPAIR_CAPABILITY || plan.execution_idempotency_key !== idempotencyKey) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Execution does not resolve to the approved Staging schema-repair plan.", {}, 409);
      const step = plan.steps?.find((entry) => entry.step_id === stepId);
      if (!step || step.capability_key !== STAGING_SCHEMA_REPAIR_CAPABILITY || step.operation !== "migration" || step.action !== "apply_migration" || step.migration !== plan.migration.file || step.migration_binding_hash !== plan.migration_binding_hash) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Execution step is not the canonical Staging schema repair.", {}, 409);
      const canonical = resolveMigration(plan.migration.file);
      if (canonical.migration_binding_hash !== plan.migration_binding_hash) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Migration allowlist binding changed after approval.", {}, 409);
      if (!plan.execution_ticket_id || !plan.execution_ticket_hash) fail("RECOVERY_EXECUTION_TICKET_REQUIRED", "The approved schema-repair plan has no server-issued execution ticket.", {}, 409);
      const ticket = await store.getExecutionTicket(plan.execution_ticket_id);
      if (!ticket || ticket.ticket_hash !== plan.execution_ticket_hash) fail("RECOVERY_EXECUTION_TICKET_INVALID", "The server-issued execution ticket is unavailable or rebound.", {}, 409);
      const approval = await store.getApprovalByPlanStep(plan.plan_id, step.step_id);
      if (!approval || approval.used === true || Date.parse(approval.expires_at || 0) <= Date.now()) fail("RECOVERY_APPROVAL_INVALID", "The approved schema-repair plan is absent, expired, or consumed.", {}, 401);
      await attestExactDeployment(graph, plan.expected_sha, plan.target_fingerprint);
      return { plan, step, ticket, approval, migration: canonical.migration };
    },
  });
}

function schemaExecutionReady(adapters = {}) {
  const executor = adapters.hostBreakglassMutationExecutor;
  return Boolean(
    (typeof executor === "function" || typeof executor?.execute === "function")
    && typeof adapters.recoveryLock?.acquire === "function"
    && typeof adapters.recoveryLock?.heartbeat === "function"
    && typeof adapters.recoveryLock?.assertFence === "function"
    && typeof adapters.recoveryLock?.release === "function"
    && typeof adapters.readbackVerifier?.verify === "function"
    && adapters.readbackVerifier?.independent_authority === true
    && adapters.readbackVerifier?.role_aware === true
    && adapters.readbackVerifier?.mutation_authority !== true
    && typeof adapters.migrationLedger?.finalize === "function"
    && typeof adapters.deploymentIdentityProvider?.readAttestation === "function"
    && typeof adapters.recoveryStore?.getExecutionTicket === "function"
    && typeof adapters.recoveryStore?.reserveExecutionTicket === "function"
    && typeof adapters.recoveryStore?.finalizeExecutionTicket === "function"
    && typeof adapters.recoveryStore?.markApprovalUsed === "function"
  );
}

async function executeServerResolvedSchemaRepair(resolved, { adapters, env }) {
  if (!schemaExecutionReady(adapters)) fail("STAGING_SCHEMA_REPAIR_EXECUTION_UNAVAILABLE", "Staging schema-repair execution dependencies are incomplete.", {}, 503);
  const { plan, step, ticket, approval, migration } = resolved;
  const expectedTicket = {
    production_sha: plan.expected_sha,
    target_key: plan.target_key,
    target_fingerprint: plan.target_fingerprint,
    plan_hash: plan.plan_hash,
    step_hash: step.step_hash,
    step_id: step.step_id,
    target_role: step.target_role,
    operation: "migration",
    idempotency_key: plan.execution_idempotency_key,
  };
  await verifyExecutionTicket(ticket, { verifier: adapters.executionTicketVerifier || adapters.recoveryStore.executionTicketVerifier, expected: expectedTicket });
  const existing = await adapters.recoveryStore.getRunByIdempotency?.(plan.execution_idempotency_key);
  if (existing) return { ...existing, idempotent_replay: true, secrets_included: false };
  const reserved = await adapters.recoveryStore.reserveExecutionTicket({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, plan_hash: plan.plan_hash, step_hash: step.step_hash, step_id: step.step_id, idempotency_key: plan.execution_idempotency_key, target_key: plan.target_key, operation: "migration" });
  if (reserved?.reserved !== true) fail("RECOVERY_EXECUTION_TICKET_INVALID", "The schema-repair execution ticket is already reserved or finalized.", { reconciliation_required: true, automatic_rerun_allowed: false }, 409);
  const lock = await adapters.recoveryLock.acquire({ target_key: plan.target_key, plan_hash: plan.plan_hash, ttl_seconds: 600, fencing_required: true, heartbeat_required: true });
  if (lock !== true && lock?.acquired !== true) fail("RECOVERY_LOCK_BUSY", "Another consequential recovery operation owns the Staging target lock.", {}, 409);
  const handle = lock === true ? {} : lock;
  if (!handle.lease_id || !handle.fencing_token || !handle.expires_at) fail("RECOVERY_LOCK_FENCE_UNAVAILABLE", "Schema repair requires a fenced durable lock.", {}, 503);
  const executor = typeof adapters.hostBreakglassMutationExecutor === "function" ? adapters.hostBreakglassMutationExecutor : adapters.hostBreakglassMutationExecutor.execute.bind(adapters.hostBreakglassMutationExecutor);
  let providerStarted = false;
  try {
    await adapters.recoveryLock.heartbeat({ target_key: plan.target_key, plan_hash: plan.plan_hash, lock: handle, step_id: step.step_id, boundary: "before_schema_repair" });
    await adapters.recoveryLock.assertFence({ target_key: plan.target_key, plan_hash: plan.plan_hash, lock: handle, step_id: step.step_id, boundary: "before_schema_repair" });
    providerStarted = true;
    const result = await executor({
      capability_key: STAGING_SCHEMA_REPAIR_CAPABILITY,
      operation: "migration",
      action: "apply_migration",
      authority_ref: migration.file,
      migration: migration.file,
      migration_sha256: migration.sha256,
      migration_binding_hash: plan.migration_binding_hash,
      statement_count: migration.statement_count,
      target_role: migration.role,
      expected_sha: plan.expected_sha,
      target_key: plan.target_key,
      target_fingerprint: plan.target_fingerprint,
      plan_hash: plan.plan_hash,
      step_id: step.step_id,
      idempotency_key: plan.execution_idempotency_key,
      execution_ticket_id: ticket.ticket_id,
      execution_ticket_hash: ticket.ticket_hash,
      lease_id: handle.lease_id,
      fencing_token: handle.fencing_token,
      raw_sql_allowed: false,
      caller_command_allowed: false,
      caller_database_allowed: false,
      production_authority: false,
      secrets_included: false,
    }, { env });
    await adapters.recoveryLock.heartbeat({ target_key: plan.target_key, plan_hash: plan.plan_hash, lock: handle, step_id: step.step_id, boundary: "before_schema_readback" });
    await adapters.recoveryLock.assertFence({ target_key: plan.target_key, plan_hash: plan.plan_hash, lock: handle, step_id: step.step_id, boundary: "before_schema_readback" });
    const verification = await adapters.readbackVerifier.verify({
      plan: { ...plan, execution_ticket_id: undefined, execution_ticket_hash: undefined },
      step,
      run: { run_id: plan.execution_idempotency_key, plan_hash: plan.plan_hash, step_id: step.step_id, idempotency_key: plan.execution_idempotency_key, operation: "migration", fencing_token: handle.fencing_token, environment: "staging", production_mutation_performed: false, database_mutation_performed: result?.database_mutation_performed === true, provider_mutation_performed: false },
      target_role: migration.role,
      fencing_token: handle.fencing_token,
      same_cycle: true,
      independent_authority: true,
      role_aware: true,
      required_postconditions: { contract: "mad4b.staging-schema-repair-postconditions.v1", migration: migration.file, migration_sha256: migration.sha256, statement_count: migration.statement_count, target_role: migration.role, checks: structuredClone(migration.postconditions) },
    });
    const verified = verification?.ok === true || verification?.verified === true || verification?.postconditions_passed === true;
    if (!verified) fail("RECOVERY_READBACK_UNVERIFIED", "Schema-repair mutation did not produce verified same-cycle schema readback.", { database_mutation_performed: result?.database_mutation_performed === true, reconciliation_required: true, automatic_rerun_allowed: false }, 409);
    const ledger = await adapters.migrationLedger.finalize({ contract: "mad4b.staging-schema-repair-ledger-entry.v1", environment: "staging", expected_sha: plan.expected_sha, target_key: plan.target_key, target_fingerprint: plan.target_fingerprint, target_role: migration.role, migration: migration.file, migration_sha256: migration.sha256, migration_binding_hash: plan.migration_binding_hash, statement_count: migration.statement_count, plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, execution_ticket_id: ticket.ticket_id, execution_ticket_hash: ticket.ticket_hash, idempotency_key: plan.execution_idempotency_key, readback_evidence_hash: verification?.evidence_hash || digest(verification), finalized_at: new Date().toISOString(), production_authority: false, secrets_included: false });
    if (ledger?.finalized !== true && ledger?.persisted !== true && ledger?.durable !== true) fail("RECOVERY_MIGRATION_LEDGER_UNAVAILABLE", "Schema repair readback could not be durably finalized in the migration ledger.", { reconciliation_required: true, automatic_rerun_allowed: false }, 503);
    const final = await adapters.recoveryStore.finalizeExecutionTicket({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, idempotency_key: plan.execution_idempotency_key, plan_hash: plan.plan_hash, target_key: plan.target_key, operation: "migration", outcome: "verified", same_cycle_readback: true, readback_evidence_hash: verification?.evidence_hash || digest(verification), result_fingerprint: digest({ migration_binding_hash: plan.migration_binding_hash, verification }), provider_acknowledged: true, secrets_included: false });
    if (final?.finalized !== true) fail("RECOVERY_RECONCILIATION_REQUIRED", "Schema-repair ticket could not be finalized after verified readback.", { reconciliation_required: true, automatic_rerun_allowed: false }, 409);
    await adapters.recoveryStore.markApprovalUsed(approval.approval_id);
    const receipt = { ok: true, contract: "mad4b.staging-schema-repair-execution-receipt.v1", status: "verified", expected_sha: plan.expected_sha, target_key: plan.target_key, target_role: migration.role, migration: migration.file, migration_sha256: migration.sha256, migration_binding_hash: plan.migration_binding_hash, plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, idempotency_key: plan.execution_idempotency_key, same_cycle_readback: true, readback_evidence_hash: verification?.evidence_hash || digest(verification), database_mutation_performed: result?.database_mutation_performed === true, migration_apply_performed: result?.migration_apply_performed === true || result?.status === "apply_migration_complete", execution_ticket_consumed: true, approval_consumed: true, raw_sql_allowed: false, caller_command_allowed: false, caller_database_allowed: false, production_authority: false, secrets_included: false };
    await adapters.recoveryStore.putIdempotencyReceipt?.(plan.execution_idempotency_key, receipt);
    return receipt;
  } catch (error) {
    if (providerStarted) {
      error.details = { ...(error.details || {}), reconciliation_required: true, automatic_rerun_allowed: false, secrets_included: false };
    } else {
      await adapters.recoveryStore.releaseExecutionTicket?.({ ticket_id: ticket.ticket_id, ticket_hash: ticket.ticket_hash, idempotency_key: plan.execution_idempotency_key, plan_hash: plan.plan_hash, step_id: step.step_id }).catch(() => {});
    }
    throw error;
  } finally {
    await adapters.recoveryLock.release({ target_key: plan.target_key, plan_hash: plan.plan_hash, lock: handle }).catch(() => {});
  }
}

export async function stagingRecoverySchemaRepairPrepare(input = {}, { env = process.env, adapters = null } = {}) {
  return createStagingSchemaRepairTicketAuthority({ env, adapters }).prepare(input);
}

export async function stagingRecoverySchemaRepairApprove(input = {}, { env = process.env, adapters = null } = {}) {
  return createStagingSchemaRepairTicketAuthority({ env, adapters }).approveAndIssue(input);
}

export async function stagingRecoverySchemaRepairExecute(input = {}, { env = process.env, adapters = null } = {}) {
  const graph = { ...graphFor(env), ...Object.fromEntries(Object.entries(adapters || {}).filter(([, value]) => value !== undefined && value !== null)) };
  const authority = createStagingSchemaRepairTicketAuthority({ env, adapters: graph });
  const resolved = await authority.resolveExecution(input);
  return executeServerResolvedSchemaRepair(resolved, { adapters: graph, env });
}

function schemaPrepareDescriptor() {
  return {
    name: "staging_recovery_schema_repair_prepare",
    description: "Prepare exactly one repository-allowlisted Staging schema repair migration. The server derives checksum, statement count, target role, target fingerprint, and postconditions; raw SQL, paths, DB selectors, ticket material, and Production authority are forbidden.",
    source_key: STAGING_SCHEMA_REPAIR_SYSTEM_SOURCE_KEY,
    capability_key: STAGING_SCHEMA_REPAIR_CAPABILITY,
    catalog_level: "private_recovery",
    visibility: "private",
    auth_type: "admin_or_service",
    inputSchema: { type: "object", additionalProperties: false, required: ["expected_sha", "migration", "idempotency_key"], properties: { expected_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" }, migration: { type: "string", pattern: "^[0-9][A-Za-z0-9._-]+\\.sql$" }, idempotency_key: { type: "string", minLength: 8, maxLength: 160 } } },
  };
}

function schemaApproveDescriptor() {
  return {
    name: "staging_recovery_schema_repair_approve",
    description: "Consume the exact server-issued Staging migration confirmation for one immutable schema-repair plan and issue one signed single-use execution ticket held server-side.",
    source_key: STAGING_SCHEMA_REPAIR_SYSTEM_SOURCE_KEY,
    capability_key: STAGING_SCHEMA_REPAIR_CAPABILITY,
    catalog_level: "private_recovery",
    visibility: "private",
    auth_type: "admin_or_service",
    inputSchema: { type: "object", additionalProperties: false, required: ["plan_id", "plan_hash", "step_id", "idempotency_key", "approval_confirmation"], properties: { plan_id: { type: "string", pattern: "^plan:[0-9a-f]{32}$" }, plan_hash: { type: "string", pattern: "^[0-9a-f]{64}$" }, step_id: { type: "string", pattern: "^step:[0-9a-f]{32}$" }, idempotency_key: { type: "string", minLength: 8, maxLength: 160 }, approval_confirmation: { type: "string", minLength: 32, maxLength: 1024 } } },
  };
}

function schemaExecuteDescriptor() {
  return {
    name: "staging_recovery_schema_repair_execute",
    description: "Execute only the migration bound to an approved Staging schema-repair plan. Ticket, checksum, role, target and migration content remain server-resolved; a fenced lock, independent same-cycle schema readback and durable migration-ledger finalization are mandatory.",
    source_key: STAGING_SCHEMA_REPAIR_SYSTEM_SOURCE_KEY,
    capability_key: STAGING_SCHEMA_REPAIR_CAPABILITY,
    catalog_level: "private_recovery",
    visibility: "private",
    auth_type: "admin_or_service",
    inputSchema: { type: "object", additionalProperties: false, required: ["plan_id", "plan_hash", "step_id", "idempotency_key"], properties: { plan_id: { type: "string", pattern: "^plan:[0-9a-f]{32}$" }, plan_hash: { type: "string", pattern: "^[0-9a-f]{64}$" }, step_id: { type: "string", pattern: "^step:[0-9a-f]{32}$" }, idempotency_key: { type: "string", minLength: 8, maxLength: 160 } } },
  };
}

export function buildStagingSchemaRepairSystemTools() {
  return [schemaPrepareDescriptor(), schemaApproveDescriptor(), schemaExecuteDescriptor()];
}

export const _testingStagingSchemaRepairSystemTools = Object.freeze({ resolveMigration, approvalConfirmation, buildPlan, schemaExecutionReady, executeServerResolvedSchemaRepair, graphFor, digest });
