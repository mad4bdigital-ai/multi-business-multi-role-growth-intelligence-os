import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveExactPlatformAuthorityExecutionScope } from "./scripts/capability-resolution-dry-run.mjs";
import { buildDryRunArgs, buildBindingContext } from "./scripts/capability-resolution-envelope-create.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const BRANCH_A = "gpt/019-governed-database-lifecycle-pressure-relief-20260807";
const BRANCH_B = "gpt/other-branch";

const bindings = [
  { binding_id: "binding-a", branch: BRANCH_A, expected_commit_sha: SHA_A },
];

{
  const exact = resolveExactPlatformAuthorityExecutionScope({
    bindings,
    resourceBranch: BRANCH_A,
    expectedCommitSha: SHA_A,
  });
  assert.equal(exact.ok, true);
  assert.equal(exact.branch, BRANCH_A);
  assert.equal(exact.expected_commit_sha, SHA_A);
  assert.equal(exact.binding_id, "binding-a");
}

{
  const mismatch = resolveExactPlatformAuthorityExecutionScope({
    bindings,
    resourceBranch: BRANCH_B,
    expectedCommitSha: SHA_A,
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "resource_branch_mismatch");
}

{
  const mismatch = resolveExactPlatformAuthorityExecutionScope({
    bindings,
    resourceBranch: BRANCH_A,
    expectedCommitSha: SHA_B,
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "expected_commit_sha_mismatch");
}

{
  const missing = resolveExactPlatformAuthorityExecutionScope({ bindings, resourceBranch: BRANCH_A });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "expected_commit_sha_missing_or_invalid");
}

{
  const derived = resolveExactPlatformAuthorityExecutionScope({ bindings, expectedCommitSha: SHA_A });
  assert.equal(derived.ok, true);
  assert.equal(derived.branch, BRANCH_A);
}

{
  const ambiguous = resolveExactPlatformAuthorityExecutionScope({
    bindings: [
      ...bindings,
      { binding_id: "binding-b", branch: BRANCH_B, expected_commit_sha: SHA_A },
    ],
    expectedCommitSha: SHA_A,
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, "resource_branch_ambiguous");
}

{
  const parsed = buildDryRunArgs([
    "--resource-branch", BRANCH_A,
    "--expected-commit-sha", SHA_A,
    "--resource-uri", "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  ]);
  assert.equal(parsed.resourceBranch, BRANCH_A);
  assert.equal(parsed.expectedCommitSha, SHA_A);

  const context = buildBindingContext([
    "--resource-branch", BRANCH_A,
    "--expected-commit-sha", SHA_A,
  ]);
  assert.equal(context.resource_branch, BRANCH_A);
  assert.equal(context.expected_commit_sha, SHA_A);
}

const guard = readFileSync(new URL("./capabilityResolutionEnvelopeGuard.js", import.meta.url), "utf8");
assert.match(guard, /capability_resolution_envelope_resource_branch_mismatch/);
assert.match(guard, /capability_resolution_envelope_commit_mismatch/);
assert.match(guard, /expected_branch_sha/);
assert.match(guard, /expected_base_sha/);
assert.match(guard, /exact_platform_authority_scope_matched/);

console.log("Platform resource authority branch/commit scope regression passed");
