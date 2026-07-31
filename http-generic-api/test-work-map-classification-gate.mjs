import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateClassificationReport } from "./scripts/work-map-classification-gate.mjs";

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixture({ tableName, entries = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-map-classification-"));
  write(root, "memory_schema.json", JSON.stringify({ type: "object", properties: {} }));
  write(root, "docs/work-maps/README.md", [
    "# Dynamic Platform Work Maps",
    "",
    "## Maps",
    "",
    "- [data model domain map](./data-model-domain-map.md)",
    "- [platform resource graph map](./platform-resource-graph-map.md)",
    "- [policy authority map](./policy-authority-map.md)",
    "",
  ].join("\n"));
  write(root, "http-generic-api/migrations/001_fixture.sql", `CREATE TABLE ${tableName} (id BIGINT PRIMARY KEY);\n`);
  write(root, ".specify/work-map-intentional-unclassified.json", JSON.stringify({
    schema_version: 1,
    policy_key: "work_map_intentional_unclassified_registry_v1",
    default_disposition: "forbidden",
    entries,
    secrets_included: false,
  }, null, 2));
  return root;
}

{
  const root = fixture({ tableName: "canonical_identifier_contract_registry" });
  const report = validateClassificationReport({ root, now: new Date("2026-07-31T00:00:00Z") });
  assert.equal(report.findings.length, 0);
  assert.equal(report.metrics.unresolved_unclassified_objects, 0);
  assert.equal(report.metrics.intentional_unclassified_objects, 0);
}

{
  const root = fixture({ tableName: "novel_unmapped_dimension_records" });
  const report = validateClassificationReport({ root, now: new Date("2026-07-31T00:00:00Z") });
  assert(report.findings.some((row) => row.type === "unresolved_schema_objects_forbidden"));
}

{
  const root = fixture({
    tableName: "novel_unmapped_dimension_records",
    entries: [{
      object_name: "novel_unmapped_dimension_records",
      object_type: "table",
      owner: "platform-architecture",
      rationale: "Temporary bounded exception while the closest existing maps are extended and reviewed.",
      nearest_existing_map_refs: [
        "docs/work-maps/data-model-domain-map.md",
        "docs/work-maps/platform-resource-graph-map.md"
      ],
      reviewed_reuse_options: [
        "reuse_existing_map",
        "extend_existing_map",
        "compose_existing_maps",
        "extend_existing_generator_or_taxonomy"
      ],
      approval_ref: "ARCH-EXCEPTION-001",
      expires_at: "2026-08-31",
      follow_up_gate: "work-map-taxonomy-closeout"
    }]
  });
  const report = validateClassificationReport({ root, now: new Date("2026-07-31T00:00:00Z") });
  assert.deepEqual(report.findings, []);
  assert.equal(report.metrics.intentional_unclassified_objects, 1);
}

{
  const root = fixture({
    tableName: "novel_unmapped_dimension_records",
    entries: [{
      object_name: "novel_unmapped_dimension_records",
      object_type: "table",
      owner: "platform-architecture",
      rationale: "Expired bounded exception retained only to prove the fail-closed expiry behavior.",
      nearest_existing_map_refs: [
        "docs/work-maps/data-model-domain-map.md",
        "docs/work-maps/policy-authority-map.md"
      ],
      reviewed_reuse_options: [
        "reuse_existing_map",
        "extend_existing_map",
        "compose_existing_maps",
        "extend_existing_generator_or_taxonomy"
      ],
      approval_ref: "ARCH-EXCEPTION-EXPIRED",
      expires_at: "2026-07-01",
      follow_up_gate: "work-map-taxonomy-closeout"
    }]
  });
  const report = validateClassificationReport({ root, now: new Date("2026-07-31T00:00:00Z") });
  assert(report.findings.some((row) => row.type === "intentional_entry_expired"));
}

console.log("work map classification gate tests passed");
