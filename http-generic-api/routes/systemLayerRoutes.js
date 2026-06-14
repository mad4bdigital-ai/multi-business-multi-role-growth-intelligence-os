import { Router } from "express";
import {
  ACTIVATION_BOOTSTRAP_CONFIG_SHEET,
  ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID,
  OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID,
} from "../config.js";
import { getPool } from "../db.js";
import { getGoogleClientsForSpreadsheet } from "../googleSheets.js";
import { runGovernedActivation } from "../governedActivationRunner.js";
import {
  ACTIVATION_GITHUB_BOOTSTRAP_CONFIG_KEY,
  resolveActivationBootstrapConfig,
  validateActivationBootstrapConfig,
} from "../activationBootstrapConfig.js";
import { getTenantGptOAuthClientConfigStatus, upsertTenantGptOAuthClientConfig } from "../tenantGptOAuthClientConfig.js";
import {
  listPlatformCredentialClientConfigs,
  PLATFORM_CREDENTIAL_CLIENT_TYPES,
  upsertPlatformCredentialClientConfig,
} from "../platformCredentialClientsConfig.js";
import {
  getGoogleAuthPlatformConfig,
  GOOGLE_AUTH_PLATFORM_TABS,
  upsertGoogleAuthPlatformConfig,
} from "../googleAuthPlatformConfig.js";
import { requireAdminPrincipal } from "./adminCliRoutes.js";
import { decodeGitHubAppPrivateKey, getGitHubAppInstallationToken, resolveGitHubAppConfig } from "../githubAppAuth.js";
import { derivePrincipalExecutionContext } from "../executionControlResolvers.js";
import { fetchToolsForCaller, dispatchToolForCaller, maybeChunkToolResponseBody, readCachedToolResponseChunk, paginateItems } from "./gptToolsRoutes.js";
import {
  PLATFORM_RESOURCE_RECIPE_SYSTEM_TOOLS,
  catalogGovernedResources,
  planGovernedResource,
  resolveGovernedResource,
  runGovernedResource,
} from "../platformResourceRecipeCapability.js";
import {
  TENANT_REPOSITORY_INTELLIGENCE_V2_SYSTEM_TOOLS,
  createRepositoryAuthorityBinding,
  listRepositoryAuthorityBindings,
  revokeRepositoryAuthorityBinding,
  tenantRepositoryActionPlannerDryRun,
  tenantRepositoryIntelligenceReport,
  tenantRepositoryIntelligenceV2ReadinessSmoke,
  tenantRepositoryIntelligenceV3V4ReadinessSmoke,
  tenantRepositoryPrReconciliationSweep,
} from "../repositoryTenantIntelligenceV2.js";
import * as RepositoryTenantIntelligenceV2Runtime from "../repositoryTenantIntelligenceV2.js";
import {
  TENANT_REPOSITORY_ADVISORY_COMMENT_V5_SYSTEM_TOOLS,
  tenantRepositoryAdvisoryCommentApply,
  tenantRepositoryAdvisoryCommentPreview,
  tenantRepositoryAdvisoryCommentReadback,
  tenantRepositoryAdvisoryCommentV5ReadinessSmoke,
} from "../repositoryTenantAdvisoryCommentsV5.js";
import * as RepositoryTenantAdvisoryCommentV5Runtime from "../repositoryTenantAdvisoryCommentsV5.js";
import { writeResourceRecipeApplyEvidence } from "../resourceRecipeApplyEvidence.js";

const SYSTEM_LAYER_TOOLS = [
  {
    name: "runtime_endpoint_preview",
    description: "Passive dry-run resolver for a governed endpoint. Resolves action, endpoint, schema, provider URL, credentials, risk, and readiness without calling the provider.",
    inputSchema: {
      type: "object",
      properties: {
        parent_action_key: { type: "string" },
        endpoint_key: { type: "string" },
        path_params: { type: "object", additionalProperties: true },
        query: { type: "object", additionalProperties: true },
        body: { type: "object", additionalProperties: true },
        headers: { type: "object", additionalProperties: true },
        credential_scope: { type: "string", enum: ["platform", "tenant", "user", "connection", "auto"] },
        connection_id: { type: "string" },
        app_key: { type: "string" },
        auth_type: { type: "string" },
        auth_context: { type: "object", additionalProperties: true },
      },
      required: ["parent_action_key", "endpoint_key"],
    },
  },
  {
    name: "runtime_endpoint_call",
    description: "Kernel dispatcher for governed runtime endpoint execution. Resolves parent_action_key/endpoint_key through registry authority, preserves brand target fields, applies principal context, and delegates provider execution to the runtime facade.",
    inputSchema: {
      type: "object",
      properties: {
        parent_action_key: { type: "string" },
        endpoint_key: { type: "string" },
        target_key: { type: "string" },
        brand_key: { type: "string" },
        brand_domain: { type: "string" },
        path_params: { type: "object", additionalProperties: true },
        query: { type: "object", additionalProperties: true },
        body: { type: "object", additionalProperties: true },
        headers: { type: "object", additionalProperties: true },
        credential_scope: { type: "string", enum: ["platform", "tenant", "user", "connection", "auto"] },
        connection_id: { type: "string" },
        app_key: { type: "string" },
        auth_type: { type: "string" },
        auth_context: { type: "object", additionalProperties: true },
        mutation_approval: { type: "object", additionalProperties: true },
        dry_run: { type: "boolean" },
        preflight_only: { type: "boolean" },
        dry_run_preflight_completed: { type: "boolean" },
        approved_preflight_dry_run_validated: { type: "boolean" },
        live_execution_approved: { type: "boolean" },
        readback: { type: "object", additionalProperties: true },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 120 },
      },
      required: ["parent_action_key", "endpoint_key"],
    },
  },
  {
    name: "response_chunk_read",
    description: "Read the next chunk of a cached oversized governed tool response. Use this whenever a system/admin/device/tool response returns response_chunked=true or page.has_more=true before switching to any fallback surface. Supports dynamic TTL via response_options.chunk_ttl_ms or response_options.chunk_ttl_minutes and extends cache retention after each successful read.",
    inputSchema: {
      type: "object",
      properties: {
        chunk_id: { type: "string" },
        cursor: { type: "integer", minimum: 0, default: 0 },
        max_chars: { type: "integer", minimum: 5000, maximum: 150000, default: 30000 },
        chunk_ttl_ms: { type: "integer", minimum: 300000, maximum: 7200000 },
        chunk_ttl_minutes: { type: "integer", minimum: 5, maximum: 120 },
      },
      required: ["chunk_id"],
    },
  },
  {
    name: "google_drive_endpoint_catalog",
    description: "Admin-only read-only catalog for Google Drive endpoint registry rows. Supports filtering by operation, method, readiness, and search text so large Drive operation surfaces are discoverable without raw SQL.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        parent_action_key: { type: "string", default: "google_drive_api" },
        search: { type: "string" },
        method: { type: "string" },
        status: { type: "string" },
        execution_readiness: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
      },
      required: [],
    },
  },
  {
    name: "google_drive_folder_inspect",
    description: "Admin-only read-only Google Drive folder inspector. Lists folder metadata and direct children through runtime_endpoint_call using governed Drive endpoint registry, supports Shared Drives, and never returns file content or secrets.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        folder_id: { type: "string" },
        folder_url: { type: "string" },
        recursive: { type: "boolean", default: false },
        max_depth: { type: "integer", minimum: 0, maximum: 3, default: 1 },
        page_size: { type: "integer", minimum: 1, maximum: 200, default: 100 },
        credential_scope: { type: "string", enum: ["platform", "tenant", "user", "connection", "auto"], default: "platform" },
        connection_id: { type: "string" },
        tenant_id: { type: "string" },
        user_id: { type: "string" },
        allow_platform_fallback: { type: "boolean", default: true },
      },
      required: [],
    },
  },
  ...PLATFORM_RESOURCE_RECIPE_SYSTEM_TOOLS,
  // Descriptor-loaded Repository Intelligence system tools. New descriptor sources should
  // be added to SYSTEM_LAYER_DESCRIPTOR_SOURCES below; list + dispatch wiring remains automatic.
  ...TENANT_REPOSITORY_INTELLIGENCE_V2_SYSTEM_TOOLS,
  ...TENANT_REPOSITORY_ADVISORY_COMMENT_V5_SYSTEM_TOOLS,
  {
    name: "system_layer_descriptor_readiness",
    description: "Admin-only read-only diagnostic for descriptor-backed system-layer tool sources. Verifies every descriptor has a runtime handler and no secrets are included.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "system_layer_descriptor_callability_audit",
    description: "Admin-only fail-closed callability audit for all descriptor-backed system-layer sources. Verifies handlers and executes each source's governed no-secret readiness smoke through the public descriptor dispatcher without unauthorized mutations.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "connector_registry_list",
    description: "List connector systems from the connected_systems registry.",
    inputSchema: {
      type: "object",
      properties: {
        tenant_id: { type: "string" },
        status: { type: "string", enum: ["active", "pending", "error", "archived"] },
        connector_family: { type: "string" },
        provider_family: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: [],
    },
  },
  {
    name: "connector_registry_get",
    description: "Read one connector system, including its installation and grant summary.",
    inputSchema: {
      type: "object",
      properties: {
        system_id: { type: "string" },
      },
      required: ["system_id"],
    },
  },
  {
    name: "activation_drive_probe",
    description: "Admin-only Drive provider-connectivity diagnostic. Proves Google auth and Drive API are reachable; does NOT load registry data — SQL is the runtime authority. Use for same-cycle activation evidence or break-glass recovery.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "activation_bootstrap_config_read",
    description: "Admin-only DB-native read of the Activation Bootstrap Config from backend runtime authority. Does not call Google Sheets; returns source=backend_runtime/db_runtime and sheets_required=false.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "activation_sheets_bootstrap_read",
    description: "Deprecated compatibility alias for activation_bootstrap_config_read. Google Sheets is no longer a valid bootstrap source and is not called; use the DB-native bootstrap config read instead.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "activation_github_validate",
    description: "Admin-only GitHub validation using bootstrap-resolved repository binding (read from SQL via /activation/bootstrap-config).",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        github_owner: { type: "string" },
        github_repo: { type: "string" },
        github_branch: { type: "string", default: "main" },
      },
      required: [],
    },
  },
  {
    name: "activation_provider_bootstrap_validate",
    description: "Admin-only same-cycle Drive, DB bootstrap config, and GitHub validation chain. Google Sheets is deprecated and not called; SQL/backend runtime is the bootstrap authority.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "github_app_key_diagnostics",
    description: "Admin-only: returns the key-shape diagnostic of GITHUB_APP_PRIVATE_KEY without signing. Safe to call when activation_github_validate fails with invalid_private_key.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "activation_bootstrap_config_upsert",
    description: "Admin-only DB runtime bootstrap upsert for GitHub activation binding; avoids Cloud Run env mutation.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        github_parent_action_key: { type: "string", default: "github_api_mcp" },
        github_endpoint_key: { type: "string", default: "github_get_repository" },
        github_owner: { type: "string" },
        github_repo: { type: "string" },
        github_branch: { type: "string", default: "main" },
        note: { type: "string" },
      },
      required: ["github_parent_action_key", "github_endpoint_key", "github_owner", "github_repo"],
    },
  },
  {
    name: "tenant_gpt_oauth_client_status",
    description: "Read-only status for the Tenant GPT OAuth client secret reference. Never returns the secret value.",
    requires_admin: true,
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "tenant_gpt_oauth_client_upsert",
    description: "Admin-only upsert that stores the default Custom GPT Tenant OAuth client secret in platform_secrets and keeps only client_secret_ref in runtime config.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        client_id: { type: "string", default: "mad4b-tenant-gpt" },
        client_secret: { type: "string", description: "Optional explicit secret. If omitted, one is generated or the current one is retained." },
        client_secret_ref: { type: "string", default: "platform_secret:TENANT_GPT_OAUTH_CLIENT_SECRET", description: "Governed platform secret reference. Inline runtime-config secret storage is not written." },
        callback_urls_to_allow: { type: "array", items: { type: "string" } },
        rotate: { type: "boolean", default: false },
        note: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "credential_client_config_upsert",
    description: "Admin-only DB source-of-truth upsert for platform-controlled credential clients: API key, OAuth client, or service account.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        owner_type: { type: "string", enum: ["platform", "tenant"], default: "platform" },
        tenant_id: { type: "string" },
        channel_key: { type: "string", default: "custom_gpt" },
        credential_type: { type: "string", enum: PLATFORM_CREDENTIAL_CLIENT_TYPES },
        client_key: { type: "string" },
        display_name: { type: "string" },
        provider: { type: "string", default: "google" },
        project_id: { type: "string" },
        client_type: { type: "string", enum: ["web", "desktop", "android", "ios", "chrome_app", "tv_limited_input"] },
        client_id: { type: "string" },
        client_secret_ref: { type: "string" },
        client_secret_hint: { type: "string" },
        client_secret_status: { type: "string", default: "enabled" },
        authorized_javascript_origins: { type: "array", items: { type: "string" } },
        redirect_uris: { type: "array", items: { type: "string" } },
        scopes: { type: "array", items: { type: "string" } },
        key_secret_ref: { type: "string" },
        key_hint: { type: "string" },
        allowed_apis: { type: "array", items: { type: "string" } },
        api_restrictions: { type: "array", items: { type: "string" } },
        application_restrictions: { type: "object" },
        restrictions: { type: "object" },
        bound_service_account_ref: { type: "string" },
        service_account_email: { type: "string" },
        service_account_unique_id: { type: "string" },
        roles: { type: "array", items: { type: "string" } },
        note: { type: "string" },
      },
      required: ["credential_type"],
    },
  },
  {
    name: "credential_client_config_list",
    description: "Admin-only list of platform-controlled credential client configs stored in DB.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        owner_type: { type: "string", enum: ["platform", "tenant"] },
        tenant_id: { type: "string" },
        channel_key: { type: "string" },
        credential_type: { type: "string", enum: PLATFORM_CREDENTIAL_CLIENT_TYPES },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: [],
    },
  },
  {
    name: "google_auth_platform_config_upsert",
    description: "Admin-only DB source-of-truth upsert for simulated Google Auth Platform and APIs & Services tab state.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        owner_type: { type: "string", enum: ["platform", "tenant"], default: "platform" },
        tenant_id: { type: "string" },
        project_key: { type: "string", default: "growth-intelligence-os" },
        project_id: { type: "string" },
        project_display_name: { type: "string" },
        tab: { type: "string", enum: GOOGLE_AUTH_PLATFORM_TABS },
        path: { type: "string" },
        state: { type: "object" },
        note: { type: "string" },
      },
      required: ["tab"],
    },
  },
  {
    name: "google_auth_platform_config_get",
    description: "Admin-only read of simulated Google Auth Platform and APIs & Services tab state.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {
        owner_type: { type: "string", enum: ["platform", "tenant"], default: "platform" },
        tenant_id: { type: "string" },
        project_key: { type: "string", default: "growth-intelligence-os" },
        project_id: { type: "string" },
        tab: { type: "string", enum: GOOGLE_AUTH_PLATFORM_TABS },
      },
      required: [],
    },
  },
];

const VALID_STATUSES = new Set(["active", "pending", "error", "archived"]);
const ADMIN_ONLY_SYSTEM_TOOLS = new Set(
  SYSTEM_LAYER_TOOLS.filter((tool) => tool.requires_admin === true).map((tool) => tool.name)
);
const LOCAL_SYSTEM_TOOL_NAMES = new Set(SYSTEM_LAYER_TOOLS.map((tool) => tool.name));

const SYSTEM_LAYER_DESCRIPTOR_SOURCES = [
  {
    source_key: "repository_tenant_intelligence_v2",
    tools: TENANT_REPOSITORY_INTELLIGENCE_V2_SYSTEM_TOOLS,
    handlers: RepositoryTenantIntelligenceV2Runtime,
    readiness_tool: "tenant_repository_intelligence_v2_readiness_smoke",
    readiness_args: { limit: 1 },
  },
  {
    source_key: "repository_tenant_advisory_comment_v5",
    tools: TENANT_REPOSITORY_ADVISORY_COMMENT_V5_SYSTEM_TOOLS,
    handlers: RepositoryTenantAdvisoryCommentV5Runtime,
    readiness_tool: "tenant_repository_advisory_comment_v5_readiness_smoke",
    readiness_args: { limit: 1 },
  },
];

function snakeToolNameToCamelHandlerName(name = "") {
  return String(name || "").replace(/_([a-z0-9])/g, (_, ch) => String(ch).toUpperCase());
}

function descriptorHandlerName(tool = {}) {
  return String(
    tool.handler
    || tool.handler_name
    || tool.runtime_handler
    || tool.x_system_handler
    || snakeToolNameToCamelHandlerName(tool.name)
    || ""
  ).trim();
}

function descriptorHandlerRegistry() {
  const registry = new Map();
  for (const source of SYSTEM_LAYER_DESCRIPTOR_SOURCES) {
    const tools = Array.isArray(source.tools) ? source.tools : [];
    for (const tool of tools) {
      if (!tool?.name) continue;
      const handlerName = descriptorHandlerName(tool);
      const handler = source.handlers?.[handlerName];
      registry.set(tool.name, {
        source_key: source.source_key,
        tool,
        handler_name: handlerName,
        handler: typeof handler === "function" ? handler : null,
      });
    }
  }
  return registry;
}

const SYSTEM_LAYER_DESCRIPTOR_HANDLER_REGISTRY = descriptorHandlerRegistry();

async function callDescriptorSystemToolIfAvailable(name, args = {}, auth = null, deps = {}) {
  const entry = SYSTEM_LAYER_DESCRIPTOR_HANDLER_REGISTRY.get(name);
  if (!entry) return { handled: false };
  if (typeof entry.handler !== "function") {
    const err = new Error(`System-layer descriptor tool ${name} does not have a runtime handler ${entry.handler_name}.`);
    err.status = 500;
    err.code = "system_layer_descriptor_handler_missing";
    err.details = { tool_name: name, source_key: entry.source_key, handler_name: entry.handler_name };
    throw err;
  }
  const dispatchSystemTool = async (toolName, toolArgs = {}, toolAuth = auth) => {
    const child = await callDescriptorSystemToolIfAvailable(toolName, toolArgs, toolAuth, deps);
    if (!child.handled) {
      const err = new Error(`System-layer descriptor tool ${toolName} is not registered.`);
      err.status = 404;
      err.code = "system_layer_descriptor_tool_not_registered";
      throw err;
    }
    return child.result;
  };
  const result = await entry.handler(args, {
    auth,
    runGovernedResource,
    req: deps.req,
    executionFacade: deps.executionFacade,
    dispatchSystemTool,
    descriptorReadiness: systemLayerDescriptorReadiness,
  });
  return { handled: true, result };
}

function systemLayerDescriptorReadiness() {
  return [...SYSTEM_LAYER_DESCRIPTOR_HANDLER_REGISTRY.entries()].map(([tool_name, entry]) => ({
    tool_name,
    source_key: entry.source_key,
    handler_name: entry.handler_name,
    handler_present: typeof entry.handler === "function",
    requires_admin: entry.tool?.requires_admin === true,
    secrets_included: false,
  }));
}

export async function runRepositoryIntelligenceV2DescriptorReadinessSmoke(args = {}) {
  const auth = {
    is_admin: true,
    user_id: "system:release_readiness",
    tenant_id: null,
  };
  const dispatched = await callDescriptorSystemToolIfAvailable(
    "tenant_repository_intelligence_v2_readiness_smoke",
    { limit: 1, ...args },
    auth,
    {}
  );
  if (!dispatched.handled) {
    const err = new Error("Repository Intelligence V2 readiness descriptor is not registered.");
    err.status = 500;
    err.code = "repository_intelligence_v2_readiness_descriptor_missing";
    throw err;
  }
  return dispatched.result;
}

export async function runSystemLayerDescriptorCallabilityAudit() {
  const auth = {
    is_admin: true,
    user_id: "system:descriptor_callability_audit",
    tenant_id: null,
  };
  const readiness = systemLayerDescriptorReadiness();
  const missingHandlers = readiness.filter((row) => row.handler_present !== true);
  const sourceResults = [];

  for (const source of SYSTEM_LAYER_DESCRIPTOR_SOURCES) {
    const sourceRows = readiness.filter((row) => row.source_key === source.source_key);
    const missingSourceHandlers = sourceRows.filter((row) => row.handler_present !== true);
    let smoke = null;
    let error = null;
    if (!source.readiness_tool) {
      error = {
        code: "descriptor_source_readiness_tool_missing",
        message: `Descriptor source ${source.source_key} does not declare a readiness tool.`,
      };
    } else if (!missingSourceHandlers.length) {
      try {
        const dispatched = await callDescriptorSystemToolIfAvailable(
          source.readiness_tool,
          source.readiness_args || {},
          auth,
          {}
        );
        smoke = dispatched.handled ? dispatched.result : null;
        if (!dispatched.handled) {
          error = {
            code: "descriptor_source_readiness_tool_not_registered",
            message: `Readiness tool ${source.readiness_tool} is not registered.`,
          };
        }
      } catch (err) {
        error = {
          code: err?.code || "descriptor_source_readiness_smoke_failed",
          message: err?.message || "Descriptor source readiness smoke failed.",
        };
      }
    }

    const smokePass = smoke?.ok === true && smoke?.status === "pass";
    sourceResults.push({
      source_key: source.source_key,
      descriptor_tool_count: sourceRows.length,
      missing_handler_count: missingSourceHandlers.length,
      readiness_tool: source.readiness_tool || null,
      readiness_status: error ? "fail" : (smokePass ? "pass" : "fail"),
      readiness_classification: smoke?.classification || null,
      checks: Array.isArray(smoke?.checks) ? smoke.checks : [],
      error,
      apply_allowed: false,
      mutations_executed: false,
      secrets_included: false,
    });
  }

  const failedSources = sourceResults.filter((row) => row.readiness_status !== "pass");
  const pass = missingHandlers.length === 0 && failedSources.length === 0;
  return {
    ok: pass,
    tool: "system_layer_descriptor_callability_audit",
    status: pass ? "pass" : "fail",
    classification: pass
      ? "system_layer_descriptor_callability_ready"
      : "system_layer_descriptor_callability_blocked",
    descriptor_source_count: SYSTEM_LAYER_DESCRIPTOR_SOURCES.length,
    descriptor_tool_count: readiness.length,
    missing_handler_count: missingHandlers.length,
    failed_source_count: failedSources.length,
    sources: sourceResults,
    handlers: readiness,
    apply_allowed: false,
    mutations_executed: false,
    secrets_included: false,
  };
}

function safeParseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function platformEndpointToolScopeClassesForPrincipal(auth) {
  return isAdminPrincipal(auth) ? ["admin", "both"] : ["tenant", "both"];
}

function platformEndpointToolTenantClauseForPrincipal(auth, tableAlias = "x") {
  if (isAdminPrincipal(auth)) return { sql: "", params: [] };

  const tenantId = principalTenantId(auth);
  if (!tenantId) return { sql: `AND ${tableAlias}.tenant_id IS NULL`, params: [] };

  return { sql: `AND (${tableAlias}.tenant_id IS NULL OR ${tableAlias}.tenant_id = ?)`, params: [tenantId] };
}

function normalizePlatformEndpointInputSchema(schemaJson) {
  const schema = safeParseJsonObject(schemaJson, { type: "object", properties: {}, required: [] });

  if (schema?.requestBody?.type) {
    return {
      type: "object",
      properties: {
        path_params: { type: "object", additionalProperties: true },
        query: { type: "object", additionalProperties: true },
        body: schema.requestBody,
        headers: { type: "object", additionalProperties: true },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 120 },
        readback: { type: "object", additionalProperties: true },
      },
      required: [],
    };
  }

  if (schema?.parameters) {
    return {
      type: "object",
      properties: {
        path_params: {
          type: "object",
          properties: schema.parameters.path || {},
          additionalProperties: true,
        },
        query: {
          type: "object",
          properties: schema.parameters.query || {},
          additionalProperties: true,
        },
        body: schema.requestBody || { type: "object", additionalProperties: true },
        headers: { type: "object", additionalProperties: true },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 120 },
        readback: { type: "object", additionalProperties: true },
      },
      required: [],
    };
  }

  return schema;
}

async function listPlatformEndpointToolsForPrincipal(auth, existingNames = new Set()) {
  try {
    const scopeClasses = platformEndpointToolScopeClassesForPrincipal(auth);
    const tenantClause = platformEndpointToolTenantClauseForPrincipal(auth, "x");
    const [rows] = await getPool().query(
      `SELECT x.tool_name,
              x.parent_action_key,
              x.endpoint_key,
              x.scope_class,
              x.input_schema_json,
              e.method
         FROM platform_endpoint_tool_exports x
         LEFT JOIN endpoints e
           ON e.parent_action_key = x.parent_action_key
          AND e.endpoint_key = x.endpoint_key
          AND e.status = 'active'
        WHERE x.status = 'active'
          AND x.scope_class IN (?, ?)
          ${tenantClause.sql}
        ORDER BY x.tool_name`,
      [...scopeClasses, ...tenantClause.params]
    );

    return rows
      .filter((row) => row?.tool_name && !existingNames.has(row.tool_name))
      .map((row) => ({
        name: row.tool_name,
        description: `Registry endpoint tool ${row.parent_action_key}/${row.endpoint_key}.`,
        requires_admin: row.scope_class === "admin",
        inputSchema: normalizePlatformEndpointInputSchema(row.input_schema_json),
        x_platform_endpoint: {
          parent_action_key: row.parent_action_key,
          endpoint_key: row.endpoint_key,
          source: "platform_endpoint_tool_exports",
        },
      }));
  } catch (err) {
    console.error("[systemLayerTools] Failed to list platform endpoint exports:", err?.message || err);
    return [];
  }
}

function isTenantRegistryToolAllowedInSystemFacade(tool = {}) {
  const name = String(tool.name || "").trim();
  if (!name || name.startsWith("system_tools_")) return false;
  const pathValue = String(tool.path || "").trim();
  if (pathValue === "/system/tools" || pathValue === "/system/tools/call") return false;
  return true;
}

async function listTenantEndpointRegistryToolsForPrincipal(auth, existingNames = new Set()) {
  if (isAdminPrincipal(auth)) return [];
  try {
    const tools = await fetchToolsForCaller("tenant");
    return tools
      .filter((tool) => isTenantRegistryToolAllowedInSystemFacade(tool))
      .filter((tool) => !existingNames.has(tool.name))
      .map((tool) => ({
        ...tool,
        source: "tenant_platform_endpoint_tools",
      }));
  } catch (err) {
    console.error("[systemLayerTools] Failed to list tenant endpoint registry tools:", err?.message || err);
    return [];
  }
}

async function toolsForPrincipalWithPlatformEndpoints(auth) {
  const baseTools = toolsForPrincipal(auth);
  const existingNames = new Set(baseTools.map((tool) => tool.name));
  const tenantTools = await listTenantEndpointRegistryToolsForPrincipal(auth, existingNames);
  for (const tool of tenantTools) existingNames.add(tool.name);
  const platformTools = await listPlatformEndpointToolsForPrincipal(auth, existingNames);
  return [...baseTools, ...tenantTools, ...platformTools];
}

async function buildSystemToolsListResponse(auth, query = {}) {
  const allTools = await toolsForPrincipalWithPlatformEndpoints(auth);
  const { items, page } = paginateItems(allTools, query || {});
  return {
    ok: true,
    protocol: "openapi-mcp-facade",
    list_mode: "bounded_paginated_chunkable",
    tools: items,
    page,
    total_available_tools: page.total_count,
    continuation_contract: {
      response_chunked_when_large: true,
      required_tool: "response_chunk_read",
      use_when: "response_chunked=true or page.has_more=true",
      fallback_allowed_only_after: "all_chunks_read_or_chunk_cache_expired_or_authorized_tool_unavailable",
      dynamic_cache_ttl: true,
      configurable_ttl_options: ["response_options.chunk_ttl_ms", "response_options.chunk_ttl_minutes"],
      extends_cache_on_read: true,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

function chunkSystemLayerResponse(body, source = {}) {
  const responseOptions = source?.response_options && typeof source.response_options === "object" ? source.response_options : {};
  return maybeChunkToolResponseBody(body, {
    response_options: {
      max_chars: Number(responseOptions.max_chars || source?.max_chars || 30000),
      cursor: Number(responseOptions.cursor || source?.cursor || 0),
      chunk_ttl_ms: Number(responseOptions.chunk_ttl_ms || source?.chunk_ttl_ms || 0) || undefined,
      chunk_ttl_minutes: Number(responseOptions.chunk_ttl_minutes || source?.chunk_ttl_minutes || 0) || undefined,
    },
  });
}

async function callRuntimeEndpointViaFacade(payload, deps = {}) {
  const facade = deps.executionFacade;
  if (!facade) {
    const err = new Error("No executionFacade is available for platform endpoint dispatch.");
    err.status = 503;
    err.code = "runtime_endpoint_executor_missing";
    throw err;
  }

  if (typeof facade === "function") {
    return await facade(payload);
  }

  const methodNames = [
    "executeHttpRequest",
    "executeHttpRequestAction",
    "execute",
    "dispatch",
    "run",
    "callEndpoint",
  ];

  for (const methodName of methodNames) {
    if (typeof facade[methodName] === "function") {
      return await facade[methodName](payload);
    }
  }

  const err = new Error("executionFacade does not expose a supported endpoint dispatch method.");
  err.status = 503;
  err.code = "runtime_endpoint_executor_method_missing";
  throw err;
}

// Hostinger shared hosting proxy drops idle TCP connections at ~30s.
// Cap all platform endpoint tool calls to 25s so we always respond before that.
const PLATFORM_TOOL_MAX_TIMEOUT_SECONDS = 25;

function normalizePlatformEndpointCallArgs(row, args = {}, auth = null) {
  let payload;
  if (row.tool_name === "runtime_endpoint_call") {
    payload = { ...(args || {}) };
  } else {
    payload = {
      parent_action_key: row.parent_action_key,
      endpoint_key: row.endpoint_key,
      path_params: args.path_params || args.path || {},
      query: args.query || {},
      headers: args.headers || {},
      timeout_seconds: Math.min(
        Number(args.timeout_seconds) || PLATFORM_TOOL_MAX_TIMEOUT_SECONDS,
        PLATFORM_TOOL_MAX_TIMEOUT_SECONDS
      ),
      readback: args.readback || { required: false, mode: "none" },
    };

    for (const optionalAuthField of ["user_id", "tenant_id", "target_key", "brand_key", "brand_domain", "credential_scope", "connection_id", "app_key", "scopes", "auth_type", "allow_platform_fallback", "auth_context", "dry_run"]) {
      if (Object.prototype.hasOwnProperty.call(args, optionalAuthField)) {
        payload[optionalAuthField] = args[optionalAuthField];
      }
    }

    const method = String(row.method || "").toUpperCase();
    const hasBody = args.body && Object.keys(args.body).length > 0;

    if (!["GET", "HEAD"].includes(method) && hasBody) {
      payload.body = args.body;
    }
  }

  const guarded = derivePrincipalExecutionContext(payload, auth);
  return {
    ...guarded.payload,
    _principal: guarded.principal,
    _principal_context_guard: guarded.guard,
  };
}

function encodeGithubPathPart(value = "") {
  return encodeURIComponent(String(value || "").trim());
}

async function githubReadOnlyGet(pathname = "", token = "") {
  const response = await fetch(`https://api.github.com${pathname}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "growth-intelligence-platform-resource-recipes",
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { parse_error: true, text: text.slice(0, 200) };
  }
  if (!response.ok) {
    const err = new Error(body?.message || `GitHub read-only request failed with ${response.status}`);
    err.status = response.status;
    err.code = "github_read_only_request_failed";
    err.details = { pathname, status: response.status, body };
    throw err;
  }
  return body;
}

function liteGithubPullRequest(pr = {}) {
  return {
    number: pr.number,
    title: pr.title || null,
    state: pr.state || null,
    url: pr.html_url || pr.url || null,
    draft: Boolean(pr.draft),
    mergeable: pr.mergeable ?? null,
    merge_state_status: pr.mergeable_state || null,
    author: pr.user?.login || null,
    base: { ref: pr.base?.ref || null, sha: pr.base?.sha || null },
    head: { ref: pr.head?.ref || null, sha: pr.head?.sha || null },
    secrets_included: false,
  };
}

async function executeGithubReadOnlyRecipe(operationKey = "", args = {}) {
  if (operationKey !== "repo_pr_reconciliation_sweep") {
    const err = new Error(`Unsupported GitHub read-only resource recipe operation: ${operationKey}`);
    err.status = 400;
    err.code = "unsupported_github_read_only_operation";
    throw err;
  }
  const owner = String(args.owner || "").trim();
  const repo = String(args.repo || "").trim();
  if (!owner || !repo) {
    const err = new Error("GitHub read-only PR reconciliation requires owner and repo.");
    err.status = 400;
    err.code = "missing_github_owner_repo";
    throw err;
  }

  const token = await getGitHubAppInstallationToken({});
  const safeOwner = encodeGithubPathPart(owner);
  const safeRepo = encodeGithubPathPart(repo);
  const state = encodeURIComponent(String(args.state || "open"));
  const limit = Math.min(Math.max(Number(args.limit || 50), 1), 100);
  let providerCallsMade = 0;

  const pulls = await githubReadOnlyGet(`/repos/${safeOwner}/${safeRepo}/pulls?state=${state}&per_page=${limit}`, token);
  providerCallsMade += 1;
  const pullRequests = [];
  for (const pr of Array.isArray(pulls) ? pulls.slice(0, limit) : []) {
    const lite = liteGithubPullRequest(pr);
    if (args.include_changed_files !== false) {
      const files = await githubReadOnlyGet(`/repos/${safeOwner}/${safeRepo}/pulls/${pr.number}/files?per_page=100`, token);
      providerCallsMade += 1;
      lite.changed_files = Array.isArray(files) ? files.map((file) => ({
        filename: file.filename || null,
        status: file.status || null,
        additions: Number(file.additions || 0),
        deletions: Number(file.deletions || 0),
      })) : [];
    }
    if (args.include_check_runs !== false && pr.head?.sha) {
      const checks = await githubReadOnlyGet(`/repos/${safeOwner}/${safeRepo}/commits/${encodeGithubPathPart(pr.head.sha)}/check-runs?per_page=100`, token);
      providerCallsMade += 1;
      lite.check_runs = Array.isArray(checks?.check_runs) ? checks.check_runs.map((check) => ({
        name: check.name || null,
        status: check.status || null,
        conclusion: check.conclusion || null,
        url: check.html_url || check.details_url || null,
      })) : [];
    }
    pullRequests.push(lite);
  }

  return {
    ok: true,
    operation_key: operationKey,
    owner,
    repo,
    pull_requests: pullRequests,
    provider_calls_made: providerCallsMade,
    mutations_executed: false,
    secrets_included: false,
  };
}

async function callPlatformEndpointToolIfAvailable(name, args = {}, auth = null, deps = {}) {
  const scopeClasses = platformEndpointToolScopeClassesForPrincipal(auth);
  const tenantClause = platformEndpointToolTenantClauseForPrincipal(auth, "x");
  const [rows] = await getPool().query(
    `SELECT x.tool_name,
            x.parent_action_key,
            x.endpoint_key,
            x.scope_class,
            e.method
       FROM platform_endpoint_tool_exports x
       LEFT JOIN endpoints e
         ON e.parent_action_key = x.parent_action_key
        AND e.endpoint_key = x.endpoint_key
        AND e.status = 'active'
      WHERE x.tool_name = ?
        AND x.status = 'active'
        AND x.scope_class IN (?, ?)
        ${tenantClause.sql}
      LIMIT 1`,
    [name, ...scopeClasses, ...tenantClause.params]
  );

  if (!rows.length) {
    return { handled: false };
  }

  const row = rows[0];

  if (row.scope_class === "admin" && !isAdminPrincipal(auth)) {
    const err = new Error("This platform endpoint tool requires admin access.");
    err.status = 403;
    err.code = "platform_endpoint_tool_admin_required";
    throw err;
  }

  const payload = normalizePlatformEndpointCallArgs(row, args, auth);
  const result = await callRuntimeEndpointViaFacade(payload, deps);
  return { handled: true, result };
}

async function callTenantEndpointRegistryToolIfAvailable(name, args = {}, auth = null, deps = {}) {
  if (isAdminPrincipal(auth)) return { handled: false };
  const tenantTools = await listTenantEndpointRegistryToolsForPrincipal(auth, new Set());
  const tool = tenantTools.find((entry) => entry.name === name);
  if (!tool) return { handled: false };

  const req = deps.req || { auth, headers: deps.headers || {}, ip: deps.ip || null };
  const dispatched = await dispatchToolForCaller("tenant", name, args, req);
  const status = Number(dispatched?.status || 200);
  const body = dispatched?.body || {};
  if (status >= 400 || body?.ok === false) {
    const err = new Error(body?.error?.message || `Tenant endpoint registry tool ${name} failed.`);
    err.status = status || body?.error?.status || 500;
    err.code = body?.error?.code || "tenant_endpoint_registry_tool_failed";
    err.details = body?.error?.details || null;
    throw err;
  }

  return {
    handled: true,
    result: Object.prototype.hasOwnProperty.call(body, "result") ? body.result : body,
  };
}

function isAdminPrincipal(auth) {
  return auth?.is_admin === true;
}

function principalTenantId(auth) {
  return auth?.tenant_id || null;
}

function toolsForPrincipal(auth) {
  if (isAdminPrincipal(auth)) return SYSTEM_LAYER_TOOLS;
  return SYSTEM_LAYER_TOOLS.filter((tool) => tool.requires_admin !== true);
}

function assertAdminToolAccess(name, auth) {
  if (!ADMIN_ONLY_SYSTEM_TOOLS.has(name) || isAdminPrincipal(auth)) return;
  const err = new Error("This system-layer tool requires an admin/service principal.");
  err.status = 403;
  err.code = "admin_system_tool_required";
  throw err;
}

function scopeFiltersToPrincipal(filters = {}, auth = {}) {
  if (isAdminPrincipal(auth)) return { ...filters };

  const tenantId = principalTenantId(auth);
  if (!tenantId) {
    const err = new Error("Tenant-scoped system tools require a tenant context.");
    err.status = 403;
    err.code = "tenant_context_required";
    throw err;
  }

  if (filters.tenant_id && filters.tenant_id !== tenantId) {
    const err = new Error("Tenant-scoped system tools cannot access another tenant.");
    err.status = 403;
    err.code = "tenant_scope_violation";
    throw err;
  }

  return { ...filters, tenant_id: tenantId };
}

function clampLimit(value, fallback = 50) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 200);
}

function parseConfigJson(value) {
  if (!value || typeof value !== "string") return value || null;
  try {
    return JSON.parse(value);
  } catch {
    return { parse_error: true };
  }
}

function providerProbeError(err) {
  const status = Number(err?.status || err?.code || err?.response?.status || 0);
  const message = err?.response?.data?.error?.message || err?.message || "Provider probe failed.";
  const code = err?.code || (status === 401 || status === 403 ? "provider_auth_failed" : "provider_probe_failed");
  const result = {
    ok: false,
    status: status || undefined,
    code,
    message,
    auth_failed: status === 401 || status === 403 || code === "missing_github_token" || code === "provider_auth_failed",
    rate_limited: status === 429,
  };
  if (code === "github_app_auth_invalid_private_key" && err?.details?.key_shape) {
    result.details = {
      cause_code: err.details.cause_code || "",
      expected_prefixes: err.details.expected_prefixes || [],
      key_shape: err.details.key_shape,
    };
  }
  return result;
}

function parseGithubRepo(value) {
  const normalized = String(value || "").trim().replace(/^https:\/\/github\.com\//i, "");
  const [owner, repo] = normalized.split("/").map((part) => part.trim()).filter(Boolean);
  if (!owner || !repo) return null;
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

function bootstrapRowObject(values = []) {
  const row = Array.isArray(values?.[0]) ? values[0] : Array.isArray(values) ? values : [];
  const mapped = {
    system_name: row[0] || "",
    api_base_url: row[1] || "",
    environment: row[2] || "",
    registry_sheet_id: row[3] || "",
    activity_sheet_id: row[4] || "",
    github_repo: row[5] || "",
    cloudflare_zone: row[6] || "",
    connector_url: row[7] || "",
    bootstrap_version: row[8] || "",
    activated_at: row[9] || "",
  };
  const repo = parseGithubRepo(mapped.github_repo);
  return {
    ...mapped,
    diagnostic_only: true,
    github_parent_action_key: "github_api_mcp",
    github_endpoint_key: "github_get_repository",
    github_owner: repo?.owner || "",
    github_repo: repo?.repo || mapped.github_repo,
    github_branch: process.env.GITHUB_BRANCH || "main",
    raw_values: row,
  };
}

function bootstrapConfigToRunnerRow(bootstrapConfig) {
  return {
    github_parent_action_key: bootstrapConfig.github_parent_action_key,
    github_endpoint_key: bootstrapConfig.github_endpoint_key,
    github_owner: bootstrapConfig.github_owner,
    github_repo: bootstrapConfig.github_repo,
    github_branch: bootstrapConfig.github_branch || "main",
    source: bootstrapConfig.source,
    sheets_required: false,
  };
}

async function ensurePlatformRuntimeConfigTable(pool = getPool()) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`platform_runtime_config\` (
      \`config_key\`  VARCHAR(128) NOT NULL,
      \`config_json\` JSON         NOT NULL,
      \`status\`      ENUM('active','disabled') NOT NULL DEFAULT 'active',
      \`note\`        VARCHAR(255) NULL,
      \`created_at\`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`config_key\`),
      KEY \`idx_prc_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function activationBootstrapConfigUpsert(args = {}) {
  const validated = validateActivationBootstrapConfig(args, "db_runtime");
  if (!validated.ok) {
    const err = new Error(`Missing required activation bootstrap fields: ${validated.missing.join(", ")}.`);
    err.status = 400;
    err.code = validated.error;
    throw err;
  }

  const config = {
    github_parent_action_key: validated.config.github_parent_action_key,
    github_endpoint_key: validated.config.github_endpoint_key,
    github_owner: validated.config.github_owner,
    github_repo: validated.config.github_repo,
    github_branch: validated.config.github_branch || "main",
  };
  const note = String(args.note || "admin_system_tool").trim().slice(0, 255);
  const pool = getPool();

  await ensurePlatformRuntimeConfigTable(pool);
  await pool.query(
    `INSERT INTO \`platform_runtime_config\`
       (config_key, config_json, status, note)
     VALUES (?, ?, 'active', ?)
     ON DUPLICATE KEY UPDATE
       config_json = VALUES(config_json),
       status = 'active',
       note = VALUES(note),
       updated_at = CURRENT_TIMESTAMP`,
    [ACTIVATION_GITHUB_BOOTSTRAP_CONFIG_KEY, JSON.stringify(config), note]
  );

  const readback = await resolveActivationBootstrapConfig();
  return {
    ok: readback.ok,
    config_key: ACTIVATION_GITHUB_BOOTSTRAP_CONFIG_KEY,
    source: readback.source,
    config: readback.ok ? readback.config : config,
    next_step: "Call activation_provider_bootstrap_validate from /system/tools/call or /admin/system/tools/call.",
    ...(readback.ok ? {} : { error: readback.error, db_error: readback.db_error, env_error: readback.env_error }),
  };
}

const PROBE_TIMEOUT_MS = 15000;

function withProbeTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(`${label} probe timed out after ${PROBE_TIMEOUT_MS}ms`), { code: "probe_timeout" })), PROBE_TIMEOUT_MS))
  ]);
}

async function activationDriveProbe() {
  try {
    const { drive } = await getGoogleClientsForSpreadsheet(ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID);
    const response = await withProbeTimeout(
      drive.files.list({
        pageSize: 1,
        fields: "files(id,name,mimeType),nextPageToken",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      }),
      "Drive"
    );
    return {
      ok: true,
      provider: "google_drive",
      attempted_binding: { parent_action_key: "google_drive_api", endpoint_key: "listDriveFiles" },
      sample_count: Array.isArray(response.data?.files) ? response.data.files.length : 0,
    };
  } catch (err) {
    const httpStatus = err?.code || err?.status || err?.response?.status;
    const apiMsg = err?.response?.data?.error?.message || err?.response?.data?.error_description || "";
    console.error(`[driveProbe] FAILED — status=${httpStatus} code=${err?.code} msg="${err?.message}"${apiMsg ? ` api="${apiMsg}"` : ""}`);
    return { provider: "google_drive", ...providerProbeError(err) };
  }
}

async function activationBootstrapConfigRead() {
  const runtimeBootstrap = await resolveActivationBootstrapConfig();
  if (!runtimeBootstrap.ok) {
    return {
      ok: false,
      provider: "backend_runtime",
      source: "unresolved",
      sheets_required: false,
      sheets_called: false,
      code: runtimeBootstrap.error || "activation_bootstrap_config_unresolved",
      db_error: runtimeBootstrap.db_error || null,
      env_error: runtimeBootstrap.env_error || null,
      secrets_included: false,
    };
  }

  const bootstrapRow = bootstrapConfigToRunnerRow(runtimeBootstrap.config);
  return {
    ok: true,
    provider: "backend_runtime",
    source: runtimeBootstrap.source || "db_runtime",
    sheets_required: false,
    sheets_called: false,
    bootstrap_row_read: true,
    bootstrap_row: bootstrapRow,
    config: runtimeBootstrap.config,
    secrets_included: false,
  };
}

async function activationSheetsBootstrapRead() {
  const replacement = await activationBootstrapConfigRead();
  return {
    ...replacement,
    ok: replacement.ok,
    status: "deprecated_not_required",
    provider: "backend_runtime",
    legacy_tool: "activation_sheets_bootstrap_read",
    replacement_tool: "activation_bootstrap_config_read",
    diagnostic_only: true,
    sheets_required: false,
    sheets_called: false,
    google_sheets_called: false,
    message: "Google Sheets bootstrap reads are deprecated; backend runtime DB bootstrap config is authoritative.",
  };
}

function resolveGithubValidationTarget(args = {}, bootstrapRow = {}) {
  const explicit = args.github_owner && args.github_repo ? { owner: args.github_owner, repo: args.github_repo } : null;
  const fromBootstrap = bootstrapRow.github_owner && bootstrapRow.github_repo
    ? { owner: bootstrapRow.github_owner, repo: bootstrapRow.github_repo }
    : parseGithubRepo(bootstrapRow.github_repo);
  const target = explicit || fromBootstrap;
  return target ? { ...target, branch: args.github_branch || bootstrapRow.github_branch || process.env.GITHUB_BRANCH || "main" } : null;
}

const GITHUB_REPOSITORY_ENDPOINT_KEY = "github_get_repository";
const ARTIFACT_ENV_BINDINGS = [
  ["OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID", OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID],
  ["BACKEND_ARTIFACTS", process.env.BACKEND_ARTIFACTS],
  ["BACKEND_ARTIFACTS_DRIVE_FOLDER_ID", process.env.BACKEND_ARTIFACTS_DRIVE_FOLDER_ID],
  ["ARTIFACTS_DRIVE_FOLDER_ID", process.env.ARTIFACTS_DRIVE_FOLDER_ID],
].map(([name, value]) => [name, String(value || "").trim()]).filter(([, value]) => value);

function findArtifactBindingInGithubTarget(target) {
  if (!target) return null;
  const fields = {
    github_owner: String(target.owner || "").trim(),
    github_repo: String(target.repo || "").trim(),
  };
  for (const [field, value] of Object.entries(fields)) {
    const match = ARTIFACT_ENV_BINDINGS.find(([, envValue]) => envValue && value === envValue);
    if (match) return { field, env_key: match[0] };
  }
  return null;
}

function resolveGithubRepositoryEndpointKey(endpointKey) {
  const normalized = String(endpointKey || "").trim();
  return normalized === GITHUB_REPOSITORY_ENDPOINT_KEY
    ? normalized
    : GITHUB_REPOSITORY_ENDPOINT_KEY;
}

function normalizeExecutionBody(executionResult = {}) {
  const body = executionResult?.body || executionResult?.data || executionResult || {};
  return body?.data && typeof body.data === "object" ? body.data : body;
}

async function activationGithubValidate(args = {}, bootstrapRow = {}, deps = {}) {
  try {
    const executeGovernedHttp = deps.executionFacade?.execute || deps.executeGovernedHttp;

    if (typeof executeGovernedHttp !== "function") {
      const err = new Error("Governed HTTP execution facade is unavailable for GitHub validation.");
      err.code = "governed_http_execution_unavailable";
      err.status = 500;
      throw err;
    }

    const target = resolveGithubValidationTarget(args, bootstrapRow);

    if (!target) {
      return {
        ok: false,
        provider: "github",
        code: "activation_github_binding_missing",
        message: "GitHub validation requires github_owner/github_repo from explicit arguments or the bootstrap repository binding.",
        details: {
          explicit_owner_present: Boolean(args.github_owner),
          explicit_repo_present: Boolean(args.github_repo),
          bootstrap_owner_present: Boolean(bootstrapRow.github_owner),
          bootstrap_repo_present: Boolean(bootstrapRow.github_repo),
        },
      };
    }

    const artifactBinding = findArtifactBindingInGithubTarget(target);
    if (artifactBinding) {
      return {
        ok: false,
        provider: "github",
        code: "activation_github_artifact_binding_rejected",
        message: "GitHub validation received an artifact storage identifier instead of a repository binding.",
        details: artifactBinding,
      };
    }

    const parentActionKey = String(
      bootstrapRow.github_parent_action_key || "github_api_mcp"
    ).trim();
    const configuredEndpointKey = String(
      bootstrapRow.github_endpoint_key || GITHUB_REPOSITORY_ENDPOINT_KEY
    ).trim();
    const endpointKey = resolveGithubRepositoryEndpointKey(configuredEndpointKey);

    const executionResult = await executeGovernedHttp({
      parent_action_key: parentActionKey,
      endpoint_key: endpointKey,
      path_params: {
        owner: target.owner,
        repo: target.repo,
      },
      query: {},
      timeout_seconds: Number(args.timeout_seconds || 15),
      expect_json: true,
      execution_trace_id: args.execution_trace_id,
      source_layer: "system_layer_activation",
      readback: {
        required: false,
        mode: "none",
      },
    });

    const status = Number(executionResult?.status || executionResult?.statusCode || 0);
    const payload = normalizeExecutionBody(executionResult);

    if (status < 200 || status >= 300 || payload?.ok === false) {
      const err = new Error(
        payload?.error?.message ||
        payload?.message ||
        `Governed GitHub validation failed with status ${status || "unknown"}.`
      );
      err.code =
        payload?.error?.code ||
        (status === 401 || status === 403
          ? "provider_auth_failed"
          : "github_governed_validation_failed");
      err.status = status || payload?.error?.status || 500;
      if (payload?.error?.details) {
        err.details = payload.error.details;
      }
      throw err;
    }

    return {
      ok: true,
      provider: "github",
      attempted_binding: {
        parent_action_key: parentActionKey,
        endpoint_key: endpointKey,
        ...(endpointKey !== configuredEndpointKey ? { configured_endpoint_key: configuredEndpointKey } : {}),
      },
      repository: payload.full_name || `${target.owner}/${target.repo}`,
      default_branch: payload.default_branch || null,
      requested_branch: target.branch,
      private: Boolean(payload.private),
      governed_execution: true,
      http_status: status,
    };
  } catch (err) {
    return { provider: "github", ...providerProbeError(err) };
  }
}

async function activationProviderBootstrapValidate(args = {}, deps = {}) {
  let bootstrapRow = null;
  let sheetsDiagnostic = null;
  let driveDiagnostic = null;
  const runtimeBootstrap = await resolveActivationBootstrapConfig();

  const result = await runGovernedActivation({
    attemptDrive: async () => {
      const probe = await activationDriveProbe();
      driveDiagnostic = { ok: probe.ok, code: probe.code || null, message: probe.message || null, status: probe.status || null, auth_failed: probe.auth_failed || false };
      return { ok: probe.ok, auth_failed: probe.auth_failed };
    },
    attemptSheets: async () => {
      sheetsDiagnostic = {
        attempted: false,
        ok: false,
        skipped: true,
        not_required: true,
        diagnostic_only: true,
        status: "deprecated_not_required",
        reason: "db_runtime_bootstrap_authority",
        replacement_tool: "activation_bootstrap_config_read",
        source: runtimeBootstrap.ok ? runtimeBootstrap.source : "unresolved",
        sheets_called: false,
      };
      return {
        ok: true,
        skipped: true,
        not_required: true,
        reason: "db_runtime_bootstrap_authority",
      };
    },
    getSpreadsheet: async () => {
      if (runtimeBootstrap.ok) {
        return { ok: true, data: { sheets: [{ properties: { title: ACTIVATION_BOOTSTRAP_CONFIG_SHEET } }] } };
      }
      const probe = await activationSheetsBootstrapRead();
      sheetsDiagnostic = probe;
      return probe.ok
        ? { ok: true, data: { sheets: [{ properties: { title: ACTIVATION_BOOTSTRAP_CONFIG_SHEET } }] } }
        : { ok: false, reason: probe.code || "activation_bootstrap_workbook_unreadable" };
    },
    readBootstrapRow: async () => {
      if (!runtimeBootstrap.ok) {
        return {
          ok: false,
          source: "db_runtime_or_server_env",
          error: runtimeBootstrap.error,
          db_error: runtimeBootstrap.db_error,
          env_error: runtimeBootstrap.env_error,
        };
      }
      bootstrapRow = bootstrapConfigToRunnerRow(runtimeBootstrap.config);
      return { ok: true, row: bootstrapRow };
    },
    attemptGitHub: async (bindings) => {
      const probe = await activationGithubValidate(args, { ...bootstrapRow, ...bindings }, deps);
      return { ok: probe.ok, auth_failed: probe.auth_failed };
    },
  });

  return {
    ok: result.runtime_classification?.activation_status === "active",
    activation_layer: "provider_bootstrap_system_tool",
    bootstrap_source: runtimeBootstrap.ok ? runtimeBootstrap.source : "unresolved",
    sheets_required: false,
    drive_diagnostic: driveDiagnostic || { attempted: false },
    sheets_diagnostic: sheetsDiagnostic
      ? {
          attempted: sheetsDiagnostic.attempted === true,
          ok: sheetsDiagnostic.ok === true,
          skipped: sheetsDiagnostic.skipped === true,
          not_required: sheetsDiagnostic.not_required === true,
          diagnostic_only: true,
          status: sheetsDiagnostic.status || (sheetsDiagnostic.skipped ? "deprecated_not_required" : undefined),
          reason: sheetsDiagnostic.reason || null,
          replacement_tool: sheetsDiagnostic.replacement_tool || null,
          source: sheetsDiagnostic.source || null,
          sheets_called: sheetsDiagnostic.sheets_called === true,
          spreadsheet_id: sheetsDiagnostic.spreadsheet_id || null,
          range: sheetsDiagnostic.range || null,
        }
      : { attempted: false, diagnostic_only: true, sheets_called: false },
    ...result,
  };
}

function systemRow(row) {
  return {
    system_id: row.system_id,
    tenant_id: row.tenant_id,
    system_key: row.system_key,
    display_name: row.display_name,
    provider_family: row.provider_family,
    provider_domain: row.provider_domain,
    connector_family: row.connector_family,
    auth_type: row.auth_type,
    service_mode: row.service_mode,
    self_serve_capable: Boolean(row.self_serve_capable),
    assisted_capable: Boolean(row.assisted_capable),
    managed_capable: Boolean(row.managed_capable),
    status: row.status,
    config: parseConfigJson(row.config_json),
    active_installations: Number(row.active_installations || 0),
    total_installations: Number(row.total_installations || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listConnectorRegistry(filters = {}, auth = null) {
  const scopedFilters = auth ? scopeFiltersToPrincipal(filters, auth) : filters;
  const conditions = ["1=1"];
  const params = [];

  if (scopedFilters.tenant_id) {
    conditions.push("cs.tenant_id = ?");
    params.push(scopedFilters.tenant_id);
  }
  if (scopedFilters.status) {
    if (!VALID_STATUSES.has(scopedFilters.status)) {
      const err = new Error("status must be one of: active, pending, error, archived.");
      err.status = 400;
      err.code = "invalid_status";
      throw err;
    }
    conditions.push("cs.status = ?");
    params.push(scopedFilters.status);
  }
  if (scopedFilters.connector_family) {
    conditions.push("cs.connector_family = ?");
    params.push(scopedFilters.connector_family);
  }
  if (scopedFilters.provider_family) {
    conditions.push("cs.provider_family = ?");
    params.push(scopedFilters.provider_family);
  }

  const limit = clampLimit(scopedFilters.limit);
  params.push(limit);

  const [rows] = await getPool().query(
    `SELECT cs.system_id, cs.tenant_id, cs.system_key, cs.display_name, cs.provider_family,
            cs.provider_domain, cs.connector_family, cs.auth_type, cs.service_mode,
            cs.self_serve_capable, cs.assisted_capable, cs.managed_capable, cs.status,
            cs.config_json, cs.created_at, cs.updated_at,
            SUM(CASE WHEN i.status = 'active' THEN 1 ELSE 0 END) AS active_installations,
            COUNT(i.installation_id) AS total_installations
       FROM \`connected_systems\` cs
       LEFT JOIN \`installations\` i ON i.system_id = cs.system_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY cs.id
      ORDER BY cs.updated_at DESC, cs.created_at DESC
      LIMIT ?`,
    params
  );

  return rows.map(systemRow);
}

async function getConnectorRegistrySystem(systemId, auth = null) {
  if (!systemId) {
    const err = new Error("system_id is required.");
    err.status = 400;
    err.code = "missing_system_id";
    throw err;
  }

  const [rows] = await getPool().query(
    `SELECT cs.system_id, cs.tenant_id, cs.system_key, cs.display_name, cs.provider_family,
            cs.provider_domain, cs.connector_family, cs.auth_type, cs.service_mode,
            cs.self_serve_capable, cs.assisted_capable, cs.managed_capable, cs.status,
            cs.config_json, cs.created_at, cs.updated_at,
            SUM(CASE WHEN i.status = 'active' THEN 1 ELSE 0 END) AS active_installations,
            COUNT(i.installation_id) AS total_installations
       FROM \`connected_systems\` cs
       LEFT JOIN \`installations\` i ON i.system_id = cs.system_id
      WHERE cs.system_id = ?
      GROUP BY cs.id
      LIMIT 1`,
    [systemId]
  );

  if (!rows.length) {
    const err = new Error(`Connector system ${systemId} not found.`);
    err.status = 404;
    err.code = "connector_system_not_found";
    throw err;
  }

  const row = rows[0];
  if (auth && !isAdminPrincipal(auth) && row.tenant_id !== principalTenantId(auth)) {
    const err = new Error("Tenant-scoped system tools cannot access another tenant.");
    err.status = 403;
    err.code = "tenant_scope_violation";
    throw err;
  }

  const [installations] = await getPool().query(
    `SELECT installation_id, tenant_id, scope, credential_ref, status, installed_at, expires_at, meta_json
       FROM \`installations\`
      WHERE system_id = ?
      ORDER BY installed_at DESC
      LIMIT 100`,
    [systemId]
  );

  return {
    ...systemRow(row),
    installations: installations.map((installation) => ({
      ...installation,
      meta_json: parseConfigJson(installation.meta_json),
    })),
  };
}

function clampDriveToolLimit(value, fallback = 100, max = 200) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(1, Math.floor(parsed)), max);
}

function parseGoogleDriveFolderId(args = {}) {
  const direct = String(args.folder_id || args.file_id || "").trim();
  if (direct) return direct;
  const url = String(args.folder_url || args.url || "").trim();
  if (!url) return "";
  const folderMatch = url.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (folderMatch?.[1]) return folderMatch[1];
  const idMatch = url.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return idMatch?.[1] || "";
}

function sanitizeDriveFileMetadata(file = {}) {
  return {
    id: file.id || null,
    name: file.name || null,
    mimeType: file.mimeType || null,
    modifiedTime: file.modifiedTime || null,
    createdTime: file.createdTime || null,
    size: file.size || null,
    driveId: file.driveId || null,
    parents: Array.isArray(file.parents) ? file.parents : [],
    webViewLink: file.webViewLink || null,
    capabilities: file.capabilities || undefined,
    is_folder: file.mimeType === "application/vnd.google-apps.folder",
  };
}

function driveEndpointCatalogRow(row = {}) {
  return {
    endpoint_id: row.endpoint_id || null,
    parent_action_key: row.parent_action_key || null,
    endpoint_key: row.endpoint_key || null,
    endpoint_operation: row.endpoint_operation || null,
    openai_action_name: row.openai_action_name || null,
    method: row.method || null,
    endpoint_path_or_function: row.endpoint_path_or_function || null,
    route_target: row.route_target || null,
    module_binding: row.module_binding || null,
    connector_family: row.connector_family || null,
    status: row.status || null,
    execution_readiness: row.execution_readiness || null,
    endpoint_role: row.endpoint_role || null,
    execution_mode: row.execution_mode || null,
    transport_required: row.transport_required || null,
    secrets_included: false,
  };
}

async function listGoogleDriveEndpointCatalog(args = {}) {
  const parentActionKey = String(args.parent_action_key || "google_drive_api").trim() || "google_drive_api";
  const conditions = ["parent_action_key = ?"];
  const params = [parentActionKey];
  for (const [argKey, column] of [["method", "method"], ["status", "status"], ["execution_readiness", "execution_readiness"]]) {
    if (args[argKey]) {
      conditions.push(`${column} = ?`);
      params.push(String(args[argKey]).trim());
    }
  }
  const search = String(args.search || "").trim();
  if (search) {
    conditions.push("(endpoint_key LIKE ? OR endpoint_operation LIKE ? OR openai_action_name LIKE ? OR endpoint_path_or_function LIKE ? OR notes LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  const limit = clampDriveToolLimit(args.limit, 100, 200);
  params.push(limit);
  const [rows] = await getPool().query(
    `SELECT endpoint_id, parent_action_key, endpoint_key, endpoint_operation, openai_action_name,
            method, endpoint_path_or_function, route_target, module_binding, connector_family,
            status, execution_readiness, endpoint_role, execution_mode, transport_required
       FROM \`endpoints\`
      WHERE ${conditions.join(" AND ")}
      ORDER BY
        CASE WHEN status = 'active' THEN 0 ELSE 1 END,
        CASE WHEN execution_readiness = 'ready' THEN 0 ELSE 1 END,
        endpoint_key ASC
      LIMIT ?`,
    params
  );
  return {
    ok: true,
    parent_action_key: parentActionKey,
    filters: {
      search: search || null,
      method: args.method || null,
      status: args.status || null,
      execution_readiness: args.execution_readiness || null,
      limit,
    },
    count: rows.length,
    endpoints: rows.map(driveEndpointCatalogRow),
    secrets_included: false,
  };
}

function buildDriveRuntimePayload({ endpointKey, pathParams = {}, query = {}, args = {}, auth = null, dryRun = false }) {
  const guarded = derivePrincipalExecutionContext({
    parent_action_key: "google_drive_api",
    endpoint_key: endpointKey,
    path_params: pathParams,
    query,
    credential_scope: args.credential_scope || "platform",
    connection_id: args.connection_id,
    tenant_id: args.tenant_id,
    user_id: args.user_id,
    allow_platform_fallback: args.allow_platform_fallback !== false,
    auth_context: args.auth_context,
    timeout_seconds: Math.min(Number(args.timeout_seconds) || 60, 120),
    dry_run: Boolean(dryRun),
  }, auth);
  return {
    ...guarded.payload,
    _principal: guarded.principal,
    _principal_context_guard: guarded.guard,
  };
}

async function callDriveRuntimeEndpoint({ endpointKey, pathParams = {}, query = {}, args = {}, auth = null, deps = {} }) {
  return await callRuntimeEndpointViaFacade(buildDriveRuntimePayload({ endpointKey, pathParams, query, args, auth }), deps);
}

function runtimeEndpointData(response) {
  return (response?.body || response || {}).data || {};
}

async function inspectGoogleDriveFolder(args = {}, auth = null, deps = {}) {
  const folderId = parseGoogleDriveFolderId(args);
  if (!folderId) {
    const err = new Error("folder_id or folder_url is required.");
    err.status = 400;
    err.code = "google_drive_folder_id_required";
    throw err;
  }
  const maxDepth = clampDriveToolLimit(args.max_depth, 1, 3);
  const pageSize = clampDriveToolLimit(args.page_size, 100, 200);
  const recursive = Boolean(args.recursive);
  const visited = new Set();

  async function inspectOne(currentFolderId, depth = 0) {
    if (visited.has(currentFolderId)) {
      return { id: currentFolderId, skipped: true, skip_reason: "already_visited", children: [] };
    }
    visited.add(currentFolderId);
    const metadata = runtimeEndpointData(await callDriveRuntimeEndpoint({
      endpointKey: "getFileMetadata",
      pathParams: { fileId: currentFolderId },
      query: {
        fields: "id,name,mimeType,driveId,parents,createdTime,modifiedTime,webViewLink,capabilities(canAddChildren,canEdit,canListChildren)",
        supportsAllDrives: true,
      },
      args,
      auth,
      deps,
    }));
    const listData = runtimeEndpointData(await callDriveRuntimeEndpoint({
      endpointKey: "listDriveFiles",
      query: {
        q: `'${currentFolderId}' in parents and trashed=false`,
        fields: "files(id,name,mimeType,modifiedTime,size,parents,webViewLink),nextPageToken",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageSize,
      },
      args,
      auth,
      deps,
    }));
    const children = Array.isArray(listData.files) ? listData.files.map(sanitizeDriveFileMetadata) : [];
    const childFolders = children.filter((child) => child.is_folder);
    const nested = [];
    if (recursive && depth < maxDepth) {
      for (const child of childFolders) nested.push(await inspectOne(child.id, depth + 1));
    }
    return {
      folder: sanitizeDriveFileMetadata(metadata),
      depth,
      child_count: children.length,
      folder_count: childFolders.length,
      file_count: children.length - childFolders.length,
      children,
      nested,
      next_page_token: listData.nextPageToken || null,
      secrets_included: false,
    };
  }

  const tree = await inspectOne(folderId, 0);
  return {
    ok: true,
    adapter: "google-drive-folder-inspect-v1",
    requested_folder_id: folderId,
    recursive,
    max_depth: maxDepth,
    page_size: pageSize,
    tree,
    secrets_included: false,
  };
}

async function callSystemLayerTool(name, args = {}, auth = null, deps = {}) {
  if (!LOCAL_SYSTEM_TOOL_NAMES.has(name)) {
    const tenantRegistryTool = await callTenantEndpointRegistryToolIfAvailable(name, args, auth, deps);
    if (tenantRegistryTool.handled) return tenantRegistryTool.result;

    let platformEndpointTool;
    try {
      platformEndpointTool = await callPlatformEndpointToolIfAvailable(name, args, auth, deps);
    } catch (err) {
      if (err.code !== "DB_CONFIG_MISSING") throw err;
      platformEndpointTool = { handled: false };
    }
    if (platformEndpointTool.handled) return platformEndpointTool.result;
  }

  assertAdminToolAccess(name, auth);

  const descriptorSystemTool = await callDescriptorSystemToolIfAvailable(name, args, auth, deps);
  if (descriptorSystemTool.handled) return descriptorSystemTool.result;

  switch (name) {
    case "response_chunk_read":
      return readCachedToolResponseChunk(args);
    case "system_layer_descriptor_readiness":
      return {
        ok: true,
        tool: "system_layer_descriptor_readiness",
        descriptor_source_count: SYSTEM_LAYER_DESCRIPTOR_SOURCES.length,
        descriptor_tool_count: SYSTEM_LAYER_DESCRIPTOR_HANDLER_REGISTRY.size,
        missing_handler_count: systemLayerDescriptorReadiness().filter((row) => !row.handler_present).length,
        descriptors: systemLayerDescriptorReadiness(),
        secrets_included: false,
      };
    case "runtime_endpoint_call": {
      const guarded = derivePrincipalExecutionContext({ ...(args || {}) }, auth);
      return await callRuntimeEndpointViaFacade({
        ...guarded.payload,
        _principal: guarded.principal,
        _principal_context_guard: guarded.guard,
      }, deps);
    }
    case "runtime_endpoint_preview": {
      const guarded = derivePrincipalExecutionContext({ ...(args || {}), dry_run: true }, auth);
      return await callRuntimeEndpointViaFacade({
        ...guarded.payload,
        dry_run: true,
        _principal: guarded.principal,
        _principal_context_guard: guarded.guard,
      }, deps);
    }
    case "google_drive_endpoint_catalog":
      return await listGoogleDriveEndpointCatalog(args);
    case "google_drive_folder_inspect":
      return await inspectGoogleDriveFolder(args, auth, deps);
    case "platform_resource_authority_binding_create":
      return await createRepositoryAuthorityBinding(args, { auth });
    case "platform_resource_authority_binding_list":
      return await listRepositoryAuthorityBindings(args, { auth });
    case "platform_resource_authority_binding_revoke":
      return await revokeRepositoryAuthorityBinding(args, { auth });
    case "tenant_repo_pr_reconciliation_sweep":
      return await tenantRepositoryPrReconciliationSweep(args, { auth, runGovernedResource });
    case "tenant_repository_intelligence_v2_readiness_smoke":
      return await tenantRepositoryIntelligenceV2ReadinessSmoke(args, { auth, runGovernedResource });
    case "tenant_repository_intelligence_report":
      return await tenantRepositoryIntelligenceReport(args, { auth, runGovernedResource });
    case "tenant_repository_action_planner_dry_run":
      return await tenantRepositoryActionPlannerDryRun(args, { auth, runGovernedResource });
    case "tenant_repository_intelligence_v3_v4_readiness_smoke":
      return await tenantRepositoryIntelligenceV3V4ReadinessSmoke(args, { auth, runGovernedResource });
    case "tenant_repository_advisory_comment_preview": return await tenantRepositoryAdvisoryCommentPreview(args, { auth, runGovernedResource }); case "tenant_repository_advisory_comment_apply": return await tenantRepositoryAdvisoryCommentApply(args, { auth, runGovernedResource }); case "tenant_repository_advisory_comment_readback": return await tenantRepositoryAdvisoryCommentReadback(args, { auth, runGovernedResource }); case "tenant_repository_advisory_comment_v5_readiness_smoke": return await tenantRepositoryAdvisoryCommentV5ReadinessSmoke(args, { auth, runGovernedResource }); case "governed_resource_resolve":
      return await resolveGovernedResource(args);
    case "governed_resource_catalog":
      return await catalogGovernedResources(args);
    case "governed_resource_plan":
      return await planGovernedResource(args);
    case "governed_resource_run": {
      const result = await runGovernedResource(args, {
        executeInstalledTool: async (toolKey, toolArgs) => {
          if (toolKey === "google_drive_folder_inspect") {
            return await inspectGoogleDriveFolder(toolArgs, auth, deps);
          }
          const err = new Error(`Installed tool ${toolKey} is not allowlisted for resource recipe execution.`);
          err.status = 403;
          err.code = "resource_recipe_installed_tool_not_allowlisted";
          throw err;
        },
        executeRuntimeEndpoint: async (payload) => {
          return await callRuntimeEndpointViaFacade(payload, deps);
        },
      });
      if (String(args?.mode || result?.mode || "").trim() === "apply") {
        try {
          result.audit_evidence = await writeResourceRecipeApplyEvidence({ args, result, auth });
        } catch (err) {
          result.audit_evidence = {
            ok: false,
            error: { code: err?.code || "resource_recipe_apply_evidence_failed", message: err?.message || "Resource recipe apply evidence write failed." },
            secrets_included: false,
          };
        }
      }
      return result;
    }
    case "connector_registry_list":
      return { connectors: await listConnectorRegistry(args, auth) };
    case "connector_registry_get":
      return { connector: await getConnectorRegistrySystem(args.system_id, auth) };
    case "activation_drive_probe":
      return await activationDriveProbe(args);
    case "activation_bootstrap_config_read":
      return await activationBootstrapConfigRead(args);
    case "activation_sheets_bootstrap_read":
      return await activationSheetsBootstrapRead(args);
    case "activation_github_validate": {
      const runtimeBootstrap = await resolveActivationBootstrapConfig();
      return await activationGithubValidate(
        args,
        runtimeBootstrap.ok ? bootstrapConfigToRunnerRow(runtimeBootstrap.config) : {},
        deps
      );
    }
    case "github_app_key_diagnostics": {
      const { privateKey } = resolveGitHubAppConfig({});
      const decoded = decodeGitHubAppPrivateKey(privateKey);
      const firstLine = decoded.split("\n")[0] || "";
      return {
        ok: true,
        configured: Boolean(privateKey),
        raw_length: privateKey.length,
        decoded_length: decoded.length,
        decoded_first_line: firstLine.slice(0, 40) || "(empty)",
        starts_with_pem_header: decoded.startsWith("-----BEGIN"),
        has_private_key_header: decoded.includes("PRIVATE KEY-----"),
        looks_like_pem: decoded.startsWith("-----BEGIN") && decoded.includes("PRIVATE KEY-----"),
        has_actual_newlines: privateKey.includes("\n") || privateKey.includes("\r"),
        has_escaped_newlines: privateKey.includes("\\n") || privateKey.includes("\\r\\n"),
        recommended_fix: decoded.startsWith("-----BEGIN") && decoded.includes("PRIVATE KEY-----")
          ? "PEM structure detected — if signing still fails, try re-setting GITHUB_APP_PRIVATE_KEY as the base64 of the PEM file."
          : "PEM header not found after decoding. Re-set GITHUB_APP_PRIVATE_KEY as the base64 of the raw PEM file (cat key.pem | base64 -w0).",
      };
    }
    case "activation_provider_bootstrap_validate":
      return await activationProviderBootstrapValidate(args, deps);
    case "activation_bootstrap_config_upsert":
      return await activationBootstrapConfigUpsert(args);
    case "tenant_gpt_oauth_client_upsert":
      return await upsertTenantGptOAuthClientConfig(args);
    case "tenant_gpt_oauth_client_status":
      return await getTenantGptOAuthClientConfigStatus();
    case "credential_client_config_upsert":
      return await upsertPlatformCredentialClientConfig(args);
    case "credential_client_config_list":
      return await listPlatformCredentialClientConfigs(args);
    case "google_auth_platform_config_upsert":
      return await upsertGoogleAuthPlatformConfig(args);
    case "google_auth_platform_config_get":
      return await getGoogleAuthPlatformConfig(args);
    default: {
      const err = new Error(`Unknown system layer tool: ${name}`);
      err.status = 400;
      err.code = "unknown_tool";
      throw err;
    }
  }
}

function sendError(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: err.message,
    },
  });
}

export function buildSystemLayerRoutes(deps) {
  const { requireBackendApiKey, executionFacade } = deps;
  const router = Router();
  const adminOnly = [requireBackendApiKey, requireAdminPrincipal];
  const authenticated = [requireBackendApiKey];

  router.get("/system/tools", ...authenticated, async (req, res) => {
    const body = await buildSystemToolsListResponse(req.auth, req.query || {});
    body.principal = {
      mode: req.auth?.mode || null,
      is_admin: isAdminPrincipal(req.auth),
      tenant_id: principalTenantId(req.auth),
    };
    return res.status(200).json(chunkSystemLayerResponse(body, req.query || {}));
  });

  router.post("/system/tools/call", ...authenticated, async (req, res) => {
    try {
      const { name } = req.body || {};
      const args = req.body?.tool_args && typeof req.body.tool_args === "object"
        ? req.body.tool_args
        : (req.body?.arguments && typeof req.body.arguments === "object" ? req.body.arguments : {});
      if (!name) {
        return res.status(400).json({ ok: false, error: { code: "missing_tool_name", message: "name is required." } });
      }
      const timeoutMs = (PLATFORM_TOOL_MAX_TIMEOUT_SECONDS + 2) * 1000;
      const deadline = new Promise((_, reject) =>
        setTimeout(() => {
          const e = new Error(`System tool call timed out after ${PLATFORM_TOOL_MAX_TIMEOUT_SECONDS + 2}s`);
          e.status = 504;
          e.code = "system_tool_timeout";
          reject(e);
        }, timeoutMs)
      );
      const result = await Promise.race([
        callSystemLayerTool(name, args, req.auth, { executionFacade, req }),
        deadline
      ]);
      return res.status(200).json(chunkSystemLayerResponse({ ok: true, name, result, secrets_included: false }, args || {}));
    } catch (err) {
      return sendError(res, err, "system_tool_call_failed");
    }
  });

  router.get("/system/connectors", ...authenticated, async (req, res) => {
    try {
      const connectors = await listConnectorRegistry(req.query || {}, req.auth);
      return res.status(200).json({ ok: true, connectors, count: connectors.length });
    } catch (err) {
      return sendError(res, err, "connector_registry_list_failed");
    }
  });

  router.get("/system/connectors/:system_id", ...authenticated, async (req, res) => {
    try {
      const connector = await getConnectorRegistrySystem(req.params.system_id, req.auth);
      return res.status(200).json({ ok: true, connector });
    } catch (err) {
      return sendError(res, err, "connector_registry_get_failed");
    }
  });

  router.get("/admin/system/connectors", ...adminOnly, async (req, res) => {
    try {
      const connectors = await listConnectorRegistry(req.query || {}, req.auth);
      return res.status(200).json({ ok: true, connectors, count: connectors.length });
    } catch (err) {
      return sendError(res, err, "connector_registry_list_failed");
    }
  });

  router.get("/admin/system/connectors/:system_id", ...adminOnly, async (req, res) => {
    try {
      const connector = await getConnectorRegistrySystem(req.params.system_id, req.auth);
      return res.status(200).json({ ok: true, connector });
    } catch (err) {
      return sendError(res, err, "connector_registry_get_failed");
    }
  });

  router.get("/admin/system/tools", ...adminOnly, async (req, res) => {
    const body = await buildSystemToolsListResponse(req.auth, req.query || {});
    return res.status(200).json(chunkSystemLayerResponse(body, req.query || {}));
  });

  router.post("/admin/system/tools/call", ...adminOnly, async (req, res) => {
    try {
      const { name } = req.body || {};
      const args = req.body?.tool_args && typeof req.body.tool_args === "object"
        ? req.body.tool_args
        : (req.body?.arguments && typeof req.body.arguments === "object" ? req.body.arguments : {});
      if (!name) {
        return res.status(400).json({ ok: false, error: { code: "missing_tool_name", message: "name is required." } });
      }
      const timeoutMs = (PLATFORM_TOOL_MAX_TIMEOUT_SECONDS + 2) * 1000;
      const deadline = new Promise((_, reject) =>
        setTimeout(() => {
          const e = new Error(`System tool call timed out after ${PLATFORM_TOOL_MAX_TIMEOUT_SECONDS + 2}s`);
          e.status = 504;
          e.code = "system_tool_timeout";
          reject(e);
        }, timeoutMs)
      );
      const result = await Promise.race([
        callSystemLayerTool(name, args, req.auth, { executionFacade }),
        deadline
      ]);
      return res.status(200).json(chunkSystemLayerResponse({ ok: true, name, result, secrets_included: false }, args || {}));
    } catch (err) {
      return sendError(res, err, "system_tool_call_failed");
    }
  });

  router.get("/admin/apis-services/google-auth-platform", ...adminOnly, async (req, res) => {
    try {
      const result = await getGoogleAuthPlatformConfig(req.query || {});
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "google_auth_platform_config_get_failed");
    }
  });

  router.get("/admin/apis-services/google-auth-platform/:tab", ...adminOnly, async (req, res) => {
    try {
      const result = await getGoogleAuthPlatformConfig({ ...(req.query || {}), tab: req.params.tab });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "google_auth_platform_config_get_failed");
    }
  });

  router.post("/admin/apis-services/google-auth-platform/:tab", ...adminOnly, async (req, res) => {
    try {
      const result = await upsertGoogleAuthPlatformConfig({ ...(req.body || {}), tab: req.params.tab });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "google_auth_platform_config_upsert_failed");
    }
  });

  router.get("/admin/apis-services/credentials", ...adminOnly, async (req, res) => {
    try {
      const result = await getGoogleAuthPlatformConfig({ ...(req.query || {}), tab: "api_credentials" });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "google_api_credentials_get_failed");
    }
  });

  router.post("/admin/apis-services/credentials", ...adminOnly, async (req, res) => {
    try {
      const result = await upsertGoogleAuthPlatformConfig({ ...(req.body || {}), tab: "api_credentials" });
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err, "google_api_credentials_upsert_failed");
    }
  });

  return router;
}

export {
  SYSTEM_LAYER_TOOLS,
  activationBootstrapConfigUpsert,
  activationGithubValidate,
  callSystemLayerTool,
  ensurePlatformRuntimeConfigTable,
  getConnectorRegistrySystem,
  listConnectorRegistry,
  resolveGithubValidationTarget,
};
