import {
  resolveActivationBootstrapWorkbook,
  runGovernedActivation
} from "./governedActivationRunner.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

const VALID_BOOTSTRAP_ROW = {
  github_parent_action_key: "github_api_mcp",
  github_endpoint_key: "getRepositoryContent",
  github_owner: "mad4bdigital-ai",
  github_repo: "multi-business-multi-role-growth-intelligence-os",
  github_branch: "main"
};

const EXPECTED_BOOTSTRAP_SPREADSHEET_ID = "1RV185rQo58pGppg27r81eD9hPE8pXPyBY1pfHANip4o";
const EXPECTED_BOOTSTRAP_RANGE = "Activation Bootstrap Config!A2:J2";

function bootstrapSpreadsheet(sheetTitle = "Activation Bootstrap Config") {
  return {
    ok: true,
    data: {
      sheets: [
        { properties: { title: sheetTitle } }
      ]
    }
  };
}

function fullDeps(overrides = {}) {
  return {
    attemptDrive: async () => ({ ok: true }),
    attemptSheets: async () => ({ ok: true }),
    getSpreadsheet: async () => bootstrapSpreadsheet(),
    readBootstrapRow: async () => ({ ok: true, row: VALID_BOOTSTRAP_ROW }),
    attemptGitHub: async () => ({ ok: true }),
    ...overrides
  };
}

section("no transport started → degraded");
{
  // Drive fails immediately
  const result = await runGovernedActivation(fullDeps({
    attemptDrive: async () => ({ ok: false })
  }));
  assert("drive fail → degraded", result.runtime_classification?.activation_status === "degraded", JSON.stringify(result.runtime_classification));
  assert("drive fail → transport_attempted true", result.evidence?.transport_attempted === true);
  assert("drive fail → drive_ok false", result.evidence?.drive_ok === false);
  assert("drive fail → recovery re_read_bootstrap", result.recovery?.recommended_action === "re_read_bootstrap");
}

section("auth failure → authorization_gated");
{
  const result = await runGovernedActivation(fullDeps({
    attemptDrive: async () => ({ ok: false, auth_failed: true })
  }));
  assert("auth fail → authorization_gated", result.runtime_classification?.activation_status === "authorization_gated", JSON.stringify(result.runtime_classification));
  assert("auth fail → recovery repair_credentials", result.recovery?.recommended_action === "repair_credentials");
  assert("auth fail → not retryable", result.recovery?.retryable === false);
}

section("Sheets 429 → validation_rate_limited");
{
  const result = await runGovernedActivation(fullDeps({
    attemptSheets: async () => ({ ok: false, rate_limited: true })
  }));
  assert("sheets 429 → validation_rate_limited", result.runtime_classification?.activation_status === "validation_rate_limited", JSON.stringify(result.runtime_classification));
  assert("sheets 429 → recovery retry_after_backoff", result.recovery?.recommended_action === "retry_after_backoff");
  assert("sheets 429 → retryable true", result.recovery?.retryable === true);
  assert("sheets 429 → drive completed", result.evidence?.drive_ok === true);
  assert("sheets 429 → sheets_ok false", result.evidence?.sheets_ok === false);
}

section("bootstrap row missing → degraded");
{
  const result = await runGovernedActivation(fullDeps({
    readBootstrapRow: async () => ({ ok: false })
  }));
  // drive+sheets succeeded → partial chain → validating (not degraded)
  assert("no bootstrap → validating", result.runtime_classification?.activation_status === "validating", JSON.stringify(result.runtime_classification));
  assert("no bootstrap → sheets completed", result.evidence?.sheets_ok === true);
  assert("no bootstrap → bootstrap_row_read false", result.evidence?.bootstrap_row_read === false);
}

section("incomplete GitHub bindings → degraded (executable_binding_mismatch)");
{
  const result = await runGovernedActivation(fullDeps({
    readBootstrapRow: async () => ({
      ok: true,
      row: { github_parent_action_key: "github_api_mcp", github_endpoint_key: "" }
    })
  }));
  assert("bad bindings → degraded", result.runtime_classification?.activation_status === "degraded", JSON.stringify(result.runtime_classification));
  assert("bad bindings → executable_binding_mismatch", result.evidence?.executable_binding_mismatch === true);
  assert("bad bindings → recovery repair_binding", result.recovery?.recommended_action === "repair_binding");
}

section("GitHub call fails → degraded");
{
  const result = await runGovernedActivation(fullDeps({
    attemptGitHub: async () => ({ ok: false })
  }));
  // drive+sheets+bootstrap succeeded → partial chain → validating
  assert("github fail → validating", result.runtime_classification?.activation_status === "validating", JSON.stringify(result.runtime_classification));
  assert("github fail → binding_resolved true", result.evidence?.binding_resolved === true);
  assert("github fail → github_ok false", result.evidence?.github_ok === false);
}

section("GitHub bindings must come from bootstrap row only");
{
  let capturedBindings = null;
  const result = await runGovernedActivation(fullDeps({
    attemptGitHub: async (bindings) => {
      capturedBindings = bindings;
      return { ok: true };
    }
  }));
  assert("github binding parent_action_key from row", capturedBindings?.parent_action_key === "github_api_mcp");
  assert("github binding endpoint_key from row", capturedBindings?.endpoint_key === "getRepositoryContent");
  assert("github binding owner from row", capturedBindings?.owner === "mad4bdigital-ai");
  assert("github binding repo from row", capturedBindings?.repo === "multi-business-multi-role-growth-intelligence-os");
}

section("activation uses direct bootstrap spreadsheet id before Drive discovery");
{
  let usedSpreadsheetId = null;
  let usedRange = null;
  let driveDiscoveryCalled = false;

  const result = await runGovernedActivation(fullDeps({
    listDriveFiles: async () => {
      driveDiscoveryCalled = true;
      return { ok: true, files: [{ id: "wrong-first-id" }] };
    },
    readBootstrapRow: async ({ spreadsheetId, range }) => {
      usedSpreadsheetId = spreadsheetId;
      usedRange = range;
      return { ok: true, row: VALID_BOOTSTRAP_ROW };
    }
  }));

  assert("direct bootstrap workbook id used", usedSpreadsheetId === EXPECTED_BOOTSTRAP_SPREADSHEET_ID, `got: ${usedSpreadsheetId}`);
  assert("direct bootstrap range used", usedRange === EXPECTED_BOOTSTRAP_RANGE, `got: ${usedRange}`);
  assert("broad Drive discovery not used before direct id", driveDiscoveryCalled === false);
  assert("activation can continue", result.evidence?.bootstrap_row_read === true);
}

section("activation workbook resolution rejects first spreadsheet fallback");
{
  let rowReadCalled = false;
  let driveDiscoveryCalled = false;

  const result = await runGovernedActivation(fullDeps({
    getSpreadsheet: async ({ spreadsheetId }) => ({
      ok: false,
      reason: "not_found",
      spreadsheetId
    }),
    listDriveFiles: async () => {
      driveDiscoveryCalled = true;
      return {
        ok: true,
        files: [{ id: "1hX7a6RQzaJ1FP0z8xN9Krds4VluqilkSRAxYXHKR4sE" }]
      };
    },
    readBootstrapRow: async () => {
      rowReadCalled = true;
      return { ok: true, row: VALID_BOOTSTRAP_ROW };
    }
  }));

  assert("broad Drive discovery not used as fallback by default", driveDiscoveryCalled === false);
  assert("wrong workbook row read never attempted", rowReadCalled === false);
  assert("bootstrap workbook failure captured", result.evidence?.bootstrap_workbook_reason === "direct_activation_bootstrap_workbook_unreadable", JSON.stringify(result.evidence));
  assert("activation remains non-active", result.runtime_classification?.activation_status !== "active", JSON.stringify(result.runtime_classification));
}

section("activation workbook missing bootstrap sheet blocks row read");
{
  let rowReadCalled = false;

  const result = await runGovernedActivation(fullDeps({
    getSpreadsheet: async () => bootstrapSpreadsheet("AllRoyalEgypt Publish Preparation Store"),
    readBootstrapRow: async () => {
      rowReadCalled = true;
      return { ok: true, row: VALID_BOOTSTRAP_ROW };
    }
  }));

  assert("missing Activation Bootstrap Config sheet blocks row read", rowReadCalled === false);
  assert("missing sheet reason captured", result.evidence?.bootstrap_workbook_reason === "activation_bootstrap_sheet_missing", JSON.stringify(result.evidence));
  assert("activation remains non-active", result.runtime_classification?.activation_status !== "active", JSON.stringify(result.runtime_classification));
}

section("resolveActivationBootstrapWorkbook requires exact direct workbook");
{
  let requestedSpreadsheetId = null;
  const result = await resolveActivationBootstrapWorkbook({
    expectedSpreadsheetId: EXPECTED_BOOTSTRAP_SPREADSHEET_ID,
    getSpreadsheet: async ({ spreadsheetId }) => {
      requestedSpreadsheetId = spreadsheetId;
      return bootstrapSpreadsheet();
    },
    listDriveFiles: async () => {
      throw new Error("Drive discovery must not run during direct-id success.");
    }
  });

  assert("resolver requests configured spreadsheet id", requestedSpreadsheetId === EXPECTED_BOOTSTRAP_SPREADSHEET_ID, `got: ${requestedSpreadsheetId}`);
  assert("resolver succeeds by direct id", result.ok === true, JSON.stringify(result));
  assert("resolver reports direct_id_first", result.resolution_mode === "direct_id_first", JSON.stringify(result));
}

section("resolveActivationBootstrapWorkbook rejects unconstrained discovery fallback");
{
  let driveDiscoveryCalled = false;
  const result = await resolveActivationBootstrapWorkbook({
    expectedSpreadsheetId: EXPECTED_BOOTSTRAP_SPREADSHEET_ID,
    allowFallbackDiscovery: true,
    getSpreadsheet: async () => ({ ok: false, reason: "not_found" }),
    listDriveFiles: async () => {
      driveDiscoveryCalled = true;
      return { ok: true, files: [{ id: "wrong-first-id" }] };
    }
  });

  assert("unconstrained discovery does not run", driveDiscoveryCalled === false);
  assert("unconstrained discovery is rejected", result.ok === false);
  assert("fallback requires explicit constraints", result.reason === "activation_bootstrap_discovery_requires_explicit_constraints", JSON.stringify(result));
}

section("DB runtime bootstrap can skip Sheets without reporting Sheets success");
{
  const result = await runGovernedActivation(fullDeps({
    attemptSheets: async () => ({
      ok: true,
      skipped: true,
      not_required: true,
      reason: "db_runtime_bootstrap_authority"
    })
  }));

  assert("db runtime skip → active", result.runtime_classification?.activation_status === "active", JSON.stringify(result.runtime_classification));
  assert("db runtime skip → sheets_required false", result.evidence?.sheets_required === false, JSON.stringify(result.evidence));
  assert("db runtime skip → sheets_skipped true", result.evidence?.sheets_skipped === true, JSON.stringify(result.evidence));
  assert("db runtime skip → sheets_ok remains false", result.evidence?.sheets_ok === false, JSON.stringify(result.evidence));
  assert("db runtime skip → skip reason captured", result.evidence?.sheets_skip_reason === "db_runtime_bootstrap_authority", JSON.stringify(result.evidence));
  assert("db runtime skip → sheets_not_required progress", result.runtime_classification?.progress?.completed_stages?.includes("sheets_not_required"), JSON.stringify(result.runtime_classification?.progress));
  assert("db runtime skip → no sheets_validation success stage", !result.runtime_classification?.progress?.completed_stages?.includes("sheets_validation"), JSON.stringify(result.runtime_classification?.progress));
  assert("db runtime skip → operator view names DB bootstrap", result.operator_view?.what_succeeded?.includes("DB bootstrap config"), JSON.stringify(result.operator_view));
  assert("db runtime skip → operator view does not claim Google Sheets", !result.operator_view?.what_succeeded?.includes("Google Sheets"), JSON.stringify(result.operator_view));
  assert("db runtime skip → consistency remains clean", result.runtime_classification?.evidence_consistency === "consistent", JSON.stringify(result.runtime_classification));
}

section("full provider chain → active");
{
  const result = await runGovernedActivation(fullDeps());
  assert("full chain → active", result.runtime_classification?.activation_status === "active", JSON.stringify(result.runtime_classification));
  assert("full chain → all evidence true", (
    result.evidence?.transport_attempted &&
    result.evidence?.drive_ok &&
    result.evidence?.sheets_ok &&
    result.evidence?.bootstrap_row_read &&
    result.evidence?.binding_resolved &&
    result.evidence?.github_ok &&
    result.evidence?.validation_complete
  ), JSON.stringify(result.evidence));
  assert("full chain → recovery none", result.recovery?.recommended_action === "none");
  assert("full chain → not retryable", result.recovery?.retryable === false);
  assert("full chain → operator view active headline", result.operator_view?.headline === "Activation is complete.");
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
