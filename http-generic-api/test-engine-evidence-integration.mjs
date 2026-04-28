import { buildEngineEvidenceFromWorkflow } from "./execution.js";

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

const selectedWorkflowRow = {
  workflow_key: "wf_registered_logic_review",
  "Mapped Engine(s)": "review_governance_module; registry_validation_module; execution_log_validator"
};

const engineRegistryRows = [
  { engine_name: "review_governance_module", file_id: "FILE-ENG-001", status: "active", callable: "TRUE" },
  { engine_name: "registry_validation_module", file_id: "FILE-ENG-002", status: "active", callable: "TRUE" },
  { engine_name: "execution_log_validator", file_id: "FILE-ENG-003", status: "active", callable: "TRUE" }
];

const evidence = buildEngineEvidenceFromWorkflow({
  selectedWorkflowRow,
  engineRegistryRows
});

assert(
  "engine names derived from workflow row",
  evidence.used_engine_names === "review_governance_module|registry_validation_module|execution_log_validator",
  JSON.stringify(evidence)
);

assert(
  "engine refs derived from registry rows",
  evidence.used_engine_registry_refs === "review_governance_module|registry_validation_module|execution_log_validator",
  JSON.stringify(evidence)
);

assert(
  "engine file ids derived from registry rows",
  evidence.used_engine_file_ids === "FILE-ENG-001|FILE-ENG-002|FILE-ENG-003",
  JSON.stringify(evidence)
);

assert(
  "engine association becomes associated",
  evidence.engine_association_status === "associated",
  JSON.stringify(evidence)
);

assert(
  "engine resolution becomes resolved",
  evidence.engine_resolution_status === "resolved",
  JSON.stringify(evidence)
);

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
