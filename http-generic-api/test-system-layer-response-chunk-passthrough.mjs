import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(rootDir, "routes", "systemLayerRoutes.js"),
  "utf8",
);

assert.match(
  source,
  /shouldChunkDispatchedToolResponse/,
  "system routes must import the governed dispatched-response chunk policy",
);

const passthroughGuards = source.match(
  /if\s*\(!shouldChunkDispatchedToolResponse\(name,\s*result\)\)\s*\{\s*return res\.status\(200\)\.json\(result\);\s*\}/gs,
) || [];

assert.equal(
  passthroughGuards.length,
  2,
  "tenant-capable and admin system tool call routes must both pass through governed chunk envelopes",
);

assert.match(
  source,
  /case\s+"response_chunk_read"\s*:\s*return\s+await\s+readCachedToolResponseChunk\(args\);/s,
  "response_chunk_read must continue to resolve the original cached response chunk",
);

console.log("system layer response chunk passthrough contract tests passed");
