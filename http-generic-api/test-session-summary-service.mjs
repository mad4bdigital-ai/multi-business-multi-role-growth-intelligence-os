import assert from "node:assert/strict";
import {
  findSessionsNeedingSummary,
  loadSessionTranscript,
  parseSessionJsonl,
  redactSensitiveText,
  summarizeAndStoreSession,
  summarizeSessionIfNeeded,
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
  };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT summary_id FROM `session_summaries`")) return [[]];
      if (compact.startsWith("SELECT turn_index, role, action_key, content_preview")) return [state.fallbackTurns];
      if (compact.startsWith("SELECT cs.* FROM `customer_sessions`")) return [state.sessionsNeedingSummary];
      if (compact.startsWith("INSERT INTO `session_summaries`")) {
        state.insertedSummary = { sql, params };
        return [{ affectedRows: 1 }];
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
}

console.log("session summary service tests passed");
