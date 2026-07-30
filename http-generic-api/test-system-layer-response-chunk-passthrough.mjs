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

assert.equal(
  source.includes("readCachedToolResponseChunk(args)"),
  false,
  "response_chunk_read must not accept caller-supplied auth from tool arguments",
);
assert.ok(
  source.includes('source_surface: "system_layer_response_chunk_read"'),
  "response_chunk_read must bind middleware auth to a trusted system-layer source",
);
assert.ok(
  source.includes("...(args || {})"),
  "response_chunk_read must preserve cursor and TTL arguments before trusted auth override",
);
assert.ok(
  source.includes('"system_tools_call"') && source.includes('"admin_system_tools_call"'),
  "tenant-capable and admin system calls must use distinct trusted source surfaces",
);

console.log("system layer response chunk passthrough contract tests passed");
