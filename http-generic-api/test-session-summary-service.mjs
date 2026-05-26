import assert from "node:assert/strict";
import {
  findSessionsNeedingSummary,
  loadSessionSummaryGraphMemory,
  loadSessionTranscript,
  parseSessionJsonl,
  redactSensitiveText,
  summarizeAndStoreSession,
  summarizeSessionIfNeeded,
  summarizeSessionTranscript,
  runSessionSummaryAutosweep,
  writeProvidedSessionSummary,
} from "./sessionSummaryService.js";

function makePool() {
  const state = {
    calls: [],
    insertedSummary: null,
    fallbackTurns: [
      {
        turn_index: 0,
        role: "user",
        action_key: null,
        content_preview: "Fallback preview only",
        content_sha256: "hash-preview",
        created_at: "2026-05-23T00:00:00.000Z",
      },
    ],
    sessionsNeedingSummary: [
      {
        session_id: "sess-needs-summary",
        tenant_id: "tenant-1",
        user_id: "user-1",
        originator: "gpt_action",
        session_status: "completed",
        turn_count: 2,
      },
    ],
    insertedExecutionLog: null,
    insertedGraphNodes: [],
    insertedGraphEdge: null,
  };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT summary_id FROM `session_summaries`")) return [[]];
      if (compact.startsWith("SELECT summary_id, session_id, tenant_id, turn_count, created_at FROM `session_summaries`")) {
        if (state.insertedSummary && params[0] === state.insertedSummary.params[0]) {
          return [[{
            summary_id: state.insertedSummary.params[0],
            session_id: state.insertedSummary.params[1],
            tenant_id: state.insertedSummary.params[2],
            turn_count: state.insertedSummary.params[12],
            created_at: "2026-05-24T00:00:00.000Z",
          }]];
        }
        return [[]];
      }
      if (compact.startsWith("SELECT summary_id, session_id, tenant_id, user_id, workspace_key,")) {
        if (state.insertedSummary && (!params[0] || params[0] === state.insertedSummary.params[1])) {
          return [[{
            summary_id: state.insertedSummary.params[0],
            session_id: state.insertedSummary.params[1],
            tenant_id: state.insertedSummary.params[2],
            user_id: state.insertedSummary.params[3],
            workspace_key: state.insertedSummary.params[4],
            summary_text: state.insertedSummary.params[5],
            tasks_completed: state.insertedSummary.params[6],
            blockers: state.insertedSummary.params[7],
            feature_requests: state.insertedSummary.params[8],
            integration_needs: state.insertedSummary.params[9],
            complexity: state.insertedSummary.params[10],
            turn_count: state.insertedSummary.params[12],
            created_at: "2026-05-24T00:00:00.000Z",
          }]];
        }
        return [[]];
      }
      if (compact.startsWith("SELECT asset_id, validation_status, active_status FROM `json_assets`")) {
        const assetInsert = state.calls.find((call) => String(call.sql).includes("INSERT INTO `json_assets`"));
        if (assetInsert && params[0] === assetInsert.params[2]) {
          return [[{ asset_id: assetInsert.params[0], validation_status: "validated", active_status: "active" }]];
        }
        return [[]];
      }
      if (compact.startsWith("SELECT node_id, node_type, lifecycle_status FROM `platform_graph_nodes`")) {
        const wanted = new Set(params);
        return [state.insertedGraphNodes.filter((row) => wanted.has(row.node_id))];
      }
      if (compact.startsWith("SELECT edge_id, source_node_id, target_node_id, lifecycle_status FROM `platform_graph_edges`")) {
        const edge = state.insertedGraphEdge;
        if (edge && edge.edge_id === params[0] && edge.source_node_id === params[1] && edge.target_node_id === params[2]) {
          return [[edge]];
        }
        return [[]];
      }
      if (compact.startsWith("SELECT turn_index, role, action_key, content_preview")) return [state.fallbackTurns];
      if (compact.startsWith("SELECT cs.* FROM `customer_sessions`")) return [state.sessionsNeedingSummary];
      if (compact.startsWith("INSERT INTO `session_summaries`")) {
        state.insertedSummary = { sql, params };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("INSERT INTO `platform_graph_nodes`")) {
        state.insertedGraphNodes = [
          { node_id: params[0], node_type: "conversation", lifecycle_status: "active" },
          { node_id: params[5], node_type: "json_asset", lifecycle_status: "active" },
        ];
        return [{ affectedRows: 2 }];
      }
      if (compact.startsWith("INSERT INTO `platform_graph_edges`")) {
        state.insertedGraphEdge = {
          edge_id: params[0],
          source_node_id: params[1],
          target_node_id: params[2],
          lifecycle_status: "active",
        };
        return [{ affectedRows: 1 }];
      }
      if (compact.includes("FROM `registry_surfaces_catalog`")) {
        const key = params[0];
        const common = {
          surface_type: "registry",
          surface_scope: "runtime",
          storage_type: "sql_tables",
          active_status: "active",
          authority_status: "authoritative",
          required_for_execution: "TRUE",
          resolution_rule: "sql_primary",
          source_surface_id: null,
          source_surface_role: null,
          retired_replacement_surface_id: null,
          backend_type: "sql",
          authority_model: "sql_runtime_authority",
          repair_priority: "medium",
          updated_at: "2026-05-25T00:00:00.000Z",
        };
        if (key === "surface.json_asset_registry_sheet") {
          return [[{
            ...common,
            surface_id: "surface.json_asset_registry_sheet",
            logical_surface_key: "surface.json_asset_registry_sheet",
            surface_name: "JSON Asset Registry",
            owner_layer: "artifact_memory_runtime",
            schema_ref: "json_assets",
            schema_version: "1",
            binding_mode: "sql_runtime_authority",
            sheet_role: "artifact_memory",
            backend_adapter: "json_assets_readback_artifact_layer",
            portability_class: "runtime_memory_artifact",
            repair_candidate_types: "surface_authority|readback|artifact_integrity",
          }]];
        }
        if (key === "surface.platform_graph_memory") {
          return [[{
            ...common,
            surface_id: "surface.platform_graph_memory",
            logical_surface_key: "surface.platform_graph_memory",
            surface_name: "Platform Graph Memory",
            owner_layer: "memory_graph_runtime",
            schema_ref: "platform_graph_nodes|platform_graph_edges",
            schema_version: "1",
            binding_mode: "sql_runtime_authority",
            sheet_role: "memory_graph_nodes_edges",
            backend_adapter: "platform_graph_memory_writer",
            portability_class: "runtime_memory_graph",
            repair_candidate_types: "surface_authority|readback|graph_integrity",
          }]];
        }
        return [[{
          ...common,
          surface_id: "surface.operations_log_unified_sheet",
          logical_surface_key: "surface.operations_log_unified_sheet",
          surface_name: "Execution Log Unified",
          storage_type: "workbook_sheet",
          owner_layer: "runtime_audit",
          schema_ref: null,
          schema_version: null,
          binding_mode: "sql_runtime_authority",
          sheet_role: "append_only_log",
          backend_adapter: "executionEvidenceLogger",
          portability_class: "runtime_evidence",
          repair_candidate_types: null,
        }]];
      }
      if (compact.startsWith("INSERT INTO execution_log") || compact.startsWith("INSERT INTO `execution_log`")) {
        state.insertedExecutionLog = { sql, params, id: 42 };
        return [{ affectedRows: 1, insertId: 42 }];
      }
      if (compact.includes("FROM execution_log") || compact.includes("FROM `execution_log`")) {
        if (state.insertedExecutionLog && params[0] === state.insertedExecutionLog.params[24]) {
          return [[{
            id: state.insertedExecutionLog.id,
            execution_status: state.insertedExecutionLog.params[12],
            execution_trace_id_writeback: state.insertedExecutionLog.params[24],
          }]];
        }
        return [[]];
      }
      return [[]];
    },
  };
}

{
  assert.equal(typeof summarizeSessionIfNeeded, "function");
  assert.equal(typeof writeProvidedSessionSummary, "function");
}

{
  const redacted = redactSensitiveText("Authorization: Bearer sk_live_123 password=supersecret api_key:abc123");
  assert(!redacted.includes("sk_live_123"));
  assert(!redacted.includes("supersecret"));
  assert(!redacted.includes("abc123"));
  assert(redacted.includes("[REDACTED]"));
}

{
  const events = parseSessionJsonl([
    JSON.stringify({ role: "user", turn_index: 0, content: "Do the thing token=supersecret" }),
    JSON.stringify({ role: "assistant", turn_index: 1, content: "Done" }),
  ].join("\n"));
  assert.equal(events.length, 2);
  assert.equal(events[0].role, "user");
  assert.equal(events[0].turn_index, 0);
  assert(events[0].content.includes("[REDACTED]"));
  assert(!events[0].content.includes("supersecret"));
}

{
  const pool = makePool();
  const session = {
    session_id: "sess-drive",
    tenant_id: "tenant-1",
    user_id: "user-1",
    workspace_key: "platform_admin",
    model_name: "test-model",
    turn_count: 2,
    drive_jsonl_id: "jsonl-1",
  };
  let modelInput = "";
  const result = await summarizeAndStoreSession({
    pool,
    session,
    injectedDeps: {
      async fetchDriveContent(fileId) {
        assert.equal(fileId, "jsonl-1");
        return [
          JSON.stringify({ role: "user", turn_index: 0, content: "Please implement autosweep token=supersecret" }),
          JSON.stringify({ role: "assistant", turn_index: 1, content: "Implemented Drive-first summary." }),
        ].join("\n");
      },
    },
    async callModel(messages) {
      modelInput = messages.map((message) => message.content).join("\n");
      assert(modelInput.includes("autosweep"));
      assert(!modelInput.includes("supersecret"));
      return {
        content: JSON.stringify({
          summary_text: "Implemented Drive-first autosummary for GPT sessions.",
          tasks_completed: ["Added autosummary service"],
          blockers: [],
          feature_requests: ["Summary-first activation"],
          integration_needs: [],
          complexity: "high",
        }),
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.transcript_source, "drive_jsonl");
  assert.equal(result.fallback_used, false);
  assert.equal(result.events_loaded, 2);
  assert(pool.state.insertedSummary, "session summary should be inserted");
  assert.equal(pool.state.insertedSummary.params[5], "Implemented Drive-first autosummary for GPT sessions.");
  assert.equal(pool.state.insertedSummary.params[10], "high");
  assert(
    pool.state.calls.some((call) => String(call.sql).includes("INSERT INTO `json_assets`")),
    "summary write should create a summary-only json asset"
  );
  assert(
    pool.state.calls.some((call) => String(call.sql).includes("INSERT INTO `json_asset_subject_links`")),
    "summary write should attach the asset to the conversation subject"
  );
  assert(
    pool.state.calls.some((call) => String(call.sql).includes("INSERT INTO `platform_graph_nodes`")),
    "summary write should upsert graph nodes"
  );
  assert(
    pool.state.calls.some((call) => String(call.sql).includes("INSERT INTO `platform_graph_edges`")),
    "summary write should upsert graph edges"
  );
  assert(pool.state.insertedExecutionLog, "summary write should create a durable execution_log row");
  assert.equal(result.verification.graph_conversation_node_present, true);
  assert.equal(result.verification.graph_asset_node_present, true);
  assert.equal(result.verification.graph_edge_present, true);
  assert.equal(result.verification.graph_topology_present, true);
  assert.equal(result.execution_log.ok, true);
  assert.equal(result.execution_log.execution_log_id, 42);
  assert.equal(result.execution_log.execution_trace_id, result.summary_id);
  assert(
    pool.state.insertedExecutionLog.params[13].includes("summary_row_present"),
    "execution_log output_summary should include verification evidence"
  );
}

{
  const pool = makePool();
  const transcript = await loadSessionTranscript({
    pool,
    session: { session_id: "sess-preview-only", drive_jsonl_id: null },
  });
  assert.equal(transcript.source, "sql_preview");
  assert.equal(transcript.fallback_used, true);
  assert.equal(transcript.events[0].content, "Fallback preview only");
  assert(
    pool.state.calls.some((call) => String(call.sql).includes("content_preview")),
    "fallback must read bounded previews, not SQL full content"
  );
}

{
  const pool = makePool();
  const sessions = await findSessionsNeedingSummary({ pool, batchSize: 5, minAgeSeconds: 0 });
  assert.equal(sessions.length, 1);
  const query = pool.state.calls.at(-1).sql;
  assert(query.includes("cs.originator = 'gpt_action'"));
  assert(query.includes("cs.session_status IN ('completed', 'closed')"));
  assert(query.includes("ss.summary_id IS NULL"));
}

{
  const pool = makePool();
  const result = await runSessionSummaryAutosweep({ pool, callModel: null, limit: 1, minAgeSeconds: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.sessions_considered, 1);
  assert.equal(result.summaries_created, 1);
  assert(pool.state.insertedSummary, "fallback summary should be inserted without model deps");
  assert.match(
    pool.state.insertedSummary.params[5],
    /deterministic fallback summary/,
    "fallback summary should record model configuration warning"
  );
  assert.equal(
    result.results[0].execution_log.execution_status,
    "success_with_warnings",
    "preview-only transcript fallback should be visible in durable execution_log status"
  );
  assert.equal(pool.state.insertedExecutionLog.params[14], "transcript_fallback_used");
  assert.equal(pool.state.insertedExecutionLog.params[15], "missing_drive_jsonl_id");
}

{
  const insight = await summarizeSessionTranscript({
    session: { session_id: "sess-model-error", turn_count: 1 },
    transcript: {
      source: "sql_preview",
      events: [{ turn_index: 0, role: "user", content: "summarize" }],
    },
    async callModel() {
      throw new Error('Anthropic API 401: {"type":"error","error":{"message":"invalid x-api-key"},"request_id":"req_secret"}');
    },
  });
  assert.match(insight.summary_text, /model_call_failed: Anthropic API 401/);
  assert(!insight.summary_text.includes("invalid x-api-key"));
  assert(!JSON.stringify(insight.blockers).includes("req_secret"));
}

console.log("session summary service tests passed");
