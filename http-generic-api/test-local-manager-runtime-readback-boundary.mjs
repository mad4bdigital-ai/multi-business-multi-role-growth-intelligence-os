import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const proxy = readFileSync(new URL("./routes/connectorProxyRoutes.js", import.meta.url), "utf8");
const deviceLink = readFileSync(new URL("./services/localManagerDeviceLinkService.js", import.meta.url), "utf8");
const openapi = readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
const client = readFileSync(new URL("../apps/local-manager-windows/LocalRuntimeClient.cs", import.meta.url), "utf8");
const dispatcher = readFileSync(new URL("../apps/local-manager-windows/SidecarReadOnlyDispatcher.cs", import.meta.url), "utf8");

assert.match(proxy, /requireLocalManagerDevice/);
assert.match(proxy, /router\.post\("\/local-manager\/device\/agent-runtime"/);
assert.match(proxy, /\["capabilities", "recommend_models"\]\.includes\(action\)/);
assert.match(proxy, /invalid_device_runtime_read_action/);
assert.match(proxy, /req\.body = \{ action \}/);
assert.match(proxy, /proxyToDevice\(req, res, device\.device_id, "\/agent-runtime"\)/);
assert.doesNotMatch(proxy, /req\.body = \{ \.\.\.req\.body/);
assert.match(deviceLink, /runtime_readback: "\/local-manager\/device\/agent-runtime"/);
assert.match(openapi, /\/local-manager\/device\/agent-runtime:/);
assert.match(openapi, /operationId: postLocalManagerDeviceAgentRuntimeReadback/);
assert.match(openapi, /enum: \[capabilities, recommend_models\]/);

assert.match(client, /"capabilities"/);
assert.match(client, /"recommend_models"/);
assert.match(client, /AllowedActions\.Contains\(action\)/);
assert.match(client, /\/local-manager\/device\/agent-runtime/);
assert.match(client, /new AuthenticationHeaderValue\("Bearer", deviceAccessToken\)/);
assert.doesNotMatch(client, /connector_secret|BACKEND_API_KEY|settings_update|install_provider|install_model|delegation_approved/);

assert.match(dispatcher, /"runtime\.getCapabilities" => GetRuntimeReadbackAsync\("capabilities"/);
assert.match(dispatcher, /"runtime\.getRecommendations" => GetRuntimeReadbackAsync\("recommend_models"/);
assert.match(dispatcher, /_localRuntimeClient\.GetAsync\(action, token, cancellationToken\)/);
assert.match(dispatcher, /Local runtime readback returned an invalid or unsafe envelope/);
assert.match(dispatcher, /SidecarRpcContracts\.AssertSecretSafeResponse\(payload\)/);

console.log("local manager runtime readback boundary guard passed");
