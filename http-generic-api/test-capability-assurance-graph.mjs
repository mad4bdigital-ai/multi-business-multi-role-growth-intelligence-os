import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/313_sprint69_capability_assurance_graph.sql", import.meta.url), "utf8");
const reconciler = readFileSync(new URL("./scripts/platform-capability-assurance-reconcile.mjs", import.meta.url), "utf8");
const reports = readFileSync(new URL("./platformCapabilityReports.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const docs = readFileSync(new URL("../docs/platform-capability-assurance-graph.md", import.meta.url), "utf8");
const manifest = readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");

for (const table of ["platform_plugins","platform_plugin_capabilities","platform_plugin_bindings","platform_plugin_capability_exports",
 "platform_capability_source_links","platform_evidence_events","platform_capability_envelope_evidence_links",
 "platform_capability_envelope_binding_links","platform_capability_certifications","platform_capability_debt",
 "platform_closure_threads","platform_secret_movement_ledger"]) {
  assert.match(migration,new RegExp(`CREATE TABLE IF NOT EXISTS \\`${table}\\``),`${table} must be created`);
}
for (const view of ["v_effective_platform_resource_authority_bindings","v_platform_capability_readiness_vector",
 "v_platform_capability_assurance_gaps","v_platform_capability_assurance_summary"]) {
  assert.match(migration,new RegExp(`CREATE OR REPLACE VIEW \\`${view}\\``),`${view} must be created`);
}
for (const marker of ["no_provider_call=true","no_credential_payload_read=true","no_raw_secrets=true","no_external_send=true","no_external_write=true","secrets_included=false"])
  assert.match(migration,new RegExp(marker));
assert.doesNotMatch(migration,/\bDROP\s+(TABLE|DATABASE)|\bTRUNCATE\s+TABLE|\bDELETE\s+FROM/i);
assert.match(migration,/authority_requirement_type/);
assert.match(migration,/resource_binding_missing/);
assert.match(migration,/platform_capability_source_resolutions/);
assert.match(migration,/repo_capability_candidates/);
assert.match(migration,/platform_secret_promotion_policy_v1/);
assert.match(migration,/platform_capability_assurance_reconcile/);
assert.match(reconciler,/mode:"dry_run"/);
assert.match(reconciler,/--capability-envelope-id is required for --apply/);
assert.match(reconciler,/ready_for_dispatch/);
assert.match(reconciler,/provider_calls_made:0/);
assert.match(reconciler,/external_writes_made:0/);
assert.match(reconciler,/secrets_included:false/);
assert.doesNotMatch(reconciler,/fetch\(|axios|OPENAI_API_KEY|GITHUB_TOKEN|value_ciphertext/i);
assert.match(reports,/v_platform_capability_assurance_gaps/);
assert.match(routes,/platform_capability_assurance_reconcile/);
assert.match(docs,/Capability → Envelope → Evidence → Authority → Dispatch → Readback → Certification/);
assert.match(manifest,/test-capability-assurance-graph\.mjs/);
console.log("capability assurance graph tests passed");
