import {
  SITE_RUNTIME_INVENTORY_REGISTRY_SHEET,
  SITE_SETTINGS_INVENTORY_REGISTRY_SHEET,
  PLUGIN_INVENTORY_REGISTRY_SHEET
} from "./config.js";
import { fetchRange } from "./googleSheets.js";
import { headerMap, getCell } from "./sheetHelpers.js";

function registrySchemaError(sheetName, col) {
  const err = new Error(`${sheetName} missing required column: ${col}`);
  err.code = "registry_schema_mismatch";
  err.status = 500;
  return err;
}

function registryEmptyError(name) {
  const err = new Error(`${name} sheet is empty or unreadable.`);
  err.code = "registry_unavailable";
  err.status = 500;
  return err;
}

const SITE_RUNTIME_INVENTORY_REGISTRY_COLUMNS = [
  "target_key", "brand_name", "brand_domain", "base_url", "site_type",
  "supported_cpts", "supported_taxonomies", "generated_endpoint_support",
  "runtime_validation_status", "last_runtime_validated_at", "active_status"
];

const SITE_SETTINGS_INVENTORY_REGISTRY_COLUMNS = [
  "target_key", "brand_name", "brand_domain", "base_url", "site_type",
  "permalink_structure", "timezone_string", "site_language", "active_theme",
  "settings_validation_status", "last_settings_validated_at", "active_status"
];

const PLUGIN_INVENTORY_REGISTRY_COLUMNS = [
  "target_key", "brand_name", "brand_domain", "base_url", "site_type",
  "active_plugins", "plugin_versions_json", "plugin_owned_tables",
  "plugin_owned_entities", "plugin_validation_status",
  "last_plugin_validated_at", "active_status"
];

function validateColumns(map, columns, sheetName) {
  for (const col of columns) {
    if (!Object.prototype.hasOwnProperty.call(map, col)) {
      throw registrySchemaError(sheetName, col);
    }
  }
}

export async function loadSiteRuntimeInventoryRegistry(sheets) {
  const values = await fetchRange(sheets, `'${SITE_RUNTIME_INVENTORY_REGISTRY_SHEET}'!A1:Z2000`);
  if (!values.length) throw registryEmptyError("Site Runtime Inventory Registry");
  const map = headerMap(values[0], SITE_RUNTIME_INVENTORY_REGISTRY_SHEET);
  validateColumns(map, SITE_RUNTIME_INVENTORY_REGISTRY_COLUMNS, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET);
  return values.slice(1).map(row => ({
    target_key: getCell(row, map, "target_key"),
    brand_name: getCell(row, map, "brand_name"),
    brand_domain: getCell(row, map, "brand_domain"),
    base_url: getCell(row, map, "base_url"),
    site_type: getCell(row, map, "site_type"),
    supported_cpts: getCell(row, map, "supported_cpts"),
    supported_taxonomies: getCell(row, map, "supported_taxonomies"),
    generated_endpoint_support: getCell(row, map, "generated_endpoint_support"),
    runtime_validation_status: getCell(row, map, "runtime_validation_status"),
    last_runtime_validated_at: getCell(row, map, "last_runtime_validated_at"),
    active_status: getCell(row, map, "active_status")
  })).filter(r => r.target_key || r.brand_domain || r.base_url);
}

export async function loadSiteSettingsInventoryRegistry(sheets) {
  const values = await fetchRange(sheets, `'${SITE_SETTINGS_INVENTORY_REGISTRY_SHEET}'!A1:Z2000`);
  if (!values.length) throw registryEmptyError("Site Settings Inventory Registry");
  const map = headerMap(values[0], SITE_SETTINGS_INVENTORY_REGISTRY_SHEET);
  validateColumns(map, SITE_SETTINGS_INVENTORY_REGISTRY_COLUMNS, SITE_SETTINGS_INVENTORY_REGISTRY_SHEET);
  return values.slice(1).map(row => ({
    target_key: getCell(row, map, "target_key"),
    brand_name: getCell(row, map, "brand_name"),
    brand_domain: getCell(row, map, "brand_domain"),
    base_url: getCell(row, map, "base_url"),
    site_type: getCell(row, map, "site_type"),
    permalink_structure: getCell(row, map, "permalink_structure"),
    timezone_string: getCell(row, map, "timezone_string"),
    site_language: getCell(row, map, "site_language"),
    active_theme: getCell(row, map, "active_theme"),
    settings_validation_status: getCell(row, map, "settings_validation_status"),
    last_settings_validated_at: getCell(row, map, "last_settings_validated_at"),
    active_status: getCell(row, map, "active_status")
  })).filter(r => r.target_key || r.brand_domain || r.base_url);
}

export async function loadPluginInventoryRegistry(sheets) {
  const values = await fetchRange(sheets, `'${PLUGIN_INVENTORY_REGISTRY_SHEET}'!A1:Z2000`);
  if (!values.length) throw registryEmptyError("Plugin Inventory Registry");
  const map = headerMap(values[0], PLUGIN_INVENTORY_REGISTRY_SHEET);
  validateColumns(map, PLUGIN_INVENTORY_REGISTRY_COLUMNS, PLUGIN_INVENTORY_REGISTRY_SHEET);
  return values.slice(1).map(row => ({
    target_key: getCell(row, map, "target_key"),
    brand_name: getCell(row, map, "brand_name"),
    brand_domain: getCell(row, map, "brand_domain"),
    base_url: getCell(row, map, "base_url"),
    site_type: getCell(row, map, "site_type"),
    active_plugins: getCell(row, map, "active_plugins"),
    plugin_versions_json: getCell(row, map, "plugin_versions_json"),
    plugin_owned_tables: getCell(row, map, "plugin_owned_tables"),
    plugin_owned_entities: getCell(row, map, "plugin_owned_entities"),
    plugin_validation_status: getCell(row, map, "plugin_validation_status"),
    last_plugin_validated_at: getCell(row, map, "last_plugin_validated_at"),
    active_status: getCell(row, map, "active_status")
  })).filter(r => r.target_key || r.brand_domain || r.base_url);
}
