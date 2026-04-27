/**
 * Logic switching smoke test
 *
 * Proves the runtime switching path defined in:
 *   canonicals/system_bootstrap/01_logic_pointer_knowledge.md
 *
 * Run: node test-logic-switching-smoke.mjs
 */

import {
  resolveLogicPointerContext,
  guardDirectLegacyExecution
} from "./resolveLogicPointerContext.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CANONICAL_ROW = {
  canonical_status:  "canonical_active",
  active_pointer:    "canonical_active",
  canonical_doc_id:  "LOGIC_CANONICAL_001",
  legacy_doc_id:     "LOGIC_LEGACY_001",
  rollback_available: false
};

const ROLLBACK_ROW = {
  canonical_status:  "canonical_active",
  active_pointer:    "canonical_active",
  canonical_doc_id:  "LOGIC_CANONICAL_001",
  legacy_doc_id:     "LOGIC_LEGACY_001",
  rollback_available: true
};

const LEGACY_POINTER_ROW = {
  canonical_status:  "legacy_recovery",
  active_pointer:    "legacy_recovery",
  canonical_doc_id:  "",
  legacy_doc_id:     "LOGIC_LEGACY_001",
  rollback_available: false
};

const COMPLETE_KNOWLEDGE_PROFILE = {
  knowledge_profile_key: "profile_logic_001",
  required_knowledge_layers: ["brand_core", "execution_policy"],
  knowledge_read_targets: ["Brand Core Registry", "Execution Policy Registry"],
  knowledge_read_completeness_status: "validated",
  missing_required_knowledge_sources: []
};

const INCOMPLETE_KNOWLEDGE_PROFILE = {
  knowledge_profile_key: "profile_logic_001",
  required_knowledge_layers: ["brand_core", "execution_policy"],
  knowledge_read_targets: ["Brand Core Registry", "Execution Policy Registry"],
  knowledge_read_completeness_status: "degraded",
  missing_required_knowledge_sources: ["Brand Core Registry"]
};

// ---------------------------------------------------------------------------
// Case 1 — Canonical pointer wins; legacy is not used
// ---------------------------------------------------------------------------
section("Case 1 — canonical pointer wins");

{
  const result = resolveLogicPointerContext(
    { logic_id: "logic_001" },
    { getPointerRow: () => CANONICAL_ROW }
  );

  assert("ok = true",                result.ok === true,                    JSON.stringify(result));
  assert("resolved doc = LOGIC_CANONICAL_001",
    result.state.resolved_logic_doc_id === "LOGIC_CANONICAL_001",          result.state.resolved_logic_doc_id);
  assert("resolved mode = canonical",
    result.state.resolved_logic_doc_mode === "canonical",                   result.state.resolved_logic_doc_mode);
  assert("legacy doc NOT selected",
    result.state.resolved_logic_doc_id !== "LOGIC_LEGACY_001",             result.state.resolved_logic_doc_id);
  assert("logic_pointer_surface_id preserved",
    result.state.logic_pointer_surface_id === "surface.logic_canonical_pointer_registry",
    result.state.logic_pointer_surface_id);
  assert("logic_pointer_resolution_status = validated",
    result.state.logic_pointer_resolution_status === "validated",           result.state.logic_pointer_resolution_status);
  assert("resolved_logic_doc_id field present",
    "resolved_logic_doc_id" in result.state,                               "field missing");
  assert("resolved_logic_doc_mode field present",
    "resolved_logic_doc_mode" in result.state,                             "field missing");
  assert("canonical_status field present",
    "canonical_status" in result.state,                                    "field missing");
  assert("active_pointer field present",
    "active_pointer" in result.state,                                      "field missing");
}

// ---------------------------------------------------------------------------
// Case 2 — Legacy blocked when canonical pointer is active and no rollback
// ---------------------------------------------------------------------------
section("Case 2 — legacy blocked without rollback");

{
  // guardDirectLegacyExecution: canonical active, no rollback auth
  const guard = guardDirectLegacyExecution(CANONICAL_ROW, false);
  assert("direct legacy execution blocked",
    guard.blocked === true,                                                 JSON.stringify(guard));
  assert("block reason references canonical pointer authority",
    typeof guard.reason === "string" && guard.reason.includes("canonical_pointer"),
    guard.reason);

  // resolveLogicPointerContext: if caller tries legacy directly, result is canonical, not legacy
  const result = resolveLogicPointerContext(
    { logic_id: "logic_001" },
    { getPointerRow: () => CANONICAL_ROW }
  );
  assert("resolver returns canonical, not legacy, when pointer is active",
    result.state.resolved_logic_doc_mode === "canonical",                  result.state.resolved_logic_doc_mode);
  assert("legacy doc id not in resolved_logic_doc_id",
    result.state.resolved_logic_doc_id !== "LOGIC_LEGACY_001",            result.state.resolved_logic_doc_id);
}

// ---------------------------------------------------------------------------
// Case 3 — Governed rollback permits legacy fallback
// ---------------------------------------------------------------------------
section("Case 3 — governed rollback permits legacy fallback");

{
  const result = resolveLogicPointerContext(
    { logic_id: "logic_001" },
    {
      getPointerRow:       () => ROLLBACK_ROW,
      isRollbackAuthorized: () => true
    }
  );

  assert("ok = true with rollback",
    result.ok === true,                                                     JSON.stringify(result));
  assert("rollback_available = true preserved",
    result.state.rollback_available === true,                              String(result.state.rollback_available));
  assert("resolved mode = legacy_recovery",
    result.state.resolved_logic_doc_mode === "legacy_recovery",           result.state.resolved_logic_doc_mode);
  assert("legacy doc id selected under rollback",
    result.state.resolved_logic_doc_id === "LOGIC_LEGACY_001",            result.state.resolved_logic_doc_id);
  assert("pointer evidence still preserved",
    result.state.logic_pointer_surface_id === "surface.logic_canonical_pointer_registry" &&
    "canonical_status" in result.state && "active_pointer" in result.state,
    JSON.stringify(result.state));

  // rollback still blocked when rollback_available=false and no auth
  const guardNoAuth = guardDirectLegacyExecution(CANONICAL_ROW, false);
  assert("legacy still blocked without authorization even if row exists",
    guardNoAuth.blocked === true,                                          JSON.stringify(guardNoAuth));
}

// ---------------------------------------------------------------------------
// Case 4 — Missing pointer state degrades cleanly
// ---------------------------------------------------------------------------
section("Case 4 — missing pointer state degrades cleanly");

{
  // Pointer registry missing (getPointerRow returns null)
  const result = resolveLogicPointerContext(
    { logic_id: "logic_unknown" },
    { getPointerRow: () => null }
  );

  assert("ok = false when pointer unresolved",
    result.ok === false,                                                    JSON.stringify(result));
  assert("not classified as canonical success",
    result.state.resolved_logic_doc_mode !== "canonical",                  result.state.resolved_logic_doc_mode);
  assert("resolution status is degraded",
    result.state.logic_pointer_resolution_status === "degraded",           result.state.logic_pointer_resolution_status);
  assert("blocked_reason present",
    typeof result.blocked_reason === "string" && result.blocked_reason.length > 0,
    result.blocked_reason);

  // No dep injected at all
  const resultNoDep = resolveLogicPointerContext({ logic_id: "logic_unknown" }, {});
  assert("ok = false when registry dep missing",
    resultNoDep.ok === false,                                              JSON.stringify(resultNoDep));
  assert("resolution status blocked when dep missing",
    resultNoDep.state.logic_pointer_resolution_status === "blocked",       resultNoDep.state.logic_pointer_resolution_status);
}

// ---------------------------------------------------------------------------
// Case 5 — Knowledge profile resolves AFTER pointer, gates completion
// ---------------------------------------------------------------------------
section("Case 5 — knowledge profile chained after pointer resolution");

{
  const callOrder = [];

  const result = resolveLogicPointerContext(
    { logic_id: "logic_001", require_knowledge: true },
    {
      getPointerRow: (id) => {
        callOrder.push("pointer:" + id);
        return CANONICAL_ROW;
      },
      getKnowledgeProfile: (id) => {
        callOrder.push("knowledge:" + id);
        return COMPLETE_KNOWLEDGE_PROFILE;
      }
    }
  );

  assert("pointer read happens before knowledge read",
    callOrder.indexOf("pointer:logic_001") < callOrder.indexOf("knowledge:logic_001"),
    JSON.stringify(callOrder));
  assert("ok = true when knowledge is complete",
    result.ok === true,                                                     JSON.stringify(result));
  assert("canonical logic resolved first",
    result.state.resolved_logic_doc_id === "LOGIC_CANONICAL_001",          result.state.resolved_logic_doc_id);
  assert("knowledge profile present in result",
    result.knowledge && result.knowledge.logic_knowledge_surface_id === "surface.logic_knowledge_profiles",
    JSON.stringify(result.knowledge));
  assert("knowledge completeness = validated",
    result.knowledge?.knowledge_read_completeness_status === "validated",  result.knowledge?.knowledge_read_completeness_status);
  assert("execution_blocked_until_logic_knowledge_read = false when complete",
    result.knowledge?.execution_blocked_until_logic_knowledge_read === false,
    String(result.knowledge?.execution_blocked_until_logic_knowledge_read));

  // Missing required knowledge blocks full-success
  const resultMissing = resolveLogicPointerContext(
    { logic_id: "logic_001", require_knowledge: true },
    {
      getPointerRow:       () => CANONICAL_ROW,
      getKnowledgeProfile: () => INCOMPLETE_KNOWLEDGE_PROFILE
    }
  );

  assert("ok = false when required knowledge missing",
    resultMissing.ok === false,                                            JSON.stringify(resultMissing));
  assert("blocked_reason = required_logic_knowledge_incomplete",
    resultMissing.blocked_reason === "required_logic_knowledge_incomplete",
    resultMissing.blocked_reason);
  assert("execution_blocked_until_logic_knowledge_read = true when incomplete",
    resultMissing.knowledge?.execution_blocked_until_logic_knowledge_read === true,
    String(resultMissing.knowledge?.execution_blocked_until_logic_knowledge_read));
  assert("missing_required_knowledge_sources non-empty",
    (resultMissing.knowledge?.missing_required_knowledge_sources?.length ?? 0) > 0,
    JSON.stringify(resultMissing.knowledge?.missing_required_knowledge_sources));
  assert("canonical pointer evidence still preserved when knowledge blocks",
    resultMissing.state?.resolved_logic_doc_id === "LOGIC_CANONICAL_001",  resultMissing.state?.resolved_logic_doc_id);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("ALL TESTS PASS");
  process.exit(0);
} else {
  console.error(`${failed} TEST(S) FAILED`);
  process.exit(1);
}
