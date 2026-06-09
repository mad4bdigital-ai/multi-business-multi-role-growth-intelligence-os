import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(runner, /260_sprint68_platform_development_constitution_policies\.sql/);
assert.match(runner, /261_sprint68_orchestration_intelligence_foundation\.sql/);
assert.match(runner, /262_sprint68_orchestration_readback_surface\.sql/);
assert.match(runner, /ALLOWED_MIGRATIONS/);

console.log("Orchestration migration allowlist guard passed");
