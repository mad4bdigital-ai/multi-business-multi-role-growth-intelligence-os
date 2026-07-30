#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const testPath = path.join(apiRoot, "test-agent-governance-runtime.mjs");

const before = `    if (text.startsWith("SELECT * FROM execution_plans WHERE plan_id = ? LIMIT 1 FOR UPDATE")) return [[this.plan]];`;
const after = `    if (text.startsWith("SELECT * FROM execution_plans WHERE plan_id = ? LIMIT 2 FOR UPDATE")) return [[this.plan]];`;

let source = fs.readFileSync(testPath, "utf8");
const first = source.indexOf(before);
if (first < 0) throw new Error("agent governance sequential plan fixture block not found");
if (source.indexOf(before, first + before.length) >= 0) throw new Error("agent governance sequential plan fixture block is not unique");
source = `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;

const assertionAnchor = `assert.equal(completedEndToEnd.last_tick.plan_status, "completed");`;
const assertion = `${assertionAnchor}\nassert.match(\n  readFileSync("sequentialPlanOrchestrator.js", "utf8"),\n  /SELECT \\* FROM execution_plans WHERE plan_id = \\? LIMIT 2 FOR UPDATE/,\n);`;
if (!source.includes(assertionAnchor)) throw new Error("agent governance completion assertion anchor not found");
if (source.includes(`readFileSync("sequentialPlanOrchestrator.js", "utf8")`)) throw new Error("agent governance source contract assertion already present");
source = source.replace(assertionAnchor, assertion);

fs.writeFileSync(testPath, source);
console.log("X0 agent governance fixture parity applied");
