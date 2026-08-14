import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = path.dirname(fileURLToPath(import.meta.url));
const guardPath = path.join(repoDir, "scripts", "schema-docs-change-guard.mjs");

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writeFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function runScenario({ withScriptsTest }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "schema-docs-change-guard-"));
  try {
    git(tempRoot, ["init", "--quiet"]);
    git(tempRoot, ["config", "user.email", "schema-guard@example.invalid"]);
    git(tempRoot, ["config", "user.name", "Schema Guard Test"]);

    writeFile(tempRoot, "README.md", "baseline\n");
    git(tempRoot, ["add", "--all"]);
    git(tempRoot, ["commit", "--quiet", "-m", "baseline"]);
    const before = git(tempRoot, ["rev-parse", "HEAD"]);

    writeFile(
      tempRoot,
      "http-generic-api/scripts/maintenance-tools/example-tool.mjs",
      "export const exampleTool = true;\n",
    );
    if (withScriptsTest) {
      writeFile(
        tempRoot,
        "http-generic-api/scripts/test-example-tool.mjs",
        "console.log('example tool regression');\n",
      );
    }

    git(tempRoot, ["add", "--all"]);
    git(tempRoot, ["commit", "--quiet", "-m", "change guarded maintenance tool"]);
    const after = git(tempRoot, ["rev-parse", "HEAD"]);

    const eventPath = path.join(tempRoot, "github-event.json");
    fs.writeFileSync(eventPath, JSON.stringify({ before, after }), "utf8");

    return spawnSync(process.execPath, [guardPath], {
      cwd: tempRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "push",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_SHA: after,
      },
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

const covered = runScenario({ withScriptsTest: true });
assert.equal(
  covered.status,
  0,
  `scripts/test-* must satisfy guarded maintenance-tool coverage.\nstdout:\n${covered.stdout}\nstderr:\n${covered.stderr}`,
);
assert.match(covered.stdout, /guarded changes include schema\/docs\/tests\/canonical coverage/);

const uncovered = runScenario({ withScriptsTest: false });
assert.notEqual(uncovered.status, 0, "guarded maintenance-tool changes without coverage must fail closed");
assert.match(
  `${uncovered.stdout}\n${uncovered.stderr}`,
  /guarded runtime files changed without matching schema\/docs\/tests\/canonical coverage/,
);

console.log("schema/docs change guard scripts-test coverage regression passed");
