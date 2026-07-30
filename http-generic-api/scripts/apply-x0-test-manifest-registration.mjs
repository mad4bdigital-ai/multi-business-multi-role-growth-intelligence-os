#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(scriptDir, "test-manifest.mjs");
const anchor = '  "node test-spec013-runtime-ratchet-contract.mjs",';
const additions = [
  '  "node test-governed-execution-baseline-telemetry.mjs",',
  '  "node test-governed-execution-baseline-benchmark.mjs",',
];

const source = fs.readFileSync(manifestPath, "utf8");
for (const command of additions) {
  if (source.includes(command)) {
    throw new Error(`X0 test command is already registered: ${command}`);
  }
}
const first = source.indexOf(anchor);
if (first < 0) throw new Error("Spec 013 manifest anchor was not found.");
if (source.indexOf(anchor, first + anchor.length) >= 0) {
  throw new Error("Spec 013 manifest anchor is not unique.");
}

const replacement = [anchor, ...additions].join("\n");
const updated = `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
fs.writeFileSync(manifestPath, updated);
console.log("X0 telemetry and benchmark tests registered in the complete test manifest");
