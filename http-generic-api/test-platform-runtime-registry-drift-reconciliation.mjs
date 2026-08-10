import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("./migrations/20260810_platform_runtime_registry_drift_reconciliation.sql", import.meta.url),
  "utf8",
);

for (const invariant of [
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "no_runtime_dispatch=true",
  "secrets_included=false",
]) assert.match(migration, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

assert.match(migration, /INSERT INTO platform_plugins/);
assert.match(migration, /'semantic_capability_registry'/);
assert.match(migration, /INSERT INTO platform_plugin_capabilities/);
assert.match(migration, /dispatch_allowed, apply_allowed/);
assert.match(migration, /\n  0,\n  0,\n  s\.requires_audit_evidence/);
assert.match(migration, /INSERT INTO platform_capability_source_links/);
assert.match(migration, /'semantic_registry'/);
assert.match(migration, /mapping_mode','exact_capability_key'/);
assert.match(migration, /CREATE OR REPLACE VIEW v_platform_semantic_capability_canonical_reconciliation/);
assert.match(migration, /semantic_source_link_missing/);
assert.match(migration, /resource_authority_underclassified/);
assert.match(migration, /approval_underclassified/);
assert.match(migration, /audit_evidence_underclassified/);
assert.match(migration, /readback_underclassified/);

assert.match(migration, /bind_wordpress_rest_wordpress_api/);
assert.match(migration, /bind_tool_wordpress_publish_authority_diagnostic/);
assert.match(migration, /wordpress_publish_authority_diagnostic/);
assert.match(migration, /semantic_shadow__content_article_create_draft__wordpress/);
assert.match(migration, /export_status, exposure_scope/);
assert.match(migration, /'shadow',\n  'tenant'/);
assert.match(migration, /CREATE OR REPLACE VIEW v_wordpress_registry_runtime_reconciliation/);

// The repair must not turn the shadow WordPress draft binding into a live endpoint tool export.
assert.doesNotMatch(migration, /INSERT INTO platform_endpoint_tool_exports[\s\S]{0,2000}wordpress/iu);
assert.doesNotMatch(migration, /UPDATE\s+platform_capability_provider_bindings[\s\S]{0,1000}rollout_mode\s*=\s*['"](?:active|canary|ready|live)['"]/iu);
assert.doesNotMatch(migration, /UPDATE\s+platform_plugin_capabilities[\s\S]{0,1000}(?:dispatch_allowed|apply_allowed)\s*=\s*1/iu);

console.log("platform runtime/registry drift reconciliation migration tests passed");
