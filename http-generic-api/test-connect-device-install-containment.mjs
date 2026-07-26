import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("routes/localConnectorInstallRoutes.js", "utf8");
const helperStart = source.indexOf("export async function provisionLocalConnectorInstall");
const helperEnd = source.indexOf("export function buildLocalConnectorInstallRoutes", helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, "provisionLocalConnectorInstall helper must be present");

const helper = source.slice(helperStart, helperEnd);
const returnStart = helper.lastIndexOf("return {");
assert(returnStart >= 0, "provisionLocalConnectorInstall must return an install response envelope");
const returnEnvelope = helper.slice(returnStart);

assert(
  helper.includes("if (!existing || reprovision)") &&
    returnEnvelope.includes("existing_config_reused: Boolean(existing && !reprovision)") &&
    returnEnvelope.includes("reprovisioned: Boolean(!existing || reprovision)"),
  "device install must reuse existing configs unless reprovision is explicitly requested"
);

assert(
  returnEnvelope.includes("secrets_included: false") &&
    returnEnvelope.includes("connector_secret_included: false") &&
    returnEnvelope.includes("connector_local_api_key_included: false"),
  "device install response must explicitly mark raw connector secrets as excluded"
);

assert(
  returnEnvelope.includes('download_link_endpoint: "/local-connector/install/download-link"') &&
    returnEnvelope.includes('installer_download_endpoint: "/local-connector/install/download"') &&
    returnEnvelope.includes("reprovision_requires_explicit_flag: true"),
  "device install response must route installer generation through governed download surfaces"
);

assert.doesNotMatch(
  returnEnvelope,
  /connector_secret\s*:\s*connectorSecret|connector_local_api_key\s*:\s*connectorLocalApiKey|cf_token\s*:\s*tunnelToken/,
  "device install response must not return raw connector, local API, or Cloudflare tunnel secrets"
);

assert.doesNotMatch(
  returnEnvelope,
  /install_bat|install_ps1|installScript|installPowerShell|buildInstallScript|buildInstallPowerShell|buildConnectorEnv|tunnel_command/,
  "device install response must not include generated installer bodies, env files, or tunnel commands"
);

console.log("connect device install containment guard passed");
