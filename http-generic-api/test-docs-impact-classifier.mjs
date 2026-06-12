import assert from "node:assert/strict";
import {
  classifyChangedFiles,
  renderImpactMarkdown,
} from "./scripts/docs-impact-classifier.mjs";

const migrationImpact = classifyChangedFiles([
  "http-generic-api/migrations/208_sprint67_user_app_connection_runtime_collation_repair.sql",
]);
assert.equal(migrationImpact.risk, "high");
assert(migrationImpact.families.includes("database_migration"));
assert(migrationImpact.required_docs.includes("Updating Registry Patch Index.md"));
assert(migrationImpact.required_docs.includes("docs/change-documentation-governance.md"));
assert.equal(migrationImpact.secrets_included, false);
assert.equal(migrationImpact.should_generate, true);

const tenantImpact = classifyChangedFiles([
  "GPT_Tenant_Connector_Knowledge.md",
  "http-generic-api/routes/tenantLifecycleRoutes.js",
]);
assert(tenantImpact.families.includes("tenant_gpt"));
assert(tenantImpact.families.includes("runtime_routes"));
assert(tenantImpact.required_docs.includes("docs/tenant-gpt-operating-guide.md"));
assert(tenantImpact.docs_files_changed.includes("GPT_Tenant_Connector_Knowledge.md"));

const docsOnlyImpact = classifyChangedFiles([
  "docs/tenant-wordpress-validation-collation-repair-2026-06-06.md",
]);
assert.equal(docsOnlyImpact.docs_only, true);
assert.equal(docsOnlyImpact.risk, "low");
assert.equal(docsOnlyImpact.should_generate, false);
assert.equal(docsOnlyImpact.auto_merge_candidate, true);

const deploymentImpact = classifyChangedFiles([
  ".github/workflows/verify-runtime.yml",
  "http-generic-api/routes/healthRoutes.js",
]);
assert(deploymentImpact.families.includes("deployment_runtime"));
assert(deploymentImpact.required_docs.includes("deployment_parity_checklist.md"));
assert(deploymentImpact.required_docs.includes("docs/hostinger-node-deploy.md"));
assert.equal(deploymentImpact.risk, "high");

const markdown = renderImpactMarkdown(migrationImpact, { title: "Test Impact" });
assert(markdown.includes("# Test Impact"));
assert(markdown.includes("Updating Registry Patch Index.md"));
assert(markdown.includes("Secrets included: `false`"));
assert(!/api[_-]?key\s*=|password\s*=|secret\s*=/i.test(markdown));
assert(markdown.endsWith("\n"));
assert(!markdown.endsWith("\n\n"));

console.log("Docs impact classifier tests passed.");
