import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/hostinger-ssh-dependency-diagnostic.mjs", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");

assert.match(script, /dependency_diagnostic_only/);
assert.match(script, /executes_ssh_network: false/);
assert.match(script, /executes_hostinger_login: false/);
assert.match(script, /deploy_allowed: false/);
assert.match(script, /restart_allowed: false/);
assert.match(script, /provider_dispatch_allowed: false/);
assert.match(script, /secrets_included: false/);
assert.match(script, /sshpass/);
assert.match(script, /fd3_pipe/);
assert.match(script, /probe-placeholder-not-a-secret/);
assert.doesNotMatch(script, /hostinger_ssh_prod_password|hostinger_ssh_prod_private_key|resolveEffectiveCredential|decryptToken/i);
assert.doesNotMatch(script, /\bSSHPASS\b/, "diagnostic must not use sshpass password environment variable");
assert.doesNotMatch(script, /user@\$\{host\}|bash\s+-lc|git\s+rev-parse|deploy_release|restart_app/);

assert.match(adminCli, /hostinger_ssh_dependency_diagnostic/);
assert.match(adminCli, /hostinger-ssh-dependency-diagnostic\.mjs/);

console.log("Hostinger SSH dependency diagnostic guard passed");
