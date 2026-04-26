import {
  detectRepurposedRegistryRows,
  validateRegistryAlignment
} from "./registryAlignmentValidator.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`[PASS] ${label}`);
    passed++;
  } else {
    console.error(`[FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

{
  const result = validateRegistryAlignment({
    "Workflow Registry!A1:AZ20": [
      [],
      Array(25).fill(""),
      (() => {
        const row = Array(25).fill("");
        row[24] = "seo_strategy_workflow";
        return row;
      })()
    ],
    "Knowledge Graph Node Registry!A1:J20": [
      [],
      ["starter.create_seo_roadmap"],
      ["goal.seo_goal"]
    ],
    "Execution Chains Registry!A1:J20": [
      [],
      ["CH-001", "", "", "", "", "wf_growth_strategy"]
    ],
    "Relationship Graph Registry!A1:J20": [
      [],
      ["rel-1", "starter.create_seo_roadmap", "triggers", "workflow.wf_seo_strategy"]
    ]
  });

  assert(
    "detects mismatched workflow references",
    result.valid === false && result.mismatch_count >= 2,
    JSON.stringify(result)
  );
}

{
  const workflowRow = Array(25).fill("");
  workflowRow[24] = "seo_strategy_workflow";

  const result = validateRegistryAlignment({
    "Workflow Registry!A1:AZ20": [[], workflowRow],
    "Knowledge Graph Node Registry!A1:J20": [
      [],
      ["starter.create_seo_roadmap"],
      ["goal.seo_goal"]
    ],
    "Execution Chains Registry!A1:J20": [
      [],
      ["CH-001", "", "", "", "", "seo_strategy_workflow"]
    ],
    "Relationship Graph Registry!A1:J20": [
      [],
      ["rel-1", "starter.create_seo_roadmap", "aligned_with", "goal.seo_goal"]
    ]
  });

  assert("accepts aligned references", result.valid === true, JSON.stringify(result));
}

{
  const endpointRows = [
    [
      "endpoint_id",
      "parent_action_key",
      "endpoint_key",
      "endpoint_operation",
      "route_target",
      "openai_action_name",
      "provider_domain",
      "method",
      "endpoint_path_or_function"
    ],
    [
      "bad-google-row",
      "google_sheets_api",
      "getSheetValues",
      "getDocument",
      "google_docs_api",
      "getDocument",
      "docs.googleapis.com",
      "GET",
      "/v1/documents/{documentId}"
    ]
  ];

  const drift = detectRepurposedRegistryRows(endpointRows);
  assert(
    "detects repurposed endpoint registry rows",
    drift.length === 1 && drift[0].consistency.mismatches.length >= 1,
    JSON.stringify(drift)
  );

  const result = validateRegistryAlignment({
    "Workflow Registry!A1:AZ20": [[]],
    "Knowledge Graph Node Registry!A1:J20": [[]],
    "Execution Chains Registry!A1:J20": [[]],
    "Relationship Graph Registry!A1:J20": [[]],
    "API Actions Endpoint Registry!A1:BA20": endpointRows
  });

  assert(
    "alignment audit reports endpoint binding mismatch",
    result.valid === false &&
      result.mismatches.some(item => item.type === "endpoint_binding_mismatch"),
    JSON.stringify(result)
  );
}

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
