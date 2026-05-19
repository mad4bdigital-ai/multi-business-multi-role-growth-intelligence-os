#!/usr/bin/env node
import { readFileSync } from "node:fs";

function assert(name, condition, details = "") {
  if (!condition) {
    console.error(`FAIL: ${name}${details ? ` — ${details}` : ""}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${name}`);
  }
}

const script = readFileSync("scripts/github-tooling-schema-smoke.mjs", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

assert("GitHub tooling smoke script is registered in package scripts",
  pkg.scripts?.["smoke:github-tooling-schema"] === "node scripts/github-tooling-schema-smoke.mjs");
assert("GitHub tooling smoke validates list pull requests array schema",
  script.includes("github_list_pull_requests") && script.includes("array response schema") && script.includes("type === \"array\""));
assert("GitHub tooling smoke validates create pull request 201 response",
  script.includes("github_create_pull_request") && script.includes("201") && script.includes("Created object response"));
assert("GitHub tooling smoke validates merge expected-head-sha policy export",
  script.includes("github_api_mcp__github_merge_pull_request") && script.includes("expected head sha"));
assert("GitHub tooling smoke validates update-branch and GraphQL tools",
  script.includes("github_update_pull_request_branch") && script.includes("github_graphql") && script.includes("GraphQL endpoint requires query body"));
assert("GitHub tooling smoke validates read-only secret-name tools",
  script.includes("github_list_repo_actions_secrets") &&
  script.includes("github_list_environment_actions_secrets") &&
  script.includes("Secret values are never returned"));
assert("GitHub tooling smoke validates workflow-specific and Git tree tools",
  script.includes("listWorkflowRunsForWorkflow") && script.includes("getGitTree"));
assert("GitHub tooling smoke is non-mutating and secret-safe",
  script.includes("writes_attempted: false") &&
  script.includes("secrets_included: false") &&
  !script.includes("create_pull_request(") &&
  !script.includes("mergePullRequest(") &&
  !script.includes("merge_method") &&
  !script.includes("method = \"POST\""));
assert("GitHub tooling smoke closes the DB pool so admin shell calls do not hang",
  script.includes("await pool.end()"));

if (process.exitCode) process.exit(process.exitCode);
