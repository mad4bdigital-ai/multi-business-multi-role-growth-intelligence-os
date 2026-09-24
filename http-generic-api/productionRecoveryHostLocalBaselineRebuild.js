import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readRuntimeBootstrapContract,
  runBootstrap,
  sanitizeBootstrapError,
} from "./runtimeBootstrapContract.js";
import { executeHostLocalRoleInspection } from "./hostLocalRuntimeInspection.js";
import { verifyExecutionTicket } from "./recoveryExecutionTicket.js";
import { validateRoleBundleBinding } from "./recoveryExecutionBinding.js";
import { computeRoleSelectionProofHash } from "./roleSelectionProof.js";

export const PRODUCTION_RECOVERY_HOST_LOCAL_BASELINE_REBUILD_CONTRACT =
  "mad4b.production-recovery-host-local-baseline-rebuild.v1";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const PRODUCTION_BRANCH = "Production";
const TARGET_KEY = "production-runtime";
const ROLES = new Set(["runtime", "governance", "runtime_persistence"]);
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,191}$/u;

const ALLOWED_EXECUTION_KEYS = new Set([
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
  "role_selection_proof",
  "selected_roles",
  "deployment_attestation_hash",
  "role_bundle_binding",
  "role_bundle_bindings",
  "grant_binding_hash",
  "secrets_included",
]);

function text(value, max = 1024) {
  return String(value ?? "").trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function fail(code, message, details = {}, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = {
    contract: PRODUCTION_RECOVERY_HOST_LOCAL_BASELINE_REBUILD_CONTRACT,
    database_connection_performed: false,
    database_mutation_performed: false,
    production_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
    ...details,
  };
  throw error;
}

function assertExactExecutionShape(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("RECOVERY_PRODUCTION_BASELINE_INPUT_INVALID", "Production baseline rebuild execution requires an object.", {}, 400);
  }
  const unexpected = Object.keys(input).filter((key) => !ALLOWED_EXECUTION_KEYS.has(key));
  if (unexpected.length) {
    fail("RECOVERY_PRODUCTION_BASELINE_FIELD_FORBIDDEN", "Production baseline rebuild accepts only immutable Recovery execution bindings.", { fields: unexpected }, 400);
  }
}

function normalizeRoleBundle(input, role) {
  const raw = input.role_bundle_binding;
  const validation = validateRoleBundleBinding(raw, {
    role,
    bundleManifestSha256: raw?.bundle_manifest_sha256,
    roleBundleSha256: raw?.role_bundle_sha256,
    statementCount: raw?.statement_count,
    statementFingerprints: raw?.statement_fingerprints,
  });
  if (!validation.ok) {
    fail("RECOVERY_PRODUCTION_ROLE_BUNDLE_BINDING_INVALID", "Recovery step role-bundle binding is invalid.", { role, problems: validation.problems });
  }
  const map = input.role_bundle_bindings;
  if (!map || typeof map !== "object" || Array.isArray(map) || Object.keys(map).length !== 1 || !map[role]) {
    fail("RECOVERY_PRODUCTION_ROLE_BUNDLE_BINDING_INVALID", "Recovery execution must carry exactly one role-bundle binding for the approved step.", { role });
  }
  const mapped = validateRoleBundleBinding(map[role], {
    role,
    bundleManifestSha256: map[role]?.bundle_manifest_sha256,
    roleBundleSha256: map[role]?.role_bundle_sha256,
    statementCount: map[role]?.statement_count,
    statementFingerprints: map[role]?.statement_fingerprints,
  });
  if (!mapped.ok || JSON.stringify(mapped.binding) !== JSON.stringify(validation.binding)) {
    fail("RECOVERY_PRODUCTION_ROLE_BUNDLE_BINDING_MISMATCH", "Execution role-bundle bindings disagree with the approved step.", { role });
  }
  return validation.binding;
}

function normalizeRoleProof(input, role) {
  const proof = input.role_selection_proof;
  if (!proof || typeof proof !== "object" || Array.isArray(proof)
    || proof.source !== "durable_full_inspection"
    || proof.expected_sha !== input.expected_sha
    || !Array.isArray(proof.selected_roles)
    || proof.selected_roles.length !== 1
    || proof.selected_roles[0] !== role
    || !Array.isArray(proof.finding_ids)
    || proof.finding_ids.length !== 1
    || !SHA256.test(text(proof.inspection_evidence_hash, 64).toLowerCase())
    || !SHA256.test(text(proof.composite_target_fingerprint, 64).toLowerCase())
    || !SHA256.test(text(proof.role_object_count_fingerprints?.[role], 64).toLowerCase())
    || !SAFE_ID.test(text(proof.inspection_run_id, 191))) {
    fail("RECOVERY_PRODUCTION_ROLE_SELECTION_PROOF_INVALID", "Production baseline rebuild requires one exact durable inspection proof for the approved role.", { role });
  }
  const canonical = {
    source: proof.source,
    expected_sha: proof.expected_sha,
    selected_roles: [role],
    inspection_run_id: proof.inspection_run_id,
    inspection_evidence_hash: proof.inspection_evidence_hash,
    finding_ids: [proof.finding_ids[0]],
    role_object_count_fingerprints: { [role]: proof.role_object_count_fingerprints[role] },
    composite_target_fingerprint: proof.composite_target_fingerprint,
  };
  const selectionHash = computeRoleSelectionProofHash(canonical);
  if (selectionHash !== text(input.role_selection_proof_hash, 64).toLowerCase()
    || (proof.selection_hash && text(proof.selection_hash, 64).toLowerCase() !== selectionHash)) {
    fail("RECOVERY_PRODUCTION_ROLE_SELECTION_HASH_MISMATCH", "Approved role-selection proof hash is not canonical for this single Recovery step.", { role });
  }
  return Object.freeze({ ...canonical, selection_hash: selectionHash });
}

function normalizeExecution(input = {}) {
  assertExactExecutionShape(input);
  const expectedSha = text(input.expected_sha, 40).toLowerCase();
  const role = text(input.target_role, 64);
  if (!SHA40.test(expectedSha)
    || input.target_key !== TARGET_KEY
    || !ROLES.has(role)
    || input.capability_key !== `${role}.baseline.rebuild_empty`
    || input.operation !== "database.rebuild_empty"
    || input.authority_ref !== `${role}.baseline.rebuild_empty`
    || !SHA256.test(text(input.plan_hash, 64).toLowerCase())
    || !SHA256.test(text(input.step_hash, 64).toLowerCase())
    || !SHA256.test(text(input.target_fingerprint, 64).toLowerCase())
    || !SHA256.test(text(input.execution_ticket_hash, 64).toLowerCase())
    || !SAFE_ID.test(text(input.plan_id, 191))
    || !SAFE_ID.test(text(input.step_id, 191))
    || !SAFE_ID.test(text(input.idempotency_key, 191))
    || !SAFE_ID.test(text(input.execution_ticket_id, 191))
    || !SAFE_ID.test(text(input.lease_id, 191))
    || !text(input.fencing_token, 512)) {
    fail("RECOVERY_PRODUCTION_BASELINE_BINDING_INVALID", "Production baseline rebuild execution binding is incomplete or outside the registered capability.", { target_role: role }, 400);
  }
  if (!Array.isArray(input.selected_roles) || input.selected_roles.length !== 1 || input.selected_roles[0] !== role) {
    fail("RECOVERY_PRODUCTION_BASELINE_ROLE_SET_INVALID", "Production Recovery baseline execution is strictly one approved role per step.", { target_role: role });
  }
  const proof = normalizeRoleProof({ ...input, expected_sha: expectedSha }, role);
  const bundle = normalizeRoleBundle(input, role);
  return Object.freeze({
    ...input,
    expected_sha: expectedSha,
    target_role: role,
    role_selection_proof: proof,
    role_selection_proof_hash: proof.selection_hash,
    role_bundle_binding: bundle,
    role_bundle_bindings: Object.freeze({ [role]: bundle }),
    secrets_included: false,
  });
}

function buildBootstrapEnvironment(input, env = process.env) {
  const next = { ...env };
  const controlled = [
    "BOOTSTRAP_MODE",
    "BOOTSTRAP_TARGET_SOURCE",
    "BOOTSTRAP_EXPECTED_SHA",
    "BOOTSTRAP_EXPECTED_BRANCH",
    "BOOTSTRAP_EXPECTED_REPOSITORY",
    "BOOTSTRAP_TARGET_KEY",
    "BOOTSTRAP_TARGET_DATABASE",
    "BOOTSTRAP_MIGRATION",
    "BOOTSTRAP_MIGRATION_CONFIRMATION",
    "BOOTSTRAP_REBUILD_CONFIRMATION",
    "BOOTSTRAP_GRANTS_CONFIRMATION",
    "BOOTSTRAP_GRANT_BINDING_HASH",
    "BOOTSTRAP_ROLE_SELECTION",
    "HOST_BREAKGLASS_TARGET_ROLES",
    "BOOTSTRAP_INSPECTION_RUN_ID",
    "BOOTSTRAP_PLAN_SHA256",
    "BOOTSTRAP_ROLE_SELECTION_HASH",
    "BOOTSTRAP_ROLE_OBJECT_COUNT_FINGERPRINTS",
    "BOOTSTRAP_ROLE_BUNDLE_BINDINGS_JSON",
    "BOOTSTRAP_EXECUTION_TICKET_ID",
    "BOOTSTRAP_EXECUTION_TICKET_HASH",
    "BOOTSTRAP_PARTIAL_REBUILD_RECEIPT_ID",
    "HOST_BREAKGLASS_OPERATION",
    "HOST_BREAKGLASS_ENVIRONMENT_KEY",
    "HOST_BREAKGLASS_HOST_LOCAL_ROLE_CREDENTIALS",
    "BOOTSTRAP_HOST_LOCAL_ROLE_IDENTITY",
    "BOOTSTRAP_SERVER_MANAGED_RECOVERY_STEP",
  ];
  for (const key of controlled) delete next[key];
  return {
    ...next,
    BOOTSTRAP_MODE: "apply_migration",
    BOOTSTRAP_TARGET_SOURCE: "host_local_role_env",
    BOOTSTRAP_EXPECTED_SHA: input.expected_sha,
    BOOTSTRAP_EXPECTED_BRANCH: PRODUCTION_BRANCH,
    BOOTSTRAP_EXPECTED_REPOSITORY: REPOSITORY,
    BOOTSTRAP_TARGET_KEY: TARGET_KEY,
    BOOTSTRAP_MIGRATION: "",
    BOOTSTRAP_REBUILD_CONFIRMATION: `APPLY_HOSTINGER_RUNTIME_BASELINE_REBUILD:${input.expected_sha}:${TARGET_KEY}:${input.target_role}`,
    BOOTSTRAP_ROLE_SELECTION: input.target_role,
    BOOTSTRAP_INSPECTION_RUN_ID: input.role_selection_proof.inspection_run_id,
    BOOTSTRAP_PLAN_SHA256: input.plan_hash,
    BOOTSTRAP_ROLE_SELECTION_HASH: input.role_selection_proof.selection_hash,
    BOOTSTRAP_ROLE_OBJECT_COUNT_FINGERPRINTS: JSON.stringify(input.role_selection_proof),
    BOOTSTRAP_ROLE_BUNDLE_BINDINGS_JSON: JSON.stringify(input.role_bundle_bindings),
    BOOTSTRAP_EXECUTION_TICKET_ID: input.execution_ticket_id,
    BOOTSTRAP_EXECUTION_TICKET_HASH: input.execution_ticket_hash,
    HOST_BREAKGLASS_OPERATION: "database.rebuild_empty",
    HOST_BREAKGLASS_HOST_LOCAL_ROLE_CREDENTIALS: "true",
    BOOTSTRAP_HOST_LOCAL_ROLE_IDENTITY: "true",
    BOOTSTRAP_SERVER_MANAGED_RECOVERY_STEP: "true",
  };
}

function createBootstrapTicketVerifier({ recoveryStore, executionTicketVerifier } = {}) {
  if (!recoveryStore?.getExecutionTicket || !executionTicketVerifier?.verify) {
    fail("RECOVERY_PRODUCTION_TICKET_AUTHORITY_UNAVAILABLE", "Production baseline rebuild requires the canonical durable ticket store and verifier.", {}, 503);
  }
  return Object.freeze({
    async verifyForBootstrap({ ticket_id: ticketId, ticket_hash: ticketHash, expected = {} } = {}) {
      const ticket = await recoveryStore.getExecutionTicket(ticketId);
      if (!ticket || text(ticket.ticket_hash, 64).toLowerCase() !== text(ticketHash, 64).toLowerCase()) return false;
      const { ticket_id: _ticketId, ticket_hash: _ticketHash, ...payloadExpected } = expected || {};
      try {
        const verified = await verifyExecutionTicket(ticket, {
          verifier: executionTicketVerifier,
          expected: payloadExpected,
        });
        return verified?.valid === true;
      } catch {
        return false;
      }
    },
  });
}

export function createProductionRecoveryHostLocalBaselineRebuildExecutor({
  env = process.env,
  recoveryStore,
  executionTicketVerifier,
  partialReceiptStore,
  bootstrapRunner = runBootstrap,
  contractReader = readRuntimeBootstrapContract,
  repoRoot = REPO_ROOT,
} = {}) {
  if (!partialReceiptStore?.putImmutablePartialRebuildReceipt) {
    fail("RECOVERY_PRODUCTION_PARTIAL_RECEIPT_STORE_UNAVAILABLE", "Production baseline rebuild requires the immutable partial-receipt authority.", {}, 503);
  }
  const bootstrapTicketVerifier = createBootstrapTicketVerifier({ recoveryStore, executionTicketVerifier });
  return async function executeProductionRecoveryHostLocalBaselineRebuild(rawInput = {}) {
    const input = normalizeExecution(rawInput);
    const bootstrapEnv = buildBootstrapEnvironment(input, env);
    let result;
    try {
      result = await bootstrapRunner({
        env: bootstrapEnv,
        contract: contractReader(),
        repoRoot,
        partialReceiptStore,
        executionTicketVerifier: bootstrapTicketVerifier,
      });
    } catch (error) {
      if (error?.code?.startsWith?.("RECOVERY_")) throw error;
      const safe = sanitizeBootstrapError(error);
      const wrapped = new Error("Production host-local baseline rebuild failed.");
      wrapped.code = safe.code || "RECOVERY_PRODUCTION_BASELINE_REBUILD_FAILED";
      wrapped.status = 409;
      wrapped.details = {
        contract: PRODUCTION_RECOVERY_HOST_LOCAL_BASELINE_REBUILD_CONTRACT,
        bootstrap_error: safe,
        reconciliation_required: error?.details?.reconciliation_required === true,
        automatic_rerun_allowed: false,
        database_mutation_performed: error?.details?.database_mutation_performed === true ? true : false,
        secrets_included: false,
      };
      throw wrapped;
    }
    const roleResult = Array.isArray(result?.role_rebuild_results)
      ? result.role_rebuild_results.find((entry) => entry?.role === input.target_role)
      : null;
    if (result?.status !== "baseline_rebuild_complete"
      || result?.operation !== "database.rebuild_empty"
      || !Array.isArray(result?.selected_rebuild_roles)
      || result.selected_rebuild_roles.length !== 1
      || result.selected_rebuild_roles[0] !== input.target_role
      || !roleResult
      || roleResult?.verification?.required_tables_present !== true
      || roleResult?.verification?.object_count_nonzero !== true
      || result?.grant_mutation_performed !== false
      || result?.migration_apply_performed !== false
      || result?.secrets_included !== false) {
      fail("RECOVERY_PRODUCTION_BASELINE_RECEIPT_INVALID", "Host-local baseline rebuild did not return the exact verified single-role receipt.", { target_role: input.target_role, database_mutation_performed: result?.database_mutation_performed === true });
    }
    return Object.freeze({
      ok: true,
      contract: PRODUCTION_RECOVERY_HOST_LOCAL_BASELINE_REBUILD_CONTRACT,
      status: "baseline_rebuild_provider_acknowledged",
      target_role: input.target_role,
      expected_sha: input.expected_sha,
      target_key: TARGET_KEY,
      target_fingerprint: input.target_fingerprint,
      plan_hash: input.plan_hash,
      step_hash: input.step_hash,
      role_selection_hash: input.role_selection_proof.selection_hash,
      role_bundle_binding_hash: input.role_bundle_binding.binding_hash,
      bootstrap_status: result.status,
      role_rebuild_result: roleResult,
      database_connection_performed: result.database_connection_performed === true,
      database_mutation_performed: result.database_mutation_performed === true,
      migration_apply_performed: false,
      grant_mutation_performed: false,
      provider_mutation_performed: false,
      workflow_dispatch_performed: false,
      automatic_rerun_allowed: false,
      secrets_included: false,
    });
  };
}

export function createProductionRecoveryIndependentBaselineReadback({
  env = process.env,
  inspectionRunner = executeHostLocalRoleInspection,
} = {}) {
  return async function verifyProductionRecoveryBaselineReadback(input = {}) {
    const role = text(input.target_role || input.step?.target_role, 64);
    const expectedSha = text(input.expected_sha || input.plan?.expected_sha, 40).toLowerCase();
    const capability = text(input.step?.capability_key, 160);
    if (!ROLES.has(role) || !SHA40.test(expectedSha) || capability !== `${role}.baseline.rebuild_empty`) {
      fail("RECOVERY_PRODUCTION_READBACK_BINDING_INVALID", "Baseline readback is restricted to the exact approved role rebuild step.", { target_role: role }, 400);
    }
    const inspection = await inspectionRunner({ expected_sha: expectedSha, target_key: TARGET_KEY }, { env });
    const classification = inspection?.role_database_object_classifications?.[role];
    const counts = inspection?.role_database_object_counts?.[role];
    const tableEvidence = inspection?.role_table_evidence?.[role];
    const selectedAfter = Array.isArray(inspection?.selected_rebuild_roles) ? inspection.selected_rebuild_roles : [];
    const composite = text(inspection?.target_binding?.target_fingerprint || inspection?.composite_target_fingerprint, 64).toLowerCase();
    const expectedComposite = text(input.plan?.role_selection_proof?.composite_target_fingerprint || input.plan?.target_fingerprint, 64).toLowerCase();
    const verified = inspection?.database_mutation_performed === false
      && inspection?.migration_apply_performed === false
      && inspection?.grant_mutation_performed === false
      && inspection?.secrets_included === false
      && classification === "nonempty_objects"
      && Number(counts?.total || 0) > 0
      && Array.isArray(tableEvidence)
      && tableEvidence.length > 0
      && tableEvidence.every((entry) => entry?.present === true)
      && !selectedAfter.includes(role)
      && SHA256.test(composite)
      && (!expectedComposite || composite === expectedComposite);
    if (!verified) {
      fail("RECOVERY_PRODUCTION_READBACK_FAILED", "Same-cycle host-local inspection did not prove the rebuilt role postconditions.", { target_role: role, classification, selected_after: selectedAfter });
    }
    const evidence = {
      contract: "mad4b.production-recovery-baseline-readback-evidence.v1",
      expected_sha: expectedSha,
      target_key: TARGET_KEY,
      target_role: role,
      target_fingerprint: composite,
      object_classification: classification,
      object_counts: counts,
      required_table_evidence: tableEvidence,
      selected_rebuild_roles_after: selectedAfter,
      database_mutation_performed: false,
      secrets_included: false,
    };
    return Object.freeze({
      ok: true,
      verified: true,
      postconditions_passed: true,
      structural_postconditions_passed: true,
      data_postconditions_passed: true,
      behavioral_probe_passed: null,
      independent_authority: true,
      role_aware: true,
      mutation_authority: false,
      evidence_hash: digest(evidence),
      evidence,
      database_connection_performed: inspection?.database_connection_performed === true,
      database_mutation_performed: false,
      secrets_included: false,
    });
  };
}

export const _testingProductionRecoveryHostLocalBaselineRebuild = Object.freeze({
  normalizeExecution,
  buildBootstrapEnvironment,
  createBootstrapTicketVerifier,
  digest,
});
