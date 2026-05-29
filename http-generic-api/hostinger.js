// Auto-extracted from server.js — do not edit manually, use domain logic here.

async function readSqlRegistryTable(surfaceName) {
  const { readTable } = await import("./sqlAdapter.js");
  return readTable(surfaceName);
}

function jsonParseSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function asBool(value) {
  return String(value || "").trim().toUpperCase() === "TRUE";
}

async function readHostingAccountRows(sheetName, deps = {}) {
  const readSqlSurface = typeof deps.readSqlRegistrySurface === "function"
    ? deps.readSqlRegistrySurface
    : readSqlRegistryTable;
  try {
    return { rows: await readSqlSurface(sheetName), source: "sql_primary" };
  } catch (sqlErr) {
    sqlErr.code = sqlErr.code || "sql_hosting_account_registry_read_failed";
    throw sqlErr;
  }
}

export function matchesHostingerSshTarget(rowObj, input = {}) {
  if ((rowObj.hosting_provider || "").trim().toLowerCase() !== "hostinger") {
    return false;
  }

  const targetKey = String(input.target_key || "").trim();
  const hostingAccountKey = String(input.hosting_account_key || "").trim();
  const accountIdentifier = String(input.account_identifier || "").trim();
  const siteUrl = String(input.site_url || "").trim().toLowerCase();

  if (hostingAccountKey && rowObj.hosting_account_key === hostingAccountKey) {
    return true;
  }

  if (accountIdentifier && rowObj.account_identifier === accountIdentifier) {
    return true;
  }

  const resolverTargetKeys = jsonParseSafe(rowObj.resolver_target_keys_json, []);
  if (
    targetKey &&
    Array.isArray(resolverTargetKeys) &&
    resolverTargetKeys.includes(targetKey)
  ) {
    return true;
  }

  const brandSites = jsonParseSafe(rowObj.brand_sites_json, []);
  if (
    siteUrl &&
    Array.isArray(brandSites) &&
    brandSites.some(
      x => String(x?.site || "").trim().toLowerCase() === siteUrl
    )
  ) {
    return true;
  }

  return false;
}

export async function hostingerSshRuntimeRead({ input = {} } = {}, deps = {}) {
  const {
    HOSTING_ACCOUNT_REGISTRY_SHEET = "Hosting Account Registry",
    asBool: asBoolFn = asBool,
    matchesHostingerSshTarget: matchesTarget = matchesHostingerSshTarget
  } = deps;

  const registry = await readHostingAccountRows(HOSTING_ACCOUNT_REGISTRY_SHEET, deps);
  const rowObjs = registry.rows || [];
  if (!rowObjs.length) {
    const err = new Error("Hosting Account Registry SQL surface is empty or missing data rows.");
    err.code = "hosting_account_registry_empty";
    err.status = 500;
    throw err;
  }

  const match = rowObjs.find(rowObj => matchesTarget(rowObj, input));

  if (!match) {
    return {
      ok: false,
      endpoint_key: "hostinger_ssh_runtime_read",
      resolution_status: "blocked",
      reason: "no_matching_hosting_account_registry_row",
      authoritative_source: "table.hosting_accounts",
      input
    };
  }

  return {
    ok: true,
    endpoint_key: "hostinger_ssh_runtime_read",
    resolution_status: "validated",
    authoritative_source: "table.hosting_accounts",
    legacy_mirror_source: HOSTING_ACCOUNT_REGISTRY_SHEET,
    hosting_account_key: match.hosting_account_key || "",
    hosting_provider: match.hosting_provider || "",
    account_identifier: match.account_identifier || "",
    resolver_target_keys_json: match.resolver_target_keys_json || "[]",
    brand_sites_json: match.brand_sites_json || "[]",
    ssh_available: asBoolFn(match.ssh_available),
    wp_cli_available: asBoolFn(match.wp_cli_available),
    shared_access_enabled: asBoolFn(match.shared_access_enabled),
    account_mode: match.account_mode || "",
    ssh_host: match.ssh_host || "",
    ssh_port: match.ssh_port || "22",
    ssh_username: match.ssh_username || "",
    ssh_auth_mode: match.ssh_auth_mode || "",
    ssh_credential_reference: match.ssh_credential_reference || "",
    ssh_runtime_notes: match.ssh_runtime_notes || "",
    auth_validation_status: match.auth_validation_status || "",
    endpoint_binding_status: match.endpoint_binding_status || "",
    resolver_execution_ready: asBoolFn(match.resolver_execution_ready),
    last_runtime_check_at: match.last_runtime_check_at || ""
  };
}
