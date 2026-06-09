import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/hostinger-sshpass-dependency-install.mjs", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");

assert.match(script, /INSTALL_SSHPASS_SERVER_DEPENDENCY/);
assert.match(script, /PACKAGE_NAME = "sshpass"/);
assert.match(script, /apply: false/);
assert.match(script, /missing_install_confirmation/);
assert.match(script, /sshpass_install_requires_root/);
assert.match(script, /unsupported_package_manager/);
assert.match(script, /apt-get/);
assert.match(script, /dnf/);
assert.match(script, /yum/);
assert.match(script, /apk/);
assert.match(script, /deploy_allowed: false/);
assert.match(script, /restart_allowed: false/);
assert.match(script, /provider_dispatch_allowed: false/);
assert.match(script, /executes_hostinger_login: false/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /SSHPASS\s*=|hostinger_ssh_prod_password|hostinger_ssh_prod_private_key|resolveEffectiveCredential|decryptToken/i);
assert.doesNotMatch(script, /deploy_release|restart_app|rsync|scp/);

assert.match(adminCli, /hostinger_sshpass_dependency_install/);
assert.match(adminCli, /hostinger-sshpass-dependency-install\.mjs/);

console.log("Hostinger sshpass dependency installer guard passed");
