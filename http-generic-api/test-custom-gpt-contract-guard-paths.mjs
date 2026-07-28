import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const workflowSource = await readFile(
  new URL("../.github/workflows/custom-gpt-contract-guard.yml", import.meta.url),
  "utf8",
);
const workflow = parse(workflowSource);
const requiredPaths = [
  "http-generic-api/server.js",
  "http-generic-api/operationRuntimeGuard.js",
  "http-generic-api/scripts/test-operation-runtime-guard.mjs",
  "http-generic-api/test-custom-gpt-contract-guard-paths.mjs",
];

for (const eventName of ["pull_request", "push"]) {
  const paths = workflow?.on?.[eventName]?.paths;
  assert.ok(Array.isArray(paths), `${eventName}.paths must be configured`);
  for (const requiredPath of requiredPaths) {
    assert.ok(
      paths.includes(requiredPath),
      `${eventName}.paths must include ${requiredPath}`,
    );
  }
}

console.log("custom GPT Contract Guard path coverage tests passed");
