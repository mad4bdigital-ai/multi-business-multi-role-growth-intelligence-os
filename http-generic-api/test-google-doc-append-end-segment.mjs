import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const uploadPipeline = readFileSync(new URL("./uploadPipeline.js", import.meta.url), "utf8");

assert.ok(uploadPipeline.includes("createGoogleDocFromTextInDrive"));
assert.ok(uploadPipeline.includes("mimeType: \"text/plain\""));
assert.ok(uploadPipeline.includes("Readable.from([text || \"\"])"));
assert.ok(uploadPipeline.includes("appendTextToGoogleDocAtEndOfSegment"));
assert.ok(uploadPipeline.includes("endOfSegmentLocation: {}"));
assert.ok(uploadPipeline.includes('method: "end_of_segment"'));
assert.ok(uploadPipeline.includes("appendTextToGoogleDocByIndex"));
assert.ok(uploadPipeline.includes('method: "index_fallback"'));
assert.ok(uploadPipeline.includes("Google Doc append failed after end_of_segment and index fallback"));

const appendFn = uploadPipeline.slice(
  uploadPipeline.indexOf("export async function appendTextToGoogleDoc"),
  uploadPipeline.indexOf("export async function updateDriveFileContent")
);
assert.ok(appendFn.includes("appendTextToGoogleDocAtEndOfSegment"));
assert.ok(appendFn.includes("appendTextToGoogleDocByIndex"));
assert.ok(
  appendFn.indexOf("appendTextToGoogleDocAtEndOfSegment") < appendFn.indexOf("appendTextToGoogleDocByIndex"),
  "end-of-segment append must run before index fallback"
);

console.log("Google Doc append end-of-segment regression tests passed");
