import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildActivationPlatformAccess,
  buildEnvelopeTranscript,
  capLimit,
  normalizeOffset,
  resolveSessionContextSubject,
  SESSION_CONTEXT_DEFAULT_LIMIT,
  SESSION_CONTEXT_MAX_LIMIT,
  resolveRequestedEvolutionScope
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
  assert.equal(source.includes("session_status = 'completed'"), true);
  assert.equal(source.includes("VALUES (?, ?, ?, 'gpt_action', 'active', ?)"), true);
  assert.equal(source.includes("close_previous_sessions: asBoolean(req.query.close_previous_sessions)"), true);
  assert.equal(source.includes("conversation_memory: conversationMemory"), true);
  assert.equal(source.includes("native_chatgpt_history_available: false"), true);
  assert.equal(source.includes("prefer_graph_backed_session_summary_memory_then_sql_fallback"), true);
  assert.equal(source.includes("loadSessionSummaryGraphMemory"), true);
  assert.equal(source.includes("session_summary_memory"), true);
  assert.equal(source.includes("graph_backed_session_summaries"), true);
  assert.equal(source.includes("session_summary_fallback_used"), true);
  assert.equal(source.includes("session_summaries_sql_fallback"), true);
  assert.equal(source.includes("include_turns: asBoolean(req.query.include_turns)"), true);
  assert.equal(source.includes("include_turns: includeTurns"), true);
  assert.equal(source.includes("platform_pending_tasks.conversation_context_ref"), true);
  assert.equal(source.includes("INFORMATION_SCHEMA.COLUMNS"), true);
  assert.equal(source.includes("NULL AS brief"), true);
  assert.equal(source.includes("NULL AS activation_prompt"), true);
  assert.equal(source.includes("NULL AS conversation_context_ref"), true);
  assert.equal(source.includes("resolvePlatformGraphMemory"), true);
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

console.log("activation session context tests passed");
