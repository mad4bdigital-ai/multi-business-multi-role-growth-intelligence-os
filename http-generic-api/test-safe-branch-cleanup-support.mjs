import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lifecycle = readFileSync(new URL("./githubRepositoryLifecycle.js", import.meta.url), "utf8");
const resolver = readFileSync(new URL("./scripts/capability-resolution-dry-run.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/316_sprint69_safe_branch_cleanup_support.sql", import.meta.url), "utf8");
const tools = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const guide = readFileSync(new URL("../AI_Agent_Knowledge_Guide.md", import.meta.url), "utf8");

assert.match(lifecycle, /repository\.payload\?\.default_branch/);
assert.match(lifecycle, /github_branch_delete_contains_unique_commits/);
assert.match(lifecycle, /aheadBy === 0/);
assert.match(lifecycle, /\["behind", "identical"\]\.includes\(compareStatus\)/);
assert.match(lifecycle, /validation_phase: "pre_delete_readback"/);
assert.match(lifecycle, /DEFAULT_DISPOSABLE_BRANCH_PREFIXES/);
assert.match(lifecycle, /merged_pull_request_cleanup: true/);

assert.match(resolver, /unique\(\[workspaceId, workspaceKey, tenantId, brandKey, appKey\]\)/);
assert.match(resolver, /tool_or_action_key IN/);
assert.match(resolver, /surface_key IN/);
assert.match(resolver, /expires_at IS NULL OR expires_at > NOW\(\)/);

assert.match(migration, /w\.workspace_id/);
assert.match(migration, /github_branch_delete_v1/);
assert.match(migration, /dispatch_allowed[\s\S]*?1,/);
assert.match(migration, /apply_allowed[\s\S]*?0,/);
assert.match(migration, /requires_no_unique_commits/);
assert.match(migration, /actual_default_branch_from_github/);

assert.match(tools, /proof of zero unique commits/);
assert.match(guide, /zero commits not already present in the default branch/);

console.log("safe branch cleanup support tests passed");
