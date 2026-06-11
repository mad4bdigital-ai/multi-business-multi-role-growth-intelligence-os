import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { CANONICALS } from "../canonical-manifest.mjs";
import { getPool } from "./db.js";

const REQUIRED_CANONICAL_REFERENCES = Object.freeze([
  "AI_Agent_Knowledge_Guide.md",
  "system_bootstrap.md",
  "memory_schema.json",
  "direct_instructions_registry_patch.md",
  "module_loader.md",
  "prompt_router.md",
]);

function sha256Text(value = "") {
  return createHash("sha256").update(String(value)).digest("hex");
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactError(err) {
  return { code: err.code || "dynamic_activation_evidence_failed", message: err.message };
}

function parseJsonValue(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

async function safeRows(sql, params = []) {
  try {
    const [rows] = await getPool().query(sql, params);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (err) {
    return { ok: false, rows: [], error: compactError(err) };
  }
}

async function readTextFile(repoRoot, relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  const content = await fs.readFile(fullPath, "utf8");
  return {
    path: relativePath,
    exists: true,
    size_bytes: Buffer.byteLength(content, "utf8"),
    sha256: sha256Text(content),
    generated: content.startsWith("<!-- GENERATED FILE."),
    source_authority_pointer_present: content.includes("## Source Authority") || content.includes("#"),
  };
}

async function listMarkdownSourceFiles(repoRoot, sourceDir) {
  const dir = path.join(repoRoot, sourceDir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

async function inspectRequiredReference(repoRoot, relativePath) {
  try {
    const file = await readTextFile(repoRoot, relativePath);
    if (relativePath.endsWith(".json")) {
      const content = await fs.readFile(path.join(repoRoot, relativePath), "utf8");
      JSON.parse(content);
      return { ...file, json_valid: true, ok: true };
    }
    return { ...file, ok: file.size_bytes > 0 };
  } catch (err) {
    return {
      path: relativePath,
      exists: false,
      ok: false,
      error: compactError(err),
    };
  }
}

async function inspectCanonicalFamily(repoRoot, config) {
  const output = await inspectRequiredReference(repoRoot, config.output);
  let sourceFiles = [];
  let sourceError = null;
  try {
    sourceFiles = await listMarkdownSourceFiles(repoRoot, config.sourceDir);
  } catch (err) {
    sourceError = compactError(err);
  }

  const sourceCount = sourceFiles.length;
  const expectedFileCount = safeNumber(config.expectedFileCount);
  const indexCount = Array.isArray(config.index) ? config.index.length : 0;
  const indexReferences = new Set((config.index || []).map(([, file]) => file).filter(Boolean));
  const missingIndexSources = [...indexReferences].filter((file) => !sourceFiles.includes(file));
  const generatedMarkerOk = output.generated === true;
  const expectedCountOk = expectedFileCount > 0 ? sourceCount === expectedFileCount : sourceCount > 0;
  const indexCountOk = indexCount > 0 && indexCount === sourceCount;

  const ok = Boolean(
    output.ok &&
    generatedMarkerOk &&
    sourceCount > 0 &&
    expectedCountOk &&
    indexCountOk &&
    missingIndexSources.length === 0 &&
    !sourceError
  );

  return {
    output: config.output,
    source_dir: config.sourceDir,
    ok,
    output_exists: output.exists === true,
    output_sha256: output.sha256 || null,
    output_size_bytes: output.size_bytes || 0,
    generated_marker_ok: generatedMarkerOk,
    expected_file_count: expectedFileCount,
    source_file_count: sourceCount,
    index_count: indexCount,
    expected_count_ok: expectedCountOk,
    index_count_ok: indexCountOk,
    missing_index_sources: missingIndexSources,
    source_error: sourceError,
  };
}

export async function buildRepoCanonicalRuntimeEvidence(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const requiredReferences = await Promise.all(
    REQUIRED_CANONICAL_REFERENCES.map((relativePath) => inspectRequiredReference(repoRoot, relativePath))
  );
  const canonicalFamilies = await Promise.all(
    CANONICALS.map((config) => inspectCanonicalFamily(repoRoot, config))
  );

  const staleOrMissingReferences = requiredReferences.filter((item) => !item.ok);
  const staleOrMissingFamilies = canonicalFamilies.filter((item) => !item.ok);
  const sourceFileCount = canonicalFamilies.reduce((sum, item) => sum + safeNumber(item.source_file_count), 0);
  const staleOrMissingCount = staleOrMissingReferences.length + staleOrMissingFamilies.length;

  return {
    attempted: true,
    ok: staleOrMissingCount === 0,
    activation_layer: "repo_canonical_runtime_readback",
    evidence_source: "repo_filesystem_canonical_manifest_readback",
    source_authority: "repo_runtime_filesystem_and_canonical_manifest",
    required_reference_count: REQUIRED_CANONICAL_REFERENCES.length,
    checked_reference_count: requiredReferences.length,
    canonical_family_count: canonicalFamilies.length,
    generated_family_count: canonicalFamilies.filter((item) => item.generated_marker_ok).length,
    source_file_count: sourceFileCount,
    stale_or_missing_count: staleOrMissingCount,
    required_references: requiredReferences.map((item) => ({
      path: item.path,
      ok: item.ok,
      exists: item.exists,
      size_bytes: item.size_bytes || 0,
      sha256: item.sha256 || null,
      generated: item.generated === true,
      json_valid: item.json_valid === true || undefined,
      error: item.error || null,
    })),
    canonical_families: canonicalFamilies,
    reason_code: staleOrMissingCount === 0 ? null : "repo_canonical_evidence_stale_or_missing",
    secrets_included: false,
  };
}

export function buildDynamicToolCatalogEvidence({ platformAccess = null, authorizedAccess = null } = {}) {
  const platformDegradedSurfaceCount = Array.isArray(platformAccess?.degraded_surfaces)
    ? platformAccess.degraded_surfaces.length
    : 0;
  const authorizedDegradedSurfaceCount = Array.isArray(authorizedAccess?.degraded_surfaces)
    ? authorizedAccess.degraded_surfaces.length
    : 0;
  const platformOk = platformAccess?.ok === true || (Boolean(platformAccess) && platformDegradedSurfaceCount === 0);
  const authorizedOk = authorizedAccess?.readiness === "active" && authorizedDegradedSurfaceCount === 0;
  const registeredSurfaceCount = safeNumber(authorizedAccess?.counts?.registered_surfaces);
  const runtimeCallableActions = safeNumber(
    authorizedAccess?.counts?.runtime_actions || platformAccess?.counts?.actions?.runtime_callable
  );
  const adminToolCount = safeNumber(authorizedAccess?.counts?.admin_tools);
  const degradedSurfaceCount = safeNumber(authorizedDegradedSurfaceCount + platformDegradedSurfaceCount);
  const authGapCount = safeNumber((authorizedAccess?.auth_gaps || []).length);

  return {
    attempted: true,
    ok: Boolean(platformOk && authorizedOk && registeredSurfaceCount > 0 && runtimeCallableActions > 0 && degradedSurfaceCount === 0 && authGapCount === 0),
    activation_layer: "activation_dynamic_runtime_catalog",
    evidence_source: "activation_platform_access_and_dynamic_authorization_envelope",
    source_authority: "sql_runtime_registry_and_activation_authorized_surface_registry",
    platform_access_ready: Boolean(platformOk),
    authorized_access_ready: Boolean(authorizedOk),
    registered_surface_count: registeredSurfaceCount,
    runtime_callable_actions: runtimeCallableActions,
    admin_tool_count: adminToolCount,
    degraded_surface_count: degradedSurfaceCount,
    auth_gap_count: authGapCount,
    reason_code: degradedSurfaceCount > 0
      ? "dynamic_catalog_degraded_surfaces"
      : authGapCount > 0
        ? "dynamic_catalog_auth_gaps"
        : registeredSurfaceCount <= 0
          ? "dynamic_catalog_missing_registered_surfaces"
          : runtimeCallableActions <= 0
            ? "dynamic_catalog_missing_runtime_actions"
            : null,
    secrets_included: false,
  };
}

function normalizeProvider(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isAdminSubject(sessionContext = {}) {
  return Boolean(
    sessionContext?.subject?.is_admin === true ||
    sessionContext?.platform_access?.principal?.is_admin === true ||
    sessionContext?.platform_access?.access_scope === "platform_admin_all"
  );
}

function resolveActivationSubject(sessionContext = {}) {
  const subject = sessionContext?.subject || {};
  return {
    is_admin: isAdminSubject(sessionContext),
    tenant_id: subject.tenant_id || sessionContext?.platform_access?.principal?.tenant_id || null,
    user_id: subject.user_id || sessionContext?.platform_access?.principal?.user_id || null,
    auth_mode: sessionContext?.platform_access?.principal?.type || sessionContext?.platform_access?.principal?.auth_mode || null,
  };
}

function buildSystemMatch(tile, connectedSystems = []) {
  const provider = normalizeProvider(tile.provider_family);
  const connector = normalizeProvider(tile.connector_family);
  return connectedSystems.filter((system) => {
    const systemProvider = normalizeProvider(system.provider_family);
    const systemConnector = normalizeProvider(system.connector_family);
    return system.status === "active" && (
      systemProvider === provider ||
      systemConnector === connector ||
      (connector && systemProvider === connector) ||
      (provider && systemConnector === provider)
    );
  });
}

function buildSourceChain({ router, nativeSystems }) {
  const sourceOrder = parseJsonValue(router?.source_order_json, null) || [
    "platform_native_connection",
    "chatgpt_user_app",
    "manual_prompt",
  ];
  return sourceOrder.map((source) => {
    if (source === "platform_native_connection" || source === "platform_native_oauth" || source === "platform_managed_service_account") {
      return {
        source,
        status: nativeSystems.length > 0 ? "available" : "not_connected",
        evidence: nativeSystems.length > 0
          ? nativeSystems.map((system) => ({
              system_id: system.system_id,
              system_key: system.system_key,
              display_name: system.display_name,
              provider_family: system.provider_family,
              connector_family: system.connector_family,
              status: system.status,
              service_mode: system.service_mode,
              updated_at: system.updated_at,
            }))
          : [],
      };
    }
    if (source === "chatgpt_user_app") {
      return {
        source,
        status: "fallback_possible_user_account_app_check_required",
        evidence: [],
        limitation: "platform_cannot_assume_chatgpt_account_app_connection_without_runtime_tool_evidence",
      };
    }
    if (source === "manual_prompt") {
      return {
        source,
        status: "available_prompt_guided",
        evidence: [],
      };
    }
    return { source, status: "unknown_source", evidence: [] };
  });
}

function tileStatusFromChain(sourceChain = []) {
  if (sourceChain.some((source) => source.status === "available")) return "active";
  if (sourceChain.some((source) => String(source.status).startsWith("fallback_possible"))) return "fallback_available";
  if (sourceChain.some((source) => source.status === "available_prompt_guided")) return "manual_prompt_available";
  return "not_connected";
}

function buildTileCallbacks(callbacks = [], tileStatus) {
  return callbacks.map((callback) => ({
    callback_key: callback.callback_key,
    intent_key: callback.intent_key || null,
    runtime_action_key: callback.runtime_action_key || null,
    endpoint_selector: callback.endpoint_selector || null,
    safe_mode: callback.safe_mode,
    status: tileStatus === "active"
      ? "ready"
      : tileStatus === "fallback_available"
        ? "fallback_available"
        : tileStatus === "manual_prompt_available"
          ? "manual_prompt_available"
          : "requires_connection",
    allowed_sources: parseJsonValue(callback.allowed_sources_json, []),
    output_contract: parseJsonValue(callback.output_contract_json, {}),
    fallback_prompt_template_key: callback.fallback_prompt_template_key || null,
    freshness_sla_seconds: safeNumber(callback.freshness_sla_seconds),
  }));
}

async function loadOperationalDashboardRows(subject) {
  const tiles = await safeRows(
    `SELECT tile_key, provider_family, connector_family, scope_class, display_name, description, category,
            default_visibility, source_mode, status_callback_key, freshness_sla_seconds, priority_order, risk_level, status
       FROM activation_operational_tile_registry
      WHERE status = 'active'
      ORDER BY priority_order ASC, tile_key ASC`,
    []
  );
  const callbacks = await safeRows(
    `SELECT callback_key, tile_key, provider_family, connector_family, intent_key, runtime_action_key, endpoint_selector,
            safe_mode, allowed_sources_json, output_contract_json, fallback_prompt_template_key,
            freshness_sla_seconds, priority_order, status
       FROM activation_callback_registry
      WHERE status = 'active'
      ORDER BY priority_order ASC, callback_key ASC`,
    []
  );
  const routers = await safeRows(
    `SELECT provider_family, connector_family, capability_key, source_order_json, background_allowed_sources_json,
            conversation_allowed_sources_json, write_allowed_sources_json, fallback_policy_json, status
       FROM activation_auth_source_router
      WHERE status = 'active'`,
    []
  );

  const systemWhere = subject.is_admin
    ? "status <> 'archived'"
    : "tenant_id = ? AND status <> 'archived'";
  const systems = await safeRows(
    `SELECT system_id, tenant_id, system_key, display_name, provider_family, provider_domain, connector_family,
            auth_type, service_mode, status, updated_at
       FROM connected_systems
      WHERE ${systemWhere}
      ORDER BY FIELD(status, 'active', 'pending', 'error'), updated_at DESC
      LIMIT 200`,
    subject.is_admin ? [] : [subject.tenant_id || "__missing_tenant__"]
  );

  const platformBrand = subject.is_admin
    ? await safeRows(
        `SELECT id, brand_name, target_key, brand_domain, status, brand_core_ready, maturity,
                evolution_status, governance_readiness_status, runtime_scope_class,
                control_state_last_validated_at, updated_at
           FROM brands
          WHERE target_key = 'growth_intelligence_platform'
          LIMIT 1`,
        []
      )
    : { ok: true, rows: [] };

  return { tiles, callbacks, routers, systems, platformBrand };
}

export async function buildActivationOperationalDashboardEvidence({ sessionContext = null } = {}) {
  const subject = resolveActivationSubject(sessionContext || {});
  const rows = await loadOperationalDashboardRows(subject);
  const degradedSurfaces = [
    ["activation_operational_tile_registry", rows.tiles],
    ["activation_callback_registry", rows.callbacks],
    ["activation_auth_source_router", rows.routers],
    ["connected_systems", rows.systems],
    ["platform_owner_brand", rows.platformBrand],
  ]
    .filter(([, result]) => result?.ok === false)
    .map(([surface, result]) => ({ surface, error: result.error }));

  const callbacksByTile = new Map();
  for (const callback of rows.callbacks.rows) {
    const list = callbacksByTile.get(callback.tile_key) || [];
    list.push(callback);
    callbacksByTile.set(callback.tile_key, list);
  }

  const routerByProvider = new Map();
  for (const router of rows.routers.rows) {
    routerByProvider.set(`${normalizeProvider(router.provider_family)}:${normalizeProvider(router.connector_family || router.provider_family)}`, router);
    routerByProvider.set(`${normalizeProvider(router.provider_family)}:*`, router);
  }

  const tiles = rows.tiles.rows.map((tile) => {
    const nativeSystems = buildSystemMatch(tile, rows.systems.rows);
    const router = routerByProvider.get(`${normalizeProvider(tile.provider_family)}:${normalizeProvider(tile.connector_family || tile.provider_family)}`)
      || routerByProvider.get(`${normalizeProvider(tile.provider_family)}:*`)
      || null;
    const sourceChain = buildSourceChain({ router, nativeSystems });
    const status = tileStatusFromChain(sourceChain);
    const callbacks = buildTileCallbacks(callbacksByTile.get(tile.tile_key) || [], status);
    return {
      tile_key: tile.tile_key,
      display_name: tile.display_name,
      provider_family: tile.provider_family,
      connector_family: tile.connector_family,
      scope_class: tile.scope_class,
      category: tile.category,
      visibility: tile.default_visibility,
      status,
      source_mode: tile.source_mode,
      risk_level: tile.risk_level,
      freshness_sla_seconds: safeNumber(tile.freshness_sla_seconds),
      source_chain: sourceChain,
      callbacks,
      callback_count: callbacks.length,
      fallback_policy: parseJsonValue(router?.fallback_policy_json, {}),
    };
  });

  const callbackSummary = tiles.reduce((summary, tile) => {
    for (const callback of tile.callbacks) {
      summary[callback.status] = (summary[callback.status] || 0) + 1;
    }
    return summary;
  }, {});

  const platformBrand = rows.platformBrand.rows[0] || null;
  return {
    attempted: true,
    ok: degradedSurfaces.length === 0,
    activation_layer: "activation_operational_dashboard",
    awareness_mode: "adaptive_operational_dashboard",
    source_authority: "sql_runtime_registry_with_auth_source_router_and_connected_systems",
    subject: {
      is_admin: subject.is_admin,
      tenant_id: subject.tenant_id,
      user_id: subject.user_id,
      auth_mode: subject.auth_mode,
    },
    ownership_context: platformBrand ? {
      platform_owner_brand: {
        brand_name: platformBrand.brand_name,
        target_key: platformBrand.target_key,
        brand_domain: platformBrand.brand_domain,
        status: platformBrand.status,
        brand_core_ready: platformBrand.brand_core_ready,
        maturity: platformBrand.maturity,
        evolution_status: platformBrand.evolution_status,
        governance_readiness_status: platformBrand.governance_readiness_status,
        runtime_scope_class: platformBrand.runtime_scope_class,
        control_state_last_validated_at: platformBrand.control_state_last_validated_at,
        updated_at: platformBrand.updated_at,
      },
    } : null,
    summary: {
      registered_tiles: tiles.length,
      connected_systems_visible: rows.systems.rows.length,
      active_native_tiles: tiles.filter((tile) => tile.status === "active").length,
      fallback_available_tiles: tiles.filter((tile) => tile.status === "fallback_available").length,
      manual_prompt_tiles: tiles.filter((tile) => tile.status === "manual_prompt_available").length,
      not_connected_tiles: tiles.filter((tile) => tile.status === "not_connected").length,
      callback_summary: callbackSummary,
      degraded_surface_count: degradedSurfaces.length,
    },
    tiles,
    degraded_surfaces: degradedSurfaces,
    auth_model: {
      source_priority: [
        "platform_native_connection_or_oauth",
        "chatgpt_user_account_apps_and_integrations_when_runtime_tool_evidence_exists",
        "prompt_guided_manual_snapshot",
      ],
      platform_must_not_assume_chatgpt_apps_without_evidence: true,
      background_sync_requires_platform_native_connection: true,
      writeback_requires_governed_capability_and_user_confirmation: true,
    },
    secrets_included: false,
  };
}
