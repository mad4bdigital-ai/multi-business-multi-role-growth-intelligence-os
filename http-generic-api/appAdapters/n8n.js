// appAdapters/n8n.js — n8n workflow automation adapter.
// Supports self-hosted and n8n.cloud instances.
//
// Auth: api_key (X-N8N-API-KEY header) or basic_auth (user:pass)
// connection fields:
//   api_base_url  — n8n instance base, e.g. https://your-n8n.com/api/v1
//   webhook_url   — default webhook URL for trigger_webhook action

function pickFirstString(values = []) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function normalizeN8nCredentials(creds = {}, connection = {}) {
  return {
    ...creds,
    api_key: pickFirstString([creds.api_key, creds.N8N_API_KEY, creds.n8n_api_key, creds.token, creds.bearer_token]),
    username: pickFirstString([creds.username, creds.N8N_USERNAME]),
    password: pickFirstString([creds.password, creds.N8N_PASSWORD]),
    base_url: pickFirstString([connection.api_base_url, creds.N8N_BASE_URL, creds.N8N_LOCAL_BASE_URL]),
    webhook_url: pickFirstString([connection.webhook_url, creds.N8N_WEBHOOK_BASE_URL]),
  };
}

async function n8nReq(base, creds, path, { method = "GET", body } = {}) {
  const url = `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const headers = { "Content-Type": "application/json" };

  if (creds.api_key) {
    headers["X-N8N-API-KEY"] = creds.api_key;
  } else if (creds.username && creds.password) {
    const encoded = Buffer.from(`${creds.username}:${creds.password}`).toString("base64");
    headers["Authorization"] = `Basic ${encoded}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    ...(body && method !== "GET" ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`n8n API returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

export const n8nAdapter = {
  getDefaultGrants() {
    return [
      { action_key: "trigger_webhook",    auto_approve: true  },
      { action_key: "list_workflows",     auto_approve: true  },
      { action_key: "get_workflow",       auto_approve: true  },
      { action_key: "execute_workflow",   auto_approve: false },
      { action_key: "list_executions",    auto_approve: true  },
    ];
  },

  buildAuthUrl() { throw new Error("n8n connections use API key, not OAuth"); },
  async exchangeCode() { throw new Error("n8n connections use API key, not OAuth"); },
  async refreshAccessToken() { return {}; },

  async testConnection(creds, connection) {
    const normalized = normalizeN8nCredentials(creds, connection);
    const base = normalized.base_url;
    if (!base) return { ok: false, account_label: null, account_metadata: { error: "api_base_url not set" } };
    if (!normalized.api_key && !(normalized.username && normalized.password)) {
      return { ok: false, account_label: base, account_metadata: { error: "api_key or username/password required" } };
    }
    try {
      const data = await n8nReq(base, normalized, "/workflows?limit=1");
      return {
        ok: true,
        account_label: base,
        account_metadata: { base, workflow_count: data.data?.length ?? "?" },
      };
    } catch (e) {
      return { ok: false, account_label: base, account_metadata: { base, error: e.message } };
    }
  },

  async call(action_key, args, creds, connection) {
    const normalized = normalizeN8nCredentials(creds, connection);
    const base = normalized.base_url;

    switch (action_key) {

      case "trigger_webhook": {
        // POST to an n8n webhook path — works without API key
        const url = args.webhook_url || normalized.webhook_url;
        if (!url) throw new Error("webhook_url required for trigger_webhook");
        const payload = args.payload || {};
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const text = await res.text().catch(() => "");
        let result;
        try { result = JSON.parse(text); } catch { result = { raw: text }; }
        if (!res.ok) throw new Error(`n8n webhook returned HTTP ${res.status}: ${text.slice(0, 200)}`);
        return { ok: true, result, status: res.status };
      }

      case "list_workflows": {
        if (!base) throw new Error("api_base_url required");
        const limit = args.limit || 50;
        const data = await n8nReq(base, creds, `/workflows?limit=${limit}`);
        return { ok: true, result: data.data || data };
      }

      case "get_workflow": {
        if (!base) throw new Error("api_base_url required");
        const { workflow_id } = args;
        if (!workflow_id) throw new Error("workflow_id required");
        const data = await n8nReq(base, creds, `/workflows/${workflow_id}`);
        return { ok: true, result: data };
      }

      case "execute_workflow": {
        if (!base) throw new Error("api_base_url required");
        const { workflow_id, run_data = {} } = args;
        if (!workflow_id) throw new Error("workflow_id required");
        const data = await n8nReq(base, creds, `/workflows/${workflow_id}/run`, {
          method: "POST",
          body: { runData: run_data },
        });
        return { ok: true, result: data };
      }

      case "list_executions": {
        if (!base) throw new Error("api_base_url required");
        const { workflow_id, limit = 20, status } = args;
        let path = `/executions?limit=${limit}`;
        if (workflow_id) path += `&workflowId=${workflow_id}`;
        if (status)      path += `&status=${status}`;
        const data = await n8nReq(base, creds, path);
        return { ok: true, result: data.data || data };
      }

      default:
        throw new Error(`n8n: unknown action '${action_key}'`);
    }
  },
};
