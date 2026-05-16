import assert from "node:assert/strict";
import express from "express";
import { buildReleaseRoutes } from "./routes/releaseRoutes.js";
import { runSessionArchiveSmoke } from "./sessionArchiveSmoke.js";

function makePool() {
  const state = { session: null, turns: [], events: [] };
  return {
    state,
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, " ").trim();

      if (compact.startsWith("INSERT INTO `customer_sessions`")) {
        state.session = {
          session_id: params[0],
          tenant_id: params[1],
          user_id: params[2],
          originator: "gpt_action_smoke",
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
          drive_jsonl_id: params[3],
          drive_jsonl_url: params[4],
          drive_exports_folder_id: params[5],
          archive_status: "ready",
        });
        return [{ affectedRows: 1 }];
      }

      if (compact.startsWith("INSERT INTO `gpt_session_turns`")) {
        state.turns.push({
          session_id: params[0],
          turn_id: params[1],
          turn_index: params[2],
          role: params[3],
          content_preview: params[6],
          content_sha256: params[7],
          drive_doc_id: params[8],
          drive_anchor: params[9],
          storage_mode: params[10],
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

      throw new Error(`Unexpected SQL in smoke test: ${compact}`);
    },
  };
}

function makeDriveDeps() {
  const drive = { docText: "", jsonl: "" };
  return {
    drive,
    deps: {
      sessionsDriveFolderId: "root-folder",
      now: () => new Date("2026-05-16T12:00:00.000Z"),
      async getOrCreateDriveFolder(name, parentId) {
        return `${parentId}/${name}`;
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
  };
}

{
  const pool = makePool();
  const drive = makeDriveDeps();
  const result = await runSessionArchiveSmoke({
    pool,
    tenantId: "tenant-1",
    userId: "smoke-user",
    injectedArchiveDeps: drive.deps,
    fetchDriveContentFn: drive.fetchDriveContent,
    activationContextReader: async () => ({
      gpt_sessions: [{ session_id: pool.state.session.session_id, drive_export_url: "https://drive/doc-1" }],
    }),
  });

  assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
  assert.equal(result.status, "pass");
  assert.equal(result.drive.doc_id, "doc-1");
  assert.equal(result.drive.jsonl_id, "jsonl-1");
  assert(result.checks.every((item) => item.pass), "all smoke checks should pass");
  assert(drive.drive.docText.includes("### Runtime Event"), "doc readback should include runtime JSON");
  assert(JSON.parse(drive.drive.jsonl.trim().split(/\r?\n/)[0]).content.includes("SESSION_ARCHIVE_SMOKE"));
  assert(pool.state.turns.every((turn) => turn.storage_mode === "drive" && turn.drive_anchor));
}

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
    body: JSON.stringify({ tenant_id: "tenant-1", user_id: "daily-smoke", include_drive_readback: false }),
  });
  const body = await res.json();
  server.close();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(received.tenantId, "tenant-1");
  assert.equal(received.userId, "daily-smoke");
  assert.equal(received.includeDriveReadback, false);
}

console.log("session archive smoke tests passed");
