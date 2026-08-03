#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL("../../.github/workflows/r5-trigger-metadata-diagnostic.yml", import.meta.url),
  "utf8",
);

assert.match(workflow, /name: R5 Trigger Metadata Diagnostic/);
assert.match(workflow, /pull_request:/);
assert.match(workflow, /gpt\/r5-trigger-metadata-diagnostic-20260803/);
assert.match(workflow, /actions:\s+read/);
assert.match(workflow, /issues:\s+write/);
assert.match(workflow, /hostinger-production-release-evidence-r5\.yml/);
assert.match(workflow, /event=issue_comment/);
assert.match(workflow, /R5_TRIGGER_METADATA_DIAGNOSTIC status=completed/);
assert.match(workflow, /secrets_included=false/);
assert.match(workflow, /actions\/upload-artifact@v4/);
assert.doesNotMatch(workflow, /actions:\s+write/);
assert.doesNotMatch(workflow, /\/dispatches|workflow_dispatch|repository_dispatch/);
assert.doesNotMatch(workflow, /HOSTINGER_API_TOKEN|developers\.hostinger\.com|auth\.mad4b\.com/);
assert.doesNotMatch(workflow, /\b(curl|wget|ssh|mysql|mariadb)\b/i);
assert.doesNotMatch(workflow, /git push|force-push|force_push|migration.*--apply|npm\s+start/i);
assert.doesNotMatch(workflow, /secrets\.[A-Za-z0-9_]+/);

const posts = workflow.match(/gh api --method POST/g) || [];
assert.equal(posts.length, 1, "diagnostic may publish exactly one bounded Issue comment");

console.log("R5 trigger metadata diagnostic contract passed.");
