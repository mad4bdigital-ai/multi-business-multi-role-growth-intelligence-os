import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const connectorDir = path.dirname(fileURLToPath(import.meta.url));
const connectorPort = 18200 + Math.floor(Math.random() * 1000);
const n8nPort = 19200 + Math.floor(Math.random() * 1000);
const connectorSecret = 'test-connector-secret';
const n8nApiKey = 'test-n8n-api-key';

const n8nServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (url.pathname === '/api/v1/workflows') {
    assert.equal(req.headers['x-n8n-api-key'], n8nApiKey);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [], nextCursor: null }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

await new Promise((resolve) => n8nServer.listen(n8nPort, '127.0.0.1', resolve));

const connector = spawn(process.execPath, ['server.mjs'], {
  cwd: connectorDir,
  env: {
    ...process.env,
    CONNECTOR_PORT: String(connectorPort),
    CONNECTOR_SECRET: connectorSecret,
    CONNECTOR_N8N_ENABLED: 'true',
    N8N_BASE_URL: `http://127.0.0.1:${n8nPort}`,
    N8N_LOCAL_BASE_URL: `http://127.0.0.1:${n8nPort}`,
    N8N_API_KEY: n8nApiKey,
    CONNECTOR_SHELL_ENABLED: 'false',
    CONNECTOR_FILES_ENABLED: 'false',
    CONNECTOR_APPS_ENABLED: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForConnector() {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch(`http://127.0.0.1:${connectorPort}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('local connector n8n test server did not start');
}

try {
  await waitForConnector();
  const started = Date.now();
  const response = await fetch(`http://127.0.0.1:${connectorPort}/n8n`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connectorSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'list_workflows', limit: 20 }),
    signal: AbortSignal.timeout(3000),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.workflows, { data: [], nextCursor: null });
  assert(Date.now() - started < 3000, 'n8n fallthrough should not hang while re-reading request body');
} finally {
  connector.kill();
  await new Promise((resolve) => n8nServer.close(resolve));
}

console.log('local connector n8n fallthrough tests passed');
