import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(runner, /257_sprint68_agent_runtime_ledger_readiness\.sql/);
assert.match(runner, /ALLOWED_MIGRATIONS/);

console.log("Agent runtime ledger readiness migration allowlist guard passed");
