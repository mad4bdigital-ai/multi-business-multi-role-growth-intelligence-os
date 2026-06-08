import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveGptSessionPin } from "./routes/gptToolsRoutes.js";

const source = readFileSync("routes/gptToolsRoutes.js", "utf8");

assert.equal(
  resolveGptSessionPin({ headers: {} }, { gpt_session_id: "sess-explicit" }),
  "sess-explicit",
  "tool archive should accept explicit gpt_session_id pins"
);
assert.equal(
  resolveGptSessionPin({ headers: { "x-gpt-session-id": "sess-header" } }, {}),
  "sess-header",
  "tool archive should accept x-gpt-session-id header pins"
);
assert.equal(
  resolveGptSessionPin({ headers: {} }, {}),
  null,
  "tool archive should not fabricate a session pin"
);

assert(source.includes("explicit_session_pin"), "explicit pin archive binding should be disclosed");
assert(source.includes("latest_active_with_conversation_turn"), "fallback archive binding should require a conversation-bearing session");
assert(source.includes("SUM(CASE WHEN role IN ('user', 'assistant')"), "tool archive fallback must count user/assistant turns");
assert(source.includes("counts.conversation_turns > 0"), "tool archive fallback must reject tool-only sessions");
assert(source.includes("LIMIT 5"), "tool archive fallback should inspect recent sessions, not a single possibly tool-only row");
assert(source.includes("no explicit GPT session pin and no active session with user/assistant turns"), "skipped archive logging must explain the pinning guard");

console.log("gpt tool archive pinning tests passed");
