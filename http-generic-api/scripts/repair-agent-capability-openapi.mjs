import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const sourcePath = process.argv[2];
const targetPath = process.argv[3] || 'openapi.yaml';

if (!sourcePath) {
  throw new Error('Usage: node scripts/repair-agent-capability-openapi.mjs <source-openapi> [target-openapi]');
}

const marker = '  /platform/agent-governance/readiness:\n';
const coveragePaths = `  /platform/agent-governance/logic-coverage:
    get:
      tags: [platform-agent-governance]
      security: [{ adminBearerAuth: [] }, { backendApiKeyAuth: [] }]
      operationId: getAgentGovernanceLogicCoverage
      summary: Read evidence-backed Agent Logic runtime coverage
      description: Returns Logic inventory separately from retrieval, selection, dispatch, success, and verification evidence. Active inventory alone is not counted as usage.
      parameters:
        - { name: logic_key, in: query, required: false, schema: { type: string, pattern: '^[A-Za-z0-9_.:-]{1,191}$' } }
        - { name: registry_status, in: query, required: false, schema: { type: string, pattern: '^[a-z0-9_-]{1,32}$' } }
        - name: usage_status
          in: query
          required: false
          schema: { type: string, enum: [never_retrieved, retrieved_never_selected, selected_never_dispatched, dispatched_never_succeeded, succeeded_not_verified, verified] }
        - { name: limit, in: query, required: false, schema: { type: integer, minimum: 1, maximum: 250, default: 100 } }
      responses:
        "200": { description: Logic runtime coverage and usage evidence }
        "400": { $ref: "#/components/responses/BadRequest" }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "403": { description: Admin principal required }
  /platform/agent-governance/engine-coverage:
    get:
      tags: [platform-agent-governance]
      security: [{ adminBearerAuth: [] }, { backendApiKeyAuth: [] }]
      operationId: getAgentGovernanceEngineCoverage
      summary: Read evidence-backed Agent Engine runtime coverage
      description: Returns workflow-bound Engine references separately from retrieval, selection, dispatch, success, and verification evidence. Textual references alone are not counted as usage.
      parameters:
        - { name: engine_key, in: query, required: false, schema: { type: string, pattern: '^[A-Za-z0-9_.:-]{1,191}$' } }
        - name: usage_status
          in: query
          required: false
          schema: { type: string, enum: [never_retrieved, retrieved_never_selected, selected_never_dispatched, dispatched_never_succeeded, succeeded_not_verified, verified] }
        - { name: limit, in: query, required: false, schema: { type: integer, minimum: 1, maximum: 250, default: 100 } }
      responses:
        "200": { description: Engine runtime coverage and usage evidence }
        "400": { $ref: "#/components/responses/BadRequest" }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "403": { description: Admin principal required }
`;

const source = fs.readFileSync(path.resolve(sourcePath), 'utf8');
if (!source.includes(marker)) {
  throw new Error('Agent Governance readiness marker was not found in source OpenAPI');
}
if (source.includes('/platform/agent-governance/logic-coverage:') || source.includes('/platform/agent-governance/engine-coverage:')) {
  throw new Error('Source OpenAPI already contains Agent capability coverage paths');
}

const repaired = source.replace(marker, () => `${coveragePaths}${marker}`);
const parsed = YAML.parse(repaired);
if (!parsed?.paths?.['/platform/agent-governance/logic-coverage'] || !parsed?.paths?.['/platform/agent-governance/engine-coverage']) {
  throw new Error('Repaired OpenAPI did not expose both capability coverage paths');
}

fs.writeFileSync(path.resolve(targetPath), repaired, 'utf8');
console.log(JSON.stringify({
  ok: true,
  source: sourcePath,
  target: targetPath,
  operation_ids: [
    parsed.paths['/platform/agent-governance/logic-coverage'].get.operationId,
    parsed.paths['/platform/agent-governance/engine-coverage'].get.operationId,
  ],
}, null, 2));
