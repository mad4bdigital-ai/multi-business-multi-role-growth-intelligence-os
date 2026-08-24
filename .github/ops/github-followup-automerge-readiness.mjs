#!/usr/bin/env node
import assert from "node:assert/strict";

const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
const token = String(process.env.GH_TOKEN || "").trim();
const branch = String(process.env.TARGET_BRANCH || "main").trim();
const expectedHead = String(process.env.EXPECTED_HEAD_SHA || "").trim();
const requiredContext = String(
  process.env.REQUIRED_CHECK_CONTEXT || "Derived State Closure",
).trim();
const prNumber = String(process.env.PR_NUMBER || "").trim();

assert.match(repository, /^[^/]+\/[^/]+$/, "GITHUB_REPOSITORY must be owner/repo.");
assert.ok(token, "GH_TOKEN is required.");
assert.equal(
  branch,
  "main",
  "Generic generated follow-up auto-merge is permitted only for main.",
);
assert.match(expectedHead, /^[a-f0-9]{40}$/, "EXPECTED_HEAD_SHA must be a full SHA.");
assert.ok(requiredContext, "REQUIRED_CHECK_CONTEXT is required.");
if (prNumber) assert.match(prNumber, /^[1-9][0-9]*$/, "PR_NUMBER must be numeric.");

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
    throw new Error(
      `GitHub readiness readback failed for ${pathname || "repository"}: ${response.status}`,
    );
  }
  return payload;
}

function requiredChecksFromBranch(branchState) {
  const status = branchState.protection?.required_status_checks || {};
  return [
    ...(status.contexts || []),
    ...(status.checks || []).map((entry) => entry?.context).filter(Boolean),
  ];
}

function fail(status, message, details = {}) {
  const receipt = {
    contract: "github-followup-automerge-readiness.v1",
    repository,
    branch,
    expected_head_sha: expectedHead,
    required_check: requiredContext,
    safe_to_register_auto_merge: false,
    status,
    ...details,
    secrets_included: false,
  };
  process.stderr.write(`${JSON.stringify(receipt)}\n`);
  throw new Error(message);
}

const repositoryState = await github("");
const branchState = await github(`branches/${encodeURIComponent(branch)}`);
const requiredChecks = [...new Set(requiredChecksFromBranch(branchState))];
const observedHead = String(branchState.commit?.sha || "");
const enforcement = String(
  branchState.protection?.required_status_checks?.enforcement_level || "off",
);

if (repositoryState.allow_auto_merge !== true) {
  fail("blocked_repository_auto_merge_disabled", "Repository auto-merge is disabled.", {
    observed_head_sha: observedHead,
  });
}
if (branchState.protected !== true) {
  fail("blocked_unprotected_main", "main is not protected on GitHub.", {
    observed_head_sha: observedHead,
    branch_protected: false,
  });
}
if (enforcement === "off") {
  fail("blocked_required_status_enforcement_off", "Required status enforcement is disabled.", {
    observed_head_sha: observedHead,
    branch_protected: true,
    required_status_enforcement: enforcement,
  });
}
if (!requiredChecks.includes(requiredContext)) {
  fail(
    "blocked_required_check_missing",
    `${requiredContext} is not a required server-side check.`,
    {
      observed_head_sha: observedHead,
      branch_protected: true,
      required_status_enforcement: enforcement,
      observed_required_checks: requiredChecks,
    },
  );
}
if (observedHead !== expectedHead) {
  fail("blocked_stale_main", "main moved after the generated follow-up source was pinned.", {
    observed_head_sha: observedHead,
    branch_protected: true,
    required_status_enforcement: enforcement,
  });
}

let pr = null;
if (prNumber) {
  pr = await github(`pulls/${prNumber}`);
  if (pr.state !== "open" || pr.base?.ref !== "main") {
    fail("blocked_pr_state", "Follow-up PR is not an open PR targeting main.", {
      observed_head_sha: observedHead,
      followup_pr: Number(prNumber),
      followup_pr_state: pr.state || "unknown",
      followup_base_ref: pr.base?.ref || "",
    });
  }
  const labels = (pr.labels || []).map((entry) => String(entry?.name || "")).filter(Boolean);
  const blockingLabels = [
    "do-not-auto-merge",
    "manual-merge",
    "manual-review",
    "security-review",
  ].filter((label) => labels.includes(label));
  if (blockingLabels.length > 0) {
    fail("manual_review_required", "Manual-review objection blocks generated follow-up auto-merge.", {
      observed_head_sha: observedHead,
      followup_pr: Number(prNumber),
      blocking_labels: blockingLabels,
    });
  }
}

const receipt = {
  contract: "github-followup-automerge-readiness.v1",
  repository,
  branch,
  expected_head_sha: expectedHead,
  observed_head_sha: observedHead,
  allow_auto_merge: true,
  branch_protected: true,
  required_status_enforcement: enforcement,
  required_check: requiredContext,
  required_check_enforced: true,
  followup_pr: prNumber ? Number(prNumber) : null,
  manual_objection_present: false,
  safe_to_register_auto_merge: true,
  status: "ready",
  secrets_included: false,
};

process.stdout.write(`${JSON.stringify(receipt)}\n`);
