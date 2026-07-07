import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/20260707_repair_malformed_platform_pending_task.sql", import.meta.url),
  "utf8"
);

assert.match(
  migration,
  /task_key\s*=\s*'open_pr_platform_governance_codification_v3'/,
  "migration must target the exact malformed legacy task key"
);
assert.match(
  migration,
  /task_id\s*=\s*UUID\(\)/,
  "migration must assign a stable non-empty task_id"
);
assert.match(
  migration,
  /title\s*=\s*'OpenClaude provider bridge dry-run routes merged by PR #677'/,
  "migration must assign a non-empty human-readable title"
);
assert.match(
  migration,
  /status\s*=\s*'done'/,
  "completed open-PR work item must no longer remain pending or blocked"
);
assert.match(
  migration,
  /blocker_level\s*=\s*'none'/,
  "completed task must clear blocker_level"
);
assert.match(
  migration,
  /completed_at\s*=\s*COALESCE\(completed_at,\s*NOW\(\)\)/,
  "migration must preserve any existing completion timestamp"
);
assert.match(
  migration,
  /f5bc4d9dd509ae1467ff7a80657ae0acc9674f98/,
  "migration must keep source commit evidence"
);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE/i,
  "repair must be bounded data update only"
);
assert.doesNotMatch(
  migration,
  /(?:OPENAI|OPENROUTER|GEMINI|API[_-]?KEY|TOKEN|PASSWORD)\s*[=:]/i,
  "migration must not assign credential or secret-like values"
);

console.log("platform pending task source-data-quality repair test passed");
