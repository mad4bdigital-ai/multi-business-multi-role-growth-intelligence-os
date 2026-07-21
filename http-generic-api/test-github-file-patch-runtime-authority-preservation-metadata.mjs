import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("./migrations/20260721_github_file_patch_runtime_authority_preservation_metadata.sql", import.meta.url),
  "utf8",
);
const route = fs.readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const spec = fs.readFileSync(
  new URL("../docs/spec007-github-file-patch-shadow-certification.md", import.meta.url),
  "utf8",
);
const assurance = fs.readFileSync(
  new URL("../docs/platform-capability-assurance-graph.md", import.meta.url),
  "utf8",
);

for (const marker of [
  "runtime_authority_mode",
  "preserve_current_snapshot",
  "runtime_authority_snapshot_in_plan_hash",
  "runtime_authority_snapshot_verified_after_apply",
  "github_file_patch_shadow_certification_issue_apply_v1",
  "github_file_patch_shadow_certification_issue_policy_v1",
  "no_runtime_dispatch_change=true",
  "no_runtime_apply_change=true",
  "no_active_target_export_creation=true",
  "no_tenant_authority_change=true",
  "secrets_included=false",
]) {
  assert(migration.includes(marker), `missing metadata-preservation marker: ${marker}`);
}

assert.equal((migration.match(/\bUPDATE\b/g) || []).length, 4);
for (const forbidden of [
  /UPDATE\s+runtime_dispatch_certification_registry/i,
  /UPDATE\s+platform_plugin_capability_exports/i,
  /UPDATE\s+platform_tool_dispatch_bindings/i,
  /INSERT\s+INTO\s+runtime_dispatch_certification_registry/i,
  /INSERT\s+INTO\s+platform_plugin_capability_exports/i,
  /https?:\/\//i,
]) {
  assert.equal(forbidden.test(migration), false, `forbidden migration operation: ${forbidden}`);
}

assert(route.includes("preserves the existing target runtime dispatch and apply snapshot unchanged"));
assert.equal(route.includes("keeps target runtime dispatch and apply blocked"), false);
assert(spec.includes("Keep the existing `runtime_dispatch_certification_registry` snapshot unchanged"));
assert(assurance.includes("preserves the pre-existing specialized runtime-certification snapshot unchanged"));

console.log("github file patch runtime-authority preservation metadata tests passed");
