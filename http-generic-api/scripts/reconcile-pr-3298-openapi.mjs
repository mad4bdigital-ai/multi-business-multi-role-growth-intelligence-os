#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const openapiPath = path.resolve(process.cwd(), "openapi.yaml");
let source = fs.readFileSync(openapiPath, "utf8");
const operationIds = [
  "runGrowthIntelligencePilot",
  "listGrowthIntelligenceReports",
  "getGrowthIntelligenceMetrics",
  "getGrowthIntelligenceReport",
  "decideGrowthIntelligenceAction",
  "decideGrowthIntelligenceInsight",
  "createGrowthIntelligenceReadinessAssessment",
];

for (const operationId of operationIds) {
  const operationMarker = `operationId: ${operationId}`;
  const operationIndex = source.indexOf(operationMarker);
  if (operationIndex < 0) throw new Error(`Missing OpenAPI operation: ${operationId}`);
  const pathIndex = source.lastIndexOf("\n  /", operationIndex);
  const securityIndex = source.indexOf("\n      security:", pathIndex);
  if (securityIndex < 0 || securityIndex > operationIndex) {
    throw new Error(`Missing operation security declaration: ${operationId}`);
  }
  const lineEnd = source.indexOf("\n", securityIndex + 1);
  const securityLine = source.slice(securityIndex, lineEnd);
  if (!securityLine.includes("backendBearerAuth") && !securityLine.includes("adminBearerAuth")) {
    throw new Error(`Unexpected security declaration for ${operationId}: ${securityLine}`);
  }
  const updatedLine = securityLine.replace("backendBearerAuth", "adminBearerAuth");
  source = source.slice(0, securityIndex) + updatedLine + source.slice(lineEnd);
}

fs.writeFileSync(openapiPath, source, "utf8");
console.log(`Reconciled ${operationIds.length} Growth Intelligence OpenAPI security contracts.`);
