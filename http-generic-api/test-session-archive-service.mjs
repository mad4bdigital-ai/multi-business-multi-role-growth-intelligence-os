import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSessionArchivePath,
  previewText,
  recordGptSessionTurn,
  sha256,
} from "./sessionArchiveService.js";

function makePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };
}

function flattenParams(value) {
  if (Array.isArray(value)) return value.flatMap(flattenParams);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenParams);
  return [value];
}

{
  const migration = readFileSync("migrations/110_sprint62u_session_turn_sql_content_cleanup.sql", "utf8");
  assert(migration.includes("MODIFY COLUMN `content` TEXT NULL"), "migration must allow null SQL content");
  assert(migration.includes("'preview_only'"), "migration must add preview_only storage mode");
  assert(migration.includes("SET `content` = NULL"), "migration must clear legacy SQL turn content");
  assert(migration.includes("SET `storage_mode` = 'preview_only'"), "migration must convert legacy inline rows");
}

{
  const service = readFileSync("sessionArchiveService.js", "utf8");
  const uploadPipeline = readFileSync("uploadPipeline.js", "utf8");
  assert(service.includes("SELECT COALESCE(MAX(turn_index), -1) AS max_idx FROM `gpt_session_turns`"), "archive service should refresh turn index before writing");
  assert(service.includes("effectiveTurnIndex < nextAvailable"), "archive service should avoid stale duplicate turn indexes");
  assert(uploadPipeline.includes("isRetryableGoogleDocAppendError"), "Google Doc append should classify retryable stale-precondition errors");
  assert(uploadPipeline.includes("maxAttempts = 3"), "Google Doc append should retry bounded attempts");
  assert(uploadPipeline.includes("Precondition") || uploadPipeline.includes("precondition"), "Google Doc append should retry precondition failures");
}

{
  const path = buildSessionArchivePath(
    {
      session_id: "sess-1",
      tenant_id: "tenant-1",
      user_id: "user@example.com",
      started_at: "2026-05-16T10:15:00.000Z",
    },
    new Date("2026-05-17T00:00:00.000Z")
  );
  assert.deepEqual(path, [
    "2026",
    "05",
    "16",
    "tenant_tenant-1",
    "user_user_example.com",
    "session_sess-1",
  ]);
}

{
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(previewText("x".repeat(520)).endsWith("...[truncated]"), true);
}

{
  const pool = makePool();
  const driveWrites = {
    folders: [],
    docText: "",
    jsonl: "",
  };
  const fullContent = `start-${"sensitive session body ".repeat(50)}-end`;
  const deps = {
    sessionsDriveFolderId: "root-folder",
    now: () => new Date("2026-05-16T12:00:00.000Z"),
    async getOrCreateDriveFolder(name, parentId) {
      driveWrites.folders.push({ name, parentId });
      return `${parentId}/${name}`;
    },
    async createGoogleDocInDrive(_name, _parentId, initialText) {
      driveWrites.docText += initialText;
      return { drive_file_id: "doc-1", drive_web_url: "https://drive/doc-1" };
    },
    async appendTextToGoogleDoc(_docId, text) {
      driveWrites.docText += text;
    },
    async uploadContentToDrive(content) {
      driveWrites.jsonl = content;
      return { drive_file_id: "jsonl-1", drive_web_url: "https://drive/jsonl-1" };
    },
    async fetchDriveContent() {
      return driveWrites.jsonl;
    },
    async updateDriveFileContent(_fileId, content) {
      driveWrites.jsonl = content;
      return { drive_file_id: "jsonl-1", drive_web_url: "https://drive/jsonl-1" };
    },
  };

  const result = await recordGptSessionTurn({
    pool,
    session: {
      session_id: "sess-1",
      tenant_id: "tenant-1",
      workspace_key: "workspace-1",
      user_id: "user-1",
      brand_key: "brand-1",
      started_at: "2026-05-16T10:00:00.000Z",
    },
    role: "assistant",
    content: fullContent,
    action_key: "example_action",
    turnIndex: 0,
    injectedDeps: deps,
  });

  assert.equal(result.archive_status, "ready");
  assert.equal(result.drive_doc_id, "doc-1");
  assert(
    pool.calls.some((call) => call.sql.includes("archive_status = ?") && call.params[0] === "ready" && call.params[1] === null),
    "successful Drive writes should self-heal stale archive write_failed status"
  );
  assert(driveWrites.docText.includes(fullContent), "full content should be written to Drive doc");
  assert(driveWrites.docText.includes("### Runtime Event"), "Drive doc should include runtime event metadata");
  assert(driveWrites.docText.includes('"action_key": "example_action"'), "Drive doc should include action metadata");
  assert(!driveWrites.docText.includes(`"content": "${fullContent}`), "Drive doc metadata should not duplicate full content JSON");
  assert(driveWrites.jsonl.includes(fullContent), "full content should be written to Drive JSONL");
  assert.equal(JSON.parse(driveWrites.jsonl.trim()).content, fullContent, "JSONL should remain parseable full-fidelity content");

  const sqlParamStrings = pool.calls.flatMap((call) => flattenParams(call.params)).filter((value) => typeof value === "string");
  assert(!sqlParamStrings.includes(fullContent), "SQL params must not contain the full turn content");
  assert(sqlParamStrings.some((value) => value.includes("...[truncated]")), "SQL should contain a bounded preview");
  const turnInsert = pool.calls.find((call) => call.sql.includes("INSERT INTO `gpt_session_turns`"));
  assert(turnInsert, "turn write should index gpt_session_turns");
  assert.match(turnInsert.sql, /tenant_id/);
  assert.match(turnInsert.sql, /workspace_key/);
  assert.match(turnInsert.sql, /brand_key/);
  assert.match(turnInsert.sql, /execution_context_json/);
  assert.equal(turnInsert.params[1], "tenant-1");
  assert.equal(turnInsert.params[2], "workspace-1");
  assert.equal(turnInsert.params[3], "user-1");
  assert.equal(turnInsert.params[5], "user");
  assert.equal(turnInsert.params[6], "brand-1");
  assert.equal(turnInsert.params[12], null, "gpt_session_turns.content must stay null for Drive-mode archival");
  assert.equal(turnInsert.params[14], previewText(fullContent), "bounded preview should live only in content_preview");
  assert.equal(turnInsert.params[18], "drive", "Drive archive writes should keep storage_mode=drive");
  const eventInsert = pool.calls.find((call) => call.sql.includes("INSERT INTO `session_events`"));
  assert(eventInsert, "turn write should index session_events");
  assert.match(eventInsert.sql, /workspace_key/);
  assert.match(eventInsert.sql, /brand_key/);
  assert.match(eventInsert.sql, /correlation_id/);
  assert.equal(eventInsert.params[3], "tenant-1");
  assert.equal(eventInsert.params[4], "workspace-1");
  assert.equal(eventInsert.params[5], "user-1");
  assert.equal(eventInsert.params[7], "user");
  assert.equal(eventInsert.params[8], "brand-1");
  assert.equal(eventInsert.params[10], "example_action");
}

{
  const pool = makePool();
  const driveWrites = { jsonl: "" };
  const fullContent = "partial archive still writes JSONL full content";
  const deps = {
    sessionsDriveFolderId: "root-folder",
    now: () => new Date("2026-05-16T12:30:00.000Z"),
    async getOrCreateDriveFolder(name, parentId) { return `${parentId}/${name}`; },
    async createGoogleDocInDrive() { return { drive_file_id: "doc-partial", drive_web_url: "https://drive/doc-partial" }; },
    async createGoogleDocFromTextInDrive(_name, _parentId, text) {
      driveWrites.rebuiltDocText = text;
      return { drive_file_id: "doc-rebuilt", drive_web_url: "https://drive/doc-rebuilt" };
    },
    async appendTextToGoogleDoc() { throw new Error("Precondition check failed."); },
    async uploadContentToDrive(content) { driveWrites.jsonl = content; return { drive_file_id: "jsonl-partial", drive_web_url: "https://drive/jsonl-partial" }; },
    async fetchDriveContent() { return driveWrites.jsonl; },
    async updateDriveFileContent(_fileId, content) { driveWrites.jsonl = content; return { drive_file_id: "jsonl-partial" }; },
  };

  const result = await recordGptSessionTurn({
    pool,
    session: {
      session_id: "sess-partial",
      tenant_id: "tenant-1",
      user_id: "user-1",
      started_at: "2026-05-16T10:00:00.000Z",
    },
    role: "assistant",
    content: fullContent,
    turnIndex: 0,
    injectedDeps: deps,
  });

  assert.equal(result.archive_status, "ready_rebuilt");
  assert.equal(result.archive_error, null);
  assert.equal(result.drive_doc_id, "doc-rebuilt");
  assert(driveWrites.jsonl.includes(fullContent), "JSONL sidecar should still receive full content when Doc append fails");
  assert(driveWrites.rebuiltDocText.includes(fullContent), "rebuilt Google Doc should be rendered from full JSONL content");
  assert(driveWrites.rebuiltDocText.includes("rebuilt_from_jsonl"), "rebuilt Google Doc should carry rebuild evidence");
  assert(
    pool.calls.some((call) => call.sql.includes("archive_status = ?") && call.params[0] === "ready_rebuilt"),
    "successful Doc rebuild should mark the session ready_rebuilt rather than ready_partial"
  );
}

{
  const pool = makePool();
  const driveWrites = { jsonl: "", textSnapshot: "" };
  const fullContent = "text snapshot fallback preserves full transcript content";
  const deps = {
    sessionsDriveFolderId: "root-folder",
    now: () => new Date("2026-05-16T13:00:00.000Z"),
    async getOrCreateDriveFolder(name, parentId) { return `${parentId}/${name}`; },
    async createGoogleDocInDrive() { return { drive_file_id: "doc-snapshot", drive_web_url: "https://drive/doc-snapshot" }; },
    async createGoogleDocFromTextInDrive() { throw new Error("Bad Request"); },
    async appendTextToGoogleDoc() { throw new Error("Precondition check failed."); },
    async uploadContentToDrive(content, filename, mimeType) {
      if (mimeType === "text/plain") {
        driveWrites.textSnapshot = content;
        driveWrites.textSnapshotFilename = filename;
        return { drive_file_id: "txt-rebuilt", drive_web_url: "https://drive/txt-rebuilt" };
      }
      driveWrites.jsonl = content;
      return { drive_file_id: "jsonl-snapshot", drive_web_url: "https://drive/jsonl-snapshot" };
    },
    async fetchDriveContent() { return driveWrites.jsonl; },
    async updateDriveFileContent(_fileId, content) { driveWrites.jsonl = content; return { drive_file_id: "jsonl-snapshot" }; },
  };

  const result = await recordGptSessionTurn({
    pool,
    session: {
      session_id: "sess-snapshot",
      tenant_id: "tenant-1",
      user_id: "user-1",
      started_at: "2026-05-16T10:00:00.000Z",
    },
    role: "assistant",
    content: fullContent,
    turnIndex: 0,
    injectedDeps: deps,
  });

  assert.equal(result.archive_status, "ready_text_snapshot");
  assert.equal(result.archive_error, null);
  assert.equal(result.drive_doc_id, "txt-rebuilt");
  assert.match(driveWrites.textSnapshotFilename, /Session_Transcript_Rebuilt_/);
  assert(driveWrites.textSnapshot.includes(fullContent), "text snapshot should be rendered from full JSONL content");
  assert(driveWrites.textSnapshot.includes("rebuilt_from_jsonl"), "text snapshot should preserve rebuild evidence");
  assert(
    pool.calls.some((call) => call.sql.includes("archive_status = ?") && call.params[0] === "ready_text_snapshot"),
    "Google Doc import fallback should mark the session ready_text_snapshot"
  );
}

console.log("session archive service tests passed");
