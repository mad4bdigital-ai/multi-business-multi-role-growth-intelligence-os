import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildTranscriptChunks,
  loadSessionTranscript,
  parseJsonlTranscript,
  summarizeTranscriptWithModel,
} from "./sessionSummaryService.js";

function makePool(rows = []) {
  return {
    calls: [],
    async query(sql, params = []) {
      this.calls.push({ sql, params });
      const compact = sql.replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT turn_id, turn_index")) return [rows];
      return [[]];
    },
  };
}

{
  const raw = [
    JSON.stringify({ turn_index: 0, role: "user", content: "Start work with BACKEND_API_KEY=secret-value", action_key: null }),
    JSON.stringify({ turn_index: 1, role: "assistant", content: "Implemented session summaries", action_key: "repo_patch_apply" }),
  ].join("\n");
  const turns = parseJsonlTranscript(raw);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].role, "user");
  assert.equal(turns[0].content.includes("secret-value"), false, "secret-looking values must be redacted before summarization");
  assert.equal(turns[1].action_key, "repo_patch_apply");
}

{
  const turns = Array.from({ length: 20 }, (_, i) => ({ turn_index: i, role: i % 2 ? "assistant" : "user", content: "x".repeat(900) }));
  const chunks = buildTranscriptChunks(turns, { maxCharsPerChunk: 2000, maxChunks: 5 });
  assert(chunks.length > 1, "large transcripts should be chunked");
  assert(chunks.length <= 5, "chunk count must be bounded");
}

{
  const raw = JSON.stringify({ turn_index: 0, role: "user", content: "Drive JSONL wins" });
  const pool = makePool([{ turn_id: "sql-1", turn_index: 0, role: "user", content_preview: "SQL preview only" }]);
  const transcript = await loadSessionTranscript({
    pool,
    session: { session_id: "sess-1", drive_jsonl_id: "jsonl-1" },
    fetchDriveContentFn: async () => `${raw}\n`,
  });
  assert.equal(transcript.source, "drive_jsonl");
  assert.equal(transcript.turns[0].content, "Drive JSONL wins");
}

{
  const pool = makePool([{ turn_id: "sql-1", turn_index: 0, role: "assistant", content_preview: "Fallback preview", action_key: "repo_patch_apply" }]);
  const transcript = await loadSessionTranscript({
    pool,
    session: { session_id: "sess-2", drive_jsonl_id: "jsonl-missing" },
    fetchDriveContentFn: async () => { throw new Error("drive missing"); },
  });
  assert.equal(transcript.source, "sql_preview");
  assert.equal(transcript.turns[0].content, "Fallback preview");
  assert.equal(transcript.drive_error.code, "drive_jsonl_read_failed");
}

{
  const calls = [];
  const callModel = async (messages) => {
    calls.push(messages);
    return { content: JSON.stringify({
      summary_text: "Implemented summary autosweep with graph attachment.",
      tasks_completed: ["Added autosweep"],
      blockers: [],
      feature_requests: ["Add scheduling"],
      integration_needs: ["Drive JSONL archive"],
      complexity: "medium",
      tags: ["session_summary", "autosweep"],
    }) };
  };
  const insight = await summarizeTranscriptWithModel({
    session: { session_id: "sess-3", tenant_id: "tenant-1" },
    turns: [{ turn_index: 0, role: "user", content: "Please summarize sessions" }],
    callModel,
  });
  assert.equal(insight.summary_text.includes("autosweep"), true);
  assert.deepEqual(insight.tasks_completed, ["Added autosweep"]);
  assert.equal(calls.length, 1);
}

{
  const serviceSource = readFileSync("sessionSummaryService.js", "utf8");
  const gptRoutes = readFileSync("routes/gptSessionRoutes.js", "utf8");
  const devRoutes = readFileSync("routes/devAgentRoutes.js", "utf8");
  const devRunner = readFileSync("devAgentRunner.js", "utf8");
  const migration = readFileSync("migrations/111_sprint62v_session_summary_autosweep.sql", "utf8");
  const docs = readFileSync("../docs/session-context-graph-memory-archive-notes.md", "utf8");

  assert(serviceSource.includes("fetchDriveContent"), "autosweep must use Drive archive as primary transcript source");
  assert(serviceSource.includes("parseJsonlTranscript"), "autosweep must parse Drive JSONL transcripts");
  assert(serviceSource.includes("content_preview"), "SQL fallback must use previews only");
  assert(serviceSource.includes("json_assets"), "summaries should become graph-memory assets");
  assert(serviceSource.includes("platform_graph_edges"), "summaries should attach to graph context");
  assert(gptRoutes.includes("summarizeSessionIfNeeded"), "endSession must trigger autosummary");
  assert(gptRoutes.includes("session_summary: summaryResult"), "endSession response must expose summary result");
  assert(devRoutes.includes("/dev-agent/session-summaries/autosweep"), "manual autosweep route must exist");
  assert(devRunner.includes("runSessionSummaryAutosweep"), "dev-agent phase 1 must use Drive-backed autosweep");
  assert(migration.includes("tags_json") && migration.includes("summary_sha256") && migration.includes("source_drive_jsonl_id"));
  assert(docs.includes("Status: implemented by `feature/session-summary-autosweep`"));
}

console.log("session summary autosweep tests passed");
