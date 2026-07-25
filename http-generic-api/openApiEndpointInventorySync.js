import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { getPool } from "./db.js";
import {
  capabilityEnvelopeError,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OPENAPI_PATH = path.join(__dirname, "openapi.yaml");
const CONFIG_KEY = "openapi_endpoint_inventory_sync";
const PARENT_ACTION_KEY = "internal_platform_api";
const INVENTORY_ROLE = "openapi_internal_route_inventory";
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
const APPLY_CONFIRMATION = "SYNC_OPENAPI_ENDPOINT_INVENTORY";
const ADVISORY_LOCK_NAME = "openapi_endpoint_inventory_sync_v1";
const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const ACCEPTED_OPERATION_INTENTS = Object.freeze([
  "openapi_endpoint_inventory_sync",
  "openapi_registry_sync",
  "platform.openapi.endpoint_inventory.sync",
]);

function syncError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value = "") {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function normalizePath(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized.startsWith("/")) {
    throw syncError(422, "openapi_inventory_invalid_path", "OpenAPI path must start with '/'.", { path: normalized });
  }
  return normalized;
}

function normalizeOperationId(value = "") {
  const operationId = String(value || "").trim();
  if (!operationId) {
    throw syncError(422, "openapi_inventory_operation_id_missing", "Every OpenAPI operation must declare operationId.");
  }
  if (operationId.length > 220 || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(operationId)) {
    throw syncError(422, "openapi_inventory_operation_id_invalid", "OpenAPI operationId is invalid for SQL inventory.", { operation_id: operationId });
  }
  return operationId;
}

function decodePointerPart(value = "") {
  return String(value).replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolvePointer(document, fragment = "") {
  const normalized = String(fragment || "");
  if (!normalized || normalized === "#") return document;
  if (!normalized.startsWith("#/")) {
    throw syncError(422, "openapi_inventory_ref_fragment_invalid", "Only JSON Pointer fragments are supported for local OpenAPI references.", { fragment: normalized });
  }
  let current = document;
  for (const part of normalized.slice(2).split("/").map(decodePointerPart)) {
    if (!current || typeof current !== "object" || !(part in current)) {
      throw syncError(422, "openapi_inventory_ref_not_found", "OpenAPI reference fragment was not found.", { fragment: normalized, missing_part: part });
    }
    current = current[part];
  }
  return current;
}

async function readYamlDocument(filePath, cache) {
  const absolutePath = path.resolve(filePath);
  if (cache.has(absolutePath)) return cache.get(absolutePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  let document;
  try {
    document = YAML.parse(raw);
  } catch (error) {
    throw syncError(422, "openapi_inventory_parse_failed", "OpenAPI YAML could not be parsed.", {
      file: absolutePath,
      parse_error: String(error?.message || error),
    });
  }
  if (!document || typeof document !== "object") {
    throw syncError(422, "openapi_inventory_document_invalid", "OpenAPI source must parse to an object.", { file: absolutePath });
  }
  const entry = { document, raw, absolutePath };
  cache.set(absolutePath, entry);
  return entry;
}

function assertReferenceTargetAllowed(targetFile, allowedRoot, reference) {
  const relative = path.relative(allowedRoot, targetFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw syncError(422, "openapi_inventory_ref_outside_root", "OpenAPI references must remain inside the source document directory.", {
      reference,
      allowed_root: allowedRoot,
    });
  }
  if (!/\.ya?ml$/i.test(targetFile)) {
    throw syncError(422, "openapi_inventory_ref_extension_invalid", "OpenAPI references must target YAML files.", { reference });
  }
}

async function resolveReferencedObject(value, sourceFile, cache, allowedRoot, seen = new Set()) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.$ref !== "string") {
    return { value, sourceFile, sourceRef: null };
  }
  const reference = String(value.$ref).trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(reference)) {
    throw syncError(422, "openapi_inventory_remote_ref_blocked", "Remote OpenAPI references are not allowed for SQL inventory synchronization.", { reference });
  }
  const cycleKey = `${sourceFile}::${reference}`;
  if (seen.has(cycleKey)) {
    throw syncError(422, "openapi_inventory_ref_cycle", "Circular OpenAPI path reference detected.", { reference, source_file: sourceFile });
  }
  const nextSeen = new Set(seen);
  nextSeen.add(cycleKey);
  const hashIndex = reference.indexOf("#");
  const filePart = hashIndex >= 0 ? reference.slice(0, hashIndex) : reference;
  const fragment = hashIndex >= 0 ? reference.slice(hashIndex) : "";
  const targetFile = filePart ? path.resolve(path.dirname(sourceFile), filePart) : sourceFile;
  assertReferenceTargetAllowed(targetFile, allowedRoot, reference);
  const target = await readYamlDocument(targetFile, cache);
  const pointed = resolvePointer(target.document, fragment);
  const resolved = await resolveReferencedObject(pointed, targetFile, cache, allowedRoot, nextSeen);
  const siblings = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$ref"));
  return {
    value: { ...(resolved.value || {}), ...siblings },
    sourceFile: resolved.sourceFile || targetFile,
    sourceRef: reference,
  };
}

function compactOperationContract(pathItem, operation, method, routePath) {
  const pathParameters = Array.isArray(pathItem?.parameters) ? pathItem.parameters : [];
  const operationParameters = Array.isArray(operation?.parameters) ? operation.parameters : [];
  return {
    operationId: operation.operationId,
    method: method.toUpperCase(),
    path: routePath,
    summary: operation.summary || null,
    description: operation.description || null,
    tags: Array.isArray(operation.tags) ? operation.tags : [],
    parameters: [...pathParameters, ...operationParameters],
    requestBody: operation.requestBody || null,
    responses: operation.responses || {},
    security: operation.security || [],
    registryExposure: operation["x-registry-exposure"] || "inventory_only",
    registryToolKey: operation["x-registry-tool-key"] || null,
    consequential: operation["x-openai-isConsequential"] === true,
  };
}

export async function collectOpenApiEndpointInventory({
  openApiPath = DEFAULT_OPENAPI_PATH,
  includeSiblingFragments = true,
} = {}) {
  const cache = new Map();
  const root = await readYamlDocument(openApiPath, cache);
  if (!root.document.openapi || !root.document.paths || typeof root.document.paths !== "object") {
    throw syncError(422, "openapi_inventory_root_invalid", "Root OpenAPI document must declare openapi and paths.", { file: root.absolutePath });
  }

  const rootDirectory = path.dirname(root.absolutePath);
  const operations = [];
  const seenOperationIds = new Map();
  const seenRoutes = new Map();
  let suppressedRouteDuplicateCount = 0;
  let suppressedRouteConflictCount = 0;
  const suppressedRouteConflicts = [];

  const appendDocumentOperations = async (entry, { required = false } = {}) => {
    const hasInventorySurface = Boolean(
      entry?.document?.openapi
      && entry?.document?.paths
      && typeof entry.document.paths === "object",
    );
    if (!hasInventorySurface) {
      if (required) {
        throw syncError(422, "openapi_inventory_root_invalid", "Root OpenAPI document must declare openapi and paths.", { file: entry?.absolutePath || root.absolutePath });
      }
      return;
    }

    for (const [rawPath, rawPathItem] of Object.entries(entry.document.paths)) {
      const routePath = normalizePath(rawPath);
      const resolvedPathItem = await resolveReferencedObject(
        rawPathItem,
        entry.absolutePath,
        cache,
        rootDirectory,
      );
      const pathItem = resolvedPathItem.value;
      if (!pathItem || typeof pathItem !== "object") continue;
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(String(method).toLowerCase())) continue;
        if (!operation || typeof operation !== "object") continue;
        const methodName = String(method).toUpperCase();
        const routeKey = `${methodName} ${routePath}`;
        const operationId = normalizeOperationId(operation.operationId);
        const existingOperationId = seenRoutes.get(routeKey);
        if (existingOperationId) {
          if (existingOperationId === operationId) {
            suppressedRouteDuplicateCount += 1;
          } else {
            suppressedRouteConflictCount += 1;
            suppressedRouteConflicts.push({
              route: routeKey,
              authoritative_operation_id: existingOperationId,
              suppressed_operation_id: operationId,
              source_file:
                path.relative(rootDirectory, entry.absolutePath).replace(/\\/g, "/")
                || path.basename(entry.absolutePath),
            });
          }
          continue;
        }

        if (seenOperationIds.has(operationId)) {
          throw syncError(409, "openapi_inventory_duplicate_operation_id", "OpenAPI operationId must be globally unique.", {
            operation_id: operationId,
            first: seenOperationIds.get(operationId),
            duplicate: routeKey,
          });
        }

        const contract = compactOperationContract(pathItem, operation, method, routePath);
        const sourceFile = path.relative(
          rootDirectory,
          resolvedPathItem.sourceFile || entry.absolutePath,
        ).replace(/\\/g, "/") || path.basename(entry.absolutePath);
        const operationSha256 = sha256(stableJson(contract));
        operations.push({
          endpoint_id: `openapi_inventory::${operationId}`,
          parent_action_key: PARENT_ACTION_KEY,
          endpoint_key: operationId,
          endpoint_operation: operationId,
          method: methodName,
          endpoint_path_or_function: routePath,
          source_file: sourceFile,
          source_ref: resolvedPathItem.sourceRef,
          schema_json: stableJson(contract),
          operation_sha256: operationSha256,
          registry_exposure: contract.registryExposure,
          registry_tool_key: contract.registryToolKey,
          consequential: contract.consequential,
        });
        seenRoutes.set(routeKey, operationId);
        seenOperationIds.set(operationId, routeKey);
      }
    }
  };

  await appendDocumentOperations(root, { required: true });

  if (includeSiblingFragments) {
    const fragmentDirectory = path.join(rootDirectory, "openapi");
    let fragmentEntries = [];
    try {
      fragmentEntries = await fs.readdir(fragmentDirectory, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw syncError(500, "openapi_inventory_fragment_directory_read_failed", "OpenAPI fragment directory could not be read.", {
          directory: fragmentDirectory,
          read_error: String(error?.message || error),
        });
      }
    }

    const fragmentFiles = fragmentEntries
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => path.join(fragmentDirectory, entry.name))
      .sort((a, b) => a.localeCompare(b));

    for (const fragmentFile of fragmentFiles) {
      if (path.resolve(fragmentFile) === root.absolutePath) continue;
      const fragment = await readYamlDocument(fragmentFile, cache);
      await appendDocumentOperations(fragment);
    }
  }

  operations.sort((a, b) => a.endpoint_key.localeCompare(b.endpoint_key));
  suppressedRouteConflicts.sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  const sourceFingerprint = sha256(stableJson({
    operations: operations.map((item) => ({
      endpoint_key: item.endpoint_key,
      method: item.method,
      path: item.endpoint_path_or_function,
      operation_sha256: item.operation_sha256,
    })),
    suppressed_route_duplicate_count: suppressedRouteDuplicateCount,
    suppressed_route_conflicts: suppressedRouteConflicts,
  }));
  const sourceDocuments = [...cache.values()]
    .map((entry) => ({
      file: path.relative(rootDirectory, entry.absolutePath).replace(/\\/g, "/") || path.basename(entry.absolutePath),
      sha256: sha256(entry.raw),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

  return {
    openapi_path: root.absolutePath,
    openapi_version: String(root.document.openapi),
    operation_count: operations.length,
    source_document_count: sourceDocuments.length,
    suppressed_route_duplicate_count: suppressedRouteDuplicateCount,
    suppressed_route_conflict_count: suppressedRouteConflictCount,
    suppressed_route_conflicts: suppressedRouteConflicts,
    source_sha256: sha256(stableJson(sourceDocuments)),
    source_fingerprint: sourceFingerprint,
    operations,
    secrets_included: false,
  };
}

function inventoryNotes(operation, sourceFingerprint) {
  return stableJson({
    source: "openapi_endpoint_inventory_sync",
    source_file: operation.source_file,
    source_ref: operation.source_ref,
    source_fingerprint: sourceFingerprint,
    operation_sha256: operation.operation_sha256,
    registry_exposure: operation.registry_exposure,
    registry_tool_key: operation.registry_tool_key,
    consequential: operation.consequential,
    auto_promoted: false,
    callable: false,
    provider_calls: false,
    external_writes: false,
    secrets_included: false,
  });
}

export function buildEndpointInventoryRow(operation, sourceFingerprint) {
  return {
    endpoint_id: operation.endpoint_id,
    parent_action_key: PARENT_ACTION_KEY,
    endpoint_key: operation.endpoint_key,
    endpoint_operation: operation.endpoint_operation,
    provider_domain: "auth.mad4b.com",
    method: operation.method,
    endpoint_path_or_function: operation.endpoint_path_or_function,
    route_target: "internal_platform_api",
    openai_action_name: operation.endpoint_key,
    module_binding: "internal_http_route_inventory",
    connector_family: "internal_platform",
    status: "inventory_only",
    spec_validation_status: "validated",
    auth_validation_status: "pending_governance_review",
    privacy_validation_status: "pending_governance_review",
    execution_readiness: "pending_governance_review",
    endpoint_role: "inventory",
    execution_mode: "internal_http_route",
    transport_required: "false",
    fallback_allowed: "false",
    inventory_role: INVENTORY_ROLE,
    inventory_source: `openapi_endpoint_inventory_sync:${sourceFingerprint}`,
    notes: inventoryNotes(operation, sourceFingerprint),
    provider_family: "internal_platform",
    execution_layer: "http_generic_api",
    logging_target: "openapi_endpoint_inventory_sync_runs",
    category_group: "internal_api_inventory",
    category_detail: operation.registry_exposure,
    required_variable_contracts: "none",
    runtime_binding_profile: "inventory_only_no_dispatch",
    client_interface_agnostic: "true",
    request_envelope_required: operation.consequential ? "true" : "false",
    structured_api_supported: "true",
    conversational_trigger_supported: "false",
    provider_agnostic: "true",
    allowed_actor_roles: "admin",
    allowed_governance_levels: "platform_admin",
    client_allowed: "false",
    team_allowed: "false",
    admin_only: "true",
    writeback_scope: "inventory_metadata_only",
    schema_json: operation.schema_json,
  };
}

const COMPARISON_FIELDS = [
  "parent_action_key", "endpoint_key", "endpoint_operation", "method", "endpoint_path_or_function",
  "status", "execution_readiness", "inventory_role", "inventory_source", "schema_json", "notes",
];

function rowChanged(existing, desired) {
  return COMPARISON_FIELDS.some((field) => String(existing?.[field] ?? "") !== String(desired?.[field] ?? ""));
}

export function buildOpenApiEndpointInventoryPlan({ inventory, existingRows = [] } = {}) {
  const desiredRows = (inventory?.operations || []).map((operation) => buildEndpointInventoryRow(operation, inventory.source_fingerprint));
  const existingById = new Map((existingRows || []).map((row) => [String(row.endpoint_id), row]));
  const desiredIds = new Set(desiredRows.map((row) => row.endpoint_id));
  const inserts = [];
  const updates = [];
  const unchanged = [];
  for (const row of desiredRows) {
    const existing = existingById.get(row.endpoint_id);
    if (!existing) inserts.push(row);
    else if (rowChanged(existing, row)) updates.push({ before: existing, after: row });
    else unchanged.push(row.endpoint_id);
  }
  const deprecations = (existingRows || [])
    .filter((row) => String(row.inventory_role || "") === INVENTORY_ROLE)
    .filter((row) => !desiredIds.has(String(row.endpoint_id)))
    .filter((row) => !["deprecated", "archived"].includes(String(row.status || "").toLowerCase()));
  return {
    source_sha256: inventory.source_sha256,
    source_fingerprint: inventory.source_fingerprint,
    operation_count: desiredRows.length,
    desired_rows: desiredRows,
    insert_count: inserts.length,
    update_count: updates.length,
    unchanged_count: unchanged.length,
    deprecate_count: deprecations.length,
    inserts,
    updates,
    unchanged,
    deprecations,
    callable_rows_created: 0,
    tool_exports_created: 0,
    secrets_included: false,
  };
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

async function readConfig(pool) {
  const [rows] = await pool.query(
    "SELECT config_key, config_json, status, note, updated_at FROM platform_runtime_config WHERE config_key = ? LIMIT 1",
    [CONFIG_KEY]
  );
  const row = rows?.[0] || null;
  return {
    exists: Boolean(row),
    active: row?.status === "active",
    config: parseJson(row?.config_json, {}),
    row,
  };
}

async function loadExistingRows(pool) {
  const [rows] = await pool.query(
    "SELECT * FROM endpoints WHERE parent_action_key = ? AND inventory_role = ? ORDER BY endpoint_key, id",
    [PARENT_ACTION_KEY, INVENTORY_ROLE]
  );
  return rows || [];
}

async function latestRun(pool) {
  const [rows] = await pool.query(
    `SELECT run_id, mode, trigger_source, status, source_sha256, source_fingerprint,
            operation_count, inserted_count, updated_count, unchanged_count, deprecated_count,
            readback_count, started_at, completed_at, error_code, error_message
       FROM openapi_endpoint_inventory_sync_runs
      ORDER BY started_at DESC
      LIMIT 1`
  );
  return rows?.[0] || null;
}

async function ensureInventoryAction(connection) {
  await connection.query(
    `INSERT INTO actions
      (action_key, action_id, action_title, status, module_binding, connector_family,
       runtime_capability_class, runtime_callable, primary_executor, notes, action_class,
       action_scope, route_target, execution_layer, inventory_role, review_required,
       provider_agnostic, admin_only, writeback_scope)
     VALUES (?, ?, 'Internal Platform API Route Inventory', 'inventory_only', 'internal_http_route_inventory',
             'internal_platform', 'inventory_only', 'false', 'none', ?, 'internal_inventory',
             'platform', 'internal_platform_api', 'http_generic_api', 'openapi_inventory', 'true',
             'true', 'true', 'inventory_metadata_only')
     ON DUPLICATE KEY UPDATE
       action_title=VALUES(action_title), module_binding=VALUES(module_binding), connector_family=VALUES(connector_family),
       runtime_capability_class='inventory_only', runtime_callable='false', primary_executor='none',
       notes=VALUES(notes), action_class='internal_inventory', action_scope='platform',
       route_target='internal_platform_api', execution_layer='http_generic_api', inventory_role='openapi_inventory',
       review_required='true', provider_agnostic='true', admin_only='true', writeback_scope='inventory_metadata_only',
       updated_at=CURRENT_TIMESTAMP`,
    [PARENT_ACTION_KEY, PARENT_ACTION_KEY, stableJson({ callable: false, auto_promote: false, secrets_included: false })]
  );
}

async function upsertInventoryRow(connection, row) {
  await connection.query(
    `INSERT INTO endpoints
      (endpoint_id, parent_action_key, endpoint_key, endpoint_operation, provider_domain, method,
       endpoint_path_or_function, route_target, openai_action_name, module_binding, connector_family,
       status, spec_validation_status, auth_validation_status, privacy_validation_status,
       execution_readiness, endpoint_role, execution_mode, transport_required, fallback_allowed,
       inventory_role, inventory_source, notes, provider_family, execution_layer, logging_target,
       category_group, category_detail, required_variable_contracts, runtime_binding_profile,
       client_interface_agnostic, request_envelope_required, structured_api_supported,
       conversational_trigger_supported, provider_agnostic, allowed_actor_roles,
       allowed_governance_levels, client_allowed, team_allowed, admin_only, writeback_scope,
       schema_json, schema_imported_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
     ON DUPLICATE KEY UPDATE
       parent_action_key=VALUES(parent_action_key), endpoint_key=VALUES(endpoint_key),
       endpoint_operation=VALUES(endpoint_operation), provider_domain=VALUES(provider_domain), method=VALUES(method),
       endpoint_path_or_function=VALUES(endpoint_path_or_function), route_target=VALUES(route_target),
       openai_action_name=VALUES(openai_action_name), module_binding=VALUES(module_binding),
       connector_family=VALUES(connector_family), status='inventory_only', spec_validation_status='validated',
       auth_validation_status='pending_governance_review', privacy_validation_status='pending_governance_review',
       execution_readiness='pending_governance_review', endpoint_role='inventory', execution_mode='internal_http_route',
       transport_required='false', fallback_allowed='false', inventory_role=VALUES(inventory_role),
       inventory_source=VALUES(inventory_source), notes=VALUES(notes), provider_family=VALUES(provider_family),
       execution_layer=VALUES(execution_layer), logging_target=VALUES(logging_target),
       category_group=VALUES(category_group), category_detail=VALUES(category_detail),
       required_variable_contracts=VALUES(required_variable_contracts), runtime_binding_profile='inventory_only_no_dispatch',
       client_interface_agnostic='true', request_envelope_required=VALUES(request_envelope_required),
       structured_api_supported='true', conversational_trigger_supported='false', provider_agnostic='true',
       allowed_actor_roles='admin', allowed_governance_levels='platform_admin', client_allowed='false',
       team_allowed='false', admin_only='true', writeback_scope='inventory_metadata_only',
       schema_json=VALUES(schema_json), schema_imported_at=NOW(), updated_at=CURRENT_TIMESTAMP`,
    [
      row.endpoint_id, row.parent_action_key, row.endpoint_key, row.endpoint_operation, row.provider_domain, row.method,
      row.endpoint_path_or_function, row.route_target, row.openai_action_name, row.module_binding, row.connector_family,
      row.status, row.spec_validation_status, row.auth_validation_status, row.privacy_validation_status,
      row.execution_readiness, row.endpoint_role, row.execution_mode, row.transport_required, row.fallback_allowed,
      row.inventory_role, row.inventory_source, row.notes, row.provider_family, row.execution_layer, row.logging_target,
      row.category_group, row.category_detail, row.required_variable_contracts, row.runtime_binding_profile,
      row.client_interface_agnostic, row.request_envelope_required, row.structured_api_supported,
      row.conversational_trigger_supported, row.provider_agnostic, row.allowed_actor_roles,
      row.allowed_governance_levels, row.client_allowed, row.team_allowed, row.admin_only, row.writeback_scope,
      row.schema_json,
    ]
  );
}

async function writeRun(pool, fields) {
  await pool.query(
    `INSERT INTO openapi_endpoint_inventory_sync_runs
      (run_id, mode, trigger_source, status, source_sha256, source_fingerprint,
       operation_count, inserted_count, updated_count, unchanged_count, deprecated_count,
       readback_count, summary_json, error_code, error_message, started_at, completed_at, secrets_included)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
    [
      fields.run_id, fields.mode, fields.trigger_source, fields.status, fields.source_sha256,
      fields.source_fingerprint, fields.operation_count, fields.inserted_count, fields.updated_count,
      fields.unchanged_count, fields.deprecated_count, fields.readback_count,
      JSON.stringify(fields.summary || {}), fields.error_code || null, fields.error_message || null,
      fields.started_at, fields.completed_at || null,
    ]
  );
}

export async function getOpenApiEndpointInventorySyncStatus(deps = {}) {
  const pool = deps.pool || getPool();
  try {
    const [config, run, rows] = await Promise.all([readConfig(pool), latestRun(pool), loadExistingRows(pool)]);
    const activeRows = rows.filter((row) => !["deprecated", "archived"].includes(String(row.status || "").toLowerCase()));
    return {
      ok: true,
      schema_ready: true,
      config: {
        exists: config.exists,
        active: config.active,
        enabled: config.config.enabled === true,
        startup_apply: config.config.startup_apply === true,
        auto_promote: config.config.auto_promote === true,
        parent_action_key: config.config.parent_action_key || PARENT_ACTION_KEY,
      },
      latest_run: run,
      inventory: {
        total_count: rows.length,
        active_inventory_count: activeRows.length,
        callable_count: rows.filter((row) => row.status === "active" && row.execution_readiness === "ready").length,
      },
      secrets_included: false,
    };
  } catch (error) {
    if (/doesn't exist|ER_NO_SUCH_TABLE/i.test(String(error?.message || ""))) {
      return { ok: true, schema_ready: false, status: "migration_required", secrets_included: false };
    }
    throw error;
  }
}

export async function syncOpenApiEndpointInventory(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const mode = String(input.mode || "dry_run").trim().toLowerCase();
  if (!new Set(["dry_run", "apply"]).has(mode)) {
    throw syncError(400, "openapi_inventory_mode_invalid", "mode must be dry_run or apply.");
  }
  if (mode === "apply" && String(input.confirm || "").trim() !== APPLY_CONFIRMATION) {
    throw syncError(400, "openapi_inventory_confirmation_required", `Apply requires confirm=${APPLY_CONFIRMATION}.`, {
      required_confirmation: APPLY_CONFIRMATION,
    });
  }
  const triggerSource = String(input.trigger_source || input.triggerSource || "admin_tool").trim().slice(0, 64) || "admin_tool";
  let capabilityEnvelope = null;
  if (mode === "apply" && triggerSource !== "startup") {
    const resolveEnvelope = deps.resolveEnvelope || resolveCapabilityExecutionEnvelope;
    const resolved = await resolveEnvelope({
      pool,
      source: input,
      acceptedAppKeys: ["platform_orchestration"],
      acceptedIntents: ACCEPTED_OPERATION_INTENTS,
      expectedTenantId: deps.auth?.tenant_id || PLATFORM_TENANT_ID,
      expectedUserId: deps.auth?.user_id || "",
    });
    if (!resolved?.ok) {
      throw capabilityEnvelopeError(resolved, "OpenAPI endpoint inventory apply requires a valid capability resolution envelope.");
    }
    if (resolved.apply_allowed !== true) {
      throw capabilityEnvelopeError({
        ...resolved,
        ok: false,
        status: "capability_resolution_envelope_apply_not_allowed",
        errors: ["capability_resolution_envelope_apply_not_allowed"],
        secrets_included: false,
      }, "OpenAPI endpoint inventory apply requires an apply-enabled capability resolution envelope.");
    }
    capabilityEnvelope = resolved;
  }
  const inventory = await collectOpenApiEndpointInventory({ openApiPath: deps.openApiPath || DEFAULT_OPENAPI_PATH });
  const existingRows = await loadExistingRows(pool);
  const plan = buildOpenApiEndpointInventoryPlan({ inventory, existingRows });
  const inventoryEvidence = {
    source_document_count: inventory.source_document_count,
    suppressed_route_duplicate_count: inventory.suppressed_route_duplicate_count,
    suppressed_route_conflict_count: inventory.suppressed_route_conflict_count,
    suppressed_route_conflicts: inventory.suppressed_route_conflicts,
    secrets_included: false,
  };
  const responseBase = {
    ok: true,
    mode,
    trigger_source: triggerSource,
    source_sha256: inventory.source_sha256,
    source_fingerprint: inventory.source_fingerprint,
    operation_count: inventory.operation_count,
    plan: {
      insert_count: plan.insert_count,
      update_count: plan.update_count,
      unchanged_count: plan.unchanged_count,
      deprecate_count: plan.deprecate_count,
      callable_rows_created: 0,
      tool_exports_created: 0,
    },
    inventory_evidence: inventoryEvidence,
    applies_inventory_metadata_only: mode === "apply",
    provider_calls: false,
    external_writes: false,
    secrets_included: false,
  };
  if (mode === "dry_run") {
    return { ...responseBase, required_confirmation: APPLY_CONFIRMATION, applied: false };
  }

  const runId = randomUUID();
  const startedAt = new Date();
  const connection = typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  const transactional = typeof connection.beginTransaction === "function";
  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK(?, 0) AS lock_acquired", [ADVISORY_LOCK_NAME]);
    if (Number(lockRows?.[0]?.lock_acquired || 0) !== 1) {
      throw syncError(409, "openapi_inventory_sync_locked", "Another OpenAPI endpoint inventory sync is already running.");
    }
    if (transactional) await connection.beginTransaction();
    await ensureInventoryAction(connection);
    for (const row of plan.inserts) await upsertInventoryRow(connection, row);
    for (const change of plan.updates) await upsertInventoryRow(connection, change.after);
    for (const row of plan.deprecations) {
      await connection.query(
        `UPDATE endpoints
            SET status='deprecated', execution_readiness='blocked_removed_from_openapi',
                notes=?, updated_at=CURRENT_TIMESTAMP
          WHERE endpoint_id=? AND inventory_role=?`,
        [stableJson({ source: "openapi_endpoint_inventory_sync", removed_from_openapi: true, source_fingerprint: inventory.source_fingerprint, secrets_included: false }), row.endpoint_id, INVENTORY_ROLE]
      );
    }
    const [readbackRows] = await connection.query(
      `SELECT COUNT(*) AS row_count
         FROM endpoints
        WHERE parent_action_key=? AND inventory_role=?
          AND status NOT IN ('deprecated','archived')`,
      [PARENT_ACTION_KEY, INVENTORY_ROLE]
    );
    const readbackCount = Number(readbackRows?.[0]?.row_count || 0);
    if (readbackCount !== inventory.operation_count) {
      throw syncError(500, "openapi_inventory_readback_count_mismatch", "OpenAPI inventory readback count does not match the parsed operation count.", {
        expected_count: inventory.operation_count,
        readback_count: readbackCount,
      });
    }
    await writeRun(connection, {
      run_id: runId,
      mode: "apply",
      trigger_source: triggerSource,
      status: "completed",
      source_sha256: inventory.source_sha256,
      source_fingerprint: inventory.source_fingerprint,
      operation_count: inventory.operation_count,
      inserted_count: plan.insert_count,
      updated_count: plan.update_count,
      unchanged_count: plan.unchanged_count,
      deprecated_count: plan.deprecate_count,
      readback_count: readbackCount,
      summary: {
        plan: responseBase.plan,
        inventory_evidence: inventoryEvidence,
      },
      started_at: startedAt,
      completed_at: new Date(),
    });
    if (capabilityEnvelope) {
      const markReferenced = deps.markReferenced || markCapabilityEnvelopeReferenced;
      await markReferenced({
        pool: connection,
        envelopeId: capabilityEnvelope.envelope_id,
        executionRef: `openapi_endpoint_inventory_sync:${runId}`,
      });
    }
    if (transactional) await connection.commit();
    return {
      ...responseBase,
      run_id: runId,
      applied: true,
      readback_count: readbackCount,
      capability_envelope_id: capabilityEnvelope?.envelope_id || null,
    };
  } catch (error) {
    if (transactional) {
      try { await connection.rollback(); } catch { }
    }
    try {
      await writeRun(pool, {
        run_id: runId,
        mode: "apply",
        trigger_source: triggerSource,
        status: "failed",
        source_sha256: inventory.source_sha256,
        source_fingerprint: inventory.source_fingerprint,
        operation_count: inventory.operation_count,
        inserted_count: 0,
        updated_count: 0,
        unchanged_count: 0,
        deprecated_count: 0,
        readback_count: 0,
        summary: {
          plan: responseBase.plan,
          inventory_evidence: inventoryEvidence,
        },
        error_code: error?.code || "openapi_inventory_apply_failed",
        error_message: String(error?.message || error).slice(0, 1000),
        started_at: startedAt,
        completed_at: new Date(),
      });
    } catch { }
    throw error;
  } finally {
    try { await connection.query("SELECT RELEASE_LOCK(?)", [ADVISORY_LOCK_NAME]); } catch { }
    if (connection !== pool && typeof connection.release === "function") connection.release();
  }
}

export async function startOpenApiEndpointInventorySync(deps = {}) {
  const pool = deps.pool || getPool();
  if (String(process.env.OPENAPI_ENDPOINT_INVENTORY_SYNC_DISABLED || "").trim().toLowerCase() === "true") {
    return { ok: true, started: false, status: "disabled_by_environment_kill_switch", secrets_included: false };
  }
  try {
    const config = await readConfig(pool);
    if (!config.exists) return { ok: true, started: false, status: "migration_required", secrets_included: false };
    if (!config.active || config.config.enabled !== true || config.config.startup_apply !== true) {
      return { ok: true, started: false, status: "disabled_by_runtime_config", secrets_included: false };
    }
    const result = await syncOpenApiEndpointInventory({
      mode: "apply",
      confirm: APPLY_CONFIRMATION,
      trigger_source: "startup",
    }, { ...deps, pool });
    return { ...result, started: true };
  } catch (error) {
    if (/doesn't exist|ER_NO_SUCH_TABLE/i.test(String(error?.message || ""))) {
      return { ok: true, started: false, status: "migration_required", secrets_included: false };
    }
    throw error;
  }
}

export const OPENAPI_ENDPOINT_INVENTORY_CONSTANTS = Object.freeze({
  CONFIG_KEY,
  PARENT_ACTION_KEY,
  INVENTORY_ROLE,
  APPLY_CONFIRMATION,
});
