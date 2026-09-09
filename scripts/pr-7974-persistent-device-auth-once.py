from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    source = p.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    p.write_text(source.replace(old, new, 1), encoding="utf-8", newline="\n")


service = "http-generic-api/services/localManagerDeviceLinkService.js"
replace_once(
    service,
    "const PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS = 15 * 60;",
    "const PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS = DEVICE_TOKEN_TTL_SECONDS;",
    "persistent device authorization lifetime",
)
replace_once(
    service,
    "    requires_reauth_for_privileged_installers: true,",
    "    requires_reauth_for_privileged_installers: false,",
    "persistent device auth context",
)
replace_once(
    service,
    '''export async function requireFreshLocalManagerDeviceForPrivilegedInstaller(req) {
  const device = await requireLocalManagerDevice(req);
  if (device.auth_context?.privileged_authorization_fresh !== true) {
    const err = new Error("A recent Local Manager device re-authorization is required before issuing a privileged installer capability.");
    err.status = 401;
    err.code = "privileged_installer_reauth_required";
    err.details = {
      max_age_seconds: PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS,
      auth_age_seconds: device.auth_context?.auth_age_seconds ?? null,
      secrets_included: false,
    };
    throw err;
  }
  return device;
}''',
    '''export async function requireFreshLocalManagerDeviceForPrivilegedInstaller(req) {
  return requireLocalManagerDevice(req);
}''',
    "persistent privileged installer device authorization",
)

install_routes = "http-generic-api/routes/localConnectorInstallRoutes.js"
replace_once(
    install_routes,
    "        reauth_required_for_stale_device_tokens: true,",
    "        reauth_required_for_stale_device_tokens: false,",
    "device installer reauth response",
)

connect_test = "http-generic-api/test-connect-routes.mjs"
replace_once(
    connect_test,
    'source.includes("[payload.user_id, payload.tenant_id, payload.device_id]")',
    'source.includes("[payload.config_id, payload.user_id, payload.tenant_id, payload.device_id]")',
    "config-bound redemption source guard",
)

owner_test = "http-generic-api/test-local-manager-tool-release-owner.mjs"
replace_once(
    owner_test,
    "assert(installRoutes.includes('reauth_required_for_stale_device_tokens: true'), 'privileged installer links must require reauthentication when the saved device token is stale');",
    "assert(installRoutes.includes('reauth_required_for_stale_device_tokens: false'), 'privileged installer link responses must not require repeated sign-in for a valid saved device token');",
    "release owner installer reauth guard",
)
replace_once(
    owner_test,
    "assert(localManagerDeviceLinkService.includes('PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS = 15 * 60'), 'Local Manager privileged installer authorization must require a recent device authentication');",
    "assert(localManagerDeviceLinkService.includes('PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS = DEVICE_TOKEN_TTL_SECONDS'), 'Local Manager privileged installer authorization must follow the revocable device token lifetime');",
    "release owner persistent lifetime guard",
)
replace_once(
    owner_test,
    "assert(localManagerDeviceLinkService.includes('requires_reauth_for_privileged_installers: true'), 'Local Manager privileged installer authorization must require reauthentication outside the freshness window');",
    "assert(localManagerDeviceLinkService.includes('requires_reauth_for_privileged_installers: false'), 'Local Manager privileged installer authorization must not require repeated sign-in for a valid device token');",
    "release owner persistent auth context guard",
)

durable_test = "http-generic-api/test-local-connector-durable-self-healing.mjs"
replace_once(
    durable_test,
    "nodeAssert.match(localManagerDeviceSource, /PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS = 15 \\* 60/);",
    "nodeAssert.match(localManagerDeviceSource, /PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS = DEVICE_TOKEN_TTL_SECONDS/);",
    "durable persistent lifetime guard",
)
replace_once(
    durable_test,
    "nodeAssert.match(localManagerDeviceSource, /privileged_installer_reauth_required/);",
    "nodeAssert.doesNotMatch(localManagerDeviceSource, /privileged_installer_reauth_required/);",
    "durable no repeated reauth guard",
)
replace_once(
    durable_test,
    "nodeAssert.match(localManagerDeviceSource, /requires_reauth_for_privileged_installers:\\s*true/);",
    "nodeAssert.match(localManagerDeviceSource, /requires_reauth_for_privileged_installers:\\s*false/);",
    "durable persistent auth context guard",
)

print("PR #7974 persistent device authorization closure applied")
