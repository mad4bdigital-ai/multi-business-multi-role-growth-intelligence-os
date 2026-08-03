import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GIT_MAX_BUFFER_BYTES } from "./scripts/user-jwt-auth-governance.mjs";

const source = readFileSync("scripts/user-jwt-auth-governance.mjs", "utf8");

assert.equal(
  GIT_MAX_BUFFER_BYTES,
  64 * 1024 * 1024,
  "User JWT governance must retain a bounded 64 MiB buffer for large repository diffs",
);
assert.match(
  source,
  /function git\(args\)[\s\S]*maxBuffer:\s*GIT_MAX_BUFFER_BYTES/,
  "the large-diff buffer must be wired into the git helper used by governance scans",
);
assert.match(
  source,
  /git\(\["diff", "--unified=0", `\$\{resolvedBaseline\}\.\.\.HEAD`/,
  "the governed baseline-to-head scan must continue using the bounded git helper",
);

console.log("User JWT auth governance large-diff buffer regression tests passed");
