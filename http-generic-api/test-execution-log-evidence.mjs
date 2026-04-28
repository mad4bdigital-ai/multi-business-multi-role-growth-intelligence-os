import { toExecutionLogUnifiedRow } from "./execution.js";

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

const row = toExecutionLogUnifiedRow({
  started_at: "2026-04-28T00:00:00.000Z",
  completed_at: "2026-04-28T00:00:01.000Z",
  duration_seconds: 1,
  entry_type: "sync_execution",
  execution_class: "sync",
  source_layer: "system_bootstrap",
  status: "success",
  output_summary: "ok",
  artifact_json_asset_id: "JSON-ASSET-1",
  target_module: "module_x",
  target_workflow: "wf_x",
  execution_trace_id: "trace_x",
  log_source: "surface.operations_log_unified_sheet",
  monitored_row: false,
  performance_impact_row: false,
  used_logic_id: "logic.pointer.test",
  used_logic_name: "Logic Pointer Test",
  resolved_logic_doc_id: "LOGIC_CANONICAL_001",
  resolved_logic_mode: "canonical",
  logic_pointer_resolution_status: "resolved",
  logic_knowledge_status: "ready",
  logic_rollback_status: "not_used",
  logic_association_status: "associated",
  used_engine_names: ["review_governance_module", "registry_validation_module"],
  used_engine_registry_refs: ["eng.review_governance_module", "eng.registry_validation_module"],
  used_engine_file_ids: ["file_review", "file_registry"],
  engine_resolution_status: "resolved",
  engine_association_status: "associated"
});

assert("used_logic_id is written", row.used_logic_id === "logic.pointer.test", JSON.stringify(row.used_logic_id));
assert("used_logic_name is written", row.used_logic_name === "Logic Pointer Test", JSON.stringify(row.used_logic_name));
assert("resolved_logic_doc_id is written", row.resolved_logic_doc_id === "LOGIC_CANONICAL_001", JSON.stringify(row.resolved_logic_doc_id));
assert("resolved_logic_mode is canonical", row.resolved_logic_mode === "canonical", JSON.stringify(row.resolved_logic_mode));
assert("logic_pointer_resolution_status is written", row.logic_pointer_resolution_status === "resolved", JSON.stringify(row.logic_pointer_resolution_status));
assert("logic_knowledge_status is written", row.logic_knowledge_status === "ready", JSON.stringify(row.logic_knowledge_status));
assert("logic_rollback_status is written", row.logic_rollback_status === "not_used", JSON.stringify(row.logic_rollback_status));
assert("logic_association_status is associated", row.logic_association_status === "associated", JSON.stringify(row.logic_association_status));
assert(
  "used_engine_names joins arrays with pipe",
  row.used_engine_names === "review_governance_module|registry_validation_module",
  JSON.stringify(row.used_engine_names)
);
assert(
  "used_engine_registry_refs joins arrays with pipe",
  row.used_engine_registry_refs === "eng.review_governance_module|eng.registry_validation_module",
  JSON.stringify(row.used_engine_registry_refs)
);
assert(
  "used_engine_file_ids joins arrays with pipe",
  row.used_engine_file_ids === "file_review|file_registry",
  JSON.stringify(row.used_engine_file_ids)
);
assert("engine_resolution_status is written", row.engine_resolution_status === "resolved", JSON.stringify(row.engine_resolution_status));
assert("engine_association_status is associated", row.engine_association_status === "associated", JSON.stringify(row.engine_association_status));

// normalizeResolvedLogicMode: only canonical valid values pass through
const rowBadMode = toExecutionLogUnifiedRow({
  started_at: "2026-04-28T00:00:00.000Z",
  resolved_logic_mode: "garbage_value"
});
assert("invalid resolved_logic_mode is blanked", rowBadMode.resolved_logic_mode === "", JSON.stringify(rowBadMode.resolved_logic_mode));

// normalizeAssociationStatus: unknown value falls back to "unknown"
const rowBadAssoc = toExecutionLogUnifiedRow({
  started_at: "2026-04-28T00:00:00.000Z",
  logic_association_status: "maybe"
});
assert("invalid logic_association_status falls back to unknown", rowBadAssoc.logic_association_status === "unknown", JSON.stringify(rowBadAssoc.logic_association_status));

// normalizeEvidenceList: string passthrough
const rowStringEngine = toExecutionLogUnifiedRow({
  started_at: "2026-04-28T00:00:00.000Z",
  used_engine_names: "single_engine"
});
assert("string used_engine_names passes through", rowStringEngine.used_engine_names === "single_engine", JSON.stringify(rowStringEngine.used_engine_names));

// retired shadow columns are always empty strings
assert("retired_shadow_target_module is empty", row.retired_shadow_target_module === "", JSON.stringify(row.retired_shadow_target_module));
assert("retired_shadow_performance_impact_row is empty", row.retired_shadow_performance_impact_row === "", JSON.stringify(row.retired_shadow_performance_impact_row));

// omitted logic fields default to empty / unknown
const rowNoLogic = toExecutionLogUnifiedRow({ started_at: "2026-04-28T00:00:00.000Z" });
assert("missing used_logic_id defaults to empty", rowNoLogic.used_logic_id === "", JSON.stringify(rowNoLogic.used_logic_id));
assert("missing logic_association_status defaults to unknown", rowNoLogic.logic_association_status === "unknown", JSON.stringify(rowNoLogic.logic_association_status));
assert("missing engine_association_status defaults to unknown", rowNoLogic.engine_association_status === "unknown", JSON.stringify(rowNoLogic.engine_association_status));

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
