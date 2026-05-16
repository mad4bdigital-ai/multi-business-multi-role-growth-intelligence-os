function str(value) {
  return String(value ?? "").trim();
}

function normalizeWpJsonBase(input = "") {
  const base = str(input).replace(/\/+$/, "");
  if (!base) return "";
  if (base.endsWith("/wp-json")) return base;
  return `${base}/wp-json`;
}

function basicAuthHeader(creds = {}) {
  const username = str(creds.username);
  const appPassword = str(creds.application_password || creds.app_password || creds.password);
  if (!username || !appPassword) return "";
  const token = Buffer.from(`${username}:${appPassword}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

async function wpFetch(path, creds = {}, connection = {}, options = {}) {
  const apiBase = normalizeWpJsonBase(connection.api_base_url || creds.wp_json_base || creds.site_url || creds.base_url);
  if (!apiBase) return { ok: false, error: "missing_wp_json_base" };

  const auth = basicAuthHeader(creds);
  if (!auth) return { ok: false, error: "missing_username_or_application_password" };

  const url = `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: auth,
      Accept: "application/json",
      ...(options.headers || {})
    },
    body: options.body,
    signal: options.signal
  });

  let body = null;
  const text = await response.text().catch(() => "");
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }

  return {
    ok: response.ok,
    status: response.status,
    url,
    body
  };
}

export const wordpressRestAdapter = {
  getDefaultGrants() {
    return [
      { action_key: "wordpress_rest.validate_connection", auto_approve: true },
      { action_key: "wordpress_rest.get_current_user", auto_approve: true },
      { action_key: "wordpress_rest.read_users", auto_approve: false }
    ];
  },

  async testConnection(creds, connection = {}) {
    const result = await wpFetch("/wp/v2/users/me?context=edit", creds, connection);
    if (!result.ok) {
      return {
        ok: false,
        status: result.status || 0,
        error: result.error || result.body?.code || "wordpress_auth_failed",
        account_label: connection.api_base_url || creds.wp_json_base || null,
        account_metadata: {
          wp_json_base: normalizeWpJsonBase(connection.api_base_url || creds.wp_json_base || creds.site_url || creds.base_url),
          validation_endpoint: "/wp/v2/users/me?context=edit",
          auth_scope: "wordpress_api"
        }
      };
    }

    const user = result.body || {};
    return {
      ok: true,
      account_label: user.name || user.slug || user.username || creds.username || null,
      account_metadata: {
        id: user.id || null,
        name: user.name || null,
        slug: user.slug || null,
        link: user.link || null,
        roles: Array.isArray(user.roles) ? user.roles : [],
        capabilities_present: Boolean(user.capabilities),
        wp_json_base: normalizeWpJsonBase(connection.api_base_url || creds.wp_json_base || creds.site_url || creds.base_url),
        auth_scope: "wordpress_api"
      }
    };
  },

  async call(action_key, args = {}, creds = {}, connection = {}) {
    if (action_key === "wordpress_rest.validate_connection" || action_key === "wordpress_rest.get_current_user") {
      const result = await this.testConnection(creds, connection);
      return { ok: result.ok, result };
    }

    if (action_key === "wordpress_rest.read_users") {
      const perPage = Math.min(Number(args.per_page || 20) || 20, 100);
      const result = await wpFetch(`/wp/v2/users?per_page=${perPage}&context=edit`, creds, connection);
      return {
        ok: result.ok,
        result: {
          status: result.status || 0,
          users: result.ok && Array.isArray(result.body) ? result.body.map(u => ({
            id: u.id,
            name: u.name,
            slug: u.slug,
            link: u.link,
            roles: Array.isArray(u.roles) ? u.roles : []
          })) : [],
          error: result.ok ? null : result.body?.code || result.error || "wordpress_users_read_failed"
        }
      };
    }

    return { ok: false, error: `Unsupported WordPress REST action '${action_key}'` };
  }
};

export const __test__ = {
  normalizeWpJsonBase,
  basicAuthHeader
};
