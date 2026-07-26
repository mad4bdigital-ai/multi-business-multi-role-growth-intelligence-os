import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(runner, /256_sprint68_dynamic_audit_pipeline_readiness\.sql/);
assert.match(runner, /314_sprint69_dynamic_audit_runtime_closure\.sql/);
assert.match(runner, /ALLOWED_MIGRATIONS/);

console.log("Dynamic audit readiness migration allowlist guard passed");
