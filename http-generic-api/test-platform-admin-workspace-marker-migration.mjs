import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./migrations/20260728_platform_admin_workspace_marker.sql", import.meta.url),
  "utf8",
);

assert.equal((source.match(/\bUPDATE\s+workspace_registry\b/gi) || []).length, 1);
assert.match(source, /\bJSON_SET\s*\(/i);
assert.match(source, /'\$\.authority_scope_key'\s*,\s*'platform:root'/i);
assert.match(source, /'\$\.platform_admin_workspace'\s*,\s*TRUE/i);
assert.match(source, /workspace_id\s*=\s*'b50db01b-617e-4b7a-8bda-6bf4876f754f'/i);
assert.match(source, /tenant_id\s*=\s*'00000000-0000-0000-0000-000000000000'/i);
assert.match(source, /workspace_key\s*=\s*'platform_repo_governance_zero'/i);
assert.doesNotMatch(source, /\b(?:DELETE|DROP|TRUNCATE|ALTER)\b/i);

console.log("platform admin workspace marker migration test: ok");
