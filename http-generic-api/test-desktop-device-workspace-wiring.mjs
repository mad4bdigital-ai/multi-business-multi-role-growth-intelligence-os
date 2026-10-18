import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const form = read("apps/local-manager-windows/DeviceWorkspaceForm.cs");
const main = read("apps/local-manager-windows/Program.cs");
const server = read("local-connector/server.mjs");
const project = read("apps/local-manager-windows/Mad4B.LocalManager.Windows.csproj");
test("Local Manager build profile is guarded by MSBuild, not an unreachable runtime check", () => {
  assert.doesNotMatch(main, /LocalManagerEnvironment\.Name\s+is\s+not\s*\(/);
  assert.match(project, /<Target Name="ValidateLocalManagerEnvironment" BeforeTargets="BeforeBuild">/);
  assert.match(project, /LocalManagerEnvironment must be production or staging/);
  assert.match(project, /LOCAL_MANAGER_STAGING/);
});
test("Desktop Workspace is wired to the existing Windows app, not a new independent daemon", () => {
  assert.match(main, /new DeviceWorkspaceForm\(\)/);
  assert.match(form, /class DeviceWorkspaceForm : Form/);
  assert.match(form, /http:\/\/127\.0\.0\.1:7070\//);
  assert.doesNotMatch(form, /auth\.mad4b\.com|dev\.mad4b\.com|api\.mad4b\.com/);
});
test("Local scope and approval headers are enforced independently per risk class", () => {
  assert.match(form, /x-connector-secret/);
  assert.match(form, /x-mad4b-device-terminal-approval/);
  assert.match(form, /x-mad4b-device-write-approval/);
  assert.match(server, /DEVICE_SCOPE_REQUIRED/);
  assert.match(server, /owner_principal: 'connector-admin'/);
  assert.match(form, /UseSystemPasswordChar = secret/);
  assert.match(form, /_connectorSecret\.Clear\(\)/);
  assert.match(form, /_terminalApproval\.Clear\(\)/);
  assert.match(form, /_fileApproval\.Clear\(\)/);
});
test("Workspace exposes functional controls for files, terminal and owned sessions", () => {
  for (const action of ["list", "read", "search", "patch", "rollback",
    "start", "input", "output", "resume", "cancel", "process_list", "process_terminate",
    "read_many", "stat", "create_directory", "create_file", "copy", "move"]) {
    assert.ok(form.includes('"' + action + '"'), "Missing action: " + action);
  }
  assert.match(form, /async Task FilesAsync/);
  assert.match(form, /async Task TerminalAsync/);
  assert.match(form, /await _client\.SendAsync\(request\)/);
});
