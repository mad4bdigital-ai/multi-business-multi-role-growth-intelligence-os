import assert from "node:assert/strict";
import fs from "node:fs";
import YAML from "yaml";
import { computeToolInputSchemaSha256 } from "./routes/gptToolsRoutes.js";

const a={type:"object",properties:{b:{type:"integer"},a:{type:"string"}},required:["a"]};
const b={required:["a"],properties:{a:{type:"string"},b:{type:"integer"}},type:"object"};
assert.equal(computeToolInputSchemaSha256(a),computeToolInputSchemaSha256(b));
assert.notEqual(computeToolInputSchemaSha256(a),computeToolInputSchemaSha256({...a,additionalProperties:false}));

const source=fs.readFileSync(new URL("./routes/gptToolsRoutes.js",import.meta.url),"utf8");
assert.match(source,/descriptor_version: "input-schema-sha256\.v1"/u);
assert.match(source,/input_schema_sha256: computeToolInputSchemaSha256/u);
assert.match(source,/expected_input_schema_sha256/u);
assert.match(source,/code: "descriptor_stale"/u);
assert.match(source,/execution_performed: false/u);

const openapi=YAML.parse(fs.readFileSync(new URL("./openapi.yaml",import.meta.url),"utf8"));
const operations=[];
for(const item of Object.values(openapi.paths||{}))for(const operation of Object.values(item||{}))if(operation&&typeof operation==="object")operations.push(operation);
const call=operations.find((op)=>op?.operationId==="callAdminTool");
const schema=call?.requestBody?.content?.["application/json"]?.schema;
assert.equal(schema?.properties?.expected_input_schema_sha256?.pattern,"^[a-f0-9]{64}$");
console.log("Admin dynamic tool descriptor binding tests passed");
