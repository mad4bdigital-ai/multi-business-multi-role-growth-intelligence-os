import YAML from "yaml";
import { getPool } from "./db.js";

function debugLog(...args) {
  if (String(process.env.EXECUTION_DEBUG || "").trim().toLowerCase() === "true") {
    console.log(...args);
  }
}

function buildSharedDriveRequest(fileId, extra = {}) {
  return { fileId, supportsAllDrives: true, ...extra };
}

async function readDriveFileRaw(drive, fileId, mimeType) {
  if (mimeType.startsWith("application/vnd.google-apps")) {
    const exported = await drive.files.export(
      buildSharedDriveRequest(fileId, { mimeType: "text/plain" }),
      { responseType: "text" }
    );
    return String(exported.data || "");
  }

  const content = await drive.files.get(
    buildSharedDriveRequest(fileId, { alt: "media" }),
    { responseType: "text" }
  );
  return String(content.data || "");
}

function parseFileContent(raw, name, mimeType) {
  if (name.endsWith(".json") || mimeType.includes("json")) {
    return JSON.parse(raw);
  }
  return YAML.parse(raw);
}

function parseJsonSafe(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function normalizeMethod(method) {
  return String(method || "get").trim().toLowerCase();
}

function normalizePath(path) {
  const value = String(path || "").trim();
  return value.startsWith("/") ? value : `/${value}`;
}

function operationFromEndpoint(row) {
  const parsed = parseJsonSafe(row.schema_json, {});
  const op = parsed && typeof parsed === "object" ? { ...parsed } : {};

  if (!op.operationId) {
    op.operationId = row.openai_action_name || row.endpoint_operation || row.endpoint_key;
  }

  if (!op.summary) {
    op.summary = row.endpoint_title || row.endpoint_key;
  }

  if (!op.responses) {
    op.responses = {
      200: {
        description: "Successful response",
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true }
          }
        }
      }
    };
  }

  return op;
}

async function fetchSqlBackedActionSchema(actionKey) {
  const key = String(actionKey || "").trim();
  if (!key) {
    const err = new Error("Missing action key for SQL-backed schema contract.");
    err.code = "schema_binding_missing";
    err.status = 403;
    throw err;
  }

  const pool = getPool();
  const [[action]] = await pool.query(
    "SELECT action_key, action_title, schema_json FROM actions WHERE action_key = ? LIMIT 1",
    [key]
  );

  if (!action) {
    const err = new Error(`SQL-backed schema action not found: ${key}.`);
    err.code = "schema_binding_missing";
    err.status = 404;
    throw err;
  }

  const [endpoints] = await pool.query(
    `SELECT endpoint_key, endpoint_title, openai_action_name, endpoint_operation,
            provider_domain, method, endpoint_path_or_function, schema_json,
            status, execution_readiness
       FROM endpoints
      WHERE parent_action_key = ?
        AND status = 'active'
        AND (execution_readiness IS NULL OR execution_readiness = '' OR execution_readiness = 'ready')
        AND endpoint_path_or_function IS NOT NULL
        AND endpoint_path_or_function <> ''
      ORDER BY id`,
    [key]
  );

  const actionSchema = parseJsonSafe(action.schema_json, {});
  const servers = [];
  const seenServers = new Set();
  const paths = {};

  for (const endpoint of endpoints) {
    const providerDomain = String(endpoint.provider_domain || "").trim();
    if (providerDomain && providerDomain.startsWith("http") && !seenServers.has(providerDomain)) {
      seenServers.add(providerDomain);
      servers.push({ url: providerDomain });
    }

    const path = normalizePath(endpoint.endpoint_path_or_function);
    const method = normalizeMethod(endpoint.method);
    if (!paths[path]) paths[path] = {};
    paths[path][method] = operationFromEndpoint(endpoint);
  }

  const parsed = {
    openapi: "3.1.0",
    info: {
      title: action.action_title || action.action_key || key,
      version: actionSchema.version || "2026-05-12",
      description: actionSchema.description || `SQL-backed OpenAPI schema for ${key}`
    },
    servers: servers.length ? servers : (Array.isArray(actionSchema.servers) ? actionSchema.servers : []),
    paths,
    components: actionSchema.components || {},
    security: Array.isArray(actionSchema.security) ? actionSchema.security : []
  };

  const raw = JSON.stringify(parsed, null, 2);
  return {
    fileId: `action_schema:${key}`,
    name: `${key}.sql.openapi.json`,
    mimeType: "application/json",
    raw,
    parsed
  };
}

export async function fetchSchemaContract(drive, fileId) {
  if (!fileId) {
    const err = new Error("Missing openai_schema_file_id.");
    err.code = "schema_binding_missing";
    err.status = 403;
    throw err;
  }

  const normalizedFileId = String(fileId || "").trim();
  if (normalizedFileId.startsWith("action_schema:")) {
    return fetchSqlBackedActionSchema(normalizedFileId.slice("action_schema:".length));
  }

  if (!drive) {
    const err = new Error("Google Drive client unavailable — schema contract cannot be fetched.");
    err.code = "google_token_missing";
    err.status = 503;
    throw err;
  }

  const meta = await drive.files.get(
    buildSharedDriveRequest(normalizedFileId, { fields: "id,name,mimeType,driveId,parents" })
  );
  const { mimeType = "", name = "" } = meta.data || {};

  const raw = await readDriveFileRaw(drive, normalizedFileId, mimeType);

  let parsed;
  try {
    parsed = parseFileContent(raw, name, mimeType);
  } catch {
    const err = new Error(`Unable to parse schema file ${normalizedFileId}.`);
    err.code = "schema_parse_failed";
    err.status = 500;
    throw err;
  }

  return { fileId: normalizedFileId, name, mimeType, raw, parsed };
}

export async function fetchOAuthConfigContract(drive, action) {
  const fileId = String(action.oauth_config_file_id || "").trim();
  if (!fileId) return null;

  try {
    const meta = await drive.files.get(
      buildSharedDriveRequest(fileId, { fields: "id,name,mimeType,driveId,parents" })
    );
    const { mimeType = "", name = "" } = meta.data || {};

    const raw = await readDriveFileRaw(drive, fileId, mimeType);

    let parsed;
    try {
      parsed = parseFileContent(raw, name, mimeType);
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
