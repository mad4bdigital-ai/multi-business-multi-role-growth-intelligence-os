import { buildActivationEnvelope } from "./activationResponse.js";
import {
  ACTIVATION_BOOTSTRAP_CONFIG_RANGE,
  ACTIVATION_BOOTSTRAP_CONFIG_SHEET,
  ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID,
  ALLOW_ACTIVATION_BOOTSTRAP_DISCOVERY_FALLBACK
} from "./config.js";

const ALLOWED_DRIVE_BINDING = Object.freeze({
  parent_action_key: "google_drive_api",
  endpoint_key: "listDriveFiles"
});

const ALLOWED_SHEETS_BINDINGS = Object.freeze([
  "getSpreadsheet",
  "getSheetValues"
]);

function blankEvidence() {
  return {
    transport_attempted: false,
    drive_attempted: false,
    drive_ok: false,
    sheets_attempted: false,
    sheets_ok: false,
    sheets_required: true,
    sheets_skipped: false,
    sheets_skip_reason: "",
    github_attempted: false,
    github_ok: false,
    bootstrap_row_read: false,
    binding_resolved: false,
    validation_complete: false,
    rate_limited: false,
    auth_failed: false,
    executable_binding_mismatch: false,
    retry_count: 0
  };
}

function resolveGithubBindings(row) {
  const parent_action_key = String(row.github_parent_action_key || "").trim();
  const endpoint_key = String(row.github_endpoint_key || "").trim();
  const owner = String(row.github_owner || "").trim();
  const repo = String(row.github_repo || "").trim();
  const branch = String(row.github_branch || "main").trim();

  if (!parent_action_key || !endpoint_key || !owner || !repo) return null;

  return { parent_action_key, endpoint_key, owner, repo, branch };
}

function spreadsheetSheets(spreadsheet) {
  const data = spreadsheet?.data || spreadsheet?.spreadsheet || spreadsheet || {};
  return Array.isArray(data.sheets) ? data.sheets : [];
}

function hasBootstrapSheet(spreadsheet, expectedSheetTitle = ACTIVATION_BOOTSTRAP_CONFIG_SHEET) {
  const expected = String(expectedSheetTitle || "").trim();
  return spreadsheetSheets(spreadsheet).some(
    sheet => String(sheet?.properties?.title || "").trim() === expected
  );
}

export async function resolveActivationBootstrapWorkbook({
  getSpreadsheet,
  listDriveFiles,
  expectedSpreadsheetId = ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID,
  expectedSheetTitle = ACTIVATION_BOOTSTRAP_CONFIG_SHEET,
  allowFallbackDiscovery = ALLOW_ACTIVATION_BOOTSTRAP_DISCOVERY_FALLBACK
} = {}) {
  const spreadsheetId = String(expectedSpreadsheetId || "").trim();
  if (!spreadsheetId) {
    return {
      ok: false,
      reason: "missing_activation_bootstrap_spreadsheet_id",
      allowFallbackDiscovery: false
    };
  }

  if (typeof getSpreadsheet !== "function") {
    return {
      ok: false,
      reason: "missing_activation_bootstrap_get_spreadsheet",
      spreadsheetId,
      fallback_permitted: false
    };
  }

  const direct = await getSpreadsheet({ spreadsheetId });
  if (direct?.ok) {
    if (!hasBootstrapSheet(direct, expectedSheetTitle)) {
      return {
        ok: false,
        reason: "activation_bootstrap_sheet_missing",
        spreadsheetId,
        fallback_permitted: false
      };
    }

    return {
      ok: true,
      spreadsheetId,
      resolution_mode: "direct_id_first",
      fallback_used: false
    };
  }

  if (!allowFallbackDiscovery) {
    return {
      ok: false,
      reason: "direct_activation_bootstrap_workbook_unreadable",
      spreadsheetId,
      fallback_permitted: false,
      direct_reason: direct?.reason || direct?.error?.code || ""
    };
  }

  if (typeof listDriveFiles !== "function") {
    return {
      ok: false,
      reason: "activation_bootstrap_discovery_unavailable",
      spreadsheetId,
      fallback_permitted: true
    };
  }

  return {
    ok: false,
    reason: "activation_bootstrap_discovery_requires_explicit_constraints",
    spreadsheetId,
    fallback_permitted: true
  };
}

/**
 * Runs the governed provider/bootstrap activation chain:
 *   1. Google Drive provider probe (connectivity/auth evidence only)
 *   2. DB-native activation bootstrap row read; Google Sheets may be skipped as not required
 *   3. GitHub validation with bindings resolved from the DB bootstrap row
 *
 * Legacy workbook arguments remain for compatibility with old tests/fallbacks, but
 * activation bootstrap authority is the backend runtime DB config.
 *
 * Each step records boolean evidence before classifying.
 * Returns { evidence, runtime_classification, recovery, operator_view }.
 *
 * deps must supply:
 *   attemptDrive()       → { ok, auth_failed? }
 *   attemptSheets()      → { ok, skipped?, not_required?, rate_limited?, auth_failed? }
 *   getSpreadsheet({ spreadsheetId }) → legacy compatibility shim or provider probe metadata
 *   readBootstrapRow({ spreadsheetId, range }) → { ok, row? } row has github_* fields
 *   attemptGitHub(bindings) → { ok, auth_failed? }
 */
export async function runGovernedActivation(deps = {}) {
  const {
    attemptDrive,
    attemptSheets,
    readBootstrapRow,
    attemptGitHub,
    getSpreadsheet,
    listDriveFiles,
    expectedBootstrapSpreadsheetId = ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID,
    bootstrapRange = ACTIVATION_BOOTSTRAP_CONFIG_RANGE,
    allowBootstrapDiscoveryFallback = ALLOW_ACTIVATION_BOOTSTRAP_DISCOVERY_FALLBACK
  } = deps;
  const evidence = blankEvidence();

  // ── Step 1: Google Drive ────────────────────────────────────────────────────
  evidence.transport_attempted = true;
  evidence.drive_attempted = true;

  const driveResult = await attemptDrive(ALLOWED_DRIVE_BINDING);
  if (!driveResult.ok) {
    if (driveResult.auth_failed) evidence.auth_failed = true;
    return { evidence, ...buildActivationEnvelope(evidence) };
  }
  evidence.drive_ok = true;

  // ── Step 2: Google Sheets ───────────────────────────────────────────────────
  evidence.sheets_attempted = true;

  const sheetsResult = await attemptSheets({
    parent_action_key: "google_sheets_api",
    endpoint_key: ALLOWED_SHEETS_BINDINGS[0]
  });
  if (sheetsResult?.not_required === true || sheetsResult?.skipped === true) {
    evidence.sheets_required = false;
    evidence.sheets_skipped = true;
    evidence.sheets_skip_reason = sheetsResult.reason || "not_required";
  } else if (!sheetsResult.ok) {
    if (sheetsResult.rate_limited) evidence.rate_limited = true;
    if (sheetsResult.auth_failed) evidence.auth_failed = true;
    return { evidence, ...buildActivationEnvelope(evidence) };
  } else {
    evidence.sheets_ok = true;
  }

  // ── Step 3: Bootstrap row ───────────────────────────────────────────────────
  const workbookResult = await resolveActivationBootstrapWorkbook({
    getSpreadsheet,
    listDriveFiles,
    expectedSpreadsheetId: expectedBootstrapSpreadsheetId,
    allowFallbackDiscovery: allowBootstrapDiscoveryFallback
  });
  if (!workbookResult.ok) {
    evidence.bootstrap_workbook_resolved = false;
    evidence.bootstrap_workbook_reason = workbookResult.reason;
    evidence.bootstrap_spreadsheet_id = workbookResult.spreadsheetId || "";
    return { evidence, ...buildActivationEnvelope(evidence) };
  }
  evidence.bootstrap_workbook_resolved = true;
  evidence.bootstrap_spreadsheet_id = workbookResult.spreadsheetId;

  const bootstrapResult = await readBootstrapRow({
    spreadsheetId: workbookResult.spreadsheetId,
    range: bootstrapRange
  });
  if (!bootstrapResult.ok || !bootstrapResult.row) {
    return { evidence, ...buildActivationEnvelope(evidence) };
  }
  evidence.bootstrap_row_read = true;

  const githubBindings = resolveGithubBindings(bootstrapResult.row);
  if (!githubBindings) {
    evidence.executable_binding_mismatch = true;
    return { evidence, ...buildActivationEnvelope(evidence) };
  }
  evidence.binding_resolved = true;

  // ── Step 4: GitHub (bindings from bootstrap row only) ──────────────────────
  evidence.github_attempted = true;

  const githubResult = await attemptGitHub(githubBindings);
  if (!githubResult.ok) {
    if (githubResult.auth_failed) evidence.auth_failed = true;
    return { evidence, ...buildActivationEnvelope(evidence) };
  }
  evidence.github_ok = true;
  evidence.validation_complete = true;

  return { evidence, ...buildActivationEnvelope(evidence) };
}
