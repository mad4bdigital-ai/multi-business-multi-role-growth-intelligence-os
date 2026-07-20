import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isRawTextResponseRequest,
  readUpstreamResponse,
  resolveUpstreamResponseMode,
} from "./upstreamResponseParser.js";
import { assessMigrationSqlPreflight, splitSqlStatements } from "./releaseReadiness.js";

function responseHeaders(contentType) {
  return {
    get(name) {
      return String(name || "").toLowerCase() === "content-type" ? contentType : null;
    },
  };
}

let jsonCalls = 0;
let textCalls = 0;
const rawSql = "-- migration\nUPDATE endpoints SET status='active';\n";
const rawRequest = { headers: { Accept: "application/vnd.github.raw" } };

assert.equal(resolveUpstreamResponseMode(rawRequest, "application/json; charset=utf-8"), "raw_text");
assert.equal(isRawTextResponseRequest(rawRequest, "application/json; charset=utf-8"), true);

const rawResult = await readUpstreamResponse({
  headers: responseHeaders("application/json; charset=utf-8"),
  async json() {
    jsonCalls += 1;
    throw new Error("JSON parser must not run for GitHub raw Accept");
  },
  async text() {
    textCalls += 1;
    return rawSql;
  },
}, rawRequest);

assert.equal(rawResult.data, rawSql);
assert.equal(rawResult.responseText, rawSql);
assert.equal(rawResult.responseMode, "raw_text");
assert.equal(jsonCalls, 0);
assert.equal(textCalls, 1);

const explicitRaw = await readUpstreamResponse({
  headers: responseHeaders("application/problem+json"),
  async json() {
    throw new Error("JSON parser must not run when expect_json=false");
  },
  async text() {
    return "plain";
  },
}, { expect_json: false });
assert.equal(explicitRaw.data, "plain");

const jsonPayload = { ok: true };
const jsonResult = await readUpstreamResponse({
  headers: responseHeaders("application/vnd.github+json"),
  async json() {
    return jsonPayload;
  },
  async text() {
    throw new Error("Text parser must not run for JSON mode");
  },
}, {});
assert.deepEqual(jsonResult.data, jsonPayload);
assert.equal(jsonResult.responseMode, "json");

const executionSource = readFileSync(new URL("./execution.js", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("./server.js", import.meta.url), "utf8");
const responseSource = readFileSync(new URL("./executionResponse.js", import.meta.url), "utf8");
for (const source of [executionSource, serverSource]) {
  assert.match(source, /isRawTextResponseRequest\(requestPayload, upstreamContentType\)/);
  assert.match(source, /\? "text\/plain"/);
}
assert.match(responseSource, /isRawTextResponseRequest\(requestPayload, currentContentType\)/);
assert.match(responseSource, /not_applicable_raw_text/);
assert.match(responseSource, /!rawTextResponse/);

const migrationName = "20260720_github_raw_contents_text_response_contract.sql";
const migration = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");
for (const marker of [
  "getFileContents",
  "text/plain",
  "application/vnd.github.raw",
  "backward_compatible=true",
  "same_cycle_readback_required=true",
  "secrets_included=false",
]) {
  assert.ok(migration.includes(marker), `Raw response contract migration missing ${marker}`);
}
assert.equal(splitSqlStatements(migration).length, 1);
assert.doesNotMatch(migration, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);
assert.doesNotMatch(migration, /(client_secret|backend_api_key|jwt_secret|access_token)/i);

const preflight = assessMigrationSqlPreflight(migrationName, migration);
assert.equal(preflight.status, "pass", JSON.stringify(preflight, null, 2));
assert.equal(preflight.risk_count, 0, JSON.stringify(preflight, null, 2));
assert.equal(preflight.secrets_included, false, JSON.stringify(preflight, null, 2));

console.log("PASS upstream response parser");
