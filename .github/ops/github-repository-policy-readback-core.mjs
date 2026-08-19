import { createHash } from "node:crypto";
import { branchKey, resolveTargetBranch } from "../../http-generic-api/scripts/github-review-policy-target.mjs";

const SHA_RE = /^[0-9a-f]{40}$/i;

export function policyFingerprint(readback = {}) {
  return createHash("sha256").update(JSON.stringify(readback.ruleset_details || []), "utf8").digest("hex");
}

export function buildBranchReadbackEvidence({ branch, expectedSha, readback }) {
  const targetBranch = resolveTargetBranch(branch);
  const expected = String(expectedSha || "").trim().toLowerCase();
  const observed = String(readback?.branch_sha || readback?.main_sha || "").trim().toLowerCase();
  const reasons = [];
  if (!SHA_RE.test(expected) || observed !== expected) reasons.push("branch_sha_drift");
  if (readback?.proof?.server_policy_gate_complete !== true) reasons.push("server_policy_gate_incomplete");
  if (readback?.proof?.required_status_check_producer_bound !== true) reasons.push("required_check_producer_unbound");
  if (readback?.proof?.required_status_checks_proven !== true) reasons.push("required_status_checks_unproven");
  if (readback?.proof?.direct_push_block_proven !== true) reasons.push("direct_push_block_unproven");
  if (readback?.proof?.force_push_block_proven !== true) reasons.push("force_push_block_unproven");
  if (readback?.proof?.finalizer_not_bypass_proven !== true) reasons.push("finalizer_bypass_posture_unproven");
  return {
    branch: targetBranch,
    branch_key: branchKey(targetBranch),
    expected_sha: expected || null,
    observed_sha: observed || null,
    exact_sha: observed === expected && SHA_RE.test(expected),
    protected: readback?.branch_protected === true,
    policy_gate_complete: readback?.proof?.server_policy_gate_complete === true,
    required_checks: readback?.required_checks || [],
    observed_required_checks: readback?.observed_required_checks || [],
    required_check_producer_bound: readback?.proof?.required_status_check_producer_bound === true,
    finalizer_identity: readback?.finalizer_identity || null,
    policy_fingerprint: policyFingerprint(readback),
    findings: readback?.findings || [],
    drift_reasons: [...new Set(reasons)].sort(),
    readback,
    secrets_included: false,
  };
}

export function buildTwoBranchReadbackEvidence({ branches, generatedAt = new Date().toISOString() }) {
  const rows = Array.isArray(branches) ? branches : [];
  const branchMap = Object.fromEntries(rows.map((row) => [row.branch, row]));
  const drifted = rows.filter((row) => row.drift_reasons.length > 0).map((row) => row.branch);
  return {
    contract: "github_repository_policy_two_branch_readback.v1",
    mode: "readback",
    generated_at: generatedAt,
    branches: branchMap,
    server_policy_drift_count: drifted.length,
    drifted_branches: drifted,
    reason: drifted.length ? "GOVERNANCE_SERVER_POLICY_DRIFT" : null,
    mutation_executed: false,
    provider_call_executed: false,
    external_write_executed: false,
    secrets_included: false,
  };
}
