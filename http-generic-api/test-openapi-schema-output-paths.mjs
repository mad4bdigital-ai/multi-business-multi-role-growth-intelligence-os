import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const apiRoot = new URL("./", import.meta.url);
const repoRoot = new URL("../", apiRoot);
const surfaces = readFileSync(new URL("./openapi/custom-gpt-surfaces.yaml", repoRoot), "utf8");
const apiRootEntries = readdirSync(apiRoot);

const staleRootSchemas = apiRootEntries
  .filter((name) => /^openapi\..*\.ya?ml$/i.test(name))
  .filter((name) => name !== "openapi.yaml");

assert.deepEqual(staleRootSchemas, [], `generated GPT schemas must live under http-generic-api/openapi/, not API root: ${staleRootSchemas.join(", ")}`);

const legacyOutputLines = surfaces
  .split(/\r?\n/)
  .map((line, index) => ({ line, index: index + 1 }))
  .filter(({ line }) => /^\s*output_file:\s+openapi\.[^/].*\.ya?ml\s*$/i.test(line));

assert.deepEqual(
  legacyOutputLines,
  [],
  `custom GPT surface output_file values must include openapi/ prefix: ${legacyOutputLines.map(({ index, line }) => `${index}:${line.trim()}`).join(", ")}`,
);

for (const expected of [
  "openapi.custom-gpt.auth-dispatcher.yaml",
  "openapi.custom-gpt.activation-admin.yaml",
  "openapi.tenant-gpt.auth.yaml",
  "openapi.tenant-gpt.activation.yaml",
  "openapi.gpt-action.local-connector.yaml",
  "openapi.gpt-action.dev-dispatcher.yaml",
]) {
  assert(existsSync(resolve(new URL("./openapi/", apiRoot), expected)), `missing relocated schema artifact ${expected}`);
}

console.log("openapi schema output path guard passed");
