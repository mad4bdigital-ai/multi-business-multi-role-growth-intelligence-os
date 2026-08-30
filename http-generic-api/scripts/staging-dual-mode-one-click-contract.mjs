#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(apiRoot, "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const envHelper = read("autopilot-portable-staging/Staging-Environment.ps1");
const launcher = read("autopilot-portable-staging/Invoke-Staging-One-Click.ps1");
const cmd = read("autopilot-portable-staging/Start-Staging-One-Click.cmd");
const windowsCompose = read("http-generic-api/docker-compose.staging.windows-service.yml");
const dockerTunnelCompose = read("http-generic-api/docker-compose.staging.docker-sidecar.yml");
const stagingCompose = read("http-generic-api/docker-compose.staging.yml");
const envExample = read("http-generic-api/.env.staging.example");
const provisioner = read("http-generic-api/scripts/provision-remote-mcp-client.mjs");
const tenantSchema = read("http-generic-api/openapi/openapi.tenant-gpt.auth.staging.yaml");
const adminSchema = read("http-generic-api/openapi/openapi.custom-gpt.auth-dispatcher.staging.yaml");
const remoteMcpSchema = read("http-generic-api/openapi/openapi.remote-mcp.staging.yaml");
const policy = JSON.parse(read("autopilot-portable-staging/autopilot-one-click-policy.json"));

assert.equal(policy.contract, "mad4b.staging-one-click-autopilot.v1");
assert.deepEqual(policy.tunnel_modes.supported, ["windows_service", "docker_sidecar", "disabled"]);
assert.equal(policy.tunnel_modes.mutually_exclusive, true);
assert.equal(policy.tunnel_modes.quiesce_all_before_exact_sha_transition, true);
assert.equal(policy.tunnel_modes.remote_managed_origin, "http://127.0.0.1:8080");
assert.equal(policy.tunnel_modes.remote_origin_change_model, "one_time_external_review_then_mode_switch_requires_no_cloudflare_mutation");
assert.equal(policy.tunnel_modes.windows_service_stability_seconds_default, 95);
assert.equal(policy.tunnel_modes.windows_service.origin, policy.tunnel_modes.remote_managed_origin);
assert.equal(policy.tunnel_modes.windows_service.app_publish, "127.0.0.1:8080:8080");
assert.equal(policy.tunnel_modes.windows_service.token_transport, "token_file");
assert.equal(policy.tunnel_modes.windows_service.token_env_required, false);
assert.equal(policy.tunnel_modes.windows_service.process_stability_readback_required, true);
assert.equal(policy.tunnel_modes.docker_sidecar.origin, policy.tunnel_modes.remote_managed_origin);
assert.equal(policy.tunnel_modes.docker_sidecar.network_mode, "service:app");
assert.equal(policy.tunnel_modes.docker_sidecar.shared_app_network_namespace_required, true);
assert.equal(policy.tunnel_modes.docker_sidecar.token_env_required, true);
assert.equal(policy.remote_mcp_bootstrap.app_id_env, "REMOTE_MCP_APP_ID");
assert.equal(policy.remote_mcp_bootstrap.app_secret_env, "REMOTE_MCP_APP_SECRET");
assert.equal(policy.remote_mcp_bootstrap.app_id_prefix, "mcp_stg_");
assert.equal(policy.remote_mcp_bootstrap.provisioning_execution, "inside_staging_app_container");
assert.equal(policy.remote_mcp_bootstrap.default_staging_database_mutation, false);
assert.equal(policy.remote_mcp_bootstrap.explicit_provisioning_staging_database_mutation, true);
assert.equal(policy.remote_mcp_bootstrap.production_database_mutation, false);
assert.equal(policy.remote_mcp_bootstrap.token_issuance_mode, "oauth_authorization_code_runtime");
assert.equal(policy.remote_mcp_bootstrap.access_refresh_tokens_persisted_to_env, false);
assert.deepEqual(policy.remote_mcp_bootstrap.forbidden_env_credentials, [
  "REMOTE_MCP_AUTHORIZATION_CODE",
  "REMOTE_MCP_ACCESS_TOKEN",
  "REMOTE_MCP_REFRESH_TOKEN",
]);
assert.equal(policy.lifecycle.public_readiness.public_failure_blocks_platform_ready, true);
assert.equal(policy.lifecycle.public_readiness.disabled_mode_does_not_claim_platform_ready, true);
assert.equal(policy.lifecycle.public_readiness.tenant_oauth_metadata_required, true);
assert.equal(policy.lifecycle.public_readiness.tenant_auth_enforcement_probe_required, true);
assert.equal(policy.lifecycle.public_readiness.admin_authenticated_read_only_probe_required, true);
assert.equal(policy.lifecycle.public_readiness.remote_mcp_authorization_metadata_required, true);
assert.equal(policy.safety.production_deploy, false);
assert.equal(policy.safety.cloudflare_dns_mutation, false);
assert.equal(policy.safety.provider_mutation, false);

for (const key of [
  "DB_PASSWORD",
  "RUNTIME_DB_ROOT_PASSWORD",
  "GOVERNANCE_DB_PASSWORD",
  "GOVERNANCE_DB_ROOT_PASSWORD",
  "RUNTIME_PERSISTENCE_DB_PASSWORD",
  "RUNTIME_PERSISTENCE_DB_ROOT_PASSWORD",
  "BACKEND_API_KEY",
  "JWT_SECRET",
  "TENANT_GPT_SSO_SIGNING_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET",
  "TENANT_GPT_STAGING_ACTIVATION_OAUTH_CLIENT_SECRET",
  "REMOTE_MCP_OAUTH_SIGNING_SECRET",
  "REMOTE_MCP_APP_ID",
  "REMOTE_MCP_APP_SECRET",
]) {
  assert.ok(envHelper.includes(`'${key}'`), `canonical Staging generator must own ${key}`);
}
assert.match(envHelper, /New-StagingMcpAppId/);
assert.match(envHelper, /mcp_stg_/);
assert.match(envHelper, /New-StagingMcpAppSecret/);
assert.match(envHelper, /m4b_rmcp_/);
assert.match(envHelper, /STAGING_TUNNEL_REMOTE_ORIGIN.*http:\/\/127\.0\.0\.1:8080/s);
assert.match(envHelper, /'docker_sidecar'[\s\S]*?CLOUDFLARE_TUNNEL_ORIGIN_APP' 'http:\/\/127\.0\.0\.1:8080'/);
assert.match(envHelper, /STAGING_DOCKER_TUNNEL_COMPOSE_OVERRIDE' 'docker-compose\.staging\.docker-sidecar\.yml'/);
assert.match(envHelper, /REMOTE_MCP_TOKEN_ISSUANCE_MODE.*oauth_authorization_code_runtime/s);
assert.match(envHelper, /REMOTE_MCP_TOKEN_PERSISTENCE.*runtime_only/s);
assert.match(envHelper, /REMOTE_MCP_ACCESS_TOKEN\|REMOTE_MCP_REFRESH_TOKEN\|REMOTE_MCP_AUTHORIZATION_CODE/);
assert.match(envHelper, /\$RequireTunnelToken -and \$TunnelMode -eq 'docker_sidecar'/);
assert.doesNotMatch(envHelper, /\$RequireTunnelToken -and \$TunnelMode -ne 'disabled'/);

assert.match(windowsCompose, /127\.0\.0\.1:8080:8080/);
assert.doesNotMatch(windowsCompose, /0\.0\.0\.0:8080/);
assert.match(dockerTunnelCompose, /network_mode:\s*"service:app"/);
assert.match(dockerTunnelCompose, /TUNNEL_ORIGIN_APP:\s*http:\/\/127\.0\.0\.1:8080/);
assert.match(stagingCompose, /app:\s*[\s\S]*?ports:\s*\[\]/);
assert.match(stagingCompose, /cloudflared:[\s\S]*?--token/);

assert.match(launcher, /ValidateSet\('disabled','windows_service','docker_sidecar'\)/);
assert.match(launcher, /ValidateRange\(65,300\)/);
assert.match(launcher, /TunnelStabilitySeconds = 95/);
assert.match(launcher, /Quiesce-StagingTunnelRuntimes/);
assert.match(launcher, /Stop-WindowsTunnelRuntime/);
assert.match(launcher, /Stop-DockerTunnelRuntime/);
assert.match(launcher, /com\.docker\.compose\.service=cloudflared/);
assert.match(launcher, /http:\/\/127\.0\.0\.1:8080/);
assert.match(launcher, /docker-compose\.staging\.windows-service\.yml/);
assert.match(launcher, /docker-compose\.staging\.docker-sidecar\.yml/);
assert.match(launcher, /--no-build/);
assert.match(launcher, /--no-deps','cloudflared/);
assert.match(launcher, /HostConfig\.NetworkMode/);
assert.match(launcher, /--token-file/);
assert.match(launcher, /ProcessId -ne \$initialPid/);
assert.match(launcher, /RequireTunnelToken:\(\$TunnelMode -eq 'docker_sidecar'\)/);
assert.match(launcher, /'BuildMode',\$BuildMode,'-NoTunnel'/);
assert.match(launcher, /openapi\.tenant-gpt\.auth\.staging\.yaml/);
assert.match(launcher, /openapi\.custom-gpt\.auth-dispatcher\.staging\.yaml/);
assert.match(launcher, /\.well-known\/oauth-authorization-server/);
assert.match(launcher, /\.well-known\/oauth-protected-resource/);
assert.match(launcher, /connect\/status/);
assert.match(launcher, /system\/tools/);
assert.match(launcher, /openapi\.remote-mcp\.staging\.yaml/);
assert.match(launcher, /exec','-T','app','node','scripts\/provision-remote-mcp-client\.mjs/);
assert.match(launcher, /--confirm=PROVISION_REMOTE_MCP_STAGING/);
assert.match(launcher, /--redact-secret-output/);
assert.match(launcher, /tenant_authenticated_action_state = 'requires_end_user_oauth_runtime'/);
assert.match(launcher, /mcp_access_tokens_persisted_to_env = \$false/);
assert.match(launcher, /staging_database_mutation = \[bool\]\$ProvisionMcpApp/);
assert.match(launcher, /production_database_mutation = \$false/);
assert.match(launcher, /cloudflare_mutation = \$false/);
assert.match(launcher, /production_mutation = \$false/);
assert.match(launcher, /provider_mutation = \$false/);

assert.match(provisioner, /REMOTE_MCP_APP_ID/);
assert.match(provisioner, /REMOTE_MCP_APP_SECRET/);
assert.match(provisioner, /Boolean\(process\.env\.REMOTE_MCP_APP_SECRET\)/);
assert.match(provisioner, /REMOTE_MCP_ACCESS_TOKEN/);
assert.match(provisioner, /REMOTE_MCP_REFRESH_TOKEN/);
assert.match(provisioner, /runtime-minted by OAuth/);
assert.match(provisioner, /client_secret: result\.client_secret \? "\[REDACTED\]" : null/);

assert.match(envExample, /^STAGING_TUNNEL_MODE=windows_service$/m);
assert.match(envExample, /^STAGING_TUNNEL_REMOTE_ORIGIN=http:\/\/127\.0\.0\.1:8080$/m);
assert.match(envExample, /^REMOTE_MCP_APP_ID=$/m);
assert.match(envExample, /^REMOTE_MCP_APP_SECRET=$/m);
assert.match(envExample, /^REMOTE_MCP_TOKEN_ISSUANCE_MODE=oauth_authorization_code_runtime$/m);
assert.match(envExample, /^REMOTE_MCP_TOKEN_PERSISTENCE=runtime_only$/m);
assert.doesNotMatch(envExample, /^REMOTE_MCP_ACCESS_TOKEN=/m);
assert.doesNotMatch(envExample, /^REMOTE_MCP_REFRESH_TOKEN=/m);
assert.doesNotMatch(envExample, /^REMOTE_MCP_AUTHORIZATION_CODE=/m);
assert.match(cmd, /windows_service/);
assert.match(cmd, /docker_sidecar/);

assert.match(tenantSchema, /https:\/\/dev\.mad4b\.com/);
assert.match(adminSchema, /https:\/\/dev\.mad4b\.com/);
assert.match(remoteMcpSchema, /https:\/\/mcp_dev\.mad4b\.com/);
assert.doesNotMatch(tenantSchema, /https:\/\/auth\.mad4b\.com\s*$/m);
assert.doesNotMatch(adminSchema, /https:\/\/auth\.mad4b\.com\s*$/m);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-dual-mode-one-click-contract.v1",
  tunnel_modes: policy.tunnel_modes.supported,
  remote_managed_origin: policy.tunnel_modes.remote_managed_origin,
  canonical_env_generator: policy.bootstrap.canonical_environment_generator,
  mcp_token_issuance_mode: policy.remote_mcp_bootstrap.token_issuance_mode,
  public_custom_gpt_gate: true,
  production_mutation: false,
  provider_mutation: false,
  secrets_included: false,
}, null, 2));
