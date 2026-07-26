import assert from "node:assert/strict";

import {
  buildAuditResourceReadPlan,
  classifyAuditEvidence,
  normalizeAuditSiteUrl,
} from "./growthAuditEvidenceContracts.js";

assert.deepEqual(
  classifyAuditEvidence({
    source: "html",
    source_detected: true,
    rendered_attempted: true,
    rendered_visible: false,
  }),
  {
    classification: "hidden_template_fallback",
    report_as_visitor_issue: false,
    requires_visual_confirmation: true,
  }
);

assert.equal(
  classifyAuditEvidence({
    source: "browser",
    source_detected: true,
    rendered_attempted: true,
    rendered_visible: true,
  }).classification,
  "rendered_visible"
);
assert.equal(
  classifyAuditEvidence({ source: "brand_core" }).classification,
  "document_authority"
);
assert.equal(
  classifyAuditEvidence({ source: "implementation_tracker" }).classification,
  "tracker_state"
);
assert.equal(
  classifyAuditEvidence({
    source: "html",
    source_detected: true,
    rendered_attempted: false,
  }).report_as_visitor_issue,
  false
);

const docPlan = buildAuditResourceReadPlan(
  "https://docs.google.com/document/d/1GZY1HrAdXrhINX0jKXP3DRt7uKpK87TZkdX1ALl05J8/edit"
);
assert.equal(docPlan.detected_product, "google_docs");
assert.equal(docPlan.capability_key, "files.object.read");
assert.equal(docPlan.canonical_steps[1].endpoint_key, "drive_export_workspace_file");
assert.equal(docPlan.provider_call_executed, false);

const sheetPlan = buildAuditResourceReadPlan(
  "https://docs.google.com/spreadsheets/d/1aNkOT6BKVpjug80gu1PCLZ6I9qsXR7UHnFWtpUUPFGo/edit?gid=0"
);
assert.equal(sheetPlan.detected_product, "google_sheets");
assert.deepEqual(
  sheetPlan.canonical_steps.map((step) => step.endpoint_key),
  ["getSpreadsheet", "getSheetValues"]
);
assert.equal(sheetPlan.provider_call_executed, false);
assert.equal(normalizeAuditSiteUrl("www.donatours.com/plan-a-trip"), "https://donatours.com/");

console.log("growth audit evidence classification tests passed");
