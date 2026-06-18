// Auto-extracted from server.js — do not edit manually, use domain logic here.
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
  DEFAULT_JOB_MAX_ATTEMPTS, JOB_WEBHOOK_TIMEOUT_MS, JOB_RETRY_DELAYS_MS
} from "../config.js";

export function firstPopulated(record = {}, keys = []) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

export function normalizeSiteMigrationPayload(payload = {}) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const source = body.source && typeof body.source === "object" ? body.source : {};
  const destination =
    body.destination && typeof body.destination === "object" ? body.destination : {};
  const migration = body.migration && typeof body.migration === "object" ? body.migration : {};
  const readback = body.readback && typeof body.readback === "object" ? body.readback : {};

  return {
    source: {
      target_key: String(source.target_key || source.brand || "").trim(),
      brand: String(source.brand || source.target_key || "").trim(),
      domain: String(source.domain || source.brand_domain || "").trim().toLowerCase(),
      brand_domain: String(source.brand_domain || source.domain || "").trim().toLowerCase(),
      account_mode: String(source.account_mode || "shared_hosting").trim().toLowerCase(),
      site_type: String(source.site_type || "wordpress").trim().toLowerCase()
    },
    destination: {
      target_key: String(destination.target_key || destination.brand || "").trim(),
      brand: String(destination.brand || destination.target_key || "").trim(),
      domain: String(destination.domain || destination.brand_domain || "").trim().toLowerCase(),
      brand_domain: String(destination.brand_domain || destination.domain || "").trim().toLowerCase(),
      account_mode: String(destination.account_mode || "shared_hosting").trim().toLowerCase(),
      site_type: String(destination.site_type || "wordpress").trim().toLowerCase()
    },
    migration: {
      mode: String(migration.mode || "content_only").trim().toLowerCase(),
      transport: String(migration.transport || "auto").trim().toLowerCase(),
      apply: migration.apply === true,
      publish_status: String(migration.publish_status || "draft").trim().toLowerCase(),
      post_types: normalizeStringList(migration.post_types),
      tables: normalizeStringList(migration.tables),
      paths: normalizeStringList(migration.paths),
      plugin_keys: normalizeStringList(migration.plugin_keys),
      taxonomies: normalizeStringList(migration.taxonomies),
      search_replace:
        migration.search_replace &&
        typeof migration.search_replace === "object" &&
        !Array.isArray(migration.search_replace)
          ? {
              from: String(migration.search_replace.from || "").trim(),
              to: String(migration.search_replace.to || "").trim()
            }
          : { from: "", to: "" }
    },
    readback: {
      required: readback.required !== false,
      mode: String(readback.mode || "echo").trim().toLowerCase()
    }
  };
}

export function validateSiteMigrationPayload(payload = {}) {
  const errors = [];
  const allowedModes = new Set([
    "full_site",
    "content_only",
    "db_tables_only",
    "files_only",
    "hybrid"
  ]);
  const allowedAccountModes = new Set([
    "shared_hosting",
    "shared_access",
    "vps"
  ]);
  const allowedTransports = new Set([
    "auto",
    "wordpress_connector",
    "ssh_wpcli",
    "hybrid_wordpress"
  ]);
  const allowedReadbackModes = new Set(["none", "echo", "location_followup"]);

  for (const side of ["source", "destination"]) {
    const entry = payload?.[side];
    if (!entry || typeof entry !== "object") {
      errors.push(`${side} is required.`);
      continue;
    }
    if (!String(entry.target_key || "").trim()) {
      errors.push(`${side}.target_key is required.`);
    }
    if (!allowedAccountModes.has(String(entry.account_mode || "").trim())) {
      errors.push(`${side}.account_mode is invalid.`);
    }
    if (String(entry.site_type || "").trim() !== "wordpress") {
      errors.push(`${side}.site_type must be wordpress.`);
    }
  }

  if (!allowedModes.has(String(payload?.migration?.mode || "").trim())) {
    errors.push("migration.mode is invalid.");
  }

  if (!allowedTransports.has(String(payload?.migration?.transport || "").trim())) {
    errors.push("migration.transport is invalid.");
  }

  if (
    payload?.migration &&
    Object.prototype.hasOwnProperty.call(payload.migration, "apply") &&
    typeof payload.migration.apply !== "boolean"
  ) {
    errors.push("migration.apply must be a boolean when provided.");
  }

  if (!WORDPRESS_MUTATION_PUBLISH_STATUSES.has(String(payload?.migration?.publish_status || "").trim())) {
    errors.push(
      `migration.publish_status must be one of: ${[...WORDPRESS_MUTATION_PUBLISH_STATUSES].join(", ")}.`
    );
  }

  if (
    !allowedReadbackModes.has(String(payload?.readback?.mode || "").trim())
  ) {
    errors.push("readback.mode is invalid.");
  }

  const searchReplace = payload?.migration?.search_replace || {};
  if ((searchReplace.from && !searchReplace.to) || (!searchReplace.from && searchReplace.to)) {
    errors.push("migration.search_replace.from and migration.search_replace.to must both be provided.");
  }

  if (
    String(payload?.migration?.mode || "").trim() === "db_tables_only" &&
    !(payload?.migration?.tables || []).length
  ) {
    errors.push("migration.tables must contain at least one table for db_tables_only mode.");
  }

  if (
    String(payload?.migration?.mode || "").trim() === "files_only" &&
    !(payload?.migration?.paths || []).length
  ) {
    errors.push("migration.paths must contain at least one path for files_only mode.");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export async function resolveHostingAccountBinding(identity = {}, brandBinding = {}) {
  const registry = await readGovernedSheetRecords(HOSTING_ACCOUNT_REGISTRY_SHEET);

  const requestedHostingAccountKey = String(
    firstPopulated(brandBinding.row_data || brandBinding, [
      "hosting_account_key",
      "hosting_account_registry_ref",
      "account_key",
      "hosting_key"
    ]) || ""
  ).trim();

  const normalizedTargetKey = String(
    brandBinding.target_key || identity.target_key || ""
  ).trim().toLowerCase();

  const normalizedDomain = normalizeLooseHostname(
    brandBinding.brand_domain || identity.domain || identity.brand_domain || ""
  );

  debugLog("HOSTING_BINDING_INPUT:", JSON.stringify({
    identity_target_key: identity?.target_key || "",
    identity_domain: identity?.domain || "",
    requestedHostingAccountKey,
    normalizedTargetKey,
    normalizedDomain
  }));

  function parseJsonArraySafe(value) {
    try {
      const parsed = JSON.parse(String(value || "").trim() || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function rowMatchesTargetFromResolverArray(row) {
    const values = parseJsonArraySafe(row?.resolver_target_keys_json).map(v =>
      String(v || "").trim().toLowerCase()
    );
    return !!normalizedTargetKey && values.includes(normalizedTargetKey);
  }

  function rowMatchesSiteFromBrandSites(row) {
    const entries = parseJsonArraySafe(row?.brand_sites_json);
    return entries.some(entry => {
      const site = normalizeLooseHostname(entry?.site || "");
      const brand = String(entry?.brand || "").trim().toLowerCase();
      return (
        (!!normalizedDomain && site === normalizedDomain) ||
        (!!normalizedTargetKey && brand === normalizedTargetKey)
      );
    });
  }

  let row = null;

  // 1) Direct lookup by hosting account key from Brand Registry
  if (requestedHostingAccountKey) {
    row =
      registry.rows.find(candidate =>
        [
          "hosting_account_key",
          "account_key",
          "hosting_key"
        ].some(key =>
          String(candidate?.[key] || "").trim() === requestedHostingAccountKey
        )
      ) || null;
  }

  // 2) Direct identity columns fallback
  if (!row) {
    row =
      findRegistryRecordByIdentity(registry.rows, {
        target_key: brandBinding.target_key || identity.target_key,
        domain: brandBinding.brand_domain || identity.domain,
        brand: brandBinding.brand_name || identity.brand || identity.target_key
      }) || null;
  }

  // 3) Account-centric registry fallback via resolver_target_keys_json
  if (!row) {
    row = registry.rows.find(candidate => rowMatchesTargetFromResolverArray(candidate)) || null;
  }

  // 4) Account-centric registry fallback via brand_sites_json
  if (!row) {
    row = registry.rows.find(candidate => rowMatchesSiteFromBrandSites(candidate)) || null;
  }

  debugLog("HOSTING_BINDING_MATCH:", JSON.stringify({
    matched_hosting_account_key: row?.hosting_account_key || "",
    matched_account_identifier: row?.account_identifier || "",
    matched_plan_label: row?.plan_label || ""
  }));

  if (!row) {
    throw createHttpError(
      "hosting_account_binding_not_found",
      `Hosting Account Registry binding not found for ${
        identity.target_key || identity.domain || requestedHostingAccountKey || "unknown site"
      }.`,
      409
    );
  }

  return {
    row,
    hosting_account_key: firstPopulated(row, ["hosting_account_key", "account_key", "hosting_key"]),
    api_key_reference: firstPopulated(row, ["api_key_reference", "credential_reference"]),
    ssh_available: boolFromSheet(firstPopulated(row, ["ssh_available", "ssh_enabled"])),
    wp_cli_available: boolFromSheet(firstPopulated(row, ["wp_cli_available", "wpcli_available"])),
    shared_access_enabled: boolFromSheet(firstPopulated(row, ["shared_access_enabled", "account_sharing_enabled"])),
    account_mode:
      String(firstPopulated(row, ["account_mode", "hosting_mode"]) || identity.account_mode || "").trim().toLowerCase(),
    row_data: row
  };
}

export async function resolveWordpressRuntimeInventory(_input = {}, siteRef = {}) {
  const { sheets } = await getGoogleClients({ action_key: "google_sheets_api" });
  const rows = await loadSiteRuntimeInventoryRegistry(sheets).catch(() => []);
  const row =
    findRegistryRecordByIdentity(rows, {
      target_key: siteRef.target_key,
      domain: siteRef.brand_domain || siteRef.base_url,
      brand: siteRef.brand_name
    }) || {};

  return {
    row_data: row,
    inventory_found: Object.keys(row).length > 0,
    supported_cpts: normalizeStringList(String(row.supported_cpts || "").split(/[,\n|]/)),
    supported_taxonomies: normalizeStringList(String(row.supported_taxonomies || "").split(/[,\n|]/)),
    generated_endpoint_support: normalizeStringList(String(row.generated_endpoint_support || "").split(/[,\n|]/)),
    runtime_validation_status: String(row.runtime_validation_status || "pending").trim().toLowerCase(),
    last_runtime_validated_at: row.last_runtime_validated_at || "",
    site_type: row.site_type || "wordpress",
    active_status: row.active_status || ""
  };
}

export async function resolveWordpressSettingsInventory(_input = {}, siteRef = {}) {
  const { sheets } = await getGoogleClients();
  const rows = await loadSiteSettingsInventoryRegistry(sheets).catch(() => []);
  const row =
    findRegistryRecordByIdentity(rows, {
      target_key: siteRef.target_key,
      domain: siteRef.brand_domain || siteRef.base_url,
      brand: siteRef.brand_name
    }) || {};

  return {
    row_data: row,
    inventory_found: Object.keys(row).length > 0,
    permalink_structure: row.permalink_structure || "",
    timezone_string: row.timezone_string || "",
    site_language: row.site_language || "",
    active_theme: row.active_theme || "",
    settings_validation_status: String(row.settings_validation_status || "pending").trim().toLowerCase(),
    last_settings_validated_at: row.last_settings_validated_at || "",
    site_type: row.site_type || "wordpress",
    active_status: row.active_status || ""
  };
}

export async function resolveWordpressPluginInventory(_input = {}, siteRef = {}) {
  const { sheets } = await getGoogleClients();
  const rows = await loadPluginInventoryRegistry(sheets).catch(() => []);
  const row =
    findRegistryRecordByIdentity(rows, {
      target_key: siteRef.target_key,
      domain: siteRef.brand_domain || siteRef.base_url,
      brand: siteRef.brand_name
    }) || {};

  return {
    row_data: row,
    inventory_found: Object.keys(row).length > 0,
    active_plugins: normalizeStringList(String(row.active_plugins || "").split(/[,\n|]/)),
    plugin_versions_json: row.plugin_versions_json || "",
    plugin_owned_tables: normalizeStringList(String(row.plugin_owned_tables || "").split(/[,\n|]/)),
    plugin_owned_entities: normalizeStringList(String(row.plugin_owned_entities || "").split(/[,\n|]/)),
    plugin_validation_status: String(row.plugin_validation_status || "pending").trim().toLowerCase(),
    last_plugin_validated_at: row.last_plugin_validated_at || "",
    site_type: row.site_type || "wordpress",
    active_status: row.active_status || ""
  };
}

export async function resolveWordpressSiteAwarenessContext(input = {}) {
  const sourceBrand = await resolveBrandRegistryBinding(input.source || {});
  const destinationBrand = await resolveBrandRegistryBinding(input.destination || {});
  const sourceHosting = await resolveHostingAccountBinding(input.source || {}, sourceBrand);
  const destinationHosting = await resolveHostingAccountBinding(input.destination || {}, destinationBrand);

  return {
    source: {
      ...sourceBrand,
      hosting: sourceHosting
    },
    destination: {
      ...destinationBrand,
      hosting: destinationHosting
    },
    provider_family_continuity:
      !!sourceBrand.base_url && !!destinationBrand.base_url
  };
}

export function listIntersection(a = [], b = []) {
  const right = new Set((b || []).map(v => String(v || "").trim().toLowerCase()));
  return (a || []).filter(v => right.has(String(v || "").trim().toLowerCase()));
}

export function listDifference(a = [], b = []) {
  const right = new Set((b || []).map(v => String(v || "").trim().toLowerCase()));
  return (a || []).filter(v => !right.has(String(v || "").trim().toLowerCase()));
}

export function classifyWordpressCapabilityState(context = {}) {
  const source = context.source || {};
  const destination = context.destination || {};

  const sourceRuntime = source.runtime || {};
  const destinationRuntime = destination.runtime || {};
  const sourcePlugins = source.plugins || {};
  const destinationPlugins = destination.plugins || {};
  const sourceSettings = source.settings || {};
  const destinationSettings = destination.settings || {};
  const requestedPluginKeys = context.requested_plugin_keys || [];

  const pluginIntersection = listIntersection(
    sourcePlugins.active_plugins,
    destinationPlugins.active_plugins
  );
  const missingDestinationPlugins = listDifference(
    requestedPluginKeys.length ? requestedPluginKeys : sourcePlugins.active_plugins,
    destinationPlugins.active_plugins
  );

  const runtimeShapeCompatible =
    sourceRuntime.inventory_found &&
    destinationRuntime.inventory_found &&
    listIntersection(sourceRuntime.supported_cpts, destinationRuntime.supported_cpts).length > 0;

  const settingsCompatible =
    !sourceSettings.permalink_structure ||
    !destinationSettings.permalink_structure ||
    sourceSettings.permalink_structure === destinationSettings.permalink_structure;

  const sshWpCliReady =
    source.hosting?.account_mode === "vps" &&
    destination.hosting?.account_mode === "vps" &&
    source.hosting?.ssh_available &&
    destination.hosting?.ssh_available &&
    source.hosting?.wp_cli_available &&
    destination.hosting?.wp_cli_available;

  const wordpressConnectorReady =
    source.hosting?.account_mode !== "vps" &&
    destination.hosting?.account_mode !== "vps" &&
    source.hosting?.shared_access_enabled &&
    destination.hosting?.shared_access_enabled;

  const generatedEndpointSupportProven =
    (destinationRuntime.generated_endpoint_support || []).length > 0 ||
    (destinationRuntime.supported_cpts || []).length > 0;

  const blockingReasons = [];
  const degradedReasons = [];

  if (!source.target_key || !destination.target_key) {
    blockingReasons.push("source_or_destination_identity_unresolved");
  }

  if (!sourceRuntime.inventory_found || !destinationRuntime.inventory_found) {
    degradedReasons.push("runtime_inventory_missing_or_stale");
  }

  if (requestedPluginKeys.length && missingDestinationPlugins.length) {
    blockingReasons.push("requested_plugin_parity_not_proven");
  }

  if (!generatedEndpointSupportProven) {
    degradedReasons.push("generated_endpoint_support_not_proven");
  }

  if (!settingsCompatible) {
    degradedReasons.push("settings_shape_mismatch");
  }

  return {
    runtime_shape_compatible: runtimeShapeCompatible,
    plugin_parity_ok: missingDestinationPlugins.length === 0,
    settings_compatible: settingsCompatible,
    generated_endpoint_support_proven: generatedEndpointSupportProven,
    wordpress_connector_ready: !!wordpressConnectorReady,
    ssh_wpcli_ready: !!sshWpCliReady,
    writeback_required: false,
    writeback_surfaces: [],
    plugin_intersection: pluginIntersection,
    missing_destination_plugins: missingDestinationPlugins,
    blocking_reasons: blockingReasons,
    degraded_reasons: degradedReasons
  };
}

export function classifyWordpressMigrationImpact(context = {}, payload = {}) {
  const migration = payload.migration || {};
  const sourceRuntime = context?.source?.runtime || {};
  const destinationRuntime = context?.destination?.runtime || {};
  const sourcePlugins = context?.source?.plugins || {};
  const destinationPlugins = context?.destination?.plugins || {};

  const runtimeDeltaDetected =
    listDifference(sourceRuntime.supported_cpts, destinationRuntime.supported_cpts).length > 0 ||
    listDifference(sourceRuntime.supported_taxonomies, destinationRuntime.supported_taxonomies).length > 0;

  const settingsDeltaDetected =
    String(context?.source?.settings?.permalink_structure || "").trim() !==
    String(context?.destination?.settings?.permalink_structure || "").trim();

  const pluginDeltaDetected =
    listDifference(sourcePlugins.active_plugins, destinationPlugins.active_plugins).length > 0;

  return {
    mode: migration.mode,
    content_impact:
      migration.mode === "content_only" ||
      migration.mode === "hybrid" ||
      migration.mode === "full_site",
    files_impact:
      migration.mode === "files_only" ||
      migration.mode === "hybrid" ||
      migration.mode === "full_site",
    db_tables_impact:
      migration.mode === "db_tables_only" ||
      migration.mode === "hybrid" ||
      migration.mode === "full_site",
    runtime_delta_detected: runtimeDeltaDetected,
    settings_delta_detected: settingsDeltaDetected,
    plugin_delta_detected: pluginDeltaDetected,
    verification_required: true
  };
}

export function resolveMigrationTransport(payload = {}, wpContext = {}) {
  const sourceMode = String(payload?.source?.account_mode || "").trim();
  const destinationMode = String(payload?.destination?.account_mode || "").trim();
  const requested = String(payload?.migration?.transport || "auto").trim();
  const capability = wpContext.capability_state || {};

  if (requested && requested !== "auto") {
    return requested;
  }

  if (capability.ssh_wpcli_ready) {
    return "ssh_wpcli";
  }

  if (
    capability.wordpress_connector_ready &&
    capability.plugin_parity_ok &&
    (capability.runtime_shape_compatible || payload?.migration?.mode === "content_only")
  ) {
    return "wordpress_connector";
  }

  if (
    (sourceMode === "vps" && destinationMode !== "vps") ||
    (sourceMode !== "vps" && destinationMode === "vps")
  ) {
    return "hybrid_wordpress";
  }

  return "unsupported";
}

export function buildWordpressMutationPlan(context = {}, payload = {}) {
  const migration = payload.migration || {};
  const impact = context.impact || {};
  const steps = [
    "brand_resolution",
    "hosting_account_resolution",
    "runtime_inventory_read",
    "settings_inventory_read",
    "plugin_inventory_read",
    "wordpress_capability_classification",
    "migration_impact_classification",
    "transport_resolution",
    "migration_planning",
    migration.apply ? "transport_execution_apply" : "transport_execution_plan_only",
    "runtime_reconciliation"
  ];

  if (impact.runtime_delta_detected || impact.settings_delta_detected || impact.plugin_delta_detected) {
    steps.push("registry_delta_writeback");
  }
  if (payload?.readback?.required !== false) {
    steps.push("readback_verification");
  }

  return {
    mode: migration.mode,
    transport: context.transport,
    apply: migration.apply === true,
    publish_status: String(migration.publish_status || "draft").trim().toLowerCase(),
    steps,
    draft_or_staged_required: migration.mode !== "full_site",
    verification_targets: {
      post_types: migration.post_types || [],
      taxonomies: migration.taxonomies || [],
      tables: migration.tables || [],
      paths: migration.paths || []
    }
  };
}

export function buildRegistryDeltaWritebackPlan(context = {}, impact = {}) {
  const updates = [];

  if (impact.runtime_delta_detected) {
    updates.push({
      surface: SITE_RUNTIME_INVENTORY_REGISTRY_SHEET,
      mode: "upsert_delta",
      fields: [
        "supported_cpts",
        "supported_taxonomies",
        "generated_endpoint_support",
        "runtime_validation_status",
        "last_runtime_validated_at"
      ]
    });
  }

  if (impact.settings_delta_detected) {
    updates.push({
      surface: SITE_SETTINGS_INVENTORY_REGISTRY_SHEET,
      mode: "upsert_delta",
      fields: [
        "permalink_structure",
        "timezone_string",
        "site_language",
        "active_theme",
        "settings_validation_status",
        "last_settings_validated_at"
      ]
    });
  }

  if (impact.plugin_delta_detected) {
    updates.push({
      surface: PLUGIN_INVENTORY_REGISTRY_SHEET,
      mode: "upsert_delta",
      fields: [
        "active_plugins",
        "plugin_validation_status",
        "last_plugin_validated_at"
      ]
    });
  }

  const writebackRequired = updates.length > 0;
  if (writebackRequired) {
    context.capability_state = context.capability_state || {};
    context.capability_state.writeback_required = true;
    context.capability_state.writeback_surfaces = updates.map(v => v.surface);
  }

  return {
    updates,
    readback_required: writebackRequired
  };
}

export async function verifyRegistryDeltaReadback(result = {}) {
  if (!result?.writeback_plan?.readback_required) {
    return {
      ok: true,
      verification_mode: "not_required",
      verified_surfaces: []
    };
  }

  const verifiedSurfaces = [];
  for (const update of result.writeback_plan.updates || []) {
    await assertSheetExistsInSpreadsheet(REGISTRY_SPREADSHEET_ID, update.surface);
    verifiedSurfaces.push(update.surface);
  }

  return {
    ok: true,
    verification_mode: "registry_surface_presence",
    verified_surfaces: verifiedSurfaces
  };
}

export function buildSiteMigrationArtifacts(context = {}, payload = {}, transport = "") {
  return {
    source_site: {
      target_key: context?.source?.target_key || payload?.source?.target_key || "",
      base_url: context?.source?.base_url || "",
      brand_domain: context?.source?.brand_domain || ""
    },
    destination_site: {
      target_key: context?.destination?.target_key || payload?.destination?.target_key || "",
      base_url: context?.destination?.base_url || "",
      brand_domain: context?.destination?.brand_domain || ""
    },
    transport,
    migration_mode: payload?.migration?.mode || ""
  };
}

export function normalizeWordpressRestRoot(baseUrl = "") {
  const normalizedBase = normalizeProviderDomain(baseUrl);
  const url = new URL(normalizedBase);
  let pathname = url.pathname.replace(/\/+$/, "");

  if (!pathname || pathname === "/") {
    pathname = "/wp-json";
  } else if (!pathname.endsWith("/wp-json")) {
    pathname = `${pathname}/wp-json`;
  }

  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function buildWordpressRestUrl(baseUrl = "", restPath = "/", query = {}) {
  const root = new URL(normalizeWordpressRestRoot(baseUrl));
  const normalizedRestPath = `/${String(restPath || "").trim().replace(/^\/+/, "")}`;
  root.pathname = `${root.pathname.replace(/\/+$/, "")}${normalizedRestPath}`;
  root.search = "";

  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    root.searchParams.set(String(key), String(value));
  }

  return root.toString();
}

export function getWordpressSiteAuth(siteRef = {}) {
  const row = siteRef?.row_data && typeof siteRef.row_data === "object" ? siteRef.row_data : {};
  const username = String(row.username || "").trim();
  const applicationPassword = String(row.application_password || "").trim();
  if (!username || !applicationPassword) return null;
  return { username, applicationPassword };
}

export function wordpressRichTextToString(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const raw = String(value.raw || "").trim();
  if (raw) return raw;
  return String(value.rendered || "").trim();
}

export function mapWordpressSourceEntryToMutationPayload(sourceEntry = {}, publishStatus = "draft") {
  const payload = {
    status: publishStatus
  };

  const title = wordpressRichTextToString(sourceEntry.title);
  const content = wordpressRichTextToString(sourceEntry.content);
  const excerpt = wordpressRichTextToString(sourceEntry.excerpt);
  const slug = String(sourceEntry.slug || "").trim();

  if (title) payload.title = title;
  if (content) payload.content = content;
  if (excerpt) payload.excerpt = excerpt;
  if (slug) payload.slug = slug;

  return payload;
}

export function normalizeWordpressCollectionSlug(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

export function getWordpressCollectionResolverCache(siteRef = {}) {
  if (!siteRef || typeof siteRef !== "object") return {};
  if (!siteRef.__resolved_collection_slugs || typeof siteRef.__resolved_collection_slugs !== "object") {
    siteRef.__resolved_collection_slugs = {};
  }
  return siteRef.__resolved_collection_slugs;
}

export function extractWordpressCollectionSlugsFromRuntime(siteRef = {}) {
  const runtime = siteRef?.runtime && typeof siteRef.runtime === "object" ? siteRef.runtime : {};
  const candidates = [];
  const seen = new Set();
  const addCandidate = value => {
    const normalized = normalizeWordpressCollectionSlug(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  for (const endpoint of normalizeStringList(runtime.generated_endpoint_support || [])) {
    const match = String(endpoint || "").match(/(?:^|\/)wp\/v2\/([^\/\{\}\s\?]+)/i);
    if (!match) continue;
    addCandidate(match[1]);
  }

  for (const type of normalizeStringList(runtime.supported_cpts || [])) {
    const normalizedType = normalizeWordpressCollectionSlug(type);
    if (!normalizedType) continue;
    addCandidate(WORDPRESS_CORE_POST_TYPE_COLLECTION_ALIASES[normalizedType] || normalizedType);
  }

  return candidates;
}

export function pickWordpressCollectionSlugFromTypeRecord(typeRecord = {}, fallbackType = "") {
  if (!typeRecord || typeof typeRecord !== "object" || Array.isArray(typeRecord)) {
    return "";
  }

  const restNamespace = String(typeRecord.rest_namespace || "").trim().toLowerCase();
  if (restNamespace && restNamespace !== "wp/v2") {
    return "";
  }

  const restBase = normalizeWordpressCollectionSlug(typeRecord.rest_base || "");
  if (restBase) return restBase;

  const typeSlug = normalizeWordpressCollectionSlug(typeRecord.slug || fallbackType);
  if (!typeSlug) return "";
  return WORDPRESS_CORE_POST_TYPE_COLLECTION_ALIASES[typeSlug] || typeSlug;
}

export async function resolveWordpressCollectionSlugFromTypesEndpoint({
  siteRef = {},
  postType = "",
  authRequired = false
}) {
  const normalizedType = normalizeWordpressCollectionSlug(postType);
  if (!normalizedType) return "";

  const directTypeQueries = ["edit", "view"];
  for (const context of directTypeQueries) {
    const response = await executeWordpressRestJsonRequest({
      siteRef,
      method: "GET",
      restPath: `/wp/v2/types/${encodeURIComponent(normalizedType)}`,
      query: { context },
      authRequired
    });

    if (!response.ok) continue;
    const picked = pickWordpressCollectionSlugFromTypeRecord(response.data, normalizedType);
    if (picked) return picked;
  }

  const typeIndexQueries = ["edit", "view"];
  for (const context of typeIndexQueries) {
    const response = await executeWordpressRestJsonRequest({
      siteRef,
      method: "GET",
      restPath: "/wp/v2/types",
      query: { context },
      authRequired
    });

    if (!response.ok || !response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
      continue;
    }

    const direct = response.data[normalizedType];
    const directPicked = pickWordpressCollectionSlugFromTypeRecord(direct, normalizedType);
    if (directPicked) return directPicked;

    for (const [typeKey, typeRecord] of Object.entries(response.data || {})) {
      const normalizedKey = normalizeWordpressCollectionSlug(typeKey);
      const normalizedRecordSlug = normalizeWordpressCollectionSlug(typeRecord?.slug || "");
      const normalizedRecordBase = normalizeWordpressCollectionSlug(typeRecord?.rest_base || "");
      const aliasFromKey = normalizeWordpressCollectionSlug(
        WORDPRESS_CORE_POST_TYPE_COLLECTION_ALIASES[normalizedKey] || ""
      );

      if (
        normalizedType === normalizedKey ||
        normalizedType === normalizedRecordSlug ||
        normalizedType === normalizedRecordBase ||
        normalizedType === aliasFromKey
      ) {
        const picked = pickWordpressCollectionSlugFromTypeRecord(typeRecord, normalizedType);
        if (picked) return picked;
      }
    }
  }

  return "";
}

export async function probeWordpressCollectionSlug({
  siteRef = {},
  collectionSlug = "",
  authRequired = false
}) {
  const normalizedCollection = normalizeWordpressCollectionSlug(collectionSlug);
  if (!normalizedCollection) return false;

  const response = await executeWordpressRestJsonRequest({
    siteRef,
    method: "GET",
    restPath: `/wp/v2/${encodeURIComponent(normalizedCollection)}`,
    query: {
      per_page: 1,
      page: 1
    },
    authRequired
  });

  if (response.ok) return true;
  if ([401, 403].includes(Number(response.status || 0))) return true;
  return false;
}

export async function resolveWordpressCollectionSlug({
  siteRef = {},
  postType = "",
  authRequired = false
}) {
  const normalizedType = normalizeWordpressCollectionSlug(postType);
  if (!normalizedType) return "";

  const cache = getWordpressCollectionResolverCache(siteRef);
  const cacheKey = `${normalizedType}|${authRequired ? "auth" : "anon"}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const candidateSlugs = [];
  const seen = new Set();
  const addCandidate = value => {
    const normalized = normalizeWordpressCollectionSlug(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidateSlugs.push(normalized);
  };

  const resolvedFromTypes = await resolveWordpressCollectionSlugFromTypesEndpoint({
    siteRef,
    postType: normalizedType,
    authRequired
  }).catch(() => "");
  addCandidate(resolvedFromTypes);

  addCandidate(WORDPRESS_CORE_POST_TYPE_COLLECTION_ALIASES[normalizedType] || "");
  addCandidate(normalizedType);

  for (const runtimeCandidate of extractWordpressCollectionSlugsFromRuntime(siteRef)) {
    addCandidate(runtimeCandidate);
  }

  for (const candidate of candidateSlugs) {
    const supported = await probeWordpressCollectionSlug({
      siteRef,
      collectionSlug: candidate,
      authRequired
    }).catch(() => false);
    if (supported) {
      cache[cacheKey] = candidate;
      return candidate;
    }
  }

  const fallback = candidateSlugs[0] || normalizedType;
  cache[cacheKey] = fallback;
  return fallback;
}

export async function executeWordpressRestJsonRequest({
  siteRef = {},
  method = "GET",
  restPath = "/",
  query = {},
  body,
  timeoutSeconds = 60,
  authRequired = false
}) {
  const siteUrl = String(siteRef?.base_url || "").trim();
  if (!siteUrl) {
    throw createHttpError(
      "wordpress_site_base_url_missing",
      "WordPress site base_url is required for connector execution.",
      409
    );
  }

  const auth = getWordpressSiteAuth(siteRef);
  if (authRequired && !auth) {
    throw createHttpError(
      "wordpress_auth_missing",
      "WordPress connector auth credentials are missing for this site.",
      409
    );
  }

  const url = buildWordpressRestUrl(siteUrl, restPath, query);
  const headers = {
    Accept: "application/json"
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (auth) {
    headers.Authorization = `Basic ${Buffer.from(
      `${auth.username}:${auth.applicationPassword}`,
      "utf8"
    ).toString("base64")}`;
  }

  const boundedTimeoutSeconds = Math.min(
    Number(timeoutSeconds || 60),
    MAX_TIMEOUT_SECONDS
  );

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    (Number.isFinite(boundedTimeoutSeconds) && boundedTimeoutSeconds > 0
      ? boundedTimeoutSeconds
      : 60) * 1000 + 5000
  );

  try {
    const response = await fetch(url, {
      method: String(method || "GET").toUpperCase(),
      headers,
      body:
        String(method || "GET").toUpperCase() === "GET" ||
        String(method || "GET").toUpperCase() === "DELETE"
          ? undefined
          : JSON.stringify(body ?? {}),
      signal: controller.signal
    });

    const raw = await response.text();
    let parsed = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { raw };
      }
    }

    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[String(key || "").toLowerCase()] = value;
    });

    return {
      ok: response.ok,
      status: response.status,
      data: parsed,
      headers: responseHeaders,
      url
    };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 502,
      data: {
        ok: false,
        error: {
          code: aborted ? "wordpress_connector_timeout" : "wordpress_connector_transport_error",
          message: err?.message || String(err)
        }
      },
      headers: {},
      url
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function listWordpressEntriesByType({ siteRef = {}, postType = "", collectionSlug = "" }) {
  const normalizedType = normalizeWordpressCollectionSlug(postType);
  if (!normalizedType) return [];
  const resolvedCollection =
    normalizeWordpressCollectionSlug(collectionSlug) ||
    await resolveWordpressCollectionSlug({
      siteRef,
      postType: normalizedType,
      authRequired: false
    });

  const collected = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await executeWordpressRestJsonRequest({
      siteRef,
      method: "GET",
      restPath: `/wp/v2/${encodeURIComponent(resolvedCollection)}`,
      query: {
        context: "edit",
        per_page: 50,
        page
      }
    });

    if (!response.ok) {
      throw createHttpError(
        "wordpress_source_read_failed",
        `Failed reading source entries for post type ${normalizedType} via collection ${resolvedCollection}.`,
        Number(response.status || 502),
        {
          post_type: normalizedType,
          post_type_collection: resolvedCollection,
          status_code: response.status,
          response: response.data
        }
      );
    }

    const rows = Array.isArray(response.data) ? response.data : [];
    collected.push(...rows);

    const headerTotalPages = Number(
      response.headers["x-wp-totalpages"] || response.headers["x-wp-total-pages"] || 1
    );
    totalPages =
      Number.isFinite(headerTotalPages) && headerTotalPages > 0
        ? headerTotalPages
        : 1;
    page += 1;
  } while (page <= totalPages);

  return collected;
}

export async function findWordpressDestinationEntryBySlug({
  siteRef = {},
  postType = "",
  slug = "",
  collectionSlug = ""
}) {
  const normalizedType = normalizeWordpressCollectionSlug(postType);
  const normalizedSlug = String(slug || "").trim();
  if (!normalizedType || !normalizedSlug) return null;
  const resolvedCollection =
    normalizeWordpressCollectionSlug(collectionSlug) ||
    await resolveWordpressCollectionSlug({
      siteRef,
      postType: normalizedType,
      authRequired: true
    });

  const response = await executeWordpressRestJsonRequest({
    siteRef,
    method: "GET",
    restPath: `/wp/v2/${encodeURIComponent(resolvedCollection)}`,
    query: {
      context: "edit",
      slug: normalizedSlug,
      per_page: 1
    },
    authRequired: true
  });

  if (!response.ok) {
    throw createHttpError(
      "wordpress_destination_lookup_failed",
      `Failed destination lookup for post type ${normalizedType} via collection ${resolvedCollection}.`,
      Number(response.status || 502),
      {
        post_type: normalizedType,
        post_type_collection: resolvedCollection,
        slug: normalizedSlug,
        status_code: response.status,
        response: response.data
      }
    );
  }
  const rows = Array.isArray(response.data) ? response.data : [];
  return rows.length ? rows[0] : null;
}

export async function updateWordpressDestinationEntryById({
  destinationSiteRef = {},
  collectionSlug = "",
  postType = "",
  destinationId = null,
  body = {},
  authRequired = true
}) {
  const numericDestinationId = Number(destinationId);
  if (!Number.isFinite(numericDestinationId) || numericDestinationId < 1) {
    throw createHttpError(
      "wordpress_destination_id_invalid",
      "Destination id must be a positive integer.",
      400,
      { destination_id: destinationId }
    );
  }

  const normalizedPostType = normalizeWordpressCollectionSlug(postType);
  const normalizedCollectionSlug = normalizeWordpressCollectionSlug(collectionSlug);
  const resolvedCollectionSlug =
    normalizedCollectionSlug ||
    await resolveWordpressCollectionSlug({
      siteRef: destinationSiteRef,
      postType: normalizedPostType || normalizedCollectionSlug,
      authRequired
    });

  if (!resolvedCollectionSlug) {
    throw createHttpError(
      "wordpress_collection_resolution_failed",
      "Unable to resolve destination collection slug for deferred reference repair.",
      409,
      { post_type: normalizedPostType, collection_slug: normalizedCollectionSlug }
    );
  }

  const response = await executeWordpressRestJsonRequest({
    siteRef: destinationSiteRef,
    method: "POST",
    restPath: `/wp/v2/${encodeURIComponent(resolvedCollectionSlug)}/${numericDestinationId}`,
    body,
    authRequired
  });

  if (!response.ok) {
    throw createHttpError(
      "wordpress_destination_update_failed",
      `Deferred destination update failed with status ${response.status}.`,
      Number(response.status || 502),
      {
        destination_id: numericDestinationId,
        collection_slug: resolvedCollectionSlug,
        response: response.data
      }
    );
  }

  return {
    id: Number(response?.data?.id) || numericDestinationId,
    status: String(response?.data?.status || "").trim()
  };
}

export async function getWordpressItemById({
  siteRef = {},
  collectionSlug = "",
  id = null,
  authRequired = true
}) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId < 1) {
    throw createHttpError(
      "wordpress_item_id_invalid",
      "WordPress item id must be a positive integer.",
      400,
      { id }
    );
  }

  const normalizedCollectionSlug = normalizeWordpressCollectionSlug(collectionSlug);
  if (!normalizedCollectionSlug) {
    throw createHttpError(
      "wordpress_collection_resolution_failed",
      "Unable to resolve collection slug for WordPress item readback.",
      409,
      { collection_slug: collectionSlug }
    );
  }

  const response = await executeWordpressRestJsonRequest({
    siteRef,
    method: "GET",
    restPath: `/wp/v2/${encodeURIComponent(normalizedCollectionSlug)}/${numericId}`,
    query: { context: "edit" },
    authRequired
  });

  if (!response.ok) {
    throw createHttpError(
      "wordpress_item_readback_failed",
      `WordPress item readback failed with status ${response.status}.`,
      Number(response.status || 502),
      {
        id: numericId,
        collection_slug: normalizedCollectionSlug,
        response: response.data
      }
    );
  }

  return response.data && typeof response.data === "object" ? response.data : {};
}

export function recordWordpressMutationWritebackEvidence(writebackPlan = {}, evidence = {}) {
  if (!writebackPlan || typeof writebackPlan !== "object") return;

  writebackPlan.readback_required = true;
  writebackPlan.mutation_execution = {
    ...evidence
  };
}

export function classifyWordpressExecutionStage(payload = {}) {
  const apply = payload?.migration?.apply === true;
  const publishStatus = String(payload?.migration?.publish_status || "draft")
    .trim()
    .toLowerCase();

  if (!apply) return "discovery";
  if (publishStatus === "draft") return "draft_publish";
  return "verification";
}

export function buildGovernedResolutionRecord(args = {}) {
  return {
    search_domain: "endpoint_registry_adapter",
    normalized_query: String(args.normalized_query || "").trim(),
    candidate_count: Number.isFinite(Number(args.candidate_count))
      ? Number(args.candidate_count)
      : 0,
    selected_candidate_id: String(args.selected_candidate_id || "").trim(),
    selected_candidate_key: String(args.selected_candidate_key || "").trim(),
    selection_confidence: String(args.selection_confidence || "high").trim(),
    selection_basis: String(args.selection_basis || "").trim(),
    rejected_candidate_summary: Array.isArray(args.rejected_candidate_summary)
      ? args.rejected_candidate_summary
      : [],
    fallback_used: !!args.fallback_used,
    governance_gate_results:
      args.governance_gate_results &&
      typeof args.governance_gate_results === "object" &&
      !Array.isArray(args.governance_gate_results)
        ? args.governance_gate_results
        : {}
  };
}

export function assertWordpressGovernedResolutionConfidence(record = {}, mutationIntended = false) {
  const confidence = String(record.selection_confidence || "").trim().toLowerCase();
  if (mutationIntended && confidence === "low") {
    const err = createHttpError(
      "low_confidence_resolution",
      "WordPress governed resolution blocked because selection confidence is low for a mutating execution.",
      409
    );
    err.governed_resolution_blocked = true;
    err.governed_resolution_block_reason = "low_confidence_resolution";
    err.governed_resolution_record = record;
    throw err;
  }
}

export function isTransientWordpressRetryableError(err = {}, retryPolicy = {}) {
  const status = Number(err?.status || err?.http_status || err?.statusCode);
  const code = String(err?.code || err?.error_code || "").trim();

  if (
    Number.isFinite(status) &&
    Array.isArray(retryPolicy.retry_on_statuses) &&
    retryPolicy.retry_on_statuses.includes(status)
  ) {
    return true;
  }

  if (
    code &&
    Array.isArray(retryPolicy.retry_on_codes) &&
    retryPolicy.retry_on_codes.includes(code)
  ) {
    return true;
  }

  return false;
}

export function buildWordpressRetryDelayMs(attemptNumber = 1, retryPolicy = {}) {
  const base = Math.max(0, Number(retryPolicy.base_delay_ms || 0));
  if (attemptNumber <= 1) return 0;
  return base * Math.pow(2, attemptNumber - 2);
}

export async function runWithWordpressSelectiveRetry(operation, retryPolicy = {}, meta = {}) {
  const attempts = [];
  const maxAttempts = Math.max(1, Number(retryPolicy.max_attempts || 1));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await operation();
      attempts.push({
        attempt,
        ok: true
      });

      return {
        ok: true,
        result,
        attempts,
        final_attempt: attempt,
        retry_used: attempt > 1,
        retry_domain: meta.retry_domain || ""
      };
    } catch (err) {
      const retryable =
        !!retryPolicy.retry_enabled &&
        attempt < maxAttempts &&
        isTransientWordpressRetryableError(err, retryPolicy);

      attempts.push({
        attempt,
        ok: false,
        retryable,
        code: err?.code || err?.error_code || "",
        status: Number(err?.status || err?.http_status || err?.statusCode) || null,
        message: err?.message || ""
      });

      if (!retryable) {
        err.wordpress_retry_attempts = attempts;
        err.wordpress_retry_exhausted = attempt >= maxAttempts;
        throw err;
      }

      const delayMs = buildWordpressRetryDelayMs(attempt, retryPolicy);
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  const err = new Error("WordPress selective retry exhausted.");
  err.code = "wordpress_retry_exhausted";
  err.wordpress_retry_attempts = attempts;
  err.wordpress_retry_exhausted = true;
  throw err;
}

export function isWordpressHierarchicalType(postType = "") {
  const normalized = normalizeWordpressPhaseAType(postType);
  return normalized === "page" || normalized === "category";
}

export function extractWordpressSourceReferenceMap(item = {}, postType = "") {
  const normalized = normalizeWordpressPhaseAType(postType);

  return {
    source_id: item?.id ?? null,
    source_slug: String(item?.slug || "").trim(),
    source_post_type: normalized,
    source_parent_id:
      isWordpressHierarchicalType(normalized) && Number.isFinite(Number(item?.parent))
        ? Number(item.parent)
        : null,
    source_category_ids:
      normalized === "post" && Array.isArray(item?.categories)
        ? item.categories.map(x => Number(x)).filter(Number.isFinite)
        : [],
    source_tag_ids:
      normalized === "post" && Array.isArray(item?.tags)
        ? item.tags.map(x => Number(x)).filter(Number.isFinite)
        : [],
    source_featured_media_id:
      (normalized === "post" || normalized === "page") &&
      Number.isFinite(Number(item?.featured_media))
        ? Number(item.featured_media)
        : null
  };
}

export function ensureWordpressPhaseAState(mutationPlan = {}) {
  if (!mutationPlan || typeof mutationPlan !== "object") {
    return {
      taxonomy_id_map: {
        category: {},
        tag: {}
      },
      hierarchical_id_map: {
        page: {},
        category: {}
      },
      deferred_parent_links: [],
      deferred_taxonomy_links: [],
      deferred_featured_media_links: [],
      processed_reference_maps: []
    };
  }

  if (
    !mutationPlan.wordpress_phase_a_state ||
    typeof mutationPlan.wordpress_phase_a_state !== "object" ||
    Array.isArray(mutationPlan.wordpress_phase_a_state)
  ) {
    mutationPlan.wordpress_phase_a_state = {};
  }

  const state = mutationPlan.wordpress_phase_a_state;

  if (!state.taxonomy_id_map || typeof state.taxonomy_id_map !== "object" || Array.isArray(state.taxonomy_id_map)) {
    state.taxonomy_id_map = {};
  }
  if (!state.taxonomy_id_map.category || typeof state.taxonomy_id_map.category !== "object" || Array.isArray(state.taxonomy_id_map.category)) {
    state.taxonomy_id_map.category = {};
  }
  if (!state.taxonomy_id_map.tag || typeof state.taxonomy_id_map.tag !== "object" || Array.isArray(state.taxonomy_id_map.tag)) {
    state.taxonomy_id_map.tag = {};
  }

  if (!state.hierarchical_id_map || typeof state.hierarchical_id_map !== "object" || Array.isArray(state.hierarchical_id_map)) {
    state.hierarchical_id_map = {};
  }
  if (!state.hierarchical_id_map.page || typeof state.hierarchical_id_map.page !== "object" || Array.isArray(state.hierarchical_id_map.page)) {
    state.hierarchical_id_map.page = {};
  }
  if (!state.hierarchical_id_map.category || typeof state.hierarchical_id_map.category !== "object" || Array.isArray(state.hierarchical_id_map.category)) {
    state.hierarchical_id_map.category = {};
  }

  if (!Array.isArray(state.deferred_parent_links)) {
    state.deferred_parent_links = [];
  }
  if (!Array.isArray(state.deferred_taxonomy_links)) {
    state.deferred_taxonomy_links = [];
  }
  if (!Array.isArray(state.deferred_featured_media_links)) {
    state.deferred_featured_media_links = [];
  }
  if (!Array.isArray(state.processed_reference_maps)) {
    state.processed_reference_maps = [];
  }

  return state;
}

export function rememberWordpressDestinationReference(state, args = {}) {
  const postType = normalizeWordpressPhaseAType(args.postType);
  const sourceId = Number(args.sourceId);
  const destinationId = Number(args.destinationId);

  if (!Number.isFinite(sourceId) || !Number.isFinite(destinationId)) return;

  if (postType === "category" || postType === "tag") {
    state.taxonomy_id_map[postType][String(sourceId)] = destinationId;
  }

  if (postType === "page" || postType === "category") {
    state.hierarchical_id_map[postType][String(sourceId)] = destinationId;
  }
}

export function buildDeferredWordpressReferencePlan(state, args = {}) {
  const postType = normalizeWordpressPhaseAType(args.postType);
  const item = args.item || {};
  const destinationId = Number(args.destinationId);
  const postTypeCollection = normalizeWordpressCollectionSlug(
    args.postTypeCollection || args.destinationCollectionSlug || args.postType
  );
  const destinationCollection = String(
    args.destinationCollectionSlug || args.postTypeCollection || postTypeCollection || ""
  ).trim();
  const refMap = extractWordpressSourceReferenceMap(item, postType);

  state.processed_reference_maps.push(refMap);

  if (Number.isFinite(destinationId) && Number.isFinite(refMap.source_id)) {
    rememberWordpressDestinationReference(state, {
      postType,
      sourceId: refMap.source_id,
      destinationId
    });
  }

  if (Number.isFinite(destinationId) && Number.isFinite(refMap.source_parent_id)) {
    state.deferred_parent_links.push({
      post_type: postType,
      post_type_collection: postTypeCollection,
      destination_id: destinationId,
      source_parent_id: refMap.source_parent_id
    });
  }

  if (postType === "post" && Number.isFinite(destinationId)) {
    state.deferred_taxonomy_links.push({
      post_type: postType,
      destination_collection: destinationCollection || postTypeCollection || "posts",
      post_type_collection: postTypeCollection || "posts",
      destination_id: destinationId,
      source_category_ids: refMap.source_category_ids,
      source_tag_ids: refMap.source_tag_ids
    });
  }

  if (
    (postType === "post" || postType === "page") &&
    Number.isFinite(destinationId) &&
    Number.isFinite(refMap.source_featured_media_id)
  ) {
    state.deferred_featured_media_links.push({
      post_type: postType,
      destination_collection:
        destinationCollection || postTypeCollection || normalizeWordpressCollectionSlug(postType),
      post_type_collection:
        postTypeCollection || normalizeWordpressCollectionSlug(postType),
      destination_id: destinationId,
      source_featured_media_id: refMap.source_featured_media_id
    });
  }
}

export function resolveDeferredWordpressParentId(state, postType = "", sourceParentId = null) {
  const normalized = normalizeWordpressPhaseAType(postType);
  if (!Number.isFinite(Number(sourceParentId))) return null;
  return state.hierarchical_id_map?.[normalized]?.[String(sourceParentId)] || null;
}

export function resolveDeferredWordpressTaxonomyIds(state, taxonomy = "", ids = []) {
  const normalized = normalizeWordpressPhaseAType(taxonomy);
  const map = state.taxonomy_id_map?.[normalized] || {};
  return ids
    .map(id => map[String(id)] || null)
    .filter(Number.isFinite);
}

export async function applyDeferredWordpressParentLinks(args = {}) {
  const {
    destinationSiteRef,
    state,
    destinationStatuses = []
  } = args;

  const repairs = [];

  for (const link of state.deferred_parent_links || []) {
    const resolvedParentId = resolveDeferredWordpressParentId(
      state,
      link.post_type,
      link.source_parent_id
    );

    if (!Number.isFinite(Number(resolvedParentId))) {
      repairs.push({
        destination_id: link.destination_id,
        post_type: link.post_type,
        post_type_collection:
          String(link.post_type_collection || "").trim() ||
          normalizeWordpressCollectionSlug(link.post_type || ""),
        repair_type: "parent_unresolved",
        source_parent_id: link.source_parent_id
      });
      continue;
    }

    await updateWordpressDestinationEntryById({
      destinationSiteRef,
      collectionSlug: link.post_type_collection || normalizeWordpressCollectionSlug(link.post_type),
      destinationId: link.destination_id,
      body: { parent: resolvedParentId },
      authRequired: true
    });

    repairs.push({
      destination_id: link.destination_id,
      post_type: link.post_type,
      post_type_collection:
        String(link.post_type_collection || "").trim() ||
        normalizeWordpressCollectionSlug(link.post_type || ""),
      repair_type: "parent_applied",
      source_parent_id: link.source_parent_id,
      resolved_parent_id: resolvedParentId
    });

    const statusRow = destinationStatuses.find(
      x => Number(x.id ?? x.destination_id) === Number(link.destination_id)
    );
    if (statusRow) {
      statusRow.parent_repair_applied = true;
      statusRow.parent_resolved_id = resolvedParentId;
    }
  }

  return repairs;
}

export async function applyDeferredWordpressTaxonomyLinks(args = {}) {
  const {
    destinationSiteRef,
    state,
    destinationStatuses = []
  } = args;

  const repairs = [];

  for (const link of state.deferred_taxonomy_links || []) {
    const resolvedCategories = resolveDeferredWordpressTaxonomyIds(
      state,
      "category",
      link.source_category_ids || []
    );
    const resolvedTags = resolveDeferredWordpressTaxonomyIds(
      state,
      "tag",
      link.source_tag_ids || []
    );

    const sourceCategories = Array.isArray(link.source_category_ids)
      ? link.source_category_ids.filter(Number.isFinite)
      : [];
    const sourceTags = Array.isArray(link.source_tag_ids)
      ? link.source_tag_ids.filter(Number.isFinite)
      : [];

    const categoryUnresolved = sourceCategories.length > 0 && resolvedCategories.length === 0;
    const tagUnresolved = sourceTags.length > 0 && resolvedTags.length === 0;

    if (categoryUnresolved || tagUnresolved) {
      repairs.push({
        destination_id: link.destination_id,
        post_type: link.post_type || "post",
        destination_collection:
          String(link.destination_collection || link.post_type_collection || "").trim() ||
          normalizeWordpressCollectionSlug(link.post_type || "post"),
        post_type_collection:
          String(link.post_type_collection || link.destination_collection || "").trim() ||
          normalizeWordpressCollectionSlug(link.post_type || "post"),
        repair_type: "taxonomy_unresolved",
        source_category_ids: sourceCategories,
        source_tag_ids: sourceTags,
        resolved_categories: resolvedCategories,
        resolved_tags: resolvedTags
      });

      const blockedStatusRow = destinationStatuses.find(
        x => Number(x.id ?? x.destination_id) === Number(link.destination_id)
      );
      if (blockedStatusRow) {
        blockedStatusRow.taxonomy_repair_applied = false;
        blockedStatusRow.taxonomy_repair_blocked = true;
        blockedStatusRow.taxonomy_repair_reason = "taxonomy_unresolved";
        blockedStatusRow.resolved_categories = resolvedCategories;
        blockedStatusRow.resolved_tags = resolvedTags;
      }
      continue;
    }

    await updateWordpressDestinationEntryById({
      destinationSiteRef,
      collectionSlug:
        String(link.destination_collection || link.post_type_collection || "").trim() ||
        normalizeWordpressCollectionSlug(link.post_type || "post"),
      destinationId: link.destination_id,
      body: {
        categories: resolvedCategories,
        tags: resolvedTags
      },
      authRequired: true
    });

    repairs.push({
      destination_id: link.destination_id,
      post_type: link.post_type || "post",
      destination_collection:
        String(link.destination_collection || link.post_type_collection || "").trim() ||
        normalizeWordpressCollectionSlug(link.post_type || "post"),
      post_type_collection:
        String(link.post_type_collection || link.destination_collection || "").trim() ||
        normalizeWordpressCollectionSlug(link.post_type || "post"),
      repair_type: "taxonomy_links_applied",
      resolved_categories: resolvedCategories,
      resolved_tags: resolvedTags
    });

    const statusRow = destinationStatuses.find(
      x => Number(x.id ?? x.destination_id) === Number(link.destination_id)
    );
    if (statusRow) {
      statusRow.taxonomy_repair_applied = true;
      statusRow.resolved_categories = resolvedCategories;
      statusRow.resolved_tags = resolvedTags;
    }
  }

  return repairs;
}

export async function applyDeferredWordpressFeaturedMediaLinks(args = {}) {
  const {
    destinationSiteRef,
    state,
    destinationStatuses = []
  } = args;
  void destinationSiteRef;

  const repairs = [];

  for (const link of state.deferred_featured_media_links || []) {
    repairs.push({
      destination_id: link.destination_id,
      post_type: link.post_type,
      repair_type: "featured_media_deferred_phase_later",
      source_featured_media_id: link.source_featured_media_id
    });

    const statusRow = destinationStatuses.find(
      x => Number(x.id ?? x.destination_id) === Number(link.destination_id)
    );
    if (statusRow) {
      statusRow.featured_media_repair_applied = false;
      statusRow.featured_media_deferred = true;
      statusRow.featured_media_repair_reason = "phase_a_media_not_enabled";
      statusRow.source_featured_media_id = link.source_featured_media_id;
    }
  }

  return repairs;
}

export async function verifyDeferredWordpressParentRepairs(args = {}) {
  const {
    destinationSiteRef,
    repairs = [],
    destinationStatuses = []
  } = args;

  const checks = [];
  const failures = [];

  for (const repair of repairs) {
    if (String(repair.repair_type || "").trim() !== "parent_applied") {
      continue;
    }

    const collectionSlug =
      String(repair.post_type_collection || "").trim() ||
      normalizeWordpressCollectionSlug(repair.post_type || "");

    try {
      const readback = await getWordpressItemById({
        siteRef: destinationSiteRef,
        collectionSlug,
        id: repair.destination_id,
        authRequired: true
      });

      const actualParent = Number(readback?.parent);
      const expectedParent = Number(repair.resolved_parent_id);
      const verified =
        Number.isFinite(actualParent) &&
        Number.isFinite(expectedParent) &&
        actualParent === expectedParent;

      checks.push({
        destination_id: repair.destination_id,
        post_type: repair.post_type,
        repair_type: repair.repair_type,
        expected_parent_id: expectedParent,
        actual_parent_id: Number.isFinite(actualParent) ? actualParent : null,
        verified
      });

      const statusRow = destinationStatuses.find(
        x => Number(x.id ?? x.destination_id) === Number(repair.destination_id)
      );
      if (statusRow) {
        statusRow.parent_readback_verified = verified;
        statusRow.parent_readback_expected = expectedParent;
        statusRow.parent_readback_actual = Number.isFinite(actualParent)
          ? actualParent
          : null;
      }

      if (!verified) {
        failures.push({
          destination_id: repair.destination_id,
          repair_domain: "parent",
          failure_reason: "parent_readback_mismatch",
          expected_parent_id: expectedParent,
          actual_parent_id: Number.isFinite(actualParent) ? actualParent : null
        });
      }
    } catch (err) {
      checks.push({
        destination_id: repair.destination_id,
        post_type: repair.post_type,
        repair_type: repair.repair_type,
        expected_parent_id: Number(repair.resolved_parent_id),
        actual_parent_id: null,
        verified: false,
        readback_error_code: err?.code || "wordpress_parent_readback_failed"
      });

      const statusRow = destinationStatuses.find(
        x => Number(x.id ?? x.destination_id) === Number(repair.destination_id)
      );
      if (statusRow) {
        statusRow.parent_readback_verified = false;
        statusRow.parent_readback_error_code =
          err?.code || "wordpress_parent_readback_failed";
      }

      failures.push({
        destination_id: repair.destination_id,
        repair_domain: "parent",
        failure_reason: err?.code || "wordpress_parent_readback_failed",
        message: err?.message || "WordPress parent repair readback failed."
      });
    }
  }

  return { checks, failures };
}

export async function verifyDeferredWordpressTaxonomyRepairs(args = {}) {
  const {
    destinationSiteRef,
    repairs = [],
    destinationStatuses = []
  } = args;

  const checks = [];
  const failures = [];

  for (const repair of repairs) {
    if (String(repair.repair_type || "").trim() !== "taxonomy_links_applied") {
      continue;
    }

    const collectionSlug =
      String(repair.destination_collection || repair.post_type_collection || "").trim() ||
      normalizeWordpressCollectionSlug(repair.post_type || "post");

    try {
      const readback = await getWordpressItemById({
        siteRef: destinationSiteRef,
        collectionSlug,
        id: repair.destination_id,
        authRequired: true
      });

      const actualCategories = Array.isArray(readback?.categories)
        ? readback.categories.map(x => Number(x)).filter(Number.isFinite).sort((a, b) => a - b)
        : [];
      const actualTags = Array.isArray(readback?.tags)
        ? readback.tags.map(x => Number(x)).filter(Number.isFinite).sort((a, b) => a - b)
        : [];

      const expectedCategories = Array.isArray(repair.resolved_categories)
        ? repair.resolved_categories.map(x => Number(x)).filter(Number.isFinite).sort((a, b) => a - b)
        : [];
      const expectedTags = Array.isArray(repair.resolved_tags)
        ? repair.resolved_tags.map(x => Number(x)).filter(Number.isFinite).sort((a, b) => a - b)
        : [];

      const verified =
        JSON.stringify(actualCategories) === JSON.stringify(expectedCategories) &&
        JSON.stringify(actualTags) === JSON.stringify(expectedTags);

      checks.push({
        destination_id: repair.destination_id,
        repair_type: repair.repair_type,
        expected_categories: expectedCategories,
        actual_categories: actualCategories,
        expected_tags: expectedTags,
        actual_tags: actualTags,
        verified
      });

      const statusRow = destinationStatuses.find(
        x => Number(x.id ?? x.destination_id) === Number(repair.destination_id)
      );
      if (statusRow) {
        statusRow.taxonomy_readback_verified = verified;
        statusRow.taxonomy_readback_expected_categories = expectedCategories;
        statusRow.taxonomy_readback_actual_categories = actualCategories;
        statusRow.taxonomy_readback_expected_tags = expectedTags;
        statusRow.taxonomy_readback_actual_tags = actualTags;
      }

      if (!verified) {
        failures.push({
          destination_id: repair.destination_id,
          repair_domain: "taxonomy",
          failure_reason: "taxonomy_readback_mismatch",
          expected_categories: expectedCategories,
          actual_categories: actualCategories,
          expected_tags: expectedTags,
          actual_tags: actualTags
        });
      }
    } catch (err) {
      checks.push({
        destination_id: repair.destination_id,
        repair_type: repair.repair_type,
        expected_categories: repair.resolved_categories || [],
        actual_categories: [],
        expected_tags: repair.resolved_tags || [],
        actual_tags: [],
        verified: false,
        readback_error_code: err?.code || "wordpress_taxonomy_readback_failed"
      });

      const statusRow = destinationStatuses.find(
        x => Number(x.id ?? x.destination_id) === Number(repair.destination_id)
      );
      if (statusRow) {
        statusRow.taxonomy_readback_verified = false;
        statusRow.taxonomy_readback_error_code =
          err?.code || "wordpress_taxonomy_readback_failed";
      }

      failures.push({
        destination_id: repair.destination_id,
        repair_domain: "taxonomy",
        failure_reason: err?.code || "wordpress_taxonomy_readback_failed",
        message: err?.message || "WordPress taxonomy repair readback failed."
      });
    }
  }

  return { checks, failures };
}

export async function runHybridWordpressMigration({ payload, wpContext, mutationPlan, writebackPlan }) {
  return {
    ok: true,
    transport: "hybrid_wordpress",
    message: "Hybrid WordPress migration plan prepared.",
    mutation_plan: mutationPlan,
    writeback_plan: writebackPlan,
    artifacts: buildSiteMigrationArtifacts(wpContext, payload, "hybrid_wordpress"),
    runtime_delta: {},
    settings_delta: {},
    plugin_delta: {}
  };
}

export async function validateSiteMigrationRouteWorkflowReadiness() {
  try {
    const validation = await ensureSiteMigrationRouteWorkflowRows();
    const missingRouteKeys = validation.missing_task_keys || [];
    const missingWorkflowIds = validation.missing_workflow_ids || [];

    return {
      ok:
        !!validation.task_routes_ready &&
        !!validation.workflow_registry_ready &&
        String(validation.outcome || "").trim() === "reuse_existing",
      mode: validation.mode || "validate_only",
      outcome: validation.outcome || "pending_validation",
      review: validation.review || null,
      task_routes_schema: validation.task_routes_schema || "surface_metadata_or_fallback",
      workflow_registry_schema: validation.workflow_registry_schema || "surface_metadata_or_fallback",
      active_route_keys: validation.executable_task_keys || [],
      active_workflow_keys: validation.executable_workflow_ids || [],
      missing_route_keys: missingRouteKeys,
      missing_workflow_keys: missingWorkflowIds,
      missing_task_keys: missingRouteKeys,
      missing_workflow_ids: missingWorkflowIds,
      unresolved_task_authority: validation.unresolved_task_authority || [],
      unresolved_workflow_authority: validation.unresolved_workflow_authority || [],
      chain_review_required: !!validation.chain_review_required,
      graph_review_required: !!validation.graph_review_required,
      bindings_review_required: !!validation.bindings_review_required,
      reconciliation_required: !!validation.reconciliation_required
    };
  } catch (err) {
    if (String(err?.code || "").trim() === "sheet_schema_mismatch") {
      return {
        ok: false,
        mode: "validate_only",
        outcome: "blocked_schema_mismatch",
        review: null,
        blocked: true,
        degraded: true,
        task_routes_schema: "surface_metadata_or_fallback",
        workflow_registry_schema: "surface_metadata_or_fallback",
        active_route_keys: [],
        active_workflow_keys: [],
        missing_route_keys: [],
        missing_workflow_keys: [],
        missing_task_keys: [],
        missing_workflow_ids: [],
        unresolved_task_authority: [],
        unresolved_workflow_authority: [],
        chain_review_required: false,
        graph_review_required: false,
        bindings_review_required: false,
        reconciliation_required: false,
        schema_validation_error: {
          code: String(err?.code || "sheet_schema_mismatch"),
          message: String(err?.message || "Sheet schema metadata validation failed."),
          details: err?.details || {}
        }
      };
    }
    throw err;
  }
}

export async function executeSiteMigrationJob(job) {
  const payload = normalizeSiteMigrationPayload(job.request_payload || {});
  const validation = validateSiteMigrationPayload(payload);
  if (!validation.ok) {
    return {
      success: false,
      statusCode: 400,
      payload: {
        ok: false,
        error: {
          code: "invalid_site_migration_request",
          message: "Invalid site migration payload.",
          details: { errors: validation.errors }
        }
      }
    };
  }

  try {
    const routeWorkflowReadiness = await validateSiteMigrationRouteWorkflowReadiness();
    if (!routeWorkflowReadiness.ok) {
      return {
        success: false,
        statusCode: 409,
        payload: {
          ok: false,
          error: {
            code: "site_migration_route_workflow_not_ready",
            message: "Required site migration route/workflow governed keys are missing or schema validation is degraded.",
            details: routeWorkflowReadiness
          }
        }
      };
    }

    const awareness = await resolveWordpressSiteAwarenessContext(payload);
    awareness.source.runtime = await resolveWordpressRuntimeInventory(payload, awareness.source);
    awareness.destination.runtime = await resolveWordpressRuntimeInventory(payload, awareness.destination);
    awareness.source.settings = await resolveWordpressSettingsInventory(payload, awareness.source);
    awareness.destination.settings = await resolveWordpressSettingsInventory(payload, awareness.destination);
    awareness.source.plugins = await resolveWordpressPluginInventory(payload, awareness.source);
    awareness.destination.plugins = await resolveWordpressPluginInventory(payload, awareness.destination);
    awareness.requested_plugin_keys = payload?.migration?.plugin_keys || [];

    awareness.capability_state = classifyWordpressCapabilityState(awareness);
    awareness.impact = classifyWordpressMigrationImpact(awareness, payload);

    const transport = resolveMigrationTransport(payload, awareness);
    if (transport === "unsupported") {
      return {
        success: false,
        statusCode: 409,
        payload: {
          ok: false,
          error: {
            code: "unsupported_migration_transport",
            message: "No safe migration transport could be resolved.",
            details: {
              blocking_reasons: awareness.capability_state.blocking_reasons,
              degraded_reasons: awareness.capability_state.degraded_reasons
            }
          }
        }
      };
    }

    awareness.transport = transport;
    const mutationPlan = buildWordpressMutationPlan(awareness, payload);
    const writebackPlan = buildRegistryDeltaWritebackPlan(awareness, awareness.impact);

    const runner = siteMigrationTransports[transport];
    if (!runner) {
      throw createHttpError(
        "missing_migration_runner",
        `Migration runner not found for ${transport}.`,
        500
      );
    }

    const runnerResult = await runner({
      job,
      payload,
      wpContext: awareness,
      mutationPlan,
      writebackPlan
    });

    const effectiveWritebackPlan =
      runnerResult &&
      typeof runnerResult === "object" &&
      runnerResult.writeback_plan &&
      typeof runnerResult.writeback_plan === "object"
        ? runnerResult.writeback_plan
        : writebackPlan;

    const readback = await verifyRegistryDeltaReadback({
      writeback_plan: effectiveWritebackPlan
    });

    return {
      success: true,
      statusCode: 200,
      payload: {
        ok: true,
        job_type: "site_migration",
        transport,
        source: payload.source,
        destination: payload.destination,
        capability_state: awareness.capability_state,
        impact: awareness.impact,
        mutation_plan: mutationPlan,
        writeback_plan: effectiveWritebackPlan,
        readback,
        result: runnerResult
      }
    };
  } catch (err) {
    return {
      success: false,
      statusCode: Number(err?.status || 500),
      payload: {
        ok: false,
        error: {
          code: String(err?.code || "site_migration_failed"),
          message: String(err?.message || "Site migration execution failed."),
          details: err?.details || {}
        }
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Missing symbols — moved from server.js to resolve ReferenceErrors in modules
// ---------------------------------------------------------------------------

export function normalizeWordpressPhaseAType(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

export const WORDPRESS_PHASE_A_ALLOWED_TYPES = new Set(["post", "page", "category", "tag"]);

export const WORDPRESS_PHASE_A_BLOCKED_TYPES = new Set([
  "attachment", "elementor_library", "wp_template", "wp_template_part",
  "wp_navigation", "popup", "global_widget", "acf-field-group", "acf-field",
  "wpforms", "fluentform", "contact-form-7", "seedprod", "mailpoet_page"
]);

export const WORDPRESS_PHASE_B_BUILDER_TYPES = new Set([
  "elementor_library", "wp_template", "wp_template_part", "wp_navigation",
  "popup", "global_widget", "reusable_block", "wp_block"
]);

export const WORDPRESS_PHASE_D_FORM_TYPES = new Set([
  "wpcf7_contact_form", "wpforms", "fluentform", "gf_form",
  "elementor_form", "formidable_form"
]);

export const WORDPRESS_MUTATION_PUBLISH_STATUSES = new Set([
  "draft", "publish", "pending", "private", "future"
]);

export function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function nowIsoSafe() {
  try { return new Date().toISOString(); } catch { return ""; }
}

export function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || "").trim()).filter(Boolean);
}

export function normalizeProviderDomain(providerDomain) {
  if (!providerDomain || typeof providerDomain !== "string") {
    const err = new Error("provider_domain is required.");
    err.code = "invalid_request"; err.status = 400; throw err;
  }
  let url;
  try { url = new URL(providerDomain); } catch {
    const err = new Error("provider_domain must be a valid absolute URL.");
    err.code = "invalid_request"; err.status = 400; throw err;
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    const err = new Error("provider_domain must use http or https.");
    err.code = "invalid_request"; err.status = 400; throw err;
  }
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function normalizeWordpressFormIntegrationSignals(signals = {}) {
  const s = signals && typeof signals === "object" && !Array.isArray(signals) ? signals : {};
  return {
    has_email_routing: s.has_email_routing === true,
    has_webhook: s.has_webhook === true,
    has_recaptcha: s.has_recaptcha === true,
    has_smtp_dependency: s.has_smtp_dependency === true,
    has_crm_integration: s.has_crm_integration === true,
    has_payment_integration: s.has_payment_integration === true,
    has_file_upload: s.has_file_upload === true,
    has_conditional_logic: s.has_conditional_logic === true
  };
}

export async function verifyWordpressRolledBackEntry(args = {}) {
  const readback = await getWordpressItemById({
    siteRef: args.destinationSiteRef,
    collectionSlug: String(args.collectionSlug || "").trim(),
    id: args.destinationId,
    authRequired: true
  });
  const actualStatus = String(readback?.status || "").trim().toLowerCase();
  return { verified: actualStatus === "draft", actual_status: actualStatus || "", readback };
}
