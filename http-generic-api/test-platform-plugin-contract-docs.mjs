import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationGuide = readFileSync("../docs/platform-plugin-contract-migration-guide.md", "utf8");
const resolverNotes = readFileSync("docs/platform-plugin-resolver-notes.md", "utf8");
const folderMap = readFileSync("../docs/folder-map.md", "utf8");
const changeGovernance = readFileSync("../docs/change-documentation-governance.md", "utf8");
const tenantGuide = readFileSync("docs/tenant-gpt-operating-guide.md", "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

for (const expected of [
  "MISSING_CAPABILITY_SELECTOR",
  "AMBIGUOUS_CAPABILITY_SELECTOR",
  "UNKNOWN_SECURITY_CONTRACT_FIELD",
  "security_decision_trace_public",
  "security_decision_trace_admin",
  "security_decision_metrics.v1",
  "Deprecation trigger",
  "full hardening plan is complete and CI evidence is green",
]) {
  assert(migrationGuide.includes(expected), `migration guide must include ${expected}`);
}

for (const expected of [
  "security_decision_trace_public",
  "security_decision_trace_admin",
  "security_decision.metrics",
  "invariant violation",
]) {
  assert(resolverNotes.includes(expected), `resolver notes must include ${expected}`);
}

assert(folderMap.includes("http-generic-api/src/domain/capability/"));
assert(folderMap.includes("SecurityDecision"));
assert(folderMap.includes("public/admin trace projection"));
assert(folderMap.includes("repository-level migration guide"));

assert(changeGovernance.includes("Platform Plugin resolve contract documentation rule"));
assert(changeGovernance.includes("legacy selector deprecation timeline"));
assert(changeGovernance.includes("Resolve remains preview/readiness only"));

assert(tenantGuide.includes("security_decision_trace_public"));
assert(tenantGuide.includes("Do not expose or infer admin-only trace detail"));
assert(tenantGuide.includes("not permission to execute a provider action"));

assert(manifest.includes("node test-platform-plugin-contract-docs.mjs"));

console.log("platform plugin contract docs tests passed");
