import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(envPath) {
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key && !(key in process.env)) process.env[key] = value;
    }
  } catch {
    // Optional when env is provided by the service manager.
  }
}

loadEnv(path.resolve(__dirname, '../.env'));

const templatePath = path.resolve(__dirname, 'platform-classification-v1.template.json');
const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));

const n8nBase = String(process.env.N8N_LOCAL_BASE_URL || process.env.N8N_BASE_URL || 'http://127.0.0.1:5678').replace(/\/$/, '');
const n8nApiKey = process.env.N8N_API_KEY || '';
const webhookToken = process.env[template.credential.value_env_var] || '';

if (!n8nApiKey) throw new Error('N8N_API_KEY is required');
if (!webhookToken) throw new Error(`${template.credential.value_env_var} is required`);

const headers = {
  'X-N8N-API-KEY': n8nApiKey,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

async function n8nApi(method, apiPath, body) {
  const response = await fetch(`${n8nBase}${apiPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(Number(process.env.N8N_RESTORE_TIMEOUT_MS || 15000)),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(`n8n API ${method} ${apiPath} failed with ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function ensureHeaderCredential() {
  const listed = await n8nApi('GET', '/api/v1/credentials?limit=100');
  const existing = (listed.data || []).find(
    (credential) => credential.name === template.credential.name && credential.type === template.credential.type,
  );
  if (existing) return existing;
  return n8nApi('POST', '/api/v1/credentials', {
    name: template.credential.name,
    type: template.credential.type,
    data: {
      name: template.credential.header_name,
      value: `Bearer ${webhookToken}`,
    },
  });
}

function buildWorkflowPayload(credentialId) {
  const workflow = structuredClone(template.workflow);
  for (const node of workflow.nodes) {
    if (node.credentials?.httpHeaderAuth) {
      node.credentials.httpHeaderAuth = {
        id: credentialId,
        name: template.credential.name,
      };
    }
  }
  return workflow;
}

async function upsertWorkflow(workflowPayload) {
  const listed = await n8nApi('GET', '/api/v1/workflows?limit=100');
  const existing = (listed.data || []).find((workflow) => workflow.name === workflowPayload.name);
  if (!existing) {
    const created = await n8nApi('POST', '/api/v1/workflows', workflowPayload);
    await n8nApi('POST', `/api/v1/workflows/${created.id}/activate`);
    return { workflow: created, created: true, updated: false, activated: true };
  }

  const current = await n8nApi('GET', `/api/v1/workflows/${existing.id}`);
  if (current.active) await n8nApi('POST', `/api/v1/workflows/${existing.id}/deactivate`);
  await n8nApi('PUT', `/api/v1/workflows/${existing.id}`, {
    name: workflowPayload.name,
    nodes: workflowPayload.nodes,
    connections: workflowPayload.connections,
    settings: workflowPayload.settings,
  });
  await n8nApi('POST', `/api/v1/workflows/${existing.id}/activate`);
  const updated = await n8nApi('GET', `/api/v1/workflows/${existing.id}`);
  return { workflow: updated, created: false, updated: true, activated: true };
}

async function smokeTest() {
  const webhookUrl = `${n8nBase}/webhook/platform-classification`;
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${webhookToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ input: { text: 'please classify this restored workflow' } }),
    signal: AbortSignal.timeout(Number(process.env.N8N_RESTORE_TIMEOUT_MS || 15000)),
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    const error = new Error(`Restored workflow smoke test failed with ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return { status: response.status, body };
}

const credential = await ensureHeaderCredential();
const workflowPayload = buildWorkflowPayload(credential.id);
const result = await upsertWorkflow(workflowPayload);
const smoke = await smokeTest();

console.log(JSON.stringify({
  ok: true,
  workflow_key: template.workflow_key,
  binding_key: template.binding_key,
  workflow_id: result.workflow.id,
  workflow_name: workflowPayload.name,
  created: result.created,
  updated: result.updated,
  activated: result.activated,
  smoke_status: smoke.status,
  smoke_result: smoke.body,
  secrets_printed: false,
}, null, 2));
