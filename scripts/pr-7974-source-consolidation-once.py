from pathlib import Path
import json
import re

ROOT = Path('.')


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8', newline='\n')


# 1) Make localConnectorInstallRoutes.js the sole owner of the compatibility download path.
install_path = 'http-generic-api/routes/localConnectorInstallRoutes.js'
source = read(install_path)
pattern = re.compile(
    r'  // ── GET /local-connector/install/download ─+\n'
    r'  // Public token-gated download\. Use only with short-lived signed links\.\n'
    r'  router\.get\("/local-connector/install/download", async \(req, res\) => \{.*?\n'
    r'  \}\);\n\n'
    r'  // ── POST /local-connector/install ─+',
    re.S,
)
replacement = '''  // ── GET /local-connector/install/download ─────────────────────────────────
  // Public token-gated compatibility entrypoint. This file is the sole owner
  // of the route; both formats converge on the canonical connector-agent PS1.
  router.get("/local-connector/install/download", async (req, res) => {
    try {
      const token = String(req.query.token || "");
      const payload = verifyInstallerDownloadToken(token);
      if (!["ps1", "bat"].includes(payload.format)) {
        throw httpError(400, "unsupported_format", "Only ps1 or bat installer downloads are supported.");
      }
      const [[config]] = await getPool().query(
        "SELECT config_id, device_id FROM `local_connector_user_configs` WHERE user_id = ? AND tenant_id = ? AND device_id = ? AND is_enabled = 1 LIMIT 1",
        [payload.user_id, payload.tenant_id, payload.device_id]
      );
      if (!config) throw httpError(404, "connector_config_not_found", "No active connector config was found for this download token.");

      const ps1Token = payload.format === "ps1"
        ? token
        : signInstallerDownloadToken({ ...payload, format: "ps1" });
      const canonicalUrl = `${publicBaseUrl(req)}/connector-agent/installer.ps1?token=${encodeURIComponent(ps1Token)}`;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Mad4B-Installer-Delegation", "connector-agent-canonical");

      if (payload.format === "ps1") {
        return res.redirect(307, canonicalUrl);
      }

      const installer = buildInstallPowerShellBootstrapBat({
        ps1Url: canonicalUrl,
        deviceId: config.device_id,
        appManaged: payload.app_managed === true || payload.suppress_pause === true || payload.no_pause === true,
      });
      const safeDeviceId = String(config.device_id).replace(/[^a-zA-Z0-9_-]+/g, "-");
      const filename = `install-local-connector-${safeDeviceId}.bat`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(installer);
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: err.code || "installer_download_failed", message: err.message },
        secrets_included: false,
      });
    }
  });

  // ── POST /local-connector/install ─────────────────────────────────────────'''
source, count = pattern.subn(replacement, source, count=1)
if count != 1:
    raise SystemExit(f'expected one active installer download handler, replaced {count}')
write(install_path, source)

# 2) Remove the shadow/second owner from route composition.
index_path = 'http-generic-api/routes/index.js'
source = read(index_path)
import_line = 'import { buildLocalConnectorInstallerDelegationRoutes } from "./localConnectorInstallerDelegationRoutes.js";\n'
if source.count(import_line) != 1:
    raise SystemExit('delegation import did not match exactly once')
source = source.replace(import_line, '')
mount_block = '''  // Canonical installer delegation must precede the legacy installer router so
  // /local-connector/install/download can never execute the old inline cloudflared implementation.
  app.use(buildLocalConnectorInstallerDelegationRoutes({ env: deps?.env || process.env }));
'''
if source.count(mount_block) != 1:
    raise SystemExit('delegation mount block did not match exactly once')
source = source.replace(mount_block, '')
write(index_path, source)

delegation_path = ROOT / 'http-generic-api/routes/localConnectorInstallerDelegationRoutes.js'
if not delegation_path.exists():
    raise SystemExit('delegation route file already missing before guarded consolidation')
delegation_path.unlink()

# 3) Convert regression protection from mount-order shadowing to single-owner source closure.
test_path = 'http-generic-api/test-local-connector-durable-self-healing.mjs'
source = read(test_path)
source = source.replace('import { createHmac } from "node:crypto";\n', '')
source = source.replace('import { _testingLocalConnectorInstallerDelegation as installerDelegation } from "./routes/localConnectorInstallerDelegationRoutes.js";\n', '')
start = source.find('const delegationEnv = { BACKEND_API_KEY: "test-backend-key" };')
end_marker = 'nodeAssert.match(agentSource, /\\$CfService = \'Mad4B-LocalConnector-Cloudflared\'/);'
end = source.find(end_marker)
if start < 0 or end < 0 or end <= start:
    raise SystemExit('legacy delegation regression block boundaries not found')
new_assertions = '''const downloadRouteOccurrences = installerSource.match(/router\\.get\\("\\/local-connector\\/install\\/download"/g) || [];
nodeAssert.equal(downloadRouteOccurrences.length, 1, "installer download path must have exactly one route owner");
nodeAssert.doesNotMatch(indexSource, /localConnectorInstallerDelegationRoutes|buildLocalConnectorInstallerDelegationRoutes/);
const downloadStart = installerSource.indexOf('// ── GET /local-connector/install/download');
const downloadEnd = installerSource.indexOf('// ── POST /local-connector/install', downloadStart);
nodeAssert.ok(downloadStart >= 0 && downloadEnd > downloadStart, "canonical installer download handler must be discoverable");
const downloadHandlerSource = installerSource.slice(downloadStart, downloadEnd);
nodeAssert.match(downloadHandlerSource, /connector-agent\\/installer\\.ps1/);
nodeAssert.match(downloadHandlerSource, /res\\.redirect\\(307, canonicalUrl\\)/);
nodeAssert.match(downloadHandlerSource, /buildInstallPowerShellBootstrapBat/);
nodeAssert.match(downloadHandlerSource, /X-Mad4B-Installer-Delegation/);
nodeAssert.doesNotMatch(downloadHandlerSource, /connector_secret|cf_token/);
nodeAssert.doesNotMatch(downloadHandlerSource, /buildInstallPowerShell\\s*\\(/);
nodeAssert.doesNotMatch(downloadHandlerSource, /cloudflared service install/i);
nodeAssert.match(downloadHandlerSource, /SELECT config_id, device_id/);
nodeAssert.doesNotMatch(downloadHandlerSource, /SELECT[^\\n]*(?:connector_secret|cf_token)/i);
'''
source = source[:start] + new_assertions + source[end:]
write(test_path, source)

# 4) Rebind the ChatGPT connection contract to the existing trusted Staging projection.
connection_path = 'http-generic-api/config/admin-recovery-chatgpt-connection.json'
connection = {
    "contract": "mad4b.admin-recovery-chatgpt-connection.v1",
    "status": "registered",
    "connection_key": "mad4b_admin_recovery",
    "display_name": "MAD4B Admin Recovery",
    "environment": "staging",
    "server_uri": "https://activation-dev.mad4b.com",
    "upstream_origin": "https://dev.mad4b.com",
    "principal_class": "admin_gpt",
    "audience": "admin_service",
    "projection": {
        "surface_key": "admin_recovery_staging",
        "registration_set": "admin_activation_staging",
        "action_slot": "admin_activation",
        "registration_status": "embedded",
        "embed_into": "activation_admin_staging",
        "private_only": True,
        "shared_admin_core_member": False,
    },
    "allowed_operations": [
        "getStagingRecoveryAdminContract",
        "getStagingRecoveryAdminReadiness",
        "getStagingRecoveryCertificationStatus",
    ],
    "gateway_convergence": {
        "trusted_ingress": "https://activation-dev.mad4b.com",
        "upstream_origin": "https://dev.mad4b.com",
        "direct_upstream_registration_allowed": False,
        "safe_read_or_preflight_operations": [
            "activation_gateway_rollout_plan",
            "activation_gateway_dark_deploy_dry_run",
            "gateway_exact_sha_verification",
            "gateway_same_cycle_readback",
        ],
        "consequential_apply_exposed": False,
        "apply_authority": "certified_server_side_workflow_only",
        "apply_exposure_blocker": "caller_selected_capability_envelope_id_not_permitted_on_staging_recovery_surface",
    },
    "execution_boundary": {
        "trusted_gateway_required": True,
        "exact_staging_sha_binding_required": True,
        "same_cycle_readback_required": True,
        "caller_supplied_capability_envelope_id_allowed": False,
        "caller_supplied_resource_binding_id_allowed": False,
        "caller_supplied_execution_ticket_allowed": False,
        "caller_supplied_repository_allowed": False,
        "caller_supplied_workflow_allowed": False,
        "caller_supplied_ref_allowed": False,
        "caller_supplied_github_token_allowed": False,
        "caller_supplied_database_identifier_allowed": False,
        "caller_supplied_database_credentials_allowed": False,
        "caller_supplied_sql_allowed": False,
        "generic_workflow_dispatch_exposed": False,
        "generic_cloudflare_operations_exposed": False,
        "dns_mutation_exposed": False,
        "custom_domain_mutation_exposed": False,
        "production_target_allowed": False,
        "cross_environment_fallback_allowed": False,
        "generic_shell_exposed": False,
    },
    "credential_boundary": {
        "oauth_or_admin_principal_session": "connection_front_door",
        "github_broker_credential": "server_side_only",
        "cloudflare_credential": "server_side_only",
        "capability_envelope": "server_side_only_for_consequential_apply",
        "database_credentials": "server_side_only",
        "secrets_in_responses": False,
    },
    "source_authorities": [
        "canonicals/openapi/custom-gpt-surfaces.yaml",
        "http-generic-api/openapi/openapi.custom-gpt.recovery-admin.staging.yaml",
        "http-generic-api/routes/stagingRecoveryAdminRoutes.js",
        "http-generic-api/activationGatewayRolloutTool.js",
        "http-generic-api/capabilityResolutionEnvelopeGuard.js",
    ],
}
write(connection_path, json.dumps(connection, indent=2) + '\n')

# 5) Make Recovery composition tests protect Staging embedding and non-exposure of Apply.
recovery_test_path = 'http-generic-api/test-recovery-composition.mjs'
source = read(recovery_test_path)
production_test = re.compile(
    r'test\("Admin Recovery connection is pinned to the existing private Production Recovery projection", \(\) => \{.*?\n\}\);\n\n'
    r'test\("Admin Recovery challenge and approved-step execution remain fixed server routes", \(\) => \{.*?\n\}\);',
    re.S,
)
staging_tests = '''test("Admin Recovery connection is pinned to the existing embedded Staging Recovery projection", () => {
  assert.equal(adminRecoveryConnection.contract, "mad4b.admin-recovery-chatgpt-connection.v1");
  assert.equal(adminRecoveryConnection.environment, "staging");
  assert.equal(adminRecoveryConnection.server_uri, "https://activation-dev.mad4b.com");
  assert.equal(adminRecoveryConnection.upstream_origin, "https://dev.mad4b.com");
  assert.equal(adminRecoveryConnection.principal_class, "admin_gpt");
  assert.equal(adminRecoveryConnection.projection.surface_key, "admin_recovery_staging");
  assert.equal(adminRecoveryConnection.projection.registration_set, "admin_activation_staging");
  assert.equal(adminRecoveryConnection.projection.action_slot, "admin_activation");
  assert.equal(adminRecoveryConnection.projection.registration_status, "embedded");
  assert.equal(adminRecoveryConnection.projection.embed_into, "activation_admin_staging");
  assert.equal(adminRecoveryConnection.projection.private_only, true);
  assert.equal(adminRecoveryConnection.projection.shared_admin_core_member, false);
  assert.deepEqual(adminRecoveryConnection.allowed_operations, [
    "getStagingRecoveryAdminContract",
    "getStagingRecoveryAdminReadiness",
    "getStagingRecoveryCertificationStatus",
  ]);
  assert.match(customGptSurfaces, /admin_activation_staging:/);
  assert.match(customGptSurfaces, /admin_recovery_staging/);
  assert.match(customGptSurfaces, /server_uri:\\s*https:\/\/activation-dev\\.mad4b\\.com/);
  assert.match(customGptSurfaces, /upstream_origin:\\s*https:\/\/dev\\.mad4b\\.com/);
});

test("Admin Recovery Staging Gateway convergence exposes read/preflight only", () => {
  const gateway = adminRecoveryConnection.gateway_convergence;
  assert.equal(gateway.trusted_ingress, "https://activation-dev.mad4b.com");
  assert.equal(gateway.upstream_origin, "https://dev.mad4b.com");
  assert.equal(gateway.direct_upstream_registration_allowed, false);
  assert.equal(gateway.consequential_apply_exposed, false);
  assert.equal(gateway.apply_authority, "certified_server_side_workflow_only");
  assert.deepEqual(gateway.safe_read_or_preflight_operations, [
    "activation_gateway_rollout_plan",
    "activation_gateway_dark_deploy_dry_run",
    "gateway_exact_sha_verification",
    "gateway_same_cycle_readback",
  ]);
});'''
source, count = production_test.subn(staging_tests, source, count=1)
if count != 1:
    raise SystemExit(f'expected Production Admin Recovery test pair once, replaced {count}')
old_boundary_tail = '''  assert.equal(boundary.caller_supplied_sql_allowed, false);
});'''
new_boundary_tail = '''  assert.equal(boundary.caller_supplied_sql_allowed, false);
  assert.equal(boundary.caller_supplied_capability_envelope_id_allowed, false);
  assert.equal(boundary.caller_supplied_resource_binding_id_allowed, false);
  assert.equal(boundary.generic_cloudflare_operations_exposed, false);
  assert.equal(boundary.dns_mutation_exposed, false);
  assert.equal(boundary.custom_domain_mutation_exposed, false);
  assert.equal(boundary.production_target_allowed, false);
  assert.equal(boundary.cross_environment_fallback_allowed, false);
});'''
if source.count(old_boundary_tail) != 1:
    raise SystemExit('Admin Recovery boundary test tail did not match exactly once')
source = source.replace(old_boundary_tail, new_boundary_tail)
write(recovery_test_path, source)

# 6) Remove the frontend policy decision that existed only for the deleted second owner.
policy_path = 'http-generic-api/frontend-surface-policy.json'
policy = json.loads(read(policy_path))
original_rules = list(policy.get('rules', []))
policy['rules'] = [r for r in original_rules if r.get('rule_id') != 'local-connector-installer-delegation-api-only']
if len(original_rules) - len(policy['rules']) != 1:
    raise SystemExit('expected exactly one installer delegation frontend policy rule')
write(policy_path, json.dumps(policy, indent=2) + '\n')

# Remove permanent drift fingerprints tied only to the deleted route, if present.
drift_path = 'docs/governance/configuration-drift-baseline-extensions.json'
drift = json.loads(read(drift_path))
entries = list(drift.get('entries', []))
drift['entries'] = [
    entry for entry in entries
    if 'localConnectorInstallerDelegationRoutes.js' not in str(entry.get('fingerprint', ''))
]
write(drift_path, json.dumps(drift, indent=2) + '\n')

# 7) Rewrite E2E source-of-change around single ownership + Staging projection.
manifest_path = '.changes/e2e/local-connector-owned-transport-admin-recovery-20260908.json'
manifest = json.loads(read(manifest_path))
includes = [p for p in manifest['scope']['include'] if p != 'http-generic-api/routes/localConnectorInstallerDelegationRoutes.js']
if 'http-generic-api/routes/localConnectorInstallRoutes.js' not in includes:
    insert_at = includes.index('http-generic-api/routes/connectorAgentRoutes.js') + 1
    includes.insert(insert_at, 'http-generic-api/routes/localConnectorInstallRoutes.js')
manifest['scope']['include'] = includes
journeys = {j['id']: j for j in manifest['phases'][0]['e2e_journeys']}
connector = journeys['connector-owned-cloudflared-runtime']
connector['steps'] = [
    "Resolve a current short-lived Local Connector installer link.",
    "Keep /local-connector/install/download owned only by localConnectorInstallRoutes.js.",
    "Route PS1 through a 307 delegation to /connector-agent/installer.ps1 and route BAT through a bootstrap that downloads the same canonical PS1.",
    "Verify the connector-agent manifest and SHA256 entries before installing runtime files.",
    "Persist the canonical Connector cloudflared ownership, management mode, token-file, and metrics binding in .env.",
    "Install or reconcile Mad4B-LocalConnector-Cloudflared without stopping, uninstalling, renaming, or reconfiguring generic cloudflared or Mad4B-Staging-Cloudflared.",
    "Require local connector health and allow the watchdog to certify the same canonical runtime.",
]
connector['assertions'] = [
    "GET /local-connector/install/download has exactly one route owner: localConnectorInstallRoutes.js.",
    "The download handler never reads connector_secret or cf_token and cannot execute the historical inline installer implementation.",
    "PS1 requests redirect only to /connector-agent/installer.ps1 and BAT requests bootstrap that same canonical PS1.",
    "The Connector-owned Cloudflared service name is exactly Mad4B-LocalConnector-Cloudflared.",
    "The tunnel token is stored in a restricted local token file and is not included in runtime evidence.",
    "Cloudflared metrics remain loopback-only on a Connector-dedicated listener.",
    "The generic cloudflared service and Mad4B-Staging-Cloudflared are non-interference boundaries and cannot become Connector mutation targets.",
    "No Cloudflare DNS/provider mutation, Production deployment, database mutation, migration apply, ruleset mutation, or secret rotation is authorized by this change.",
]
connector['evidence_paths'] = [
    '.changes/e2e/local-connector-owned-transport-admin-recovery-20260908.json',
    'http-generic-api/routes/connectorAgentRoutes.js',
    'http-generic-api/routes/localConnectorInstallRoutes.js',
    'http-generic-api/routes/index.js',
    'http-generic-api/test-local-connector-durable-self-healing.mjs',
    'local-connector/connector-watchdog.ps1',
    'local-connector/README.md',
]
admin = journeys['bounded-admin-recovery-chatgpt-connection']
admin['entrypoint'] = 'existing admin_recovery_staging projection embedded in admin_activation_staging through https://activation-dev.mad4b.com'
admin['terminal_outcome'] = 'ChatGPT uses the trusted Staging ingress and bounded embedded Recovery projection for read/readiness/certification and Gateway preflight semantics while consequential Gateway Apply, credentials, tickets, generic dispatch, provider authority, Production targets, and cross-environment fallback remain server-side or unexposed.'
admin['steps'] = [
    "Bind the connection contract to admin_recovery_staging embedded in admin_activation_staging.",
    "Use https://activation-dev.mad4b.com as the only ChatGPT registration ingress; keep https://dev.mad4b.com as upstream origin only.",
    "Advertise only Staging Recovery contract/readiness/certification reads on the current projection.",
    "Document Gateway rollout plan, forced dry-run, exact-SHA verification, and same-cycle readback as the bounded convergence set.",
    "Keep consequential Activation Gateway Apply behind the certified server-side workflow while the generic admin tool still accepts caller-selected capability_envelope_id/resource_binding_id.",
    "Reject generic repository/ref/workflow selection and caller-supplied GitHub/DB/provider credentials, execution tickets, capability envelopes, or resource bindings.",
]
admin['assertions'] = [
    "No direct ChatGPT registration is created on dev.mad4b.com.",
    "No generic GitHub Actions dispatcher or generic Cloudflare operation is exposed.",
    "No raw shell or raw SQL surface is added.",
    "No DNS or custom-domain mutation is exposed.",
    "No Production target or cross-environment fallback is allowed.",
    "Consequential Gateway Apply is not exposed through this Staging Recovery connection.",
    "No new break-glass secret or database migration is introduced.",
]
admin['evidence_paths'] = [
    'http-generic-api/config/admin-recovery-chatgpt-connection.json',
    'docs/governance/admin-recovery-chatgpt-connection.md',
    'http-generic-api/test-recovery-composition.mjs',
    'http-generic-api/openapi/openapi.custom-gpt.recovery-admin.staging.yaml',
    'http-generic-api/routes/stagingRecoveryAdminRoutes.js',
    'http-generic-api/activationGatewayRolloutTool.js',
    'http-generic-api/capabilityResolutionEnvelopeGuard.js',
    'canonicals/openapi/custom-gpt-surfaces.yaml',
]
write(manifest_path, json.dumps(manifest, indent=2) + '\n')

# 8) Rewrite human governance documentation to same Staging authority model.
docs_path = 'docs/governance/admin-recovery-chatgpt-connection.md'
docs = '''# MAD4B Admin Recovery ChatGPT connection

The repository registers one bounded Staging Admin Recovery connection contract at `http-generic-api/config/admin-recovery-chatgpt-connection.json`.

It reuses the existing `admin_recovery_staging` projection embedded in `admin_activation_staging`. The ChatGPT registration ingress is `https://activation-dev.mad4b.com`; `https://dev.mad4b.com` remains the upstream origin behind the trusted Activation Gateway and is not a direct ChatGPT registration target.

## Current connection boundary

The current Staging Recovery schema advertises only three non-consequential reads:

1. `getStagingRecoveryAdminContract`;
2. `getStagingRecoveryAdminReadiness`;
3. `getStagingRecoveryCertificationStatus`.

The surface remains `private_admin`, requires the trusted Staging gateway identity, advertises no mutation, permits no Production authority, and does not accept caller credentials or caller-generated execution authority.

## Activation Gateway convergence

The bounded Gateway convergence set is:

- `activation_gateway_rollout_plan`;
- `activation_gateway_dark_deploy` only with forced `dry_run` semantics;
- exact-SHA verification;
- same-cycle readback.

Consequential Gateway Apply is deliberately not exposed by this Staging Recovery connection. The existing generic Admin dark-deploy tool accepts a caller-supplied `capability_envelope_id` and `resource_binding_id`; although the runtime guard validates those objects, that is weaker than the Staging Recovery requirement that consequential authority be selected and bound entirely server-side. Apply therefore remains behind the existing certified server-side rollout workflow until a dedicated wrapper removes caller selection of those authority identifiers.

## Forbidden caller authority

The connection does not accept or expose caller-selected repository, ref, workflow, execution ticket, capability envelope, resource binding, GitHub token, Cloudflare credential, database identifier, database credential, raw SQL, or raw shell. It exposes no generic GitHub dispatch, generic Cloudflare operation, DNS mutation, custom-domain mutation, Production target, or cross-environment fallback.

No new database migration, break-glass secret, provider mutation, Production mutation, or signed recovery envelope is introduced by this connection contract.
'''
write(docs_path, docs)

# Fail if the deleted route remains referenced in the non-generated source files owned by this patch.
for owned in [index_path, test_path, policy_path, manifest_path, docs_path, connection_path]:
    if 'localConnectorInstallerDelegationRoutes' in read(owned):
        raise SystemExit(f'deleted delegation route still referenced by {owned}')
