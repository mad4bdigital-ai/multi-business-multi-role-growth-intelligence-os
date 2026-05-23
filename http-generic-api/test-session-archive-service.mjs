import assert from "node:assert/strict";
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
      user_id: "user-1",
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
  assert.equal(turnInsert.params[4], null, "gpt_session_turns.content must stay null for Drive-mode archival");
  assert.equal(turnInsert.params[6], previewText(fullContent), "bounded preview should live only in content_preview");
  assert.equal(turnInsert.params[10], "drive", "Drive archive writes should keep storage_mode=drive");
  assert(
    pool.calls.some((call) => call.sql.includes("INSERT INTO `gpt_session_turns`")),
    "turn write should index gpt_session_turns"
  );
  assert(
    pool.calls.some((call) => call.sql.includes("INSERT INTO `session_events`")),
    "turn write should index session_events"
  );
}

console.log("session archive service tests passed");
