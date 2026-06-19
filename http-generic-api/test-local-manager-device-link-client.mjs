import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const program = readFileSync(
  new URL("../apps/local-manager-windows/Program.cs", import.meta.url),
  "utf8",
);
const client = readFileSync(
  new URL("../apps/local-manager-windows/DeviceLinkClient.cs", import.meta.url),
  "utf8",
);

assert.match(program, /private readonly DeviceLinkClient _deviceLinkClient = new\(BaseUrl\);/);
assert.match(program, /_deviceLinkClient\.StartAsync\(/);
assert.match(program, /_deviceLinkClient\.PollAsync\(code, pollToken\)/);
assert.match(program, /_deviceLinkClient\.GetSessionAsync\(token\)/);
assert.doesNotMatch(program, /DeviceLinkStartUrl/);
assert.doesNotMatch(program, /DeviceLinkPollUrl/);
assert.doesNotMatch(program, /DeviceSessionUrl/);
assert.doesNotMatch(program, /class DeviceLinkStartResponse/);
assert.doesNotMatch(program, /class DeviceLinkPollResponse/);

assert.match(client, /\/local-manager\/device-link\/start/);
assert.match(client, /\/local-manager\/device-link\/poll/);
assert.match(client, /\/local-manager\/device\/session/);
assert.match(client, /internal async Task<DeviceLinkHttpResult<DeviceLinkStartResponse>> StartAsync/);
assert.match(client, /internal async Task<DeviceLinkHttpResult<DeviceLinkPollResponse>> PollAsync/);
assert.match(client, /internal async Task<DeviceLinkHttpResult<JsonElement>> GetSessionAsync/);
assert.match(client, /new AuthenticationHeaderValue\("Bearer", deviceAccessToken\)/);
assert.match(client, /Preserve the raw response so the recovery shell can display it/);
assert.doesNotMatch(client, /ProtectedData|File\.WriteAllBytes|DeviceIdentityStore/);

console.log("local manager device link client extraction guard passed");
