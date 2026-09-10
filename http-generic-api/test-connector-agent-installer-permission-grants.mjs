import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/connectorAgentRoutes.js", "utf8");

assert(routes.includes("normalizePermissionGrants"), "connector agent installer must normalize permission grants");
assert(routes.includes("shell_aliases"), "connector agent installer must support shell_aliases grants");
assert(routes.includes("const allAliases = [...aliases, ...grants.shell_aliases]"), "connector agent env must merge default aliases with granted shell aliases");
assert(routes.includes("buildAllowlistEnvValue(allAliases)"), "connector agent env must render merged aliases into CONNECTOR_SHELL_ALLOWLIST");
assert(routes.includes("const dbGrants = await loadConnectorGrantPolicy(config.config_id)"), "connector agent installer must load grants from the canonical DB policy");
assert(routes.includes("capabilities: dbGrants.capabilities"), "connector agent installer must render only DB-authorized capabilities");
assert(routes.includes("permissionGrants: dbGrants"), "connector agent installer must render only DB-authorized permission grants");
assert(!routes.includes("payload.permission_grants"), "installer capabilities must not carry caller-selected permission grants");
assert(routes.includes("normalizeWindowsPath"), "connector agent grants must validate Windows command paths");
assert(routes.includes("allow_extra_args: item?.allow_extra_args === true"), "connector agent grants must preserve explicit allow_extra_args only");
assert(routes.includes("!/[;&|`$<>\\n\\r]/.test(arg)"), "connector agent grants must reject shell metacharacters in args");
assert(!routes.includes("eval("), "connector agent installer must not eval grant payloads");
assert(routes.includes("$Root = Split-Path -Parent $MyInvocation.MyCommand.Path"), "connector installer must preserve the governed Local Manager updates root across UAC identity changes by resolving it from the downloaded installer path");
assert(routes.includes("if ([string]::IsNullOrWhiteSpace($Root)) { throw 'connector_installer_root_unresolved' }"), "connector installer must fail closed when the governed installer root cannot be resolved");
assert(routes.includes("New-Item -ItemType Directory -Force -Path $Root"), "connector installer must create the governed installer root before writing runtime files");

console.log("connector agent installer permission grants tests passed");
