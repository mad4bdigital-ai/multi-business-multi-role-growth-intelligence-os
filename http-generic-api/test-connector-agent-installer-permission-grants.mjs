import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/connectorAgentRoutes.js", "utf8");

assert(routes.includes("normalizePermissionGrants"), "connector agent installer must normalize permission grants");
assert(routes.includes("shell_aliases"), "connector agent installer must support shell_aliases grants");
assert(routes.includes("const allAliases = [...aliases, ...grants.shell_aliases]"), "connector agent env must merge default aliases with granted shell aliases");
assert(routes.includes("buildAllowlistEnvValue(allAliases)"), "connector agent env must render merged aliases into CONNECTOR_SHELL_ALLOWLIST");
assert(routes.includes("permissionGrants: payload.permission_grants || {}"), "connector agent installer must pass token permission grants into renderer");
assert(routes.includes("normalizeWindowsPath"), "connector agent grants must validate Windows command paths");
assert(routes.includes("allow_extra_args: item?.allow_extra_args === true"), "connector agent grants must preserve explicit allow_extra_args only");
assert(routes.includes("!/[;&|`$<>\\n\\r]/.test(arg)"), "connector agent grants must reject shell metacharacters in args");
assert(!routes.includes("eval("), "connector agent installer must not eval grant payloads");

console.log("connector agent installer permission grants tests passed");
