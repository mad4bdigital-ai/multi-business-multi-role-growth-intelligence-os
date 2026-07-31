import fs from 'node:fs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const baseUrl = String(process.env.RUNTIME_BASE_URL || '').replace(/\/$/, '');
const repo = String(process.env.REPOSITORY || '');
const backendKey = String(process.env.BACKEND_API_KEY || '').trim();
const githubToken = String(process.env.GH_READ_TOKEN || '').trim();
const hotfixSha = String(process.env.HOTFIX_MERGE_SHA || '').toLowerCase();
const userId = String(process.env.ADMIN_USER_ID || '');
const tenantId = String(process.env.PLATFORM_TENANT_ID || '');
const deviceId = String(process.env.DEVICE_ID || '');
const evidencePath = String(process.env.EVIDENCE_PATH || '');

assert(baseUrl, 'RUNTIME_BASE_URL is required.');
assert(repo, 'REPOSITORY is required.');
assert(backendKey, 'BACKEND_API_KEY repository secret is required.');
assert(githubToken, 'GitHub read token is required.');
assert(/^[0-9a-f]{40}$/.test(hotfixSha), 'HOTFIX_MERGE_SHA must be a full commit SHA.');
assert(userId && tenantId && deviceId, 'Local Connector target identity is incomplete.');
assert(evidencePath, 'EVIDENCE_PATH is required.');

const evidence = {
  schema_version: 'local-connector-production-closure-v1',
  started_at: new Date().toISOString(),
  repository: repo,
  hotfix_merge_sha: hotfixSha,
  production: {},
  runtime: {},
  self_repair: null,
  desktop_command: null,
  acceptance: null,
  sql_executed: false,
  migration_applied: false,
  secrets_included: false,
};
const save = () => fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
save();

async function fetchJson(url, options = {}, { auth = false, timeoutMs = 20_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (auth) headers.Authorization = `Bearer ${backendKey}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { non_json_response: true };
    }
    return { status: response.status, ok: response.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

async function githubJson(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const data = await response.json();
  assert(response.ok, `GitHub read failed for ${path}: HTTP ${response.status}`);
  return data;
}

function collectShas(value, output = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\b[0-9a-f]{40}\b/ig)) output.add(match[0].toLowerCase());
  } else if (Array.isArray(value)) {
    for (const item of value) collectShas(item, output);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectShas(item, output);
  }
  return output;
}

async function currentProductionSha() {
  const ref = await githubJson(`/repos/${repo}/git/ref/heads/Production`);
  return String(ref?.object?.sha || '').toLowerCase();
}

async function assertHotfixContained(productionSha) {
  const comparison = await githubJson(`/repos/${repo}/compare/${hotfixSha}...${productionSha}`);
  assert(
    ['ahead', 'identical'].includes(comparison.status),
    `Production no longer contains hotfix merge ${hotfixSha}; compare status=${comparison.status}`,
  );
  evidence.production.hotfix_compare = {
    status: comparison.status,
    ahead_by: comparison.ahead_by,
    behind_by: comparison.behind_by,
  };
  save();
}

async function waitForRuntimeParity() {
  for (let convergence = 1; convergence <= 3; convergence += 1) {
    const productionSha = await currentProductionSha();
    assert(/^[0-9a-f]{40}$/.test(productionSha), 'Production ref did not return a full commit SHA.');
    await assertHotfixContained(productionSha);
    console.log(`PRODUCTION_TARGET_SHA=${productionSha}`);

    for (let attempt = 1; attempt <= 36; attempt += 1) {
      const [health, version, deployment, agent] = await Promise.all([
        fetchJson(`${baseUrl}/health`),
        fetchJson(`${baseUrl}/version`),
        fetchJson(`${baseUrl}/deployment-info`),
        fetchJson(`${baseUrl}/connector-agent/version`),
      ]);
      const healthPass = health.ok && health.data?.ok === true;
      const versionPass = version.ok && collectShas(version.data).has(productionSha);
      const deploymentPass = deployment.ok && collectShas(deployment.data).has(productionSha);
      const agentPass = agent.ok && agent.data?.ok === true;
      console.log(
        `RUNTIME_PARITY_ATTEMPT=${attempt} health=${healthPass} version=${versionPass} deployment=${deploymentPass} agent=${agentPass}`,
      );

      if (healthPass && versionPass && deploymentPass && agentPass) {
        const latestProductionSha = await currentProductionSha();
        if (latestProductionSha !== productionSha) {
          console.log(`PRODUCTION_MOVED_DURING_READBACK=${productionSha}->${latestProductionSha}`);
          break;
        }
        evidence.production.sha = productionSha;
        evidence.runtime = {
          parity: 'pass',
          health_http: health.status,
          version_http: version.status,
          deployment_info_http: deployment.status,
          connector_agent_version_http: agent.status,
          verified_at: new Date().toISOString(),
        };
        save();
        return;
      }
      await sleep(15_000);
    }
  }
  throw new Error('Hostinger runtime did not converge to the current Production SHA within the bounded window.');
}

function ageSeconds(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? Math.max(0, Math.floor((Date.now() - parsed) / 1000)) : null;
}

function summarizeStatus(response) {
  const data = response.data || {};
  const device = data.device || {};
  const config = device.config || {};
  const routes = Array.isArray(device.routes) ? device.routes : [];
  const events = Array.isArray(device.recovery_events) ? device.recovery_events : [];
  const healthAge = ageSeconds(config.last_health_at);
  const enabledRoutes = routes.filter((route) => route?.is_enabled === true);
  const cloudflareRoutes = enabledRoutes.filter((route) => route?.route_type === 'cloudflare_tunnel');
  const healthyRoute = cloudflareRoutes.find(
    (route) => route?.health_status === 'healthy' && Boolean(route?.last_success_at),
  );
  const watchdogEvent = events.find((event) => {
    const age = ageSeconds(event?.created_at);
    return event?.source === 'watchdog'
      && ['ok', 'started'].includes(String(event?.status || ''))
      && age !== null
      && age <= 600;
  });

  const summary = {
    http_status: response.status,
    ok: response.ok && data.ok === true,
    config_id: config.config_id || null,
    canonical_device_id: config.device_id || null,
    watchdog_installed: config.watchdog_installed === true,
    watchdog_version: config.watchdog_version || null,
    agent_version: config.agent_version || null,
    last_health_at: config.last_health_at || null,
    health_age_seconds: healthAge,
    registered_route_count: enabledRoutes.length,
    cloudflare_route_count: cloudflareRoutes.length,
    healthy_cloudflare_route: Boolean(healthyRoute),
    last_route_success_at: healthyRoute?.last_success_at || null,
    recent_watchdog_heartbeat: Boolean(watchdogEvent),
    watchdog_heartbeat_at: watchdogEvent?.created_at || null,
    last_repair_at: config.last_repair_at || null,
    last_repair_status: config.last_repair_status || null,
    last_error_code: config.last_error_code || null,
    secrets_included: data.secrets_included === true,
  };
  summary.accepted = summary.ok
    && summary.watchdog_installed
    && summary.health_age_seconds !== null
    && summary.health_age_seconds <= 600
    && summary.registered_route_count >= 1
    && summary.healthy_cloudflare_route
    && summary.recent_watchdog_heartbeat
    && summary.secrets_included === false;
  return summary;
}

async function readStatus() {
  const query = new URLSearchParams({ device_id: deviceId, user_id: userId, tenant_id: tenantId });
  const response = await fetchJson(`${baseUrl}/local-manager/beta/status?${query}`, {}, { auth: true });
  return { response, summary: summarizeStatus(response) };
}

async function callSelfRepair() {
  const response = await fetchJson(
    `${baseUrl}/admin/cli/local-connector/self-repair`,
    {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, device_id: deviceId }),
    },
    { auth: true, timeoutMs: 45_000 },
  );
  assert([200, 409].includes(response.status), `Self-repair returned unexpected HTTP ${response.status}.`);
  const diagnosis = response.data?.diagnosis || {};
  const repair = response.data?.repair || {};
  evidence.self_repair = {
    http_status: response.status,
    ok: response.data?.ok === true,
    resolved_device_id: diagnosis.resolved_device_id || diagnosis.device_id || null,
    composite_status: diagnosis.composite_health?.status || null,
    repair_required: diagnosis.repair_required ?? repair.required ?? null,
    config_source: diagnosis.config_source || null,
    public_probe_status: diagnosis.public_health_probe?.status || null,
    interruption_signal: diagnosis.interruption_signal || null,
    installer_generated: repair.installer_generated === true,
    artifact_delivery: repair.artifact_delivery || null,
    secrets_included: response.data?.secrets_included === true
      || diagnosis.secrets_included === true
      || repair.secrets_included === true,
  };
  assert(evidence.self_repair.secrets_included === false, 'Self-repair returned an unsafe evidence envelope.');
  save();
}

async function enqueueRepairCommand() {
  const response = await fetchJson(
    `${baseUrl}/local-manager/device/desktop-commands`,
    {
      method: 'POST',
      body: JSON.stringify({
        action: 'repair_connector',
        execution_mode: 'desktop',
        user_id: userId,
        tenant_id: tenantId,
        device_id: deviceId,
        ttl_seconds: 1200,
        priority: 20,
        requires_user_confirmation: false,
        payload: {
          reason: 'post_production_hotfix_acceptance',
          expected_production_sha: evidence.production.sha,
          secrets_included: false,
        },
        requested_by: 'post-production-local-connector-closure',
        request_context: {
          purpose: 'production_hotfix_acceptance',
          hotfix_merge_sha: hotfixSha,
          expected_production_sha: evidence.production.sha,
          secrets_included: false,
        },
      }),
    },
    { auth: true },
  );
  assert(
    response.status === 201 && response.data?.ok === true,
    `Repair desktop command enqueue failed: HTTP ${response.status}.`,
  );
  const command = response.data.command || {};
  assert(command.command_id, 'Repair desktop command did not return command_id.');
  evidence.desktop_command = {
    command_id: command.command_id,
    status: command.status || 'queued',
    target: command.target || null,
    enqueued_at: new Date().toISOString(),
    secrets_included: false,
  };
  save();
  console.log(`REPAIR_COMMAND_ID=${command.command_id}`);
  return command.command_id;
}

async function waitForCommand(commandId) {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    const response = await fetchJson(
      `${baseUrl}/local-manager/device/desktop-commands/${encodeURIComponent(commandId)}`,
      {},
      { auth: true },
    );
    assert(response.ok && response.data?.ok === true, `Repair command readback failed: HTTP ${response.status}.`);
    const command = response.data.command || {};
    console.log(`REPAIR_COMMAND_ATTEMPT=${attempt} status=${command.status}`);
    evidence.desktop_command = {
      ...evidence.desktop_command,
      status: command.status || null,
      claimed_at: command.claimed_at || null,
      completed_at: command.completed_at || null,
      error_code: command.error_code || null,
      error_message: command.error_message || null,
      result: command.result && typeof command.result === 'object'
        ? { ...command.result, secrets_included: false }
        : null,
    };
    save();
    if (command.status === 'completed') return;
    if (['failed', 'expired', 'cancelled'].includes(command.status)) {
      throw new Error(`Repair desktop command ended with ${command.status}: ${command.error_code || 'no_error_code'}`);
    }
    await sleep(10_000);
  }
  throw new Error('Repair desktop command did not complete within the bounded window.');
}

async function waitForAcceptance() {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    const { summary } = await readStatus();
    console.log(
      `CONNECTOR_ACCEPTANCE_ATTEMPT=${attempt} accepted=${summary.accepted} health_age=${summary.health_age_seconds} routes=${summary.registered_route_count} healthy_cf=${summary.healthy_cloudflare_route} watchdog_event=${summary.recent_watchdog_heartbeat}`,
    );
    evidence.acceptance = { ...summary, checked_at: new Date().toISOString() };
    save();
    if (summary.accepted) return summary;
    await sleep(10_000);
  }
  throw new Error('Local Connector did not reach heartbeat and route acceptance within the bounded window.');
}

try {
  await waitForRuntimeParity();
  const initial = await readStatus();
  evidence.acceptance = { ...initial.summary, stage: 'initial', checked_at: new Date().toISOString() };
  save();
  console.log(`INITIAL_CONNECTOR_ACCEPTED=${initial.summary.accepted}`);

  if (!initial.summary.accepted) {
    await callSelfRepair();
    const afterSelfRepair = await readStatus();
    evidence.acceptance = {
      ...afterSelfRepair.summary,
      stage: 'after_self_repair',
      checked_at: new Date().toISOString(),
    };
    save();
    if (!afterSelfRepair.summary.accepted) {
      const commandId = await enqueueRepairCommand();
      await waitForCommand(commandId);
    }
  }

  const finalSummary = await waitForAcceptance();
  const finalProductionSha = await currentProductionSha();
  assert(
    finalProductionSha === evidence.production.sha,
    `Production moved after acceptance: ${evidence.production.sha} -> ${finalProductionSha}`,
  );
  evidence.acceptance = { ...finalSummary, stage: 'final', checked_at: new Date().toISOString() };
  evidence.completed_at = new Date().toISOString();
  evidence.result = 'pass';
  save();
  console.log(`FINAL_PRODUCTION_SHA=${evidence.production.sha}`);
  console.log('HOSTINGER_RUNTIME_PARITY=PASS');
  console.log('LOCAL_CONNECTOR_HEARTBEAT=PASS');
  console.log('LOCAL_CONNECTOR_REGISTERED_ROUTE=PASS');
  console.log('LOCAL_CONNECTOR_SECRET_SAFETY=PASS');
  console.log('POST_PRODUCTION_LOCAL_CONNECTOR_CLOSURE=PASS');
} catch (error) {
  evidence.completed_at = new Date().toISOString();
  evidence.result = 'fail';
  evidence.failure = {
    code: error?.name || 'Error',
    message: String(error?.message || error).slice(0, 1000),
    secrets_included: false,
  };
  save();
  throw error;
}
