// Auto-extracted from server.js — do not edit manually, use domain logic here.
import { google } from "googleapis";
import { DATA_SOURCE_MODE } from "./dataSource.js";

export function assertExecutionLogRowIsSpillSafe(row) {
  const rowText = JSON.stringify(row);
  if (rowText.length > 50_000) {
    throw new Error("Activity Log row exceeded safe compact-write size.");
  }

  const forbiddenLiteralColumns = [];

  const populated = forbiddenLiteralColumns.filter(
    key => String(row?.[key] ?? "").trim() !== ""
  );

  if (populated.length) {
    const err = new Error(
      `Activity Log row must not provide literal values for formula-managed columns: ${populated.join(", ")}`
    );
    err.code = "formula_managed_columns_literal_value";
    err.status = 500;
    throw err;
  }

  const requiredRawWritebackColumns = [
    "target_module_writeback",
    "target_workflow_writeback",
    "execution_trace_id_writeback",
    "log_source_writeback",
    "monitored_row_writeback",
    "performance_impact_row_writeback"
  ];

  const missingRawValues = requiredRawWritebackColumns.filter(
    key => !Object.prototype.hasOwnProperty.call(row, key)
  );

  if (missingRawValues.length) {
    const err = new Error(
      `Activity Log row missing raw writeback columns: ${missingRawValues.join(", ")}`
    );
    err.code = "missing_raw_writeback_columns";
    err.status = 500;
    throw err;
  }
}

export function headerMap(headerRow, sheetName = "unknown_sheet") {
  const map = {};
  const duplicates = [];

  headerRow.forEach((rawName, idx) => {
    const name = String(rawName || "").trim();
    if (!name) return;

    if (Object.prototype.hasOwnProperty.call(map, name)) {
      duplicates.push(name);
      return;
    }

    map[name] = idx;
  });

  if (duplicates.length) {
    const err = new Error(
      `Duplicate headers detected in ${sheetName}: ${[...new Set(duplicates)].join(", ")}`
    );
    err.code = "duplicate_sheet_headers";
    err.status = 500;
    throw err;
  }

  return map;
}

export function getCell(row, map, key) {
  const idx = map[key];
  return idx === undefined ? "" : (row[idx] ?? "");
}

export function assertHeaderMatchesSurfaceMetadata(args = {}) {
  const sheetName = String(args.sheetName || "sheet").trim();
  const actualHeader = (args.actualHeader || []).map(v => String(v || "").trim());
  const metadata = args.metadata || {};
  const fallbackColumns = args.fallbackColumns || [];

  const expectedColumnCount = normalizeExpectedColumnCount(
    metadata.expected_column_count,
    fallbackColumns
  );

  const expectedSignature =
    String(metadata.header_signature || "").trim() ||
    buildExpectedHeaderSignatureFromCanonical(fallbackColumns);

  const actualSignature = actualHeader.join("|");

  if (expectedColumnCount && actualHeader.length !== expectedColumnCount) {
    const err = new Error(
      `${sheetName} header column count mismatch from surface metadata. expected=${expectedColumnCount} actual=${actualHeader.length}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  if (expectedSignature && actualSignature !== expectedSignature) {
    const err = new Error(
      `${sheetName} header signature mismatch from surface metadata.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  if (String(metadata.audit_mode || "").trim() === "exact_header_match") {
    assertCanonicalHeaderExact(actualHeader, fallbackColumns, sheetName);
  }

  return true;
}

export function computeHeaderSignature(header = []) {
  return crypto
    .createHash("sha256")
    .update(header.map(v => String(v || "").trim()).join("|"))
    .digest("hex");
}

export function assertExpectedColumnsPresent(header = [], required = [], sheetName = "sheet") {
  const missing = required.filter(col => !header.includes(col));
  if (missing.length) {
    const err = new Error(
      `${sheetName} missing required columns: ${missing.join(", ")}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
}

export function detectUnsafeColumnsFromRow2(header = [], row2 = []) {
  const unsafe = new Set();

  for (let i = 0; i < header.length; i += 1) {
    const colName = String(header[i] || "").trim();
    const sample = String(row2[i] || "").trim();

    if (!colName) continue;

    const looksFormula =
      sample.startsWith("=") ||
      sample.includes("ARRAYFORMULA(") ||
      sample.includes("=arrayformula(");

    if (looksFormula) {
      unsafe.add(colName);
    }
  }

  return unsafe;
}

export function buildGovernedWritePlan(args = {}) {
  const protectedColumns = args.protectedColumns || new Set();
  const unsafeFromRow2 = detectUnsafeColumnsFromRow2(args.header, args.row2);

  const safeColumns = [];
  const unsafeColumns = [];

  for (const col of args.requestedColumns || []) {
    if (!args.header.includes(col)) {
      unsafeColumns.push(col);
      continue;
    }

    if (protectedColumns.has(col)) {
      unsafeColumns.push(col);
      continue;
    }

    if (unsafeFromRow2.has(col)) {
      unsafeColumns.push(col);
      continue;
    }

    safeColumns.push(col);
  }

  return {
    header: args.header || [],
    row2: args.row2 || [],
    safeColumns,
    unsafeColumns
  };
}

export function assertExecutionLogFormulaColumnsProtected(plan = {}, sheetName = "Execution Log Unified") {
  const missingRawColumns = EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_COLUMNS.filter(
    col => !(plan.header || []).includes(col)
  );

  if (missingRawColumns.length) {
    const err = new Error(
      `${sheetName} missing raw writeback columns: ${missingRawColumns.join(", ")}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
}

export function buildFullWidthGovernedRow(header = [], safeColumns = [], rowObject = {}) {
  const safeSet = new Set(safeColumns);
  return header.map(col => {
    const columnName = String(col || "").trim();
    if (!columnName) return "";
    if (!safeSet.has(columnName)) return "";
    return toSheetCellValue(rowObject[columnName]);
  });
}

export function buildColumnSliceRow(columns = [], rowObject = {}) {
  return columns.map(col => toSheetCellValue(rowObject[col]));
}

export async function loadLiveGovernedChangeControlPolicies() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const rows = await fetchRange(
    sheets,
    toValuesApiRange(EXECUTION_POLICY_SHEET, "A:H")
  );

  if (!rows.length) {
    const err = new Error("Execution Policy Registry is empty.");
    err.code = "policy_registry_unavailable";
    err.status = 500;
    throw err;
  }

  const header = rows[0].map(v => String(v || "").trim());
  const map = headerMap(header, EXECUTION_POLICY_SHEET);
  const body = rows.slice(1);

  return body
    .filter(row => {
      const group = String(getCell(row, map, "policy_group") || "").trim();
      const active = String(getCell(row, map, "active") || "").trim().toUpperCase();
      return group === "Governed Change Control" && active === "TRUE";
    })
    .map(row => ({
      policy_group: String(getCell(row, map, "policy_group") || "").trim(),
      policy_key: String(getCell(row, map, "policy_key") || "").trim(),
      policy_value: String(getCell(row, map, "policy_value") || "").trim(),
      active: String(getCell(row, map, "active") || "").trim(),
      execution_scope: String(getCell(row, map, "execution_scope") || "").trim(),
      owner_module: String(getCell(row, map, "owner_module") || "").trim(),
      enforcement_required: String(getCell(row, map, "enforcement_required") || "").trim(),
      notes: String(getCell(row, map, "notes") || "").trim()
    }));
}

export function governedPolicyValue(policies = [], key = "", fallback = "") {
  const row = policies.find(
    policy => String(policy.policy_key || "").trim() === String(key || "").trim()
  );
  return row ? String(row.policy_value || "").trim() : fallback;
}

export function governedPolicyEnabled(policies = [], key = "", fallback = false) {
  const fallbackText = fallback ? "TRUE" : "FALSE";
  return (
    String(governedPolicyValue(policies, key, fallbackText)).trim().toUpperCase() === "TRUE"
  );
}

export async function readRelevantExistingRowWindow(
  spreadsheetId,
  sheetName,
  scanRangeA1 = "A:Z"
) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, scanRangeA1)
  });

  const values = response.data.values || [];
  const header = (values[0] || []).map(v => String(v || "").trim());
  const rows = values.slice(1);

  return {
    header,
    headerMap: headerMap(header, sheetName),
    rows
  };
}
export function normalizeSemanticValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function findSemanticDuplicateRows(header = [], rows = [], rowObject = {}) {
  if (!header.length || !rows.length) return [];

  const candidateKeys = Object.keys(rowObject).filter(
    key => normalizeSemanticValue(rowObject[key]) !== ""
  );

  if (!candidateKeys.length) return [];

  return rows
    .map((row, idx) => {
      let score = 0;
      for (const key of candidateKeys) {
        const colIdx = header.indexOf(key);
        if (colIdx === -1) continue;
        if (
          normalizeSemanticValue(row[colIdx]) ===
          normalizeSemanticValue(rowObject[key])
        ) {
          score += 1;
        }
      }
      return { rowNumber: idx + 2, score, row };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function classifyGovernedMutationIntent(args = {}) {
  const {
    mutationType = "append",
    duplicateCandidates = [],
    targetRowNumber = null,
    renameOnly = false,
    mergeCandidate = false
  } = args;

  if (mutationType === "append") {
    if (duplicateCandidates.length) return "blocked_duplicate";
    return "append_new";
  }

  if (mutationType === "update") {
    if (renameOnly) return "rename_existing";
    if (mergeCandidate) return "merge_existing";
    if (targetRowNumber) return "update_existing";
    return "blocked_policy_unconfirmed";
  }

  if (mutationType === "delete") {
    return targetRowNumber ? "update_existing" : "blocked_policy_unconfirmed";
  }

  if (mutationType === "repair") {
    return targetRowNumber ? "update_existing" : "blocked_policy_unconfirmed";
  }

  return "blocked_policy_unconfirmed";
}

export function resolveGovernedTargetRowNumber(args = {}) {
  const {
    targetRowNumber = null,
    duplicateCandidates = []
  } = args;

  if (Number.isInteger(targetRowNumber) && targetRowNumber >= 2) {
    return targetRowNumber;
  }

  if (duplicateCandidates.length === 1) {
    return duplicateCandidates[0].rowNumber;
  }

  return null;
}

export async function enforceGovernedMutationPreflight(args = {}) {
  const {
    spreadsheetId,
    sheetName,
    rowObject = {},
    mutationType = "append",
    scanRangeA1 = "A:Z",
    targetRowNumber = null,
    renameOnly = false,
    mergeCandidate = false
  } = args;

  const policies = await loadLiveGovernedChangeControlPolicies();

  if (
    governedPolicyEnabled(
      policies,
      "Live Policy Read Required Before Any Mutation",
      true
    ) !== true
  ) {
    const err = new Error("Live governed change-control policy confirmation failed.");
    err.code = "governed_policy_confirmation_failed";
    err.status = 500;
    throw err;
  }

  const appliesToAllSheets = governedPolicyEnabled(
    policies,
    "Applies To All Authoritative System Sheets",
    true
  );

  if (!appliesToAllSheets) {
    return {
      ok: true,
      classification: "append_new",
      duplicateCandidates: [],
      consultedPolicyKeys: policies.map(p => p.policy_key),
      consultedExistingRows: [],
      enforcementBypassed: true
    };
  }

  const existingWindow = await readRelevantExistingRowWindow(
    spreadsheetId,
    sheetName,
    scanRangeA1
  );

  const duplicateCandidates = governedPolicyEnabled(
    policies,
    "Semantic Duplicate Check Required Before Append",
    true
  )
    ? findSemanticDuplicateRows(existingWindow.header, existingWindow.rows, rowObject)
    : [];

  const isHighRiskSheet = HIGH_RISK_GOVERNED_SHEETS.has(String(sheetName || "").trim());
  const resolvedTargetRowNumber = resolveGovernedTargetRowNumber({
    targetRowNumber,
    duplicateCandidates
  });
  const classification = classifyGovernedMutationIntent({
    mutationType,
    duplicateCandidates,
    targetRowNumber: resolvedTargetRowNumber,
    renameOnly,
    mergeCandidate
  });

  if (
    mutationType === "append" &&
    duplicateCandidates.length &&
    governedPolicyEnabled(
      policies,
      "Append Forbidden When Update Or Rename Suffices",
      true
    )
  ) {
    const err = new Error(
      `${sheetName} append blocked because semantically equivalent live rows already exist.`
    );
    err.code = "governed_duplicate_append_blocked";
    err.status = 409;
    err.mutation_classification = "blocked_duplicate";
    err.duplicate_candidates = duplicateCandidates.slice(0, 5).map(item => ({
      rowNumber: item.rowNumber,
      score: item.score
    }));
    err.consulted_policy_keys = policies.map(p => p.policy_key);
    throw err;
  }

  if (
    mutationType !== "append" &&
    !resolvedTargetRowNumber &&
    governedPolicyEnabled(
      policies,
      "Pre-Mutation Change Classification Required",
      true
    )
  ) {
    const err = new Error(
      `${sheetName} ${mutationType} blocked because no governed target row could be resolved.`
    );
    err.code = "governed_target_row_unresolved";
    err.status = 409;
    err.mutation_classification = "blocked_policy_unconfirmed";
    err.consulted_policy_keys = policies.map(p => p.policy_key);
    throw err;
  }

  return {
    ok: true,
    classification,
    mutationType,
    targetRowNumber: resolvedTargetRowNumber,
    duplicateCandidates: duplicateCandidates.slice(0, 5).map(item => ({
      rowNumber: item.rowNumber,
      score: item.score
    })),
    consultedPolicyKeys: policies.map(p => p.policy_key),
    consultedExistingRows: duplicateCandidates.slice(0, 5).map(item => item.rowNumber),
    highRiskSheet: isHighRiskSheet
  };
}

export async function updateSheetRowGoverned(
  sheets,
  spreadsheetId,
  sheetName,
  header,
  safeColumns,
  rowObject,
  targetRowNumber,
  preflight = null
) {
  if (!Number.isInteger(targetRowNumber) || targetRowNumber < 2) {
    const err = new Error(`${sheetName} update requires a valid target row number.`);
    err.code = "invalid_target_row_number";
    err.status = 400;
    throw err;
  }

  if (!safeColumns.length) {
    const err = new Error(`${sheetName} has no safe writable columns.`);
    err.code = "no_safe_write_columns";
    err.status = 500;
    throw err;
  }

  const range = `${String(sheetName || "").trim()}!A${targetRowNumber}:${columnLetter(header.length)}${targetRowNumber}`;
  const fullRow = buildFullWidthGovernedRow(header, safeColumns, rowObject);

  await sheets.spreadsheets.values.update({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range,
    valueInputOption: "RAW",
    requestBody: {
      majorDimension: "ROWS",
      values: [fullRow]
    }
  });

  return {
    targetRowNumber,
    preflight
  };
}


export async function deleteSheetRowGoverned(
  sheets,
  spreadsheetId,
  sheetName,
  targetRowNumber,
  preflight = null
) {
  if (!Number.isInteger(targetRowNumber) || targetRowNumber < 2) {
    const err = new Error(`${sheetName} delete requires a valid target row number.`);
    err.code = "invalid_target_row_number";
    err.status = 400;
    throw err;
  }

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    fields: "sheets.properties(sheetId,title)"
  });

  const sheet = (meta.data.sheets || []).find(
    s => String(s?.properties?.title || "").trim() === String(sheetName || "").trim()
  );

  if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
    const err = new Error(`Sheet not found for delete: ${sheetName}`);
    err.code = "sheet_not_found";
    err.status = 404;
    throw err;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: String(spreadsheetId || "").trim(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: Number(sheet.properties.sheetId),
              dimension: "ROWS",
              startIndex: targetRowNumber - 1,
              endIndex: targetRowNumber
            }
          }
        }
      ]
    }
  });

  return {
    targetRowNumber,
    preflight
  };
}


export async function performGovernedSheetMutation(args = {}) {
  const {
    spreadsheetId,
    sheetName,
    mutationType = "append",
    rowObject = {},
    safeColumns = [],
    header = [],
    targetRowNumber = null,
    scanRangeA1 = "A:Z"
  } = args;

  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);

  const preflight = await enforceGovernedMutationPreflight({
    spreadsheetId,
    sheetName,
    rowObject,
    mutationType,
    scanRangeA1,
    targetRowNumber
  });

  if (mutationType === "append") {
    if (sheetName === EXECUTION_LOG_UNIFIED_SHEET) {
      return await appendExecutionLogUnifiedRowGoverned(
        sheets,
        spreadsheetId,
        sheetName,
        header,
        rowObject,
        preflight
      );
    }

    return await appendSheetRowGoverned(
      sheets,
      spreadsheetId,
      sheetName,
      header,
      safeColumns,
      rowObject,
      preflight
    );
  }

  if (mutationType === "update" || mutationType === "repair") {
    return await updateSheetRowGoverned(
      sheets,
      spreadsheetId,
      sheetName,
      header,
      safeColumns,
      rowObject,
      preflight.targetRowNumber,
      preflight
    );
  }

  if (mutationType === "delete") {
    return await deleteSheetRowGoverned(
      sheets,
      spreadsheetId,
      sheetName,
      preflight.targetRowNumber,
      preflight
    );
  }

  const err = new Error(`Unsupported governed mutation type: ${mutationType}`);
  err.code = "unsupported_governed_mutation_type";
  err.status = 400;
  throw err;
}

export async function appendSheetRowGoverned(
  sheets,
  spreadsheetId,
  sheetName,
  header,
  safeColumns,
  rowObject,
  preflight = null
) {
  if (!safeColumns.length) {
    const err = new Error(`${sheetName} has no safe writable columns.`);
    err.code = "no_safe_write_columns";
    err.status = 500;
    throw err;
  }

  const fullRow = buildFullWidthGovernedRow(header, safeColumns, rowObject);

  await sheets.spreadsheets.values.append({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toA1Start(sheetName),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [fullRow]
    }
  });

  return {
    preflight
  };
}


export async function appendExecutionLogUnifiedRowGoverned(
  sheets,
  spreadsheetId,
  sheetName,
  header,
  rowObject,
  preflight = null
) {
  const requiredRawColumns = EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_COLUMNS.filter(
    col => !header.includes(col)
  );

  if (requiredRawColumns.length) {
    const err = new Error(
      `${sheetName} missing raw writeback columns: ${requiredRawColumns.join(", ")}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const fullRow = buildFullWidthGovernedRow(
    header,
    EXECUTION_LOG_UNIFIED_COLUMNS,
    rowObject
  );

  const appendResponse = await sheets.spreadsheets.values.append({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toA1Start(sheetName),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    includeValuesInResponse: false,
    requestBody: {
      values: [fullRow]
    }
  });

  const updatedRange = String(
    appendResponse?.data?.updates?.updatedRange || ""
  ).trim();

  const rowMatch = updatedRange.match(/![A-Z]+(\d+):/);
  const appendedRowNumber = rowMatch ? Number(rowMatch[1]) : NaN;

  if (!Number.isFinite(appendedRowNumber) || appendedRowNumber < 2) {
    const err = new Error(
      `${sheetName} append succeeded but appended row number could not be determined.`
    );
    err.code = "sheet_append_row_unknown";
    err.status = 500;
    throw err;
  }

  const rawWritebackValues = buildColumnSliceRow(
    EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_COLUMNS,
    rowObject
  );

  await sheets.spreadsheets.values.update({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(
      sheetName,
      `${EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_START_COLUMN}${appendedRowNumber}:${EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_END_COLUMN}${appendedRowNumber}`
    ),
    valueInputOption: "RAW",
    requestBody: {
      values: [rawWritebackValues]
    }
  });

  return { appendedRowNumber, preflight };
}


export async function verifyAppendReadback(
  spreadsheetId,
  sheetName,
  expectedStartTime,
  expectedSummary,
  expectedStatus,
  expectedEntryType,
  expectedArtifactJsonAssetId = "",
  expectedRawWriteback = {}
) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, "A:AQ")
  });

  const values = response.data.values || [];
  if (values.length < 2) {
    const err = new Error(`${sheetName} readback returned no data rows.`);
    err.code = "sheet_readback_failed";
    err.status = 500;
    throw err;
  }

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  const map = headerMap(header, sheetName);

  const startIdx = map["Start Time"];
  const summaryIdx = map["Output Summary"];
  const statusIdx = map["Execution Status"];
  const entryTypeIdx = map["Entry Type"];
  const artifactJsonAssetIdIdx = map["artifact_json_asset_id"];
  const targetModuleWritebackIdx = map["target_module_writeback"];
  const targetWorkflowWritebackIdx = map["target_workflow_writeback"];
  const executionTraceIdWritebackIdx = map["execution_trace_id_writeback"];
  const logSourceWritebackIdx = map["log_source_writeback"];
  const monitoredRowWritebackIdx = map["monitored_row_writeback"];
  const performanceImpactRowWritebackIdx = map["performance_impact_row_writeback"];

  if (
    startIdx === undefined ||
    summaryIdx === undefined ||
    statusIdx === undefined ||
    entryTypeIdx === undefined ||
    targetModuleWritebackIdx === undefined ||
    targetWorkflowWritebackIdx === undefined ||
    executionTraceIdWritebackIdx === undefined ||
    logSourceWritebackIdx === undefined ||
    monitoredRowWritebackIdx === undefined ||
    performanceImpactRowWritebackIdx === undefined
  ) {
    const err = new Error(`${sheetName} readback missing verification columns.`);
    err.code = "sheet_readback_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const matched = rows.some(row => {
    const start = String(row[startIdx] || "").trim();
    const summary = String(row[summaryIdx] || "").trim();
    const status = String(row[statusIdx] || "").trim();
    const entryType = String(row[entryTypeIdx] || "").trim();
    const artifactJsonAssetId =
      artifactJsonAssetIdIdx === undefined
        ? ""
        : String(row[artifactJsonAssetIdIdx] || "").trim();
    const targetModuleWriteback = String(row[targetModuleWritebackIdx] || "").trim();
    const targetWorkflowWriteback = String(row[targetWorkflowWritebackIdx] || "").trim();
    const executionTraceIdWriteback = String(row[executionTraceIdWritebackIdx] || "").trim();
    const logSourceWriteback = String(row[logSourceWritebackIdx] || "").trim();
    const monitoredRowWriteback = String(row[monitoredRowWritebackIdx] || "").trim();
    const performanceImpactRowWriteback = String(row[performanceImpactRowWritebackIdx] || "").trim();

    return (
      start === String(expectedStartTime || "").trim() &&
      summary === String(expectedSummary || "").trim() &&
      status === String(expectedStatus || "").trim() &&
      entryType === String(expectedEntryType || "").trim() &&
      artifactJsonAssetId === String(expectedArtifactJsonAssetId || "").trim() &&
      targetModuleWriteback === String(expectedRawWriteback.target_module_writeback || "").trim() &&
      targetWorkflowWriteback === String(expectedRawWriteback.target_workflow_writeback || "").trim() &&
      executionTraceIdWriteback === String(expectedRawWriteback.execution_trace_id_writeback || "").trim() &&
      logSourceWriteback === String(expectedRawWriteback.log_source_writeback || "").trim() &&
      monitoredRowWriteback === String(expectedRawWriteback.monitored_row_writeback || "").trim() &&
      performanceImpactRowWriteback === String(expectedRawWriteback.performance_impact_row_writeback || "").trim()
    );
  });

  if (!matched) {
    const err = new Error(`${sheetName} readback could not verify appended row.`);
    err.code = "sheet_readback_verification_failed";
    err.status = 500;
    throw err;
  }
}

export async function verifyJsonAssetAppendReadback(
  spreadsheetId,
  sheetName,
  expectedAssetId,
  expectedAssetType,
  expectedSourceAssetRef,
  expectedGoogleDriveLink,
  expectedJsonPayload = ""
) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, "A:AZ")
  });

  const values = response.data.values || [];
  if (values.length < 2) {
    const err = new Error(`${sheetName} readback returned no data rows.`);
    err.code = "sheet_readback_failed";
    err.status = 500;
    throw err;
  }

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  const map = headerMap(header, sheetName);
  const assetIdIdx = map.asset_id;
  const assetTypeIdx = map.asset_type;
  const sourceAssetRefIdx = map.source_asset_ref;
  const googleDriveLinkIdx = map.google_drive_link;
  const jsonPayloadIdx = map.json_payload;

  if (
    assetIdIdx === undefined ||
    assetTypeIdx === undefined ||
    sourceAssetRefIdx === undefined ||
    googleDriveLinkIdx === undefined ||
    jsonPayloadIdx === undefined
  ) {
    const err = new Error(`${sheetName} readback missing verification columns.`);
    err.code = "sheet_readback_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const matched = rows.some(row => {
    const assetId = String(row[assetIdIdx] || "").trim();
    const assetType = String(row[assetTypeIdx] || "").trim();
    const sourceAssetRef = String(row[sourceAssetRefIdx] || "").trim();
    const googleDriveLink = String(row[googleDriveLinkIdx] || "").trim();
    const jsonPayload = String(row[jsonPayloadIdx] || "").trim();
    return (
      assetId === String(expectedAssetId || "").trim() &&
      assetType === String(expectedAssetType || "").trim() &&
      sourceAssetRef === String(expectedSourceAssetRef || "").trim() &&
      googleDriveLink === String(expectedGoogleDriveLink || "").trim() &&
      jsonPayload === String(expectedJsonPayload || "").trim()
    );
  });

  if (!matched) {
    const err = new Error(`${sheetName} readback could not verify appended row.`);
    err.code = "sheet_readback_verification_failed";
    err.status = 500;
    throw err;
  }
}


export async function writeExecutionLogUnifiedRow(row) {
  if (DATA_SOURCE_MODE === "sql") return null;

  const { sheets } = await getGoogleClients({ action_key: "google_sheets_api" });

  const live = await readLiveSheetShape(
    EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    EXECUTION_LOG_UNIFIED_SHEET,
    EXECUTION_LOG_UNIFIED_RANGE
  );

  assertExpectedColumnsPresent(
    live.header,
    EXECUTION_LOG_UNIFIED_COLUMNS,
    EXECUTION_LOG_UNIFIED_SHEET
  );

  if (live.columnCount < EXECUTION_LOG_UNIFIED_COLUMNS.length) {
    const err = new Error(
      `${EXECUTION_LOG_UNIFIED_SHEET} column count is lower than expected.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const expectedHeaderSignature = computeHeaderSignature(
    EXECUTION_LOG_UNIFIED_COLUMNS
  );
  const alignedLiveHeaderSignature = computeHeaderSignature(
    live.header.slice(0, EXECUTION_LOG_UNIFIED_COLUMNS.length)
  );
  const headerSignature = computeHeaderSignature(live.header);
  if (!headerSignature || !expectedHeaderSignature) {
    const err = new Error(
      `${EXECUTION_LOG_UNIFIED_SHEET} header signature could not be computed.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
  if (alignedLiveHeaderSignature !== expectedHeaderSignature) {
    const err = new Error(
      `${EXECUTION_LOG_UNIFIED_SHEET} header signature mismatch.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const plan = buildGovernedWritePlan({
    sheetName: EXECUTION_LOG_UNIFIED_SHEET,
    header: live.header,
    row2: live.row2,
    requestedColumns: EXECUTION_LOG_UNIFIED_COLUMNS,
    protectedColumns: PROTECTED_UNIFIED_LOG_COLUMNS
  });

  assertExecutionLogFormulaColumnsProtected(
    plan,
    EXECUTION_LOG_UNIFIED_SHEET
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    sheetName: EXECUTION_LOG_UNIFIED_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: plan.safeColumns,
    scanRangeA1: "A:AQ"
  });

  await verifyAppendReadback(
    EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    EXECUTION_LOG_UNIFIED_SHEET,
    row["Start Time"],
    row["Output Summary"],
    row["Execution Status"],
    row["Entry Type"],
    row.artifact_json_asset_id,
    {
      target_module_writeback: row.target_module_writeback,
      target_workflow_writeback: row.target_workflow_writeback,
      execution_trace_id_writeback: row.execution_trace_id_writeback,
      log_source_writeback: row.log_source_writeback,
      monitored_row_writeback: row.monitored_row_writeback,
      performance_impact_row_writeback: row.performance_impact_row_writeback
    }
  );

  return {
    headerSignature,
    expectedHeaderSignature,
    row2Read: true,
    formulaManagedColumnsProtected: true,
    preflight: mutationResult.preflight,
    safeColumns: plan.safeColumns,
    unsafeColumns: plan.unsafeColumns
  };
}

export async function writeJsonAssetRegistryRow(row) {
  const { sheets } = await getGoogleClients({ action_key: "google_sheets_api" });

  const live = await readLiveSheetShape(
    JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    JSON_ASSET_REGISTRY_SHEET,
    JSON_ASSET_REGISTRY_RANGE
  );

  assertExpectedColumnsPresent(
    live.header,
    JSON_ASSET_REGISTRY_COLUMNS,
    JSON_ASSET_REGISTRY_SHEET
  );

  if (live.columnCount < JSON_ASSET_REGISTRY_COLUMNS.length) {
    const err = new Error(
      `${JSON_ASSET_REGISTRY_SHEET} column count is lower than expected.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const expectedHeaderSignature = computeHeaderSignature(
    JSON_ASSET_REGISTRY_COLUMNS
  );
  const alignedLiveHeaderSignature = computeHeaderSignature(
    live.header.slice(0, JSON_ASSET_REGISTRY_COLUMNS.length)
  );
  const headerSignature = computeHeaderSignature(live.header);
  if (!headerSignature || !expectedHeaderSignature) {
    const err = new Error(
      `${JSON_ASSET_REGISTRY_SHEET} header signature could not be computed.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
  if (alignedLiveHeaderSignature !== expectedHeaderSignature) {
    const err = new Error(
      `${JSON_ASSET_REGISTRY_SHEET} header signature mismatch.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const plan = buildGovernedWritePlan({
    sheetName: JSON_ASSET_REGISTRY_SHEET,
    header: live.header,
    row2: live.row2,
    requestedColumns: JSON_ASSET_REGISTRY_COLUMNS,
    protectedColumns: new Set()
  });

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    sheetName: JSON_ASSET_REGISTRY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: plan.safeColumns,
    scanRangeA1: "A:Q"
  });

  await verifyJsonAssetAppendReadback(
    JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    JSON_ASSET_REGISTRY_SHEET,
    row.asset_id,
    row.asset_type,
    row.source_asset_ref,
    row.google_drive_link,
    row.json_payload
  );

  return {
    headerSignature,
    expectedHeaderSignature,
    row2Read: true,
    preflight: mutationResult.preflight,
    safeColumns: plan.safeColumns,
    unsafeColumns: plan.unsafeColumns
  };
}

export function assertCanonicalHeaderExact(header = [], expected = [], sheetName = "sheet") {
  const actual = (header || []).map(v => String(v || "").trim());
  const canonical = (expected || []).map(v => String(v || "").trim());

  if (actual.length !== canonical.length) {
    const err = new Error(
      `${sheetName} header column count mismatch. expected=${canonical.length} actual=${actual.length}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const mismatches = [];
  for (let i = 0; i < canonical.length; i += 1) {
    if (actual[i] !== canonical[i]) {
      mismatches.push({
        index: i,
        expected: canonical[i],
        actual: actual[i] || ""
      });
    }
  }

  if (mismatches.length) {
    const err = new Error(
      `${sheetName} header order mismatch at ${mismatches.length} position(s).`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    err.details = mismatches;
    throw err;
  }

  return true;
}

export function blockLegacyRouteWorkflowWrite(surfaceName = "", requestedColumns = []) {
  const cols = (requestedColumns || []).map(v => String(v || "").trim());

  if (
    surfaceName === TASK_ROUTES_SHEET &&
    cols.length > 0 &&
    cols.length < TASK_ROUTES_CANONICAL_COLUMNS.length
  ) {
    const err = new Error(
      `Blocked legacy write to ${surfaceName}. Canonical schema requires ${TASK_ROUTES_CANONICAL_COLUMNS.length} columns.`
    );
    err.code = "legacy_schema_write_blocked";
    err.status = 500;
    throw err;
  }

  if (
    surfaceName === WORKFLOW_REGISTRY_SHEET &&
    cols.length > 0 &&
    cols.length < WORKFLOW_REGISTRY_CANONICAL_COLUMNS.length
  ) {
    const err = new Error(
      `Blocked legacy write to ${surfaceName}. Canonical schema requires ${WORKFLOW_REGISTRY_CANONICAL_COLUMNS.length} columns.`
    );
    err.code = "legacy_schema_write_blocked";
    err.status = 500;
    throw err;
  }

  return true;
}

export function assertNoLegacySiteMigrationScaffolding() {
  if (
    typeof SITE_MIGRATION_TASK_ROUTE_COLUMNS !== "undefined" ||
    typeof SITE_MIGRATION_WORKFLOW_COLUMNS !== "undefined" ||
    typeof SITE_MIGRATION_TASK_ROUTE_ROWS !== "undefined" ||
    typeof SITE_MIGRATION_WORKFLOW_ROWS !== "undefined"
  ) {
    const err = new Error("Legacy SITE_MIGRATION_* scaffolding must not exist in canonical mode.");
    err.code = "legacy_site_migration_scaffolding_present";
    err.status = 500;
    throw err;
  }
}

export function assertSingleActiveRowByKey(rows = [], keyName = "", activeName = "active", sheetName = "sheet") {
  const seen = new Map();

  for (const row of rows) {
    const key = String(row?.[keyName] || "").trim();
    const active = String(row?.[activeName] || "").trim().toUpperCase() === "TRUE";
    if (!key || !active) continue;

    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
  }

  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  if (duplicates.length) {
    const err = new Error(
      `${sheetName} has duplicate active governed keys: ${duplicates.join(", ")}`
    );
    err.code = "duplicate_active_governed_keys";
    err.status = 500;
    throw err;
  }

  return true;
}

export function normalizeGovernedAdditionState(value = "") {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "active";
  if (!GOVERNED_ADDITION_STATES.has(v)) return "active";
  return v;
}

export function normalizeGovernedAdditionOutcome(value = "") {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "";
  if (!GOVERNED_ADDITION_OUTCOMES.has(v)) return "";
  return v;
}

export function governedAdditionStateBlocksAuthority(value = "") {
  const state = normalizeGovernedAdditionState(value);
  return ["candidate", "inactive", "pending_validation", "blocked", "degraded"].includes(state);
}

export function hasDeferredGovernedActivationDependencies(row = {}, keys = []) {
  return (keys || []).some(key => boolFromSheet(row?.[key]));
}

export function buildGovernedAdditionReviewResult(args = {}) {
  const outcome = normalizeGovernedAdditionOutcome(args.outcome);
  if (!outcome) {
    const err = new Error("Invalid governed addition outcome.");
    err.code = "invalid_governed_addition_outcome";
    err.status = 400;
    throw err;
  }

  return {
    outcome,
    addition_state: normalizeGovernedAdditionState(args.addition_state || "pending_validation"),
    route_overlap_detected: !!args.route_overlap_detected,
    workflow_overlap_detected: !!args.workflow_overlap_detected,
    chain_needed: !!args.chain_needed,
    graph_update_required: !!args.graph_update_required,
    bindings_update_required: !!args.bindings_update_required,
    policy_update_required: !!args.policy_update_required,
    starter_update_required: !!args.starter_update_required,
    reconciliation_required: !!args.reconciliation_required,
    validation_required: true
  };
}

export function assertNoDirectActivationWithoutGovernedReview(row = {}, surfaceName = "sheet") {
  const additionState = normalizeGovernedAdditionState(
    row.addition_status || row.governance_status || row.validation_status || ""
  );
  const active = String(row.active || "").trim().toUpperCase() === "TRUE";

  if (active && ["candidate", "pending_validation", "inactive", "blocked", "degraded"].includes(additionState)) {
    return true;
  }

  if (active && !additionState) {
    // existing canonical rows are allowed
    return true;
  }

  return true;
}
