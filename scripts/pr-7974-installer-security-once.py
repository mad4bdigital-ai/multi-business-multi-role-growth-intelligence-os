from pathlib import Path
import json
import re

ROOT = Path('.')


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf-8', newline='\n')


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return source.replace(old, new, 1)


def regex_once(source, pattern, replacement, label, flags=re.S):
    out, count = re.subn(pattern, replacement, source, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one regex match, found {count}')
    return out


# ---------------------------------------------------------------------------
# 1) Shared short-lived installer capability authority.
# ---------------------------------------------------------------------------
capability_path = 'http-generic-api/localConnectorInstallerCapability.js'
capability_source = r'''import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { resolveRuntimeEnvironmentStrict } from "./runtimeEnvironmentResolver.js";

export const LOCAL_CONNECTOR_INSTALLER_CAPABILITY_CONTRACT = "mad4b.local-connector-installer-capability.v1";
export const LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS = 10 * 60;
export const LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MIN_TTL_SECONDS = 5 * 60;

function capabilityError(status, code, message) {
  const err = new Error(message || code);
  err.status = status;
  err.code = code;
  err.details = { secrets_included: false };
  return err;
}

function compact(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function installerTokenSecret(env = process.env) {
  const secret = compact(env?.BACKEND_API_KEY, 4096);
  if (!secret) throw capabilityError(500, "installer_token_secret_missing", "BACKEND_API_KEY is required for installer capabilities.");
  return secret;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

export function installerControlPlaneBinding(env = process.env) {
  const runtime = resolveRuntimeEnvironmentStrict(env);
  if (!runtime.ok || !["staging", "production"].includes(runtime.environment_key)) {
    throw capabilityError(503, "installer_runtime_environment_unresolved", `Installer runtime environment is not exact: ${runtime.reason || "unknown"}.`);
  }
  const host = runtime.environment_key === "staging" ? "dev.mad4b.com" : "auth.mad4b.com";
  return Object.freeze({
    environment: runtime.environment_key,
    runtime_class: runtime.runtime_class,
    baseUrl: `https://${host}`,
    host,
    secrets_included: false,
  });
}

export function assertNoInstallerAuthorityOverrides(source = {}) {
  const capabilities = Array.isArray(source?.capabilities)
    ? source.capabilities.filter((value) => String(value || "").trim())
    : String(source?.capabilities || "").split(",").filter((value) => String(value || "").trim());
  const grants = source?.permission_grants && typeof source.permission_grants === "object" && !Array.isArray(source.permission_grants)
    ? source.permission_grants
    : {};
  const hasGrantValues = Object.values(grants).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return Boolean(String(value || "").trim());
  });
  if (capabilities.length > 0 || hasGrantValues) {
    throw capabilityError(
      403,
      "installer_permission_grants_server_managed",
      "Installer capabilities and permission grants are server-managed by the canonical Local Connector policy and cannot be supplied by the caller.",
    );
  }
}

export function createInstallerCapability({
  config_id,
  user_id,
  tenant_id,
  device_id,
  format = "ps1",
  app_managed = false,
  ttl_minutes = 10,
  env = process.env,
  now_seconds = Math.floor(Date.now() / 1000),
} = {}) {
  const binding = installerControlPlaneBinding(env);
  const normalizedFormat = compact(format, 16).toLowerCase();
  if (!["ps1", "bat"].includes(normalizedFormat)) {
    throw capabilityError(400, "unsupported_format", "Only ps1 or bat installer capabilities are supported.");
  }
  const configId = compact(config_id, 64);
  const userId = compact(user_id, 64);
  const tenantId = compact(tenant_id, 64);
  const deviceId = compact(device_id, 128);
  if (!configId || !userId || !tenantId || !deviceId) {
    throw capabilityError(400, "installer_capability_scope_incomplete", "Installer capability requires exact config, user, tenant, and device scope.");
  }
  const requestedTtl = Math.floor(Number(ttl_minutes || 10) * 60);
  const ttlSeconds = Math.max(
    LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MIN_TTL_SECONDS,
    Math.min(LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS, Number.isFinite(requestedTtl) ? requestedTtl : LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS),
  );
  const issuedAt = Math.floor(Number(now_seconds));
  return Object.freeze({
    version: 1,
    contract: LOCAL_CONNECTOR_INSTALLER_CAPABILITY_CONTRACT,
    purpose: "local_connector_installer",
    aud: "connector_agent",
    environment: binding.environment,
    config_id: configId,
    user_id: userId,
    tenant_id: tenantId,
    device_id: deviceId,
    format: normalizedFormat,
    app_managed: app_managed === true,
    jti: randomUUID(),
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  });
}

export function signInstallerDownloadToken(payload, { env = process.env } = {}) {
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac("sha256", installerTokenSecret(env)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyInstallerDownloadToken(token, { env = process.env, expectedFormat = null, now_seconds = Math.floor(Date.now() / 1000) } = {}) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) throw capabilityError(401, "invalid_download_token", "Invalid installer capability.");
  const expected = createHmac("sha256", installerTokenSecret(env)).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw capabilityError(401, "invalid_download_token", "Invalid installer capability signature.");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw capabilityError(401, "invalid_download_token", "Invalid installer capability payload.");
  }
  const binding = installerControlPlaneBinding(env);
  const now = Math.floor(Number(now_seconds));
  const issuedAt = Number(payload?.iat || 0);
  const expiresAt = Number(payload?.exp || 0);
  const requiredStrings = [payload?.config_id, payload?.user_id, payload?.tenant_id, payload?.device_id, payload?.jti]
    .every((value) => Boolean(compact(value, 128)));
  if (
    payload?.version !== 1 ||
    payload?.contract !== LOCAL_CONNECTOR_INSTALLER_CAPABILITY_CONTRACT ||
    payload?.purpose !== "local_connector_installer" ||
    payload?.aud !== "connector_agent" ||
    payload?.environment !== binding.environment ||
    !requiredStrings ||
    !["ps1", "bat"].includes(compact(payload?.format, 16).toLowerCase()) ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt <= 0 ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS ||
    issuedAt > now + 60 ||
    expiresAt < now
  ) {
    throw capabilityError(401, "installer_capability_invalid", "Installer capability claims are invalid, expired, or outside the current environment.");
  }
  if (expectedFormat && compact(payload.format, 16).toLowerCase() !== compact(expectedFormat, 16).toLowerCase()) {
    throw capabilityError(400, "unsupported_format", `Installer capability must target ${expectedFormat}.`);
  }
  return Object.freeze({ ...payload, format: compact(payload.format, 16).toLowerCase() });
}
'''
write(capability_path, capability_source)


# ---------------------------------------------------------------------------
# 2) Issuance/download: caller cannot select grants, exact config scope, canonical origin.
# ---------------------------------------------------------------------------
install_path = 'http-generic-api/routes/localConnectorInstallRoutes.js'
source = read(install_path)
source = replace_once(
    source,
    'import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";',
    'import { createHash, randomUUID } from "node:crypto";',
    'local installer crypto import',
)
import_anchor = '''import {
  connectorLocalApiKeySelectFragment,
  hasConnectorLocalApiKeyColumn,
} from "../connectorSchemaCompatibility.js";
'''
import_replacement = import_anchor + '''import {
  assertNoInstallerAuthorityOverrides,
  createInstallerCapability,
  installerControlPlaneBinding,
  signInstallerDownloadToken,
  verifyInstallerDownloadToken,
} from "../localConnectorInstallerCapability.js";
'''
source = replace_once(source, import_anchor, import_replacement, 'local installer capability import')
source = regex_once(
    source,
    r'function base64url\(input\) \{.*?\n\}\n\nasync function assertActiveMembership',
    'async function assertActiveMembership',
    'remove legacy installer token authority',
)
source = replace_once(
    source,
    '''      const ttl = Math.max(5, Math.min(60, Number(req.body?.ttl_minutes || 30)));
      const permissionGrants = normalizePermissionGrants({ ...(req.body?.permission_grants || {}), capabilities: req.body?.capabilities || [] });
      const capabilities = permissionGrants.capabilities;
      const appManaged = req.body?.app_managed === true || req.body?.suppress_pause === true || req.body?.no_pause === true;''',
    '''      const ttl = Math.max(5, Math.min(10, Number(req.body?.ttl_minutes || 10)));
      assertNoInstallerAuthorityOverrides(req.body || {});
      const appManaged = req.body?.app_managed === true || req.body?.suppress_pause === true || req.body?.no_pause === true;''',
    'device download authority ceiling',
)
source = replace_once(
    source,
    '''      const token = signInstallerDownloadToken({
        user_id: device.user_id,
        tenant_id: config.tenant_id || device.tenant_id,
        device_id: config.device_id,
        format,
        capabilities,
        permission_grants: permissionGrants,
        app_managed: appManaged,
        exp: Math.floor(Date.now() / 1000) + ttl * 60,
      });''',
    '''      const token = signInstallerDownloadToken(createInstallerCapability({
        config_id: config.config_id,
        user_id: device.user_id,
        tenant_id: config.tenant_id || device.tenant_id,
        device_id: config.device_id,
        format,
        app_managed: appManaged,
        ttl_minutes: ttl,
      }));''',
    'device installer capability issuance',
)
source = replace_once(
    source,
    '''        capabilities,
        permission_grants: {
          allowed_paths: permissionGrants.allowed_paths,
          app_aliases: Object.keys(permissionGrants.apps),
          shell_aliases: permissionGrants.shell_aliases.map((entry) => entry.alias),
        },''',
    '''        capabilities: [],
        permission_grants: {
          source: "database_policy",
          caller_overrides_allowed: false,
        },''',
    'device response grant boundary',
)
source = replace_once(
    source,
    '        reauth_required_for_stale_device_tokens: false,',
    '        reauth_required_for_stale_device_tokens: true,',
    'device reauth response',
)
source = replace_once(
    source,
    '''      const ttl = Math.max(5, Math.min(120, Number(ttl_minutes || 30)));
      const permissionGrants = normalizePermissionGrants({ ...(req.body?.permission_grants || {}), capabilities: req.body?.capabilities || [] });
      const capabilities = permissionGrants.capabilities;
      const token = signInstallerDownloadToken({
        user_id: principal.userId,
        tenant_id: config.tenant_id || principal.tenantId,
        device_id,
        format,
        capabilities,
        permission_grants: permissionGrants,
        exp: Math.floor(Date.now() / 1000) + ttl * 60,
      });''',
    '''      const ttl = Math.max(5, Math.min(10, Number(ttl_minutes || 10)));
      assertNoInstallerAuthorityOverrides(req.body || {});
      const token = signInstallerDownloadToken(createInstallerCapability({
        config_id: config.config_id,
        user_id: principal.userId,
        tenant_id: config.tenant_id || principal.tenantId,
        device_id,
        format,
        ttl_minutes: ttl,
      }));''',
    'admin installer capability issuance',
)
source = replace_once(
    source,
    '''        capabilities,
        permission_grants: {
          allowed_paths: permissionGrants.allowed_paths,
          app_aliases: Object.keys(permissionGrants.apps),
          shell_aliases: permissionGrants.shell_aliases.map((entry) => entry.alias),
        },''',
    '''        capabilities: [],
        permission_grants: {
          source: "database_policy",
          caller_overrides_allowed: false,
        },''',
    'admin response grant boundary',
)
source = replace_once(
    source,
    '"SELECT config_id, device_id FROM `local_connector_user_configs` WHERE user_id = ? AND tenant_id = ? AND device_id = ? AND is_enabled = 1 LIMIT 1",\n        [payload.user_id, payload.tenant_id, payload.device_id]',
    '"SELECT config_id, device_id FROM `local_connector_user_configs` WHERE config_id = ? AND user_id = ? AND tenant_id = ? AND device_id = ? AND is_enabled = 1 LIMIT 1",\n        [payload.config_id, payload.user_id, payload.tenant_id, payload.device_id]',
    'compatibility exact config binding',
)
public_base_uses = source.count('publicBaseUrl(req)')
if public_base_uses != 3:
    raise SystemExit(f'expected three installer publicBaseUrl uses before canonicalization, found {public_base_uses}')
source = source.replace('publicBaseUrl(req)', 'installerControlPlaneBinding().baseUrl')
write(install_path, source)


# ---------------------------------------------------------------------------
# 3) Canonical agent: secretless artifact, one-time credential redemption,
#    exact tenant/config binding, DB-only grants, token-file version guard.
# ---------------------------------------------------------------------------
agent_path = 'http-generic-api/routes/connectorAgentRoutes.js'
source = read(agent_path)
agent_import_anchor = 'import { resolveRuntimeEnvironmentStrict } from "../runtimeEnvironmentResolver.js";\n'
agent_import_replacement = agent_import_anchor + '''import {
  installerControlPlaneBinding,
  verifyInstallerDownloadToken,
} from "../localConnectorInstallerCapability.js";
'''
source = replace_once(source, agent_import_anchor, agent_import_replacement, 'agent capability import')
source = regex_once(
    source,
    r'function publicBaseUrl\(req\) \{.*?\n\}\n\nfunction connectorControlPlaneHost',
    'function connectorControlPlaneHost',
    'remove forwarded-host base resolver',
)
source = regex_once(
    source,
    r'function installerTokenSecret\(\) \{.*?\n\}\n\nfunction psQuote',
    'function psQuote',
    'remove duplicate agent installer token verifier',
)
claim_helper = r'''async function claimInstallerCapability(config, payload) {
  const metadata = JSON.stringify({
    contract: payload.contract,
    purpose: payload.purpose,
    audience: payload.aud,
    environment: payload.environment,
    issued_at: payload.iat,
    expires_at: payload.exp,
    one_time: true,
    secrets_included: false,
  });
  try {
    const [result] = await getPool().query(
      `INSERT INTO \`local_connector_recovery_events\`
         (event_id, config_id, user_id, tenant_id, device_id, event_type, status, source, agent_version, active_slot, error_code, error_message, metadata_json)
       VALUES (?, ?, ?, ?, ?, 'repair_bundle', 'ok', 'installer', ?, NULL, NULL, NULL, ?)`,
      [payload.jti, config.config_id, config.user_id, config.tenant_id, config.device_id, AGENT_VERSION, metadata],
    );
    if (Number(result?.affectedRows || 0) !== 1) {
      throw httpError(409, "installer_capability_replayed", "Installer credential capability has already been consumed.");
    }
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY" || err?.code === "installer_capability_replayed") {
      throw httpError(409, "installer_capability_replayed", "Installer credential capability has already been consumed.");
    }
    if (err?.status) throw err;
    throw httpError(503, "installer_replay_store_unavailable", "Installer credential replay protection is unavailable; refusing secret materialization.");
  }
}

'''
source = replace_once(source, 'function buildConnectorEnv(', claim_helper + 'function buildConnectorEnv(', 'insert durable installer replay claim')
source = replace_once(
    source,
    "function buildConnectorEnv({ connectorSecret, connectorLocalApiKey = '', aliases, port, capabilities = [], permissionGrants = {}, environment, controlPlaneBaseUrl }) {",
    "function buildConnectorEnv({ aliases, port, capabilities = [], permissionGrants = {}, environment, controlPlaneBaseUrl }) {",
    'secretless env signature',
)
source = regex_once(
    source,
    r'  const connectorLocalApiKeyLine = String\(connectorLocalApiKey \|\| \'\'\)\.trim\(\)\n    \? \[`CONNECTOR_LOCAL_API_KEY=\$\{String\(connectorLocalApiKey\)\.trim\(\)\}`\]\n    : \[\];\n  return \[\n    `CONNECTOR_SECRET=\$\{connectorSecret\}`,\n    \.\.\.connectorLocalApiKeyLine,',
    '  return [',
    'remove raw secrets from env',
)
source = replace_once(
    source,
    "function buildInstallPowerShell({ cfToken, connectorSecret, connectorLocalApiKey = '', tunnelUrl, aliases, port, capabilities = [], permissionGrants = {}, environment, controlPlaneBaseUrl }) {\n  const envText = buildConnectorEnv({ connectorSecret, connectorLocalApiKey, aliases, port, capabilities, permissionGrants, environment, controlPlaneBaseUrl });",
    "function buildInstallPowerShell({ credentialUrl, tunnelUrl, aliases, port, capabilities = [], permissionGrants = {}, environment, controlPlaneBaseUrl }) {\n  const envText = buildConnectorEnv({ aliases, port, capabilities, permissionGrants, environment, controlPlaneBaseUrl });",
    'secretless installer signature',
)
source = replace_once(
    source,
    '''    "$SecretsRoot = Join-Path $Root 'secrets'",
    "$CfTokenFile = Join-Path $SecretsRoot 'cloudflared-token.txt'",
    "$CfStdout = Join-Path $Root 'cloudflared.log'",''',
    '''    "$SecretsRoot = Join-Path $Root 'secrets'",
    "$CfTokenFile = Join-Path $SecretsRoot 'cloudflared-token.txt'",
    "$ConnectorSecretFile = Join-Path $SecretsRoot 'connector-secret.txt'",
    "$ConnectorLocalApiKeyFile = Join-Path $SecretsRoot 'connector-local-api-key.txt'",
    `$CredentialUrl = '${psQuote(credentialUrl)}'`,
    "$CfStdout = Join-Path $Root 'cloudflared.log'",''',
    'installer secret file paths',
)
source = replace_once(
    source,
    '''    "function Protect-ConnectorSecretFile {",
    "  param([Parameter(Mandatory=$true)][string]$Path)",
    "  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name",
    "  & icacls.exe $Path /inheritance:r /grant:r \"${identity}:(R,W)\" /grant:r \"SYSTEM:F\" | Out-Null",
    "  if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict Local Connector tunnel token file ACL.' }",
    "}",''',
    '''    "function Protect-ConnectorSecretDirectory {",
    "  param([Parameter(Mandatory=$true)][string]$Path)",
    "  New-Item -ItemType Directory -Force -Path $Path | Out-Null",
    "  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name",
    "  & icacls.exe $Path /inheritance:r /grant:r \"${identity}:(OI)(CI)F\" /grant:r \"SYSTEM:(OI)(CI)F\" | Out-Null",
    "  if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict Local Connector secrets directory ACL.' }",
    "}",
    "function Protect-ConnectorSecretFile {",
    "  param([Parameter(Mandatory=$true)][string]$Path)",
    "  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name",
    "  & icacls.exe $Path /inheritance:r /grant:r \"${identity}:(R,W)\" /grant:r \"SYSTEM:F\" | Out-Null",
    "  if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict Local Connector secret file ACL.' }",
    "}",''',
    'pre-write directory ACL',
)
source = regex_once(
    source,
    r'    "New-Item -ItemType Directory -Force -Path \$SecretsRoot \| Out-Null",\n    `\$CfToken = \'\$\{psQuote\(cfToken\)\}\'`,.*?    "Set-Content -Path \(Join-Path \$Root \'\.env\'\) -Value \$EnvText -Encoding ascii",',
    '''    "Protect-ConnectorSecretDirectory $SecretsRoot",
    "if ([string]::IsNullOrWhiteSpace($CredentialUrl)) { throw 'Installer credential redemption URL is missing.' }",
    "$CredentialBundle = Invoke-RestMethod -Uri $CredentialUrl -Method Get -Headers @{ Accept = 'application/json' } -TimeoutSec 60",
    "if (-not $CredentialBundle.ok) { throw 'Installer credential redemption failed.' }",
    "$CfToken = [string]$CredentialBundle.cf_token",
    "$ConnectorSecret = [string]$CredentialBundle.connector_secret",
    "$ConnectorLocalApiKey = [string]$CredentialBundle.connector_local_api_key",
    "if ([string]::IsNullOrWhiteSpace($CfToken) -or $CfToken.Length -le 20) { throw 'Local Connector tunnel token is empty or invalid.' }",
    "if ([string]::IsNullOrWhiteSpace($ConnectorSecret) -or $ConnectorSecret.Length -le 20) { throw 'Local Connector secret is empty or invalid.' }",
    "$tokenEncoding = New-Object System.Text.UTF8Encoding($false)",
    "[IO.File]::WriteAllText($CfTokenFile, $CfToken.Trim(), $tokenEncoding)",
    "[IO.File]::WriteAllText($ConnectorSecretFile, $ConnectorSecret.Trim(), $tokenEncoding)",
    "Protect-ConnectorSecretFile $CfTokenFile",
    "Protect-ConnectorSecretFile $ConnectorSecretFile",
    "if (-not [string]::IsNullOrWhiteSpace($ConnectorLocalApiKey)) {",
    "  [IO.File]::WriteAllText($ConnectorLocalApiKeyFile, $ConnectorLocalApiKey.Trim(), $tokenEncoding)",
    "  Protect-ConnectorSecretFile $ConnectorLocalApiKeyFile",
    "}",
    "$CfToken = $null",
    "$ConnectorSecret = $null",
    "$ConnectorLocalApiKey = $null",
    "$CredentialBundle = $null",
    "",
    "$EnvText = @'",
    envText,
    "'@",
    "$EnvText += \"`r`nCONNECTOR_CLOUDFLARED_TOKEN_FILE=$CfTokenFile\"",
    "$EnvText += \"`r`nCONNECTOR_SECRET_FILE=$ConnectorSecretFile\"",
    "if (Test-Path -LiteralPath $ConnectorLocalApiKeyFile) { $EnvText += \"`r`nCONNECTOR_LOCAL_API_KEY_FILE=$ConnectorLocalApiKeyFile\" }",
    "Set-Content -Path (Join-Path $Root '.env') -Value $EnvText -Encoding ascii",''',
    'one-time secret material redemption',
)
source = replace_once(
    source,
    '''    "$cfPath = (Get-Command cloudflared -ErrorAction Stop).Source",
    "$cfSvc = Get-Service -Name $CfService -ErrorAction SilentlyContinue",''',
    '''    "$cfPath = (Get-Command cloudflared -ErrorAction Stop).Source",
    "$cfVersionText = (& $cfPath --version 2>&1 | Out-String).Trim()",
    "if ($cfVersionText -notmatch '(\\d{4})\\.(\\d{1,2})\\.(\\d{1,2})') { throw 'cloudflared_version_unparseable' }",
    "$cfVersion = [version](\"$($Matches[1]).$($Matches[2]).$($Matches[3])\")",
    "if ($cfVersion -lt [version]'2025.4.0') { throw 'cloudflared_token_file_unsupported_version' }",
    "$cfSvc = Get-Service -Name $CfService -ErrorAction SilentlyContinue",''',
    'cloudflared token-file version guard',
)
source = replace_once(
    source,
    '''      const base = publicBaseUrl(req);
      const binding = resolveConnectorEnvironmentBinding();''',
    '''      const binding = resolveConnectorEnvironmentBinding();
      const base = binding.baseUrl;''',
    'manifest canonical origin',
)
installer_handler = r'''  router.get("/connector-agent/installer.ps1", async (req, res) => {
    try {
      const token = String(req.query.token || "");
      const payload = verifyInstallerDownloadToken(token, { expectedFormat: "ps1" });
      const material = String(req.query.material || "").trim().toLowerCase();
      if (material && material !== "runtime_credentials") {
        throw httpError(400, "installer_material_invalid", "Unknown installer material request.");
      }
      const [[config]] = await getPool().query(
        `SELECT config_id, user_id, tenant_id, device_id, COALESCE(device_runtime_url, tunnel_url) AS tunnel_url
           FROM \`local_connector_user_configs\`
          WHERE config_id = ? AND user_id = ? AND tenant_id = ? AND device_id = ? AND is_enabled = 1
          LIMIT 1`,
        [payload.config_id, payload.user_id, payload.tenant_id, payload.device_id]
      );
      if (!config) throw httpError(404, "connector_config_not_found", "No exact active connector config was found for this installer capability.");

      if (material === "runtime_credentials") {
        await claimInstallerCapability(config, payload);
        const connectorLocalApiKeySelect = await connectorLocalApiKeySelectFragment();
        const [[credentials]] = await getPool().query(
          `SELECT connector_secret, ${connectorLocalApiKeySelect}, cf_token
             FROM \`local_connector_user_configs\`
            WHERE config_id = ? AND user_id = ? AND tenant_id = ? AND device_id = ? AND is_enabled = 1
            LIMIT 1`,
          [payload.config_id, payload.user_id, payload.tenant_id, payload.device_id]
        );
        if (!credentials?.cf_token || !credentials?.connector_secret) {
          throw httpError(409, "connector_config_incomplete", "Connector config is missing canonical runtime credentials.");
        }
        res.setHeader("Cache-Control", "no-store, max-age=0");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("X-Mad4B-Installer-Material", "one-time-runtime-credentials");
        return res.status(200).json({
          ok: true,
          cf_token: credentials.cf_token,
          connector_secret: credentials.connector_secret,
          connector_local_api_key: credentials.connector_local_api_key || "",
          one_time: true,
          secrets_included: true,
        });
      }

      const dbGrants = await loadConnectorGrantPolicy(config.config_id);
      const binding = resolveConnectorEnvironmentBinding();
      const capabilityBinding = installerControlPlaneBinding();
      if (capabilityBinding.environment !== binding.environment || capabilityBinding.baseUrl !== binding.baseUrl) {
        throw httpError(503, "installer_control_plane_binding_mismatch", "Installer capability and Connector control-plane bindings do not match.");
      }
      const credentialUrl = `${binding.baseUrl}/connector-agent/installer.ps1?material=runtime_credentials&token=${encodeURIComponent(token)}`;
      const installer = buildInstallPowerShell({
        credentialUrl,
        tunnelUrl: config.tunnel_url,
        aliases: DEFAULT_WINDOWS_ALIASES,
        port: CONNECTOR_PORT,
        capabilities: dbGrants.capabilities,
        permissionGrants: dbGrants,
        environment: binding.environment,
        controlPlaneBaseUrl: binding.baseUrl,
      });
      const filename = `install-local-connector-${String(config.device_id).replace(/[^a-zA-Z0-9_-]+/g, "-")}.ps1`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
      return res.status(200).send(installer);
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "connector_agent_installer_failed", message: err.message }, secrets_included: false });
    }
  });

'''
source = regex_once(
    source,
    r'  router\.get\("/connector-agent/installer\.ps1", async \(req, res\) => \{.*?\n  \}\);\n\n(?=  router\.get\("/connector-agent/files/:fileName")',
    lambda _m: installer_handler,
    'canonical installer handler',
)
if 'mergePermissionGrants(dbGrants, payload.permission_grants' in source:
    raise SystemExit('caller grant union survived canonical installer patch')
if '`CONNECTOR_SECRET=${connectorSecret}`' in source or 'CONNECTOR_LOCAL_API_KEY=${String(connectorLocalApiKey)' in source:
    raise SystemExit('raw connector secret survived generated env patch')
if 'publicBaseUrl(req)' in source:
    raise SystemExit('forwarded-host base URL survived connector agent patch')
write(agent_path, source)


# ---------------------------------------------------------------------------
# 4) Privileged device installer authorization must be fresh.
# ---------------------------------------------------------------------------
device_service_path = 'http-generic-api/services/localManagerDeviceLinkService.js'
source = read(device_service_path)
source = replace_once(
    source,
    'const PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS = DEVICE_TOKEN_TTL_SECONDS;',
    'const PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS = 15 * 60;',
    'privileged device auth max age',
)
source = replace_once(
    source,
    '    requires_reauth_for_privileged_installers: false,',
    '    requires_reauth_for_privileged_installers: true,',
    'privileged auth context policy',
)
source = replace_once(
    source,
    '''export async function requireFreshLocalManagerDeviceForPrivilegedInstaller(req) {
  // A valid, non-revoked Local Manager device token is sufficient. Windows UAC
  // remains required locally for every privileged installer execution.
  return requireLocalManagerDevice(req);
}''',
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
    'enforce privileged device freshness',
)
write(device_service_path, source)


# ---------------------------------------------------------------------------
# 5) Runtime/bootstrap tests and security regression assertions.
# ---------------------------------------------------------------------------
runtime_test_path = 'local-connector/test-connector-runtime-bootstrap.mjs'
source = read(runtime_test_path)
source = replace_once(
    source,
    'import { applyConnectorServerEnvironmentGuard, shouldGuardConnectorServer } from "./connector-runtime-bootstrap.mjs";',
    'import { applyConnectorServerEnvironmentGuard, hydrateConnectorSecretsFromFiles, shouldGuardConnectorServer } from "./connector-runtime-bootstrap.mjs";',
    'runtime bootstrap test import',
)
source += r'''

test("bootstrap hydrates connector credentials from absolute secret files without returning them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-connector-secrets-"));
  const connectorSecretFile = path.join(dir, "connector-secret.txt");
  const localApiKeyFile = path.join(dir, "connector-local-api-key.txt");
  fs.writeFileSync(connectorSecretFile, "connector-secret-sentinel", { mode: 0o600 });
  fs.writeFileSync(localApiKeyFile, "local-api-key-sentinel", { mode: 0o600 });
  const env = {};
  const result = hydrateConnectorSecretsFromFiles({
    env,
    resolvedEnv: {
      CONNECTOR_SECRET_FILE: connectorSecretFile,
      CONNECTOR_LOCAL_API_KEY_FILE: localApiKeyFile,
    },
  });
  assert.equal(env.CONNECTOR_SECRET, "connector-secret-sentinel");
  assert.equal(env.CONNECTOR_LOCAL_API_KEY, "local-api-key-sentinel");
  assert.deepEqual(result.hydrated_keys, ["CONNECTOR_SECRET", "CONNECTOR_LOCAL_API_KEY"]);
  assert.equal(result.secrets_included, false);
  assert.equal(JSON.stringify(result).includes("connector-secret-sentinel"), false);
});

test("bootstrap rejects relative secret file bindings", () => {
  assert.throws(
    () => hydrateConnectorSecretsFromFiles({ env: {}, resolvedEnv: { CONNECTOR_SECRET_FILE: "./connector-secret.txt" } }),
    /connector_secret_file_absolute_path_required:CONNECTOR_SECRET_FILE/,
  );
});
'''
write(runtime_test_path, source)

capability_test_path = 'http-generic-api/test-local-connector-installer-capability.mjs'
capability_test = r'''import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS,
  assertNoInstallerAuthorityOverrides,
  createInstallerCapability,
  installerControlPlaneBinding,
  signInstallerDownloadToken,
  verifyInstallerDownloadToken,
} from "./localConnectorInstallerCapability.js";

const env = {
  BACKEND_API_KEY: "installer-capability-test-key",
  DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
};

test("installer capability is exact-scope, staging-bound and short lived", () => {
  const now = 2_000_000_000;
  const payload = createInstallerCapability({
    config_id: "config-1",
    user_id: "user-1",
    tenant_id: "tenant-1",
    device_id: "device-1",
    format: "ps1",
    ttl_minutes: 99,
    env,
    now_seconds: now,
  });
  assert.equal(payload.environment, "staging");
  assert.equal(payload.config_id, "config-1");
  assert.equal(payload.purpose, "local_connector_installer");
  assert.equal(payload.aud, "connector_agent");
  assert.ok(payload.jti);
  assert.equal(payload.exp - payload.iat, LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS);
  assert.equal(installerControlPlaneBinding(env).baseUrl, "https://dev.mad4b.com");
  const token = signInstallerDownloadToken(payload, { env });
  const verified = verifyInstallerDownloadToken(token, { env, expectedFormat: "ps1", now_seconds: now + 5 });
  assert.equal(verified.config_id, "config-1");
  assert.equal(verified.tenant_id, "tenant-1");
});

test("installer capability rejects caller-selected permission authority", () => {
  assert.throws(
    () => assertNoInstallerAuthorityOverrides({ capabilities: ["windows_control"] }),
    /server-managed/,
  );
  assert.throws(
    () => assertNoInstallerAuthorityOverrides({ permission_grants: { allowed_paths: ["C:\\work"] } }),
    /server-managed/,
  );
  assert.doesNotThrow(() => assertNoInstallerAuthorityOverrides({ capabilities: [], permission_grants: {} }));
});

test("installer capability rejects tamper, wrong environment and stale replay window", () => {
  const now = 2_000_000_000;
  const payload = createInstallerCapability({
    config_id: "config-1",
    user_id: "user-1",
    tenant_id: "tenant-1",
    device_id: "device-1",
    format: "bat",
    env,
    now_seconds: now,
  });
  const token = signInstallerDownloadToken(payload, { env });
  assert.throws(() => verifyInstallerDownloadToken(`${token}tampered`, { env, now_seconds: now }), /Invalid installer capability/);
  assert.throws(
    () => verifyInstallerDownloadToken(token, {
      env: { ...env, DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy" },
      now_seconds: now,
    }),
    /outside the current environment/,
  );
  assert.throws(
    () => verifyInstallerDownloadToken(token, { env, now_seconds: payload.exp + 1 }),
    /invalid, expired/,
  );
});
'''
write(capability_test_path, capability_test)

self_healing_path = 'http-generic-api/test-local-connector-durable-self-healing.mjs'
source = read(self_healing_path)
source = replace_once(
    source,
    'const connectorReadme = readFileSync("../local-connector/README.md", "utf8");',
    '''const connectorReadme = readFileSync("../local-connector/README.md", "utf8");
const installerCapabilitySource = readFileSync("localConnectorInstallerCapability.js", "utf8");
const localManagerDeviceSource = readFileSync("services/localManagerDeviceLinkService.js", "utf8");
const runtimeBootstrapSource = readFileSync("../local-connector/connector-runtime-bootstrap.mjs", "utf8");''',
    'self-healing source imports',
)
security_assertions = r'''
nodeAssert.match(installerSource, /createInstallerCapability/);
nodeAssert.match(installerSource, /assertNoInstallerAuthorityOverrides/);
nodeAssert.match(installerSource, /config_id: config\.config_id/);
nodeAssert.match(downloadHandlerSource, /WHERE config_id = \? AND user_id = \? AND tenant_id = \? AND device_id = \?/);
nodeAssert.doesNotMatch(installerSource, /permission_grants:\s*permissionGrants/);
nodeAssert.match(installerCapabilitySource, /purpose:\s*"local_connector_installer"/);
nodeAssert.match(installerCapabilitySource, /aud:\s*"connector_agent"/);
nodeAssert.match(installerCapabilitySource, /jti:\s*randomUUID\(\)/);
nodeAssert.match(installerCapabilitySource, /LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS = 10 \* 60/);
nodeAssert.match(installerCapabilitySource, /installer_permission_grants_server_managed/);
nodeAssert.match(agentSource, /claimInstallerCapability/);
nodeAssert.match(agentSource, /local_connector_recovery_events/);
nodeAssert.match(agentSource, /installer_capability_replayed/);
nodeAssert.match(agentSource, /material=runtime_credentials/);
nodeAssert.match(agentSource, /permissionGrants:\s*dbGrants/);
nodeAssert.doesNotMatch(agentSource, /mergePermissionGrants\(dbGrants,\s*payload\.permission_grants/);
nodeAssert.match(agentSource, /WHERE config_id = \? AND user_id = \? AND tenant_id = \? AND device_id = \? AND is_enabled = 1/);
nodeAssert.match(agentSource, /Protect-ConnectorSecretDirectory \$SecretsRoot/);
nodeAssert.match(agentSource, /CONNECTOR_SECRET_FILE=\$ConnectorSecretFile/);
nodeAssert.match(agentSource, /CONNECTOR_LOCAL_API_KEY_FILE=\$ConnectorLocalApiKeyFile/);
nodeAssert.doesNotMatch(agentSource, /`CONNECTOR_SECRET=\$\{connectorSecret\}`/);
nodeAssert.match(agentSource, /cloudflared_token_file_unsupported_version/);
nodeAssert.match(agentSource, /\[version\]'2025\.4\.0'/);
nodeAssert.doesNotMatch(agentSource, /publicBaseUrl\(req\)/);
nodeAssert.match(runtimeBootstrapSource, /CONNECTOR_SECRET_FILE/);
nodeAssert.match(runtimeBootstrapSource, /CONNECTOR_LOCAL_API_KEY_FILE/);
nodeAssert.match(localManagerDeviceSource, /PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS = 15 \* 60/);
nodeAssert.match(localManagerDeviceSource, /privileged_installer_reauth_required/);
nodeAssert.match(localManagerDeviceSource, /requires_reauth_for_privileged_installers:\s*true/);
'''
insert_marker = 'nodeAssert.match(agentSource, /\\$CfService = \'Mad4B-LocalConnector-Cloudflared\'/);'
source = replace_once(source, insert_marker, security_assertions + '\n' + insert_marker, 'self-healing security assertions')
write(self_healing_path, source)


# ---------------------------------------------------------------------------
# 6) Include the new authority files in the existing E2E source declaration.
# ---------------------------------------------------------------------------
manifest_path = '.changes/e2e/local-connector-owned-transport-admin-recovery-20260908.json'
manifest = json.loads(read(manifest_path))
includes = manifest.get('includes')
if not isinstance(includes, list):
    raise SystemExit('E2E manifest includes list is missing')
for item in [
    'http-generic-api/localConnectorInstallerCapability.js',
    'http-generic-api/services/localManagerDeviceLinkService.js',
    'http-generic-api/test-local-connector-installer-capability.mjs',
    'local-connector/connector-runtime-bootstrap.mjs',
    'local-connector/test-connector-runtime-bootstrap.mjs',
]:
    if item not in includes:
        includes.append(item)
write(manifest_path, json.dumps(manifest, indent=2) + '\n')

print('PR 7974 installer security closure applied')
