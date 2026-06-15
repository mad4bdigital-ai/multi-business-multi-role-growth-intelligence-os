import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import { buildReleaseRoutes } from "./routes/releaseRoutes.js";
import { runSessionArchiveSmoke } from "./sessionArchiveSmoke.js";

const migration = readFileSync("migrations/163_sprint65_session_archive_smoke_tool.sql", "utf8");
const rolloverMigration = readFileSync("migrations/244_sprint68_session_archive_rollover_smoke_schema.sql", "utf8");

assert(migration.includes("release_session_archive_smoke"), "session archive smoke admin tool must be registered");
assert(migration.includes("/release/session-archive-smoke"), "session archive smoke tool must point at release smoke route");
assert(migration.includes("drive-writeback"), "session archive smoke tool must be tagged drive-writeback");
assert(migration.includes("activation-readback"), "session archive smoke tool must be tagged activation-readback");
assert(migration.includes("no_secrets"), "session archive smoke tool must be tagged no_secrets");
assert(migration.includes("cleanup_default_true"), "session archive smoke tool must advertise cleanup_default_true");
assert(rolloverMigration.includes("force_doc_rollover"), "rollover smoke schema must expose force_doc_rollover");
assert(rolloverMigration.includes("doc_rollover_chars"), "rollover smoke schema must expose doc_rollover_chars");
assert(rolloverMigration.includes("rollover-smoke"), "rollover smoke schema must tag rollover-smoke");

function makePool() {
  const state = { session: null, turns: [], events: [], deletes: { session: 0, turns: 0, events: 0 } };
  return {
    state,
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, " ").trim();

      if (compact.startsWith("INSERT INTO `customer_sessions`")) {
        state.session = {
          session_id: params[0],
          tenant_id: params[1],
          user_id: String(params[2] || "").slice(0, 36),
          originator: params[3] || "gpt_action_smoke",
          session_status: "open",
          started_at: new Date("2026-05-16T10:00:00.000Z"),
          turn_count: 0,
        };
        return [{ affectedRows: 1 }];
      }

      if (compact.startsWith("UPDATE `customer_sessions` SET drive_folder_id")) {
        Object.assign(state.session, {
          drive_folder_id: params[0],
          drive_doc_id: params[1],
          drive_doc_url: params[2],
          drive_doc_part_index: params[3],
          drive_doc_part_count: params[4],
          drive_jsonl_id: params[5],
          drive_jsonl_url: params[6],
          drive_exports_folder_id: params[7],
          archive_status: "ready",
        });
        return [{ affectedRows: 1 }];
      }

      if (compact.startsWith("INSERT INTO `gpt_session_turns`")) {
        state.turns.push({
          session_id: params[0],
          tenant_id: params[1],
          user_id: params[3],
          actor_type: params[5],
          correlation_id: params[7],
          turn_id: params[9],
          turn_index: params[10],
          role: params[11],
          content: params[12],
          content_preview: params[14],
          content_sha256: params[15],
          drive_doc_id: params[16],
          drive_anchor: params[17],
          storage_mode: params[18],
        });
        return [{ affectedRows: 1 }];
      }

      if (compact.startsWith("INSERT INTO `session_events`")) {
        state.events.push({ event_id: params[0], session_id: params[1] });
        return [{ affectedRows: 1 }];
      }

      if (compact.startsWith("UPDATE `customer_sessions` SET turn_count")) {
        state.session.turn_count = Number(state.session.turn_count || 0) + 1;
        return [{ affectedRows: 1 }];
      }

      if (compact === "SELECT * FROM `customer_sessions` WHERE session_id = ? LIMIT 1") {
        return [[{ ...state.session }]];
      }

      if (compact.startsWith("UPDATE `customer_sessions` SET session_status = 'completed'")) {
        state.session.session_status = "completed";
        return [{ affectedRows: 1 }];
      }

      if (compact.startsWith("UPDATE `customer_sessions` SET drive_export_id")) {
        state.session.drive_export_id = params[0];
        state.session.drive_export_url = params[1];
        return [{ affectedRows: 1 }];
      }

      if (compact.startsWith("UPDATE `customer_sessions` SET archive_status = ?")) {
        state.session.archive_status = params[0];
        state.session.archive_last_error = params[1];
        return [{ affectedRows: 1 }];
      }

      if (compact.startsWith("SELECT session_id, archive_status, drive_folder_id")) {
        return [[{ ...state.session }]];
      }

      if (compact.startsWith("SELECT turn_index, role, storage_mode")) {
        return [state.turns.map((turn) => ({ ...turn }))];
      }

      if (compact.startsWith("SELECT DISTINCT drive_doc_id FROM `gpt_session_turns`")) {
        return [[...new Set(state.turns.map((turn) => turn.drive_doc_id).filter(Boolean))].map((drive_doc_id) => ({ drive_doc_id }))];
      }

      if (compact.startsWith("DELETE FROM `gpt_session_turns`")) {
        const removed = state.turns.length;
        state.turns = [];
        state.deletes.turns += removed;
        return [{ affectedRows: removed }];
      }

      if (compact.startsWith("DELETE FROM `session_events`")) {
        const removed = state.events.length;
        state.events = [];
        state.deletes.events += removed;
        return [{ affectedRows: removed }];
      }

      if (compact.startsWith("DELETE FROM `customer_sessions`")) {
        const removed = state.session ? 1 : 0;
        state.session = null;
        state.deletes.session += removed;
        return [{ affectedRows: removed }];
      }

      throw new Error(`Unexpected SQL in smoke test: ${compact}`);
    },
  };
}

function makeDriveDeps() {
  const drive = { docText: "", jsonl: "", foldersCreated: [], deletedFiles: [] };
  return {
    drive,
    deps: {
      sessionsDriveFolderId: "root-folder",
      now: () => new Date("2026-05-16T12:00:00.000Z"),
      async getOrCreateDriveFolder(name, parentId) {
        const full = `${parentId}/${name}`;
        drive.foldersCreated.push(full);
        return full;
      },
      async createGoogleDocInDrive(_name, _parentId, initialText) {
        drive.docText += initialText;
        return { drive_file_id: "doc-1", drive_web_url: "https://drive/doc-1" };
      },
      async appendTextToGoogleDoc(_docId, text) {
        drive.docText += text;
      },
      async uploadContentToDrive(content) {
        drive.jsonl = content;
        return { drive_file_id: "jsonl-1", drive_web_url: "https://drive/jsonl-1" };
      },
      async fetchDriveContent() {
        return drive.jsonl;
      },
      async updateDriveFileContent(_fileId, content) {
        drive.jsonl = content;
        return { drive_file_id: "jsonl-1", drive_web_url: "https://drive/jsonl-1" };
      },
    },
    async fetchDriveContent(fileId) {
      if (fileId === "doc-1") return drive.docText;
      if (fileId === "jsonl-1") return drive.jsonl;
      return "";
    },
    async deleteDriveFile(fileId) {
      drive.deletedFiles.push(fileId);
    },
  };
}

// ── Smoke runner test: writes to sequestered subfolder, then cleans up ────────
{
  const pool = makePool();
  const drive = makeDriveDeps();
  let activationReq = null;
  const requestedUserId = "platform_admin_surface_recovery_smoke_debug";
  const result = await runSessionArchiveSmoke({
    pool,
    tenantId: "tenant-1",
    userId: requestedUserId,
    injectedArchiveDeps: drive.deps,
    fetchDriveContentFn: drive.fetchDriveContent,
    deleteDriveFileFn: drive.deleteDriveFile,
    activationContextReader: async (req) => {
      activationReq = req;
      return { gpt_sessions: [{ session_id: pool.state.session.session_id, drive_export_url: "https://drive/doc-1" }] };
    },
  });

  assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
  assert.equal(result.status, "pass");
  assert.equal(result.originator, "gpt_action_smoke", "smoke must keep gpt_action_smoke originator for filtering");
  assert.equal(activationReq?.query?.include_smoke_sessions, true, "smoke activation readback must explicitly request gpt_action_smoke sessions");
  assert.equal(activationReq?.query?.read_only, true, "smoke activation readback must not open a new GPT action session");
  assert.equal(activationReq?.query?.no_open_session, true, "smoke activation readback must not mint a diagnostic session");
  assert.equal(result.smoke_subfolder, "_smoke_archives", "smoke must sequester to _smoke_archives subfolder");
  assert.equal(result.drive.doc_id, "doc-1");
  assert.equal(result.drive.jsonl_id, "jsonl-1");
  assert(result.checks.every((item) => item.pass), "all smoke checks should pass");
  assert(result.checks.some((item) => item.name === "conversation_exchange_complete" && item.pass), "smoke should verify user/assistant/tool/assistant turn capture");
  assert(drive.drive.docText.includes("### Runtime Event"), "doc readback should include runtime JSON");
  assert(drive.drive.docText.includes("Bookmark: turn-0"), "doc readback should include user turn bookmark");
  assert(drive.drive.docText.includes("Bookmark: turn-1"), "doc readback should include assistant turn bookmark");
  assert(drive.drive.docText.includes("Bookmark: turn-2"), "doc readback should include tool turn bookmark");
  assert(drive.drive.docText.includes("Bookmark: turn-3"), "doc readback should include assistant follow-up bookmark");
  assert(drive.drive.docText.includes("assistant follow-up after tool"), "doc readback should include assistant follow-up content");
  assert(drive.drive.docText.includes("### Tool Call Summary"), "doc readback should summarize tool turns");
  assert(drive.drive.docText.includes("Full content: JSONL sidecar"), "doc readback should point to JSONL for full tool content");
  assert(drive.drive.docText.includes('"doc_content_mode": "summary_only"'), "doc runtime metadata should disclose summary-only tool content");
  const jsonlRecords = drive.drive.jsonl.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert(jsonlRecords[0].content.includes("SESSION_ARCHIVE_SMOKE"));
  assert(jsonlRecords.some((row) => row.role === "tool" && row.content.includes("Tool: release_session_archive_smoke")), "JSONL should retain full tool content");
  assert(jsonlRecords.some((row) => row.role === "assistant" && row.content.includes("assistant follow-up after tool")), "JSONL should retain assistant follow-up content");
  assert(pool.state.turns.every((turn) => turn.content === null), "SQL turn content must stay null; Drive carries the full transcript");
  assert(pool.state.turns.every((turn) => turn.storage_mode === "drive"), "Drive smoke turns should be storage_mode=drive");

  // Sequestered subfolder: first folder created under the sessions root must be the smoke subfolder.
  assert.equal(drive.drive.foldersCreated[0], "root-folder/_smoke_archives", "smoke writes must land under _smoke_archives, not the production root");

  // Cleanup ran by default — SQL rows and Drive files were removed.
  assert.equal(result.cleanup.sql_session_deleted, true, "smoke must delete the SQL customer_sessions row");
  assert.equal(result.cleanup.sql_turns_deleted, 4, "smoke must delete the gpt_session_turns rows it created");
  assert.equal(result.cleanup.drive_files_deleted, 2, "smoke must delete the Drive doc and jsonl it created");
  assert.equal(result.cleanup.errors.length, 0, JSON.stringify(result.cleanup.errors));
  assert.equal(drive.drive.deletedFiles.length, 2);
  assert(drive.drive.deletedFiles.includes("doc-1"));
  assert(drive.drive.deletedFiles.includes("jsonl-1"));
}

// ── Cleanup disabled keeps artifacts in place ────────────────────────────────
{
  const pool = makePool();
  const drive = makeDriveDeps();
  const result = await runSessionArchiveSmoke({
    pool,
    tenantId: "tenant-1",
    userId: "smoke-user-no-cleanup",
    cleanup: false,
    injectedArchiveDeps: drive.deps,
    fetchDriveContentFn: drive.fetchDriveContent,
    deleteDriveFileFn: drive.deleteDriveFile,
    activationContextReader: async () => ({
      gpt_sessions: [{ session_id: pool.state.session.session_id, drive_export_url: "https://drive/doc-1" }],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.cleanup, null, "cleanup result must be null when cleanup is disabled");
  assert.equal(pool.state.turns.length, 4, "smoke must create a complete four-turn exchange before optional cleanup");
  assert.deepEqual(pool.state.turns.map((turn) => turn.role), ["user", "assistant", "tool", "assistant"], "smoke turn roles must preserve user/assistant/tool/assistant order");
  assert.equal(drive.drive.deletedFiles.length, 0, "no Drive files should be deleted when cleanup is disabled");
  assert(pool.state.session, "SQL session row must remain when cleanup is disabled");
}

// ── Route still forwards body fields and includes new flags ──────────────────
{
  let received = null;
  const app = express();
  app.use(express.json());
  app.use(buildReleaseRoutes({
    requireBackendApiKey: (_req, _res, next) => next(),
    runSessionArchiveSmoke: async (input) => {
      received = input;
      return { ok: true, status: "pass", smoke_type: "session_archive_drive_writeback", checks: [] };
    },
  }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/admin/release/session-archive-smoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: "tenant-1", user_id: "daily-smoke", include_drive_readback: false, force_doc_rollover: true, doc_rollover_chars: 1200 }),
  });
  const body = await res.json();
  server.close();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(received.tenantId, "tenant-1");
  assert.equal(received.userId, "daily-smoke");
  assert.equal(received.includeDriveReadback, false);
  assert.equal(received.forceDocRollover, true);
  assert.equal(received.docRolloverChars, 1200);
}

console.log("session archive smoke tests passed");
