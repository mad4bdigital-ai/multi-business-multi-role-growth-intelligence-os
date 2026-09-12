import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

const executor = readFileSync(new URL("./wordpressStagingPluginDeployExecutor.js", import.meta.url), "utf8");
const route = readFileSync(new URL("./routes/wordpressStagingPluginDeployRoutes.js", import.meta.url), "utf8");
const routesIndex = readFileSync(new URL("./routes/index.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/20260910_wordpress_staging_plugin_deploy_authority.sql", import.meta.url), "utf8");
const preciseOpenApi = readFileSync(new URL("./openapi/wordpress-staging-plugin-deploy.yaml", import.meta.url), "utf8");
const preciseRegistry = readFileSync(new URL("./openapi-route-contracts.d/wordpress-staging-plugin-deploy.yaml", import.meta.url), "utf8");
const preciseOpenApiDoc = YAML.parse(preciseOpenApi);
const preciseRequest = preciseOpenApiDoc?.wordpressStagingPluginDeployPath?.post?.requestBody?.content?.["application/json"]?.schema || {};

function requires(source, markers, label) {
  for (const marker of markers) {
    assert(source.includes(marker), `${label} missing invariant: ${marker}`);
  }
}

requires(executor, [
  'WORDPRESS_STAGING_DEPLOY_CONTRACT = "mad4b.wordpress-staging-plugin-deploy.v1"',
  'WORDPRESS_STAGING_DEPLOY_OPERATION = "wordpress_staging_plugin_deploy"',
  'WORDPRESS_STAGING_SOURCE_REPOSITORY = "mad4bdigital-ai/WordPress"',
  'WORDPRESS_STAGING_SOURCE_WORKFLOW = "mad4b-control-plane-package.yml"',
  'WORDPRESS_STAGING_ORIGIN = "https://staging.egypttourgates.com"',
  'WORDPRESS_STAGING_MCP_ADAPTER_VERSION = "0.6.1"',
  'target.target_kind !== "hosting_account"',
  'target.provider_family !== "hostinger"',
  'target.status !== "active"',
  'target.command_allowlist.includes(WORDPRESS_STAGING_DEPLOY_OPERATION)',
  'environment !== "staging"',
  'origin !== WORDPRESS_STAGING_ORIGIN',
  'pathAllowedByTarget(wordpressPath, target)',
  'resolveEffectiveCredential',
  'wp_get_environment_type()',
  'wp option get home',
  'wp option get siteurl',
  'wp plugin get mcp-adapter --field=version',
  'preflight_result=ok',
  'status=success&event=pull_request',
  'mad4b-site-control-plane-staging-kit-${expectedHeadSha}',
  'mad4b.site-control-plane.staging-install-kit.v4',
  'staging-governed-write-release-candidate',
  'pluginSha !== String(manifest?.control_plane?.sha256',
  'staging-deployment-handoff.json',
  'mad4b.wordpress-staging-deployment-handoff.v1',
  'same_filesystem_rename_replace_required',
  'maintenance_mode_during_swap',
  'rollback_on_failed_readback',
  'resolveCapabilityExecutionEnvelope',
  'expectedCommitSha: expectedHeadSha',
  'requireCommitHint: true',
  'allowReferenced: false',
  'acceptedCapabilityKeys: [WORDPRESS_STAGING_DEPLOY_OPERATION]',
  'markCapabilityEnvelopeReferenced',
  'transitionCapabilityEnvelopeLifecycle',
  'action: "consume"',
  'wp maintenance-mode activate',
  'mv "$target" "$backup"',
  'mv "$stage/${WORDPRESS_STAGING_PLUGIN_SLUG}" "$target"',
  'rollback_result=restored',
  'production_authority_used: false',
  'breakglass_used: false',
  'caller_supplied_credentials_used: false',
], "executor");

assert(!executor.includes("resolveVerifiedProductionDeploymentAuthority"), "Staging deploy must never reuse Production deployment authority");
assert(!executor.includes("hostBreakglass"), "Staging deploy must not call Host Breakglass");
assert(!executor.includes("file manager"), "Staging deploy must not use File Manager");

const preflightCall = executor.indexOf("buildPreflightScript(targetIdentity.wordpressPath)");
const uploadCall = executor.indexOf("buildUploadScript(targetIdentity.wordpressPath, remoteZip)");
assert(preflightCall >= 0 && uploadCall >= 0 && preflightCall < uploadCall, "live read-only Staging preflight must occur before first remote write/upload");

requires(route, [
  'Router',
  'executeWordPressStagingPluginDeploy',
  '"/platform/remote-runtime/wordpress/staging/deploy-plugin"',
  'requireBackendApiKey',
  'requireAdminPrincipal',
  'const dryRun = input.dry_run === undefined ? true : bool(input.dry_run)',
  'REMOTE_RUNTIME_WORDPRESS_STAGING_DEPLOY_ENABLED',
  'wordpress_staging_plugin_deploy_apply_disabled',
  'dry_run_available: true',
  'production_authority_used: false',
  'breakglass_used: false',
  'secrets_included: false',
], "route");

requires(routesIndex, [
  'buildWordPressStagingPluginDeployRoutes',
  'app.use(buildWordPressStagingPluginDeployRoutes({ ...deps, requireAdminPrincipal }))',
], "route composition");

requires(migration, [
  "'wordpress_staging_plugin_deploy'",
  "'/platform/remote-runtime/wordpress/staging/deploy-plugin'",
  "'mad4bdigital-ai/WordPress'",
  "'mad4b-control-plane-package.yml'",
  "'https://staging.egypttourgates.com'",
  "'0.6.1'",
  "'successful_exact_head_package_run'",
  "'live_wordpress_staging_preflight_before_first_write'",
  "'exact_capability_envelope_for_apply'",
  "'maintenance_mode_same_filesystem_rename_swap'",
  "'same_cycle_readback'",
  "'rollback_on_failed_readback'",
  "'capability_envelope_consume_after_success'",
  "'production target'",
  "'production deployment authority'",
  "'breakglass'",
  "'caller supplied app path'",
  "'caller supplied ssh credentials'",
  "'file manager side channel'",
  "'raw shell surface'",
], "migration");

for (const forbidden of [
  /INSERT\s+INTO\s+remote_runtime_targets/iu,
  /UPDATE\s+remote_runtime_targets/iu,
  /INSERT\s+INTO\s+platform_credentials/iu,
  /UPDATE\s+platform_credentials/iu,
  /INSERT\s+INTO\s+credentials/iu,
  /UPDATE\s+credentials/iu,
]) {
  assert(!forbidden.test(migration), `migration must not create target or credential authority: ${forbidden}`);
}

for (const callerControlled of [
  "'app_path'",
  "'ssh_host'",
  "'ssh_port'",
  "'ssh_user'",
  "'ssh_password'",
  "'ssh_private_key'",
  "'production'",
  "'breakglass_reason'",
]) {
  const schemaPrefix = migration.slice(migration.indexOf("INSERT INTO remote_runtime_command_allowlists"), migration.indexOf("INSERT INTO admin_platform_endpoint_tools"));
  assert(!schemaPrefix.includes(callerControlled), `command input schema must not expose ${callerControlled}`);
}

requires(preciseRegistry, [
  '"POST /platform/remote-runtime/wordpress/staging/deploy-plugin"',
  './openapi/wordpress-staging-plugin-deploy.yaml#/wordpressStagingPluginDeployPath',
  'routes/wordpressStagingPluginDeployRoutes.js',
], "precise OpenAPI registry");

requires(preciseOpenApi, [
  'wordpressStagingPluginDeployPath:',
  'operationId: wordpressStagingPluginDeploy',
  'x-runtime-auth-profile: admin_backend',
  'x-custom-gpt-exclude: true',
  'x-openai-isConsequential: true',
  'expected_head_sha:',
  'enum: [https://staging.egypttourgates.com]',
  'const: false',
], "precise OpenAPI");
assert.deepEqual(preciseRequest.required, ["target_id", "expected_head_sha"], "precise request must require only the server target id and exact reviewed WordPress HEAD");
for (const forbiddenProperty of ["app_path", "host", "ssh_host", "ssh_user", "ssh_password", "ssh_private_key", "branch", "production", "breakglass_reason"]) {
  assert(!Object.hasOwn(preciseRequest.properties || {}, forbiddenProperty), `precise request must not expose caller-controlled ${forbiddenProperty}`);
}

console.log("wordpress-staging-plugin-deploy.v1: PASS");
