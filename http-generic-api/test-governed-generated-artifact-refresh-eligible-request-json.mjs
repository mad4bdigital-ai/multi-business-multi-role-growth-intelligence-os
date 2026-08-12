#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const workflowPath = "../.github/workflows/governed-generated-artifact-refresh-pr-target-bridge-v2.yml";
const workflow = fs.readFileSync(workflowPath, "utf8");

const fixedReasonExpression = "reason:(if ($reason | length) > 0 then $reason else null end)";
assert.match(
  workflow,
  /reason:\(if \(\$reason \| length\) > 0 then \$reason else null end\)/u,
  "eligible requests must encode an empty reason as null without filtering away the request object",
);
assert.doesNotMatch(
  workflow,
  /reason:\(\$reason\|select\(length>0\)\)/u,
  "request object generation must not use a select() that can suppress the complete eligible JSON object",
);

const jqProgram = `{contract:$contract,outcome:$outcome,${fixedReasonExpression},target_ref:$target_ref,expected_head_sha:$expected_head_sha,current_head_sha:$current_head_sha,pr_number:$pr_number,candidate_code_checkout:false,repository_mutation_performed:false,protected_branch_mutation:false,force_push:false,consult_job_logs:false,secrets_included:false}`;
const result = spawnSync("jq", [
  "-n",
  "--arg", "contract", "mad4b.governed-generated-artifact-refresh-request.v1",
  "--arg", "outcome", "eligible",
  "--arg", "reason", "",
  "--arg", "target_ref", "fix/example",
  "--arg", "expected_head_sha", "a".repeat(40),
  "--arg", "current_head_sha", "a".repeat(40),
  "--argjson", "pr_number", "6703",
  jqProgram,
], { encoding: "utf8" });

assert.equal(result.status, 0, result.stderr || "jq eligible request generation must succeed");
assert.ok(result.stdout.trim().length > 0, "eligible request generation must emit a JSON object");
const request = JSON.parse(result.stdout);
assert.equal(request.contract, "mad4b.governed-generated-artifact-refresh-request.v1");
assert.equal(request.outcome, "eligible");
assert.equal(request.reason, null);
assert.equal(request.target_ref, "fix/example");
assert.equal(request.expected_head_sha, "a".repeat(40));
assert.equal(request.current_head_sha, "a".repeat(40));
assert.equal(request.pr_number, 6703);
assert.equal(request.candidate_code_checkout, false);
assert.equal(request.repository_mutation_performed, false);
assert.equal(request.protected_branch_mutation, false);
assert.equal(request.force_push, false);
assert.equal(request.consult_job_logs, false);
assert.equal(request.secrets_included, false);

console.log("governed generated-artifact eligible request JSON regression passed");
