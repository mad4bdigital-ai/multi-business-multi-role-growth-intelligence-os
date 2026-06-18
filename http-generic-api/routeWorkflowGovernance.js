export function buildRecordFromHeaderAndRow(header = [], row = []) {
  const record = {};
  header.forEach((key, idx) => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return;
    record[normalizedKey] = row[idx] ?? "";
  });
  return record;
}

export function buildSheetRowFromColumns(columns = [], row = {}, deps = {}) {
  return columns.map(column => deps.toSheetCellValue(row[column]));
}

export function assertCanonicalHeaderExact(header = [], expected = [], sheetName = "sheet") {
  const actual = (header || []).map(value => String(value || "").trim());
  const canonical = (expected || []).map(value => String(value || "").trim());

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

export function blockLegacyRouteWorkflowWrite(surfaceName = "", requestedColumns = [], deps = {}) {
  const cols = (requestedColumns || []).map(value => String(value || "").trim());

  if (
    surfaceName === deps.TASK_ROUTES_SHEET &&
    cols.length > 0 &&
    cols.length < deps.TASK_ROUTES_CANONICAL_COLUMNS.length
  ) {
    const err = new Error(
      `Blocked legacy write to ${surfaceName}. Canonical schema requires ${deps.TASK_ROUTES_CANONICAL_COLUMNS.length} columns.`
    );
    err.code = "legacy_schema_write_blocked";
    err.status = 500;
    throw err;
  }

  if (
    surfaceName === deps.WORKFLOW_REGISTRY_SHEET &&
    cols.length > 0 &&
    cols.length < deps.WORKFLOW_REGISTRY_CANONICAL_COLUMNS.length
  ) {
    const err = new Error(
      `Blocked legacy write to ${surfaceName}. Canonical schema requires ${deps.WORKFLOW_REGISTRY_CANONICAL_COLUMNS.length} columns.`
    );
    err.code = "legacy_schema_write_blocked";
    err.status = 500;
    throw err;
  }

  return true;
}

export function assertNoLegacySiteMigrationScaffolding(deps = {}) {
  if (
    deps.siteMigrationTaskRouteColumnsDefined ||
    deps.siteMigrationWorkflowColumnsDefined ||
    deps.siteMigrationTaskRouteRowsDefined ||
    deps.siteMigrationWorkflowRowsDefined
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

  const duplicates = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);

  if (duplicates.length) {
    const err = new Error(`${sheetName} has duplicate active governed keys: ${duplicates.join(", ")}`);
    err.code = "duplicate_active_governed_keys";
    err.status = 500;
    throw err;
  }

  return true;
}

export function normalizeGovernedAdditionState(value = "", deps = {}) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "active";
  if (!deps.GOVERNED_ADDITION_STATES.has(v)) return "active";
  return v;
}

export function normalizeGovernedAdditionOutcome(value = "", deps = {}) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "";
  if (!deps.GOVERNED_ADDITION_OUTCOMES.has(v)) return "";
  return v;
}

export function governedAdditionStateBlocksAuthority(value = "", deps = {}) {
  const state = normalizeGovernedAdditionState(value, deps);
  return ["candidate", "inactive", "pending_validation", "blocked", "degraded"].includes(state);
}

export function hasDeferredGovernedActivationDependencies(row = {}, keys = [], deps = {}) {
  return (keys || []).some(key => deps.boolFromSheet(row?.[key]));
}

export function buildGovernedAdditionReviewResult(args = {}, deps = {}) {
  const outcome = normalizeGovernedAdditionOutcome(args.outcome, deps);
  if (!outcome) {
    const err = new Error("Invalid governed addition outcome.");
    err.code = "invalid_governed_addition_outcome";
    err.status = 400;
    throw err;
  }

  return {
    outcome,
    addition_state: normalizeGovernedAdditionState(
      args.addition_state || "pending_validation",
      deps
    ),
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

export function assertNoDirectActivationWithoutGovernedReview(row = {}, surfaceName = "sheet", deps = {}) {
  const additionState = normalizeGovernedAdditionState(
    row.addition_status || row.governance_status || row.validation_status || "",
    deps
  );
  const active = String(row.active || "").trim().toUpperCase() === "TRUE";

  if (active && ["candidate", "pending_validation", "inactive", "blocked", "degraded"].includes(additionState)) {
    return true;
  }

  if (active && !additionState) {
    return true;
  }

  return true;
}

export async function getSpreadsheetSheetMap(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    fields: "sheets.properties(sheetId,title,index)"
  });

  const map = {};
  for (const sheet of response.data.sheets || []) {
    const props = sheet?.properties || {};
    const title = String(props.title || "").trim();
    if (!title) continue;
    map[title] = {
      sheetId: props.sheetId,
      title,
      index: props.index
    };
  }
  return map;
}

export async function ensureSheetWithHeader(sheets, spreadsheetId, sheetName, columns, deps = {}) {
  blockLegacyRouteWorkflowWrite(sheetName, columns, deps);

  const sheetMap = await getSpreadsheetSheetMap(sheets, spreadsheetId);
  if (!sheetMap[sheetName]) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: String(spreadsheetId || "").trim(),
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }
        ]
      }
    });
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: deps.toValuesApiRange(sheetName, "1:2")
  });

  const values = response.data.values || [];
  const existingHeader = (values[0] || []).map(value => String(value || "").trim()).filter(Boolean);

  if (!existingHeader.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: String(spreadsheetId || "").trim(),
      range: deps.toValuesApiRange(sheetName, "A1"),
      valueInputOption: "RAW",
      requestBody: {
        values: [columns]
      }
    });
    return { created: true, header_written: true };
  }

  const existingSignature = deps.computeHeaderSignature(existingHeader);
  const expectedSignature = deps.computeHeaderSignature(columns);
  if (existingSignature !== expectedSignature) {
    const err = new Error(`${sheetName} header signature mismatch.`);
    err.code = "sheet_schema_mismatch";
    err.status = 409;
    throw err;
  }

  return { created: false, header_written: false };
}

export async function appendRowsIfMissingByKeys(
  sheets,
  spreadsheetId,
  sheetName,
  columns,
  keyColumns,
  rows = [],
  deps = {}
) {
  blockLegacyRouteWorkflowWrite(sheetName, columns, deps);

  if (!rows.length) return { appended: 0, existing: 0 };

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: deps.toValuesApiRange(sheetName, "A:AZ")
  });

  const values = response.data.values || [];
  const header = (values[0] || []).map(value => String(value || "").trim());
  const existingRows = values.slice(1).map(row => buildRecordFromHeaderAndRow(header, row));

  const seen = new Set(
    existingRows.map(record =>
      keyColumns.map(key => String(record[key] || "").trim()).join("||")
    )
  );

  const missingRows = rows.filter(row => {
    const key = keyColumns.map(column => String(row[column] || "").trim()).join("||");
    return key && !seen.has(key);
  });

  if (!missingRows.length) {
    return { appended: 0, existing: rows.length };
  }

  for (const row of missingRows) {
    assertNoDirectActivationWithoutGovernedReview(row, sheetName, deps);
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: deps.toA1Start(sheetName),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: missingRows.map(row => buildSheetRowFromColumns(columns, row, deps))
    }
  });

  return {
    appended: missingRows.length,
    existing: rows.length - missingRows.length
  };
}

export async function ensureSiteMigrationRegistrySurfaces(deps = {}) {
  assertNoLegacySiteMigrationScaffolding(deps);

  await deps.assertSheetExistsInSpreadsheet(deps.REGISTRY_SPREADSHEET_ID, deps.SITE_RUNTIME_INVENTORY_REGISTRY_SHEET);
  await deps.assertSheetExistsInSpreadsheet(deps.REGISTRY_SPREADSHEET_ID, deps.SITE_SETTINGS_INVENTORY_REGISTRY_SHEET);
  await deps.assertSheetExistsInSpreadsheet(deps.REGISTRY_SPREADSHEET_ID, deps.PLUGIN_INVENTORY_REGISTRY_SHEET);

  const taskShape = await deps.readLiveSheetShape(
    deps.REGISTRY_SPREADSHEET_ID,
    deps.TASK_ROUTES_SHEET,
    deps.toValuesApiRange(deps.TASK_ROUTES_SHEET, "A1:AF2")
  );
  const taskRoutesMetadata = await deps.getCanonicalSurfaceMetadata("surface.task_routes_sheet", {
    columns: deps.TASK_ROUTES_CANONICAL_COLUMNS,
    schema_ref: "row_audit_schema:Task Routes",
    schema_version: "v1",
    binding_mode: "gid_based",
    sheet_role: "authority_surface",
    audit_mode: "exact_header_match"
  });
  deps.assertHeaderMatchesSurfaceMetadata({
    sheetName: deps.TASK_ROUTES_SHEET,
    actualHeader: taskShape.header,
    metadata: taskRoutesMetadata,
    fallbackColumns: deps.TASK_ROUTES_CANONICAL_COLUMNS
  });

  const workflowShape = await deps.readLiveSheetShape(
    deps.REGISTRY_SPREADSHEET_ID,
    deps.WORKFLOW_REGISTRY_SHEET,
    deps.toValuesApiRange(deps.WORKFLOW_REGISTRY_SHEET, "A1:AL2")
  );
  const workflowRegistryMetadata = await deps.getCanonicalSurfaceMetadata(
    "surface.workflow_registry_sheet",
    {
      columns: deps.WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Workflow Registry",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  deps.assertHeaderMatchesSurfaceMetadata({
    sheetName: deps.WORKFLOW_REGISTRY_SHEET,
    actualHeader: workflowShape.header,
    metadata: workflowRegistryMetadata,
    fallbackColumns: deps.WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });

  const taskRoutesSchemaLabel =
    [
      String(taskRoutesMetadata.schema_ref || "").trim(),
      String(taskRoutesMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_32";
  const workflowRegistrySchemaLabel =
    [
      String(workflowRegistryMetadata.schema_ref || "").trim(),
      String(workflowRegistryMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_38";

  return {
    mode: "validate_only",
    site_runtime_inventory: { exists: true },
    site_settings_inventory: { exists: true },
    plugin_inventory: { exists: true },
    task_routes: {
      exists: true,
      schema: taskRoutesSchemaLabel
    },
    workflow_registry: {
      exists: true,
      schema: workflowRegistrySchemaLabel
    }
  };
}

export async function ensureSiteMigrationRouteWorkflowRows(deps = {}) {
  assertNoLegacySiteMigrationScaffolding(deps);

  const taskShape = await deps.readLiveSheetShape(
    deps.REGISTRY_SPREADSHEET_ID,
    deps.TASK_ROUTES_SHEET,
    deps.toValuesApiRange(deps.TASK_ROUTES_SHEET, "A1:AF2")
  );
  const taskRoutesMetadata = await deps.getCanonicalSurfaceMetadata("surface.task_routes_sheet", {
    columns: deps.TASK_ROUTES_CANONICAL_COLUMNS,
    schema_ref: "row_audit_schema:Task Routes",
    schema_version: "v1",
    binding_mode: "gid_based",
    sheet_role: "authority_surface",
    audit_mode: "exact_header_match"
  });
  deps.assertHeaderMatchesSurfaceMetadata({
    sheetName: deps.TASK_ROUTES_SHEET,
    actualHeader: taskShape.header,
    metadata: taskRoutesMetadata,
    fallbackColumns: deps.TASK_ROUTES_CANONICAL_COLUMNS
  });

  const workflowShape = await deps.readLiveSheetShape(
    deps.REGISTRY_SPREADSHEET_ID,
    deps.WORKFLOW_REGISTRY_SHEET,
    deps.toValuesApiRange(deps.WORKFLOW_REGISTRY_SHEET, "A1:AL2")
  );
  const workflowRegistryMetadata = await deps.getCanonicalSurfaceMetadata(
    "surface.workflow_registry_sheet",
    {
      columns: deps.WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Workflow Registry",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  deps.assertHeaderMatchesSurfaceMetadata({
    sheetName: deps.WORKFLOW_REGISTRY_SHEET,
    actualHeader: workflowShape.header,
    metadata: workflowRegistryMetadata,
    fallbackColumns: deps.WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });

  const { sheets } = await deps.getGoogleClients({ action_key: "google_sheets_api" });
  const taskRoutes = await deps.loadTaskRoutesRegistry(sheets, {
    include_candidate_inspection: true
  });
  const workflows = await deps.loadWorkflowRegistry(sheets, {
    include_candidate_inspection: true
  });

  const foundTaskKeys = new Set(
    taskRoutes
      .map(row => String(row.task_key || row.route_key || "").trim())
      .filter(Boolean)
  );
  const foundWorkflowIds = new Set(
    workflows
      .map(row => String(row.workflow_id || "").trim())
      .filter(Boolean)
  );

  const executableTaskKeys = new Set(
    taskRoutes
      .filter(row => row.executable_authority === true)
      .map(row => String(row.task_key || row.route_key || "").trim())
      .filter(Boolean)
  );
  const executableWorkflowIds = new Set(
    workflows
      .filter(row => row.executable_authority === true)
      .map(row => String(row.workflow_id || "").trim())
      .filter(Boolean)
  );

  const missingTaskKeys = deps.REQUIRED_SITE_MIGRATION_TASK_KEYS.filter(value => !foundTaskKeys.has(value));
  const missingWorkflowIds = deps.REQUIRED_SITE_MIGRATION_WORKFLOW_IDS.filter(value => !foundWorkflowIds.has(value));

  const unresolvedTaskAuthority = deps.REQUIRED_SITE_MIGRATION_TASK_KEYS.filter(
    value => foundTaskKeys.has(value) && !executableTaskKeys.has(value)
  );
  const unresolvedWorkflowAuthority = deps.REQUIRED_SITE_MIGRATION_WORKFLOW_IDS.filter(
    value => foundWorkflowIds.has(value) && !executableWorkflowIds.has(value)
  );

  const chainReviewRequired =
    taskRoutes.some(row => deps.boolFromSheet(row.chain_candidate)) ||
    workflows.some(row => deps.boolFromSheet(row.chain_eligible));
  const graphReviewRequired =
    taskRoutes.some(row => deps.boolFromSheet(row.graph_update_required)) ||
    workflows.some(row => deps.boolFromSheet(row.graph_update_required));
  const bindingsReviewRequired =
    taskRoutes.some(row => deps.boolFromSheet(row.bindings_update_required)) ||
    workflows.some(row => deps.boolFromSheet(row.bindings_update_required));
  const reconciliationRequired =
    taskRoutes.some(row => deps.boolFromSheet(row.reconciliation_required)) ||
    workflows.some(row => deps.boolFromSheet(row.reconciliation_required));
  const policyReviewRequired =
    taskRoutes.some(row => deps.boolFromSheet(row.policy_update_required)) ||
    workflows.some(
      row =>
        deps.boolFromSheet(row.policy_update_required) ||
        deps.boolFromSheet(row.policy_dependency_required)
    );
  const starterReviewRequired =
    taskRoutes.some(row => deps.boolFromSheet(row.starter_update_required)) ||
    workflows.some(row => deps.boolFromSheet(row.starter_update_required));
  const repairMappingRequired = workflows.some(row => deps.boolFromSheet(row.repair_mapping_required));

  const hasMissingDependencies = missingTaskKeys.length > 0 || missingWorkflowIds.length > 0;
  const hasDeferredActivation =
    unresolvedTaskAuthority.length > 0 ||
    unresolvedWorkflowAuthority.length > 0 ||
    chainReviewRequired ||
    graphReviewRequired ||
    bindingsReviewRequired ||
    reconciliationRequired ||
    policyReviewRequired ||
    starterReviewRequired ||
    repairMappingRequired;

  const outcome = hasMissingDependencies
    ? "degraded_missing_dependencies"
    : hasDeferredActivation
      ? "pending_validation"
      : "reuse_existing";

  const review = buildGovernedAdditionReviewResult(
    {
      outcome,
      addition_state: outcome === "reuse_existing" ? "active" : "pending_validation",
      route_overlap_detected: false,
      workflow_overlap_detected: false,
      chain_needed: chainReviewRequired,
      graph_update_required: graphReviewRequired,
      bindings_update_required: bindingsReviewRequired,
      policy_update_required: policyReviewRequired,
      starter_update_required: starterReviewRequired,
      reconciliation_required: reconciliationRequired
    },
    deps
  );

  const taskRoutesSchemaLabel =
    [
      String(taskRoutesMetadata.schema_ref || "").trim(),
      String(taskRoutesMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_32";
  const workflowRegistrySchemaLabel =
    [
      String(workflowRegistryMetadata.schema_ref || "").trim(),
      String(workflowRegistryMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_38";

  return {
    mode: "validate_only",
    outcome,
    review,
    task_routes_schema: taskRoutesSchemaLabel,
    workflow_registry_schema: workflowRegistrySchemaLabel,
    found_task_keys: [...foundTaskKeys],
    found_workflow_ids: [...foundWorkflowIds],
    executable_task_keys: [...executableTaskKeys],
    executable_workflow_ids: [...executableWorkflowIds],
    missing_task_keys: missingTaskKeys,
    missing_workflow_ids: missingWorkflowIds,
    unresolved_task_authority: unresolvedTaskAuthority,
    unresolved_workflow_authority: unresolvedWorkflowAuthority,
    chain_review_required: chainReviewRequired,
    graph_review_required: graphReviewRequired,
    bindings_review_required: bindingsReviewRequired,
    reconciliation_required: reconciliationRequired,
    policy_review_required: policyReviewRequired,
    starter_review_required: starterReviewRequired,
    repair_mapping_required: repairMappingRequired,
    task_routes_ready: deps.REQUIRED_SITE_MIGRATION_TASK_KEYS.every(value => executableTaskKeys.has(value)),
    workflow_registry_ready: deps.REQUIRED_SITE_MIGRATION_WORKFLOW_IDS.every(value => executableWorkflowIds.has(value))
  };
}

function normalizeRegistryKey(value = "") {
  return String(value || "").trim();
}

function rowMatchesAiIntent(row = {}, intentKey = "") {
  const wanted = normalizeRegistryKey(intentKey);
  if (!wanted) return false;
  return [
    row.intent_key,
    row.task_key,
    row.route_key,
    row.route_id
  ].some(value => normalizeRegistryKey(value) === wanted);
}

function workflowMatchesRouteBinding(workflow = {}, taskRoute = {}) {
  const workflowKey = normalizeRegistryKey(taskRoute.workflow_key);
  const routeKeys = [
    taskRoute.intent_key,
    taskRoute.task_key,
    taskRoute.route_key,
    taskRoute.route_id
  ]
    .map(normalizeRegistryKey)
    .filter(Boolean);

  if (workflowKey) {
    return [workflow.workflow_id, workflow.workflow_key].some(
      value => normalizeRegistryKey(value) === workflowKey
    );
  }

  return routeKeys.some(routeKey =>
    normalizeRegistryKey(workflow.route_key) === routeKey ||
    normalizeRegistryKey(workflow.route_compatibility).split(/[|,;]/).map(normalizeRegistryKey).includes(routeKey)
  );
}

export function buildAiResolverRegistryReadiness(args = {}) {
  const taskRoutes = Array.isArray(args.taskRoutes) ? args.taskRoutes : [];
  const workflows = Array.isArray(args.workflows) ? args.workflows : [];
  const requiredIntentKeys = (args.requiredIntentKeys || [])
    .map(normalizeRegistryKey)
    .filter(Boolean);

  const bindings = requiredIntentKeys.map(intentKey => {
    const candidateRoutes = taskRoutes.filter(row => rowMatchesAiIntent(row, intentKey));
    const executableRoutes = candidateRoutes.filter(row => row.executable_authority === true);
    const selectedRoute = executableRoutes[0] || candidateRoutes[0] || null;
    const candidateWorkflows = selectedRoute
      ? workflows.filter(row => workflowMatchesRouteBinding(row, selectedRoute))
      : [];
    const executableWorkflows = candidateWorkflows.filter(row => row.executable_authority === true);
    const selectedWorkflow = executableWorkflows[0] || candidateWorkflows[0] || null;

    return {
      intent_key: intentKey,
      route_found: candidateRoutes.length > 0,
      route_executable: executableRoutes.length > 0,
      route_id: normalizeRegistryKey(selectedRoute?.route_id),
      route_task_key: normalizeRegistryKey(selectedRoute?.task_key),
      route_workflow_key: normalizeRegistryKey(selectedRoute?.workflow_key),
      workflow_found: candidateWorkflows.length > 0,
      workflow_executable: executableWorkflows.length > 0,
      workflow_id: normalizeRegistryKey(selectedWorkflow?.workflow_id),
      workflow_key: normalizeRegistryKey(selectedWorkflow?.workflow_key),
      workflow_route_key: normalizeRegistryKey(selectedWorkflow?.route_key)
    };
  });

  const missingIntentKeys = bindings
    .filter(binding => !binding.route_found)
    .map(binding => binding.intent_key);
  const unresolvedTaskAuthority = bindings
    .filter(binding => binding.route_found && !binding.route_executable)
    .map(binding => binding.intent_key);
  const missingWorkflowBindings = bindings
    .filter(binding => binding.route_executable && !binding.workflow_found)
    .map(binding => binding.intent_key);
  const unresolvedWorkflowAuthority = bindings
    .filter(binding => binding.workflow_found && !binding.workflow_executable)
    .map(binding => binding.intent_key);

  return {
    mode: "validate_only",
    required_intent_keys: requiredIntentKeys,
    bindings,
    missing_intent_keys: missingIntentKeys,
    unresolved_task_authority: unresolvedTaskAuthority,
    missing_workflow_bindings: missingWorkflowBindings,
    unresolved_workflow_authority: unresolvedWorkflowAuthority,
    task_routes_ready: missingIntentKeys.length === 0 && unresolvedTaskAuthority.length === 0,
    workflow_registry_ready:
      missingWorkflowBindings.length === 0 && unresolvedWorkflowAuthority.length === 0,
    ok:
      missingIntentKeys.length === 0 &&
      unresolvedTaskAuthority.length === 0 &&
      missingWorkflowBindings.length === 0 &&
      unresolvedWorkflowAuthority.length === 0
  };
}

export async function ensureAiResolverRouteWorkflowRows(deps = {}) {
  const { sheets } = await deps.getGoogleClients({ action_key: "google_sheets_api" });
  const taskRoutes = await deps.loadTaskRoutesRegistry(sheets, {
    include_candidate_inspection: true
  });
  const workflows = await deps.loadWorkflowRegistry(sheets, {
    include_candidate_inspection: true
  });

  return buildAiResolverRegistryReadiness({
    taskRoutes,
    workflows,
    requiredIntentKeys: deps.REQUIRED_AI_RESOLVER_INTENT_KEYS
  });
}
