import fs from 'node:fs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const clean = (value, max = 500) => String(value || '').slice(0, max);

const baseUrl = clean(process.env.RUNTIME_BASE_URL).replace(/\/$/, '');
const repository = clean(process.env.REPOSITORY);
const backendKey = clean(process.env.BACKEND_API_KEY, 10000).trim();
const githubToken = clean(process.env.GH_READ_TOKEN, 10000).trim();
const hotfixMergeSha = clean(process.env.HOTFIX_MERGE_SHA).toLowerCase();
const adminUserId = clean(process.env.ADMIN_USER_ID);
const tenantId = clean(process.env.PLATFORM_TENANT_ID);
const deviceId = clean(process.env.DEVICE_ID);
const evidencePath = clean(process.env.EVIDENCE_PATH, 2000);
const outputPath = clean(process.env.GITHUB_OUTPUT, 2000);

assert(baseUrl, 'RUNTIME_BASE_URL is required.');
assert(repository, 'REPOSITORY is required.');
assert(backendKey, 'BACKEND_API_KEY is required.');
assert(githubToken, 'GH_READ_TOKEN is required.');
assert(/^[0-9a-f]{40}$/.test(hotfixMergeSha), 'HOTFIX_MERGE_SHA must be a full SHA.');
assert(adminUserId && tenantId && deviceId, 'Local Connector target identity is incomplete.');
assert(evidencePath, 'EVIDENCE_PATH is required.');

const evidence = {
  schema_version: 'governed-local-connector-production-closure-v2',
  started_at: new Date().toISOString(),
  repository,
  hotfix_merge_sha: hotfixMergeSha,
  production: {},
  runtime: {},
  initial_acceptance: null,
  self_repair: null,
  active_command_readback: null,
  desktop_command: null,
  final_acceptance: null,
  database_read_only_query_executed: false,
  database_mutation_executed: false,
  migration_applied: false,
  provider_mutation_executed: false,
  secrets_included: false,
};

function save() {
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
}

function setOutput(name, value) {
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${clean(value, 2000).replace(/\n/g, ' ')}\n`);
}

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
    let data = {};
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
  const ref = await githubJson(`/repos/${repository}/git/ref/heads/Production`);
  return clean(ref?.object?.sha).toLowerCase();
}

async function assertHotfixContained(productionSha) {
  const comparison = await githubJson(`/repos/${repository}/compare/${hotfixMergeSha}...${productionSha}`);
  assert(
    ['ahead', 'identical'].includes(comparison.status),
    `Production does not contain hotfix ${hotfixMergeSha}; status=${comparison.status}`,
  );
  evidence.production.hotfix_compare = {
    status: comparison.status,
    ahead_by: Number(comparison.ahead_by || 0),
    behind_by: Number(comparison.behind_by || 0),
  };
  save();
}

async function waitForRuntimeParity() {
  for (let convergence = 1; convergence <= 3; convergence += 1) {
    const productionSha = await currentProductionSha();
    assert(/^[0-9a-f]{40}$/.test(productionSha), 'Production ref did not return a full SHA.');
    await assertHotfixContained(productionSha);
    console.log(`PRODUCTION_TARGET_SHA=${productionSha}`);

    for (let attempt = 1; attempt <= 40; attempt += 1) {
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
        const latestSha = await currentProductionSha();
        if (latestSha !== productionSha) break;
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
        return productionSha;
      }
      await sleep(15_000);
    }
  }
  throw new Error('Runtime did not converge to current Production within the bounded window.');
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
      && ['ok', 'started'].includes(clean(event?.status, 32))
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
  const query = new URLSearchParams({ device_id: deviceId, user_id: adminUserId, tenant_id: tenantId });
  const response = await fetchJson(`${baseUrl}/local-manager/beta/status?${query}`, {}, { auth: true });
  return summarizeStatus(response);
}

async function callSelfRepair() {
  const response = await fetchJson(
    `${baseUrl}/admin/cli/local-connector/self-repair`,
    { method: 'POST', body: JSON.stringify({ user_id: adminUserId, device_id: deviceId }) },
    { auth: true, timeoutMs: 45_000 },
  );
  assert([200, 409].includes(response.status), `Self-repair returned HTTP ${response.status}.`);
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
    artifact_delivery: repair.artifact_delivery || null,
    secrets_included: response.data?.secrets_included === true
      || diagnosis.secrets_included === true
      || repair.secrets_included === true,
  };
  assert(evidence.self_repair.secrets_included === false, 'Self-repair returned unsafe evidence.');
  save();
}

async function findActiveRepairCommand() {
  const sql = `SELECT command_id, status, requested_by, created_at, claimed_at, expires_at, error_code
    FROM local_manager_desktop_commands
    WHERE user_id = ?
      AND action = 'repair_connector'
      AND status IN ('queued','claimed')
      AND (expires_at IS NULL OR expires_at > NOW())
      AND (
        requested_by = 'post-production-local-connector-closure'
        OR JSON_UNQUOTE(JSON_EXTRACT(request_context_json, '$.purpose')) = 'production_hotfix_acceptance'
      )
    ORDER BY created_at DESC
    LIMIT 1`;
  const response = await fetchJson(
    `${baseUrl}/admin/cli/control`,
    {
      method: 'POST',
      body: JSON.stringify({ tool: 'db', action: 'run', sql, params: [adminUserId] }),
    },
    { auth: true },
  );
  assert(response.ok && response.data?.ok === true, `Active command readback failed: HTTP ${response.status}.`);
  evidence.database_read_only_query_executed = true;
  const rows = response.data?.result?.rows || [];
  const row = Array.isArray(rows) ? rows[0] : null;
  evidence.active_command_readback = {
    found: Boolean(row?.command_id),
    command_id: row?.command_id || null,
    status: row?.status || null,
    requested_by: row?.requested_by || null,
    created_at: row?.created_at || null,
    claimed_at: row?.claimed_at || null,
    expires_at: row?.expires_at || null,
    secrets_included: false,
  };
  save();
  return row?.command_id || null;
}

async function enqueueRepairCommand() {
  const response = await fetchJson(
    `${baseUrl}/local-manager/device/desktop-commands`,
    {
      method: 'POST',
      body: JSON.stringify({
        action: 'repair_connector',
        execution_mode: 'desktop',
        user_id: adminUserId,
        tenant_id: tenantId,
        device_id: deviceId,
        ttl_seconds: 1800,
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
          hotfix_merge_sha: hotfixMergeSha,
          expected_production_sha: evidence.production.sha,
          secrets_included: false,
        },
      }),
    },
    { auth: true },
  );
  assert(response.status === 201 && response.data?.ok === true, `Command enqueue failed: HTTP ${response.status}.`);
  const command = response.data.command || {};
  assert(command.command_id, 'Command enqueue did not return command_id.');
  evidence.desktop_command = {
    command_id: command.command_id,
    source: 'newly_enqueued',
    status: command.status || 'queued',
    target: command.target || null,
    enqueued_at: new Date().toISOString(),
    secrets_included: false,
  };
  save();
  return command.command_id;
}

function sanitizeCommandResult(result) {
  if (!result || typeof result !== 'object') return null;
  return {
    repair_stage: result.repair_stage || null,
    repair_verified: result.repair_verified === true,
    verification_attempts: Number(result.verification_attempts || 0),
    cloudflared_running: result.cloudflared_running === true,
    connector_service_running: result.connector_service_running === true,
    heartbeat_recent: result.heartbeat_recent === true,
    registered_route_count: Number(result.registered_route_count || 0),
    secrets_included: false,
  };
}

async function waitForCommand(commandId, source) {
  for (let attempt = 1; attempt <= 150; attempt += 1) {
    const response = await fetchJson(
      `${baseUrl}/local-manager/device/desktop-commands/${encodeURIComponent(commandId)}`,
      {},
      { auth: true },
    );
    assert(response.ok && response.data?.ok === true, `Command readback failed: HTTP ${response.status}.`);
    const command = response.data.command || {};
    console.log(`REPAIR_COMMAND_ATTEMPT=${attempt} status=${command.status}`);
    evidence.desktop_command = {
      ...(evidence.desktop_command || {}),
      command_id: commandId,
      source,
      status: command.status || null,
      claimed_at: command.claimed_at || null,
      completed_at: command.completed_at || null,
      error_code: command.error_code || null,
      error_message: clean(command.error_message, 500) || null,
      result: sanitizeCommandResult(command.result),
      secrets_included: false,
    };
    save();
    if (command.status === 'completed') return;
    if (['failed', 'expired', 'cancelled'].includes(command.status)) {
      throw new Error(`Repair command ended with ${command.status}: ${command.error_code || 'no_error_code'}`);
    }
    await sleep(10_000);
  }
  throw new Error('Repair command did not complete within the bounded window.');
}

async function waitForAcceptance() {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    const summary = await readStatus();
    console.log(
      `CONNECTOR_ACCEPTANCE_ATTEMPT=${attempt} accepted=${summary.accepted} health_age=${summary.health_age_seconds} routes=${summary.registered_route_count} healthy_cf=${summary.healthy_cloudflare_route} watchdog=${summary.recent_watchdog_heartbeat}`,
    );
    evidence.final_acceptance = { ...summary, checked_at: new Date().toISOString() };
    save();
    if (summary.accepted) return summary;
    await sleep(10_000);
  }
  throw new Error('Local Connector did not reach heartbeat and route acceptance within the bounded window.');
}

try {
  await waitForRuntimeParity();
  const initial = await readStatus();
  evidence.initial_acceptance = { ...initial, checked_at: new Date().toISOString() };
  save();

  if (!initial.accepted) {
    await callSelfRepair();
    const afterRepair = await readStatus();
    if (!afterRepair.accepted) {
      const activeCommandId = await findActiveRepairCommand();
      const commandId = activeCommandId || await enqueueRepairCommand();
      await waitForCommand(commandId, activeCommandId ? 'existing_active_command' : 'newly_enqueued');
    }
  }

  const finalAcceptance = await waitForAcceptance();
  const finalProductionSha = await currentProductionSha();
  assert(
    finalProductionSha === evidence.production.sha,
    `Production moved during closure: ${evidence.production.sha} -> ${finalProductionSha}`,
  );
  evidence.final_acceptance = { ...finalAcceptance, checked_at: new Date().toISOString() };
  evidence.completed_at = new Date().toISOString();
  evidence.result = 'pass';
  save();
  setOutput('result', 'pass');
  setOutput('production_sha', evidence.production.sha);
  setOutput('command_id', evidence.desktop_command?.command_id || 'not_required');
  setOutput('registered_route_count', finalAcceptance.registered_route_count);
  setOutput('health_age_seconds', finalAcceptance.health_age_seconds);
  console.log(`FINAL_PRODUCTION_SHA=${evidence.production.sha}`);
  console.log('POST_PRODUCTION_LOCAL_CONNECTOR_CLOSURE=PASS');
} catch (error) {
  evidence.completed_at = new Date().toISOString();
  evidence.result = 'fail';
  evidence.failure = {
    code: clean(error?.name || 'Error', 100),
    message: clean(error?.message || error, 1000),
    secrets_included: false,
  };
  save();
  setOutput('result', 'fail');
  setOutput('production_sha', evidence.production.sha || 'unverified');
  setOutput('command_id', evidence.desktop_command?.command_id || evidence.active_command_readback?.command_id || 'none');
  setOutput('failure_message', evidence.failure.message);
  throw error;
}
