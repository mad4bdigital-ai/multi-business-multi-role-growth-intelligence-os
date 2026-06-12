import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const result = spawnSync("node", ["scripts/surface-contract-gap-triage.mjs"], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr || "triage script must run without generated-file writes");
const summary = JSON.parse(result.stdout);
assert.equal(summary.schema_version, "surface-contract-gap-triage-v1", "triage contract must be versioned");
assert.equal(summary.baseline_schema, "surface-contract-gap-baseline-v1", "baseline contract must be versioned");
assert.equal(summary.gate_schema, "surface-contract-new-gap-gate-v1", "new gap gate contract must be versioned");
assert.equal(summary.dashboard_schema, "surface-contract-governance-dashboard-v1", "dashboard contract must be versioned");
assert.equal(summary.compact_schema, "surface-contract-governance-compact-v1", "compact dashboard contract must be versioned");
assert.equal(summary.trend_schema, "surface-contract-gap-trends-v1", "trend contract must be versioned");
assert.equal(summary.trend_gate_schema, "surface-contract-trend-quality-gate-v1", "trend quality gate contract must be versioned");
assert(summary.triaged_items > 0, "triage must classify queue items");
assert.equal(summary.secrets_included, false, "triage summary must not include secrets");

const script = fs.readFileSync("scripts/surface-contract-gap-triage.mjs", "utf8");
assert(script.includes("surface-contract-gap-triage-v1"), "triage script must define triage schema");
assert(script.includes("surface-contract-gap-baseline-v1"), "triage script must define baseline schema");
assert(script.includes("surface-contract-new-gap-gate-v1"), "triage script must define new gap gate schema");
assert(script.includes("surface-contract-governance-dashboard-v1"), "triage script must define dashboard schema");
assert(script.includes("surface-contract-gap-trends-v1"), "triage script must define trend schema");
assert(script.includes("new_gaps_only"), "gate must be scoped to new gaps only");
assert(script.includes("external_sends: false"), "triage safety must forbid external sends");
assert(script.includes("writes_database: false"), "triage safety must forbid DB writes");
assert(script.includes("deploys: false"), "triage safety must forbid deploys");

const maintenanceSync = fs.readFileSync("scripts/repo-maintenance-sync.mjs", "utf8");
assert(maintenanceSync.includes("surface-contract-gap-triage.mjs"), "maintenance sync must run surface gap triage");
assert(maintenanceSync.includes("--enforce-new-gaps"), "maintenance sync must enforce new high/critical gaps only through baseline");

console.log("surface contract governance loop guard passed");
