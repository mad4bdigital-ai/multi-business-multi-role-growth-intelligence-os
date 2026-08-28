#!/usr/bin/env node
import assert from "node:assert/strict";

const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
const token = String(process.env.GH_TOKEN || "").trim();
const branch = String(process.env.TARGET_BRANCH || "main").trim();
const expectedBaseHead = String(process.env.EXPECTED_HEAD_SHA || "").trim().toLowerCase();
const expectedPrHead = String(process.env.EXPECTED_PR_HEAD_SHA || "").trim().toLowerCase();
const expectedCandidate = String(process.env.EXPECTED_CANDIDATE_SHA || "").trim().toLowerCase();
const requiredContext = String(process.env.REQUIRED_CHECK_CONTEXT || "Derived State Closure").trim();
const managedRulesetName = String(process.env.MANAGED_RULESET_NAME || "MAD4B main review policy").trim();
const expectedAttestorAppId = Number(process.env.EXPECTED_ATTESTOR_APP_ID || 0);
const expectedStatusCreatorId = Number(process.env.EXPECTED_STATUS_CREATOR_ID || 0);
const prNumber = String(process.env.PR_NUMBER || "").trim();

const SHA40 = /^[a-f0-9]{40}$/;

assert.match(repository, /^[^/]+\/[^/]+$/, "GITHUB_REPOSITORY must be owner/repo.");
assert.ok(token, "GH_TOKEN is required.");
assert.equal(branch, "main", "Governance finalizer merge readiness is permitted only for main.");
assert.match(expectedBaseHead, SHA40, "EXPECTED_HEAD_SHA must be the exact current main SHA.");
assert.match(expectedPrHead, SHA40, "EXPECTED_PR_HEAD_SHA must be the exact attested PR head SHA.");
assert.match(expectedCandidate, SHA40, "EXPECTED_CANDIDATE_SHA must be the exact attested merge-candidate SHA.");
assert.ok(requiredContext, "REQUIRED_CHECK_CONTEXT is required.");
assert.ok(managedRulesetName, "MANAGED_RULESET_NAME is required.");
assert.ok(Number.isInteger(expectedAttestorAppId) && expectedAttestorAppId > 0, "EXPECTED_ATTESTOR_APP_ID must be a positive GitHub App id.");
assert.ok(Number.isInteger(expectedStatusCreatorId) && expectedStatusCreatorId > 0, "EXPECTED_STATUS_CREATOR_ID must be a positive GitHub status creator id.");
assert.match(prNumber, /^[1-9][0-9]*$/, "PR_NUMBER must be numeric.");

async function github(pathname) {
  const url = pathname
    ? `https://api.github.com/repos/${repository}/${pathname}`
    : `https://api.github.com/repos/${repository}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(`GitHub finalizer readiness readback failed for ${pathname || "repository"}: ${response.status}`);
  }
  return payload;
}

function requiredStatusBindings(rules) {
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => rule?.type === "required_status_checks")
    .flatMap((rule) => Array.isArray(rule?.parameters?.required_status_checks) ? rule.parameters.required_status_checks : [])
    .map((entry) => ({
      context: String(entry?.context || "").trim(),
      integration_id: Number(entry?.integration_id ?? entry?.app_id ?? 0) || null,
    }))
    .filter((entry) => entry.context);
}

function fail(status, message, details = {}) {
  const receipt = {
    contract: "github-followup-finalizer-merge-readiness.v2",
    repository,
    branch,
    expected_base_sha: expectedBaseHead,
    expected_pr_head_sha: expectedPrHead,
    expected_candidate_sha: expectedCandidate,
    required_check: requiredContext,
    expected_attestor_app_id: expectedAttestorAppId,
    expected_status_creator_id: expectedStatusCreatorId,
    native_auto_merge_required: false,
    safe_to_register_auto_merge: false,
    safe_to_merge_now: false,
    status,
    ...details,
    secrets_included: false,
  };
  process.stderr.write(`${JSON.stringify(receipt)}\n`);
  throw new Error(message);
}

const repositoryState = await github("");
const branchState = await github(`branches/${encodeURIComponent(branch)}`);
const activeRules = await github(`rules/branches/${encodeURIComponent(branch)}`);
const rulesetIndex = await github("rulesets?includes_parents=true&per_page=100");
const observedBaseHead = String(branchState?.commit?.sha || "").trim().toLowerCase();

if (repositoryState.allow_auto_merge !== false) {
  fail("blocked_repository_native_auto_merge_enabled", "Repository native auto-merge must be disabled before governed finalizer merge.", {
    observed_base_sha: observedBaseHead,
    allow_auto_merge: repositoryState.allow_auto_merge,
  });
}
if (branchState.protected !== true) {
  fail("blocked_unprotected_main", "main is not protected on GitHub.", {
    observed_base_sha: observedBaseHead,
    branch_protected: false,
  });
}
if (!Array.isArray(activeRules)) {
  fail("blocked_active_rules_unreadable", "Active branch rules are not readable as an array.", {
    observed_base_sha: observedBaseHead,
  });
}
const activeRuleTypes = new Set(activeRules.map((rule) => String(rule?.type || "").trim()).filter(Boolean));
for (const requiredType of ["pull_request", "required_status_checks", "non_fast_forward"]) {
  if (!activeRuleTypes.has(requiredType)) {
    fail("blocked_required_branch_rule_missing", `Required active branch rule ${requiredType} is missing.`, {
      observed_base_sha: observedBaseHead,
      required_rule_type: requiredType,
      observed_rule_types: [...activeRuleTypes].sort(),
    });
  }
}
if (activeRuleTypes.has("merge_queue")) {
  fail("blocked_merge_queue_enabled", "Merge queue must remain disabled for the governed exact-head finalizer.", {
    observed_base_sha: observedBaseHead,
  });
}

const activeBindings = requiredStatusBindings(activeRules);
const activeBinding = activeBindings.find((entry) => entry.context === requiredContext);
if (!activeBinding || activeBinding.integration_id !== expectedAttestorAppId) {
  fail("blocked_required_check_app_binding_missing", `${requiredContext} is not actively bound to the exact trusted attestor App.`, {
    observed_base_sha: observedBaseHead,
    observed_required_status_bindings: activeBindings,
  });
}

if (!Array.isArray(rulesetIndex)) {
  fail("blocked_ruleset_index_unreadable", "Repository ruleset index is not readable as an array.", {
    observed_base_sha: observedBaseHead,
  });
}
const managedMatches = rulesetIndex.filter((ruleset) => ruleset?.name === managedRulesetName && ruleset?.target === "branch" && ruleset?.enforcement === "active");
if (managedMatches.length !== 1 || !Number.isInteger(Number(managedMatches[0]?.id))) {
  fail("blocked_managed_ruleset_ambiguous", "Exactly one active repository governance ruleset is required.", {
    observed_base_sha: observedBaseHead,
    managed_ruleset_name: managedRulesetName,
    managed_ruleset_count: managedMatches.length,
  });
}
const managedRuleset = await github(`rulesets/${Number(managedMatches[0].id)}`);
if (!Array.isArray(managedRuleset?.bypass_actors) || managedRuleset.bypass_actors.length !== 0) {
  fail("blocked_managed_ruleset_bypass_actor", "Managed governance ruleset must not contain bypass actors.", {
    observed_base_sha: observedBaseHead,
    managed_ruleset_id: Number(managedMatches[0].id),
    bypass_actor_count: Array.isArray(managedRuleset?.bypass_actors) ? managedRuleset.bypass_actors.length : null,
  });
}
const managedBindings = requiredStatusBindings(managedRuleset?.rules || []);
const managedBinding = managedBindings.find((entry) => entry.context === requiredContext);
if (!managedBinding || managedBinding.integration_id !== expectedAttestorAppId) {
  fail("blocked_managed_ruleset_attestor_binding_missing", "Managed governance ruleset is not bound to the exact trusted attestor App.", {
    observed_base_sha: observedBaseHead,
    managed_ruleset_id: Number(managedMatches[0].id),
    observed_required_status_bindings: managedBindings,
  });
}

if (observedBaseHead !== expectedBaseHead) {
  fail("blocked_stale_main", "main moved after the attested merge candidate was pinned.", {
    observed_base_sha: observedBaseHead,
    branch_protected: true,
  });
}

const pr = await github(`pulls/${prNumber}`);
if (pr.state !== "open" || pr.draft === true || pr.base?.ref !== "main") {
  fail("blocked_pr_state", "Finalized pull request is not an open Ready PR targeting main.", {
    observed_base_sha: observedBaseHead,
    followup_pr: Number(prNumber),
    followup_pr_state: pr.state || "unknown",
    followup_pr_draft: pr.draft === true,
    followup_base_ref: pr.base?.ref || "",
  });
}
if (String(pr?.base?.sha || "").trim().toLowerCase() !== expectedBaseHead) {
  fail("blocked_pr_base_drift", "Pull-request base SHA differs from the attested main base.", {
    observed_base_sha: String(pr?.base?.sha || "").trim().toLowerCase(),
  });
}
if (String(pr?.head?.sha || "").trim().toLowerCase() !== expectedPrHead) {
  fail("blocked_pr_head_drift", "Pull-request head SHA differs from the attested source head.", {
    observed_pr_head_sha: String(pr?.head?.sha || "").trim().toLowerCase(),
  });
}
if (String(pr?.merge_commit_sha || "").trim().toLowerCase() !== expectedCandidate) {
  fail("blocked_merge_candidate_drift", "GitHub merge candidate differs from the trusted attestation candidate.", {
    observed_candidate_sha: String(pr?.merge_commit_sha || "").trim().toLowerCase(),
  });
}

const labels = (pr.labels || []).map((entry) => String(entry?.name || "")).filter(Boolean);
const blockingLabels = ["do-not-auto-merge", "manual-merge", "manual-review", "security-review"].filter((label) => labels.includes(label));
if (blockingLabels.length > 0) {
  fail("manual_review_required", "Manual-review objection blocks governed finalizer merge.", {
    observed_base_sha: observedBaseHead,
    followup_pr: Number(prNumber),
    blocking_labels: blockingLabels,
  });
}

const statuses = await github(`commits/${expectedCandidate}/statuses?per_page=100`);
const trustedStatuses = (Array.isArray(statuses) ? statuses : []).filter((status) =>
  status?.context === requiredContext
  && status?.state === "success"
  && Number(status?.creator?.id || 0) === expectedStatusCreatorId
);
if (trustedStatuses.length < 1) {
  fail("blocked_exact_attestor_status_missing", "Exact merge candidate does not expose the same-cycle trusted attestor success status.", {
    observed_base_sha: observedBaseHead,
    candidate_sha: expectedCandidate,
    status_context: requiredContext,
  });
}

const receipt = {
  contract: "github-followup-finalizer-merge-readiness.v2",
  repository,
  branch,
  expected_base_sha: expectedBaseHead,
  observed_base_sha: observedBaseHead,
  expected_pr_head_sha: expectedPrHead,
  expected_candidate_sha: expectedCandidate,
  native_auto_merge_allowed: false,
  native_auto_merge_required: false,
  branch_protected: true,
  active_rule_types: [...activeRuleTypes].sort(),
  managed_ruleset_id: Number(managedMatches[0].id),
  managed_ruleset_name: managedRulesetName,
  bypass_actor_count: 0,
  required_check: requiredContext,
  required_check_enforced: true,
  required_check_app_bound: true,
  expected_attestor_app_id: expectedAttestorAppId,
  expected_status_creator_id: expectedStatusCreatorId,
  exact_attestor_status_proven: true,
  followup_pr: Number(prNumber),
  manual_objection_present: false,
  safe_to_register_auto_merge: false,
  safe_to_merge_now: true,
  status: "ready",
  secrets_included: false,
};

process.stdout.write(`${JSON.stringify(receipt)}\n`);
