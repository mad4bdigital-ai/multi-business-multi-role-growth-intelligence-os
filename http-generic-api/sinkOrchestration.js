export async function persistOversizedArtifact(input = {}, deps = {}) {
  const {
    getGoogleClients,
    buildArtifactFileName,
    oversizedArtifactsDriveFolderId
  } = deps;

  if (typeof getGoogleClients !== "function") {
    throw new Error("persistOversizedArtifact requires deps.getGoogleClients");
  }
  if (typeof buildArtifactFileName !== "function") {
    throw new Error("persistOversizedArtifact requires deps.buildArtifactFileName");
  }

  const { drive } = await getGoogleClients();
  const artifact_file_name = buildArtifactFileName({
    brand_name: input.brand_name || input.target_key || "unknown_brand",
    endpoint_key: input.endpoint_key,
    captured_at: input.captured_at,
    execution_trace_id: input.execution_trace_id
  });

  const requestBody = {
    name: artifact_file_name,
    mimeType: "application/json"
  };

  if (oversizedArtifactsDriveFolderId) {
    requestBody.parents = [oversizedArtifactsDriveFolderId];
  }

  const created = await drive.files.create({
    requestBody,
    media: {
      mimeType: "application/json",
      body: JSON.stringify(input.body ?? null, null, 2)
    },
    fields: "id,webViewLink"
  });

  const drive_file_id = String(created?.data?.id || "").trim();
  if (!drive_file_id) {
    throw new Error("Oversized artifact write succeeded without a Drive file id.");
  }

  return {
    drive_file_id,
    google_drive_link:
      String(created?.data?.webViewLink || "").trim() ||
      `https://drive.google.com/file/d/${drive_file_id}/view`,
    artifact_file_name
  };
}

export async function performUniversalServerWriteback(input = {}, deps = {}) {
  const {
    createExecutionTraceId,
    isOversizedBody,
    mapExecutionStatus,
    normalizeExecutionErrorCode,
    classifyExecutionResult,
    extractJsonAssetPayloadBody,
    isSchemaMetaOnlyPayload,
    classifyAssetHome,
    persistOversizedArtifactImpl,
    findExistingJsonAssetByAssetKey,
    toJsonAssetRegistryRow,
    executionEntryTypes,
    executionClasses,
    executionResultClassifications,
    compactErrorMessage,
    buildOutputSummary,
    authoritativeRawExecutionLogSurfaceId,
    assertGovernedSinkSheetsExist,
    toExecutionLogUnifiedRow,
    assertExecutionLogRowIsSpillSafe,
    writeExecutionLogUnifiedRow,
    writeJsonAssetRegistryRow,
    executionLogUnifiedSheet,
    jsonAssetRegistrySheet,
    executionLogUnifiedSpreadsheetId,
    jsonAssetRegistrySpreadsheetId
  } = deps;

  if (typeof createExecutionTraceId !== "function") {
    throw new Error("performUniversalServerWriteback requires deps.createExecutionTraceId");
  }

  const started_at = input.started_at || new Date().toISOString();
  const execution_trace_id = input.execution_trace_id ?? createExecutionTraceId();
  const responseBody = input.responseBody;

  const completed_at = new Date().toISOString();
  const durationMs =
    new Date(completed_at).getTime() - new Date(started_at).getTime();
  const duration_seconds =
    Number.isFinite(durationMs) && durationMs >= 0
      ? durationMs / 1000
      : undefined;

  const oversized = isOversizedBody(responseBody);
  const status = mapExecutionStatus(input.status_source);
  const error_code = normalizeExecutionErrorCode(input.error_code);
  const result_classification = classifyExecutionResult({
    status,
    error_code,
    oversized,
    async_mode: input.mode === "async"
  });

  let artifactPointer;
  let jsonAssetRow;
  let artifactJsonAssetId = "";

  const extractedJsonAssetBody = extractJsonAssetPayloadBody({
    parent_action_key: input.parent_action_key,
    response_body: responseBody
  });

  const isMeaningfulJsonAssetBody =
    Array.isArray(extractedJsonAssetBody) ||
    (
      extractedJsonAssetBody &&
      typeof extractedJsonAssetBody === "object" &&
      Object.keys(extractedJsonAssetBody).length > 0 &&
      !isSchemaMetaOnlyPayload(extractedJsonAssetBody)
    );

  const assetHome = classifyAssetHome({
    asset_type: input.asset_type,
    endpoint_key: input.endpoint_key,
    source_asset_ref: input.source_asset_ref,
    asset_key: input.asset_key
  });

  const shouldPersistJsonAsset =
    assetHome.json_asset_allowed &&
    (
      oversized ||
      status === "failed" ||
      (
        status === "success" &&
        isMeaningfulJsonAssetBody
      )
    );

  if (oversized) {
    const artifact = await persistOversizedArtifactImpl({
      brand_name: input.brand_name,
      target_key: input.target_key,
      endpoint_key: input.endpoint_key,
      execution_trace_id,
      captured_at: started_at,
      body: extractedJsonAssetBody
    });

    artifactPointer = {
      drive_file_id: artifact.drive_file_id,
      google_drive_link: artifact.google_drive_link
    };
  }

  if (shouldPersistJsonAsset) {
    const nextAssetKey = `${String(input.endpoint_key || "unknown_endpoint").trim()}__${execution_trace_id}`;
    const existingAssetRow = await findExistingJsonAssetByAssetKey(nextAssetKey);

    if (!existingAssetRow) {
      jsonAssetRow = toJsonAssetRegistryRow({
        brand_name: input.brand_name,
        endpoint_key: input.endpoint_key,
        parent_action_key: input.parent_action_key,
        execution_trace_id,
        google_drive_link: artifactPointer?.google_drive_link || "",
        drive_file_id: artifactPointer?.drive_file_id || "",
        captured_at: completed_at,
        job_id: input.job_id,
        oversized,
        response_body: extractedJsonAssetBody,
        cpt_slug: input.cpt_slug || "",
        asset_type: input.asset_type || assetHome.asset_class,
        asset_key: input.asset_key || `${String(input.endpoint_key || "unknown_endpoint").trim()}__${execution_trace_id}`,
        source_asset_ref: input.source_asset_ref || ""
      });

      artifactJsonAssetId = String(jsonAssetRow.asset_id || "").trim();
    }
  }

  const writeback = {
    execution_trace_id,
    job_id: input.job_id,
    target_key: input.target_key,
    parent_action_key: input.parent_action_key,
    endpoint_key: input.endpoint_key,
    response_body_embedded: !oversized,
    response_body_oversized: oversized,
    route_id: input.route_id,
    target_module: input.target_module,
    target_workflow: input.target_workflow,
    entry_type: oversized
      ? "oversized_capture"
      : executionEntryTypes.has(input.entry_type)
      ? input.entry_type
      : "sync_execution",
    execution_class: oversized
      ? "oversized"
      : executionClasses.has(input.execution_class)
      ? input.execution_class
      : "sync",
    source_layer: String(input.source_layer || "unknown_layer"),
    status,
    result_classification: executionResultClassifications.has(result_classification)
      ? result_classification
      : "unresolved",
    error_code: error_code || undefined,
    error_message_short: compactErrorMessage(input.error_message_short) || undefined,
    started_at,
    completed_at,
    duration_seconds,
    attempt_count:
      input.attempt_count === undefined || input.attempt_count === null
        ? undefined
        : Number(input.attempt_count),
    output_summary: buildOutputSummary({
      endpoint_key: input.endpoint_key,
      status,
      http_status: input.http_status,
      error_code,
      oversized
    }),
    monitored_row: false,
    performance_impact_row: false,
    log_source: authoritativeRawExecutionLogSurfaceId,
    artifact_pointer: artifactPointer,
    artifact_json_asset_id: artifactJsonAssetId,

    // governed logic evidence
    used_logic_id: input.used_logic_id ?? input.logic_id ?? "",
    used_logic_name: input.used_logic_name ?? input.logic_name ?? "",
    resolved_logic_doc_id: input.resolved_logic_doc_id ?? "",
    resolved_logic_mode: input.resolved_logic_mode ?? "",
    logic_pointer_resolution_status: input.logic_pointer_resolution_status ?? "",
    logic_knowledge_status: input.logic_knowledge_status ?? "",
    logic_rollback_status: input.logic_rollback_status ?? "",
    logic_association_status: input.logic_association_status ?? "unknown",

    // governed engine evidence
    used_engine_names:
      input.used_engine_names ??
      input.engine_chain ??
      input.engine_names ??
      "",
    used_engine_registry_refs: input.used_engine_registry_refs ?? "",
    used_engine_file_ids: input.used_engine_file_ids ?? "",
    engine_resolution_status: input.engine_resolution_status ?? "",
    engine_association_status: input.engine_association_status ?? "unknown"
  };

  let governedSinkSheetTitles = {
    executionLogTitles: [],
    jsonAssetTitles: []
  };
  try {
    governedSinkSheetTitles = await assertGovernedSinkSheetsExist();
  } catch (err) {
    err.error_code = "governed_sink_sheet_missing";
    throw err;
  }

  const row = toExecutionLogUnifiedRow(writeback);
  let executionLogWriteMeta;
  let jsonAssetWriteMeta;
  let workflowLogRetryAttempted = false;
  assertExecutionLogRowIsSpillSafe(row);

  try {
    executionLogWriteMeta = await writeExecutionLogUnifiedRow(row);
  } catch (err) {
    workflowLogRetryAttempted = true;
    try {
      executionLogWriteMeta = await writeExecutionLogUnifiedRow(row);
    } catch (retryErr) {
      retryErr.error_code =
        retryErr.error_code || err.error_code || "authoritative_log_write_failed";
      retryErr.logging_retry_attempted = true;
      retryErr.logging_retry_exhausted = true;
      throw retryErr;
    }
  }

  if (jsonAssetRow) {
    try {
      jsonAssetWriteMeta = await writeJsonAssetRegistryRow(jsonAssetRow);
    } catch (err) {
      console.error("JSON Asset Registry write failed", err);
    }
  }

  const governedWriteState = {
    execution_log_surface_id: authoritativeRawExecutionLogSurfaceId,
    execution_log_sheet: executionLogUnifiedSheet,
    json_asset_registry_sheet: jsonAssetRegistrySheet,
    execution_log_spreadsheet_id: executionLogUnifiedSpreadsheetId,
    json_asset_registry_spreadsheet_id: jsonAssetRegistrySpreadsheetId,
    authoritative_raw_execution_sink: authoritativeRawExecutionLogSurfaceId,
    raw_execution_single_write_enforced: true,
    execution_log_sheet_exists: governedSinkSheetTitles.executionLogTitles.includes(
      String(executionLogUnifiedSheet || "").trim()
    ),
    json_asset_registry_sheet_exists: governedSinkSheetTitles.jsonAssetTitles.includes(
      String(jsonAssetRegistrySheet || "").trim()
    ),
    execution_log_header_schema_validated: !!executionLogWriteMeta?.headerSignature,
    execution_log_row2_template_read: !!executionLogWriteMeta?.row2Read,
    execution_log_formula_managed_columns_protected:
      !!executionLogWriteMeta?.formulaManagedColumnsProtected,
    execution_log_readback_verified: true,
    workflow_log_retry_attempted: workflowLogRetryAttempted,
    workflow_log_retry_exhausted: false,
    json_asset_header_schema_validated: jsonAssetRow
      ? !!jsonAssetWriteMeta?.headerSignature
      : null,
    json_asset_row2_template_read: jsonAssetRow
      ? !!jsonAssetWriteMeta?.row2Read
      : null,
    json_asset_readback_verified: jsonAssetRow
      ? !!jsonAssetWriteMeta
      : null,
    prewrite_header_schema_validated:
      !!executionLogWriteMeta?.headerSignature &&
      (jsonAssetRow ? !!jsonAssetWriteMeta?.headerSignature : true),
    prewrite_row2_template_read:
      !!executionLogWriteMeta?.row2Read &&
      (jsonAssetRow ? !!jsonAssetWriteMeta?.row2Read : true),
    execution_log_safe_columns: executionLogWriteMeta?.safeColumns || [],
    execution_log_unsafe_columns: executionLogWriteMeta?.unsafeColumns || [],
    json_asset_safe_columns: jsonAssetWriteMeta?.safeColumns || [],
    json_asset_unsafe_columns: jsonAssetWriteMeta?.unsafeColumns || [],
    asset_class: assetHome.asset_class,
    authoritative_asset_home: assetHome.authoritative_home,
    json_asset_write_allowed: assetHome.json_asset_allowed,
    artifact_json_asset_id: jsonAssetRow?.asset_id || "",
    artifact_drive_file_id: artifactPointer?.drive_file_id || "",
    artifact_google_drive_link: artifactPointer?.google_drive_link || ""
  };

  return {
    execution_trace_id,
    writeback,
    row,
    jsonAssetRow,
    governedWriteState
  };
}
