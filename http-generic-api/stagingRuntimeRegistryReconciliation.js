import {
  inspectStagingRuntimeRegistrySnapshot,
  parseStagingRuntimeRegistrySnapshot,
  registryFingerprint,
  registryRequiredConfirmation,
  resolveRegistryPlanStatements,
  validateStagingRuntimeRegistryPlan
} from "./stagingRuntimeRegistrySnapshot.js";

function fail(code, message, status = 409, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.secrets_included = false;
  if (details) error.details = details;
  throw error;
}
function requireLedger(ledger) {
  const required = ["reserve","markExecuting","markSucceeded","markUnknown","markKnownNotApplied","markReconciledNoMutation","read"];
  if (!ledger || required.some((method) => typeof ledger[method] !== "function")) {
    fail("STAGING_REGISTRY_RECONCILIATION_LEDGER_REQUIRED", "A durable registry reconciliation ledger is required.", 500);
  }
}
function sameList(left, right) {
  return JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
}
async function inspect(args) {
  return inspectStagingRuntimeRegistrySnapshot({
    executor: args.executor,
    snapshot_gzip: args.snapshot_gzip,
    snapshot_metadata: args.snapshot_metadata,
    expected_commit: args.actual_commit
  });
}

export async function applyStagingRuntimeRegistryReconciliation({
  executor,
  snapshot_gzip,
  snapshot_metadata,
  plan,
  confirmation,
  actual_commit,
  ledger
} = {}) {
  requireLedger(ledger);
  validateStagingRuntimeRegistryPlan({ plan, actual_commit, snapshot_gzip, snapshot_metadata });
  if (String(confirmation || "").trim() !== registryRequiredConfirmation(plan.plan_sha256) || confirmation !== plan.required_confirmation) {
    fail("STAGING_REGISTRY_RECONCILIATION_CONFIRMATION_REQUIRED", "Exact typed confirmation is required.");
  }
  if (plan.repair_allowed !== true || plan.status_before !== "missing_rows" || plan.conflict_count !== 0 || plan.missing_count < 1) {
    fail("STAGING_REGISTRY_RECONCILIATION_PLAN_NOT_APPLYABLE", "Registry reconciliation plan is not applyable.");
  }

  const before = await inspect({ executor, snapshot_gzip, snapshot_metadata, actual_commit });
  if (before.precondition_fingerprint !== plan.precondition_fingerprint || before.status !== "missing_rows" || before.conflict_count !== 0
    || !sameList(before.missing_statement_sha256, plan.missing_statement_sha256)) {
    fail("STAGING_REGISTRY_RECONCILIATION_PRECONDITION_CHANGED", "Live registry precondition changed after planning.");
  }
  const selected = resolveRegistryPlanStatements({ plan, actual_commit, snapshot_gzip, snapshot_metadata });
  await ledger.reserve({
    plan_sha256: plan.plan_sha256,
    expected_commit: plan.expected_commit,
    artifact_sha256: plan.source_artifact.sha256,
    precondition_fingerprint: plan.precondition_fingerprint,
    mutation_retry_allowed: false,
    secrets_included: false
  });
  await ledger.markExecuting(plan.plan_sha256, { selected_statement_count: selected.length, secrets_included: false });

  let transactionStarted = false;
  let commitConfirmed = false;
  let statementSuccessCount = 0;
  try {
    await executor.query("START TRANSACTION");
    transactionStarted = true;
    for (const item of selected) {
      await executor.query(item.statement);
      statementSuccessCount += 1;
    }
    await executor.query("COMMIT");
    commitConfirmed = true;
  } catch (cause) {
    let rollbackConfirmed = false;
    if (transactionStarted && !commitConfirmed) {
      try { await executor.query("ROLLBACK"); rollbackConfirmed = true; } catch {}
    }
    let nonApplicationVerified = false;
    if (rollbackConfirmed) {
      try {
        const afterFailure = await inspect({ executor, snapshot_gzip, snapshot_metadata, actual_commit });
        nonApplicationVerified = afterFailure.precondition_fingerprint === plan.precondition_fingerprint;
      } catch {}
    }
    const details = {
      transaction_started: transactionStarted,
      statement_success_count: statementSuccessCount,
      commit_confirmed: commitConfirmed,
      rollback_confirmed: rollbackConfirmed,
      semantic_non_application_verified: nonApplicationVerified,
      mutation_retry_allowed: false,
      secrets_included: false
    };
    if (rollbackConfirmed && nonApplicationVerified) {
      await ledger.markKnownNotApplied(plan.plan_sha256, details);
      const error = new Error("Registry reconciliation transaction failed and non-application was verified; create a new exact-head plan.");
      error.code = "STAGING_REGISTRY_RECONCILIATION_KNOWN_NOT_APPLIED";
      error.status = 503;
      error.details = { status: "known_not_applied", ...details };
      error.cause = cause;
      throw error;
    }
    await ledger.markUnknown(plan.plan_sha256, { ...details, reconciliation_required: true });
    const error = new Error("Registry reconciliation outcome is unknown; reconciliation readback is required before any retry.");
    error.code = "STAGING_REGISTRY_RECONCILIATION_RECONCILIATION_REQUIRED";
    error.status = 503;
    error.details = { status: "unknown_outcome", reconciliation_required: true, ...details };
    error.cause = cause;
    throw error;
  }

  const readback = await inspect({ executor, snapshot_gzip, snapshot_metadata, actual_commit });
  if (readback.status !== "already_satisfied" || readback.missing_count !== 0 || readback.conflict_count !== 0) {
    const details = {
      status: "unknown_outcome",
      committed: true,
      statement_success_count: statementSuccessCount,
      readback_status: readback.status,
      missing_count: readback.missing_count,
      conflict_count: readback.conflict_count,
      reconciliation_required: true,
      mutation_retry_allowed: false,
      secrets_included: false
    };
    await ledger.markUnknown(plan.plan_sha256, details);
    fail("STAGING_REGISTRY_RECONCILIATION_RECONCILIATION_REQUIRED", "Registry reconciliation committed but same-cycle readback is incomplete.", 503, details);
  }
  try {
    await ledger.markSucceeded(plan.plan_sha256, {
      inserted_statement_count: statementSuccessCount,
      readback_verified: true,
      extra_live_rows_preserved: readback.extra_count,
      postcondition_fingerprint: readback.precondition_fingerprint,
      secrets_included: false
    });
  } catch (cause) {
    try { await ledger.markUnknown(plan.plan_sha256, { reason: "success_receipt_persistence_failed", mutation_retry_allowed: false }); } catch {}
    const error = new Error("Registry reconciliation completed but the durable success receipt failed; reconciliation is required.");
    error.code = "STAGING_REGISTRY_RECONCILIATION_RECONCILIATION_REQUIRED";
    error.status = 503;
    error.details = { status: "unknown_outcome", mutation_retry_allowed: false, reconciliation_required: true };
    error.cause = cause;
    throw error;
  }
  return Object.freeze({
    contract: "mad4b.staging-runtime-registry-reconciliation-result.v1",
    status: "reconciled",
    plan_sha256: plan.plan_sha256,
    source_artifact_sha256: plan.source_artifact.sha256,
    inserted_statement_count: statementSuccessCount,
    exact_count: readback.exact_count,
    extra_count: readback.extra_count,
    readback_verified: true,
    mutation_performed: statementSuccessCount > 0,
    mutation_retry_allowed: false,
    production_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false
  });
}

export async function reconcileStagingRuntimeRegistryReconciliation({
  executor,
  snapshot_gzip,
  snapshot_metadata,
  plan,
  actual_commit,
  ledger
} = {}) {
  requireLedger(ledger);
  parseStagingRuntimeRegistrySnapshot({ snapshot_gzip, snapshot_metadata, expected_commit: actual_commit });
  validateStagingRuntimeRegistryPlan({ plan, actual_commit, snapshot_gzip, snapshot_metadata });
  const record = await ledger.read(plan.plan_sha256);
  if (!record || record.state !== "unknown_outcome") {
    fail("STAGING_REGISTRY_RECONCILIATION_RECONCILIATION_STATE_INVALID", "Only unknown-outcome plans may enter reconciliation.");
  }
  const current = await inspect({ executor, snapshot_gzip, snapshot_metadata, actual_commit });
  const evidenceHash = registryFingerprint({
    plan_sha256: plan.plan_sha256,
    status: current.status,
    precondition_fingerprint: current.precondition_fingerprint,
    missing_statement_sha256: current.missing_statement_sha256,
    conflict_count: current.conflict_count
  });
  if (current.status === "already_satisfied" && current.conflict_count === 0) {
    await ledger.markSucceeded(plan.plan_sha256, {
      reconciled_after_unknown_outcome: true,
      reconciliation_evidence_hash: evidenceHash,
      readback_verified: true,
      secrets_included: false
    });
    return Object.freeze({ status: "reconciled_succeeded", reconciliation_evidence_hash: evidenceHash, mutation_retry_allowed: false, secrets_included: false });
  }
  if (current.precondition_fingerprint === plan.precondition_fingerprint && current.status === "missing_rows" && current.conflict_count === 0
    && sameList(current.missing_statement_sha256, plan.missing_statement_sha256)) {
    await ledger.markReconciledNoMutation(plan.plan_sha256, {
      reconciliation_evidence_hash: evidenceHash,
      readback_verified: true,
      secrets_included: false
    });
    return Object.freeze({ status: "reconciled_no_mutation", reconciliation_evidence_hash: evidenceHash, mutation_retry_allowed: false, secrets_included: false });
  }
  fail("STAGING_REGISTRY_RECONCILIATION_RECONCILIATION_REQUIRED", "Registry reconciliation remains partially applied or conflicted; automatic replay is forbidden.", 503, {
    status: current.status,
    missing_count: current.missing_count,
    conflict_count: current.conflict_count,
    reconciliation_evidence_hash: evidenceHash,
    mutation_retry_allowed: false
  });
}
