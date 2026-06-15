import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../apps/local-manager-windows/SidecarRpcServer.cs", import.meta.url), "utf8");
const supervisor = readFileSync(new URL("../apps/local-manager-windows/SidecarLifecycleSupervisor.cs", import.meta.url), "utf8");
const program = readFileSync(new URL("../apps/local-manager-windows/Program.cs", import.meta.url), "utf8");
const architecture = readFileSync(new URL("../docs/hermes-surface-local-manager-container-architecture.md", import.meta.url), "utf8");

assert.match(server, /RequestTimeout = TimeSpan\.FromSeconds\(30\)/);
assert.match(server, /CancellationTokenSource\.CreateLinkedTokenSource\(cancellationToken\)/);
assert.match(server, /requestTimeout\.CancelAfter\(RequestTimeout\)/);
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

assert.doesNotMatch(program, /SidecarLifecycleSupervisor|SidecarRpcServer|SidecarReadOnlyDispatcher/);
assert.match(architecture, /lifecycle supervisor is implemented but remains\s+intentionally unattached/i);

console.log("local manager sidecar lifecycle supervision guard passed");
