import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildActivationPlatformAccess,
  buildActivationAuthorizedAccess,
  buildEnvelopeTranscript,
  capLimit,
  normalizeOffset,
  resolveSessionContextSubject,
  SESSION_CONTEXT_DEFAULT_LIMIT,
  SESSION_CONTEXT_MAX_LIMIT,
  resolveRequestedEvolutionScope,
  shouldOpenActivationSession
} from "./routes/activationRoutes.js";

{
  const subject = resolveSessionContextSubject({
    auth: { mode: "user_jwt", is_admin: false, user_id: "user-1" },
    query: {}
  });
  assert.equal(subject.user_id, "user-1");
  assert.equal(subject.is_admin, false);
}

{
  const subject = resolveSessionContextSubject({
    auth: { mode: "backend_api_key", is_admin: true },
    query: { user_id: "user-2", tenant_id: "tenant-1" }
  });
  assert.equal(subject.user_id, "user-2");
  assert.equal(subject.tenant_id, "tenant-1");
  assert.equal(subject.is_admin, true);
}

{
  assert.throws(
    () => resolveSessionContextSubject({
      auth: { mode: "user_jwt", is_admin: false, user_id: "user-1" },
      query: { user_id: "user-2" }
    }),
    /cannot inspect another user's activation session context/
  );
}

assert.equal(capLimit(undefined), 50);
assert.equal(capLimit(500), 200);
assert.equal(capLimit(25), 25);
assert.equal(capLimit(undefined, SESSION_CONTEXT_DEFAULT_LIMIT, SESSION_CONTEXT_MAX_LIMIT), 10);
assert.equal(capLimit(500, SESSION_CONTEXT_DEFAULT_LIMIT, SESSION_CONTEXT_MAX_LIMIT), 50);
assert.equal(normalizeOffset(undefined), 0);
assert.equal(normalizeOffset(-1), 0);
assert.equal(normalizeOffset(40), 40);
assert.equal(shouldOpenActivationSession({}), true);
assert.equal(shouldOpenActivationSession({ read_only: "true" }), false);
assert.equal(shouldOpenActivationSession({ no_open_session: "true" }), false);
assert.equal(shouldOpenActivationSession({ context_only: "true" }), false);

{
  const scope = resolveRequestedEvolutionScope({}, { is_admin: true });
  assert.equal(scope, "brand:growth_intelligence_platform|tenant:00000000-0000-4000-a000-000000000010");
}

{
  const scope = resolveRequestedEvolutionScope(
    { evolution_brand_key: "brand_a", evolution_tenant_id: "tenant-a" },
    { is_admin: false, tenant_id: "tenant-a", user_id: "user-a" }
  );
  assert.equal(scope, "brand:brand_a|tenant:tenant-a");
}

{
  const scope = resolveRequestedEvolutionScope({}, { is_admin: false, tenant_id: "tenant-a", user_id: "user-a" });
  assert.equal(scope, null);
}

{
  const transcript = buildEnvelopeTranscript({
    request_json: JSON.stringify({
      raw_input: "User asked for last sessions",
      ai_response: "Here is the session history."
    })
  });
  assert.equal(transcript.user_request, "User asked for last sessions");
  assert.equal(transcript.ai_response, "Here is the session history.");
}

{
  const transcript = buildEnvelopeTranscript({
    request_json: "{bad json"
  });
  assert.equal(transcript.user_request, null);
  assert.deepEqual(transcript.request_fields_available, []);
}

{
  const transcript = buildEnvelopeTranscript({
    request_json: JSON.stringify({
      raw_input: "x".repeat(2500)
    })
  });
  assert.equal(transcript.user_request.endsWith("...[truncated]"), true);
}

{
  const source = readFileSync("routes/activationRoutes.js", "utf8");
  assert.equal(source.includes("close_previous_sessions_requested"), true);
  assert.equal(source.includes("parallel_sessions_allowed: true"), true);
  assert.equal(source.includes("mode: \"open_new_session\""), true);
  assert.equal(source.includes("mode: \"read_only_existing_session\""), true);
  assert.equal(source.includes("shouldOpenActivationSession"), true);
  assert.equal(source.includes("readOnlyGptSessionContext"), true);
  assert.equal(source.includes('router.get("/activation/session-context/read-only"'), true);
  assert.equal(source.includes("activation_session_context_read_only_failed"), true);
  assert.equal(source.includes("Session Context read-only mode can inspect context without minting a fresh session id"), true);
  assert.equal(source.includes("session_status = 'completed'"), true);
  assert.equal(source.includes("deferred_until_first_turn"), true);
  assert.equal(source.includes("archive_allocation: \"lazy_on_first_turn\""), true);
  assert.equal(source.includes("VALUES (?, ?, ?, 'gpt_action', 'active', ?, ?)"), true);
  assert.equal(source.includes("ensureSessionArchive(pool"), false);
  assert.equal(source.includes("close_previous_sessions: asBoolean(req.query.close_previous_sessions)"), true);
  assert.equal(source.includes("conversation_memory: conversationMemory"), true);
  assert.equal(source.includes("authorized_access: authorizedAccess"), true);
  assert.equal(source.includes("buildActivationAuthorizedAccess(req, subject)"), true);
  assert.equal(source.includes("activation_dynamic_authorization_envelope"), true);
  assert.equal(source.includes("do_not_infer_access_from_global_counts: true"), true);
  assert.equal(source.includes("do_not_return_secret_values: true"), true);
  assert.equal(source.includes("native_chatgpt_history_available: false"), true);
  assert.equal(source.includes("prefer_graph_backed_session_summary_memory_then_sql_fallback"), true);
  assert.equal(source.includes("loadSessionSummaryGraphMemory"), true);
  assert.equal(source.includes("isRuntimeActionAuthorizedForSubject"), true);
  assert.equal(source.includes("actionPermissionCandidates"), true);
  assert.equal(source.includes("LIMIT ${isAdmin ? limit : Math.min(limit * 20, 500)}"), true);
  assert.equal(source.includes("session_summary_memory"), true);
  assert.equal(source.includes("graph_backed_session_summaries"), true);
  assert.equal(source.includes("session_summary_fallback_used"), true);
  assert.equal(source.includes("session_summaries_sql_fallback"), true);
  assert.equal(source.includes("include_turns: asBoolean(req.query.include_turns)"), true);
  assert.equal(source.includes("includeSmokeSessions = asBoolean(req.query.include_smoke_sessions)"), true);
  assert.equal(source.includes("originator IN ('gpt_action', 'gpt_action_smoke')"), true);
  assert.equal(source.includes("include_turns: includeTurns"), true);
  assert.equal(source.includes("platform_pending_tasks.conversation_context_ref"), true);
  assert.equal(source.includes("platform_evolution: platformEvolution"), true);
  assert.equal(source.includes("loadPlatformEvolutionCheckpointContext"), true);
  assert.equal(source.includes("v_platform_evolution_activation_card"), true);
  assert.equal(source.includes("platform_evolution_degraded"), true);
  assert.equal(source.includes("INFORMATION_SCHEMA.COLUMNS"), true);
  assert.equal(source.includes("NULL AS brief"), true);
  assert.equal(source.includes("NULL AS activation_prompt"), true);
  assert.equal(source.includes("NULL AS conversation_context_ref"), true);
  assert.equal(source.includes("resolvePlatformGraphMemory"), true);
  assert.equal(source.includes("loadTenantGptActivationContext"), true);
  assert.equal(source.includes("activation_context: activationContext"), true);
  assert.equal(source.includes("accessJti = req.auth?.claims?.jti"), true);
}

{
  const query = async (sql) => {
    if (sql.includes("FROM `brands`") && sql.includes("DISTINCT")) return { ok: true, rows: [{ count: 2 }] };
    if (sql.includes("FROM `brands`")) return { ok: true, rows: [{ count: 3 }] };
    if (sql.includes("FROM `actions`") && sql.includes("runtime_callable")) return { ok: true, rows: [{ count: 7 }] };
    if (sql.includes("FROM `actions`")) return { ok: true, rows: [{ count: 9 }] };
    if (sql.includes("FROM `plugins`") && sql.includes("active_plugins")) return { ok: true, rows: [{ count: 2 }] };
    if (sql.includes("FROM `plugins`")) return { ok: true, rows: [{ count: 2 }] };
    if (sql.includes("FROM `logic_definitions`") && sql.includes("status")) return { ok: true, rows: [{ count: 5 }] };
    if (sql.includes("FROM `logic_definitions`")) return { ok: true, rows: [{ count: 6 }] };
    if (sql.includes("FROM `workflows`")) {
      return {
        ok: true,
        rows: [
          { mapped_engines: "engine_a|engine_b", linked_engines: "engine_c", engine_order: "engine_b,engine_d" }
        ]
      };
    }
    if (sql.includes("FROM `execution_log`")) {
      return {
        ok: true,
        rows: [
          { used_engine_names: "engine_e;engine_a", used_engine_registry_refs: "engine_f" }
        ]
      };
    }
    return { ok: false, rows: [], error: { code: "unexpected_query", message: sql } };
  };

  const access = await buildActivationPlatformAccess(
    { auth: { mode: "backend_api_key", is_admin: true } },
    { query }
  );

  assert.equal(access.access_scope, "platform_admin_all");
  assert.equal(access.access.brands, "all_brands");
  assert.equal(access.counts.brands.total, 3);
  assert.equal(access.counts.brands.distinct_targets, 2);
  assert.equal(access.counts.actions.runtime_callable, 7);
  assert.equal(access.counts.plugins.active_inventory_rows, 2);
  assert.equal(access.counts.logics.active, 5);
  assert.equal(access.counts.engines.distinct_references, 6);
  assert.deepEqual(access.degraded_surfaces, []);
}

{
  const queries = [];
  const query = async (sql) => {
    queries.push(sql);
    if (sql.includes("FROM `activation_authorized_surface_registry`")) return { ok: true, rows: [{ surface_key: "workspace_registry", display_name: "Authorized Workspaces", source_table: "workspace_registry", result_key_column: "workspace_key", result_label_column: "display_name", tenant_column: "tenant_id", user_column: null, status_column: "bootstrap_status", active_status_values_json: JSON.stringify(["ready"]), result_columns_json: JSON.stringify(["workspace_id", "tenant_id", "workspace_key", "display_name", "credential_ref", "config_json"]), include_for_admin: 1, include_for_tenant: 1, max_rows: 5, sort_order: 10, status: "active" }] };
    if (sql.includes("FROM `memberships`")) return { ok: true, rows: [{ tenant_id: "tenant-a", role: "owner", status: "active" }] };
    if (sql.includes("FROM `role_assignments`")) return { ok: true, rows: [{ tenant_id: "tenant-a", role: "growth_operator", status: "active" }] };
    if (sql.includes("FROM `workspace_registry`")) return { ok: true, rows: [{ workspace_id: "workspace-1", tenant_id: "tenant-a", workspace_key: "brand_a", display_name: "Brand A", workspace_type: "brand", bootstrap_status: "ready", linked_brand_key: "brand_a", linked_system_ids: "system-1,system-2" }] };
    if (sql.includes("FROM `connected_systems`")) return { ok: true, rows: [{ system_id: "system-1", tenant_id: "tenant-a", system_key: "wp", display_name: "WordPress", provider_family: "wordpress", connector_family: "wordpress_rest", auth_type: "oauth", service_mode: "managed", status: "active" }] };
    if (sql.includes("FROM `installations`")) return { ok: true, rows: [{ installation_id: "install-1", system_id: "system-1", tenant_id: "tenant-a", scope: "posts.read,posts.write", status: "active", expires_at: null }] };
    if (sql.includes("FROM `permission_grants`")) return { ok: true, rows: [{ permission_key: "wp_publish", tenant_id: "tenant-a", installation_id: "install-1", granted: 1 }] };
    if (sql.includes("FROM `actions`")) return { ok: true, rows: [{ action_key: "wp_publish", action_title: "Publish", action_class: "content", connector_family: "wordpress_rest", runtime_capability_class: "cms_write", runtime_callable: "true", admin_only: "false", allowed_actor_roles: "owner,growth_operator", allowed_governance_levels: "tenant" }] };
    return { ok: false, rows: [], error: { code: "unexpected_query", message: sql } };
  };

  const access = await buildActivationAuthorizedAccess(
    { auth: { mode: "user_jwt", is_admin: false, user_id: "user-a", tenant_id: "tenant-a" }, query: {} },
    { is_admin: false, user_id: "user-a", tenant_id: "tenant-a" },
    { query }
  );

  assert.equal(access.source, "activation_dynamic_authorization_envelope");
  assert.equal(access.scope_resolution, "tenant_user_authorized_only");
  assert.equal(access.counts.workspaces, 1);
  assert.equal(access.counts.connected_systems, 1);
  assert.equal(access.counts.permission_grants, 1);
  assert.equal(access.counts.runtime_actions, 1);
  assert.equal(access.counts.admin_tools, 0);
  assert.equal(access.counts.registered_surfaces, 1);
  assert.deepEqual(access.authorized.permission_keys, ["wp_publish"]);
  assert.deepEqual(access.authorized.connector_families, ["wordpress_rest"]);
  assert.deepEqual(access.authorized.runtime_actions.map((action) => action.action_key), ["wp_publish"]);
  assert.equal(access.activation_policy.use_authorized_access_for_context_selection, true);
  assert.equal(access.activation_policy.do_not_infer_access_from_global_counts, true);
  assert.equal(access.authorized.registered_surfaces.length, 1);
  assert.equal(access.authorized.registered_surfaces[0].surface_key, "workspace_registry");
  assert.equal(JSON.stringify(access.authorized.registered_surfaces).includes("credential_ref"), false);
  assert.equal(JSON.stringify(access.authorized.registered_surfaces).includes("config_json"), false);
  assert.equal(access.secrets_included, false);
  assert.equal(JSON.stringify(access).includes("credential_ref"), false);
  assert.equal(queries.some((sql) => sql.includes("tenant_id = ?")), true);
}

{
  const query = async (sql) => {
    if (sql.includes("FROM `workspace_registry`")) return { ok: true, rows: [] };
    if (sql.includes("FROM `connected_systems`")) return { ok: true, rows: [] };
    if (sql.includes("FROM `installations`")) return { ok: true, rows: [] };
    if (sql.includes("FROM `permission_grants`")) return { ok: true, rows: [] };
    if (sql.includes("FROM `actions`")) return { ok: true, rows: [] };
    if (sql.includes("FROM `admin_platform_endpoint_tools`")) return { ok: true, rows: [{ tool_key: "release_readiness", display_name: "Release Readiness", http_method: "POST", http_path: "/gpt/tools/call", tags: "admin,readiness" }] };
    return { ok: true, rows: [] };
  };
  const access = await buildActivationAuthorizedAccess(
    { auth: { mode: "backend_api_key", is_admin: true }, query: { authorized_access_limit: "5" } },
    { is_admin: true, user_id: null, tenant_id: null },
    { query }
  );
  assert.equal(access.scope_resolution, "platform_admin_all_with_optional_subject_filter");
  assert.equal(access.counts.admin_tools, 1);
  assert.equal(access.authorized.admin_tools[0].tool_key, "release_readiness");
}

console.log("activation session context tests passed");
