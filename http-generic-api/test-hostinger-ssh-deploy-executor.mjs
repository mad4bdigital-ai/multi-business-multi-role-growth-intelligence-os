import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

const executor = readFileSync("hostingerSshDeployExecutor.js", "utf8");
const authority = readFileSync("productionDeploymentAuthority.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/206_sprint67_hostinger_ssh_deploy_executor.sql", "utf8");
const authorityMigration = readFileSync("migrations/20260810_hostinger_production_deploy_authority_binding.sql", "utf8");
const preciseOpenApi = readFileSync("openapi/production-deployment-authority.yaml", "utf8");
const preciseOpenApiDoc = YAML.parse(preciseOpenApi);
const preciseRequestProperties = preciseOpenApiDoc?.productionDeploymentAuthorityPath?.post?.requestBody?.content?.["application/json"]?.schema?.properties || {};
const preciseRegistry = readFileSync("openapi-route-contracts.d/spec018-production-deployment-authority.yaml", "utf8");
const allowlist = readFileSync("openapi-route-coverage.allowlist.json", "utf8");
const wordpressDeploy = readFileSync("wordpressStagingPluginDeployExecutor.js", "utf8");
const wordpressDeployRoutes = readFileSync("routes/wordpressStagingPluginDeployRoutes.js", "utf8");
const wordpressDeployMigration = readFileSync("migrations/20260920_wordpress_staging_plugin_deploy_v2_authority.sql", "utf8");
const wordpressDeployOpenApi = readFileSync("openapi/wordpress-staging-plugin-deploy.yaml", "utf8");
const wordpressDeployOpenApiDoc = YAML.parse(wordpressDeployOpenApi);
const wordpressDeployRequestProperties = wordpressDeployOpenApiDoc?.wordpressStagingPluginDeployPath?.post?.requestBody?.content?.["application/json"]?.schema?.properties || {};
const wordpressDeployRegistry = readFileSync("openapi-route-contracts.d/wordpress-staging-plugin-deploy.yaml", "utf8");
const routesIndex = readFileSync("routes/index.js", "utf8");

assert(executor.includes("REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED"), "actual SSH execution must be behind an explicit feature flag");
assert(executor.includes("dryRun"), "executor must support dry-run mode");
assert(executor.includes("dry_run_only"), "dry-run path must not execute SSH");
assert(executor.includes("resolveEffectiveCredential"), "executor must use governed credential resolver");
assert(executor.includes("planRemoteRuntimeDispatchDryRun"), "executor must reuse remote runtime dry-run planning");
assert(executor.includes("command = \"ssh\"") || executor.includes("spawn(\"ssh\""), "executor must use argv-based ssh invocation, not shell freeform");
assert(executor.includes("spawn(command, args") || executor.includes("spawn(\"ssh\""), "executor must spawn an allowlisted SSH command with argv args");
assert(executor.includes("shell: false"), "executor must disable local shell interpolation");
assert(executor.includes('command: "timeout"'), "executor must wrap SSH with coreutils timeout to avoid stuck probes");
assert(executor.includes("detached: true"), "executor must spawn SSH wrapper in its own process group");
assert(executor.includes("killProcessTree"), "executor must kill the process group on timeout fallback");
assert(executor.includes("ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}"), "executor must bound SSH connection establishment");
assert(executor.includes("ConnectionAttempts=1"), "executor must avoid repeated SSH connection attempts");
assert(executor.includes("ServerAliveInterval"), "executor must bound established SSH liveness checks");
assert(executor.includes("NumberOfPasswordPrompts=1"), "password auth must not hang on repeated prompts");
assert(executor.includes("sshpass"), "password auth must use sshpass helper when selected");
assert(executor.includes('"-d"') && executor.includes('"3"'), "password auth must pass the password through file descriptor 3, not argv or env");
assert(!executor.includes("SSHPASS"), "password auth must not place passwords in SSHPASS env");
assert(executor.includes("MAX_PROBE_TIMEOUT_MS = 75000"), "read-only probe timeout must stay below proxy/request limits");
assert(executor.includes("mkdtemp"), "private key must be written only to a temporary file");
assert(executor.includes("rm(tempDir"), "temporary private key directory must be cleaned up");
assert(executor.includes("expected_commit_sha"), "executor must require an expected commit SHA");
assert(executor.includes("resolveVerifiedProductionDeploymentAuthority"), "deploy executor must resolve the production branch from governed environment authority");
assert(!executor.includes("ALLOWED_BRANCHES"), "deploy executor must not use a caller-selected static branch allowlist");
assert(executor.includes('let branch = compact(input.branch || "", 64)'), "caller branch may only be captured as an optional compatibility assertion");
assert(executor.includes("branch = deploymentAuthority.production_branch"), "effective deploy branch must come from production authority");
assert(executor.includes("production_branch_head_sha"), "deploy evidence must carry same-cycle Production branch head readback");
assert(executor.includes("expected_sha_matches_production_head"), "deploy evidence must prove the expected SHA equals current Production head");
assert(!executor.includes('branch: branch || "main"'), "continuation evidence must not fall back to main for production deployment");

assert(authority.includes("/git/ref/heads/"), "production authority must read the governed branch head from GitHub");
assert(authority.includes("production_deployment_sha_stale"), "stale Production SHA must use a structured fail-closed error");
assert(authority.includes("production_deployment_branch_authority_mismatch") || executor.includes("resolveVerifiedProductionDeploymentAuthority"), "unauthorized branch selection must fail through environment authority");
assert(authority.includes("same_cycle_branch_readback"), "authority evidence must explicitly mark same-cycle branch readback");
assert(!authority.includes("test-token-never-returned"), "runtime authority module must not contain test credential material");

assert(authorityMigration.includes("branch selection is removed from governed caller schemas") || authorityMigration.includes("Remove caller-controlled branch selection"), "corrective migration must remove caller-controlled branch selection");
assert(authorityMigration.includes("JSON_ARRAY('target_id','app_key','app_path','expected_commit_sha','approval_reason')"), "command schema must no longer require branch");
assert(authorityMigration.includes('"required":["target_id","app_key","app_path","expected_commit_sha"]'), "admin tool schema must no longer require branch");
assert(!authorityMigration.includes("'branch',JSON_OBJECT"), "command schema must not expose branch as a caller-selectable property");
assert(authorityMigration.includes("same_cycle_branch_readback_required"), "execution policy must require same-cycle branch head readback");
assert(authorityMigration.includes("caller_branch_selection_allowed', FALSE"), "execution policy must explicitly deny caller branch selection");
for (const marker of [
  "no_credential_payload_read",
  "no_external_send",
  "no_external_write",
  "no_hostinger_runtime_mutation",
  "migration_source_only",
  "secrets_included_false",
]) {
  assert(authorityMigration.includes(marker), `authority-binding migration must preserve ${marker}`);
}

assert(preciseRegistry.includes('"POST /platform/remote-runtime/hosting/deploy-release"'), "precise registry must own the deploy-release OpenAPI operation");
assert(preciseRegistry.includes("./openapi/production-deployment-authority.yaml#/productionDeploymentAuthorityPath"), "precise registry must point to the bounded Spec018 path-item source");
assert(preciseRegistry.includes("routes/platformPluginRoutes.js"), "precise registry must bind the operation to the real platform route file");
assert(preciseOpenApi.includes("productionDeploymentAuthorityPath:"), "precise OpenAPI source must define the governed deploy path item");
assert(preciseOpenApi.includes("environment_branch_authority_v1"), "OpenAPI contract must describe policy-derived branch authority");
assert(preciseOpenApi.includes("same-cycle GitHub ref readback"), "OpenAPI contract must describe same-cycle Production head verification");
assert(preciseOpenApi.includes("production_deployment_branch_authority_mismatch"), "OpenAPI conflict contract must name branch-authority mismatch");
assert(preciseOpenApi.includes("production_deployment_sha_stale"), "OpenAPI conflict contract must name stale SHA rejection");
assert(!Object.hasOwn(preciseRequestProperties, "branch"), "precise deploy request contract must not expose branch as a caller-selectable property");
assert(preciseOpenApi.includes("enum: [Production]"), "precise response evidence must constrain the governed production branch to Production");

assert(executor.includes("git checkout --detach"), "deploy must checkout a fixed SHA, not a mutable branch head");
assert(executor.includes("pathAllowedByTarget"), "executor must enforce target path allowlists");
assert(executor.includes("approval_reason") || executor.includes("approvalReason"), "executor must require approval reason for execution");
assert(executor.includes("buildHostingerDeployReloadVerification"), "deploy must build explicit reload verification evidence");
assert(executor.includes("scheduled:tmp/restart.txt"), "deploy restart must be deferred until after the response can flush");
assert(executor.includes("deployment_run_id"), "deploy responses must expose a deployment run id");
assert(executor.includes("http_status: httpStatus"), "deploy responses must expose their intended HTTP status");
assert(executor.includes("readHostingerSshDeployRunStatus"), "deploy must expose bounded run-status readback");
assert(executor.includes("restart_signal_ok"), "deploy must verify restart signal emission when restart is requested");
assert(executor.includes("runtime_health_readback_required"), "deploy must require live health readback after restart signal emission");
assert(executor.includes("buildHostingerDeployContinuationEvidence"), "deploy must create continuation evidence for pending reload/health verification");
assert(executor.includes("deploy_reload_pending"), "deploy reload gaps must use the shared deploy_reload_pending interruption signal");
assert(executor.includes("createContinuationCheckpoint") && executor.includes("planContinuationResume"), "deploy reload continuation must use the shared reconciliation engine");
assert(executor.includes("live_ready: deployOk && reloadVerification.runtime_health_readback_required !== true"), "deploy responses must not claim live readiness before health readback");
assert(executor.includes("secrets_included: false"), "responses and evidence must mark secrets as excluded");
assert(!executor.includes("privateKey:"), "executor response must not serialize privateKey fields");
assert(!executor.includes("private_key:"), "executor response must not expose private_key fields");
assert(!executor.includes("exec("), "executor must not use exec shell freeform");

assert(routes.includes("executeHostingerSshDeployRelease"), "platform routes must import hostinger deploy executor");
assert(routes.includes('/platform/remote-runtime/hosting/deploy-release'), "platform routes must expose deploy release path");
assert(routes.includes("remote_runtime_hosting_deploy_release_failed"), "route must use structured error code");
assert(routes.includes("result.http_status"), "deploy route must honor 202 accepted responses");
assert(routes.includes("/platform/remote-runtime/hosting/deploy-runs/:deploymentRunId"), "platform routes must expose deploy status readback");
assert(routes.includes("remote_runtime_hosting_deploy_run_read_failed"), "readback route must use a structured error code");

assert(migration.includes("remote_runtime_hostinger_deploy_release"), "historical migration must still register admin tool row");
assert(migration.includes("deploy_release"), "historical migration must still register deploy_release command");
assert(migration.includes("is_enabled") && migration.includes(" 0,"), "admin tool row must remain disabled until deployed and certified");
assert(migration.includes("approval_required"), "migration tags must record approval requirement");
assert(migration.includes("no_secrets"), "migration tags must record no_secrets boundary");
assert(migration.includes("expected_sha_required"), "migration tags must require expected SHA");
assert(migration.includes("/home/*/domains/auth.mad4b.com/nodejs"), "migration must allowlist auth.mad4b.com nodejs path");

assert(!allowlist.includes("POST /platform/remote-runtime/hosting/deploy-release"), "documented deploy endpoint must not remain allowlisted");

assert(wordpressDeploy.includes('mad4b.wordpress-staging-plugin-deploy.v2'), "WordPress Staging deploy executor must publish the v2 execution contract");
assert(wordpressDeploy.includes('mad4b.wordpress-deployment-handoff.v2'), "WordPress Staging deploy executor must require deployment handoff v2");
assert(wordpressDeploy.includes('mad4b.site-control-plane.general-distribution-kit.v1'), "executor must require the General Distribution install manifest");
assert(wordpressDeploy.includes('resolveStagingTarget(pool)'), "executor must resolve the ETG Staging target server-side");
assert(wordpressDeploy.includes('wordpress_staging_deploy_target_ambiguous'), "multiple matching Staging targets must fail closed");
assert(wordpressDeploy.includes('caller_target_selection_allowed: false'), "caller-selected target authority must remain disabled");
assert(wordpressDeploy.includes('wordpress_staging_deploy_caller_target_or_credential_forbidden'), "caller target/artifact/path/credential selectors must be rejected");
assert(wordpressDeploy.includes('mad4b-site-control-plane-general-distribution-kit-${expectedHeadSha}'), "artifact identity must derive only from the exact WordPress head");
assert(wordpressDeploy.includes('artifact.digest'), "executor must verify the GitHub Actions artifact digest");
assert(wordpressDeploy.includes('official_release_sha256'), "bundled MCP Adapter must match the certified release digest");
assert(wordpressDeploy.includes('MAD4B-BUILD-PROVENANCE.json'), "executor must verify exact build provenance before deployment");
assert(wordpressDeploy.includes('adapter_archive_sha256'), "executor must verify and carry the exact MCP Adapter archive digest");
assert(wordpressDeploy.includes('control_archive_sha256'), "executor must verify and carry the exact Control Plane archive digest");
assert(wordpressDeploy.includes('MAD4B_SCP_Site_Profile::site_uuid()'), "live preflight/readback must bind the exact Site Profile UUID");
assert(wordpressDeploy.includes('MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status()'), "same-cycle readback must use the runtime provenance authority");
assert(wordpressDeploy.includes('runtime_manifest_match'), "same-cycle readback must require runtime manifest match");
assert(wordpressDeploy.includes('provenance_mismatch_count'), "same-cycle readback must require zero provenance mismatches");
assert(wordpressDeploy.includes('control_backup') && wordpressDeploy.includes('adapter_backup'), "both Control Plane and MCP Adapter must have rollback backups");
assert(wordpressDeploy.includes('rollback_result=restored'), "failed exact readback must execute rollback");
assert(wordpressDeploy.includes('transitionCapabilityEnvelopeLifecycle'), "successful apply must consume the exact capability envelope");
assert(!wordpressDeploy.includes('const targetId = compact(input.target_id'), "executor must not accept caller-selected target_id");
assert(!wordpressDeploy.includes('input.ssh_auth_mode || input.sshAuthMode || ""'), "caller-selected SSH auth mode must not control execution");
assert(!wordpressDeploy.includes("WORDPRESS_STAGING_HOST"), "unused Host constant must not create a configuration candidate");
assert(!wordpressDeploy.includes("DEFAULT_TIMEOUT_MS"), "fixed deploy timeout must remain a code safety bound, not runtime configuration");
assert(!wordpressDeploy.includes("MAX_TIMEOUT_MS"), "fixed maximum timeout must remain a code safety bound, not runtime configuration");
assert(!wordpressDeploy.includes("MAD4B_SSH_ASKPASS_FILE"), "WordPress deploy must not create an ASKPASS configuration channel");
assert(!wordpressDeploy.includes("NODE_OPTIONS"), "WordPress deploy must not inject NODE_OPTIONS for credential transport");
assert(executor.includes('"sshpass"'), "Canonical Hostinger password transport must use sshpass");
assert(executor.includes('"-d", "3"'), "Canonical Hostinger password must be supplied through file descriptor 3");
assert(!executor.includes("SSHPASS"), "Canonical Hostinger password must not be placed in SSHPASS environment state");
assert(executor.includes('command: "timeout"'), "Canonical Hostinger SSH transport must be bounded by coreutils timeout");
assert(executor.includes("shell: false"), "Canonical Hostinger SSH transport must disable local shell interpolation");

assert(wordpressDeployRoutes.includes('REMOTE_RUNTIME_WORDPRESS_STAGING_DEPLOY_ENABLED'), "apply must remain behind the dedicated WordPress Staging feature gate");
assert(wordpressDeployRoutes.includes('/platform/remote-runtime/wordpress/staging/deploy-plugin'), "bounded WordPress Staging deploy route must be mounted");
assert(routesIndex.includes('buildWordPressStagingPluginDeployRoutes'), "main route index must mount the governed WordPress Staging deploy route");

assert(wordpressDeployMigration.includes("'contract','mad4b.wordpress-staging-plugin-deploy.v2'"), "migration must register the v2 deployment contract");
assert(wordpressDeployMigration.includes("'handoff_contract','mad4b.wordpress-deployment-handoff.v2'"), "migration must bind deployment handoff v2");
assert(wordpressDeployMigration.includes("'target_resolution','server_owned_unique_exact_staging_target'"), "migration must record server-owned unique target resolution");
assert(wordpressDeployMigration.includes("'caller_target_selection_allowed',false"), "migration must deny caller target selection");
assert(wordpressDeployMigration.includes("'caller_artifact_selection_allowed',false"), "migration must deny caller artifact selection");
assert(wordpressDeployMigration.includes("same_cycle_exact_provenance_readback"), "migration policy must require exact provenance readback");
assert(!wordpressDeployMigration.includes("'target_id',JSON_OBJECT"), "v2 caller schema must not expose target_id");
assert(!wordpressDeployMigration.includes("'ssh_auth_mode',JSON_OBJECT"), "v2 caller schema must not expose SSH auth mode");

assert(wordpressDeployRegistry.includes('"POST /platform/remote-runtime/wordpress/staging/deploy-plugin"'), "precise OpenAPI registry must own the WordPress Staging deploy route");
assert(wordpressDeployRegistry.includes('./openapi/wordpress-staging-plugin-deploy.yaml#/wordpressStagingPluginDeployPath'), "precise registry must point to the bounded deploy contract");
assert(wordpressDeployOpenApi.includes('x-custom-gpt-exclude: true'), "deployment route must remain excluded from general Custom GPT export");
assert(wordpressDeployOpenApi.includes('x-openai-isConsequential: true'), "deployment apply must be marked consequential");
assert(!Object.hasOwn(wordpressDeployRequestProperties, "target_id"), "OpenAPI request must not expose caller-selected target_id");
assert(!Object.hasOwn(wordpressDeployRequestProperties, "ssh_auth_mode"), "OpenAPI request must not expose caller-selected SSH auth mode");
assert(Object.hasOwn(wordpressDeployRequestProperties, "expected_head_sha"), "OpenAPI request must require exact WordPress head identity");
assert(wordpressDeployOpenApi.includes('mad4b.wordpress-deployment-handoff.v2'), "OpenAPI response must expose handoff v2 identity");
assert(wordpressDeployOpenApi.includes('d745d81f-6fc4-5c6a-99dd-d953c92137bf'), "OpenAPI must bind the ETG Staging Site Profile UUID");
assert(executor.includes("export async function resolveServerOwnedHostingerSshConnection"), "shared Hostinger transport must expose no-handoff server-owned credential resolution");
assert(executor.includes("export function runHostingerSshCommand"), "shared Hostinger transport must expose the hardened SSH runner");
assert(executor.includes("stdinBuffer = null"), "shared SSH runner must support bounded artifact stdin streaming");
assert(wordpressDeploy.includes("resolveServerOwnedHostingerSshConnection"), "WordPress deploy must reuse the canonical server-owned Hostinger credential resolver");
assert(wordpressDeploy.includes("runHostingerSshCommand"), "WordPress deploy must reuse the canonical hardened Hostinger SSH runner");
assert(!wordpressDeploy.includes("MAD4B_SSH_ASKPASS_FILE"), "WordPress deploy must not duplicate askpass/secret transport configuration");
assert(!wordpressDeploy.includes("NODE_OPTIONS"), "WordPress deploy must not duplicate Node askpass runtime configuration");
assert(!wordpressDeploy.includes("SSH_CONNECT_TIMEOUT_SECONDS"), "WordPress deploy must not duplicate SSH transport timeout configuration");
assert(!executor.includes('const authMode = target?.provider_family'), "server-owned connection wrapper must not create a local authMode configuration candidate");
assert(executor.includes("remote_runtime_server_owned_ssh_credential_not_resolved"), "server-owned SSH resolution must fail closed before connection when any required credential is missing");
assert(executor.includes("const user = common.ssh_user;"), "server-owned SSH resolver must use the canonical ssh_user role key");
assert(!executor.includes("common.ssh_username"), "non-canonical ssh_username role must not be introduced");
assert(executor.includes("SET status = 'active', validation_status = 'valid', updated_by = 'hostinger_ssh_target_probe'"), "successful Hostinger target probe must write the canonical remote_runtime_targets validation status");
assert(!executor.includes("SET status = 'active', validation_status = 'validated', updated_by = 'hostinger_ssh_target_probe'"), "Hostinger target probe must not write the non-canonical validated enum literal");
assert(executor.includes("credential_intake_created: false"), "WordPress deployment credential resolution must not auto-create credential handoffs");
assert(wordpressDeploy.includes("completed_reconciliation_required"), "verified deploy with envelope-consume failure must be classified as reconciliation-required");
assert(wordpressDeploy.includes("retry_deployment: false"), "post-readback envelope-consume failure must explicitly forbid deployment retry");
assert(wordpressDeploy.includes("mutation_applied: true"), "post-readback envelope-consume failure evidence must preserve that deployment already occurred");
assert(wordpressDeploy.includes("envelope.apply_allowed !== true"), "WordPress deploy must require explicit apply_allowed before the first remote write");
assert(wordpressDeploy.includes("wordpress_staging_deploy_capability_envelope_reference_failed"), "WordPress deploy must fail closed when envelope reference persistence fails");
assert(wordpressDeploy.includes("first_remote_write_started: false"), "envelope-reference failure evidence must prove no deployment write started");
const wordpressEnvelopeReferenceIndex = wordpressDeploy.indexOf("const referenced = await markCapabilityEnvelopeReferenced");
const wordpressAdapterUploadIndex = wordpressDeploy.indexOf("const adapterUpload = await runHostingerSshCommand");
assert(wordpressEnvelopeReferenceIndex >= 0 && wordpressAdapterUploadIndex > wordpressEnvelopeReferenceIndex, "capability envelope must be referenced before the first artifact upload");
assert(wordpressDeploy.includes("maintenance_was_active=0"), "WordPress deploy must snapshot pre-existing maintenance state");
assert(wordpressDeploy.includes("maintenance_activated_by_deploy=0"), "WordPress deploy must track only maintenance mode it activated");
assert(wordpressDeploy.includes("trap cleanup_transient EXIT"), "pre-swap validation failures must clean transient files without plugin rollback mutation");
assert(wordpressDeploy.includes("wp maintenance-mode is-active"), "WordPress deploy must read pre-existing maintenance state before swap");
const wordpressValidationIndex = wordpressDeploy.indexOf('test "$plugins_device" = "$(stat -c \'%d\' "$adapter_stage")"');
const wordpressRollbackTrapIndex = wordpressDeploy.indexOf("trap 'rollback $?' ERR");
const wordpressFirstSwapIndex = wordpressDeploy.indexOf('mv "$control_target" "$control_backup"');
assert(wordpressValidationIndex >= 0 && wordpressRollbackTrapIndex > wordpressValidationIndex, "rollback trap must not arm before artifact and same-filesystem validation completes");
assert(wordpressFirstSwapIndex > wordpressRollbackTrapIndex, "rollback trap must arm before the first plugin-directory rename");
assert(wordpressDeploy.includes('if [ "$maintenance_was_active" != "1" ] && [ "$maintenance_activated_by_deploy" = "1" ]'), "success and rollback must preserve pre-existing maintenance mode");
assert(!wordpressDeploy.includes("maintenance_on=0"), "legacy unconditional maintenance toggle state must be removed");
console.log("Hostinger SSH deploy executor safety tests passed");
