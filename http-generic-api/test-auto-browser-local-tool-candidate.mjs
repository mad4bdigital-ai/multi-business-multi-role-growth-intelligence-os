import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const connector = readFileSync('../local-connector/server.mjs', 'utf8');
const agent = readFileSync('routes/connectorAgentRoutes.js', 'utf8');
const proxy = readFileSync('routes/connectorProxyRoutes.js', 'utf8');
const migration = readFileSync('migrations/147_sprint65_auto_browser_local_tool_candidate.sql', 'utf8');
const allowlist = readFileSync('openapi-route-coverage.allowlist.json', 'utf8');
const managedRuntimeMigration = readFileSync('migrations/173_sprint65_auto_browser_managed_runtime_start.sql', 'utf8');

assert(connector.includes('CONNECTOR_AUTO_BROWSER_ENABLED'), 'local connector must define Auto Browser enablement flag');
assert(connector.includes('AUTO_BROWSER_BASE_URL'), 'local connector must define Auto Browser base URL');
assert(connector.includes("http://127.0.0.1:8000"), 'Auto Browser controller default must match upstream API port 8000');
assert(agent.includes('AUTO_BROWSER_BASE_URL: "http://127.0.0.1:8000"'), 'Auto Browser manifest must match upstream API port 8000');
assert(agent.includes('AUTO_BROWSER_BASE_URL=http://127.0.0.1:8000'), 'Auto Browser installer env must match upstream API port 8000');
assert(connector.includes("AUTO_BROWSER_HEALTH_PATH = process.env.AUTO_BROWSER_HEALTH_PATH ?? '/healthz'"), 'Auto Browser connector default health probe must use /healthz');
assert(agent.includes('AUTO_BROWSER_HEALTH_PATH: "/healthz"'), 'Auto Browser manifest must use /healthz');
assert(agent.includes('AUTO_BROWSER_HEALTH_PATH=/healthz'), 'Auto Browser installer env must use /healthz');
assert(!connector.includes('http://127.0.0.1:7331'), 'Auto Browser connector must not use stale default port 7331');
assert(!agent.includes('http://127.0.0.1:7331'), 'Auto Browser manifest/installer must not use stale default port 7331');
assert(connector.includes('AUTO_BROWSER_ALLOWED_HOSTS'), 'local connector must define Auto Browser host allowlist');
assert(connector.includes('async function handleAutoBrowser'), 'local connector must expose Auto Browser handler');
assert(connector.includes("action !== 'status'"), 'Auto Browser local endpoint must block non-status actions before adapter PoC');
assert(connector.includes('AUTO_BROWSER_ADAPTER_NOT_VALIDATED'), 'blocked non-status actions must have stable code');
assert(connector.includes("url === '/auto-browser'"), 'local connector router must route /auto-browser');
assert(connector.includes("blocked_actions: ['visual_takeover', 'click', 'type', 'auth_profile_reuse', 'destructive_actions']"), 'local endpoint must disclose blocked actions');
assert(connector.includes('secrets_included: false'), 'Auto Browser connector response must not include secrets');

assert(agent.includes('tool_key: "auto_browser"'), 'connector agent manifest must list Auto Browser local tool candidate');
assert(agent.includes('external_provider_manifest_candidate'), 'Auto Browser manifest entry must remain candidate install kind');
assert(agent.includes('candidate_pending_install_plan'), 'Auto Browser must not be active in Local Manager manifest');
assert(agent.includes('https://github.com/LvcidPsyche/auto-browser'), 'manifest must retain Auto Browser source URL');
assert(agent.includes('CONNECTOR_AUTO_BROWSER_ENABLED=false'), 'installer must keep Auto Browser disabled by default');
assert(agent.includes('explicit_user_approval_required'), 'Auto Browser manifest policy must require user approval');
assert(agent.includes('adapter_poc_required_before_activation'), 'Auto Browser manifest policy must require adapter PoC');

assert(proxy.includes('/connector/:device_id/auto-browser'), 'auth-host must proxy Auto Browser connector route');
assert(proxy.includes('"/auto-browser"'), 'proxy must forward to local /auto-browser endpoint');
assert(allowlist.includes('POST /connector/{device_id}/auto-browser'), 'new proxy route must be route-coverage allowlisted until documented');

assert(migration.includes('connector_auto_browser'), 'migration must register connector_auto_browser tool');
assert(migration.includes('auto_browser_essam_v1'), 'migration must update Auto Browser runtime metadata');
assert(migration.includes('local_tool_candidate_status_probe'), 'runtime metadata must classify status-probe phase');
assert(migration.includes('validated_actions":["status"]'), 'runtime metadata must limit validated actions to status');
assert(migration.includes('blocked_until_poc'), 'runtime metadata must block execution actions until PoC');
assert(migration.includes('candidate_only'), 'tool tags must keep Auto Browser candidate-only');
assert(!migration.includes('"action":{"type":"string","enum":["visual_takeover"]}'), 'tool schema must not expose visual takeover execution yet');

console.log('auto browser local tool candidate tests passed');
