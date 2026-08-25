#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const workflowPath = "../.github/workflows/governed-generated-artifact-refresh.yml";
const workflow = fs.readFileSync(workflowPath, "utf8");
const schemaDocsGuard = fs.readFileSync("scripts/schema-docs-change-guard.mjs", "utf8");

assert.match(workflow, /^name:\s*Governed Generated Artifact Refresh$/mu);
assert.match(
  workflow,
  /^run-name:\s*Governed Generated Artifact Refresh · \$\{\{ inputs\.recipe \}\} · \$\{\{ inputs\.target_ref \}\} · \$\{\{ inputs\.expected_head_sha \}\}$/mu,
  "writer runs must expose target branch and exact SHA for direct observability",
);
assert.match(workflow, /^\s*workflow_dispatch:\s*$/mu);
assert.doesNotMatch(workflow, /^\s*(?:push|pull_request|pull_request_target):\s*$/mu);
assert.match(workflow, /actions:\s*write/u);
assert.match(workflow, /contents:\s*write/u);
assert.match(
  workflow,
  /group:\s*governed-generated-artifact-refresh-\$\{\{ inputs\.target_ref \}\}/u,
  "writer concurrency must remain isolated per target branch",
);
assert.match(
  workflow,
  /cancel-in-progress:\s*true/u,
  "the latest exact-head request must supersede stale queued or running requests for the same branch",
);
assert.doesNotMatch(
  workflow,
  /cancel-in-progress:\s*false/u,
  "stale generated-artifact requests must not form an unbounded branch queue",
);
assert.match(
  workflow,
  /OUTPUT_DIR:\s*\.ci-evidence\/governed-generated-artifact-refresh/u,
  "writer must use a stable repository-relative evidence directory",
);
assert.doesNotMatch(
  workflow,
  /\$\{\{\s*runner\.temp\s*\}\}/u,
  "jobs-level environment must not reference the unavailable runner context",
);
assert.match(workflow, /APPLY_GENERATED_ARTIFACT_REFRESH/u);
assert.match(workflow, /main.*Production/u);
assert.match(workflow, /expected_head_sha/u);
assert.match(workflow, /Require trusted repository writer identity/u, "writer must fail before checkout when the trusted repository credential is unavailable");
assert.match(workflow, /REPO_AUTOSYNC_TOKEN is required for governed generated-artifact repository writes/u);
const trustedSecretRefs = workflow.match(/\$\{\{\s*secrets\.REPO_AUTOSYNC_TOKEN\s*\}\}/gu) ?? [];
assert.ok(trustedSecretRefs.length >= 4, "branch APIs, checkout, and verifier dispatch must share the scoped repository writer identity");
const trustedGhTokenRefs = workflow.match(/GH_TOKEN:\s*\$\{\{\s*secrets\.REPO_AUTOSYNC_TOKEN\s*\}\}/gu) ?? [];
assert.ok(trustedGhTokenRefs.length >= 2, "all GitHub API mutation/dispatch calls must use the scoped repository writer identity");
assert.match(
  workflow,
  /token:\s*\$\{\{\s*secrets\.REPO_AUTOSYNC_TOKEN\s*\}\}/u,
  "checkout must persist the scoped repository writer identity used by the generated-artifact tool push",
);
assert.match(workflow, /persist-credentials:\s*true/u);
assert.doesNotMatch(
  workflow,
  /\$\{\{\s*github\.token\s*\}\}/u,
  "github.token must not be a repository-writer or verification-dispatch fallback",
);
assert.doesNotMatch(
  workflow,
  /\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/u,
  "GITHUB_TOKEN must not be a repository-writer fallback",
);
assert.match(workflow, /maintenance-tools\/generated-artifact-refresh\.mjs/u);
assert.match(workflow, /--output-dir "\$\{OUTPUT_DIR\}"/u);
assert.match(workflow, /remote_mcp_write_scope_refresh/u);
assert.match(workflow, /remote-mcp-write-scope-verification\.yml/u);
assert.match(workflow, /verifier_workflows=\("repository-inventory\.yml" "repository-evaluation\.yml"\)/u);
assert.match(workflow, /verifier_workflows=\("remote-mcp-write-scope-verification\.yml"\)/u);
assert.match(workflow, /verifier_workflows=\("pr-generated-artifact-refresh\.yml"\)/u);
assert.match(workflow, /actions\/workflows\/\$\{verifier_workflow\}\/dispatches/u);
assert.match(workflow, /generated-artifact-refresh-verification-dispatch\.json/u);
assert.match(workflow, /path:\s*\$\{\{ env\.OUTPUT_DIR \}\}\//u);
assert.doesNotMatch(
  workflow,
  /\bgit\s+push[^\n]*(?:--force(?:-with-lease)?|\s-f(?:\s|$))/u,
  "workflow must not contain a force-push command",
);

// Exact-main branch creation is a distributed GitHub API operation. A newly
// created ref may not be readable on the immediately following request, so the
// writer must distinguish true absence from other API failures and settle the
// ref through a bounded exact-SHA readback instead of producing a false red.
assert.match(workflow, /Initialize bounded refresh evidence/u, "early preflight evidence must exist before any mutable preflight can fail");
assert.match(workflow, /generated-artifact-refresh-preflight\.json/u, "early failures must still leave an auditable artifact payload");
assert.match(workflow, /remote_write_executed:false/u, "preflight evidence must not claim a repository write");
assert.match(workflow, /HTTP 404\|Not Found/u, "only an explicit not-found response may be interpreted as an absent target branch");
assert.match(workflow, /non-404 error; refusing to infer absence/u, "non-404 lookup failures must remain fail-closed");
assert.match(workflow, /for attempt in \$\(seq 1 8\)/u, "post-create ref visibility must use a bounded retry window");
assert.match(workflow, /sleep "\$attempt"/u, "bounded readback retries must back off rather than spin");
assert.match(workflow, /Target ref resolved to unexpected SHA during readback/u, "a visible but wrong target SHA must fail immediately");
assert.match(workflow, /Target ref did not converge to expected SHA after bounded readback retries/u, "an invisible or unresolved target ref must fail after the bounded window");
assert.match(workflow, /Target ref create returned status .* requiring bounded exact-SHA readback/u, "a create collision may only settle through exact-SHA readback");

assert.ok(
  schemaDocsGuard.includes("^http-generic-api\\/scripts\\/test-.*\\.mjs$"),
  "schema/docs coverage must recognize repository-maintenance tests under http-generic-api/scripts/test-*",
);

console.log(JSON.stringify({
  ok: true,
  gate: "governed_generated_artifact_refresh_apply_context",
  contract: "mad4b.governed-generated-artifact-refresh.v1",
  cases: 41,
  workflow_dispatch_only: true,
  exact_run_identity_visible: true,
  stale_requests_cancelled: true,
  trusted_repository_writer_identity: true,
  github_token_writer_fallback: false,
  remote_mcp_write_scope_recipe_registered: true,
  scripts_test_coverage_registered: true,
  bounded_ref_readback: true,
  non_404_absence_inference: false,
  preflight_evidence_initialized: true,
  jobs_level_runner_context_used: false,
  protected_branch_mutation: false,
  force_push: false,
  secrets_included: false,
}));
