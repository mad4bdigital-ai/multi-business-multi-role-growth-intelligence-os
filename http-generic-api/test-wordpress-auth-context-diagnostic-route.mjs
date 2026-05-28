import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routesSource = readFileSync(new URL("./routes/outputSinkRoutes.js", import.meta.url), "utf8");
const orchestratorSource = readFileSync(new URL("./wordpressBlogPublishOrchestrator.js", import.meta.url), "utf8");

assert(routesSource.includes('import { diagnoseWordpressAuthContext } from "../wordpressBlogPublishOrchestrator.js";'), "route must import WordPress auth diagnostic helper");
assert(routesSource.includes('router.post("/wordpress/auth-context/diagnose"'), "route must expose WordPress auth context diagnostic endpoint");
assert(routesSource.includes("tenant_id, user_id, connection_id"), "route must validate required diagnostic inputs");
assert(orchestratorSource.includes("export async function diagnoseWordpressAuthContext"), "orchestrator must export diagnostic helper");
assert(orchestratorSource.includes("/users/me?context=edit"), "diagnostic helper must inspect authenticated WordPress REST context");
assert(orchestratorSource.includes("can_edit_posts") && orchestratorSource.includes("can_publish_posts"), "diagnostic helper must return safe capability booleans");
assert(!orchestratorSource.includes("secret:"), "diagnostic helper must not return raw secrets");

console.log("wordpress auth context diagnostic route test passed");
