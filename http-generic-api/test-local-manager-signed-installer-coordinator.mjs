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
assert.match(coordinator, /Path\.GetExtension\(path\), "\.bat"/);
assert.match(coordinator, /Verb = "runas"/);
assert.match(coordinator, /NativeErrorCode == 1223/);
assert.match(coordinator, /WaitForExitAsync\(cancellationToken\)/);
assert.match(coordinator, /Guid\.NewGuid\(\):N/);
assert.match(coordinator, /SHA256\.HashDataAsync/);
assert.match(coordinator, /Installer file changed after governed download/);
assert.doesNotMatch(coordinator, /ProcessStartInfo[\s\S]*Arguments\s*=/);
assert.doesNotMatch(coordinator, /HttpMethod\.Put|HttpMethod\.Delete|ProtectedData/);

console.log("local manager signed installer coordinator extraction guard passed");
