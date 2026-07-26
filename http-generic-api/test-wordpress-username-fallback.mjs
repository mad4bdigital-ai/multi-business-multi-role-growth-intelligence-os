import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./wordpressBlogPublishOrchestrator.js", import.meta.url), "utf8");

assert(
  !source.includes("credential.username || credential.account_label || brand.username"),
  "WordPress Basic Auth must not use account_label as username; account_label can be a URL/display label"
);
assert(
  source.includes('const username = str(credential.username || brand.username || "gpt");'),
  "WordPress Basic Auth should fallback from credential.username to brand.username, then gpt"
);
assert(
  source.includes("headers: { Authorization: basicAuth(username, password)"),
  "WordPress publish path must continue generating Authorization from resolved username/password"
);

console.log("wordpress username fallback test passed");
