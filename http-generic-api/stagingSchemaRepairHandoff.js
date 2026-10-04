import { buildHostBreakglassPlan, dispatchHostBreakglassPlan } from "./hostBreakglassCatalog.js";
import { buildVerifiedHostBreakglassLocalRequest } from "./hostBreakglassLocalRequest.js";
import { readStagingRuntimeBootstrapContract } from "./stagingRuntimeBootstrapContract.js";

function fail(code, message, details = {}, status = 409) {
  throw Object.assign(new Error(message), {
    code,
    status,
    details: {
      ...details,
      production_authority: false,
      database_mutation_performed: false,
      secrets_included: false,
    },
  });
}

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

export async function buildStagingSchemaRepairLocalHandoff({
  issued,
  executionTicket,
  authorityPlanHash,
  idempotencyKey,
  broker = {},
} = {}) {
  if (!issued || typeof issued !== "object" || Array.isArray(issued)) {
    fail("STAGING_SCHEMA_REPAIR_HANDOFF_INVALID", "A server-issued schema-repair authority receipt is required.", {}, 400);
  }
  if (!executionTicket?.ticket_id || !executionTicket?.ticket_hash) {
    fail("RECOVERY_EXECUTION_TICKET_REQUIRED", "Schema-repair local handoff requires the server-issued execution-ticket references.");
  }
  const correlationId = text(idempotencyKey, 160);
  if (!correlationId) {
    fail("STAGING_SCHEMA_REPAIR_HANDOFF_INVALID", "A bounded idempotency key is required for the local handoff.", {}, 400);
  }
  const planHash = text(authorityPlanHash, 128).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(planHash)) {
    fail("STAGING_SCHEMA_REPAIR_HANDOFF_AUTHORITY_PLAN_INVALID", "Schema-repair local handoff requires the exact server authority plan hash.");
  }
  const migration = text(issued.migration, 220);
  const expectedSha = text(issued.expected_sha, 64).toLowerCase();
  const targetKey = text(issued.target_key || "staging-runtime", 160);
  if (!/^[0-9a-f]{40}$/u.test(expectedSha) || targetKey !== "staging-runtime" || !migration) {
    fail("STAGING_SCHEMA_REPAIR_HANDOFF_BINDING_INVALID", "Schema-repair local handoff is not bound to the exact Staging target and migration.");
  }

  const contract = readStagingRuntimeBootstrapContract();
  const prefix = contract.execution_policy?.apply_migration_confirmation_prefix || "APPLY_STAGING_RUNTIME_MIGRATION";
  const runInput = {
    environment_key: "staging_local_windows_docker",
    operation_key: "database.repair",
    runbook_key: "database.schema_repair",
    action: "apply_migration",
    expected_sha: expectedSha,
    target_source: "staging_local_role_env",
    target_key: targetKey,
    migration,
    confirmation: `${prefix}:${expectedSha}:${targetKey}:${migration}`,
    correlation_id: correlationId,
    execution_ticket_id: executionTicket.ticket_id,
    execution_ticket_hash: executionTicket.ticket_hash,
    authority_plan_hash: planHash,
  };
  const plan = buildHostBreakglassPlan(runInput, {
    ...broker,
    bootstrapContract: contract,
  });
  const receipt = await dispatchHostBreakglassPlan(plan, broker);
  if (receipt?.status !== "local_execution_required") {
    fail(
      "STAGING_SCHEMA_REPAIR_LOCAL_HANDOFF_UNAVAILABLE",
      "Host Breakglass did not resolve schema repair to the canonical local-only Staging transport.",
      { receipt_status: receipt?.status || null },
      503,
    );
  }
  const verifiedRequest = buildVerifiedHostBreakglassLocalRequest({
    ...plan,
    authority_plan_hash: planHash,
  });
  const requestFileName = `verified-staging-schema-repair-${plan.plan_sha256.slice(0, 16)}.json`;
  return {
    ...receipt,
    status: "local_execution_required",
    command: `node scripts/host-breakglass-local-verified.mjs --request-file .\\${requestFileName}`,
    request_file_name: requestFileName,
    verified_request: verifiedRequest,
    verified_request_sha256: verifiedRequest.request_sha256,
    authority_plan_hash: planHash,
    transport_plan_sha256: plan.plan_sha256,
    authority_plan_hash_separate_from_transport_plan: true,
    exact_plan_match_required: true,
    local_windows_docker_required: true,
    execution_ticket_signature_exposed: false,
    production_authority: false,
    database_mutation_performed: false,
    grant_mutation_performed: false,
    secrets_included: false,
  };
}
