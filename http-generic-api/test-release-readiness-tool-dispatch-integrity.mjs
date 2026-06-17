import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("releaseReadiness.js", "utf8");
assert.match(source, /311_sprint69_platform_tool_dispatch_binding_integrity\.sql/);
assert.match(source, /312_sprint69_platform_tool_dispatch_integrity_scope_fix\.sql/);
assert.match(source, /7bb6d1a934d3504682303894b8bf1b95ed2d2e383c629a2838ecf1f4f7911216/);
assert.match(source, /e64c8068e49266c1e630ae2b8b5f38778a0d642f0ba4287ff43ce2a26d600ed8/);
assert.match(source, /ORDER BY applied_at DESC LIMIT 1/);
assert.match(source, /required_checksum_mismatches/);
assert.match(source, /checkPlatformToolDispatchBindingIntegrity/);
assert.match(source, /FROM v_platform_tool_dispatch_integrity/);
assert.match(source, /parent_action_key = 'github_api_mcp'/);
assert.match(source, /result\.binding_count === 14/);
assert.match(source, /tool_dispatch_binding_healthy_count/);
assert.match(source, /tool_dispatch_binding_gap_count/);
console.log("release readiness tool-dispatch integrity tests passed");
