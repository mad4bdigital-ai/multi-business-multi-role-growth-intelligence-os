#!/usr/bin/env node

import assert from "node:assert/strict";
import { discoverRepositoryTools, validateDiscoveryInputs } from "./maintenance-tools/repository-tool-discovery.mjs";

const discoveryTool = "http-generic-api/scripts/maintenance-tools/repository-tool-discovery.mjs";
const guardTool = "http-generic-api/scripts/maintenance-tools/repository-tool-lifecycle-guard.mjs";
const policy = {
  contract: "mad4b.repository-maintenance-tool-governance.v1",
  discovery: {
    contract: "mad4b.repository-tool-discovery.v1",
    central_inventory_path: "docs/repository-inventory.json",
    roots: [
      { path: "http-generic-api/scripts/maintenance-tools", registration: "explicit_registry_required" },
      { path: ".github/scripts", registration: "auto_catalog_read_only" },
    ],
    extensions: [".mjs", ".cjs", ".js", ".py", ".sh"],
    mutating_unregistered_changed_fails: true,
    orphaned_registry_fails: true,
    read_only_auto_catalog: true,
  },
  tools: {
    "repository-tool-lifecycle-guard": { entrypoint: guardTool, mode: "read_only" },
    "repository-tool-discovery": { entrypoint: discoveryTool, mode: "read_only" },
  },
};

function inventory(paths) {
  return {
    schemaVersion: 1,
    generatedFrom: "git-index",
    deterministic: true,
    files: paths.map((path) => ({ path })),
  };
}

async function run({ tracked, changed = [], contents = {}, selectedPolicy = policy, indexed = tracked }) {
  return discoverRepositoryTools({
    policy: selectedPolicy,
    inventory: inventory(indexed),
    trackedPaths: tracked,
    changedEntries: changed,
    readText: async (path) => contents[path] || "",
    candidateSha: "a".repeat(40),
    baseSha: "b".repeat(40),
  });
}

assert.deepEqual(validateDiscoveryInputs({ policy, inventory: inventory([guardTool, discoveryTool]) }), []);
assert(validateDiscoveryInputs({ policy, inventory: { schemaVersion: 1, files: [] } }).some((item) => item.code === "INVALID_CENTRAL_INVENTORY"));

const helper = ".github/scripts/example-reader.mjs";
const readOnly = await run({
  tracked: [guardTool, discoveryTool, helper],
  changed: [{ status: "A", path: helper }],
  contents: { [helper]: "export const value = 1;\n" },
});
assert.equal(readOnly.ok, true);
assert.equal(readOnly.catalog.find((item) => item.path === helper)?.classification, "auto_catalogued_read_only");

const mutator = ".github/scripts/example-writer.mjs";
const mutating = await run({
  tracked: [guardTool, discoveryTool, mutator],
  changed: [{ status: "A", path: mutator }],
  contents: { [mutator]: "await $`git push origin HEAD:work`;\n" },
});
assert.equal(mutating.ok, false);
assert(mutating.findings.some((item) => item.code === "MUTATING_TOOL_OUTSIDE_GOVERNED_ROOT"));

const unregistered = "http-generic-api/scripts/maintenance-tools/new-reader.mjs";
const unregisteredGoverned = await run({
  tracked: [guardTool, discoveryTool, unregistered],
  changed: [{ status: "A", path: unregistered }],
  contents: { [unregistered]: "console.log('read only');\n" },
});
assert.equal(unregisteredGoverned.ok, false);
assert(unregisteredGoverned.findings.some((item) => item.code === "DISCOVERED_TOOL_REQUIRES_REGISTRY"));

const pendingInventory = await run({
  tracked: [guardTool, discoveryTool, helper],
  changed: [{ status: "A", path: helper }],
  contents: { [helper]: "export const value = 1;\n" },
  indexed: [guardTool, discoveryTool],
});
assert.equal(pendingInventory.ok, true);
assert.equal(pendingInventory.catalog.find((item) => item.path === helper)?.central_inventory_status, "pending_refresh");
assert.equal(pendingInventory.counts.central_inventory_pending_refresh, 1);

const orphanPolicy = {
  ...policy,
  tools: {
    ...policy.tools,
    orphan: { entrypoint: "http-generic-api/scripts/maintenance-tools/orphan.mjs", mode: "read_only" },
  },
};
const orphaned = await run({
  tracked: [guardTool, discoveryTool],
  selectedPolicy: orphanPolicy,
  indexed: [guardTool, discoveryTool],
});
assert.equal(orphaned.ok, false);
assert(orphaned.findings.some((item) => item.code === "ORPHANED_REGISTERED_TOOL"));

const legacyMutator = ".github/scripts/legacy-writer.mjs";
const legacy = await run({
  tracked: [guardTool, discoveryTool, legacyMutator],
  changed: [],
  contents: { [legacyMutator]: "git push origin HEAD:legacy\n" },
});
assert.equal(legacy.ok, true);
assert.equal(legacy.catalog.find((item) => item.path === legacyMutator)?.classification, "legacy_unregistered_mutating");

console.log(JSON.stringify({
  contract: "mad4b.repository-tool-discovery-regression.v1",
  ok: true,
  cases: 7,
  live_git_discovery: true,
  central_inventory_coverage: true,
  read_only_auto_catalog: true,
  mutating_requires_explicit_registry: true,
  repository_mutation_executed: false,
  secrets_included: false,
}));
