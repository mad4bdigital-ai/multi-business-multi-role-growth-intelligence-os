function normalize(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return normalize(value).toLowerCase();
}

function jsonObject(value, fallback = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return value;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized) return normalized;
  }
  return "";
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasFunction(value) {
  return typeof value === "function";
}

export function extractPathResolverLoadRequest(requestPayload = {}) {
  const body = jsonObject(requestPayload.body);
  const context = jsonObject(requestPayload.context);
  const pathResolution = jsonObject(context.path_resolution);
  const businessType = jsonObject(context.business_type);
  const brand = jsonObject(context.brand);

  const businessActivityTypeKey = firstNonEmpty(
    requestPayload.business_activity_type_key,
    requestPayload.business_activity_key,
    requestPayload.activity_type_key,
    body.business_activity_type_key,
    body.business_activity_key,
    body.activity_type_key,
    context.business_activity_type_key,
    context.business_activity_key,
    context.activity_type_key,
    businessType.business_activity_type_key,
    pathResolution.business_activity_type_key
  );

  const businessTypeKey = firstNonEmpty(
    requestPayload.business_type_key,
    requestPayload.business_type,
    body.business_type_key,
    body.business_type,
    context.business_type_key,
    businessType.business_type_key,
    pathResolution.business_type_key
  );

  const knowledgeProfileKey = firstNonEmpty(
    requestPayload.knowledge_profile_key,
    requestPayload.business_type_knowledge_profile_key,
    body.knowledge_profile_key,
    body.business_type_knowledge_profile_key,
    context.knowledge_profile_key,
    businessType.knowledge_profile_key,
    pathResolution.knowledge_profile_key
  );

  const brandKey = firstNonEmpty(
    requestPayload.brand_key,
    body.brand_key,
    context.brand_key,
    brand.brand_key,
    pathResolution.brand_key
  );

  const targetKey = firstNonEmpty(
    requestPayload.target_key,
    body.target_key,
    context.target_key,
    brand.target_key,
    pathResolution.target_key
  );

  const mutationIntent = lower(
    firstNonEmpty(
      requestPayload.mutation_intent,
      requestPayload.intent,
      body.mutation_intent,
      body.intent,
      context.mutation_intent,
      context.intent
    )
  );

  const requested = Boolean(
    businessActivityTypeKey ||
      businessTypeKey ||
      knowledgeProfileKey ||
      brandKey ||
      targetKey ||
      mutationIntent.includes("business_type") ||
      mutationIntent.includes("brand") ||
      mutationIntent.includes("folder")
  );

  return {
    requested,
    businessActivityTypeKey,
    businessTypeKey,
    knowledgeProfileKey,
    brandKey,
    targetKey,
    mutationIntent
  };
}

function buildHeaderMap(header = []) {
  const map = {};
  header.forEach((column, index) => {
    const key = normalize(column);
    if (key) map[key] = index;
  });
  return map;
}

function getCell(row = [], headerMap = {}, ...names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(headerMap, name)) {
      return normalize(row[headerMap[name]]);
    }
  }
  return "";
}

async function readSheetRows({ sheetName, columnEnd = "AZ", dataEndRow = 2500, deps = {} }) {
  const spreadsheetId = deps.REGISTRY_SPREADSHEET_ID;
  if (!spreadsheetId) return [];

  if (!hasFunction(deps.getGoogleClientsForSpreadsheet)) return [];

  const { sheets } = await deps.getGoogleClientsForSpreadsheet(spreadsheetId);

  let values = [];
  if (hasFunction(deps.fetchChunkedTable)) {
    values = await deps.fetchChunkedTable(sheets, {
      spreadsheetId,
      sheetName,
      columnStart: "A",
      columnEnd,
      headerRow: 1,
      dataStartRow: 2,
      dataEndRow
    });
  } else {
    const escaped = sheetName.replace(/'/g, "''");
    const range = `'${escaped}'!A1:${columnEnd}${dataEndRow}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });
    values = response.data.values || [];
  }

  if (values.length < 2) return [];

  const header = values[0].map(value => normalize(value));
  const headerMap = hasFunction(deps.headerMap)
    ? deps.headerMap(header, sheetName)
    : buildHeaderMap(header);

  const cell = hasFunction(deps.getCell)
    ? (row, ...names) => {
        for (const name of names) {
          const value = deps.getCell(row, headerMap, name);
          if (normalize(value)) return normalize(value);
        }
        return "";
      }
    : (row, ...names) => getCell(row, headerMap, ...names);

  return values.slice(1).map(row => ({ row, cell }));
}

function rowMatchesAny(rowObject, keys = []) {
  const wanted = keys.map(lower).filter(Boolean);
  if (!wanted.length) return true;

  return Object.values(rowObject).some(value => {
    const normalized = lower(value);
    return normalized && wanted.includes(normalized);
  });
}

async function loadBusinessActivityRows(loadRequest, deps) {
  const entries = await readSheetRows({
    sheetName: "Business Activity Type Registry",
    columnEnd: "AZ",
    deps
  });

  const keys = [
    loadRequest.businessActivityTypeKey,
    loadRequest.businessTypeKey,
    loadRequest.knowledgeProfileKey
  ];

  return entries
    .map(({ row, cell }) => ({
      business_activity_type_key: cell(row, "business_activity_type_key", "activity_key", "business_type_key"),
      business_type_key: cell(row, "business_type_key"),
      activity_key: cell(row, "activity_key"),
      label: cell(row, "label", "activity_label", "business_activity_label"),
      parent_activity_type: cell(row, "parent_activity_type"),
      default_knowledge_profile_key: cell(row, "default_knowledge_profile_key", "knowledge_profile_key"),
      supported_engine_categories: cell(row, "supported_engine_categories"),
      supported_route_keys: cell(row, "supported_route_keys"),
      supported_workflows: cell(row, "supported_workflows"),
      brand_core_required: cell(row, "brand_core_required"),
      status: cell(row, "status", "active_status")
    }))
    .filter(row => rowMatchesAny(row, keys));
}

async function loadBusinessTypeProfileRows(loadRequest, deps) {
  const entries = await readSheetRows({
    sheetName: "Business Type Knowledge Profiles",
    columnEnd: "Z",
    deps
  });

  const keys = [
    loadRequest.businessTypeKey,
    loadRequest.knowledgeProfileKey,
    loadRequest.businessActivityTypeKey
  ];

  return entries
    .map(({ row, cell }) => ({
      business_type: cell(row, "business_type", "business_type_key"),
      knowledge_profile_key: cell(row, "knowledge_profile_key"),
      supported_engine_categories: cell(row, "supported_engine_categories"),
      authoritative_read_home: cell(row, "authoritative_read_home", "surface_id"),
      business_type_specific_read_home: cell(row, "business_type_specific_read_home", "business_type_folder_path"),
      shared_knowledge_read_home: cell(row, "shared_knowledge_read_home"),
      compatible_route_keys: cell(row, "compatible_route_keys"),
      compatible_workflows: cell(row, "compatible_workflows"),
      profile_status: cell(row, "profile_status", "status"),
      notes: cell(row, "notes")
    }))
    .filter(row => rowMatchesAny(row, keys));
}

async function loadBrandRows(loadRequest, deps) {
  const entries = await readSheetRows({
    sheetName: "Brand Registry",
    columnEnd: "CX",
    deps
  });

  const keys = [loadRequest.brandKey, loadRequest.targetKey];

  return entries
    .map(({ row, cell }) => ({
      brand_key: cell(row, "brand_key", "target_key"),
      brand_name: cell(row, "Brand Name", "brand_name"),
      normalized_brand_name: cell(row, "Normalized Brand Name", "normalized_brand_name"),
      business_type_key: cell(row, "business_type_key"),
      knowledge_profile_key: cell(row, "knowledge_profile_key"),
      brand_folder_id: cell(row, "brand_folder_id"),
      target_key: cell(row, "target_key"),
      base_url: cell(row, "base_url"),
      website_url: cell(row, "website_url", "base_url"),
      brand_domain: cell(row, "brand_domain"),
      status: cell(row, "status", "active_status")
    }))
    .filter(row => rowMatchesAny(row, keys));
}

async function loadBrandPathRows(loadRequest, deps) {
  const entries = await readSheetRows({
    sheetName: "Brand Path Resolver",
    columnEnd: "AZ",
    deps
  });

  const keys = [loadRequest.brandKey, loadRequest.targetKey];

  return entries
    .map(({ row, cell }) => ({
      brand_key: cell(row, "brand_key"),
      normalized_brand_name: cell(row, "normalized_brand_name"),
      business_type_key: cell(row, "business_type_key"),
      knowledge_profile_key: cell(row, "knowledge_profile_key"),
      brand_folder_id: cell(row, "brand_folder_id"),
      brand_folder_path: cell(row, "brand_folder_path"),
      brand_core_docs_json: cell(row, "brand_core_docs_json"),
      target_key: cell(row, "target_key"),
      base_url: cell(row, "base_url"),
      status: cell(row, "status")
    }))
    .filter(row => rowMatchesAny(row, keys));
}

async function loadBrandCoreRows(loadRequest, deps) {
  const entries = await readSheetRows({
    sheetName: "Brand Core Registry",
    columnEnd: "AZ",
    deps
  });

  const keys = [loadRequest.brandKey, loadRequest.targetKey];

  return entries
    .map(({ row, cell }) => ({
      brand_key: cell(row, "brand_key", "target_key"),
      asset_key: cell(row, "asset_key", "doc_key", "brand_core_asset_key"),
      doc_key: cell(row, "doc_key"),
      doc_id: cell(row, "doc_id", "file_id", "google_doc_id"),
      file_id: cell(row, "file_id"),
      google_doc_id: cell(row, "google_doc_id"),
      brand_core_docs_json: cell(row, "brand_core_docs_json"),
      status: cell(row, "status")
    }))
    .filter(row => rowMatchesAny(row, keys));
}

async function loadTargetRows(loadRequest, deps) {
  const entries = await readSheetRows({
    sheetName: "Brand Registry",
    columnEnd: "CX",
    deps
  });

  const keys = [loadRequest.targetKey, loadRequest.brandKey];

  return entries
    .map(({ row, cell }) => ({
      target_key: cell(row, "target_key"),
      brand_key: cell(row, "brand_key", "target_key"),
      base_url: cell(row, "base_url"),
      brand_domain: cell(row, "brand_domain"),
      provider: cell(row, "provider", "transport_action_key"),
      auth_status: cell(row, "auth_status", "auth_validation_status"),
      validation_state: cell(row, "validation_state", "resolver_execution_ready"),
      status: cell(row, "status")
    }))
    .filter(row => rowMatchesAny(row, keys));
}

async function loadValidationRows(loadRequest, deps) {
  const entries = await readSheetRows({
    sheetName: "Validation & Repair Registry",
    columnEnd: "AZ",
    deps
  });

  const keys = [
    loadRequest.brandKey,
    loadRequest.targetKey,
    loadRequest.businessTypeKey,
    loadRequest.businessActivityTypeKey,
    loadRequest.knowledgeProfileKey
  ];

  return entries
    .map(({ row, cell }) => ({
      validation_id: cell(row, "validation_id"),
      entity_key: cell(row, "entity_key", "validation_target"),
      surface_id: cell(row, "surface_id", "target_surface_id"),
      validation_target: cell(row, "validation_target"),
      target_surface_id: cell(row, "target_surface_id"),
      validation_status: cell(row, "validation_status", "state"),
      readiness_state: cell(row, "readiness_state"),
      repair_required: cell(row, "repair_required"),
      status: cell(row, "status"),
      last_validated_at: cell(row, "last_validated_at"),
      notes: cell(row, "notes")
    }))
    .filter(row => rowMatchesAny(row, keys));
}

export async function loadPathResolverRowsForRequest(requestPayload = {}, deps = {}) {
  const loadRequest = extractPathResolverLoadRequest(requestPayload);

  if (!loadRequest.requested) {
    return {
      requested: false,
      loaded: false,
      reason: "not_requested",
      rows: {}
    };
  }

  const envDataSource = typeof process !== "undefined" ? process.env?.DATA_SOURCE : "";
  const dataSourceMode = lower(firstNonEmpty(
    deps.DATA_SOURCE,
    deps.runtimeAuthority,
    envDataSource
  ));

  if (["sql", "db", "mysql"].includes(dataSourceMode)) {
    const { loadPathResolverRowsFromDb } = await import('./pathResolverDbLoader.js');
    return loadPathResolverRowsFromDb(loadRequest);
  }

  if (!hasFunction(deps.getGoogleClientsForSpreadsheet)) {
    const { loadPathResolverRowsFromDb } = await import('./pathResolverDbLoader.js');
    return loadPathResolverRowsFromDb(loadRequest);
  }

  if (!deps.REGISTRY_SPREADSHEET_ID) {
    return {
      requested: true,
      loaded: false,
      reason: "missing_registry_sheet_dependencies",
      load_request: loadRequest,
      rows: {}
    };
  }

  const [
    businessActivityRows,
    profileRows,
    brandRows,
    brandPathRows,
    brandCoreRows,
    targetRows,
    validationRows
  ] = await Promise.all([
    loadBusinessActivityRows(loadRequest, deps),
    loadBusinessTypeProfileRows(loadRequest, deps),
    loadBrandRows(loadRequest, deps),
    loadBrandPathRows(loadRequest, deps).catch(() => []),
    loadBrandCoreRows(loadRequest, deps).catch(() => []),
    loadTargetRows(loadRequest, deps),
    loadValidationRows(loadRequest, deps)
  ]);

  return {
    requested: true,
    loaded: true,
    reason: "loaded",
    load_request: loadRequest,
    rows: {
      businessActivityRows: safeArray(businessActivityRows),
      profileRows: safeArray(profileRows),
      brandRows: safeArray(brandRows),
      brandPathRows: safeArray(brandPathRows),
      brandCoreRows: safeArray(brandCoreRows),
      targetRows: safeArray(targetRows),
      validationRows: safeArray(validationRows)
    }
  };
}
