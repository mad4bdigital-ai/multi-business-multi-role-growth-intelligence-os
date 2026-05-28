import { readTable as readSqlTable } from "./sqlAdapter.js";

function createCompatError(deps = {}, code, message, status = 500) {
  if (typeof deps.createHttpError === "function") return deps.createHttpError(code, message, status);
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function isEnabledFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function allowLegacySheetRegistryRead(deps = {}) {
  return deps.allowLegacySheetRegistryRead === true || isEnabledFlag(process.env.LEGACY_SHEET_REGISTRY_RUNTIME_ENABLED);
}

function buildRecordSetFromRows(rows = [], sheetName = "", deps = {}, source = "sql_primary") {
  const header = [];
  const seen = new Set();
  for (const row of rows || []) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        header.push(key);
      }
    }
  }
  const map = typeof deps.headerMap === "function"
    ? deps.headerMap(header, sheetName)
    : Object.fromEntries(header.map((key, idx) => [key, idx]));
  return { header, rows: rows || [], map, source, authority: source === "sql_primary" ? "sql_runtime_authority" : "legacy_mirror_recovery" };
}

export async function readGovernedSheetRecords(
  sheetName,
  spreadsheetId,
  deps = {}
) {
  const trimmedSheetName = String(sheetName || "").trim();
  const trimmedSpreadsheetId = String(
    spreadsheetId || deps.REGISTRY_SPREADSHEET_ID || ""
  ).trim();

  if (!trimmedSheetName) {
    throw createCompatError(deps, "missing_registry_surface", "Registry surface name is required.", 500);
  }

  const readSqlSurface = typeof deps.readSqlRegistrySurface === "function"
    ? deps.readSqlRegistrySurface
    : readSqlTable;

  try {
    const rows = await readSqlSurface(trimmedSheetName);
    return buildRecordSetFromRows(rows, trimmedSheetName, deps, "sql_primary");
  } catch (sqlErr) {
    if (!allowLegacySheetRegistryRead(deps)) {
      const err = createCompatError(
        deps,
        "sql_registry_read_failed",
        `SQL registry read failed for ${trimmedSheetName}. Legacy sheet fallback is disabled.`,
        500
      );
      err.cause = sqlErr;
      throw err;
    }
  }

  if (!trimmedSpreadsheetId) {
    throw createCompatError(deps, "missing_legacy_spreadsheet_id", "Legacy spreadsheet id is required only for recovery mirror fallback.", 500);
  }
  if (
    typeof deps.assertSheetExistsInSpreadsheet !== "function" ||
    typeof deps.getGoogleClientsForSpreadsheet !== "function" ||
    typeof deps.toValuesApiRange !== "function"
  ) {
    throw createCompatError(deps, "legacy_sheet_dependencies_missing", "Legacy sheet fallback dependencies are not available.", 500);
  }

  await deps.assertSheetExistsInSpreadsheet(trimmedSpreadsheetId, trimmedSheetName);
  const { sheets } = await deps.getGoogleClientsForSpreadsheet(trimmedSpreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: trimmedSpreadsheetId,
    range: deps.toValuesApiRange(trimmedSheetName, "A:AZ")
  });

  const values = response.data.values || [];
  if (!values.length) {
    return { header: [], rows: [], map: {}, source: "legacy_sheet_mirror", authority: "legacy_mirror_recovery" };
  }

  const header = (values[0] || []).map(value => String(value || "").trim());
  const map = typeof deps.headerMap === "function"
    ? deps.headerMap(header, trimmedSheetName)
    : Object.fromEntries(header.map((key, idx) => [key, idx]));
  const rows = values.slice(1).map(row => {
    const record = {};
    header.forEach((key, idx) => {
      if (!key) return;
      record[key] = row[idx] ?? "";
    });
    return record;
  });

  return { header, rows, map, source: "legacy_sheet_mirror", authority: "legacy_mirror_recovery" };
}

export function normalizeLooseHostname(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

export function findRegistryRecordByIdentity(rows = [], identity = {}) {
  const targetKey = String(identity.target_key || "").trim().toLowerCase();
  const domain = normalizeLooseHostname(identity.domain || identity.brand_domain || "");
  const brand = String(identity.brand || identity.target_key || "").trim().toLowerCase();

  const targetCandidates = [
    "target_key",
    "brand_key",
    "site_key",
    "website_key",
    "brand_name",
    "company_name"
  ];
  const domainCandidates = [
    "brand_domain",
    "domain",
    "site_domain",
    "base_url",
    "brand.base_url",
    "website_url"
  ];

  const exactTarget = rows.find(
    row =>
      targetCandidates.some(
        key => String(row?.[key] || "").trim().toLowerCase() === targetKey
      ) ||
      targetCandidates.some(
        key => String(row?.[key] || "").trim().toLowerCase() === brand
      )
  );
  if (exactTarget) return exactTarget;

  if (domain) {
    const exactDomain = rows.find(row =>
      domainCandidates.some(key => normalizeLooseHostname(row?.[key] || "") === domain)
    );
    if (exactDomain) return exactDomain;
  }

  return null;
}

export async function resolveBrandRegistryBinding(identity = {}, deps = {}) {
  const registry = await readGovernedSheetRecords(
    deps.BRAND_REGISTRY_SHEET,
    deps.REGISTRY_SPREADSHEET_ID,
    deps
  );
  const row = findRegistryRecordByIdentity(registry.rows, identity);

  if (!row) {
    throw deps.createHttpError(
      "brand_registry_binding_not_found",
      `Brand Registry binding not found for ${identity.target_key || identity.domain || "unknown site"}.`,
      409
    );
  }

  return {
    row,
    target_key:
      deps.firstPopulated(row, ["target_key", "brand_key", "site_key"]) ||
      String(identity.target_key || "").trim(),
    brand_name:
      deps.firstPopulated(row, ["brand_name", "company_name", "target_key"]) ||
      String(identity.brand || identity.target_key || "").trim(),
    base_url: deps.firstPopulated(row, [
      "brand.base_url",
      "base_url",
      "website_url",
      "domain",
      "brand_domain"
    ]),
    brand_domain: normalizeLooseHostname(
      deps.firstPopulated(row, ["brand_domain", "domain", "website_url", "base_url"])
    ),
    hosting_account_key:
      deps.firstPopulated(row, [
        "hosting_account_key",
        "hosting_account_registry_ref",
        "account_key",
        "hosting_key"
      ]) || "",
    hostinger_api_target_key:
      deps.firstPopulated(row, [
        "hostinger_api_target_key",
        "hosting_account_key",
        "hosting_account_registry_ref"
      ]) || "",
    row_data: row
  };
}

export async function hostingerSshRuntimeRead(args = {}, deps = {}) {
  const input = args.input || {};
  const registry = await readGovernedSheetRecords(
    deps.HOSTING_ACCOUNT_REGISTRY_SHEET || "Hosting Account Registry",
    deps.REGISTRY_SPREADSHEET_ID,
    deps
  );

  const rowObjs = registry.rows || [];
  if (!rowObjs.length) {
    const err = new Error("Hosting Account Registry SQL surface is empty or missing data rows.");
    err.code = "hosting_account_registry_empty";
    err.status = 500;
    throw err;
  }

  const match = rowObjs.find(rowObj => deps.matchesHostingerSshTarget(rowObj, input));

  if (!match) {
    return {
      ok: false,
      endpoint_key: "hostinger_ssh_runtime_read",
      resolution_status: "blocked",
      reason: "no_matching_hosting_account_registry_row",
      authoritative_source: "table.hosting_accounts",
      legacy_mirror_source: deps.HOSTING_ACCOUNT_REGISTRY_SHEET || "Hosting Account Registry",
      input
    };
  }

  return {
    ok: true,
    endpoint_key: "hostinger_ssh_runtime_read",
    resolution_status: "validated",
    authoritative_source: deps.HOSTING_ACCOUNT_REGISTRY_SHEET,
    hosting_account_key: match.hosting_account_key || "",
    hosting_provider: match.hosting_provider || "",
    account_identifier: match.account_identifier || "",
    resolver_target_keys_json: match.resolver_target_keys_json || "[]",
    brand_sites_json: match.brand_sites_json || "[]",
    ssh_available: deps.asBool(match.ssh_available),
    wp_cli_available: deps.asBool(match.wp_cli_available),
    shared_access_enabled: deps.asBool(match.shared_access_enabled),
    account_mode: match.account_mode || "",
    ssh_host: match.ssh_host || "",
    ssh_port: match.ssh_port || "22",
    ssh_username: match.ssh_username || "",
    ssh_auth_mode: match.ssh_auth_mode || "",
    ssh_credential_reference: match.ssh_credential_reference || "",
    ssh_runtime_notes: match.ssh_runtime_notes || "",
    auth_validation_status: match.auth_validation_status || "",
    endpoint_binding_status: match.endpoint_binding_status || "",
    resolver_execution_ready: deps.asBool(match.resolver_execution_ready),
    last_runtime_check_at: match.last_runtime_check_at || ""
  };
}
