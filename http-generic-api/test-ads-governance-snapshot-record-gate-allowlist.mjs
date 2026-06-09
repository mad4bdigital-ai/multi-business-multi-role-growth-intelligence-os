import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(runner, /263_sprint68_ads_governance_snapshot_proposal\.sql/);
assert.match(runner, /264_sprint68_ads_governance_snapshot_record_gate\.sql/);
assert.match(runner, /ALLOWED_MIGRATIONS/);

console.log("Ads governance snapshot record gate allowlist guard passed");
