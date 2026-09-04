import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const manifest = JSON.parse(read("autopilot-portable-staging/manifest.json"));

for (const entry of manifest.files) {
  const content = read(entry.path);
  const digest = crypto.createHash("sha256").update(content).digest("hex");
  assert.equal(digest, entry.sha256, `manifest hash mismatch: ${entry.path}`);
}
const manifestPaths = new Set(manifest.files.map((entry) => entry.path));
for (const requiredPath of [
  "autopilot-portable-staging/Invoke-Staging-One-Click.ps1",
  "autopilot-portable-staging/Staging-Environment.ps1",
  "autopilot-portable-staging/Staging-WindowsCloudflared.ps1",
  "autopilot-portable-staging/Staging-GitTransport.ps1",
  "http-generic-api/docker-compose.staging.windows-service.yml",
  "http-generic-api/docker-compose.staging.docker-sidecar.yml",
  "http-generic-api/scripts/generate-portable-staging-manifest.mjs",
  "http-generic-api/scripts/provision-remote-mcp-client.mjs",
  "http-generic-api/scripts/staging-public-schema-readiness.mjs",
  "http-generic-api/scripts/staging-authenticated-remote-readiness.mjs",
  "http-generic-api/openapi/openapi.tenant-gpt.auth.staging.yaml",
  "http-generic-api/openapi/openapi.custom-gpt.auth-dispatcher.staging.yaml",
  "http-generic-api/openapi/openapi.remote-mcp.staging.yaml",
  "http-generic-api/openapi/openapi.tenant-gpt.activation.staging.yaml",
  "http-generic-api/openapi/openapi.custom-gpt.activation-admin.staging.yaml",
]) {
  assert.ok(manifestPaths.has(requiredPath), `portable manifest missing ${requiredPath}`);
}

const compose = parse(read("http-generic-api/docker-compose.staging.yml"));
const dockerfile = read("http-generic-api/Dockerfile.staging");
const env = read("http-generic-api/.env.staging.example");
const policy = JSON.parse(read("http-generic-api/config/domain-family-policy.json"));
const deploymentPolicy = JSON.parse(read("http-generic-api/config/deployment-branch-policy.json"));
const autopilot = read("autopilot-portable-staging/Start-AutoPilot.ps1");
const certification = read("autopilot-portable-staging/Invoke-StagingCertification.ps1");
const gitTransport = read("autopilot-portable-staging/Staging-GitTransport.ps1");
const oneClickCmd = read("autopilot-portable-staging/Start-Staging-One-Click.cmd");
const authorityClosure = read("http-generic-api/scripts/staging-environment-authority-closure.mjs");
const liveCertification = read("http-generic-api/scripts/staging-live-certification.mjs");
const windowsPreflight = read("autopilot-portable-staging/Staging-Windows-Preflight.ps1");
const tunnel = compose.services.cloudflared;

assert.deepEqual(tunnel.profiles, ["tunnel"]);
assert.match(String(tunnel.image), /@sha256:/);
assert.equal(tunnel.depends_on.app.condition, "service_healthy");
assert.match(String(tunnel.command), /\$\{CLOUDFLARE_TUNNEL_TOKEN:-\}/);
assert.match(env, /^CLOUDFLARE_TUNNEL_HOSTNAMES=dev\.mad4b\.com,mcp-dev\.mad4b\.com\s*$/m);
assert.doesNotMatch(env, /^CLOUDFLARE_TUNNEL_HOSTNAMES=.*activation-dev/m);
assert.match(env, /^REMOTE_MCP_ENABLED=true\s*$/m);
assert.match(env, /^REMOTE_MCP_OAUTH_ENABLED=true\s*$/m);
assert.match(env, /^REMOTE_MCP_RESOURCE_URL=https:\/\/mcp-dev\.mad4b\.com\s*$/m);
assert.match(env, /^CLOUDFLARE_TUNNEL_ORIGIN_APP=http:\/\/127\.0\.0\.1:8080\s*$/m);
assert.match(autopilot, /\^CLOUDFLARE_TUNNEL_ORIGIN_APP=http:\/\/127\\\.0\\\.0\\\.1:8080\\s\*\$/);
assert.doesNotMatch(autopilot, /CLOUDFLARE_TUNNEL_ORIGIN_APP=http:\/\/app:8080/);
assert.match(env, /^CLOUDFLARE_TUNNEL_TOKEN=\s*$/m);
assert.match(env, /^TENANT_GPT_SSO_COOKIE_MODE=host_only\s*$/m);
assert.match(env, /^MIGRATION_APPLIED=false\s*$/m);
assert.match(env, /^DATABASE_MUTATED=false\s*$/m);
assert.deepEqual(policy.environments.staging.active_tunnel_hostnames, ["dev.mad4b.com", "mcp-dev.mad4b.com"]);
assert.deepEqual(policy.environments.staging.active_worker_custom_domains, ["activation-dev.mad4b.com"]);
assert.deepEqual(policy.environments.staging.reserved_disabled_hostnames, []);
assert.equal(deploymentPolicy.staging.source_branch, "main");
assert.equal(deploymentPolicy.staging.production_traffic_allowed, false);
assert.equal(deploymentPolicy.production.source_branch, "Production");
assert.equal(deploymentPolicy.promotion.force_push_allowed, false);
assert.match(oneClickCmd, /docker_sidecar\s*:.*127\.0\.0\.1:8080/i);
assert.match(oneClickCmd, /shared app network namespace/i);
assert.doesNotMatch(oneClickCmd, /docker_sidecar\s*:.*app:8080/i);

assert.match(windowsPreflight, /function Test-StagingWsl2DistributionReady/);
assert.match(windowsPreflight, /-replace "\\x00", ""/);
assert.match(windowsPreflight, /function Wait-StagingWsl2Distribution/);
assert.match(autopilot, /Staging-Windows-Preflight\.ps1/);
assert.match(autopilot, /Test-StagingWsl2Ready/);
assert.match(autopilot, /Assert-Sha/);
assert.match(autopilot, /Set-EnvValue \$EnvFile "DEPLOYMENT_EXPECTED_COMMIT_SHA" \$ExpectedCommit/);
assert.match(autopilot, /Set-EnvValue \$EnvFile "DEPLOY_COMMIT" \$ExpectedCommit/);
assert.match(autopilot, /Set-EnvValue \$EnvFile "DEPLOY_BRANCH" \$Ref/);
assert.match(compose.services.app.environment.DEPLOYMENT_EXPECTED_COMMIT_SHA, /DEPLOYMENT_EXPECTED_COMMIT_SHA/);
assert.match(compose.services.app.environment.DEPLOY_COMMIT, /DEPLOY_COMMIT/);
assert.match(compose.services.app.environment.DEPLOY_BRANCH, /DEPLOY_BRANCH/);
assert.match(String(compose.services.app.build.args.STAGING_BUILD_COMMIT), /DEPLOY_COMMIT/);
assert.match(String(compose.services.app.build.args.STAGING_BUILD_BRANCH), /DEPLOY_BRANCH/);
assert.match(dockerfile, /ARG STAGING_BUILD_COMMIT/);
assert.match(dockerfile, /ARG STAGING_BUILD_BRANCH=main/);
assert.match(dockerfile, /deployment-manifest\.json/);
assert.match(dockerfile, /staging-route-policy\.json/);
assert.doesNotMatch(dockerfile, /new Date\(\)\.toISOString\(\)/);
assert.match(autopilot, /Working tree is not clean/);
assert.match(autopilot, /DOCKER_HOST/);
assert.match(autopilot, /DOCKER_CONTEXT/);
assert.match(autopilot, /MIGRATION_APPLIED=false/);
assert.match(autopilot, /DATABASE_MUTATED=false/);
assert.match(autopilot, /Invoke-StagingCertification\.ps1/);
assert.match(autopilot, /certification_status = "pending"/);
assert.match(autopilot, /Staging is running but not release-ready/);
assert.match(certification, /staging-live-certification\.mjs/);
assert.match(certification, /STAGING_CERT_EXPECTED_COMMIT/);
assert.match(certification, /STAGING_CERT_REQUIRE_READY=false/);
assert.match(certification, /STAGING_CERTIFICATION_BLOCKED/);
assert.match(certification, /STAGING_CERTIFICATION_DEGRADED/);

assert.match(gitTransport, /System\.Diagnostics\.ProcessStartInfo/);
assert.match(gitTransport, /System\.Diagnostics\.Process/);
assert.match(gitTransport, /UseShellExecute = \$false/);
assert.match(gitTransport, /RedirectStandardOutput = \$true/);
assert.match(gitTransport, /RedirectStandardError = \$true/);
assert.match(gitTransport, /ReadToEndAsync\(\)/);
assert.match(gitTransport, /\$process\.ExitCode/);
assert.match(gitTransport, /ConvertTo-StagingProcessArgument/);
assert.match(gitTransport, /Join-StagingProcessArguments/);
assert.doesNotMatch(gitTransport, /\$nativeOutput = @\(& git @transportArguments 2>&1\)/);
assert.doesNotMatch(gitTransport, /\$nativeExitCode = \$LASTEXITCODE/);
assert.match(gitTransport, /__staging_git_exit_marker/);
assert.match(gitTransport, /Test-StagingGitReadOnlyExitAnomaly/);
assert.match(gitTransport, /\$Arguments\[0\] -ne "ls-remote"/);
assert.match(gitTransport, /bounded retry/);
assert.match(gitTransport, /if \(\$lastExitCode -eq 0\)/);
assert.match(gitTransport, /\$isReadOnlyExitAnomaly = Test-StagingGitReadOnlyExitAnomaly/);
assert.match(gitTransport, /-not \(\$isRetryable -or \$isReadOnlyExitAnomaly\)/);
assert.match(gitTransport, /retry_class=\{3\}/);
assert.match(gitTransport, /read_only_exit_anomaly/);
assert.match(gitTransport, /native_capture = "system_diagnostics_process_exitcode"/);
assert.match(gitTransport, /process_shell_execute = \$false/);
assert.match(gitTransport, /process_stdout_stderr_redirected = \$true/);
assert.match(gitTransport, /ls_remote_nonzero_ref_policy = "bounded_retry_never_accept_nonzero"/);

assert.match(authorityClosure, /deployment-branch-policy\.json/);
assert.match(authorityClosure, /runtime-environment-invariant-contract\.json/);
assert.match(authorityClosure, /runtime-db-write-authority-profiles\.json/);
assert.match(authorityClosure, /route-policy\.staging\.json/);
assert.match(authorityClosure, /generic_runtime_principal_fallback/);
assert.match(authorityClosure, /staging_gateway_stale_mutation_policy_not_deny/);
assert.match(liveCertification, /include_production_activation_readiness/);
assert.match(liveCertification, /runtime_integrity_verified/);
assert.match(liveCertification, /combined_database_readiness/);
assert.match(liveCertification, /gateway_policy_hash_current/);
assert.match(liveCertification, /const gatewayHealthUsable = health\.ok && health\.body !== null && typeof health\.body === "object"/);
assert.match(liveCertification, /integrityChecks\.push\(check\("gateway_health_reachable", gatewayHealthUsable/);
assert.match(liveCertification, /if \(gatewayHealthUsable\) \{[\s\S]*integrityChecks\.push\(check\("gateway_exact_commit"/);
assert.doesNotMatch(liveCertification, /readinessChecks\.push\(check\("gateway_health_reachable"/);
assert.match(liveCertification, /outcome = integrityFailed\.length > 0 \? "blocked" : readinessFailed\.length > 0 \? "degraded" : "ready"/);
assert.doesNotMatch(autopilot, /Invoke-WebRequest|curl|cloudflare.*api|hostinger.*api/i);

console.log("staging_autopilot_closure=PASS");