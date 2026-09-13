import { buildHostBreakglassPlan, dispatchHostBreakglassPlan } from "./hostBreakglassCatalog.js";
import { buildVerifiedHostBreakglassLocalRequest } from "./hostBreakglassLocalRequest.js";
import { readStagingRuntimeBootstrapContract } from "./stagingRuntimeBootstrapContract.js";

function fail(code, message, details = {}, status = 409) {
  throw Object.assign(new Error(message), {
    code,
    status,
    details: { ...details, production_authority: false, database_mutation_performed: false, secrets_included: false },
  });
}

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

export async function buildStagingRebuildEmptyLocalHandoff({ issued, idempotencyKey, broker = {} } = {}) {
  if (!issued || typeof issued !== "object" || Array.isArray(issued)) fail("STAGING_REBUILD_EMPTY_HANDOFF_INVALID", "A server-issued rebuild-empty authority receipt is required.", {}, 400);
  const roles = Array.isArray(issued.selected_zero_object_roles) ? [...issued.selected_zero_object_roles] : [];
  const proof = issued.role_selection_proof;
  if (!roles.length || !proof || proof.source !== "durable_full_inspection") fail("RECOVERY_ROLE_SELECTION_PROVENANCE_UNAVAILABLE", "Selective rebuild handoff requires the durable server-resolved role-selection proof.");
  const correlationId = text(idempotencyKey, 160);
  if (!correlationId) fail("STAGING_REBUILD_EMPTY_HANDOFF_INVALID", "A bounded idempotency key is required for the local handoff.", {}, 400);
  const contract = readStagingRuntimeBootstrapContract();
  const prefix = contract.execution_policy?.rebuild_confirmation_prefix || "APPLY_STAGING_RUNTIME_BASELINE_REBUILD";
  const runInput = {
    environment_key: "staging_local_windows_docker",
    operation_key: "database.rebuild_empty",
    runbook_key: "database.empty_rebuild",
    action: "apply_migration",
    expected_sha: issued.expected_sha,
    target_source: "staging_local_role_env",
    target_key: issued.target_key || "staging-runtime",
    migration: "",
    confirmation: `${prefix}:${issued.expected_sha}:${issued.target_key || "staging-runtime"}:${roles.join(",")}`,
    correlation_id: correlationId,
    execution_ticket_id: issued.execution_ticket_id,
    execution_ticket_hash: issued.execution_ticket_hash,
    authority_plan_hash: issued.authority_plan_hash,
    role_selection_proof: proof,
  };
  const plan = buildHostBreakglassPlan(runInput, {
    ...broker,
    bootstrapContract: contract,
    proofResolver: () => proof,
  });
  const receipt = await dispatchHostBreakglassPlan(plan, broker);
  if (receipt?.status !== "local_execution_required") {
    fail("STAGING_REBUILD_EMPTY_LOCAL_HANDOFF_UNAVAILABLE", "Host Breakglass did not resolve the selective rebuild to the canonical local-only Staging transport.", { receipt_status: receipt?.status || null }, 503);
  }
  const verifiedRequest = buildVerifiedHostBreakglassLocalRequest({
    ...plan,
    authority_plan_hash: issued.authority_plan_hash,
  });
  const requestFileName = `verified-staging-rebuild-empty-${plan.plan_sha256.slice(0, 16)}.json`;
  return {
    ...receipt,
    status: "local_execution_required",
    command: `node scripts/host-breakglass-local-verified.mjs --request-file .\\${requestFileName}`,
    request_file_name: requestFileName,
    verified_request: verifiedRequest,
    verified_request_sha256: verifiedRequest.request_sha256,
    authority_plan_hash: issued.authority_plan_hash,
    transport_plan_sha256: plan.plan_sha256,
    authority_plan_hash_separate_from_transport_plan: true,
    exact_plan_match_required: true,
    production_authority: false,
    database_mutation_performed: false,
    grant_mutation_performed: false,
    secrets_included: false,
  };
}
