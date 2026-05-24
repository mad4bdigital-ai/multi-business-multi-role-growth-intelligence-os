import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = await mkdtemp(path.join(tmpdir(), 'mad4b-connector-files-'));
const port = 17170 + Math.floor(Math.random() * 1000);
const apiKey = 'test-secret';
const localApiKey = 'local-api-key-secret';
const childPath = path.join(root, 'nested', 'hello.txt');
const projectPath = path.join(root, 'repos', 'growth-os');
const connectorDir = path.dirname(fileURLToPath(import.meta.url));

await writeFile(path.join(root, 'root.txt'), 'root file', 'utf8');
await mkdir(path.join(projectPath, 'http-generic-api'), { recursive: true });
await writeFile(path.join(projectPath, 'AGENTS.md'), 'project instructions', 'utf8');
await writeFile(path.join(projectPath, 'package.json'), '{"name":"growth-os"}', 'utf8');
await writeFile(path.join(projectPath, 'http-generic-api', 'openapi.yaml'), 'openapi: 3.1.0', 'utf8');

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: connectorDir,
  env: {
    ...process.env,
    CONNECTOR_SECRET: apiKey,
    CONNECTOR_LOCAL_API_KEY: localApiKey,
    CONNECTOR_PORT: String(port),
    CONNECTOR_FILES_ENABLED: 'true',
    CONNECTOR_FILE_PATHS: root,
    CONNECTOR_SHELL_ENABLED: 'false',
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
  throw new Error('local connector test server did not start');
}

async function callFiles(body) {
  const response = await fetch(`http://127.0.0.1:${port}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function callDependencies(body) {
  const response = await fetch(`http://127.0.0.1:${port}/dependencies`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function callConnector(pathname, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

try {
  await waitForServer();

  {
    const response = await fetch(`http://127.0.0.1:${port}/policy`, {
      headers: { 'x-connector-secret': apiKey },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.principal_scope, 'platform_admin_break_glass_only');
    assert.equal(body.auth?.credential, 'CONNECTOR_SECRET');
  }

  {
    const result = await callFiles({ action: 'list' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.allowed_paths, [root]);
  }

  {
    const response = await fetch(`http://127.0.0.1:${port}/policy`, {
      headers: { 'x-connector-secret': localApiKey },
    });
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'UNAUTHORIZED');
  }

  {
    const result = await callFiles({ action: 'list', path: root });
    assert.equal(result.status, 200);
    assert.equal(result.body.path, root);
    assert(result.body.entries.some((entry) => entry.name === 'root.txt'));
  }

  {
    const result = await callFiles({ action: 'list_drives' });
    assert.equal(result.status, 200);
    assert(Array.isArray(result.body.drives));
    assert(Array.isArray(result.body.allowed_paths));
  }

  {
    const result = await callFiles({
      action: 'locate_repo',
      markers: ['AGENTS.md', 'package.json', 'http-generic-api/openapi.yaml'],
      max_depth: 4,
    });
    assert.equal(result.status, 200);
    assert(result.body.candidates.some((candidate) => candidate.path === projectPath));
  }

  {
    const result = await callFiles({ action: 'write', path: childPath, content: 'hello' });
    assert.equal(result.status, 200);
    assert.equal(result.body.path, childPath);
  }

  {
    const result = await callFiles({ action: 'read', path: childPath });
    assert.equal(result.status, 200);
    assert.equal(result.body.content, 'hello');
  }

  {
    const result = await callFiles({ action: 'list', path: path.join(root, '..') });
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'PATH_NOT_ALLOWED');
  }

  {
    const result = await callDependencies({ action: 'status' });
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'DISABLED');
  }

  {
    const result = await callConnector('/apps', { action: 'status' });
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'DISABLED');
  }

  {
    const result = await callConnector('/browser', { action: 'list' });
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'DISABLED');
  }
} finally {
  server.kill();
  await rm(root, { recursive: true, force: true });
}

console.log('local connector files endpoint tests passed');
