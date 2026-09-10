import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const program = readFileSync(
  new URL("../apps/local-manager-windows/Program.cs", import.meta.url),
  "utf8",
);
const coordinator = readFileSync(
  new URL("../apps/local-manager-windows/SignedInstallerCoordinator.cs", import.meta.url),
  "utf8",
);
const installerRoutes = readFileSync(
  new URL("./routes/localConnectorInstallRoutes.js", import.meta.url),
  "utf8",
);

assert.match(program, /private readonly SignedInstallerCoordinator _signedInstallerCoordinator = new\(BaseUrl, UpdatesRoot\);/);
assert.match(program, /_signedInstallerCoordinator\.RequestRepairAsync\(token\)/);
assert.match(program, /_signedInstallerCoordinator\.RequestCapabilitiesAsync\(/);
assert.match(program, /_signedInstallerCoordinator\.DownloadAsync\(link, SignedInstallerKind\.Repair\)/);
assert.match(program, /_signedInstallerCoordinator\.DownloadAsync\(link, SignedInstallerKind\.Capabilities\)/);
assert.match(program, /_signedInstallerCoordinator\.RunElevatedAsync\(download\)/);
assert.doesNotMatch(program, /DeviceRepairInstallerUrl/);
assert.doesNotMatch(program, /Verb = "runas"/);
assert.doesNotMatch(program, /class DeviceInstallerLinkResponse/);

assert.match(coordinator, /RequestRepairAsync/);
assert.match(coordinator, /RequestCapabilitiesAsync/);
assert.match(coordinator, /\/local-connector\/install\/device-download-link/);
assert.match(coordinator, /Uri\.UriSchemeHttps/);
assert.match(coordinator, /string\.Equals\(uri\.Host, _baseUri\.Host/);
assert.match(coordinator, /uri\.Port != _baseUri\.Port/);
assert.match(coordinator, /"\/local-connector\/install\/download"/);
assert.match(coordinator, /AllowAutoRedirect = false/);
assert.match(coordinator, /AssertOwnedInstallerPath/);
assert.match(coordinator, /Path\.GetRelativePath\(_updatesRoot, path\)/);
assert.match(coordinator, /var extension = Path\.GetExtension\(path\)/);
assert.match(coordinator, /string\.Equals\(extension, "\.bat", StringComparison\.OrdinalIgnoreCase\)/);
assert.match(coordinator, /allowDownloadExtension && string\.Equals\(extension, "\.download", StringComparison\.OrdinalIgnoreCase\)/);
assert.match(coordinator, /Verb = "runas"/);
assert.match(coordinator, /NativeErrorCode == 1223/);
assert.match(coordinator, /WaitForExitAsync\(cancellationToken\)/);
assert.match(coordinator, /LastExitCode = process\.ExitCode/);
assert.match(coordinator, /process\.ExitCode != 0/);
assert.match(coordinator, /SignedInstallerExitCodeException\(process\.ExitCode, TryReadFailureEvidence\(failureEvidencePath\)\)/);
assert.match(coordinator, /Guid\.NewGuid\(\):N/);
assert.match(coordinator, /SHA256\.HashDataAsync/);
assert.match(coordinator, /Installer file changed after governed download/);
assert.doesNotMatch(coordinator, /ProcessStartInfo[\s\S]*Arguments\s*=/);
assert.doesNotMatch(coordinator, /HttpMethod\.Put|HttpMethod\.Delete|ProtectedData/);

assert.match(
  coordinator,
  /if \(capabilities\.Count > 0 \|\| apps\.Count > 0 \|\| allowedPaths\.Count > 0 \|\| shellAliases\.Count > 0\)/,
  "Windows capability installer client must fail closed when UI-selected authority would be sent",
);
assert.match(
  coordinator,
  /throw new ServerManagedConnectorPolicyException\(\)/,
  "Windows capability installer client must use a typed fail-closed server-managed policy error",
);
assert.match(
  coordinator,
  /Connector capability changes are server-managed by the canonical device policy/,
  "Windows client must explain the canonical server-managed capability boundary without exposing secrets",
);
assert.doesNotMatch(
  coordinator,
  /RequestAsync\(deviceAccessToken, new\s*\{[\s\S]*?capabilities\s*,[\s\S]*?permission_grants\s*=/,
  "Windows client must not serialize caller-selected capabilities or permission grants into installer-link requests",
);
assert.match(
  coordinator,
  /ttl_minutes = 10/,
  "Windows installer client must request a bounded TTL within the canonical installer capability maximum",
);

const portAssignment = installerRoutes.indexOf('`$Port = ${Number(port)}`');
const healthUrl = installerRoutes.indexOf("\"$HealthUrl = 'http://127.0.0.1:' + $Port + '/health'\"");
assert.ok(portAssignment >= 0, "PowerShell installer must define the generated connector port");
assert.ok(healthUrl > portAssignment, "PowerShell installer must define $Port before building $HealthUrl");

console.log("local manager signed installer coordinator extraction guard passed");
