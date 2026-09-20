import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import "./wordpressStagingPluginDeployExecutor.js";

const executor = readFileSync(new URL("./wordpressStagingPluginDeployExecutor.js", import.meta.url), "utf8");
const route = readFileSync(new URL("./routes/wordpressStagingPluginDeployRoutes.js", import.meta.url), "utf8");
const routesIndex = readFileSync(new URL("./routes/index.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/20260920_wordpress_staging_plugin_deploy_authority_v2.sql", import.meta.url), "utf8");
const preciseOpenApi = readFileSync(new URL("./openapi/wordpress-staging-plugin-deploy.yaml", import.meta.url), "utf8");
const preciseRegistry = readFileSync(new URL("./openapi-route-contracts.d/wordpress-staging-plugin-deploy.yaml", import.meta.url), "utf8");
const preciseOpenApiDoc = YAML.parse(preciseOpenApi);
const preciseRequest = preciseOpenApiDoc?.wordpressStagingPluginDeployPath?.post?.requestBody?.content?.["application/json"]?.schema || {};

function requires(source, markers, label) {
  for (const marker of markers) assert(source.includes(marker), `${label} missing invariant: ${marker}`);
}

requires(executor, [
  'WORDPRESS_STAGING_DEPLOY_CONTRACT = "mad4b.wordpress-staging-plugin-deploy.v2"',
  'WORDPRESS_STAGING_HANDOFF_CONTRACT = "mad4b.wordpress-deployment-handoff.v2"',
  'WORDPRESS_STAGING_DEPLOY_OPERATION = "wordpress_plugin_deploy"',
  'WORDPRESS_STAGING_SOURCE_REPOSITORY = "mad4bdigital-ai/WordPress"',
  'WORDPRESS_STAGING_SOURCE_WORKFLOW = "mad4b-control-plane-package.yml"',
  'WORDPRESS_STAGING_ORIGIN = "https://staging.egypttourgates.com"',
  'WORDPRESS_STAGING_SITE_UUID = "d745d81f-6fc4-5c6a-99dd-d953c92137bf"',
  'WORDPRESS_STAGING_MCP_ADAPTER_VERSION = "0.6.1"',
  "resolveUniqueStagingTarget",
  "matched_count: 0",
  "wordpress_staging_deploy_target_ambiguous",
  "target.command_allowlist.includes(WORDPRESS_STAGING_DEPLOY_OPERATION)",
  'metadata.site_uuid || metadata.site_profile_uuid || metadata.wordpress_site_uuid',
  "pathAllowedByTarget(wordpressPath, target)",
  "resolveEffectiveCredential",
  "MAD4B_SCP_Site_Profile::site_uuid()",
  'MAD4B_SCP_Site_Profile::profile()',
  "profile_revision",
  "profile_digest",
  "preflight_result=ok",
  'status=success&event=pull_request',
  'mad4b-site-control-plane-general-distribution-kit-${expectedHeadSha}',
  "artifact.digest",
  "wordpress_staging_deploy_outer_artifact_hash_mismatch",
  "mad4b.site-control-plane.general-distribution-kit.v1",
  "general-distribution-release-candidate",
  "explicit_site_profile_enrollment",
  "MAD4B-BUILD-PROVENANCE.json",
  "mad4b.build-provenance.v1",
  "wordpress_staging_deploy_build_provenance_mismatch",
  "mcp-adapter-0.6.1.zip",
  "wordpress_staging_deploy_adapter_archive_hash_mismatch",
  "staging-deployment-handoff.json",
  "mad4b.wordpress-deployment-handoff.v2",
  "deployment_connector_selected_by_site_owner",
  "exact_capability_envelope_required",
  "exact_target_allowlist_required",
  "backup_before_replace",
  "atomic_replace_required",
  "same_cycle_readback_required",
  "rollback_on_failed_readback",
  "resolveCapabilityExecutionEnvelope",
  "expectedCommitSha: expectedHeadSha",
  "requireCommitHint: true",
  "allowReferenced: false",
  "acceptedCapabilityKeys: [WORDPRESS_STAGING_DEPLOY_OPERATION]",
  "markCapabilityEnvelopeReferenced",
  "transitionCapabilityEnvelopeLifecycle",
  'action: "consume"',
  "wp maintenance-mode activate",
  'mv "$target" "$backup"',
  'mv "$stage/${WORDPRESS_STAGING_PLUGIN_SLUG}" "$target"',
  "MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status()",
  'test "$source_sha_after" = ${sourceSha}',
  'test "$build_fingerprint_after" = ${buildFingerprint}',
  'test "$package_manifest_digest_after" = ${packageManifestDigest}',
  'test "$runtime_manifest_match" = 1',
  'test "$stale_after" = 0',
  'test "$provenance_mismatch_count" = 0',
  "rollback_result=restored",
  "production_authority_used: false",
  "breakglass_used: false",
  "caller_supplied_credentials_used: false",
], "executor");

for (const forbidden of [
  "resolveVerifiedProductionDeploymentAuthority",
  "hostBreakglass",
  "input.target_id",
  "input.targetId",
  "input.app_path",
  "input.ssh_host",
  "input.ssh_user",
  "input.ssh_password",
  "input.ssh_private_key",
]) {
  assert(!executor.includes(forbidden), `executor must not expose or reuse forbidden caller/authority surface: ${forbidden}`);
}

const preflightCall = executor.indexOf("buildPreflightScript(targetIdentity.wordpressPath)");
const uploadCall = executor.indexOf("buildUploadScript(targetIdentity.wordpressPath, remoteZip)");
assert(preflightCall >= 0 && uploadCall >= 0 && preflightCall < uploadCall, "live exact Site Profile preflight must occur before first remote write/upload");

requires(route, [
  "executeWordPressStagingPluginDeploy",
  '"/platform/remote-runtime/wordpress/staging/deploy-plugin"',
  "requireBackendApiKey",
  "requireAdminPrincipal",
  "const dryRun = input.dry_run === undefined ? true : bool(input.dry_run)",
  "REMOTE_RUNTIME_WORDPRESS_STAGING_DEPLOY_ENABLED",
  "wordpress_staging_plugin_deploy_apply_disabled",
  "dry_run_available: true",
  "production_authority_used: false",
  "breakglass_used: false",
  "secrets_included: false",
], "route");

requires(routesIndex, [
  "buildWordPressStagingPluginDeployRoutes",
  "app.use(buildWordPressStagingPluginDeployRoutes({ ...deps, requireAdminPrincipal }))",
], "route composition");

requires(migration, [
  "'wordpress_plugin_deploy'",
  "'wordpress_staging_plugin_deploy'",
  "'/platform/remote-runtime/wordpress/staging/deploy-plugin'",
  "'mad4bdigital-ai/WordPress'",
  "'mad4b-control-plane-package.yml'",
  "'mad4b-site-control-plane-general-distribution-kit-{exact_head_sha}'",
  "'mad4b.site-control-plane.general-distribution-kit.v1'",
  "'mad4b.wordpress-deployment-handoff.v2'",
  "'https://staging.egypttourgates.com'",
  "'d745d81f-6fc4-5c6a-99dd-d953c92137bf'",
  "'unique_server_side_remote_runtime_target'",
  "'successful_exact_head_package_run'",
  "'github_artifact_digest_verification_when_present'",
  "'live_wordpress_site_profile_preflight_before_first_write'",
  "'same_cycle_exact_provenance_and_site_profile_readback'",
  "'rollback_on_failed_readback'",
  "'caller selected target'",
  "'production target'",
  "'breakglass'",
  "'caller supplied app path'",
  "'caller supplied ssh credentials'",
  "'raw sql side channel'",
], "migration");

for (const forbidden of [
  /INSERT\s+INTO\s+remote_runtime_targets/iu,
  /UPDATE\s+remote_runtime_targets/iu,
  /INSERT\s+INTO\s+platform_credentials/iu,
  /UPDATE\s+platform_credentials/iu,
]) assert(!forbidden.test(migration), `migration must not create target or credential authority: ${forbidden}`);

const commandSchema = migration.slice(migration.indexOf("INSERT INTO remote_runtime_command_allowlists"), migration.indexOf("INSERT INTO admin_platform_endpoint_tools"));
for (const callerControlled of [
  "'target_id'",
  "'app_path'",
  "'ssh_auth_mode'",
  "'ssh_host'",
  "'ssh_port'",
  "'ssh_user'",
  "'ssh_password'",
  "'ssh_private_key'",
  "'production'",
  "'breakglass_reason'",
  "'artifact_id'",
]) assert(!commandSchema.includes(callerControlled), `command input schema must not expose ${callerControlled}`);

requires(preciseRegistry, [
  '"POST /platform/remote-runtime/wordpress/staging/deploy-plugin"',
  "./openapi/wordpress-staging-plugin-deploy.yaml#/wordpressStagingPluginDeployPath",
  "routes/wordpressStagingPluginDeployRoutes.js",
], "precise OpenAPI registry");

requires(preciseOpenApi, [
  "wordpressStagingPluginDeployPath:",
  "operationId: wordpressStagingPluginDeploy",
  "x-runtime-auth-profile: admin_backend",
  "x-custom-gpt-exclude: true",
  "x-openai-isConsequential: true",
  "expected_head_sha:",
  "server resolves exactly one",
  "enum: [mad4b.wordpress-staging-plugin-deploy.v2]",
  "enum: [https://staging.egypttourgates.com]",
  "const: false",
], "precise OpenAPI");

assert.deepEqual(preciseRequest.required, ["expected_head_sha"], "precise request must require only the exact reviewed WordPress HEAD");
for (const forbiddenProperty of ["target_id", "app_path", "host", "ssh_auth_mode", "ssh_host", "ssh_user", "ssh_password", "ssh_private_key", "branch", "production", "breakglass_reason", "artifact_id"]) {
  assert(!Object.hasOwn(preciseRequest.properties || {}, forbiddenProperty), `precise request must not expose caller-controlled ${forbiddenProperty}`);
}

console.log("wordpress-staging-plugin-deploy.v2: PASS");
