import { resolveNativeBrowserPlugin } from "./nativeBrowserPluginRegistry.js";

const DESCRIPTIVE_ACTIONS = new Set(["status", "describe"]);
const URL_BOUND_ACTIONS = new Set(["open_url", "download_allowlisted_file", "upload_allowlisted_file"]);
const BROWSER_CLIENT_ALIASES = new Map([
  ["", "local_default"],
  ["default", "local_default"],
  ["local", "local_default"],
  ["local_default", "local_default"],
  ["local-device-default", "local_default"],
  ["local_device_default", "local_default"],
  ["system", "local_default"],
  ["system_default", "local_default"],
  ["edge", "edge"],
  ["msedge", "edge"],
  ["microsoft-edge", "edge"],
  ["microsoft_edge", "edge"],
  ["chrome", "chrome"],
  ["google-chrome", "chrome"],
  ["google_chrome", "chrome"],
  ["chromium", "chromium"],
  ["firefox", "firefox"],
  ["webkit", "webkit"]
]);

const PLAYWRIGHT_CLIENTS = {
  edge: { browser_type: "chromium", channel: "msedge" },
  chrome: { browser_type: "chromium", channel: "chrome" },
  chromium: { browser_type: "chromium", channel: null },
  firefox: { browser_type: "firefox", channel: null },
  webkit: { browser_type: "webkit", channel: null }
};

const FORBIDDEN_DISPATCH_ACTIONS = new Set([
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

function browserPluginError(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAllowlist(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeKey(entry)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => normalizeKey(entry)).filter(Boolean);
  }
  return [];
}

function normalizeBrowserClient(value) {
  const normalized = normalizeKey(value).replace(/\s+/g, "_");
  return BROWSER_CLIENT_ALIASES.get(normalized) || normalized;
}

function readDefaultBrowserClientHint(request, deps) {
  if (request.default_browser_client) {
    return normalizeBrowserClient(request.default_browser_client);
  }
  if (request.defaultBrowserClient) {
    return normalizeBrowserClient(request.defaultBrowserClient);
  }
  if (typeof deps.defaultBrowserClient === "string") {
    return normalizeBrowserClient(deps.defaultBrowserClient);
  }
  if (typeof deps.defaultBrowserClientProvider === "function") {
    return normalizeBrowserClient(deps.defaultBrowserClientProvider());
  }
  if (typeof deps.detectDefaultBrowserClient === "function") {
    return normalizeBrowserClient(deps.detectDefaultBrowserClient());
  }
  return null;
}

function buildPlaywrightClientConfig(client) {
  const config = PLAYWRIGHT_CLIENTS[client] || PLAYWRIGHT_CLIENTS.chromium;
  return {
    browser_type: config.browser_type,
    channel: config.channel,
    use_installed_channel: Boolean(config.channel)
  };
}

function resolveBrowserClient(plugin, request = {}, deps = {}) {
  const supportedClients = Array.isArray(plugin.supported_browser_clients) ? plugin.supported_browser_clients : [];
  const fallbackClients = Array.isArray(plugin.fallback_browser_clients) ? plugin.fallback_browser_clients : [];
  const requestedClient = normalizeBrowserClient(request.browser_client || request.browserClient || "");
  const defaultClient = readDefaultBrowserClientHint(request, deps);
  const attempts = [];

  if (requestedClient === "local_default") {
    if (defaultClient) {
      attempts.push(defaultClient);
    }
    attempts.push(...fallbackClients);
  } else {
    attempts.push(requestedClient);
  }

  const supportedAttempts = attempts.filter((client) => client && supportedClients.includes(client) && client !== "local_default");
  const resolvedClient = supportedAttempts[0];

  if (!resolvedClient) {
    throw browserPluginError("browser_plugin_browser_client_not_supported", "Browser client is not supported for this plugin.", 400, {
      plugin_key: plugin.plugin_key,
      requested_browser_client: requestedClient,
      default_browser_client: defaultClient,
      supported_browser_clients: supportedClients
    });
  }

  return {
    requested: requestedClient,
    resolved: resolvedClient,
    default_browser_client: defaultClient,
    resolution_strategy: requestedClient === "local_default" ? plugin.default_client_strategy : "explicit_request",
    fallback_browser_clients: fallbackClients,
    playwright: plugin.library === "playwright" ? buildPlaywrightClientConfig(resolvedClient) : null
  };
}

function hostnameMatchesRule(hostname, rule) {
  if (hostname === rule) {
    return true;
  }
  if (rule.startsWith("*.")) {
    const suffix = rule.slice(1);
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return false;
}

function validateUrlAllowlist(urlValue, domainAllowlist) {
  let parsed;
  try {
    parsed = new URL(String(urlValue || ""));
  } catch {
    throw browserPluginError("browser_plugin_invalid_url", "Browser plugin URL must be a valid URL.", 400);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw browserPluginError("browser_plugin_invalid_url_protocol", "Browser plugin URL must use http or https.", 400, {
      protocol: parsed.protocol
    });
  }

  const hostname = normalizeKey(parsed.hostname);
  const allowlist = normalizeAllowlist(domainAllowlist);
  if (allowlist.length === 0) {
    throw browserPluginError(
      "browser_plugin_domain_allowlist_required",
      "Browser plugin execution requires a non-empty domain allowlist.",
      403
    );
  }

  if (!allowlist.some((rule) => hostnameMatchesRule(hostname, rule))) {
    throw browserPluginError("browser_plugin_domain_not_allowed", "Browser plugin URL is outside the domain allowlist.", 403, {
      hostname,
      domain_allowlist: allowlist
    });
  }

  return {
    href: parsed.href,
    hostname,
    domain_allowlist: allowlist
  };
}

function buildStatus(plugin, action, deps = {}) {
  const adapters = deps.adapters || {};
  const adapter = adapters[plugin.library] || adapters[plugin.plugin_key] || null;
  return {
    ok: true,
    action,
    plugin_key: plugin.plugin_key,
    library: plugin.library,
    lifecycle: plugin.lifecycle,
    execution_surfaces: plugin.execution_surfaces,
    capability_groups: plugin.capability_groups || [],
    allowed_actions: plugin.allowed_actions,
    default_client_strategy: plugin.default_client_strategy,
    supported_browser_clients: plugin.supported_browser_clients || [],
    fallback_browser_clients: plugin.fallback_browser_clients || [],
    dependency_status: adapter && typeof adapter.dispatch === "function" ? "available" : "missing",
    executable: plugin.lifecycle !== "research_only"
  };
}

function buildAdapterInput(plugin, request, normalized) {
  return {
    plugin: {
      plugin_key: plugin.plugin_key,
      library: plugin.library,
      lifecycle: plugin.lifecycle,
      risk_tier: plugin.risk_tier
    },
    action: normalized.action,
    session_id: request.session_id || null,
    url: normalized.url?.href || null,
    selector: request.selector || null,
    value: request.value ?? null,
    fields: request.fields || null,
    option: request.option || null,
    key: request.key || null,
    assertion: request.assertion || null,
    schema: request.schema || null,
    artifact_key: request.artifact_key || null,
    options: request.options || {},
    browser_client: normalized.browser_client,
    domain_allowlist: normalized.url?.domain_allowlist || normalizeAllowlist(request.domain_allowlist)
  };
}

export function validateNativeBrowserPluginRequest(request = {}) {
  const pluginKey = normalizeKey(request.plugin_key || request.pluginKey);
  const action = normalizeKey(request.action);
  const plugin = resolveNativeBrowserPlugin(pluginKey);

  if (!plugin) {
    throw browserPluginError("browser_plugin_not_found", "Unknown native browser plugin.", 404, {
      plugin_key: pluginKey
    });
  }

  if (!action) {
    throw browserPluginError("browser_plugin_action_required", "Browser plugin action is required.", 400);
  }

  if (FORBIDDEN_DISPATCH_ACTIONS.has(action)) {
    throw browserPluginError("browser_plugin_action_forbidden", "Browser plugin action is explicitly forbidden.", 403, {
      action
    });
  }

  if (DESCRIPTIVE_ACTIONS.has(action)) {
    return {
      ok: true,
      plugin,
      action,
      descriptive: true,
      url: null
    };
  }

  if (plugin.lifecycle === "research_only") {
    throw browserPluginError("browser_plugin_research_only", "Research-only browser plugins cannot execute actions.", 403, {
      plugin_key: plugin.plugin_key
    });
  }

  if (!plugin.allowed_actions.includes(action)) {
    throw browserPluginError("browser_plugin_action_not_allowed", "Browser plugin action is not allowed for this plugin.", 400, {
      plugin_key: plugin.plugin_key,
      action
    });
  }

  if (plugin.requires_approval_hold && request.approval_granted !== true && !request.approval_hold_id) {
    throw browserPluginError("browser_plugin_approval_required", "This browser plugin requires an approval hold before execution.", 403, {
      plugin_key: plugin.plugin_key
    });
  }

  const normalizedUrl = URL_BOUND_ACTIONS.has(action)
    ? validateUrlAllowlist(request.url, request.domain_allowlist)
    : null;
  const normalizedBrowserClient = resolveBrowserClient(plugin, request, {});

  return {
    ok: true,
    plugin,
    action,
    descriptive: false,
    url: normalizedUrl,
    browser_client: normalizedBrowserClient
  };
}

export async function dispatchNativeBrowserPluginRequest(request = {}, deps = {}) {
  const normalized = validateNativeBrowserPluginRequest(request);
  if (!normalized.descriptive) {
    normalized.browser_client = resolveBrowserClient(normalized.plugin, request, deps);
  }

  if (normalized.descriptive) {
    return buildStatus(normalized.plugin, normalized.action, deps);
  }

  const adapters = deps.adapters || {};
  const adapter = adapters[normalized.plugin.library] || adapters[normalized.plugin.plugin_key] || null;

  if (!adapter || typeof adapter.dispatch !== "function") {
    throw browserPluginError(
      "browser_plugin_dependency_missing",
      "Browser plugin adapter dependency is not available.",
      501,
      {
        plugin_key: normalized.plugin.plugin_key,
        library: normalized.plugin.library
      }
    );
  }

  const result = await adapter.dispatch(buildAdapterInput(normalized.plugin, request, normalized));
  return {
    ok: true,
    plugin_key: normalized.plugin.plugin_key,
    action: normalized.action,
    result
  };
}
