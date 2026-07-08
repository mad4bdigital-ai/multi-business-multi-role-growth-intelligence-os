#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_PATH = path.join(API_ROOT, "resource-surface-registry.snapshot.json");
const OUTPUT_PATH = path.join(API_ROOT, "openapi", "resource-surfaces.generated.json");
const SECRET_COLUMN_PATTERN = /(secret|token|password|credential|cipher|private_key|encrypted|webhook_url|api_base_url|mcp_endpoint|scopes_granted|account_metadata)/i;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function parseJsonMaybe(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (value == null || value === "") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeRow(row) {
  return {
    table_key: String(row.table_key),
    display_name: String(row.display_name || row.table_key),
    description: row.description || null,
    physical_table_name: String(row.physical_table_name),
    scope_mode: String(row.scope_mode || "platform"),
    tenant_column: row.tenant_column || null,
    workspace_column: row.workspace_column || null,
    primary_key_columns_json: parseJsonMaybe(row.primary_key_columns_json, []),
    readable_columns_json: parseJsonMaybe(row.readable_columns_json, []),
    creatable_columns_json: parseJsonMaybe(row.creatable_columns_json, []),
    patchable_columns_json: parseJsonMaybe(row.patchable_columns_json, []),
    filterable_columns_json: parseJsonMaybe(row.filterable_columns_json, []),
    required_create_columns_json: parseJsonMaybe(row.required_create_columns_json, []),
    json_columns_json: parseJsonMaybe(row.json_columns_json, []),
    allowed_operations_json: parseJsonMaybe(row.allowed_operations_json, []),
    enabled_surfaces_json: parseJsonMaybe(row.enabled_surfaces_json, []),
    soft_delete_column: row.soft_delete_column || null,
    soft_delete_value: row.soft_delete_value || null,
    max_limit: Number(row.max_limit || 100),
    sort_order: Number(row.sort_order || 100),
    status: row.status || "active",
    metadata_json: parseJsonMaybe(row.metadata_json, {}),
  };
}

async function loadSnapshot() {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  return (snapshot.resource_surfaces || []).map(normalizeRow);
}

async function loadDatabase() {
  const mysql = await import("mysql2/promise");
  const url = process.env.DATABASE_URL || process.env.MYSQL_URL || null;
  const config = url ? url : {
    host: process.env.DB_HOST || process.env.MYSQL_HOST || "localhost",
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.DB_USER || process.env.MYSQL_USER,
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD,
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE,
    ssl: process.env.DB_SSL === "true" ? {} : undefined,
  };
  const connection = await mysql.createConnection(config);
  try {
    const [rows] = await connection.query(
      `SELECT table_key, display_name, description, physical_table_name, scope_mode,
              tenant_column, workspace_column, primary_key_columns_json,
              readable_columns_json, writable_columns_json, creatable_columns_json,
              patchable_columns_json, filterable_columns_json, required_create_columns_json,
              json_columns_json, default_values_json, allowed_operations_json,
              enabled_surfaces_json, soft_delete_column, soft_delete_value,
              max_limit, sort_order, status, metadata_json
         FROM platform_data_table_registry
        WHERE status = 'active'
        ORDER BY sort_order ASC, table_key ASC`
    );
    return rows.map(normalizeRow);
  } finally {
    await connection.end();
  }
}

function validateSurfaces(surfaces) {
  const errors = [];
  const keys = new Set();
  for (const surface of surfaces) {
    if (keys.has(surface.table_key)) errors.push(`${surface.table_key}: duplicate table_key`);
    keys.add(surface.table_key);
    if (!surface.table_key || !surface.physical_table_name) errors.push(`${surface.table_key}: missing key/table`);
    for (const field of ["readable_columns_json", "creatable_columns_json", "patchable_columns_json", "filterable_columns_json"]) {
      const unsafe = (surface[field] || []).filter((column) => SECRET_COLUMN_PATTERN.test(String(column)));
      if (unsafe.length) errors.push(`${surface.table_key}.${field}: unsafe columns ${unsafe.join(", ")}`);
    }
    if (!surface.primary_key_columns_json?.length) errors.push(`${surface.table_key}: missing primary_key_columns_json`);
    if (!surface.readable_columns_json?.length) errors.push(`${surface.table_key}: missing readable_columns_json`);
  }
  return errors;
}

function response(schema) {
  return { description: "OK", content: { "application/json": { schema } } };
}

function schemaForList(resourceKeys) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean" },
      resource_key: { type: "string", enum: resourceKeys },
      page: { type: "object", additionalProperties: true },
      source_authority: { type: "string" },
      secrets_included: { type: "boolean", const: false },
    },
  };
}

function buildOpenApi(surfaces, sourceMode) {
  const adminKeys = surfaces.filter((s) => s.enabled_surfaces_json.includes("admin")).map((s) => s.table_key).sort();
  const tenantKeys = surfaces.filter((s) => s.enabled_surfaces_json.includes("tenant")).map((s) => s.table_key).sort();
  const allKeys = [...new Set([...adminKeys, ...tenantKeys])].sort();
  const parameter = (name, schema) => ({ name, in: "path", required: true, schema });
  const query = (name, schema) => ({ name, in: "query", required: false, schema });
  const mutBody = {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          additionalProperties: true,
          properties: {
            dry_run: { type: "boolean", default: true },
            confirm: { type: "string" },
            patch: { type: "object", additionalProperties: true },
          },
        },
      },
    },
  };

  const paths = {
    "/admin/resource-types": {
      get: {
        operationId: "platformResourceTypesList",
        tags: ["Resource API"],
        summary: "List DB-backed resource surface types",
        responses: { "200": response({ type: "object", additionalProperties: true }) },
      },
    },
    "/admin/resources/{resourceKey}": {
      get: {
        operationId: "platformResourceList",
        tags: ["Resource API"],
        parameters: [
          parameter("resourceKey", { type: "string", enum: adminKeys }),
          query("q", { type: "string" }),
          query("limit", { type: "integer", minimum: 1, maximum: 1000 }),
          query("pageToken", { type: "string" }),
        ],
        responses: { "200": response(schemaForList(adminKeys)) },
      },
      post: {
        operationId: "platformResourceCreate",
        tags: ["Resource API"],
        parameters: [parameter("resourceKey", { type: "string", enum: adminKeys })],
        requestBody: mutBody,
        responses: { "200": response({ type: "object", additionalProperties: true }) },
      },
    },
    "/admin/resources/{resourceKey}/{resourceId}": {
      get: {
        operationId: "platformResourceGet",
        tags: ["Resource API"],
        parameters: [parameter("resourceKey", { type: "string", enum: adminKeys }), parameter("resourceId", { type: "string" })],
        responses: { "200": response({ type: "object", additionalProperties: true }) },
      },
      patch: {
        operationId: "platformResourceUpdate",
        tags: ["Resource API"],
        parameters: [parameter("resourceKey", { type: "string", enum: adminKeys }), parameter("resourceId", { type: "string" })],
        requestBody: mutBody,
        responses: { "200": response({ type: "object", additionalProperties: true }) },
      },
      delete: {
        operationId: "platformResourceArchive",
        tags: ["Resource API"],
        parameters: [parameter("resourceKey", { type: "string", enum: adminKeys }), parameter("resourceId", { type: "string" })],
        responses: { "200": response({ type: "object", additionalProperties: true }) },
      },
    },
    "/admin/resources/{resourceKey}/{resourceId}/restore": {
      post: {
        operationId: "platformResourceRestore",
        tags: ["Resource API"],
        parameters: [parameter("resourceKey", { type: "string", enum: adminKeys }), parameter("resourceId", { type: "string" })],
        responses: { "200": response({ type: "object", additionalProperties: true }) },
      },
    },
    "/admin/resources/{resourceKey}/{resourceId}/permissions": {
      get: {
        operationId: "platformResourcePermissionsGet",
        tags: ["Resource API"],
        parameters: [parameter("resourceKey", { type: "string", enum: adminKeys }), parameter("resourceId", { type: "string" })],
        responses: { "200": response({ type: "object", additionalProperties: true }) },
      },
    },
    "/admin/resources/{resourceKey}/{resourceId}/revisions": {
      get: {
        operationId: "platformResourceRevisionsList",
        tags: ["Resource API"],
        parameters: [parameter("resourceKey", { type: "string", enum: adminKeys }), parameter("resourceId", { type: "string" })],
        responses: { "200": response({ type: "object", additionalProperties: true }) },
      },
    },
    "/admin/resources/{resourceKey}/{resourceId}/changes": {
      get: {
        operationId: "platformResourceChangesList",
        tags: ["Resource API"],
        parameters: [parameter("resourceKey", { type: "string", enum: adminKeys }), parameter("resourceId", { type: "string" })],
        responses: { "200": response({ type: "object", additionalProperties: true }) },
      },
    },
    "/me/workspaces/{tenant_id}/resources/{resourceKey}": {
      get: {
        operationId: "tenantResourceList",
        tags: ["Resource API"],
        parameters: [parameter("tenant_id", { type: "string" }), parameter("resourceKey", { type: "string", enum: tenantKeys })],
        responses: { "200": response(schemaForList(tenantKeys)) },
      },
      post: {
        operationId: "tenantResourceCreate",
        tags: ["Resource API"],
        parameters: [parameter("tenant_id", { type: "string" }), parameter("resourceKey", { type: "string", enum: tenantKeys })],
        requestBody: mutBody,
        responses: { "200": response({ type: "object", additionalProperties: true }) },
      },
    },
    "/me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}": {
      get: {
        operationId: "tenantResourceGet",
        tags: ["Resource API"],
        parameters: [parameter("tenant_id", { type: "string" }), parameter("resourceKey", { type: "string", enum: tenantKeys }), parameter("resourceId", { type: "string" })],
        responses: { "200": response({ type: "object", additionalProperties: true }) },
      },
      patch: {
        operationId: "tenantResourceUpdate",
        tags: ["Resource API"],
        parameters: [parameter("tenant_id", { type: "string" }), parameter("resourceKey", { type: "string", enum: tenantKeys }), parameter("resourceId", { type: "string" })],
        requestBody: mutBody,
        responses: { "200": response({ type: "object", additionalProperties: true }) },
      },
      delete: {
        operationId: "tenantResourceArchive",
        tags: ["Resource API"],
        parameters: [parameter("tenant_id", { type: "string" }), parameter("resourceKey", { type: "string", enum: tenantKeys }), parameter("resourceId", { type: "string" })],
        responses: { "200": response({ type: "object", additionalProperties: true }) },
      },
    },
  };

  return stable({
    openapi: "3.1.0",
    info: {
      title: "DB-backed Resource Surfaces",
      version: "2026-07-08",
      description: "Generated from platform_data_table_registry or repo snapshot. Do not edit by hand.",
    },
    servers: [{ url: "https://auth.mad4b.com" }],
    "x-generated-from": sourceMode,
    "x-source-authority": "platform_data_table_registry",
    "x-secrets-included": false,
    "x-resource-surface-count": surfaces.length,
    "x-resource-keys": allKeys,
    paths,
  });
}

async function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  const database = process.argv.includes("--database") || process.env.RESOURCE_SURFACE_SOURCE === "database";
  if (write === check) {
    console.error("Usage: node scripts/generate-resource-surface-openapi.mjs --write|--check [--database]");
    process.exit(1);
  }
  let surfaces;
  let sourceMode;
  if (database) {
    try {
      surfaces = await loadDatabase();
      sourceMode = "database";
    } catch (error) {
      if (process.env.RESOURCE_SURFACE_REQUIRE_DATABASE === "true") throw error;
      surfaces = await loadSnapshot();
      sourceMode = "snapshot_after_database_fallback";
    }
  } else {
    surfaces = await loadSnapshot();
    sourceMode = "snapshot";
  }
  const errors = validateSurfaces(surfaces);
  if (errors.length) {
    console.error("Resource surface validation failed:");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  const generated = JSON.stringify(buildOpenApi(surfaces, sourceMode), null, 2) + "\n";
  if (write) {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, generated, "utf8");
    console.log(`Generated ${path.relative(API_ROOT, OUTPUT_PATH)} from ${sourceMode} (${surfaces.length} surfaces).`);
    return;
  }
  const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, "utf8") : "";
  if (current !== generated) {
    console.error("resource-surfaces.generated.json is out of date. Run npm run resources:openapi:generate.");
    process.exit(1);
  }
  console.log(`Resource surface OpenAPI parity OK from ${sourceMode} (${surfaces.length} surfaces).`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
