import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../apps/local-manager-windows/SidecarRpcServer.cs", import.meta.url), "utf8");
const supervisor = readFileSync(new URL("../apps/local-manager-windows/SidecarLifecycleSupervisor.cs", import.meta.url), "utf8");
const program = readFileSync(new URL("../apps/local-manager-windows/Program.cs", import.meta.url), "utf8");
const architecture = readFileSync(new URL("../docs/hermes-surface-local-manager-container-architecture.md", import.meta.url), "utf8");
const certification = readFileSync(
  new URL("../apps/local-manager-sidecar-certification/Program.cs", import.meta.url),
  "utf8",
);

assert.match(server, /_requestTimeout = requestTimeout \?\? TimeSpan\.FromSeconds\(30\)/);
assert.match(server, /CancellationTokenSource\.CreateLinkedTokenSource\(cancellationToken\)/);
assert.match(server, /requestTimeout\.CancelAfter\(_requestTimeout\)/);
assert.match(server, /Drop stalled local clients/);
assert.match(server, /Disconnected clients must not terminate the server accept loop/);
assert.match(server, /Malformed or oversized clients must not terminate the server accept loop/);
assert.doesNotMatch(server, /catch \(Exception\)/);

assert.match(supervisor, /internal sealed class SidecarLifecycleSupervisor : IAsyncDisposable/);
assert.match(supervisor, /The sidecar lifecycle supervisor is already started/);
assert.match(supervisor, /await _server\.RunAsync\(_dispatch, cancellationToken\)/);
assert.match(supervisor, /_restartCount\+\+/);
assert.match(supervisor, /await Task\.Delay\(RestartDelay, cancellationToken\)/);
assert.match(supervisor, /_lifetime\.Cancel\(\)/);
assert.match(supervisor, /bool SecretsIncluded/);
assert.doesNotMatch(supervisor, /Process\.Start|ProtectedData|HttpClient|connector_secret|device_access_token/);

assert.match(program, /RunMainFormWithSidecar\(\)/);
assert.match(program, /new SidecarReadOnlyDispatcher\(deviceIdentityStore, capabilityVerifier, runtimeClient\)/);
assert.match(program, /new SidecarLocalConsentBroker\(\)/);
assert.match(program, /new SidecarRpcServer\(localConsent: privateConsent\)/);
assert.match(program, /privateConsent\.InvalidateAll\(\)/);
assert.match(program, /supervisor\.Start\(\)/);
assert.match(program, /supervisor\.DisposeAsync\(\)\.AsTask\(\)\.GetAwaiter\(\)\.GetResult\(\)/);

for (const check of ["success", "rejection", "timeout_recovery", "supervisor_restart", "shutdown"]) {
  assert.match(certification, new RegExp(`"${check}"`));
}
const localEditor = readFileSync(
  new URL("../apps/local-manager-windows/LocalDocumentEditForm.cs", import.meta.url), "utf8");
assert.match(program, /#if LOCAL_MANAGER_STAGING\s+var editDocumentButton/);
assert.match(program, /LocalDocumentEditForm\.ShowEditor\(this\)/);
const project = readFileSync(
  new URL("../apps/local-manager-windows/Mad4B.LocalManager.Windows.csproj", import.meta.url), "utf8");
assert.match(project, /<LocalManagerEnvironment Condition="'\$\(LocalManagerEnvironment\)' == ''">production<\/LocalManagerEnvironment>/);
assert.match(project, /<DefineConstants Condition="'\$\(LocalManagerEnvironment\)' == 'staging'">\$\(DefineConstants\);LOCAL_MANAGER_STAGING<\/DefineConstants>/);
assert.match(localEditor, /#if LOCAL_MANAGER_STAGING\s+namespace Mad4B\.LocalManager\.Windows;/);
assert.match(localEditor, /#endif\s*$/);
assert.match(localEditor, /DocumentStructuralEditor\.ReplaceDocxRun/);
assert.match(localEditor, /DocumentStructuralEditor\.ReplaceXlsxInlineCell/);
assert.match(localEditor, /MessageBoxButtons\.OKCancel/);
assert.match(localEditor, /FileMode\.CreateNew/);
assert.match(localEditor, /FileShare\.None/);
assert.match(localEditor, /SHA256\.HashData\(check\)/);
assert.doesNotMatch(localEditor, /FileMode\.Create\b|File\.WriteAllBytes|Process\.Start/);

assert.match(architecture, /live named-pipe certification/i);

console.log("local manager sidecar lifecycle supervision guard passed");
