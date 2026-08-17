import crypto from "node:crypto";
import fs from "node:fs";

const SHA_RE = /^[0-9a-f]{40}$/u;
const RUN_RE = /^[1-9][0-9]*$/u;

export function requireSha(name, value) {
  if (!SHA_RE.test(String(value ?? ""))) throw new Error(`${name} must be an exact lowercase SHA`);
  return value;
}

export function buildOperationId({ releaseCutSha, productionSha }) {
  requireSha("releaseCutSha", releaseCutSha);
  requireSha("productionSha", productionSha);
  return `promo-${releaseCutSha.slice(0, 12)}-${productionSha.slice(0, 12)}`;
}

export function buildSurfaceNames({ releaseBranchPrefix, validationBranchPrefix, validationBaseBranchPrefix, releaseCutSha, productionSha }) {
  const operationId = buildOperationId({ releaseCutSha, productionSha });
  const safe = (value, name) => {
    if (!/^[a-z0-9]+(?:[/-][a-z0-9.-]+)*$/u.test(value)) throw new Error(`${name} contains unsafe branch characters`);
    return value;
  };
  return {
    operationId,
    releaseBranch: `${safe(releaseBranchPrefix, "releaseBranchPrefix")}-${releaseCutSha.slice(0, 12)}-${productionSha.slice(0, 12)}`,
    validationBranch: `${safe(validationBranchPrefix, "validationBranchPrefix")}-${releaseCutSha.slice(0, 12)}-${productionSha.slice(0, 12)}`,
    validationBaseBranch: `${safe(validationBaseBranchPrefix, "validationBaseBranchPrefix")}-${releaseCutSha.slice(0, 12)}-${productionSha.slice(0, 12)}`,
  };
}

export function buildStateEnvelope(input) {
  const releaseCutSha = requireSha("releaseCutSha", input.releaseCutSha);
  const productionSha = requireSha("productionSha", input.productionSha);
  const candidateSha = input.candidateSha ? requireSha("candidateSha", input.candidateSha) : null;
  const state = String(input.state ?? "INTENT_CAPTURED");
  const allowedStates = new Set([
    "INTENT_CAPTURED", "CAS_LOCKED", "REQUEST_READY", "OWNER_ATTESTED",
    "SUPPORTING_GATES_RUNNING", "CERTIFICATION_RUNNING", "CANDIDATE_READY",
    "MERGE_ARMED", "MERGED", "R7_POLLING", "COMPLETED", "CAS_RESTART_REQUIRED",
  ]);
  if (!allowedStates.has(state)) throw new Error(`unsupported promotion state: ${state}`);
  return {
    schema_version: "governed_production_promotion_operation.v1",
    operation_id: buildOperationId({ releaseCutSha, productionSha }),
    state,
    release_cut_sha: releaseCutSha,
    production_sha_before: productionSha,
    candidate_sha: candidateSha,
    request_pr: input.requestPr ?? null,
    release_pr: input.releasePr ?? null,
    validation_pr: input.validationPr ?? null,
    certified_run_id: input.certifiedRunId == null ? null : String(input.certifiedRunId),
    r7_run_id: input.r7RunId == null ? null : String(input.r7RunId),
    mutation_summary: {
      production_merge: false,
      deployment: false,
      database_mutation: false,
      provider_mutation: false,
    },
    idempotency_key: crypto.createHash("sha256")
      .update(`${releaseCutSha}:${productionSha}`)
      .digest("hex"),
  };
}

export function buildApprovalManifest({ operation, requiredRuns = [] }) {
  if (!operation || operation.schema_version !== "governed_production_promotion_operation.v1") {
    throw new Error("approval manifest requires a valid operation envelope");
  }
  return {
    schema_version: "governed_production_promotion_approval_manifest.v1",
    operation_id: operation.operation_id,
    idempotency_key: operation.idempotency_key,
    state: operation.state,
    approvals_required: requiredRuns.map((run) => ({
      run_id: String(run.runId),
      workflow: String(run.workflow),
      url: String(run.url),
      reason: "github_action_required",
      safe_scope: "read_only_supporting_gate",
    })),
    merge_executed: false,
    deployment_executed: false,
    secrets_included: false,
  };
}

export function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, path);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, output, releaseCutSha, productionSha] = process.argv.slice(2);
  if (command !== "operation" || !output) {
    console.error("usage: node production-promotion-operation-state.mjs operation <output> <release_cut_sha> <production_sha>");
    process.exit(2);
  }
  writeJsonAtomic(output, buildStateEnvelope({ releaseCutSha, productionSha }));
}
