import assert from "node:assert/strict";
import fs from "node:fs/promises";

const migration = await fs.readFile(
  new URL("./migrations/1025_sprint69_growth_audit_evidence_admin_tenant_support.sql", import.meta.url),
  "utf8"
);
const routes = await fs.readFile(
  new URL("./routes/systemLayerRoutes.js", import.meta.url),
  "utf8"
);
const runtime = await fs.readFile(
  new URL("./growthAuditEvidence.js", import.meta.url),
  "utf8"
);

assert.match(migration, /growth_audit_evidence_v1/);
assert.match(migration, /growth_audit_evidence_prepare/);
assert.match(migration, /files\.object\.read/);
assert.match(migration, /'shadow'/);
assert.match(migration, /tenant_resource_grant_required/);
assert.match(migration, /visitor_issue_requires_rendered_visible/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /provider_calls_from_prepare',\s*TRUE/i);

assert.match(routes, /GROWTH_AUDIT_EVIDENCE_SYSTEM_TOOLS/);
assert.match(routes, /GrowthAuditEvidenceRuntime/);
assert.match(routes, /source_key:\s*"growth_audit_evidence_v1"/);
assert.match(runtime, /growth_audit_evidence_prepare/);
assert.match(runtime, /requires_admin:\s*true/);
assert.match(runtime, /tenant_brand_authority_required/);
assert.match(runtime, /visitor_issue_requires:\s*"rendered_visible"/);
assert.match(runtime, /native_edge_visual_capture_allowed:\s*false/);
assert.match(runtime, /provider_calls_made:\s*0/);
assert.match(runtime, /mutations_executed:\s*false/);
assert.match(runtime, /external_sends:\s*0/);
assert.match(runtime, /secrets_included:\s*false/);

console.log("growth audit descriptor and migration wiring tests passed");
