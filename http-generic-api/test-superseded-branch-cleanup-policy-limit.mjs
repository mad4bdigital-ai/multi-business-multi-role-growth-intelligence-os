import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/1008_sprint69_post_deploy_restart_and_superseded_cleanup_policy.sql", "utf8");
assert.match(migration, /superseded_branch_delete_max_ahead_commits/);
assert.match(migration, /30/);
for (const guard of [
  "requires_closed_pr",
  "requires_no_open_pr",
  "requires_main_ancestor_replacement",
  "requires_changed_file_coverage",
  "requires_fresh_sha_evidence",
  "requires_capability_envelope",
  "requires_same_cycle_readback",
]) assert.match(migration, new RegExp(`superseded_branch_delete_${guard}`));
assert.match(migration, /superseded_branch_delete_required_label/);
assert.match(migration, /superseded/);
assert.match(migration, /superseded_branch_delete_force_allowed/);
assert.match(migration, /superseded_branch_delete_generic_fallback_allowed/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
console.log("superseded branch cleanup policy limit tests passed");
