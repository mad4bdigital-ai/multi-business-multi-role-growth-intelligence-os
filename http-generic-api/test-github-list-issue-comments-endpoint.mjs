import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/20260718_github_list_issue_comments_endpoint.sql", import.meta.url), "utf8");
const docs = readFileSync(new URL("../docs/github-rest-endpoint-dispatch.md", import.meta.url), "utf8");
const manifest = readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");

for (const marker of [
  "ACT-GH-REST-047", "github_list_issue_comments", "listIssueComments",
  "/repos/{owner}/{repo}/issues/{issue_number}/comments",
  "github_rest_endpoint_dispatch", "platform_endpoint_tool_exports",
  "platform_tool_dispatch_bindings", "github_issue_comments_read",
  "github_issue_comments_list_readback_v1", "method_and_path_from_endpoints_only",
  "caller_supplied_authorization_forbidden"
]) assert.ok(migration.includes(marker), `missing ${marker}`);

assert.match(migration, /'since','in','query'/);
assert.match(migration, /'page','in','query'/);
assert.match(migration, /'per_page','in','query'/);
assert.match(migration, /'maximum',100/);
assert.match(migration, /JSON_SEARCH\(/);
assert.match(migration, /JSON_ARRAY_APPEND\(/);
assert.match(migration, /ON DUPLICATE KEY UPDATE/g);

for (const marker of [
  "no_provider_call=true", "no_credential_payload_read=true", "no_raw_secrets=true",
  "no_external_send=true", "no_external_write=true", "secrets_included=false"
]) assert.ok(migration.includes(marker), `missing safety marker ${marker}`);

assert.doesNotMatch(migration, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);
assert.doesNotMatch(migration, /fetch\s*\(/);
assert.doesNotMatch(migration, /axios\s*\(/);
assert.match(docs, /github_list_issue_comments/);
assert.match(docs, /conversation comments/i);
assert.match(docs, /does not\s+read pull-request review comments/i);
assert.match(manifest, /test-github-list-issue-comments-endpoint\.mjs/);

console.log("github list issue comments endpoint tests passed");
