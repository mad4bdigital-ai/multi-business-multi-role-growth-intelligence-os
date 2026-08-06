import assert from "node:assert/strict";

import { performUniversalServerWriteback } from "./sinkOrchestration.js";

const executionRows = [];
const jsonAssetRows = [];
const warnings = [];
const originalWarn = console.warn;

console.warn = (...args) => {
  warnings.push(args.map((value) => String(value)).join(" "));
};

function buildInput(executionTraceId) {
  return {
    started_at: "2026-08-06T00:00:00.000Z",
    execution_trace_id: executionTraceId,
    responseBody: {
      error: {
        message: "upstream GitHub provider request failed",
      },
    },
    status_source: "failed",
    error_code: "provider_request_failed",
    error_message_short: "upstream GitHub provider request failed",
    endpoint_key: "github_get_git_ref_head",
    parent_action_key: "github_api_mcp",
    source_layer: "system_tool_dispatcher",
    entry_type: "sync_execution",
    execution_class: "sync",
    asset_type: "execution_result",
  };
}

function buildDeps(overrides = {}) {
  return {
    createExecutionTraceId: () => "unexpected-generated-trace",
    isOversizedBody: () => false,
    mapExecutionStatus: (value) => value,
    normalizeExecutionErrorCode: (value) => value,
    classifyExecutionResult: ({ status }) => status,
    extractJsonAssetPayloadBody: ({ response_body }) => response_body,
    isSchemaMetaOnlyPayload: () => false,
    classifyAssetHome: () => ({
      asset_class: "execution_result",
      authoritative_home: "JSON Asset Registry",
      json_asset_allowed: true,
    }),
    persistOversizedArtifactImpl: async () => ({
      drive_file_id: "drive-provider-failure",
      google_drive_link: "https://drive.google.com/file/d/drive-provider-failure/view",
    }),
    toJsonAssetRegistryRow: (value) => ({
      asset_id: `asset-${value.execution_trace_id}`,
      ...value,
    }),
    executionEntryTypes: new Set(["sync_execution"]),
    executionClasses: new Set(["sync"]),
    executionResultClassifications: new Set(["failed"]),
    compactErrorMessage: (value) => value,
    buildOutputSummary: ({ status, error_code }) => `${status}:${error_code}`,
    authoritativeRawExecutionLogSurfaceId: "execution_log_unified",
    assertGovernedSinkSheetsExist: async () => ({
      executionLogTitles: ["Execution Log Unified"],
      jsonAssetTitles: ["JSON Asset Registry"],
    }),
    toExecutionLogUnifiedRow: (value) => ({ ...value }),
    assertExecutionLogRowIsSpillSafe: () => {},
    writeExecutionLogUnifiedRow: async (row) => {
      executionRows.push(row);
      return {
        headerSignature: "execution-log-header",
        row2Read: true,
        formulaManagedColumnsProtected: true,
        safeColumns: [],
        unsafeColumns: [],
      };
    },
    writeJsonAssetRegistryRow: async (row) => {
      jsonAssetRows.push(row);
      return {
        headerSignature: "json-asset-header",
        row2Read: true,
        safeColumns: [],
        unsafeColumns: [],
      };
    },
    executionLogUnifiedSheet: "Execution Log Unified",
    jsonAssetRegistrySheet: "JSON Asset Registry",
    executionLogUnifiedSpreadsheetId: "sql-runtime-authority",
    jsonAssetRegistrySpreadsheetId: "sql-runtime-authority",
    ...overrides,
  };
}

function assertProviderFailurePreserved(result) {
  assert.equal(result.writeback.status, "failed");
  assert.equal(result.writeback.error_code, "provider_request_failed");
  assert.equal(
    result.writeback.error_message_short,
    "upstream GitHub provider request failed",
  );
  assert.equal(result.writeback.output_summary, "failed:provider_request_failed");
  assert.equal(result.governedWriteState.pre_response_log_guard_passed, true);
}

try {
  let sqlLookupCallsInSheetsMode = 0;
  const sheetsResult = await performUniversalServerWriteback(
    buildInput("trace-provider-failure"),
    buildDeps({
      dataSourceMode: "sheets",
      findJsonAssetRows: async () => {
        sqlLookupCallsInSheetsMode += 1;
        throw new Error("SQL lookup must not run in Sheets mode.");
      },
      findExistingJsonAssetByAssetKey: async () => {
        throw new Error("Missing required spreadsheet id for governed sink.");
      },
    }),
  );

  assertProviderFailurePreserved(sheetsResult);
  assert.equal(sqlLookupCallsInSheetsMode, 0);
  assert.equal(executionRows.length, 1);
  assert.equal(executionRows[0].status, "failed");
  assert.equal(jsonAssetRows.length, 1);
  assert.equal(
    sheetsResult.jsonAssetRow.asset_id,
    "asset-trace-provider-failure",
  );
  assert.ok(
    warnings.some(
      (warning) =>
        warning.includes("findExistingJsonAssetByAssetKey failed") &&
        warning.includes("Missing required spreadsheet id for governed sink"),
    ),
  );

  let sheetsLookupCallsInSqlMode = 0;
  let sqlLookupCalls = 0;
  const sqlAssetKey = "github_get_git_ref_head__trace-sql-existing";
  const warningsBeforeSqlLookup = warnings.length;

  const sqlResult = await performUniversalServerWriteback(
    buildInput("trace-sql-existing"),
    buildDeps({
      dataSourceMode: "sql",
      findExistingJsonAssetByAssetKey: async () => {
        sheetsLookupCallsInSqlMode += 1;
        throw new Error("Sheets lookup must not run in SQL mode.");
      },
      findJsonAssetRows: async (sheetName, columnName, value) => {
        sqlLookupCalls += 1;
        assert.equal(sheetName, "JSON Asset Registry");
        assert.equal(columnName, "asset_key");
        assert.equal(value, sqlAssetKey);
        return [
          {
            asset_id: "inactive-existing-asset",
            asset_key: sqlAssetKey,
            active_status: "FALSE",
            transport_status: "drive_stored",
          },
          {
            asset_id: "active-existing-asset",
            asset_key: sqlAssetKey,
            active_status: "1",
            transport_status: "drive_stored",
          },
        ];
      },
    }),
  );

  assertProviderFailurePreserved(sqlResult);
  assert.equal(sqlLookupCalls, 1);
  assert.equal(sheetsLookupCallsInSqlMode, 0);
  assert.equal(executionRows.length, 2);
  assert.equal(jsonAssetRows.length, 1);
  assert.equal(sqlResult.jsonAssetRow, undefined);
  assert.equal(warnings.length, warningsBeforeSqlLookup);
} finally {
  console.warn = originalWarn;
}

console.log(
  "sink orchestration JSON asset lookup failure and SQL authority regression passed",
);
