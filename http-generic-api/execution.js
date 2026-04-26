// Auto-extracted from server.js — do not edit manually, use domain logic here.
import crypto from "node:crypto";
import YAML from "yaml";
import { promises as fs } from "fs";
import { google } from "googleapis";
import {
  REGISTRY_SPREADSHEET_ID, ACTIVITY_SPREADSHEET_ID, BRAND_REGISTRY_SHEET,
  ACTIONS_REGISTRY_SHEET, ENDPOINT_REGISTRY_SHEET, EXECUTION_POLICY_SHEET,
  HOSTING_ACCOUNT_REGISTRY_SHEET, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET,
  SITE_SETTINGS_INVENTORY_REGISTRY_SHEET, PLUGIN_INVENTORY_REGISTRY_SHEET,
  TASK_ROUTES_SHEET, WORKFLOW_REGISTRY_SHEET, REGISTRY_SURFACES_CATALOG_SHEET,
  VALIDATION_REPAIR_REGISTRY_SHEET, EXECUTION_LOG_UNIFIED_SHEET,
  JSON_ASSET_REGISTRY_SHEET, BRAND_CORE_REGISTRY_SHEET,
  EXECUTION_LOG_UNIFIED_SPREADSHEET_ID, JSON_ASSET_REGISTRY_SPREADSHEET_ID,
  OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID, RAW_BODY_MAX_BYTES, MAX_TIMEOUT_SECONDS,
  SERVICE_VERSION, GITHUB_API_BASE_URL, GITHUB_TOKEN, GITHUB_BLOB_CHUNK_MAX_LENGTH,
  DEFAULT_JOB_MAX_ATTEMPTS, JOB_WEBHOOK_TIMEOUT_MS, JOB_RETRY_DELAYS_MS,
  ACTIVATION_BOOTSTRAP_CONFIG_RANGE, ACTIVATION_WORKBOOK_CACHE_TTL_SECONDS,
  ACTIVATION_BOOTSTRAP_ROW_CACHE_TTL_SECONDS, ACTIVATION_SHEETS_429_BACKOFF_SECONDS
} from "./config.js";
import { policyValue, policyList } from "./registryResolution.js";
import {
  getCachedValue,
  setCachedValue,
  getActivationBackoffUntil,
  setActivationBackoffUntil,
  makeActivationWorkbookCacheKey,
  makeActivationBootstrapRowCacheKey,
  makeActivationSheetsBackoffKey
} from "./activationBootstrapCache.js";

export function retryMutationEnabled(policies = []) {
  return String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Mutation Enabled", "FALSE")
  ).trim().toUpperCase() === "TRUE";
}

export function retryMutationAppliesToQuery(policies = []) {
  return String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Mutation Apply To", "")
  ).trim() === "query";
}

export function retryMutationSchemaModeAllowlisted(policies = []) {
  return String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Mutation Schema Mode", "")
  ).trim() === "allowlisted";
}

export function parseRetryStageValue(stageValue = "") {
  const raw = String(stageValue || "").trim();
  if (!raw || raw === "{}") return {};

  const mutation = {};
  const pairs = raw
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const [rawKey, rawValue] = pair.split("=");
    const key = String(rawKey || "").trim();
    const value = String(rawValue || "").trim().toLowerCase();

    if (!key) continue;
    if (!PREMIUM_RETRY_MUTATION_KEYS.has(key)) continue;

    if (value === "true") mutation[key] = true;
    else if (value === "false") mutation[key] = false;
    else mutation[key] = String(rawValue || "").trim();
  }

  return mutation;
}

export function stripRoutingOnlyTransportFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripRoutingOnlyTransportFields);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const cleaned = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (ROUTING_ONLY_TRANSPORT_FIELDS.has(String(key || "").trim())) {
      continue;
    }
    cleaned[key] = stripRoutingOnlyTransportFields(nestedValue);
  }

  return cleaned;
}

export function finalizeTransportBody(body) {
  if (body === undefined) return undefined;
  if (body === null) return null;
  if (Array.isArray(body)) return stripRoutingOnlyTransportFields(body);
  if (typeof body !== "object") return body;
  return stripRoutingOnlyTransportFields(body);
}

export function mapExecutionStatus(jobStatus) {
  const status = String(jobStatus || "").trim().toLowerCase();
  switch (status) {
    case "queued":
      return "pending";
    case "running":
      return "running";
    case "succeeded":
      return "success";
    case "failed":
      return "failed";
    case "retrying":
      return "retrying";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

export function classifyExecutionResult(args = {}) {
  if (args.oversized) return "oversized_live";
  if (args.error_code === "worker_timeout") return "timeout_live";
  if (args.error_code === "auth_failed") return "auth_failed";
  if (args.error_code === "failed_validation") return "failed_validation";
  if (args.error_code === "transport_failed") return "transport_failed";
  if (args.status === "success" && args.async_mode) return "resolved_async";
  if (args.status === "success") return "resolved_sync";
  return "unresolved";
}

export function buildOutputSummary(args = {}) {
  if (args.oversized) {
    return `Oversized response captured for ${args.endpoint_key ?? "unknown_endpoint"}`;
  }
  if (args.error_code) {
    return `${args.endpoint_key ?? "unknown_endpoint"} failed: ${args.error_code}`;
  }
  return `${args.endpoint_key ?? "unknown_endpoint"} completed with status ${args.status}${args.http_status ? ` (${args.http_status})` : ""}`;
}

export function isOversizedBody(value) {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
    return bytes > RAW_BODY_MAX_BYTES;
  } catch {
    return true;
  }
}

export function buildArtifactFileName(input = {}) {
  const brand = (input.brand_name ?? "unknown_brand")
    .replace(/\s+/g, "_")
    .toLowerCase();
  const endpoint = (input.endpoint_key ?? "unknown_endpoint")
    .replace(/\s+/g, "_")
    .toLowerCase();
  const ts = String(input.captured_at || nowIso()).replace(/[:.]/g, "-");
  return `${brand}__${endpoint}__${ts}__${input.execution_trace_id}.json`;
}

export function toExecutionLogUnifiedRow(w) {
  const start = new Date(w.started_at);
  const end = w.completed_at ? new Date(w.completed_at) : undefined;

  return {
    "Run Date": start.toISOString().slice(0, 10),
    "Start Time": start.toISOString(),
    "End Time": end ? end.toISOString() : "",
    "Duration Seconds": w.duration_seconds ?? "",
    "Entry Type": w.entry_type,
    "Execution Class": w.execution_class,
    "Source Layer": w.source_layer,
    "User Input": "",
    "Matched Aliases": "",
    "Route Key(s)": "",
    "Selected Workflows": "",
    "Engine Chain": "",
    "Execution Mode": "",
    "Decision Trigger": "",
    "Score Before": "",
    "Score After": "",
    "Performance Delta": "",
    "Execution Status": w.status,
    "Output Summary": w.output_summary,
    "Recovery Status": "",
    "Recovery Score": "",
    "Recovery Notes": "",
    route_id: w.route_id ?? "",
    route_status: "",
    route_source: "",
    matched_row_id: "",
    intake_validation_status: "",
    execution_ready_status: "",
    failure_reason: w.error_code ?? "",
    recovery_action: "",

    artifact_json_asset_id: w.artifact_json_asset_id ?? "",

    // raw writeback columns
    target_module_writeback: w.target_module ?? "",
    target_workflow_writeback: w.target_workflow ?? "",
    execution_trace_id_writeback: w.execution_trace_id ?? "",
    log_source_writeback: w.log_source ?? "",
    monitored_row_writeback:
      w.monitored_row === undefined || w.monitored_row === null
        ? ""
        : (w.monitored_row ? "TRUE" : "FALSE"),
    performance_impact_row_writeback:
      w.performance_impact_row === undefined || w.performance_impact_row === null
        ? ""
        : (w.performance_impact_row ? "TRUE" : "FALSE")
  };
}

export function createJsonAssetId() {
  return `JSON-ASSET-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

export function toJsonAssetRegistryRow(args = {}) {
  const asset_id = createJsonAssetId();
  const brand = args.brand_name ?? "Unknown Brand";
  const endpoint = args.endpoint_key ?? "unknown_endpoint";
  const inferred_asset_type =
    String(args.parent_action_key || "").trim() === "wordpress_api"
      ? inferWordpressInventoryAssetType(args.endpoint_key)
      : args.job_id
      ? "raw_queue_response_body"
      : "raw_sync_response_body";
  const asset_type = String(args.asset_type || inferred_asset_type).trim();
  const oversized = !!args.oversized;
  const payloadBody = extractJsonAssetPayloadBody(args);
  const embeddedPayload = oversized
    ? ""
    : JSON.stringify(payloadBody ?? null);
  const assetHome = assertJsonAssetWriteAllowed({
    ...args,
    endpoint_key: endpoint,
    asset_type,
    asset_key: args.asset_key || `${endpoint}__${args.execution_trace_id}`
  });

  return {
    asset_id,
    brand_name: brand,
    asset_key: args.asset_key || `${endpoint}__${args.execution_trace_id}`,
    asset_type,
    cpt_slug: args.cpt_slug || "",
    mapping_status: "captured_unreduced",
    mapping_version: oversized
      ? "response_body_artifact_v2"
      : "response_body_embedded_v2",
    storage_format: "json",
    google_drive_link: oversized ? args.google_drive_link : "",
    source_mode: "server_writeback_artifact",
    source_asset_ref: oversized ? args.drive_file_id : "",
    json_payload: embeddedPayload,
    transport_status: oversized ? "captured_external" : "captured_embedded",
    validation_status: "pending",
    last_validated_at: args.captured_at,
    notes: oversized
      ? `Oversized derived JSON artifact captured for execution_trace_id=${args.execution_trace_id}; authoritative_home=${assetHome.authoritative_home}`
      : `Embedded derived JSON artifact captured for execution_trace_id=${args.execution_trace_id}; authoritative_home=${assetHome.authoritative_home}`,
    active_status: "TRUE"
  };
}

export function inferWordpressInventoryAssetType(endpointKey = "") {
  const key = String(endpointKey || "").trim();

  if (key === "wordpress_list_tags") return "wordpress_taxonomy_inventory";
  if (key === "wordpress_list_categories") return "wordpress_taxonomy_inventory";
  if (key === "wordpress_list_types") return "wordpress_cpt_inventory";

  return "wordpress_runtime_response";
}

export function normalizeAssetType(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function isDerivedJsonArtifactAssetType(assetType = "") {
  return normalizeAssetType(assetType) === "derived_json_artifact";
}

export function isBrandCoreOperationalAssetType(assetType = "") {
  return BRAND_CORE_OPERATIONAL_ASSET_TYPES.has(normalizeAssetType(assetType));
}

export function classifyAssetHome(args = {}) {
  const explicitAssetType = normalizeAssetType(args.asset_type);
  const endpointKey = String(args.endpoint_key || "").trim();
  const sourceAssetRef = String(args.source_asset_ref || "").trim();
  const assetKey = String(args.asset_key || "").trim();

  if (isDerivedJsonArtifactAssetType(explicitAssetType)) {
    return {
      asset_class: "derived_json_artifact",
      authoritative_home: "json_asset_registry",
      json_asset_allowed: true
    };
  }

  if (
    isBrandCoreOperationalAssetType(explicitAssetType) ||
    /^brand_site_profile/i.test(assetKey) ||
    /^brand_publish_playbook/i.test(assetKey) ||
    /^brand_multilingual_import_template/i.test(assetKey) ||
    /^profile_asset/i.test(assetKey) ||
    /^playbook_asset/i.test(assetKey) ||
    /^import_template_asset/i.test(assetKey) ||
    /^composed_payload_asset/i.test(assetKey) ||
    /^brand_site_profile/i.test(sourceAssetRef) ||
    /^brand_publish_playbook/i.test(sourceAssetRef) ||
    /^brand_multilingual_import_template/i.test(sourceAssetRef) ||
    /^profile_asset/i.test(sourceAssetRef) ||
    /^playbook_asset/i.test(sourceAssetRef) ||
    /^import_template_asset/i.test(sourceAssetRef) ||
    /^composed_payload_asset/i.test(sourceAssetRef)
  ) {
    return {
      asset_class: explicitAssetType || "brand_core_operational_asset",
      authoritative_home: "brand_core_registry",
      json_asset_allowed: false
    };
  }

  if (
    endpointKey === "wordpress_list_tags" ||
    endpointKey === "wordpress_list_categories" ||
    endpointKey === "wordpress_list_types"
  ) {
    return {
      asset_class: normalizeAssetType(inferWordpressInventoryAssetType(endpointKey)),
      authoritative_home: "json_asset_registry",
      json_asset_allowed: true
    };
  }

  return {
    asset_class: explicitAssetType || "derived_json_artifact",
    authoritative_home: "json_asset_registry",
    json_asset_allowed: true
  };
}

export function assertJsonAssetWriteAllowed(args = {}) {
  const classification = classifyAssetHome(args);

  if (!classification.json_asset_allowed) {
    const err = new Error(
      `JSON Asset Registry is not the authoritative home for asset_type=${classification.asset_class}. Use ${BRAND_CORE_REGISTRY_SHEET}.`
    );
    err.code = "json_asset_authority_violation";
    err.status = 400;
    err.authoritative_home = classification.authoritative_home;
    err.asset_class = classification.asset_class;
    throw err;
  }

  return classification;
}

export function extractJsonAssetPayloadBody(args = {}) {
  const body = args.response_body;

  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body)
  ) {
    if (Object.prototype.hasOwnProperty.call(body, "data")) {
      return body.data;
    }
  }

  return body ?? null;
}

export function isSchemaMetaOnlyPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const keys = Object.keys(value);
  if (keys.length !== 3) return false;

  return (
    Object.prototype.hasOwnProperty.call(value, "request_schema_alignment_status") &&
    Object.prototype.hasOwnProperty.call(value, "openai_schema_file_id") &&
    Object.prototype.hasOwnProperty.call(value, "schema_name")
  );
}

export async function findExistingJsonAssetByAssetKey(assetKey = "") {
  const normalizedAssetKey = String(assetKey || "").trim();
  if (!normalizedAssetKey) return null;

  const { sheets } = await getGoogleClientsForSpreadsheet(
    JSON_ASSET_REGISTRY_SPREADSHEET_ID
  );

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(JSON_ASSET_REGISTRY_SPREADSHEET_ID || "").trim(),
    range: toValuesApiRange(JSON_ASSET_REGISTRY_SHEET, "A:Q")
  });

  const values = response.data.values || [];
  if (values.length < 2) return null;

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  const map = headerMap(header, JSON_ASSET_REGISTRY_SHEET);

  const assetKeyIdx = map.asset_key;
  if (assetKeyIdx === undefined) return null;

  const transportStatusIdx = map.transport_status;
  const activeStatusIdx = map.active_status;

  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    const existingAssetKey = String(row[assetKeyIdx] || "").trim();
    const transportStatus =
      transportStatusIdx === undefined ? "" : String(row[transportStatusIdx] || "").trim();
    const activeStatus =
      activeStatusIdx === undefined ? "" : String(row[activeStatusIdx] || "").trim();

    if (
      existingAssetKey === normalizedAssetKey &&
      activeStatus === "TRUE" &&
      transportStatus !== ""
    ) {
      return row;
    }
  }

  return null;
}

export function normalizeExecutionErrorCode(errorCode = "") {
  const code = String(errorCode || "").trim();
  if (!code) return "";

  if (code === "worker_transport_error") return "transport_failed";
  if (code === "auth_resolution_failed") return "auth_failed";
  if (
    code === "request_schema_mismatch" ||
    code === "response_schema_mismatch" ||
    code === "response_schema_missing"
  ) {
    return "failed_validation";
  }
  return code;
}

export function compactErrorMessage(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.slice(0, 500);
}

export function classifySmokeTestResult(args = {}) {
  if (!SMOKE_TEST_SCENARIOS.has(String(args.scenario || "").trim())) {
    const err = new Error(`Unknown smoke test scenario: ${args.scenario}`);
    err.code = "unknown_smoke_test_scenario";
    err.status = 400;
    throw err;
  }

  const result = args.passed ? "pass" : "fail";
  if (!SMOKE_TEST_RESULTS.has(result)) {
    const err = new Error(`Invalid smoke test result: ${result}`);
    err.code = "invalid_smoke_test_result";
    err.status = 500;
    throw err;
  }
  return result;
}

export function buildSmokeTestSummary(args = {}) {
  const scenario = String(args.scenario || "").trim();
  const result = classifySmokeTestResult(args);
  const note = String(args.note || "").trim();
  return note
    ? `[${result}] ${scenario}: ${note}`
    : `[${result}] ${scenario}`;
}

export async function runWritebackSmokeTest(input = {}) {
  const scenario = String(input.scenario || "").trim();
  const passed = !!input.passed;
  const result = classifySmokeTestResult({ scenario, passed });

  return {
    scenario,
    result,
    summary: buildSmokeTestSummary({
      scenario,
      passed,
      note: input.note || ""
    }),
    execution_trace_id: String(input.execution_trace_id || "").trim(),
    artifact_expected: !!input.artifact_expected,
    artifact_observed: !!input.artifact_observed,
    pointer_linkage_expected: !!input.pointer_linkage_expected,
    pointer_linkage_observed: !!input.pointer_linkage_observed
  };
}

export function evaluateWritebackSmokeSuite(args = {}) {
  const checks = [
    runWritebackSmokeTest({
      scenario: "sync_success",
      passed: !!args.sync_success,
      note: args.sync_success_note || ""
    }),
    runWritebackSmokeTest({
      scenario: "queued_success",
      passed: !!args.queued_success,
      note: args.queued_success_note || ""
    }),
    runWritebackSmokeTest({
      scenario: "timeout",
      passed: !!args.timeout,
      note: args.timeout_note || ""
    }),
    runWritebackSmokeTest({
      scenario: "oversized_artifact",
      passed: !!args.oversized_artifact,
      note: args.oversized_artifact_note || "",
      artifact_expected: true,
      artifact_observed: !!args.oversized_artifact
    }),
    runWritebackSmokeTest({
      scenario: "pointer_linkage_validation",
      passed: !!args.pointer_linkage_validation,
      note: args.pointer_linkage_validation_note || "",
      pointer_linkage_expected: true,
      pointer_linkage_observed: !!args.pointer_linkage_validation
    })
  ];

  return Promise.all(checks).then(results => ({
    overall:
      results.every(r => r.result === "pass") ? "pass" : "fail",
    results
  }));
}

export async function persistOversizedArtifact(input = {}) {
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

  if (OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID) {
    requestBody.parents = [OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID];
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

export async function performUniversalServerWriteback(input = {}) {
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
    const artifact = await persistOversizedArtifact({
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
      : EXECUTION_ENTRY_TYPES.has(input.entry_type)
      ? input.entry_type
      : "sync_execution",
    execution_class: oversized
      ? "oversized"
      : EXECUTION_CLASSES.has(input.execution_class)
      ? input.execution_class
      : "sync",
    source_layer: String(input.source_layer || "unknown_layer"),
    status,
    result_classification: EXECUTION_RESULT_CLASSIFICATIONS.has(result_classification)
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
    log_source: AUTHORITATIVE_RAW_EXECUTION_LOG_SURFACE_ID,
    artifact_pointer: artifactPointer,
    artifact_json_asset_id: artifactJsonAssetId
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
      // do not erase primary execution truth because registry follow-up failed
      console.error("JSON Asset Registry write failed", err);
    }
  }

  const governedWriteState = {
    execution_log_surface_id: AUTHORITATIVE_RAW_EXECUTION_LOG_SURFACE_ID,
    execution_log_sheet: EXECUTION_LOG_UNIFIED_SHEET,
    json_asset_registry_sheet: JSON_ASSET_REGISTRY_SHEET,
    execution_log_spreadsheet_id: EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    json_asset_registry_spreadsheet_id: JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    authoritative_raw_execution_sink: AUTHORITATIVE_RAW_EXECUTION_LOG_SURFACE_ID,
    raw_execution_single_write_enforced: true,
    execution_log_sheet_exists: governedSinkSheetTitles.executionLogTitles.includes(
      String(EXECUTION_LOG_UNIFIED_SHEET || "").trim()
    ),
    json_asset_registry_sheet_exists: governedSinkSheetTitles.jsonAssetTitles.includes(
      String(JSON_ASSET_REGISTRY_SHEET || "").trim()
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

export async function logValidationRunWriteback(input = {}) {
  return await performUniversalServerWriteback({
    mode: "validation",
    job_id: undefined,
    target_key: input.target_key,
    parent_action_key: input.parent_action_key,
    endpoint_key: input.endpoint_key,
    route_id: input.route_id,
    target_module: input.target_module,
    target_workflow: input.target_workflow,
    source_layer: "system_bootstrap",
    entry_type: "validation_run",
    execution_class: "validation",
    attempt_count: input.attempt_count ?? 1,
    status_source: input.validationStatus,
    responseBody: input.validationPayload,
    error_code: input.error_code,
    error_message_short: input.error_message_short,
    http_status: undefined,
    brand_name: input.brand_name,
    execution_trace_id: input.execution_trace_id,
    started_at: input.started_at
  });
}

export async function logPartialHarvestWriteback(input = {}) {
  return await performUniversalServerWriteback({
    mode: "partial_harvest",
    job_id: input.job_id,
    target_key: input.target_key,
    parent_action_key: input.parent_action_key,
    endpoint_key: input.endpoint_key,
    route_id: input.route_id,
    target_module: input.target_module,
    target_workflow: input.target_workflow,
    source_layer: "http_client_backend",
    entry_type: "partial_harvest",
    execution_class: "partial_harvest",
    attempt_count: input.attempt_count,
    status_source: input.status_source,
    responseBody: input.harvestedChunk,
    error_code: input.error_code,
    error_message_short: input.error_message_short,
    http_status: input.http_status,
    brand_name: input.brand_name,
    execution_trace_id: input.execution_trace_id,
    started_at: input.started_at
  });
}

export async function logRetryWriteback(input = {}) {
  return await performUniversalServerWriteback({
    mode: "async",
    job_id: input.job_id,
    target_key: input.target_key,
    parent_action_key: input.parent_action_key,
    endpoint_key: input.endpoint_key,
    route_id: input.route_id,
    target_module: input.target_module,
    target_workflow: input.target_workflow,
    source_layer: "http_client_backend",
    entry_type: "async_job",
    execution_class: "retry",
    attempt_count: input.attempt_count,
    status_source: "retrying",
    responseBody: input.responseBody,
    error_code: input.error_code,
    error_message_short: input.error_message_short,
    http_status: input.http_status,
    brand_name: input.brand_name,
    execution_trace_id: input.execution_trace_id,
    started_at: input.started_at
  });
}

export function normalizeExecutionPayload(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const query =
    safePayload.query && typeof safePayload.query === "object"
      ? safePayload.query
      : safePayload.params?.query &&
        typeof safePayload.params.query === "object"
      ? safePayload.params.query
      : {};

  const body = Object.prototype.hasOwnProperty.call(safePayload, "body")
    ? safePayload.body
    : undefined;

  const routingFields = normalizeTopLevelRoutingFields(safePayload);

  return {
    ...safePayload,
    ...routingFields,
    query,
    body
  };
}

export function normalizeTopLevelRoutingFields(payload = {}) {
  return {
    target_key: payload.target_key,
    brand: payload.brand,
    brand_domain: payload.brand_domain,
    provider_domain: payload.provider_domain,
    parent_action_key: payload.parent_action_key,
    endpoint_key: payload.endpoint_key,
    method: payload.method,
    path: payload.path,
    force_refresh: payload.force_refresh
  };
}

export function validatePayloadIntegrity(originalPayload = {}, normalizedPayload = {}) {
  const trackedFields = [
    "target_key",
    "brand",
    "brand_domain",
    "provider_domain",
    "parent_action_key",
    "endpoint_key",
    "method",
    "path"
  ];

  const mismatches = [];

  for (const field of trackedFields) {
    const originalValue = originalPayload[field];
    const normalizedValue = normalizedPayload[field];

    const originalText = originalValue === undefined ? "" : String(originalValue);
    const normalizedText = normalizedValue === undefined ? "" : String(normalizedValue);

    if (originalText !== normalizedText) {
      mismatches.push({
        field,
        original: originalValue ?? "",
        normalized: normalizedValue ?? ""
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatches
  };
}

export function validateTopLevelRoutingFields(payload = {}, policies = []) {
  const requireTopLevelSources = String(
    policyValue(
      policies,
      "HTTP Transport Routing",
      "Placeholder Resolution Sources Must Be Top-Level",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const allowNestedSources = String(
    policyValue(
      policies,
      "HTTP Transport Routing",
      "Nested Placeholder Resolution Sources Allowed",
      "TRUE"
    )
  ).trim().toUpperCase() === "TRUE";

  const errors = [];

  const topLevelHasSource =
    !!String(payload.target_key || "").trim() ||
    !!String(payload.brand || "").trim() ||
    !!String(payload.brand_domain || "").trim();

  const nestedBody = payload.body && typeof payload.body === "object" ? payload.body : {};
  const isDelegatedWrapper = isDelegatedHttpExecuteWrapper(payload);

  const nestedHasSource =
    !!String(nestedBody.target_key || "").trim() ||
    !!String(nestedBody.brand || "").trim() ||
    !!String(nestedBody.brand_domain || "").trim();

  if (requireTopLevelSources && payload.provider_domain === "target_resolved" && !topLevelHasSource) {
    errors.push("top-level target_key, brand, or brand_domain is required when provider_domain is target_resolved");
  }

  if (!allowNestedSources && nestedHasSource && !isDelegatedWrapper) {
    errors.push("target_key, brand, and brand_domain must be top-level fields; nested body.* routing fields are not allowed");
  }

  if (payload.target_key !== undefined && typeof payload.target_key !== "string") {
    errors.push("target_key must be a string");
  }

  if (payload.brand !== undefined && typeof payload.brand !== "string") {
    errors.push("brand must be a string");
  }

  if (payload.brand_domain !== undefined && typeof payload.brand_domain !== "string") {
    errors.push("brand_domain must be a string");
  }

  if (payload.provider_domain !== undefined && typeof payload.provider_domain !== "string") {
    errors.push("provider_domain must be a string");
  }

  if (payload.parent_action_key !== undefined && typeof payload.parent_action_key !== "string") {
    errors.push("parent_action_key must be a string");
  }

  if (payload.endpoint_key !== undefined && typeof payload.endpoint_key !== "string") {
    errors.push("endpoint_key must be a string");
  }

  if (payload.method !== undefined && typeof payload.method !== "string") {
    errors.push("method must be a string");
  }

  if (payload.path !== undefined && typeof payload.path !== "string") {
    errors.push("path must be a string");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function validateAssetHomePayloadRules(payload = {}) {
  const assetType = normalizeAssetType(payload.asset_type);
  if (!assetType) {
    return { ok: true, errors: [] };
  }

  const classification = classifyAssetHome({
    asset_type: assetType,
    endpoint_key: payload.endpoint_key,
    source_asset_ref: payload.source_asset_ref,
    asset_key: payload.asset_key
  });

  if (
    classification.authoritative_home === "brand_core_registry" &&
    String(payload.force_json_asset_write || "").trim().toUpperCase() === "TRUE"
  ) {
    return {
      ok: false,
      errors: [
        `asset_type=${assetType} must not force JSON Asset Registry write; authoritative home is ${BRAND_CORE_REGISTRY_SHEET}`
      ]
    };
  }

  return { ok: true, errors: [] };
}

export function isHttpGenericTransportEndpointKey(endpointKey = "") {
  return [
    "http_get",
    "http_post",
    "http_put",
    "http_patch",
    "http_delete"
  ].includes(String(endpointKey || "").trim());
}

export function isDelegatedHttpExecuteWrapper(payload = {}) {
  return (
    String(payload.parent_action_key || "").trim() === "http_generic_api" &&
    isHttpGenericTransportEndpointKey(payload.endpoint_key) &&
    String(payload.path || "").trim() === "/http-execute"
  );
}

export function isWordPressAction(parentActionKey = "") {
  return String(parentActionKey || "").trim() === "wordpress_api";
}

export function promoteDelegatedExecutionPayload(payload = {}) {
  if (!isDelegatedHttpExecuteWrapper(payload)) {
    return payload;
  }

  const nested = payload.body && typeof payload.body === "object" ? payload.body : {};

  const nestedHeaders =
    nested.headers && typeof nested.headers === "object"
      ? nested.headers
      : undefined;

  const nestedQuery =
    nested.query && typeof nested.query === "object"
      ? nested.query
      : undefined;

  const nestedPathParams =
    nested.path_params && typeof nested.path_params === "object"
      ? nested.path_params
      : undefined;

  return {
    ...payload,

    // routing-source
    target_key: payload.target_key || nested.target_key,
    brand: payload.brand || nested.brand,
    brand_domain: payload.brand_domain || nested.brand_domain,

    // execution-target
    provider_domain: nested.provider_domain || payload.provider_domain,
    parent_action_key: nested.parent_action_key || payload.parent_action_key,
    endpoint_key: nested.endpoint_key || payload.endpoint_key,
    method: nested.method || payload.method,
    path: nested.path || payload.path,
    force_refresh: nested.force_refresh ?? payload.force_refresh,
    timeout_seconds: nested.timeout_seconds ?? payload.timeout_seconds,
    expect_json: nested.expect_json ?? payload.expect_json,
    readback: nested.readback ?? payload.readback,

    headers: nestedHeaders || payload.headers,
    query: nestedQuery || payload.query,
    path_params: nestedPathParams || payload.path_params,
    body: Object.prototype.hasOwnProperty.call(nested, "body")
      ? nested.body
      : payload.body
  };
}

export function isHostingerAction(parentActionKey = "") {
  return String(parentActionKey || "").trim() === "hostinger_api";
}

export function isSiteTargetKey(targetKey = "") {
  const v = String(targetKey || "").trim();
  if (!v) return false;
  return (
    v.endsWith("_wp") ||
    v.startsWith("site_") ||
    v.startsWith("brand_") ||
    v.includes("_wordpress")
  );
}

export function isHostingAccountTargetKey(targetKey = "") {
  const v = String(targetKey || "").trim();
  if (!v) return false;
  return (
    v.startsWith("hostinger_") ||
    v.includes("_shared_manager_") ||
    v.includes("_hosting_account_") ||
    v.includes("_cloud_plan_") ||
    v.includes("_account_")
  );
}

export function assertHostingerTargetTier(payload = {}) {
  const parentActionKey = String(payload.parent_action_key || "").trim();
  const endpointKey = String(payload.endpoint_key || "").trim();
  const targetKey = String(payload.target_key || "").trim();

  if (!isHostingerAction(parentActionKey)) {
    return { ok: true };
  }

  if (!targetKey) {
    const err = new Error(
      "Hostinger execution requires an authoritative hosting-account target_key."
    );
    err.code = "hostinger_target_key_missing";
    err.status = 400;
    throw err;
  }

  if (isSiteTargetKey(targetKey) && !isHostingAccountTargetKey(targetKey)) {
    const err = new Error(
      `Hostinger endpoint ${endpointKey} must resolve through a hosting-account target_key, not a WordPress/site target_key (${targetKey}).`
    );
    err.code = "hostinger_target_tier_mismatch";
    err.status = 400;
    throw err;
  }

  return { ok: true };
}

function isActivationDriveDiscoveryRequest(payload = {}) {
  return String(payload.parent_action_key || "").trim() === "google_drive_api" &&
    String(payload.endpoint_key || "").trim() === "listDriveFiles";
}

function isActivationSheetOpenRequest(payload = {}) {
  return String(payload.parent_action_key || "").trim() === "google_sheets_api" &&
    String(payload.endpoint_key || "").trim() === "getSpreadsheet";
}

function isActivationBootstrapRowRead(payload = {}) {
  if (String(payload.parent_action_key || "").trim() !== "google_sheets_api") return false;
  if (String(payload.endpoint_key || "").trim() !== "getSheetValues") return false;
  const range = String(payload.path_params?.range || payload.query?.range || "").trim();
  return range === ACTIVATION_BOOTSTRAP_CONFIG_RANGE;
}

function isSheets429(upstream, data) {
  if (Number(upstream?.status) !== 429) return false;
  const message = String(data?.error?.message || data?.message || "").toLowerCase();
  return message.includes("quota") || message.includes("read requests per minute");
}

function buildValidationRateLimitedBody(base = {}) {
  return {
    ...base,
    ok: false,
    code: "validation_rate_limited",
    activation_state: "validation_rate_limited",
    message: "Google Sheets activation binding read is rate-limited. Retry after backoff.",
    retryable: true
  };
}

function syntheticJsonAttempt(data, status = 200) {
  return {
    upstream: {
      ok: status >= 200 && status < 300,
      status,
      headers: new Map([["content-type", "application/json"]])
    },
    data,
    responseText: JSON.stringify(data),
    responseHeaders: { "content-type": "application/json" },
    contentType: "application/json"
  };
}

export async function executeUpstreamAttempt({
  requestUrl,
  requestInit,
  requestPayload = {},
  resolvedProviderDomain = ""
}) {
  if (isActivationSheetOpenRequest(requestPayload) || isActivationBootstrapRowRead(requestPayload)) {
    const backoffUntil = await getActivationBackoffUntil(makeActivationSheetsBackoffKey());
    if (backoffUntil && Date.now() < backoffUntil) {
      return {
        shortCircuitResponse: {
          status: 429,
          body: buildValidationRateLimitedBody({
            backoff_until: new Date(backoffUntil).toISOString()
          })
        }
      };
    }
  }

  if (isActivationDriveDiscoveryRequest(requestPayload)) {
    const workbookId = await getCachedValue(makeActivationWorkbookCacheKey());
    if (workbookId) {
      return syntheticJsonAttempt({
        files: [
          {
            id: String(workbookId),
            name: "Growth Intelligence OS - Registry Workbook"
          }
        ],
        cache_status: "hit",
        cache_key: makeActivationWorkbookCacheKey()
      });
    }
  }

  if (isActivationBootstrapRowRead(requestPayload)) {
    const row = await getCachedValue(makeActivationBootstrapRowCacheKey());
    if (Array.isArray(row)) {
      return syntheticJsonAttempt({
        values: [row],
        cache_status: "hit",
        cache_key: makeActivationBootstrapRowCacheKey()
      });
    }
  }

  const upstream = await fetch(requestUrl, requestInit);

  const contentType = upstream.headers.get("content-type") || "";
  let data;
  let responseText = "";

  if (contentType.includes("application/json")) {
    data = await upstream.json();
    responseText = JSON.stringify(data);
  } else {
    data = await upstream.text();
    responseText = String(data || "");
  }

  const responseHeaders = {};
  upstream.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  if (isActivationDriveDiscoveryRequest(requestPayload) && Array.isArray(data?.files)) {
    const workbook = data.files.find(
      f => String(f?.name || "").trim() === "Growth Intelligence OS - Registry Workbook"
    );
    if (workbook?.id) {
      await setCachedValue(
        makeActivationWorkbookCacheKey(),
        String(workbook.id),
        ACTIVATION_WORKBOOK_CACHE_TTL_SECONDS
      );
    }
  }

  if (isActivationBootstrapRowRead(requestPayload)) {
    const values = Array.isArray(data?.values) ? data.values : [];
    const row = Array.isArray(values[0]) ? values[0] : null;
    if (row) {
      await setCachedValue(
        makeActivationBootstrapRowCacheKey(),
        row,
        ACTIVATION_BOOTSTRAP_ROW_CACHE_TTL_SECONDS
      );
    }
  }

  if (isSheets429(upstream, data)) {
    const untilMs = Date.now() + (ACTIVATION_SHEETS_429_BACKOFF_SECONDS * 1000);
    await setActivationBackoffUntil(
      makeActivationSheetsBackoffKey(),
      untilMs,
      ACTIVATION_SHEETS_429_BACKOFF_SECONDS
    );

    return {
      shortCircuitResponse: {
        status: 429,
        body: buildValidationRateLimitedBody({
          provider_domain: resolvedProviderDomain,
          parent_action_key: requestPayload.parent_action_key,
          endpoint_key: requestPayload.endpoint_key,
          backoff_until: new Date(untilMs).toISOString()
        })
      }
    };
  }

  return {
    upstream,
    data,
    responseText,
    responseHeaders,
    contentType
  };
}

export function resolveBrand(rows, requestPayload = {}, deps = {}) {
  const requestedProviderDomain = requestPayload.provider_domain
    ? safeNormalizeProviderDomain(requestPayload.provider_domain)
    : "";
  const allowedTransport = String(deps.allowedTransportKey || deps.allowedTransport || "http_generic_api").trim();

  const targetKey = String(requestPayload.target_key || "").trim().toLowerCase();
  const brandName = String(requestPayload.brand || "").trim().toLowerCase();
  const brandDomain = String(requestPayload.brand_domain || "").trim().toLowerCase();

  const normalizedRows = rows.map(r => {
    const aliases = jsonParseSafe(r.site_aliases_json, []).map(v => String(v).toLowerCase());
    let rowBaseUrl = "";
    try {
      rowBaseUrl = r.base_url ? normalizeProviderDomain(r.base_url) : "";
    } catch {}
    return {
      ...r,
      _aliases: aliases,
      _normalized_brand_name: String(r.normalized_brand_name || "").toLowerCase(),
      _display_name: String(r.brand_name || "").toLowerCase(),
      _target_key: String(r.target_key || "").toLowerCase(),
      _brand_domain: String(r.brand_domain || "").toLowerCase(),
      _base_url: rowBaseUrl
    };
  });

  let row = null;

  if (targetKey) {
    row = normalizedRows.find(r => r._target_key === targetKey) || null;
  }

  if (!row && brandName) {
    row = normalizedRows.find(
      r =>
        r._normalized_brand_name === brandName ||
        r._display_name === brandName ||
        r._aliases.includes(brandName)
    ) || null;
  }

  if (!row && brandDomain) {
    row = normalizedRows.find(r => r._brand_domain === brandDomain) || null;
  }

  if (!row && requestedProviderDomain && requestedProviderDomain !== "target_resolved") {
    row = normalizedRows.find(r => r._base_url === requestedProviderDomain) || null;
  }

  if (!row) return null;

  if (!boolFromSheet(row.transport_enabled)) {
    const err = new Error(`Transport is not enabled for resolved brand ${row.brand_name}.`);
    err.code = "transport_disabled";
    err.status = 403;
    throw err;
  }

  if (row.transport_action_key && row.transport_action_key !== allowedTransport) {
    const err = new Error(`Unsupported transport_action_key: ${row.transport_action_key}; expected ${allowedTransport}`);
    err.code = "unsupported_transport";
    err.status = 403;
    throw err;
  }

  return row;
}

export function resolveAction(rows, parentActionKey) {
  const matches = rows.filter(r => r.action_key === parentActionKey);

  debugLog(
    "ACTION_RESOLUTION_REQUEST:",
    JSON.stringify({
      parent_action_key: parentActionKey,
      match_count: matches.length
    })
  );

  if (!matches.length) {
    const err = new Error(`Parent action not found: ${parentActionKey}`);
    err.code = "parent_action_not_found";
    err.status = 403;
    throw err;
  }

  const active = matches.find(
    r => String(r.status || "").trim().toLowerCase() === "active"
  );

  const action = active || matches[0];

  debugLog(
    "ACTION_RESOLUTION_SELECTED:",
    JSON.stringify({
      action_key: action.action_key,
      status: action.status || "",
      runtime_capability_class: action.runtime_capability_class || "",
      runtime_callable: action.runtime_callable || "",
      primary_executor: action.primary_executor || "",
      openai_schema_storage_surface: action.openai_schema_storage_surface || ""
    })
  );

  if (String(action.status || "").trim().toLowerCase() !== "active") {
    const err = new Error(`Parent action is not active: ${parentActionKey}`);
    err.code = "parent_action_inactive";
    err.status = 403;
    throw err;
  }
  return action;
}

export function resolveEndpoint(rows, parentActionKey, endpointKey) {
  const matches = rows.filter(
    r =>
      r.parent_action_key === parentActionKey &&
      r.endpoint_key === endpointKey
  );

  debugLog(
    "ENDPOINT_RESOLUTION_REQUEST:",
    JSON.stringify({
      parent_action_key: parentActionKey,
      endpoint_key: endpointKey,
      match_count: matches.length
    })
  );

  if (!matches.length) {
    const err = new Error(`Endpoint not found: ${endpointKey}`);
    err.code = "endpoint_not_found";
    err.status = 403;
    throw err;
  }

  const activeReady = matches.find(
    r =>
      String(r.status || "").trim().toLowerCase() === "active" &&
      String(r.execution_readiness || "").trim().toLowerCase() === "ready"
  );

  const endpoint = activeReady || matches[0];

  debugLog(
    "ENDPOINT_RESOLUTION_SELECTED:",
    JSON.stringify(getEndpointExecutionSnapshot(endpoint))
  );

  if (String(endpoint.status || "").trim().toLowerCase() !== "active") {
    const err = new Error(`Endpoint is not active: ${endpointKey}`);
    err.code = "endpoint_inactive";
    err.status = 403;
    throw err;
  }

  if (
    String(endpoint.execution_readiness || "").trim().toLowerCase() !== "ready"
  ) {
    const err = new Error(`Endpoint is not execution-ready: ${endpointKey}`);
    err.code = "endpoint_not_ready";
    err.status = 403;
    throw err;
  }

  return endpoint;
}

export function isDelegatedTransportTarget(endpoint = {}) {
  return (
    String(endpoint.execution_mode || "")
      .trim()
      .toLowerCase() === "http_delegated" &&
    boolFromSheet(endpoint.transport_required) &&
    String(endpoint.transport_action_key || "").trim() !== ""
  );
}

export function getEndpointExecutionSnapshot(endpoint = {}) {
  return {
    endpoint_id: String(endpoint.endpoint_id || "").trim(),
    endpoint_key: String(endpoint.endpoint_key || "").trim(),
    parent_action_key: String(endpoint.parent_action_key || "").trim(),
    endpoint_role: String(endpoint.endpoint_role || "").trim(),
    inventory_role: String(endpoint.inventory_role || "").trim(),
    inventory_source: String(endpoint.inventory_source || "").trim(),
    execution_mode: String(endpoint.execution_mode || "").trim(),
    transport_required_raw: endpoint.transport_required ?? "",
    transport_required: boolFromSheet(endpoint.transport_required),
    transport_action_key: String(endpoint.transport_action_key || "").trim(),
    delegated_transport_target: isDelegatedTransportTarget(endpoint),
    status: String(endpoint.status || "").trim(),
    execution_readiness: String(endpoint.execution_readiness || "").trim(),
    provider_domain: String(endpoint.provider_domain || "").trim(),
    endpoint_path_or_function: String(endpoint.endpoint_path_or_function || "").trim(),
    notes: String(endpoint.notes || "").trim()
  };
}

export function requireRuntimeCallableAction(policies, action, endpoint) {
  const requireCallable = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Require Runtime Callable For Direct Execution",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const disallowPending = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Disallow Pending Binding Execution",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const allowRegistryOnlyDirect = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Allow Registry Only Actions Direct Execution",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const runtimeCallable = boolFromSheet(action.runtime_callable);
  const capabilityClass = String(action.runtime_capability_class || "").trim().toLowerCase();
  const primaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
  const delegatedTransportTarget = isDelegatedTransportTarget(endpoint);

  if (disallowPending && capabilityClass === "pending_binding") {
    const err = new Error(`Action is pending binding and cannot execute: ${action.action_key}`);
    err.code = "action_pending_binding";
    err.status = 403;
    throw err;
  }

  if (
    requireCallable &&
    !delegatedTransportTarget &&
    primaryExecutor !== "http_client_backend" &&
    !runtimeCallable
  ) {
    const err = new Error(`Action is not runtime callable: ${action.action_key}`);
    err.code = "action_not_runtime_callable";
    err.status = 403;
    throw err;
  }

  if (
    !allowRegistryOnlyDirect &&
    !delegatedTransportTarget &&
    capabilityClass === "external_action_only" &&
    primaryExecutor !== "http_client_backend"
  ) {
    const err = new Error(`Registry-only external action cannot execute directly: ${action.action_key}`);
    err.code = "external_action_direct_execution_blocked";
    err.status = 403;
    throw err;
  }
}

export function requireEndpointExecutionEligibility(policies, endpoint) {
  const blockInventoryOnly =
    String(
      policyValue(
        policies,
        "Execution Capability Governance",
        "Block Inventory Only Endpoints",
        "FALSE"
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const endpointRole = String(endpoint.endpoint_role || "")
    .trim()
    .toLowerCase();

  const executionMode = String(endpoint.execution_mode || "")
    .trim()
    .toLowerCase();

  const transportRequired = boolFromSheet(endpoint.transport_required);

  const inventoryRole = String(endpoint.inventory_role || "")
    .trim()
    .toLowerCase();

  const delegatedTransportTarget =
    isDelegatedTransportTarget(endpoint);

  const snapshot = {
    ...getEndpointExecutionSnapshot(endpoint),
    block_inventory_only: blockInventoryOnly
  };

  debugLog(
    "ENDPOINT_EXECUTION_ELIGIBILITY_INPUT:",
    JSON.stringify(snapshot)
  );

  if (
    blockInventoryOnly &&
    !delegatedTransportTarget &&
    endpointRole &&
    endpointRole !== "primary"
  ) {
    debugLog(
      "ENDPOINT_EXECUTION_ELIGIBILITY_BLOCK:",
      JSON.stringify({ ...snapshot, reason: "endpoint_role_blocked" })
    );

    const err = new Error(
      `Endpoint is not a primary executable endpoint: ${endpoint.endpoint_key}`
    );
    err.code = "endpoint_role_blocked";
    err.status = 403;
    err.details = snapshot;
    throw err;
  }

  if (
    blockInventoryOnly &&
    !delegatedTransportTarget &&
    inventoryRole &&
    inventoryRole !== "endpoint_inventory"
  ) {
    debugLog(
      "ENDPOINT_EXECUTION_ELIGIBILITY_BLOCK:",
      JSON.stringify({ ...snapshot, reason: "inventory_only_endpoint" })
    );

    const err = new Error(
      `Non-executable inventory role cannot execute directly: ${endpoint.endpoint_key}`
    );
    err.code = "inventory_only_endpoint";
    err.status = 403;
    err.details = snapshot;
    throw err;
  }

  debugLog(
    "ENDPOINT_EXECUTION_ELIGIBILITY_PASS:",
    JSON.stringify(snapshot)
  );

  return {
    endpointRole,
    executionMode,
    transportRequired,
    delegatedTransportTarget
  };
}

export function requireExecutionModeCompatibility(action, endpoint) {
  const primaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();

  if (executionMode === "native_direct") {
    const err = new Error(
      `Native-direct endpoint must use native GPT execution path, not http-execute: ${endpoint.endpoint_key}`
    );
    err.code = "native_direct_requires_native_path";
    err.status = 403;
    throw err;
  }

  if (executionMode === "http_delegated" && primaryExecutor !== "http_client_backend") {
    const err = new Error(
      `Execution mode mismatch: endpoint ${endpoint.endpoint_key} is http_delegated but parent executor is ${primaryExecutor || "unset"}.`
    );
    err.code = "execution_mode_mismatch";
    err.status = 403;
    throw err;
  }
}

export function requireNativeFamilyBoundary(policies, action, endpoint) {
  const nativeFamilies = policyList(
    policies,
    "HTTP Transport Routing",
    "Native Google Families Allowed"
  );

  const httpFamilies = policyList(
    policies,
    "HTTP Transport Routing",
    "HTTP Client Required Google Families"
  );

  const actionKey = String(action.action_key || "").trim();
  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();
  const primaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
  const delegatedTransportTarget = isDelegatedTransportTarget(endpoint);
  const isTransportExecutor = actionKey === "http_generic_api";

  if (nativeFamilies.includes(actionKey) && !delegatedTransportTarget) {
    throw Object.assign(
      new Error(
        `Native family ${actionKey} must not execute through http-execute unless delegated.`
      ),
      { code: "native_family_http_execution_blocked", status: 403 }
    );
  }

  if (httpFamilies.includes(actionKey)) {
    if (!isTransportExecutor && !delegatedTransportTarget) {
      throw Object.assign(
        new Error(
          `HTTP-governed family ${actionKey} must use delegated transport.`
        ),
        { code: "http_family_requires_delegation", status: 403 }
      );
    }
  }
}

export function requireTransportIfDelegated(policies, action, endpoint) {
  const requireTransport = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Require Transport For Delegated Actions",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();
  const transportRequired = boolFromSheet(endpoint.transport_required);
  const allowedTransport = String(policyValue(
    policies,
    "HTTP Execution Governance",
    "Allowed Transport",
    "http_generic_api"
  )).trim();

  if (requireTransport && executionMode === "http_delegated") {
    const transportActionKey = String(endpoint.transport_action_key || "").trim();
    if (transportRequired && transportActionKey !== allowedTransport) {
      const err = new Error(
        `Delegated endpoint requires supported transport_action_key ${allowedTransport}; received ${transportActionKey || "unset"}.`
      );
      err.code = "transport_required";
      err.status = 403;
      throw err;
    }

    const normalizedPrimaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
    const transportExecutorKey = String(action.action_key || "").trim();
    const isTransportExecutor = transportExecutorKey === allowedTransport;

    if (!isTransportExecutor && normalizedPrimaryExecutor !== "http_client_backend") {
      const err = new Error(
        `Delegated endpoint requires allowed transport executor ${allowedTransport} or http_client_backend as parent executor: ${action.action_key}`
      );
      err.code = "transport_executor_mismatch";
      err.status = 403;
      throw err;
    }
  }
}

export function requireNoFallbackDirectExecution(policies, endpoint) {
  const fallbackRequiresPrimaryFailure = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Fallback Requires Primary Failure",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  if (!fallbackRequiresPrimaryFailure) return;

  const fallbackAllowed = boolFromSheet(endpoint.fallback_allowed);
  const endpointRole = String(endpoint.endpoint_role || "").trim().toLowerCase();

  if (fallbackAllowed && endpointRole === "fallback") {
    const err = new Error(`Fallback endpoint cannot execute directly without primary failure: ${endpoint.endpoint_key}`);
    err.code = "fallback_requires_primary_failure";
    err.status = 403;
    throw err;
  }
}

export function getPlaceholderResolutionSources(policies = []) {
  return policyList(
    policies,
    "HTTP Execution Governance",
    "Placeholder Resolution Sources"
  ).map(v => String(v || "").trim().toLowerCase());
}

export function resolveRuntimeProviderDomainSource({
  requestBody = {},
  brand = null,
  parentActionKey = ""
}) {
  debugLog("RUNTIME_REQUEST_BODY:", JSON.stringify(requestBody));

  const directProviderDomain = safeNormalizeProviderDomain(requestBody.provider_domain);
  if (directProviderDomain && directProviderDomain !== "target_resolved") {
    return {
      resolvedProviderDomain: directProviderDomain,
      placeholderResolutionSource: "provider_domain"
    };
  }

  // Provider-native actions like Hostinger should not inherit brand.base_url.
  if (String(parentActionKey || "").trim() === "hostinger_api") {
    return {
      resolvedProviderDomain: "",
      placeholderResolutionSource: ""
    };
  }

  if (brand?.base_url) {
    return {
      resolvedProviderDomain: normalizeProviderDomain(brand.base_url),
      placeholderResolutionSource:
        String(requestBody.target_key || "").trim() ? "target_key"
        : String(requestBody.brand || "").trim() ? "brand"
        : String(requestBody.brand_domain || "").trim() ? "brand_domain"
        : "brand"
    };
  }

  return {
    resolvedProviderDomain: "",
    placeholderResolutionSource: ""
  };
}

export function resolveProviderDomain({
  requestedProviderDomain,
  endpoint,
  brand,
  parentActionKey,
  policies = [],
  requestBody = {}
}) {
  const endpointProviderDomain = String(endpoint.provider_domain || "").trim();

  if (
    String(endpoint.execution_mode || "").trim().toLowerCase() === "native_controller" ||
    endpointProviderDomain === "same_service_native"
  ) {
    return {
      providerDomain: `http://127.0.0.1:${port}`,
      resolvedProviderDomainMode: "fixed_domain",
      placeholderResolutionSource: ""
    };
  }

  const {
    resolvedProviderDomain: runtimeResolvedProviderDomain,
    placeholderResolutionSource
  } = resolveRuntimeProviderDomainSource({
    requestBody,
    brand,
    parentActionKey
  });

  if (parentActionKey === "wordpress_api") {
    if (!brand || !brand.base_url) {
      const err = new Error("wordpress_api requires a brand-resolved base_url.");
      err.code = "provider_domain_not_allowed";
      err.status = 403;
      throw err;
    }

    return {
      providerDomain: normalizeProviderDomain(brand.base_url),
      resolvedProviderDomainMode: "brand_bound_domain",
      placeholderResolutionSource: placeholderResolutionSource || "brand"
    };
  }

  if (!endpointProviderDomain) {
    if (!runtimeResolvedProviderDomain) {
      const fallbackRequested = safeNormalizeProviderDomain(requestedProviderDomain);
      if (!fallbackRequested) {
        const err = new Error("provider_domain is required.");
        err.code = "provider_domain_not_resolved";
        err.status = 400;
        throw err;
      }

      return {
        providerDomain: fallbackRequested,
        resolvedProviderDomainMode: "fixed_domain",
        placeholderResolutionSource: ""
      };
    }

    return {
      providerDomain: runtimeResolvedProviderDomain,
      resolvedProviderDomainMode: "fixed_domain",
      placeholderResolutionSource
    };
  }

  if (isVariablePlaceholder(endpointProviderDomain, policies)) {
    const allowPlaceholderResolution = String(
      policyValue(
        policies,
        "HTTP Execution Governance",
        "Allow Placeholder Provider Domain Resolution",
        "FALSE"
      )
    ).trim().toUpperCase() === "TRUE";

    if (!allowPlaceholderResolution) {
      const err = new Error("Placeholder provider_domain resolution is disabled by policy.");
      err.code = "provider_domain_placeholder_blocked";
      err.status = 403;
      throw err;
    }

    if (!requestBody.target_key && !requestBody.brand && !requestBody.brand_domain) {
      debugLog("MISSING_PLACEHOLDER_SOURCES_AT_RUNTIME:", JSON.stringify(requestBody));
    }

    const allowedSources = getPlaceholderResolutionSources(policies);
    const hasAllowedSource =
      (allowedSources.includes("brand_domain") && !!String(requestBody.brand_domain || "").trim()) ||
      (allowedSources.includes("target_key") && !!String(requestBody.target_key || "").trim()) ||
      (allowedSources.includes("brand") && !!String(requestBody.brand || "").trim());

    if (allowedSources.length && !hasAllowedSource) {
      debugLog("MISSING_PLACEHOLDER_SOURCES_AT_RUNTIME:", JSON.stringify(requestBody));
      const err = new Error(
        `provider_domain placeholder resolution requires one of: ${allowedSources.join(", ")}`
      );
      err.code = "provider_domain_resolution_source_missing";
      err.status = 400;
      throw err;
    }

    if (!runtimeResolvedProviderDomain) {
      const err = new Error("provider_domain must resolve from governed runtime input.");
      err.code = "provider_domain_not_resolved";
      err.status = 400;
      throw err;
    }

    return {
      providerDomain: runtimeResolvedProviderDomain,
      resolvedProviderDomainMode: "placeholder_runtime_resolved",
      placeholderResolutionSource
    };
  }

  const normalizedEndpointProviderDomain =
    normalizeEndpointProviderDomain(endpointProviderDomain);
  const normalizedRequested =
    safeNormalizeProviderDomain(requestedProviderDomain);

  // Fixed-domain provider actions may omit provider_domain in the request.
  // In that case, trust the endpoint definition.
  if (!normalizedRequested) {
    return {
      providerDomain: normalizedEndpointProviderDomain,
      resolvedProviderDomainMode: "fixed_domain",
      placeholderResolutionSource: ""
    };
  }

  if (normalizedRequested !== normalizedEndpointProviderDomain) {
    const err = new Error("provider_domain does not match endpoint definition.");
    err.code = "provider_domain_mismatch";
    err.status = 403;
    throw err;
  }

  return {
    providerDomain: normalizedEndpointProviderDomain,
    resolvedProviderDomainMode: "fixed_domain",
    placeholderResolutionSource: ""
  };
}

export function isOAuthConfigured(action) {
  const fileId = String(action.oauth_config_file_id || "").trim();
  return fileId !== "" && fileId.toLowerCase() !== "null";
}

export function applyPathParams(pathTemplate, pathParams = {}) {
  return String(pathTemplate || "").replace(/\{([^}]+)\}/g, (_, key) => {
    const value = pathParams[key];
    if (value === undefined || value === null || value === "") {
      const err = new Error(`Missing required path param: ${key}`);
      err.code = "invalid_request";
      err.status = 400;
      throw err;
    }
    return encodeURIComponent(String(value));
  });
}

export function pathTemplateToRegex(pathTemplate) {
  const escaped = String(pathTemplate)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{[^}]+\\\}/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

export function ensureMethodAndPathMatchEndpoint(
  endpoint,
  requestedMethod,
  requestedPath,
  pathParams = {}
) {
  const endpointMethod = normalizeMethod(endpoint.method);
  const endpointPath = normalizePath(endpoint.endpoint_path_or_function);

  let expandedPath = "";
  let pathExpansionError = null;

  try {
    expandedPath = normalizePath(
      applyPathParams(endpointPath, pathParams)
    );
  } catch (err) {
    pathExpansionError = err;
  }

  if (requestedMethod) {
    const normalizedRequestedMethod = normalizeMethod(requestedMethod);
    if (normalizedRequestedMethod !== endpointMethod) {
      const err = new Error(
        `Method does not match endpoint definition for ${endpoint.endpoint_key}.`
      );
      err.code = "method_mismatch";
      err.status = 400;
      throw err;
    }
  }

  if (requestedPath) {
    const normalizedRequestedPath = normalizePath(requestedPath);

    const exact =
      normalizedRequestedPath === endpointPath ||
      (!!expandedPath && normalizedRequestedPath === expandedPath);

    const regexMatch =
      pathTemplateToRegex(endpointPath).test(normalizedRequestedPath);

    if (!exact && !regexMatch) {
      const err = new Error(
        `Path does not match endpoint definition for ${endpoint.endpoint_key}.`
      );
      err.code = "path_mismatch";
      err.status = 400;
      throw err;
    }

    return {
      method: endpointMethod,
      path: normalizedRequestedPath,
      templatePath: endpointPath
    };
  }

  if (pathExpansionError) {
    throw pathExpansionError;
  }

  return {
    method: endpointMethod,
    path: expandedPath,
    templatePath: endpointPath
  };
}

export async function fetchSchemaContract(drive, fileId) {
  if (!fileId) {
    const err = new Error("Missing openai_schema_file_id.");
    err.code = "schema_binding_missing";
    err.status = 403;
    throw err;
  }

  const meta = await drive.files.get({
    fileId,
    fields: "id,name,mimeType"
  });

  const { mimeType = "", name = "" } = meta.data || {};
  let raw = "";

  if (mimeType.startsWith("application/vnd.google-apps")) {
    const exported = await drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "text" }
    );
    raw = String(exported.data || "");
  } else {
    const content = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" }
    );
    raw = String(content.data || "");
  }

  let parsed;
  try {
    if (name.endsWith(".json") || mimeType.includes("json")) {
      parsed = JSON.parse(raw);
    } else {
      parsed = YAML.parse(raw);
    }
  } catch {
    const err = new Error(`Unable to parse schema file ${fileId}.`);
    err.code = "schema_parse_failed";
    err.status = 500;
    throw err;
  }

  return { fileId, name, mimeType, raw, parsed };
}

export async function fetchOAuthConfigContract(drive, action) {
  const fileId = String(action.oauth_config_file_id || "").trim();
  if (!fileId) return null;

  try {
    const meta = await drive.files.get({ fileId, fields: "id,name,mimeType" });
    const { mimeType = "", name = "" } = meta.data || {};
    let raw = "";

    if (mimeType.startsWith("application/vnd.google-apps")) {
      const exported = await drive.files.export(
        { fileId, mimeType: "text/plain" },
        { responseType: "text" }
      );
      raw = String(exported.data || "");
    } else {
      const content = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "text" }
      );
      raw = String(content.data || "");
    }

    let parsed;
    try {
      if (name.endsWith(".json") || mimeType.includes("json")) {
        parsed = JSON.parse(raw);
      } else {
        parsed = YAML.parse(raw);
      }
    } catch {
      parsed = JSON.parse(raw);
    }

    return { fileId, name, mimeType, raw, parsed };
  } catch (err) {
    debugLog("OAUTH_CONFIG_READ_FAILED:", {
      action_key: action.action_key,
      oauth_config_file_id: fileId,
      message: err?.message || String(err)
    });
    return null;
  }
}

export function resolveSchemaOperation(schema, method, path) {
  const doc = schema?.parsed || {};
  const paths = doc.paths || {};
  const methodKey = String(method || "").toLowerCase();

  if (paths[path] && paths[path][methodKey]) {
    return { operation: paths[path][methodKey], pathTemplate: path };
  }

  for (const [template, entry] of Object.entries(paths)) {
    const regex = pathTemplateToRegex(template);
    if (regex.test(path) && entry?.[methodKey]) {
      return { operation: entry[methodKey], pathTemplate: template };
    }
  }

  return null;
}

export function validateByJsonSchema(schema, value, scope, pathPrefix = "") {
  if (!schema) return [];

  const errors = [];
  const types = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : []);
  const actualType = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  const normalizedActualType = actualType === "number" && Number.isInteger(value) ? "integer" : actualType;

  if (types.length && !types.includes(normalizedActualType) && !(types.includes("number") && normalizedActualType === "integer")) {
    errors.push(`${scope}${pathPrefix}: expected ${types.join("|")} got ${normalizedActualType}`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${scope}${pathPrefix}: value not in enum`);
    return errors;
  }

  if (normalizedActualType === "object" && schema.properties) {
    const required = schema.required || [];
    for (const req of required) {
      if (!(req in (value || {}))) {
        errors.push(`${scope}${pathPrefix}.${req}: missing required property`);
      }
    }
    for (const [key, rule] of Object.entries(schema.properties || {})) {
      if (value && key in value) {
        errors.push(...validateByJsonSchema(rule, value[key], scope, `${pathPrefix}.${key}`));
      }
    }
  }

  if (normalizedActualType === "array" && schema.items && Array.isArray(value)) {
    value.forEach((item, idx) => {
      errors.push(...validateByJsonSchema(schema.items, item, scope, `${pathPrefix}[${idx}]`));
    });
  }

  return errors;
}

export function validateParameters(operation, request) {
  const errors = [];
  const params = operation?.parameters || [];
  for (const param of params) {
    const where = param.in;
    const name = param.name;
    const required = !!param.required;
    const source = where === "path" ? request.path_params
      : where === "query" ? request.query
      : where === "header" ? request.headers
      : {};
    const value = source ? source[name] ?? source[name?.toLowerCase?.()] : undefined;
    if (required && (value === undefined || value === null || value === "")) {
      errors.push(`missing required ${where} parameter: ${name}`);
      continue;
    }
    if (value !== undefined && param.schema) {
      errors.push(...validateByJsonSchema(param.schema, value, `${where}:${name}`));
    }
  }
  return errors;
}

export function validateRequestBody(operation, body) {
  const reqBody = operation?.requestBody;
  if (!reqBody) return [];
  if (reqBody.required && (body === undefined || body === null)) {
    return ["missing required request body"];
  }
  if (body === undefined || body === null) return [];

  const content = reqBody.content || {};
  const jsonContent = content["application/json"] || Object.values(content)[0];
  const schema = jsonContent?.schema;
  if (!schema) return [];
  return validateByJsonSchema(schema, body, "body");
}

export function classifySchemaDrift(expected, actual, scope) {
  if (!expected || actual === undefined || actual === null || typeof actual !== "object" || Array.isArray(actual)) return null;
  const expectedProps = expected.properties || {};
  const expectedKeys = new Set(Object.keys(expectedProps));
  const actualKeys = Object.keys(actual);
  const required = new Set(expected.required || []);

  for (const key of required) {
    if (!(key in actual)) {
      return { schema_drift_detected: true, schema_drift_type: "missing_required", schema_drift_scope: scope };
    }
  }

  for (const key of actualKeys) {
    if (!expectedKeys.has(key)) {
      return { schema_drift_detected: true, schema_drift_type: "additive", schema_drift_scope: scope };
    }
    const rule = expectedProps[key] || {};
    if (rule.enum && !rule.enum.includes(actual[key])) {
      return { schema_drift_detected: true, schema_drift_type: "enum_mismatch", schema_drift_scope: scope };
    }
    const t = rule.type;
    if (t) {
      const actualType = Array.isArray(actual[key]) ? "array" : actual[key] === null ? "null" : typeof actual[key];
      const mappedActual = actualType === "number" && Number.isInteger(actual[key]) ? "integer" : actualType;
      const acceptable = Array.isArray(t) ? t : [t];
      if (!acceptable.includes(mappedActual) && !(acceptable.includes("number") && mappedActual === "integer")) {
        return { schema_drift_detected: true, schema_drift_type: "type_mismatch", schema_drift_scope: scope };
      }
    }
  }
  return null;
}

export function ensureWritePermissions(brand, method) {
  if (brand && ["POST", "PUT", "PATCH"].includes(method) && !boolFromSheet(brand.write_allowed)) {
    const err = new Error(`Write operations are not allowed for ${brand.brand_name || brand.base_url}.`);
    err.code = "method_not_allowed";
    err.status = 403;
    throw err;
  }

  if (method === "DELETE") {
    if (brand && boolFromSheet(brand.destructive_allowed)) return;
    const err = new Error("DELETE is not allowed for this target.");
    err.code = "method_not_allowed";
    err.status = 403;
    throw err;
  }
}

export async function resolveBrandRegistryBinding(identity = {}) {
  const registry = await readGovernedSheetRecords(BRAND_REGISTRY_SHEET);
  const row = findRegistryRecordByIdentity(registry.rows, identity);

  if (!row) {
    throw createHttpError(
      "brand_registry_binding_not_found",
      `Brand Registry binding not found for ${identity.target_key || identity.domain || "unknown site"}.`,
      409
    );
  }

  return {
    row,
    target_key:
      firstPopulated(row, ["target_key", "brand_key", "site_key"]) ||
      String(identity.target_key || "").trim(),
    brand_name:
      firstPopulated(row, ["brand_name", "company_name", "target_key"]) ||
      String(identity.brand || identity.target_key || "").trim(),
    base_url: firstPopulated(row, ["brand.base_url", "base_url", "website_url", "domain", "brand_domain"]),
    brand_domain: normalizeLooseHostname(
      firstPopulated(row, ["brand_domain", "domain", "website_url", "base_url"])
    ),
    hosting_account_key:
      firstPopulated(row, [
        "hosting_account_key",
        "hosting_account_registry_ref",
        "account_key",
        "hosting_key"
      ]) || "",
    hostinger_api_target_key:
      firstPopulated(row, [
        "hostinger_api_target_key",
        "hosting_account_key",
        "hosting_account_registry_ref"
      ]) || "",
    row_data: row
  };
}
