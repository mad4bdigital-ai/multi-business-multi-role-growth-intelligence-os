import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import jwt from "jsonwebtoken";
import { buildConnectApiRoutes } from "./routes/connectApiRoutes.js";
import { buildTenantConnectionSelfRepairRoutes } from "./routes/tenantConnectionSelfRepairRoutes.js";
import { TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS } from "./tenantConnectionSelfRepairService.js";

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function requestPath(contract) {
  return contract.path.replace("{connection_id}", "connection-test-1");
}

const originalJwtSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = "tenant-context-test-secret-".padEnd(64, "x");

try {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes("tenant_platform_endpoint_tools")) {
        return [[{ tool_key: params[0], is_enabled: 0 }], []];
      }
      if (String(sql).includes("FROM `memberships`") || String(sql).includes("FROM memberships")) {
        return [[{ tenant_id: "tenant-test-1", role: "owner", tenant_display_name: "Tenant Test" }], []];
      }
      if (String(sql).includes("user_app_connections")) {
        throw new Error("connection lookup must not occur while capability is disabled");
      }
      throw new Error(`unexpected query: ${String(sql).slice(0, 120)}`);
    },
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      mode: "user_jwt",
      user_id: "user-test-1",
      tenant_id: "tenant-test-1",
      is_admin: false,
    };
    next();
  });
  app.use(buildConnectApiRoutes({ pool }));

  const { server, baseUrl } = await startServer(app);
  try {
    assert.equal(TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS.length, 9);
    for (const contract of TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS) {
      const response = await fetch(`${baseUrl}${requestPath(contract)}`, {
        method: contract.method,
        headers: contract.method === "GET" ? undefined : { "content-type": "application/json" },
        body: contract.method === "GET" ? undefined : JSON.stringify({}),
      });
      const body = await response.json();
      assert.equal(response.status, 503, `${contract.tool_key} must fail closed`);
      assert.equal(body?.error?.code, "tenant_connection_self_repair_capability_disabled");
      assert.equal(body?.error?.details?.tool_key, contract.tool_key);
      assert.equal(body?.secrets_included, false);
    }
    assert.equal(queries.filter((entry) => entry.sql.includes("user_app_connections")).length, 0);
    assert.equal(queries.filter((entry) => entry.sql.includes("tenant_platform_endpoint_tools")).length, 9);
  } finally {
    server.close();
  }

  const unauthenticatedApp = express();
  unauthenticatedApp.use(express.json());
  unauthenticatedApp.use(buildConnectApiRoutes({ pool }));
  const unauthenticated = await startServer(unauthenticatedApp);
  try {
    const response = await fetch(`${unauthenticated.baseUrl}/me/connections/connection-test-1/effective-credential-plan`);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body?.error?.code, "user_jwt_required");
  } finally {
    unauthenticated.server.close();
  }

  // Multi-membership sessions may not silently inherit the first membership.
  const multiQueries = [];
  const multiPool = {
    async query(sql, params = []) {
      const source = String(sql);
      multiQueries.push({ sql: source, params });
      if (source.includes("FROM `memberships`") || source.includes("FROM memberships")) {
        return [[
          { tenant_id: "tenant-a", role: "owner", tenant_display_name: "Tenant A" },
          { tenant_id: "tenant-b", role: "member", tenant_display_name: "Tenant B" },
        ], []];
      }
      if (source.includes("FROM `users`")) {
        return [[{ user_id: "user-multi", email: "multi@example.com", display_name: "Multi User" }], []];
      }
      if (source.includes("FROM `user_app_connections`")) {
        return [[{
          connection_id: "conn-a",
          app_key: "google_drive",
          display_label: "Drive",
          auth_type: "oauth2",
          account_label: "multi@example.com",
          account_metadata: "{}",
          mcp_endpoint: null,
          status: "active",
          validation_status: "validated",
          token_expires_at: null,
          last_validated_at: "2026-09-08 12:00:00",
          last_used_at: "2026-09-08 12:01:00",
          connected_at: "2026-09-08 11:00:00",
        }], []];
      }
      if (source.includes("FROM `connected_systems`")) {
        return [[{
          system_id: "system-a",
          system_key: "local_manager",
          display_name: "Local Manager",
          provider_family: "mad4b",
          connector_family: "local_manager",
          auth_type: "device",
          service_mode: "managed",
          status: "active",
          updated_at: "2026-09-08 12:02:00",
        }], []];
      }
      throw new Error(`unexpected multi query: ${source.slice(0, 160)}`);
    },
  };

  const multiApp = express();
  multiApp.use(express.json());
  multiApp.use((req, _res, next) => {
    req.auth = {
      mode: "user_jwt",
      user_id: "user-multi",
      tenant_id: "tenant-a", // simulates legacy hydration; signed claims remain tenant-less.
      claims: { user_id: "user-multi", email: "multi@example.com" },
      email: "multi@example.com",
      is_admin: false,
    };
    next();
  });
  multiApp.use(buildConnectApiRoutes({ pool: multiPool }));
  const multiServer = await startServer(multiApp);
  try {
    const contexts = await fetch(`${multiServer.baseUrl}/connect/api/contexts`);
    const contextsBody = await contexts.json();
    assert.equal(contexts.status, 200);
    assert.equal(contextsBody.context_required, true);
    assert.equal(contextsBody.membership_count, 2);
    assert.deepEqual(contextsBody.memberships.map((item) => item.tenant_id), ["tenant-a", "tenant-b"]);

    const blocked = await fetch(`${multiServer.baseUrl}/connect/api/connections/lifecycle`);
    const blockedBody = await blocked.json();
    assert.equal(blocked.status, 409);
    assert.equal(blockedBody?.error?.code, "tenant_context_required");

    const selected = await fetch(`${multiServer.baseUrl}/connect/api/active-context`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "tenant-b" }),
    });
    const selectedBody = await selected.json();
    assert.equal(selected.status, 200);
    const contextClaims = jwt.verify(selectedBody.token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    assert.equal(contextClaims.user_id, "user-multi");
    assert.equal(contextClaims.tenant_id, "tenant-b");
    assert.equal(contextClaims.purpose, "connect_tenant_context");
    assert.equal(selectedBody.context_revalidated, true);
  } finally {
    multiServer.server.close();
  }

  // Canonical lifecycle routes run after an explicit signed context.
  const lifecycleQueries = [];
  let wordpressConnection = null;
  const lifecyclePool = {
    async query(sql, params = []) {
      const source = String(sql);
      lifecycleQueries.push({ sql: source, params });
      if (source.includes("FROM `memberships`") || source.includes("FROM memberships")) {
        return [[
          { tenant_id: "tenant-a", role: "owner", tenant_display_name: "Tenant A" },
          { tenant_id: "tenant-b", role: "member", tenant_display_name: "Tenant B" },
        ], []];
      }
      if (source.includes("FROM `users`")) {
        return [[{ user_id: "user-multi", email: "multi@example.com", display_name: "Multi User" }], []];
      }
      if (source.includes("FROM `user_app_connections`") && source.includes("app_key = 'mcp'") && source.includes("mcp_endpoint = ?") && source.includes("status <> 'revoked'")) {
        return [wordpressConnection ? [[wordpressConnection][0]] : [], []];
      }
      if (source.startsWith("INSERT INTO `user_app_connections`")) {
        wordpressConnection = {
          connection_id: params[0],
          account_metadata: params[3],
          app_key: "mcp",
          mcp_endpoint: params[4],
          status: "active",
        };
        return [{ affectedRows: 1 }, []];
      }
      if (source.includes("FROM `user_app_connections`") && source.includes("connection_id = ?") && source.includes("app_key = 'mcp'")) {
        if (!wordpressConnection || params[0] !== wordpressConnection.connection_id) return [[], []];
        return [[wordpressConnection], []];
      }
      if (source.includes("FROM `user_app_connections`") && source.includes("ORDER BY COALESCE")) {
        return [[{
          connection_id: wordpressConnection?.connection_id || "conn-a",
          app_key: wordpressConnection ? "mcp" : "google_drive",
          display_label: wordpressConnection ? "WordPress Staging MCP" : "Drive",
          auth_type: wordpressConnection ? "mcp" : "oauth2",
          account_label: wordpressConnection ? "staging.egypttourgates.com" : "multi@example.com",
          account_metadata: wordpressConnection?.account_metadata || "{}",
          mcp_endpoint: wordpressConnection?.mcp_endpoint || null,
          status: "active",
          validation_status: wordpressConnection ? "pending_validation" : "validated",
          token_expires_at: null,
          last_validated_at: null,
          last_used_at: null,
          connected_at: "2026-09-08 11:00:00",
        }], []];
      }
      if (source.includes("FROM `connected_systems`")) return [[], []];
      if (source.startsWith("UPDATE `user_app_connections`") || source.startsWith("UPDATE `app_action_grants`") || source.startsWith("UPDATE `app_action_requests`") || source.startsWith("UPDATE `workspace_app_links`") || source.startsWith("UPDATE `cms_site_access_grants`") || source.startsWith("UPDATE `credential_bindings`") || source.startsWith("UPDATE `cms_account_claims`")) {
        return [{ affectedRows: 1 }, []];
      }
      if (source.includes("SELECT connection_id, app_key, status") && source.includes("FROM `user_app_connections`")) {
        return [[{ connection_id: params[0], app_key: "mcp", status: "active" }], []];
      }
      throw new Error(`unexpected lifecycle query: ${source.slice(0, 180)}`);
    },
  };

  const fixedFetch = async (url) => {
    const target = String(url);
    if (target.includes("oauth-protected-resource")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            resource: "https://staging.egypttourgates.com/wp-json/mcp/mad4b-read",
            authorization_servers: ["https://dev.mad4b.com/auth/mcp/wordpress-staging"],
            scopes_supported: ["mad4b:read"],
          };
        },
        headers: { get: () => null },
      };
    }
    if (target.includes("oauth-authorization-server")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            issuer: "https://dev.mad4b.com/auth/mcp/wordpress-staging",
            protected_resources: ["https://staging.egypttourgates.com/wp-json/mcp/mad4b-read"],
          };
        },
        headers: { get: () => null },
      };
    }
    return {
      ok: false,
      status: 401,
      async json() { return {}; },
      headers: {
        get(name) {
          return String(name).toLowerCase() === "www-authenticate"
            ? 'Bearer resource_metadata="https://staging.egypttourgates.com/.well-known/oauth-protected-resource/wp-json/mcp/mad4b-read"'
            : null;
        },
      },
    };
  };

  const lifecycleApp = express();
  lifecycleApp.use(express.json());
  lifecycleApp.use((req, _res, next) => {
    req.auth = {
      mode: "user_jwt",
      user_id: "user-multi",
      tenant_id: "tenant-b",
      claims: { user_id: "user-multi", tenant_id: "tenant-b", email: "multi@example.com" },
      email: "multi@example.com",
      is_admin: false,
    };
    next();
  });
  lifecycleApp.use(buildTenantConnectionSelfRepairRoutes({ pool: lifecyclePool, fetchImpl: fixedFetch, env: process.env }));
  const lifecycleServer = await startServer(lifecycleApp);
  try {
    const prepared = await fetch(`${lifecycleServer.baseUrl}/connect/api/wordpress-mcp/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site_url: "https://staging.egypttourgates.com" }),
    });
    const preparedBody = await prepared.json();
    assert.equal(prepared.status, 201);
    assert.equal(preparedBody.credentials_stored, false);
    assert.equal(preparedBody.subject_binding_required, true);
    assert.equal(preparedBody.lifecycle_state, "active_pending_validation");

    const validated = await fetch(`${lifecycleServer.baseUrl}/connect/api/wordpress-mcp/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connection_id: preparedBody.connection_id }),
    });
    const validatedBody = await validated.json();
    assert.equal(validated.status, 200);
    assert.equal(validatedBody.metadata_ready, true);
    assert.equal(validatedBody.subject_binding_verified, false);
    assert.equal(validatedBody.ready, false);
    assert.equal(validatedBody.next_action, "complete_subject_binding_and_live_oauth_canary");

    const lifecycle = await fetch(`${lifecycleServer.baseUrl}/connect/api/connections/lifecycle`);
    const lifecycleBody = await lifecycle.json();
    assert.equal(lifecycle.status, 200);
    assert.equal(lifecycleBody.lifecycle_contract, "mad4b.tenant-connection-lifecycle.v1");
    assert.equal(lifecycleBody.items[0].federation_profile, "wordpress_staging_mcp_rs256_v1");
    assert.equal(lifecycleBody.items[0].lifecycle_state, "active_pending_validation");

    const revoked = await fetch(`${lifecycleServer.baseUrl}/connect/api/connections/${encodeURIComponent(preparedBody.connection_id)}`, { method: "DELETE" });
    assert.equal(revoked.status, 204);
    for (const table of ["app_action_grants", "app_action_requests", "workspace_app_links", "cms_site_access_grants", "credential_bindings", "cms_account_claims", "user_app_connections"]) {
      assert(lifecycleQueries.some((entry) => entry.sql.startsWith(`UPDATE \`${table}\``)), `revoke cascade must update ${table}`);
    }
  } finally {
    lifecycleServer.server.close();
  }

  const uiSource = readFileSync(new URL("./public/connect/app.jsx", import.meta.url), "utf8");
  assert.match(uiSource, /\/connect\/api\/active-context/);
  assert.doesNotMatch(uiSource, /\/auth\/select-tenant/);
  assert.doesNotMatch(uiSource, /memberships_count > 1 \? SAMPLE_MEMBERSHIPS/);
  assert.match(uiSource, /\/connect\/api\/connections\/lifecycle/);
  assert.match(uiSource, /\/connect\/api\/wordpress-mcp\/prepare/);
  assert.match(uiSource, /\/connect\/api\/wordpress-mcp\/validate/);

  const adapterSource = readFileSync(new URL("./appAdapters/index.js", import.meta.url), "utf8");
  assert.match(adapterSource, /credential_refresh_persistence_uncertain/);
  assert.match(adapterSource, /validation_status = 'reauth_required'/);
  assert.doesNotMatch(adapterSource, /non-blocking — don't fail the call if DB update fails/);

  console.log("tenant connection context, lifecycle, WordPress federation and self-repair routes passed");
} finally {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
}
