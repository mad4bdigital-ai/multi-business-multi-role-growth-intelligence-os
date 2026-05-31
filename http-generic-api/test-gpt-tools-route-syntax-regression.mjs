import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function main() {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    "--check",
    "routes/gptToolsRoutes.js",
  ], {
    cwd: new URL(".", import.meta.url),
    timeout: 30_000,
  });

  assert.equal(stdout, "");
  assert.equal(stderr, "");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
