import { createHash } from "node:crypto";
import { branchKey, resolveTargetBranch } from "../../http-generic-api/scripts/github-review-policy-target.mjs";

const SHA_RE = /^[0-9a-f]{40}$/i;

export function policyFingerprint(readback = {}) {
  return createHash("sha256").update(JSON.stringify(readback.ruleset_details || []), "utf8").digest("hex");
}

/**
 * Classify direct policy gaps separately from unreadable evidence. This is a
 * diagnostic, not policy Apply authority. Never turn an unknown into PASS.
 */
export function triagePolicyReadback(readback = {}) {
  const policy = readback?.constitution?.branch_policy || {};
  const branch = readback?.target?.default_branch || policy.branch || null;
  const proof = readback?.proof || {};
  const confirmed = [];
  const unknown = [];
  const residual = [];
  const add = (list, item) => { if (!list.includes(item)) list.push(item); };
  const api = readback?.api_status || {};

  if (api.classic_branch_protection === 403) add(unknown, "classic_protection_read_forbidden");
  else if (![200, 404].includes(api.classic_branch_protection)) add(unknown, "classic_protection_read_unverified");
  if (proof.policy_state_readable !== true) add(unknown, "aggregate_policy_visibility_incomplete");
  if (proof.finalizer_app_identity_resolved !== true) add(unknown, "trusted_app_identity_unresolved");

  if (readback?.branch_protected === false) add(confirmed, "branch_is_not_protected");
  if (readback?.active_managed_ruleset_count === 0) add(confirmed, "managed_ruleset_not_active");
  const expected = Array.isArray(readback?.required_checks) ? readback.required_checks : [];
  const observed = Array.isArray(readback?.observed_required_checks) ? readback.observed_required_checks : [];
  for (const context of expected) {
    if (!observed.includes(context)) add(confirmed, "required_check_absent:" + context);
  }

  // Existing API-visible rules are authoritative even when classic protection
  // itself returned 403; never mark their explicit settings as unknown.
  const rules = (readback?.ruleset_details || []).filter(x => x.applies_to_target && x.enforcement === "active");
  const reviewRules = rules.filter(x => x.pull_request?.present === true);
  if (policy.dismiss_stale_approvals && reviewRules.length &&
      reviewRules.every(x => x.pull_request.dismiss_stale_reviews_on_push !== true))
    add(confirmed, "stale_review_dismissal_disabled");
  if (policy.require_conversation_resolution && reviewRules.length &&
      reviewRules.every(x => x.pull_request.required_review_thread_resolution !== true))
    add(confirmed, "review_thread_resolution_disabled");
  if (policy.strict_required_status_checks && rules.length &&
      rules.every(x => x.raw_writable_policy?.rules?.filter(y => y.type === "required_status_checks")
        .every(y => y.parameters?.strict_required_status_checks_policy !== true)))
    add(confirmed, "strict_required_checks_disabled");
  if (readback?.required_check_source_mode === "any_source_with_independent_finalizer_readback" &&
      readback?.required_check_source_unrestricted === true)
    add(residual, "any_source_requires_independent_trusted_status_readback");
  // The Actions read token can return a successful repository response with
  // allow_auto_merge omitted. Treat that as missing evidence, not proof that
  // auto-merge is enabled. Only an explicit true establishes the policy gap.
  if (readback?.repository_auto_merge_allowed === true)
    add(confirmed, "repository_auto_merge_enabled");
  else if (readback?.repository_auto_merge_allowed !== false)
    add(unknown, "repository_auto_merge_setting_unverified");

  const exactBranchSha = /^[0-9a-f]{40}$/i.test(String(readback?.branch_sha || ""));
  if (!exactBranchSha) add(unknown, "branch_sha_unverified");
  const status = confirmed.length ? "confirmed_policy_gaps" :
    unknown.length ? "evidence_incomplete" :
    residual.length ? "independent_attestor_required" : "no_observed_gaps";
  return {
    contract: "mad4b.policy-readback-triage.v1",
    branch,
    status,
    confirmed_policy_gaps: confirmed.sort(),
    visibility_blockers: unknown.sort(),
    residual_risks: residual.sort(),
    exact_branch_sha: exactBranchSha ? readback.branch_sha : null,
    remediation: {
      policy_apply_authorized: false,
      exact_scope_approval_required: true,
      independent_authoritative_readback_required: true,
      automatic_waiver_allowed: false,
      production_mutation_allowed: false,
    },
    secrets_included: false,
  };
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
  const triage = triagePolicyReadback(readback);
  return {
    triage,
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
