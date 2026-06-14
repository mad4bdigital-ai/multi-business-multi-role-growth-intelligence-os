import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const workflow = readFileSync("../.github/workflows/ci.yml", "utf8");
const attributes = readFileSync("../.gitattributes", "utf8");

assert.equal(packageJson.engines.node, ">=22 <23");
const nodeVersions = [...workflow.matchAll(/node-version:\s*["']?([^"'\s]+)["']?/g)].map((match) => match[1]);
assert(nodeVersions.length >= 1, "CI must declare a Node runtime");
assert(nodeVersions.every((version) => version === "22"), `CI Node versions must align to package engines: ${nodeVersions.join(", ")}`);
for (const extension of ["md", "mjs", "js", "json", "yml", "yaml"]) {
  assert.match(attributes, new RegExp(`\\*\\.${extension} text eol=lf`));
}

console.log("runtime profile contract tests passed");
