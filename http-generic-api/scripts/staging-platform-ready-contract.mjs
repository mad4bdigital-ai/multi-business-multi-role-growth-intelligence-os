#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(apiRoot, "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const launcher = read("autopilot-portable-staging/Invoke-Staging-One-Click-Core.ps1");
const envHelper = read("autopilot-portable-staging/Staging-Environment.ps1");
const windowsHelper = read("autopilot-portable-staging/Staging-WindowsCloudflared.ps1");
const semanticReadiness = read("http-generic-api/scripts/staging-public-schema-readiness.mjs");
const authenticatedReadiness = read("http-generic-api/scripts/staging-authenticated-remote-readiness.mjs");
const dockerSidecar = read("http-generic-api/docker-compose.staging.docker-sidecar.yml");
const envExample = read("http-generic-api/.env.staging.example");
const policy = JSON.parse(read("autopilot-portable-staging/autopilot-one-click-policy.json"));

// Canonical platform-ready policy must stay fail-closed and remote-authenticated.
assert.equal(policy.tunnel_modes.mutually_exclusive, true);
assert.equal(policy.tunnel_modes.remote_managed_origin, "http://127.0.0.1:8080");
assert.equal(policy.tunnel_modes.windows_service.process_stability_readback_required, true);
assert.equal(policy.lifecycle.public_readiness.public_failure_blocks_platform_ready, true);
assert.equal(policy.lifecycle.public_readiness.disabled_mode_does_not_claim_platform_ready, true);
assert.equal(policy.lifecycle.public_readiness.tenant_oauth_metadata_required, true);
assert.equal(policy.lifecycle.public_readiness.tenant_auth_enforcement_probe_required, true);
assert.equal(policy.lifecycle.public_readiness.remote_mcp_authorization_metadata_required, true);
assert.equal(policy.lifecycle.public_readiness.remote_mcp_protected_resource_metadata_required, true);
assert.equal(policy.safety.production_deploy, false);
assert.equal(policy.safety.cloudflare_dns_mutation, false);
assert.equal(policy.safety.provider_mutation, false);

// The canonical One-Click entrypoint is Windows PowerShell, so generated secrets must stay compatible with Windows PowerShell 5.1/.NET Framework while remaining CSPRNG-backed.
assert.doesNotMatch(envHelper, /RandomNumberGenerator\]\s*::\s*Fill\s*\(/);
assert.match(envHelper, /RandomNumberGenerator\]\s*::\s*Create\s*\(\s*\)/);
assert.match(envHelper, /\$rng\.GetBytes\s*\(\s*\$bytes\s*\)/);
assert.match(envHelper, /\$rng\.Dispose\s*\(\s*\)/);
assert.match(envHelper, /finally\s*\{[\s\S]*?\$rng\.Dispose\s*\(\s*\)/);

// Probe identity is explicitly configured; readiness must preserve it and never generate a principal.
assert.match(envHelper, /STAGING_READINESS_PROBE_USER_ID/);
assert.match(envHelper, /STAGING_READINESS_PROBE_TENANT_ID/);
assert.match(envHelper, /foreach\s*\(\$probeKey\s+in\s+@\('STAGING_READINESS_PROBE_USER_ID','STAGING_READINESS_PROBE_TENANT_ID'\)\)\s*\{\s*Set-StagingEnvValue\s+\$envFile\s+\$probeKey\s+\(Get-StagingEnvValue\s+\$envFile\s+\$probeKey\)\s*\}/s);
assert.doesNotMatch(envHelper, /Ensure-StagingGeneratedValue\s+\$envFile\s+['"]?STAGING_READINESS_PROBE_(?:USER|TENANT)_ID/);
assert.match(envHelper, /STAGING_AUTHENTICATED_REMOTE_E2E_REQUIRED'\s+'true'/);
assert.match(envHelper, /STAGING_PUBLIC_SCHEMA_SEMANTIC_VALIDATION_REQUIRED'\s+'true'/);
assert.match(envHelper, /STAGING_REMOTE_ORIGIN_EVIDENCE_REQUIRED'\s+'true'/);
assert.match(envHelper, /STAGING_ACTIVATION_REQUIRED_FOR_PLATFORM_READY'\s+'true'/);
assert.match(envExample, /^STAGING_READINESS_PROBE_USER_ID=$/m);
assert.match(envExample, /^STAGING_READINESS_PROBE_TENANT_ID=$/m);
assert.match(envExample, /^STAGING_AUTHENTICATED_REMOTE_E2E_REQUIRED=true$/m);

// Windows service is self-healed to token-file transport, bounded recovery and fresh-log origin evidence.
assert.match(windowsHelper, /Ensure-StagingCloudflaredTokenFile/);
assert.match(windowsHelper, /icacls\.exe/);
assert.match(windowsHelper, /--token-file/);
assert.match(windowsHelper, /sc\.exe\s+create\s+Cloudflared/);
assert.doesNotMatch(windowsHelper, /sc\.exe\s+config\s+Cloudflared/);
assert.match(windowsHelper, /Get-CimInstance\s+Win32_Service/);
assert.match(windowsHelper, /Invoke-CimMethod[\s\S]*?-MethodName\s+Change[\s\S]*?PathName\s*=\s*\$binPath[\s\S]*?StartMode\s*=\s*'Automatic'[\s\S]*?StartName\s*=\s*'LocalSystem'/);
assert.match(windowsHelper, /\$changeCode\s*=\s*\[int\]\$change\.ReturnValue/);
assert.match(windowsHelper, /if\s*\(\$changeCode\s+-ne\s+0\)/);
assert.match(windowsHelper, /Win32_Service\.Change returned \$changeCode/);
assert.match(windowsHelper, /service readback still embeds an inline token/);
assert.match(windowsHelper, /service readback is not bound to the canonical token-file/);
assert.match(windowsHelper, /service readback is not bound to the canonical Staging logfile/);
assert.match(windowsHelper, /Cloudflared Windows service is not bound to LocalSystem after reconciliation/);
assert.match(windowsHelper, /Cloudflared Windows service is not configured for automatic start after reconciliation/);
assert.match(windowsHelper, /sc\.exe\s+failure\s+Cloudflared/);
assert.match(windowsHelper, /WriteAllText\(\$logFile,\s*''/);
assert.match(windowsHelper, /REMOTE_MANAGED_TUNNEL_ORIGIN_MISMATCH/);
assert.match(windowsHelper, /dev\\\.mad4b\\\.com/);
assert.match(windowsHelper, /mcp-dev\\\.mad4b\\\.com/);
assert.doesNotMatch(windowsHelper, /--token\s+\"?\$token/);

// Docker sidecar shares the app network namespace so the remote-managed loopback origin is valid there too.
assert.match(dockerSidecar, /network_mode:\s*"service:app"/);
assert.match(dockerSidecar, /TUNNEL_ORIGIN_APP:\s*http:\/\/127\.0\.0\.1:8080/);

// Published schemas are parsed semantically and exact-checkout canonical content must match the remote surface.
assert.match(semanticReadiness, /YAML\.parse/);
assert.match(semanticReadiness, /semanticHash/);
assert.match(semanticReadiness, /localHash\s*!==\s*remoteHash/);
assert.match(semanticReadiness, /OpenAPI operationId is required/);
assert.match(semanticReadiness, /OpenAPI operationIds must be unique/);
assert.match(semanticReadiness, /Unresolved OpenAPI local ref/);
assert.match(semanticReadiness, /External OpenAPI refs are forbidden/);
assert.match(semanticReadiness, /OAuth authorization-code endpoints mismatch/);
assert.match(semanticReadiness, /https:\/\/activation-dev\.mad4b\.com/);

// Tenant and MCP readiness must exercise real OAuth authorization-code flows with PKCE and authenticated reads.
assert.match(authenticatedReadiness, /STAGING_READINESS_PROBE_USER_ID/);
assert.match(authenticatedReadiness, /STAGING_READINESS_PROBE_TENANT_ID/);
assert.match(authenticatedReadiness, /platform-jwt\/issue/);
assert.match(authenticatedReadiness, /code_challenge_method:\s*"S256"/);
assert.match(authenticatedReadiness, /auth\/oauth\/authorize/);
assert.match(authenticatedReadiness, /auth\/oauth\/code/);
assert.match(authenticatedReadiness, /auth\/oauth\/token/);
assert.match(authenticatedReadiness, /connect\/status/);
assert.match(authenticatedReadiness, /list_accessible_workspaces/);
assert.match(authenticatedReadiness, /oauth\/revoke/);
assert.match(authenticatedReadiness, /DELETE FROM tenant_gpt_oauth_authorization_codes/);
assert.match(authenticatedReadiness, /DELETE FROM tenant_gpt_oauth_grants/);
assert.match(authenticatedReadiness, /DELETE FROM remote_mcp_oauth_authorization_codes/);
assert.match(authenticatedReadiness, /DELETE FROM remote_mcp_oauth_grants/);
assert.match(authenticatedReadiness, /residue\.total\s*===\s*0/);
assert.match(authenticatedReadiness, /runtime_tokens_persisted_to_env:\s*false/);
assert.match(authenticatedReadiness, /production_mutation:\s*false/);
assert.match(authenticatedReadiness, /cloudflare_mutation:\s*false/);
assert.match(authenticatedReadiness, /provider_mutation:\s*false/);

// One-Click must bind PLATFORM_READY to every remote gate, zero residue, and mandatory Activation Gateway.
assert.match(launcher, /Invoke-StagingPublicReadiness/);
assert.match(launcher, /Invoke-StagingAuthenticatedRemoteReadiness/);
assert.match(launcher, /\$platformReady\s*=\s*\$publicRequired\s+-and\s+\[bool\]\$EnableActivationGateway/);
assert.match(launcher, /\$authenticated\.tenant_oauth_ready/);
assert.match(launcher, /\$authenticated\.tenant_authenticated_action_ready/);
assert.match(launcher, /\$authenticated\.remote_mcp_oauth_ready/);
assert.match(launcher, /\$authenticated\.remote_mcp_read_ready/);
assert.match(launcher, /\(\$authenticated\.probe_residue\s+-eq\s+0\)/);
assert.match(launcher, /PLATFORM_READY requires the Staging Activation Gateway/);
assert.match(launcher, /platform_ready\s*=\s*\[bool\]\$platformReady/);
assert.match(launcher, /local_only_mode\s*=\s*\$TunnelMode\s+-eq\s+'disabled'/);
assert.match(launcher, /production_mutation\s*=\s*\$false/);
assert.match(launcher, /cloudflare_mutation\s*=\s*\$false/);
assert.match(launcher, /provider_mutation\s*=\s*\$false/);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-platform-ready-contract.v1",
  windows_powershell_51_random_value_compatible: true,
  authenticated_tenant_oauth: true,
  authenticated_remote_mcp: true,
  pkce_s256: true,
  zero_residue_required: true,
  activation_gateway_required: true,
  remote_managed_origin: policy.tunnel_modes.remote_managed_origin,
  production_mutation: false,
  cloudflare_mutation: false,
  provider_mutation: false,
  secrets_included: false,
}, null, 2));
