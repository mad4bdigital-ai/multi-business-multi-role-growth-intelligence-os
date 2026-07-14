import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function main() {
  for (const routePath of [
    "routes/gptToolsRoutes.js",
    "routes/operationOrchestratorRoutes.js",
  ]) {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      "--check",
      routePath,
    ], {
      cwd: new URL(".", import.meta.url),
      timeout: 30_000,
    });

    assert.equal(stdout, "");
    assert.equal(stderr, "");
  }

  const operationRoutes = readFileSync(
    new URL("./routes/operationOrchestratorRoutes.js", import.meta.url),
    "utf8",
  );
  assert.match(operationRoutes, /collectChunkedToolResponse/);
  assert.match(operationRoutes, /dispatchWithChunkCollection/);
  assert.match(operationRoutes, /return collectChunkedToolResponse\(initial, \{ dispatch \}\)/);
  assert.match(operationRoutes, /dispatch: \(toolKey, args\) => dispatchWithChunkCollection/);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
