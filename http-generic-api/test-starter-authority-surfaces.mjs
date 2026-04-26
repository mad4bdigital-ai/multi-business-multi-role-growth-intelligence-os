import {
  resolveStarterAuthoritySurfaces,
  validateStarterSurfaceRole
} from "./starterAuthoritySurfaces.js";

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
  const result = resolveStarterAuthoritySurfaces([
    {
      surface_id: "conversation_starters_main_surface",
      worksheet_name: "Conversation Starters - Main",
      worksheet_gid: "111",
      active_status: "active",
      authority_status: "authoritative",
      required_for_execution: "TRUE"
    },
    {
      surface_id: "conversation_starters_system_surface",
      worksheet_name: "Conversation Starters - System",
      worksheet_gid: "222",
      active_status: "active",
      authority_status: "authoritative",
      required_for_execution: "TRUE"
    },
    {
      surface_id: "conversation_starter_sheet",
      worksheet_name: "Conversation Starter",
      worksheet_gid: "333",
      active_status: "active",
      authority_status: "non_authoritative",
      required_for_execution: "FALSE"
    }
  ]);

  assert("split starter surfaces are preferred", result.authority_mode === "split_surfaces", JSON.stringify(result));
  assert("split starter authority is execution-ready", result.execution_authority_ready === true, JSON.stringify(result));
  assert("legacy starter surface remains fallback", result.legacy_fallback?.authoritative === false, JSON.stringify(result));
}

{
  const validation = validateStarterSurfaceRole({
    surface_id: "conversation_starter_sheet",
    active_status: "active",
    authority_status: "authoritative",
    required_for_execution: "TRUE"
  });

  assert(
    "legacy starter surface cannot regain execution authority",
    validation.valid === false &&
      validation.errors.includes("legacy_starter_surface_required_for_execution") &&
      validation.errors.includes("legacy_starter_surface_authoritative"),
    JSON.stringify(validation)
  );
}

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
