export function isOAuthConfigured(action) {
  const fileId = String(action.oauth_config_file_id || "").trim();
  return fileId !== "" && fileId.toLowerCase() !== "null";
}

export function inferAuthMode({ action, brand }) {
  if (brand?.auth_type === "basic_auth_app_password") return "basic_auth";

  const apiKeyMode = String(action.api_key_mode || "").trim().toLowerCase();
  const headerName = String(action.api_key_header_name || "").trim();
  const paramName = String(action.api_key_param_name || "").trim();
  const oauthConfigured = isOAuthConfigured(action);

  // api_key_mode is the governed primary discriminator — resolve it first before
  // falling through to header/param name heuristics.
  if (apiKeyMode === "basic_auth_app_password") return "basic_auth";
  if (apiKeyMode === "google_oauth2") return "google_oauth2";
  if (apiKeyMode === "google_ads_oauth2") return "google_ads_oauth2";
  if (apiKeyMode === "github_app") return "github_app";
  if (apiKeyMode === "bearer_token") return "bearer_token";
  if (apiKeyMode === "custom_headers") return "custom_headers";

  // Header/param heuristics — fallback when api_key_mode is absent or unrecognised.
  // Authorization header always means bearer_token — injecting a raw secret into
  // the Authorization header without a scheme prefix is semantically wrong and
  // would be rejected by every governed provider (GitHub, etc.).
  if (headerName && String(headerName).toLowerCase() === "authorization") {
    return "bearer_token";
  }

  if (headerName && apiKeyMode === "custom_api") return "api_key_header";
  if (paramName) return "api_key_query";
  if (headerName) return "api_key_header";

  if (oauthConfigured) return "oauth_gpt_action";
  return "none";
}

export function buildResolvedAuthHeaders(contract) {
  if (contract.mode === "basic_auth") {
    if (!contract.username || !contract.secret) {
      const err = new Error("Missing username or secret for basic_auth.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    const token = Buffer.from(`${contract.username}:${contract.secret}`, "utf8").toString("base64");
    return { Authorization: `Basic ${token}` };
  }

  if (contract.mode === "bearer_token" || contract.mode === "github_app") {
    if (!contract.secret) {
      const err = new Error("Missing secret for bearer_token.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    return { Authorization: `Bearer ${contract.secret}` };
  }

  if (contract.mode === "google_oauth2") {
    if (!contract.secret) return {};
    return { Authorization: `Bearer ${contract.secret}` };
  }

  if (contract.mode === "google_ads_oauth2") {
    if (!contract.secret) return {};
    return { Authorization: `Bearer ${contract.secret}`, ...contract.custom_headers };
  }

  if (contract.mode === "custom_headers") {
    return { ...(contract.custom_headers || {}) };
  }

  return {};
}

export function injectAuthIntoQuery(query, contract) {
  if (contract.mode === "api_key_query") {
    if (!contract.param_name || !contract.secret) {
      const err = new Error("Missing param_name or secret for api_key_query.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    return { ...query, [contract.param_name]: contract.secret };
  }
  return query;
}

export function injectAuthIntoHeaders(headers, contract) {
  if (contract.mode === "api_key_header") {
    if (!contract.header_name || !contract.secret) {
      const err = new Error("Missing header_name or secret for api_key_header.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    return { ...headers, [contract.header_name]: contract.secret };
  }

  return { ...headers, ...buildResolvedAuthHeaders(contract) };
}

export function injectAuthForSchemaValidation(query, headers, contract) {
  const nextQuery = { ...(query || {}) };
  const nextHeaders = { ...(headers || {}) };

  if (contract.mode === "api_key_query") {
    if (!contract.param_name || !contract.secret) {
      const err = new Error("Missing param_name or secret for api_key_query.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    nextQuery[contract.param_name] = contract.secret;
  }

  if (contract.mode === "api_key_header") {
    if (!contract.header_name || !contract.secret) {
      const err = new Error("Missing header_name or secret for api_key_header.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    nextHeaders[contract.header_name] = contract.secret;
  }

  if (contract.mode === "bearer_token" || contract.mode === "github_app") {
    if (!contract.secret) {
      const err = new Error("Missing secret for bearer_token.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    nextHeaders.Authorization = `Bearer ${contract.secret}`;
  }

  if (contract.mode === "basic_auth") {
    if (!contract.username || !contract.secret) {
      const err = new Error("Missing username or secret for basic_auth.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    const token = Buffer.from(`${contract.username}:${contract.secret}`, "utf8").toString("base64");
    nextHeaders.Authorization = `Basic ${token}`;
  }

  if (contract.mode === "google_oauth2") {
    if (contract.secret) nextHeaders.Authorization = `Bearer ${contract.secret}`;
  }

  if (contract.mode === "google_ads_oauth2") {
    if (contract.secret) nextHeaders.Authorization = `Bearer ${contract.secret}`;
    Object.assign(nextHeaders, contract.custom_headers || {});
  }

  if (contract.mode === "custom_headers") {
    Object.assign(nextHeaders, contract.custom_headers || {});
  }

  return {
    query: nextQuery,
    headers: nextHeaders
  };
}
