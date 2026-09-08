import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const indexSource = read("http-generic-api/routes/index.js");
const agentSource = read("http-generic-api/routes/connectorAgentRoutes.js");
const watchdogSource = read("local-connector/connector-watchdog.ps1");
const readme = read("local-connector/README.md");

const delegationMount = indexSource.indexOf("app.use(buildLocalConnectorInstallerDelegationRoutes");
const legacyMount = indexSource.indexOf("app.use(buildLocalConnectorInstallRoutes(deps))");
assert.ok(delegationMount >= 0, "canonical delegation router must be mounted");
assert.ok(legacyMount > delegationMount, "canonical delegation router must precede legacy installer routes");

assert.match(agentSource, /\$CfService = 'Mad4B-LocalConnector-Cloudflared'/);
assert.match(agentSource, /CONNECTOR_CLOUDFLARED_SERVICE=Mad4B-LocalConnector-Cloudflared/);
assert.match(agentSource, /CONNECTOR_CLOUDFLARED_METRICS=127\.0\.0\.1:49313/);
assert.match(agentSource, /cloudflared-token\.txt/);
assert.doesNotMatch(agentSource, /cloudflared service install/);
assert.match(agentSource, /connector-environment-policy\.mjs/);
assert.match(agentSource, /connector-runtime-bootstrap\.mjs/);

assert.match(watchdogSource, /Mad4B-LocalConnector-Cloudflared/);
assert.match(watchdogSource, /Mad4B-Staging-Cloudflared/);
assert.match(readme, /shared Admin Recovery transport/);
assert.match(readme, /Mad4B-LocalConnector-Cloudflared/);
assert.match(readme, /staging` → `dev\.mad4b\.com/);
assert.match(readme, /production` → `auth\.mad4b\.com/);
assert.match(readme, /Do not treat a generic Windows service named `cloudflared` as Connector-owned/);

console.log("local connector installer routing closure: ok");
