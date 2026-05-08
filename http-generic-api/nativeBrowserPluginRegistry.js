const SAFE_BROWSER_PLUGIN_ACTIONS = new Set([
  "create_session",
  "list_sessions",
  "get_session",
  "close_session",
  "open_url",
  "reload_page",
  "go_back",
  "wait_for_load_state",
  "wait_for_selector",
  "capture_screenshot",
  "extract_schema",
  "extract_text",
  "extract_links",
  "get_page_metadata",
  "generate_pdf",
  "form_fill",
  "click_selector",
  "select_option",
  "press_key",
  "run_assertion",
  "inspect_accessibility_snapshot",
  "record_trace",
  "save_artifact",
  "download_allowlisted_file",
  "upload_allowlisted_file"
]);

const FORBIDDEN_BROWSER_PLUGIN_ACTIONS = new Set([
  "eval",
  "evaluate",
  "evaluate_js",
  "arbitrary_js",
  "raw_cdp",
  "raw_webdriver",
  "shell",
  "powershell",
  "command",
  "filesystem_read",
  "filesystem_write",
  "unrestricted_download",
  "unrestricted_upload"
]);

export const NATIVE_BROWSER_PLUGIN_TIERS = [
  {
    plugin_key: "browser.playwright",
    display_name: "Playwright Browser Plugin",
    tier: 1,
    lifecycle: "candidate_default",
    library: "playwright",
    default_client_strategy: "local_device_default_first",
    supported_browser_clients: ["local_default", "edge", "chrome", "chromium", "firefox", "webkit"],
    fallback_browser_clients: ["edge", "chrome", "chromium"],
    execution_surfaces: ["local_connector", "cloud_worker"],
    risk_tier: "controlled_browser",
    capability_groups: ["session", "navigation", "interaction", "extraction", "artifacts", "qa"],
    allowed_actions: [
      "create_session",
      "list_sessions",
      "get_session",
      "close_session",
      "open_url",
      "reload_page",
      "go_back",
      "wait_for_load_state",
      "wait_for_selector",
      "click_selector",
      "form_fill",
      "select_option",
      "press_key",
      "capture_screenshot",
      "extract_schema",
      "extract_text",
      "extract_links",
      "get_page_metadata",
      "generate_pdf",
      "run_assertion",
      "inspect_accessibility_snapshot",
      "record_trace",
      "save_artifact",
      "download_allowlisted_file",
      "upload_allowlisted_file"
    ],
    requires_user_jwt: true,
    requires_admin_service_auth: true,
    requires_tenant_entitlement: true,
    requires_local_consent_for_customer: true,
    domain_allowlist_required: true,
    audit_required: true,
    raw_library_api_exposed: false
  },
  {
    plugin_key: "browser.puppeteer",
    display_name: "Puppeteer Browser Plugin",
    tier: 2,
    lifecycle: "chrome_specialist",
    library: "puppeteer",
    default_client_strategy: "local_device_default_first",
    supported_browser_clients: ["local_default", "edge", "chrome", "chromium"],
    fallback_browser_clients: ["edge", "chrome", "chromium"],
    execution_surfaces: ["local_connector", "cloud_worker"],
    risk_tier: "controlled_browser_chromium",
    capability_groups: ["session", "navigation", "interaction", "extraction", "artifacts", "qa"],
    allowed_actions: [
      "create_session",
      "list_sessions",
      "get_session",
      "close_session",
      "open_url",
      "reload_page",
      "wait_for_load_state",
      "wait_for_selector",
      "click_selector",
      "form_fill",
      "select_option",
      "press_key",
      "capture_screenshot",
      "extract_schema",
      "extract_text",
      "extract_links",
      "get_page_metadata",
      "generate_pdf",
      "run_assertion",
      "record_trace",
      "save_artifact",
      "download_allowlisted_file",
      "upload_allowlisted_file"
    ],
    requires_user_jwt: true,
    requires_admin_service_auth: true,
    requires_tenant_entitlement: true,
    requires_local_consent_for_customer: true,
    domain_allowlist_required: true,
    audit_required: true,
    raw_library_api_exposed: false
  },
  {
    plugin_key: "browser.stagehand",
    display_name: "Stagehand Browser Plugin",
    tier: 3,
    lifecycle: "approval_gated_candidate",
    library: "stagehand",
    default_client_strategy: "local_device_default_first",
    supported_browser_clients: ["local_default", "edge", "chrome", "chromium"],
    fallback_browser_clients: ["edge", "chrome", "chromium"],
    execution_surfaces: ["local_connector", "cloud_worker"],
    risk_tier: "ai_adaptive_browser",
    capability_groups: ["session", "navigation", "interaction", "extraction", "artifacts", "ai_adaptive"],
    allowed_actions: [
      "create_session",
      "list_sessions",
      "get_session",
      "close_session",
      "open_url",
      "wait_for_load_state",
      "wait_for_selector",
      "click_selector",
      "form_fill",
      "capture_screenshot",
      "extract_schema",
      "extract_text",
      "extract_links",
      "get_page_metadata",
      "run_assertion",
      "save_artifact"
    ],
    requires_user_jwt: true,
    requires_admin_service_auth: true,
    requires_tenant_entitlement: true,
    requires_local_consent_for_customer: true,
    requires_approval_hold: true,
    domain_allowlist_required: true,
    audit_required: true,
    raw_library_api_exposed: false
  },
  {
    plugin_key: "browser.remote_browser_research",
    display_name: "Remote Browser Research Plugin",
    tier: 4,
    lifecycle: "research_only",
    library: "remote-browser",
    default_client_strategy: "remote_research_only",
    supported_browser_clients: [],
    fallback_browser_clients: [],
    execution_surfaces: [],
    risk_tier: "legacy_extension_browser_research",
    allowed_actions: [],
    requires_user_jwt: true,
    requires_admin_service_auth: true,
    requires_tenant_entitlement: true,
    requires_local_consent_for_customer: true,
    requires_approval_hold: true,
    domain_allowlist_required: true,
    audit_required: true,
    raw_library_api_exposed: false
  }
];

export function validateNativeBrowserPluginDefinition(definition = {}) {
  const errors = [];
  const pluginKey = String(definition.plugin_key || "");
  const allowedActions = Array.isArray(definition.allowed_actions) ? definition.allowed_actions : [];

  if (!/^browser\.[a-z0-9_]+$/.test(pluginKey)) {
    errors.push("plugin_key must use browser.<snake_key>.");
  }

  if (definition.raw_library_api_exposed !== false) {
    errors.push("raw_library_api_exposed must be false.");
  }

  if (definition.domain_allowlist_required !== true) {
    errors.push("domain_allowlist_required must be true.");
  }

  if (definition.audit_required !== true) {
    errors.push("audit_required must be true.");
  }

  if (definition.requires_tenant_entitlement !== true) {
    errors.push("requires_tenant_entitlement must be true.");
  }

  if (definition.requires_local_consent_for_customer !== true) {
    errors.push("requires_local_consent_for_customer must be true.");
  }

  for (const action of allowedActions) {
    if (FORBIDDEN_BROWSER_PLUGIN_ACTIONS.has(action)) {
      errors.push(`forbidden action declared: ${action}`);
    }
    if (!SAFE_BROWSER_PLUGIN_ACTIONS.has(action)) {
      errors.push(`unsupported browser plugin action: ${action}`);
    }
  }

  if (definition.lifecycle !== "research_only" && allowedActions.length === 0) {
    errors.push("non-research browser plugins must declare at least one safe action.");
  }

  if (definition.lifecycle !== "research_only") {
    const supportedClients = Array.isArray(definition.supported_browser_clients)
      ? definition.supported_browser_clients
      : [];
    const fallbackClients = Array.isArray(definition.fallback_browser_clients)
      ? definition.fallback_browser_clients
      : [];

    if (!supportedClients.includes("local_default")) {
      errors.push("browser plugins must support local_default browser client resolution.");
    }
    for (const fallbackClient of fallbackClients) {
      if (!supportedClients.includes(fallbackClient)) {
        errors.push(`fallback browser client is not supported: ${fallbackClient}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function getNativeBrowserPluginTiers() {
  return NATIVE_BROWSER_PLUGIN_TIERS.map((definition) => ({
    ...definition,
    validation: validateNativeBrowserPluginDefinition(definition)
  }));
}

export function resolveNativeBrowserPlugin(pluginKey) {
  const normalized = String(pluginKey || "").trim().toLowerCase();
  return getNativeBrowserPluginTiers().find((definition) => definition.plugin_key === normalized) || null;
}
