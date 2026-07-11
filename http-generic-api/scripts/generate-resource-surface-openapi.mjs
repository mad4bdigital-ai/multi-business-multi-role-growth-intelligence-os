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

function loadSnapshot() {
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")).resource_surfaces || [];
}

function validateSurfaces(surfaces) {
  const errors = [];
  const keys = new Set();
  for (const surface of surfaces) {
    if (keys.has(surface.table_key)) errors.push(`${surface.table_key}: duplicate table_key`);
    keys.add(surface.table_key);
    if (!surface.table_key || !surface.physical_table_name) errors.push(`${surface.table_key}: missing key/table`);
    for (const field of ["readable_columns_json", "filterable_columns_json"]) {
      for (const column of surface[field] || []) {
        if (SECRET_COLUMN_PATTERN.test(String(column))) errors.push(`${surface.table_key}.${field}: unsafe column ${column}`);
      }
    }
  }
  return errors;
}

function response() {
  return { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true, properties: { secrets_included: { type: "boolean", const: false } } } } } };
}

function buildOpenApi(surfaces) {
  const adminKeys = surfaces.filter((s) => (s.enabled_surfaces_json || []).includes("admin")).map((s) => s.table_key).sort();
  const tenantKeys = surfaces.filter((s) => (s.enabled_surfaces_json || []).includes("tenant")).map((s) => s.table_key).sort();
  const allKeys = [...new Set([...adminKeys, ...tenantKeys])].sort();
  return stable({
    openapi: "3.1.0",
    info: {
      title: "DB-backed Resource Surfaces",
      version: "2026-07-09",
      description: "Generated from platform_data_table_registry or the checked-in snapshot fallback. Do not edit by hand."
    },
    servers: [{ url: "https://auth.mad4b.com" }],
    "x-generated-from": "snapshot",
    "x-source-authority": "platform_data_table_registry",
    "x-secrets-included": false,
    "x-resource-surface-count": surfaces.length,
    "x-resource-keys": allKeys,
    paths: {
      "/admin/resource-types": {
        get: { operationId: "platformResourceTypesList", tags: ["Resource API"], responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } } }
      },
      "/admin/resources/{resourceKey}": {
        get: { operationId: "platformResourceList", tags: ["Resource API"], parameters: [{ name: "resourceKey", in: "path", required: true, schema: { type: "string", enum: adminKeys } }], responses: { "200": response() } }
      },
      "/me/workspaces/{tenant_id}/resources/{resourceKey}": {
        get: { operationId: "tenantResourceList", tags: ["Resource API"], parameters: [{ name: "tenant_id", in: "path", required: true, schema: { type: "string" } }, { name: "resourceKey", in: "path", required: true, schema: { type: "string", enum: tenantKeys } }], responses: { "200": response() } }
      }
    }
  });
}

function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  if (write === check) {
    console.error("Usage: node scripts/generate-resource-surface-openapi.mjs --write|--check");
    process.exit(1);
  }
  const surfaces = loadSnapshot();
  const errors = validateSurfaces(surfaces);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  const generated = JSON.stringify(buildOpenApi(surfaces), null, 2) + "\n";
  if (write) {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, generated, "utf8");
    console.log(`Generated ${path.relative(API_ROOT, OUTPUT_PATH)} from snapshot (${surfaces.length} surfaces).`);
    return;
  }
  const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, "utf8") : "";
  if (current !== generated) {
    console.error("resource-surfaces.generated.json is out of date. Run npm run resources:openapi:generate.");
    process.exit(1);
  }
  console.log(`Resource surface OpenAPI parity OK (${surfaces.length} surfaces).`);
}

main();
