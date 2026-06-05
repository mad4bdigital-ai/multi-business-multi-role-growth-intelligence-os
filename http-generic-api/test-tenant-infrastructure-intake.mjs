import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const connectRoutes = readFileSync("routes/connectApiRoutes.js", "utf8");
const routesIndex = readFileSync("routes/index.js", "utf8");
const migration = readFileSync("migrations/193_sprint66_tenant_infrastructure_intake.sql", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(connectRoutes.includes("status IN ('active','beta')"), "tenant connect catalog should expose active and beta app integrations");
assert(connectRoutes.includes("beta_included: true"), "connect catalog response should mark beta visibility explicitly");
assert(connectRoutes.includes("infrastructure_auth_types: ['ssh_key_pair', 'remote_database']"), "connect catalog should advertise infrastructure auth types");

assert(connectRoutes.includes('authType === "ssh_key_pair"'), "connect secure intake must support ssh_key_pair schema");
assert(connectRoutes.includes('name: "ssh_host"'), "ssh intake must include ssh_host");
assert(connectRoutes.includes('name: "ssh_port"'), "ssh intake must include ssh_port");
assert(connectRoutes.includes('name: "ssh_user"'), "ssh intake must include ssh_user");
assert(connectRoutes.includes('name: "ssh_private_key"'), "ssh intake must include ssh_private_key");
assert(connectRoutes.includes('secret: true') && connectRoutes.includes('SSH_PRIVATE_KEY'), "ssh private key must be secret");
assert(!connectRoutes.match(/authType === "ssh_key_pair"[\s\S]{0,700}db_name/), "SSH schema must not include DB fields");

assert(connectRoutes.includes('authType === "remote_database"'), "connect secure intake must support remote_database schema");
assert(connectRoutes.includes('name: "db_host"'), "remote DB intake must include db_host");
assert(connectRoutes.includes('name: "db_port"'), "remote DB intake must include db_port");
assert(connectRoutes.includes('name: "db_name"'), "remote DB intake must include db_name");
assert(connectRoutes.includes('name: "db_user"'), "remote DB intake must include db_user");
assert(connectRoutes.includes('name: "db_password"'), "remote DB intake must include db_password");
assert(connectRoutes.includes('DB_PASSWORD') && connectRoutes.includes('secret: true'), "remote DB password must be secret");

assert(migration.includes("'ssh_key_pair'") && migration.includes("'remote_database'"), "tenant tool schema migration must register infrastructure auth types");
assert(migration.includes('no_secret_chat') && migration.includes('infrastructure_intake'), "tenant tool migration must retain no-secret-chat and infrastructure tags");

assert(openapi.includes('ssh_key_pair') && openapi.includes('remote_database'), "OpenAPI must document infrastructure auth types");

console.log("Tenant infrastructure credential intake guard passed");
