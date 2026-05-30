import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.platform !== 'win32') {
  console.log('local connector PowerShell native exit guard test skipped on non-Windows');
  process.exit(0);
}

const connectorDir = path.dirname(fileURLToPath(import.meta.url));
const port = 18300 + Math.floor(Math.random() * 1000);
const apiKey = 'test-secret';

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: connectorDir,
  env: {
    ...process.env,
    CONNECTOR_SECRET: apiKey,
    CONNECTOR_PORT: String(port),
    CONNECTOR_POWERSHELL_ENABLED: 'true',
    CONNECTOR_SHELL_ENABLED: 'false',
    CONNECTOR_FILES_ENABLED: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('local connector PowerShell test server did not start');
}

async function callPs(script) {
  const response = await fetch(`http://127.0.0.1:${port}/ps`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ script, timeout_ms: 10000 }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  await waitForServer();

  const result = await callPs("cmd.exe /c exit 7\nWrite-Output 'false success'");
  assert.equal(result.status, 200);
  assert.equal(result.body.exitCode, 7);
  assert.equal(result.body.exit_code, 7);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error?.code, 'POWERSHELL_EXIT_NONZERO');
  assert.match(result.body.stdout, /false success/);
  assert.match(result.body.stderr, /Native command failed with exit code 7/);
} finally {
  server.kill();
}

console.log('local connector PowerShell native exit guard tests passed');
