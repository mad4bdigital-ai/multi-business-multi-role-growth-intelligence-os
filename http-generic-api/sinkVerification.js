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

export async function verifyAppendReadback(args = {}, deps = {}) {
  const {
    spreadsheetId,
    sheetName,
    expectedStartTime,
    expectedSummary,
    expectedStatus,
    expectedEntryType,
    expectedArtifactJsonAssetId = "",
    expectedRawWriteback = {},
    expectedLogicEvidence = {},
    expectedEngineEvidence = {}
  } = args;
  const {
    getGoogleClientsForSpreadsheet,
    toValuesApiRange,
    headerMap
  } = deps;

  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, "A:BD")
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
  const usedLogicIdIdx = map["used_logic_id"];
  const usedLogicNameIdx = map["used_logic_name"];
  const resolvedLogicDocIdIdx = map["resolved_logic_doc_id"];
  const resolvedLogicModeIdx = map["resolved_logic_mode"];
  const logicPointerResolutionStatusIdx = map["logic_pointer_resolution_status"];
  const logicKnowledgeStatusIdx = map["logic_knowledge_status"];
  const logicRollbackStatusIdx = map["logic_rollback_status"];
  const logicAssociationStatusIdx = map["logic_association_status"];
  const usedEngineNamesIdx = map["used_engine_names"];
  const usedEngineRegistryRefsIdx = map["used_engine_registry_refs"];
  const usedEngineFileIdsIdx = map["used_engine_file_ids"];
  const engineResolutionStatusIdx = map["engine_resolution_status"];
  const engineAssociationStatusIdx = map["engine_association_status"];

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
    const usedLogicId =
      usedLogicIdIdx === undefined ? "" : String(row[usedLogicIdIdx] || "").trim();
    const usedLogicName =
      usedLogicNameIdx === undefined ? "" : String(row[usedLogicNameIdx] || "").trim();
    const resolvedLogicDocId =
      resolvedLogicDocIdIdx === undefined ? "" : String(row[resolvedLogicDocIdIdx] || "").trim();
    const resolvedLogicMode =
      resolvedLogicModeIdx === undefined ? "" : String(row[resolvedLogicModeIdx] || "").trim();
    const logicPointerResolutionStatus =
      logicPointerResolutionStatusIdx === undefined
        ? ""
        : String(row[logicPointerResolutionStatusIdx] || "").trim();
    const logicKnowledgeStatus =
      logicKnowledgeStatusIdx === undefined ? "" : String(row[logicKnowledgeStatusIdx] || "").trim();
    const logicRollbackStatus =
      logicRollbackStatusIdx === undefined ? "" : String(row[logicRollbackStatusIdx] || "").trim();
    const logicAssociationStatus =
      logicAssociationStatusIdx === undefined ? "" : String(row[logicAssociationStatusIdx] || "").trim();
    const usedEngineNames =
      usedEngineNamesIdx === undefined ? "" : String(row[usedEngineNamesIdx] || "").trim();
    const usedEngineRegistryRefs =
      usedEngineRegistryRefsIdx === undefined ? "" : String(row[usedEngineRegistryRefsIdx] || "").trim();
    const usedEngineFileIds =
      usedEngineFileIdsIdx === undefined ? "" : String(row[usedEngineFileIdsIdx] || "").trim();
    const engineResolutionStatus =
      engineResolutionStatusIdx === undefined ? "" : String(row[engineResolutionStatusIdx] || "").trim();
    const engineAssociationStatus =
      engineAssociationStatusIdx === undefined ? "" : String(row[engineAssociationStatusIdx] || "").trim();

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
      performanceImpactRowWriteback === String(expectedRawWriteback.performance_impact_row_writeback || "").trim() &&
      usedLogicId === String(expectedLogicEvidence.used_logic_id || "").trim() &&
      usedLogicName === String(expectedLogicEvidence.used_logic_name || "").trim() &&
      resolvedLogicDocId === String(expectedLogicEvidence.resolved_logic_doc_id || "").trim() &&
      resolvedLogicMode === String(expectedLogicEvidence.resolved_logic_mode || "").trim() &&
      logicPointerResolutionStatus === String(expectedLogicEvidence.logic_pointer_resolution_status || "").trim() &&
      logicKnowledgeStatus === String(expectedLogicEvidence.logic_knowledge_status || "").trim() &&
      logicRollbackStatus === String(expectedLogicEvidence.logic_rollback_status || "").trim() &&
      logicAssociationStatus === String(expectedLogicEvidence.logic_association_status || "").trim() &&
      usedEngineNames === String(expectedEngineEvidence.used_engine_names || "").trim() &&
      usedEngineRegistryRefs === String(expectedEngineEvidence.used_engine_registry_refs || "").trim() &&
      usedEngineFileIds === String(expectedEngineEvidence.used_engine_file_ids || "").trim() &&
      engineResolutionStatus === String(expectedEngineEvidence.engine_resolution_status || "").trim() &&
      engineAssociationStatus === String(expectedEngineEvidence.engine_association_status || "").trim()
    );
  });

  if (!matched) {
    const err = new Error(`${sheetName} readback could not verify appended row.`);
    err.code = "sheet_readback_verification_failed";
    err.status = 500;
    throw err;
  }
}

export async function verifyJsonAssetAppendReadback(args = {}, deps = {}) {
  const {
    spreadsheetId,
    sheetName,
    expectedAssetId,
    expectedAssetType,
    expectedSourceAssetRef,
    expectedGoogleDriveLink,
    expectedJsonPayload = ""
  } = args;
  const {
    getGoogleClientsForSpreadsheet,
    toValuesApiRange,
    headerMap
  } = deps;

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

export async function writeExecutionLogUnifiedRow(row, deps = {}) {
  const {
    getGoogleClients,
    readLiveSheetShape,
    executionLogUnifiedSpreadsheetId,
    executionLogUnifiedSheet,
    executionLogUnifiedRange,
    assertExpectedColumnsPresent,
    executionLogUnifiedColumns,
    computeHeaderSignature,
    buildGovernedWritePlan,
    protectedUnifiedLogColumns,
    assertExecutionLogFormulaColumnsProtected,
    performGovernedSheetMutation,
    verifyAppendReadbackImpl
  } = deps;

  const { sheets } = await getGoogleClients();

  const live = await readLiveSheetShape(
    executionLogUnifiedSpreadsheetId,
    executionLogUnifiedSheet,
    executionLogUnifiedRange
  );

  assertExpectedColumnsPresent(
    live.header,
    executionLogUnifiedColumns,
    executionLogUnifiedSheet
  );

  if (live.columnCount < executionLogUnifiedColumns.length) {
    const err = new Error(
      `${executionLogUnifiedSheet} column count is lower than expected.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const expectedHeaderSignature = computeHeaderSignature(
    executionLogUnifiedColumns
  );
  const alignedLiveHeaderSignature = computeHeaderSignature(
    live.header.slice(0, executionLogUnifiedColumns.length)
  );
  const headerSignature = computeHeaderSignature(live.header);
  if (!headerSignature || !expectedHeaderSignature) {
    const err = new Error(
      `${executionLogUnifiedSheet} header signature could not be computed.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
  if (alignedLiveHeaderSignature !== expectedHeaderSignature) {
    const err = new Error(
      `${executionLogUnifiedSheet} header signature mismatch.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const plan = buildGovernedWritePlan({
    sheetName: executionLogUnifiedSheet,
    header: live.header,
    row2: live.row2,
    requestedColumns: executionLogUnifiedColumns,
    protectedColumns: protectedUnifiedLogColumns
  });

  assertExecutionLogFormulaColumnsProtected(
    plan,
    executionLogUnifiedSheet
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: executionLogUnifiedSpreadsheetId,
    sheetName: executionLogUnifiedSheet,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: plan.safeColumns,
    scanRangeA1: "A:BD"
  });

  await verifyAppendReadbackImpl({
    spreadsheetId: executionLogUnifiedSpreadsheetId,
    sheetName: executionLogUnifiedSheet,
    expectedStartTime: row["Start Time"],
    expectedSummary: row["Output Summary"],
    expectedStatus: row["Execution Status"],
    expectedEntryType: row["Entry Type"],
    expectedArtifactJsonAssetId: row.artifact_json_asset_id,
    expectedRawWriteback: {
      target_module_writeback: row.target_module_writeback,
      target_workflow_writeback: row.target_workflow_writeback,
      execution_trace_id_writeback: row.execution_trace_id_writeback,
      log_source_writeback: row.log_source_writeback,
      monitored_row_writeback: row.monitored_row_writeback,
      performance_impact_row_writeback: row.performance_impact_row_writeback
    },
    expectedLogicEvidence: {
      used_logic_id: row.used_logic_id,
      used_logic_name: row.used_logic_name,
      resolved_logic_doc_id: row.resolved_logic_doc_id,
      resolved_logic_mode: row.resolved_logic_mode,
      logic_pointer_resolution_status: row.logic_pointer_resolution_status,
      logic_knowledge_status: row.logic_knowledge_status,
      logic_rollback_status: row.logic_rollback_status,
      logic_association_status: row.logic_association_status
    },
    expectedEngineEvidence: {
      used_engine_names: row.used_engine_names,
      used_engine_registry_refs: row.used_engine_registry_refs,
      used_engine_file_ids: row.used_engine_file_ids,
      engine_resolution_status: row.engine_resolution_status,
      engine_association_status: row.engine_association_status
    }
  });

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

export async function writeJsonAssetRegistryRow(row, deps = {}) {
  const {
    getGoogleClients,
    readLiveSheetShape,
    jsonAssetRegistrySpreadsheetId,
    jsonAssetRegistrySheet,
    jsonAssetRegistryRange,
    assertExpectedColumnsPresent,
    jsonAssetRegistryColumns,
    computeHeaderSignature,
    buildGovernedWritePlan,
    performGovernedSheetMutation,
    verifyJsonAssetAppendReadbackImpl
  } = deps;

  const { sheets } = await getGoogleClients();

  const live = await readLiveSheetShape(
    jsonAssetRegistrySpreadsheetId,
    jsonAssetRegistrySheet,
    jsonAssetRegistryRange
  );

  assertExpectedColumnsPresent(
    live.header,
    jsonAssetRegistryColumns,
    jsonAssetRegistrySheet
  );

  if (live.columnCount < jsonAssetRegistryColumns.length) {
    const err = new Error(
      `${jsonAssetRegistrySheet} column count is lower than expected.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const expectedHeaderSignature = computeHeaderSignature(
    jsonAssetRegistryColumns
  );
  const alignedLiveHeaderSignature = computeHeaderSignature(
    live.header.slice(0, jsonAssetRegistryColumns.length)
  );
  const headerSignature = computeHeaderSignature(live.header);
  if (!headerSignature || !expectedHeaderSignature) {
    const err = new Error(
      `${jsonAssetRegistrySheet} header signature could not be computed.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
  if (alignedLiveHeaderSignature !== expectedHeaderSignature) {
    const err = new Error(
      `${jsonAssetRegistrySheet} header signature mismatch.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const plan = buildGovernedWritePlan({
    sheetName: jsonAssetRegistrySheet,
    header: live.header,
    row2: live.row2,
    requestedColumns: jsonAssetRegistryColumns,
    protectedColumns: new Set()
  });

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: jsonAssetRegistrySpreadsheetId,
    sheetName: jsonAssetRegistrySheet,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: plan.safeColumns,
    scanRangeA1: "A:Q"
  });

  await verifyJsonAssetAppendReadbackImpl({
    spreadsheetId: jsonAssetRegistrySpreadsheetId,
    sheetName: jsonAssetRegistrySheet,
    expectedAssetId: row.asset_id,
    expectedAssetType: row.asset_type,
    expectedSourceAssetRef: row.source_asset_ref,
    expectedGoogleDriveLink: row.google_drive_link,
    expectedJsonPayload: row.json_payload
  });

  return {
    headerSignature,
    expectedHeaderSignature,
    row2Read: true,
    preflight: mutationResult.preflight,
    safeColumns: plan.safeColumns,
    unsafeColumns: plan.unsafeColumns
  };
}
