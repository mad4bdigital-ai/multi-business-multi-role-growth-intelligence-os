import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(rootDir, "routes", "activationHardRunRoutes.js"),
  "utf8",
);

assert.match(
  source,
  /const reportProduced = responseBody\?\.state_model\?\.evidence_state === "complete";/,
  "hard activation must distinguish a produced diagnostic report from activation outcome",
);
assert.match(
  source,
  /const statusCode = hard\.activation_complete \|\| reportProduced \? 200 : 424;/,
  "a complete diagnostic report must use HTTP 200 even when activation remains degraded",
);
assert.doesNotMatch(
  source,
  /const statusCode = hard\.activation_complete \? 200 : 424;/,
  "activation outcome alone must not determine transport failure",
);

console.log("hard activation transport semantics contract tests passed");
